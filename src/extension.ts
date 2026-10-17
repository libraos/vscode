import * as vscode from "vscode";
import { Secrets } from "./secrets";
import { RuntimeManager } from "./runtime/manager";
import * as os from "node:os";
import { adminToken, getInstallation, mintServiceKey } from "./runtime/api";
import { ADMIN_EMAIL } from "./runtime/compose";
import { WorkspaceTree } from "./views/tree";
import { CONFIG_FILE, FASTAPI_LAUNCH_NAME, detectProject, fastapiTemplate, mergeLaunch, projectConfig, projectTemplate, usesFastApi } from "./project/detect";
import { registerExampleCommands, type ExamplesApi } from "./examples/commands";
import { SetupTokens } from "./runtime/setupToken";
import { renewIn, terminalEnv } from "./runtime/terminalEnv";
import { registerExplorer } from "./explorer/register";
import type { ExplorerTree } from "./explorer/tree";

const EXAMPLES_RUNTIME_KEY = "libraos.examples.useLocalRuntime";

async function hasExamplesFolder(): Promise<boolean> {
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (await fileExists(vscode.Uri.joinPath(f.uri, ".libraos", "source.json"))) return true;
  }
  return false;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
import { listModels, testEmbedding, testModel } from "./model/endpoint";
import { CloudAccount, consoleUrl } from "./cloud/account";
import { accountLabel } from "./views/developer";
import { defaultInstallationName } from "./cloud/installations";

const MEGANOVA = "https://api.meganova.ai";

export function activate(ctx: vscode.ExtensionContext): { tree: WorkspaceTree; account: CloudAccount; examples: ExamplesApi; explorer: ExplorerTree } {
  const output = vscode.window.createOutputChannel("LibraOS");
  const secrets = new Secrets(ctx.secrets);
  const runtime = new RuntimeManager(ctx, secrets, output);
  // Reads the local runtime's installation id with the extension's own admin
  // session to it. That session is used only against 127.0.0.1.
  const account = new CloudAccount(secrets, output, {
    installation: async () => {
      if (runtime.status !== "running" || !(await secrets.hasRuntime())) return "not_running";
      const rs = await secrets.runtime();
      const token = await adminToken(runtime.baseUrl, ADMIN_EMAIL, rs.adminPassword);
      return getInstallation(runtime.baseUrl, token);
    },
    defaultName: () => defaultInstallationName(vscode.workspace.workspaceFolders?.[0]?.name, os.hostname()),
  });

  const projectState = async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { initialized: false, hasKey: false };
    const initialized = await exists(vscode.Uri.joinPath(folder.uri, CONFIG_FILE));
    return { initialized, hasKey: Boolean(await secrets.projectKey(folder.uri)) };
  };
  const tree = new WorkspaceTree(runtime, projectState, () => account.state, async () => ({
    open: await hasExamplesFolder(),
    useRuntime: ctx.workspaceState.get<boolean>(EXAMPLES_RUNTIME_KEY, false),
  }));
  account.onDidChange(() => tree.refresh());

  // Status bar: runtime state at a glance; click to open the LibraOS view.
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  bar.command = "libraos.workspace.focus";
  const paintBar = () => {
    const st = runtime.status;
    bar.text =
      st === "running"
        ? "$(pass-filled) LibraOS"
        : st === "starting"
          ? "$(loading~spin) LibraOS"
          : "$(circle-outline) LibraOS";
    const who = accountLabel(account.state);
    bar.tooltip = [
      st === "running" ? `LibraOS runtime running at ${runtime.baseUrl}` : `LibraOS runtime: ${st}`,
      who ? `Signed in as ${who}` : account.state.signedIn ? "Signed in" : "Not signed in",
    ].join("\n");
    bar.show();
  };
  runtime.onDidChange(paintBar);
  ctx.subscriptions.push({ dispose: () => renewal && clearTimeout(renewal) });
  account.onDidChange(paintBar);
  paintBar();

  // Integrated terminals get the project's runtime URL and key, so examples
  // run as-is. Not persisted: the key is never written to disk.
  const env = ctx.environmentVariableCollection;
  env.persistent = false;
  env.description = "LibraOS runtime URL and project API key";
  const tokens = new SetupTokens(runtime, secrets, output);
  // In a Get Example folder where the person turned on "Use This Runtime for
  // Run and Debug", terminals (and so VS Code's Run button and debugger) get a
  // setup token as LIBRA_OS_API_KEY instead. It lives only in memory and is
  // renewed before its hour runs out.
  let renewal: NodeJS.Timeout | undefined;
  const examplesFolders = async () => {
    const out: vscode.WorkspaceFolder[] = [];
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (await fileExists(vscode.Uri.joinPath(f.uri, ".libraos", "source.json"))) out.push(f);
    }
    return out;
  };
  const examplesUseRuntime = () => ctx.workspaceState.get<boolean>(EXAMPLES_RUNTIME_KEY, false);
  const applyEnv = async () => {
    env.clear();
    if (renewal) clearTimeout(renewal);
    renewal = undefined;
    const examples = await examplesFolders();
    const examplesToken = examples.length && examplesUseRuntime() && runtime.status === "running" ? await tokens.quiet() : undefined;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const infos = await Promise.all(
      folders.map(async (f) => ({ id: f.uri.toString(), isExamples: examples.includes(f), projectKey: await secrets.projectKey(f.uri) })),
    );
    const plan = terminalEnv(infos, { baseUrl: runtime.baseUrl, examplesToken: examplesToken?.token });
    for (const f of folders) {
      const vars = plan.get(f.uri.toString());
      if (!vars) continue;
      const scoped = env.getScoped({ workspaceFolder: f });
      for (const [k, v] of Object.entries(vars)) scoped.replace(k, v);
    }
    if (examplesToken) renewal = setTimeout(() => void applyEnv(), renewIn(examplesToken.expiresAt, Date.now()));
  };

  // Issue or withdraw the examples folder's token when the runtime starts or stops.
  let lastStatus = runtime.status;
  runtime.onDidChange(() => {
    if (runtime.status === lastStatus) return;
    lastStatus = runtime.status;
    void applyEnv().then(() => tree.refresh());
  });

  const refreshAll = async () => {
    await Promise.all([runtime.refresh(), account.refresh()]);
    await applyEnv();
    tree.refresh();
  };

  const cmd = (id: string, fn: (...a: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd("libraos.refresh", refreshAll);

  cmd("libraos.signIn", () => account.signIn());
  cmd("libraos.signOut", () => account.signOut());
  cmd("libraos.claimLicence", () => account.claimLicence());
  cmd("libraos.registerInstallation", () => account.registerInstallation());
  cmd("libraos.removeInstallation", (item?: unknown) => account.removeInstallation(item));

  cmd("libraos.openConsole", () => vscode.env.openExternal(vscode.Uri.parse(consoleUrl())));

  cmd("libraos.cloudDeploy", () =>
    vscode.window.showInformationMessage("Cloud Deployment is coming soon. For now, run the runtime locally."),
  );

  // Knowledge search needs an embedding model. By default the runtime embeds
  // through the model endpoint, which a chat-only server (a local proxy,
  // llama.cpp) cannot do: ingest then fails with "embedding API error 404".
  // Destructive: deletes everything the runtime stores. Needed to change the
  // vector store's size, and to start over.
  const resetRuntimeData = async (reason?: string): Promise<boolean> => {
    const ok = await vscode.window.showWarningMessage(
      "Delete all of the local runtime's data?",
      {
        modal: true,
        detail: [
          reason ?? "",
          "This deletes its database and stored documents: agents, users, conversations, memory and knowledge collections. Project API keys minted on it stop working; run Initialize LibraOS Project again for each project.",
          "The runtime images, your settings and the extension's secrets are kept. This cannot be undone.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      "Delete Runtime Data",
    );
    if (ok !== "Delete Runtime Data") return false;
    if (!(await runtime.resetData())) return false;
    for (const f of vscode.workspace.workspaceFolders ?? []) await secrets.deleteProjectKey(f.uri);
    await applyEnv();
    tree.refresh();
    void vscode.window.showInformationMessage("LibraOS: the runtime's data was deleted. Run Local Runtime to start it fresh.");
    return true;
  };
  cmd("libraos.resetRuntimeData", () => resetRuntimeData());

  cmd("libraos.configureEmbeddings", async () => {
    const cfg = vscode.workspace.getConfiguration("libraos");
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Use the model endpoint", description: cfg.get<string>("model.baseUrl", ""), base: "", model: "" },
        { label: "Ollama on this machine", description: "http://127.0.0.1:11434 · nomic-embed-text (ollama pull nomic-embed-text)", base: "http://127.0.0.1:11434", model: "nomic-embed-text" },
        { label: "Other OpenAI-compatible endpoint…", description: "", base: "?", model: "" },
      ],
      { title: "LibraOS: where should the runtime embed documents for knowledge search?" },
    );
    if (!pick) return;
    let base = pick.base;
    let model = pick.model;
    let dims = 0;
    if (base === "?") {
      base = (await vscode.window.showInputBox({ title: "Embedding endpoint", prompt: "OpenAI-compatible base URL that serves /v1/embeddings", ignoreFocusOut: true })) ?? "";
      if (!base) return;
      model = (await vscode.window.showInputBox({ title: "Embedding model", prompt: "Model name at that endpoint", ignoreFocusOut: true })) ?? "";
      if (!model) return;
    }
    if (base) {
      const key = base.includes("11434") ? undefined : await secrets.modelKey();
      const t = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `LibraOS: testing ${model}` }, () => testEmbedding(base, model, key));
      if (!t.ok) {
        const go = await vscode.window.showWarningMessage(`LibraOS: the embedding test failed: ${t.error}`, "Save Anyway");
        if (go !== "Save Anyway") return;
      } else {
        dims = t.dims ?? 0;
        void vscode.window.showInformationMessage(`LibraOS: ${model} returned a ${t.dims}-dimension embedding in ${t.ms} ms.`);
      }
    }
    await cfg.update("embedding.baseUrl", base, vscode.ConfigurationTarget.Global);
    const before = cfg.get<number>("embedding.dimensions", 0) || 0;
    const after = base ? dims : 0;
    await cfg.update("embedding.model", model, vscode.ConfigurationTarget.Global);
    // The runtime's vector store is sized for one embedding model (4096 by default).
    await cfg.update("embedding.dimensions", after, vscode.ConfigurationTarget.Global);
    // The store's vector column is sized when the runtime first starts and is
    // not resized later, even when empty; a new size needs fresh data.
    if (before !== after && runtime.status !== "not-installed" && (await secrets.hasRuntime())) {
      const choice = await vscode.window.showWarningMessage(
        `The runtime's knowledge store was created for another vector size. ${model || "The default model"} needs ${after || "the default size"}, so documents cannot be ingested until its data is reset.`,
        "Reset Runtime Data…",
        "Later",
      );
      if (choice === "Reset Runtime Data…" && (await resetRuntimeData(`The new embedding model needs a ${after || "default"}-dimension store.`))) {
        tree.refresh();
        return;
      }
    }
    if (runtime.status === "running") {
      const r = await vscode.window.showInformationMessage(
        "Restart the runtime to use the new embedding settings? Its data is kept, but documents already embedded with a model of another size must be re-ingested.",
        "Restart Runtime",
      );
      if (r) {
        await runtime.stop();
        await runtime.start();
      }
    }
    tree.refresh();
  });

  cmd("libraos.configureModel", async () => {
    const cfg = vscode.workspace.getConfiguration("libraos");
    const preset = await vscode.window.showQuickPick(
      [
        { label: "MegaNova AI gateway", description: MEGANOVA, url: MEGANOVA, needsKey: true },
        { label: "Local proxy", description: "http://127.0.0.1:8318/v1", url: "http://127.0.0.1:8318/v1", needsKey: true, edit: true },
        { label: "Ollama on this machine", description: "http://127.0.0.1:11434/v1", url: "http://127.0.0.1:11434/v1", needsKey: false },
        { label: "Other OpenAI-compatible endpoint…", description: "", url: "", needsKey: true, edit: true },
      ],
      { title: "LibraOS: where should the runtime send model calls?" },
    );
    if (!preset) return;
    let url = preset.url;
    if (preset.edit) {
      const v = await vscode.window.showInputBox({
        title: "Model endpoint base URL",
        value: preset.url || cfg.get<string>("model.baseUrl"),
        validateInput: (s) => (/^https?:\/\//.test(s) ? undefined : "Enter an http(s) URL"),
      });
      if (!v) return;
      url = v.trim();
    }

    let key: string | undefined;
    if (preset.needsKey) {
      const entered = await vscode.window.showInputBox({
        title: "Model API key",
        prompt: "Stored in VS Code SecretStorage. Leave empty to keep the current key.",
        password: true,
        ignoreFocusOut: true,
      });
      if (entered === undefined) return;
      key = entered.trim() || (await secrets.modelKey());
    }

    // Pick from what the endpoint serves; fall back to typing a name.
    let models: string[] = [];
    try {
      models = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Listing models at ${url}` },
        () => listModels(url, key),
      );
    } catch (err) {
      output.appendLine(`Listing models at ${url} failed: ${String(err)}`);
    }
    const current = cfg.get<string>("model.name") ?? "";
    let model: string | undefined;
    if (models.length) {
      const typed = "$(edit) Enter a model name…";
      const pick = await vscode.window.showQuickPick(
        [...models.map((m) => ({ label: m, description: m === current ? "current" : undefined })), { label: typed }],
        { title: `Models at ${url} (${models.length})`, matchOnDescription: true },
      );
      if (!pick) return;
      model = pick.label === typed ? undefined : pick.label;
    }
    if (!model) {
      model = await vscode.window.showInputBox({
        title: "Model name",
        prompt: models.length ? undefined : "Could not list the endpoint's models; enter the name it serves.",
        value: current,
        validateInput: (s) => (s.trim() ? undefined : "Required"),
      });
      if (!model) return;
      model = model.trim();
    }

    // One test call before anything is saved.
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Testing ${model}` },
      () => testModel(url, model!, key),
    );
    output.appendLine(
      `Model test ${model} at ${url}: ${result.ok ? `ok in ${result.ms} ms, reply "${result.reply}"` : `failed: ${result.error}`}`,
    );
    if (!result.ok) {
      const r = await vscode.window.showErrorMessage(
        `LibraOS: ${model} did not answer: ${result.error}`,
        "Save Anyway",
        "Show Output",
      );
      if (r === "Show Output") output.show(true);
      if (r !== "Save Anyway") return;
    } else {
      void vscode.window.showInformationMessage(`${model} answered in ${(result.ms / 1000).toFixed(1)} s.`);
    }

    if (preset.needsKey) await secrets.setModelKey(key);
    else await secrets.setModelKey(undefined);
    await cfg.update("model.baseUrl", url, vscode.ConfigurationTarget.Global);
    await cfg.update("model.name", model, vscode.ConfigurationTarget.Global);
    tree.refresh();
    if (runtime.status === "running") {
      const r = await vscode.window.showInformationMessage("Restart the runtime to use the new model?", "Restart");
      if (r) {
        await runtime.stop();
        await runtime.start();
      }
    }
  });

  cmd("libraos.installRuntime", async () => {
    await runtime.install();
    tree.refresh();
  });

  cmd("libraos.startRuntime", async () => {
    const s = runtime.settings();
    if (s.modelBaseUrl === MEGANOVA && !(await secrets.modelKey())) {
      const r = await vscode.window.showWarningMessage(
        "No model key is set, so the runtime cannot answer. Configure the model first?",
        "Configure Model",
        "Start Anyway",
      );
      if (r === "Configure Model") return vscode.commands.executeCommand("libraos.configureModel");
      if (!r) return;
    }
    await runtime.start();
    await applyEnv();
  });

  cmd("libraos.stopRuntime", () => runtime.stop());
  cmd("libraos.showLogs", () => runtime.logs());

  cmd("libraos.initProject", async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const entries = await vscode.workspace.fs.readDirectory(folder.uri);
    const kind = detectProject(entries.map(([name]) => name));
    const s = runtime.settings();
    let tpl = projectTemplate(kind, s.modelName);
    let framework = "";
    if (kind === "python") {
      // A FastAPI project gets a FastAPI backend; otherwise ask which to start from.
      const deps = await Promise.all(
        ["requirements.txt", "pyproject.toml", "Pipfile"].map(async (f) => {
          try {
            return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, f))).toString("utf8");
          } catch {
            return "";
          }
        }),
      );
      let fastapi = usesFastApi(deps.join("\n"));
      if (!fastapi) {
        const pick = await vscode.window.showQuickPick(
          [
            { label: "FastAPI app", description: "a web backend with POST /ask, run and debugged with uvicorn", fastapi: true },
            { label: "Script", description: "one chat call", fastapi: false },
          ],
          { title: "Start this Python project from" },
        );
        if (!pick) return;
        fastapi = pick.fastapi;
      }
      if (fastapi) {
        tpl = fastapiTemplate(s.modelName);
        framework = " (FastAPI)";
      }
    }
    const configUri = vscode.Uri.joinPath(folder.uri, CONFIG_FILE);
    const quickUri = vscode.Uri.joinPath(folder.uri, tpl.quickstartFile);

    const writes: [vscode.Uri, string][] = [];
    if (!(await exists(configUri))) writes.push([configUri, projectConfig(runtime.baseUrl.replace("127.0.0.1", "localhost"), s.modelName)]);
    if (!(await exists(quickUri))) writes.push([quickUri, tpl.quickstart]);
    let launchNote = "";
    if (tpl.launch) {
      const launchUri = vscode.Uri.joinPath(folder.uri, ".vscode", "launch.json");
      let current: string | undefined;
      try {
        current = Buffer.from(await vscode.workspace.fs.readFile(launchUri)).toString("utf8");
      } catch {
        current = undefined;
      }
      const merged = mergeLaunch(current, tpl.launch);
      if (merged) writes.push([launchUri, merged]);
      else if (current !== undefined && !current.includes(String(tpl.launch.name)))
        launchNote = `\n.vscode/launch.json has comments, so it is not changed. Add the "${tpl.launch.name}" configuration yourself; it is in the LibraOS README.`;
    }

    const detail = [
      `Detected: ${kind === "other" ? "no known project type (a curl example is used)" : kind + framework}`,
      "",
      writes.length ? "Creates:" : "Files already exist; nothing is overwritten.",
      ...writes.map(([u]) => `  ${vscode.workspace.asRelativePath(u)}`),
      "",
      "Mints an API key for this project on the local runtime. The key is kept in VS Code SecretStorage and given to VS Code terminals as LIBRA_OS_API_KEY; it is never written to the workspace.",
      tpl.installCommand ? `\nThen offers to run: ${tpl.installCommand}` : "",
      launchNote,
    ].join("\n");
    const ok = await vscode.window.showInformationMessage(
      `Initialize LibraOS in ${folder.name}?`,
      { modal: true, detail },
      "Initialize",
    );
    if (ok !== "Initialize") return;

    for (const [u, content] of writes) await vscode.workspace.fs.writeFile(u, Buffer.from(content));

    await runtime.refresh();
    if (runtime.status !== "running") {
      const r = await vscode.window.showWarningMessage(
        "The local runtime is not running, so no API key was minted. Start it now?",
        "Run Local Runtime",
      );
      if (r) await vscode.commands.executeCommand("libraos.startRuntime");
    }
    if (runtime.status === "running" && !(await secrets.projectKey(folder.uri))) {
      try {
        const rs = await secrets.runtime();
        const token = await adminToken(runtime.baseUrl, ADMIN_EMAIL, rs.adminPassword);
        const key = await mintServiceKey(runtime.baseUrl, token, `vscode:${folder.name}`);
        await secrets.setProjectKey(folder.uri, key.secret);
        await applyEnv();
      } catch (err) {
        output.appendLine(`Minting the project key failed: ${String(err)}`);
        void vscode.window.showErrorMessage(`LibraOS: could not mint a project API key: ${String(err)}`);
      }
    }
    tree.refresh();

    if (tpl.installCommand) {
      const r = await vscode.window.showInformationMessage(`Add the LibraOS SDK: ${tpl.installCommand}?`, "Run in Terminal");
      if (r) {
        const term = vscode.window.createTerminal({ name: "LibraOS", cwd: folder.uri });
        term.show();
        term.sendText(tpl.installCommand);
      }
    }
    if (await exists(quickUri)) await vscode.window.showTextDocument(quickUri);
    if (tpl.launch?.name === FASTAPI_LAUNCH_NAME) {
      void vscode.window
        .showInformationMessage(
          `LibraOS initialized with a FastAPI app. Start it from Run and Debug, “${FASTAPI_LAUNCH_NAME}”, and watch its calls in the Runtime Log.`,
          "Open Runtime Log",
        )
        .then((c) => c && vscode.commands.executeCommand("libraos.showRuntimeLog"));
    } else {
      void vscode.window.showInformationMessage(
        "LibraOS initialized. Open a new VS Code terminal to get LIBRA_OS_URL and LIBRA_OS_API_KEY.",
      );
    }
  });

  cmd("libraos.copyApiKey", async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const key = await secrets.projectKey(folder.uri);
    if (!key) {
      void vscode.window.showWarningMessage("No API key for this project yet. Run “Initialize LibraOS Project” with the runtime running.");
      return;
    }
    await vscode.env.clipboard.writeText(key);
    void vscode.window.showInformationMessage("Project API key copied. Don't commit it.");
  });

  cmd("libraos.copySetupToken", () => tokens.command());
  const explorer = registerExplorer(ctx, runtime, tokens);
  cmd("libraos.toggleExamplesRuntime", async () => {
    if (examplesUseRuntime()) {
      await ctx.workspaceState.update(EXAMPLES_RUNTIME_KEY, false);
      await applyEnv();
      tree.refresh();
      void vscode.window.showInformationMessage("LibraOS: Run and Debug in this folder no longer get a setup token. New terminals use no LibraOS key.");
      return;
    }
    if (!(await examplesFolders()).length) {
      void vscode.window.showInformationMessage("LibraOS: open an examples folder made by Get Example first.");
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      "Use the Runtime this extension manages for Run and Debug in this folder?",
      {
        modal: true,
        detail:
          "Terminals in this window, including the ones VS Code's Run button and debugger use, get LIBRA_OS_URL and a setup token as LIBRA_OS_API_KEY. The token is an admin token for the Runtime on this machine; it stays in memory and is renewed every hour while the Runtime runs. Turn this off from the LibraOS view at any time.",
      },
      "Use This Runtime",
    );
    if (!ok) return;
    if (!(await tokens.get())) return; // explains a stopped Runtime or a missing setup client
    await ctx.workspaceState.update(EXAMPLES_RUNTIME_KEY, true);
    await applyEnv();
    tree.refresh();
    void vscode.window.showInformationMessage("LibraOS: Run and Debug in this folder now use this Runtime. Terminals opened before this are relaunched when idle, or show a relaunch prompt.");
  });
  const examples = registerExampleCommands(ctx, output, {
    runtimeRunning: () => runtime.status === "running",
    examplesUseRuntime: () => ctx.workspaceState.get<boolean>(EXAMPLES_RUNTIME_KEY, false),
    enableExamplesRuntime: async () => {
      if (!ctx.workspaceState.get<boolean>(EXAMPLES_RUNTIME_KEY, false)) await vscode.commands.executeCommand("libraos.toggleExamplesRuntime");
      return ctx.workspaceState.get<boolean>(EXAMPLES_RUNTIME_KEY, false);
    },
    openTokenTerminal: async (name, cwd, command) => {
      const token = await tokens.get();
      if (!token) return false;
      tokens.terminal(token, { name, cwd, command });
      return true;
    },
  });

  ctx.subscriptions.push(
    output,
    bar,
    vscode.window.registerTreeDataProvider("libraos.workspace", tree),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("libraos")) void refreshAll();
    }),
  );

  // Poll the runtime's health while it is installed, so the status bar and
  // tree follow a runtime started or stopped outside VS Code.
  const timer = setInterval(() => {
    if (runtime.installed && runtime.status !== "starting") void runtime.refresh();
  }, 15000);
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) });

  void refreshAll();
  // Exposed for the integration test.
  return { tree, account, examples, explorer };
}

export function deactivate(): void {}

async function exists(u: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(u);
    return true;
  } catch {
    return false;
  }
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("Open your project folder first.");
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Which project?" });
}
