import * as vscode from "vscode";
import { Secrets } from "./secrets";
import { RuntimeManager } from "./runtime/manager";
import { adminToken, mintServiceKey } from "./runtime/api";
import { ADMIN_EMAIL } from "./runtime/compose";
import { WorkspaceTree } from "./views/tree";
import { CONFIG_FILE, detectProject, projectConfig, projectTemplate } from "./project/detect";
import { EXAMPLES, rawUrl, webUrl } from "./examples/catalog";
import { listModels, testModel } from "./model/endpoint";

const MEGANOVA = "https://api.meganova.ai";

export function activate(ctx: vscode.ExtensionContext): { tree: WorkspaceTree } {
  const output = vscode.window.createOutputChannel("LibraOS");
  const secrets = new Secrets(ctx.secrets);
  const runtime = new RuntimeManager(ctx, secrets, output);

  const projectState = async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { initialized: false, hasKey: false };
    const initialized = await exists(vscode.Uri.joinPath(folder.uri, CONFIG_FILE));
    return { initialized, hasKey: Boolean(await secrets.projectKey(folder.uri)) };
  };
  const tree = new WorkspaceTree(runtime, projectState);

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
    bar.tooltip = st === "running" ? `LibraOS runtime running at ${runtime.baseUrl}` : `LibraOS runtime: ${st}`;
    bar.show();
  };
  runtime.onDidChange(paintBar);
  paintBar();

  // Integrated terminals get the project's runtime URL and key, so examples
  // run as-is. Not persisted: the key is never written to disk.
  const env = ctx.environmentVariableCollection;
  env.persistent = false;
  env.description = "LibraOS runtime URL and project API key";
  const applyEnv = async () => {
    env.clear();
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      const key = await secrets.projectKey(f.uri);
      if (!key) continue;
      const scoped = env.getScoped({ workspaceFolder: f });
      const vars: Record<string, string> = {
        LIBRAOS_BASE_URL: runtime.baseUrl,
        LIBRAOS_API_KEY: key,
        // Names the cookbook and SDK examples read.
        LIBRA_OS_URL: runtime.baseUrl,
        NOVA_OS_URL: runtime.baseUrl,
        NOVA_OS_API_KEY: key,
      };
      for (const [k, v] of Object.entries(vars)) scoped.replace(k, v);
    }
  };

  const refreshAll = async () => {
    await runtime.refresh();
    await applyEnv();
    tree.refresh();
  };

  const cmd = (id: string, fn: (...a: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd("libraos.refresh", refreshAll);

  cmd("libraos.signIn", async () => {
    const pick = await vscode.window.showInformationMessage(
      "Sign-in, the Developer License and the $10 welcome credits arrive with the LibraOS Developer Console. Until then, set a model key with “Configure Model”.",
      "Configure Model",
      "Open Console",
    );
    if (pick === "Configure Model") await vscode.commands.executeCommand("libraos.configureModel");
    if (pick === "Open Console") await vscode.commands.executeCommand("libraos.openConsole");
  });

  cmd("libraos.openConsole", () => {
    const url = vscode.workspace.getConfiguration("libraos").get<string>("consoleUrl", "https://app.libraos.com");
    return vscode.env.openExternal(vscode.Uri.parse(url));
  });

  cmd("libraos.cloudDeploy", () =>
    vscode.window.showInformationMessage("Cloud Deployment is coming soon. For now, run the runtime locally."),
  );

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
    const tpl = projectTemplate(kind, s.modelName);
    const configUri = vscode.Uri.joinPath(folder.uri, CONFIG_FILE);
    const quickUri = vscode.Uri.joinPath(folder.uri, tpl.quickstartFile);

    const writes: [vscode.Uri, string][] = [];
    if (!(await exists(configUri))) writes.push([configUri, projectConfig(runtime.baseUrl.replace("127.0.0.1", "localhost"), s.modelName)]);
    if (!(await exists(quickUri))) writes.push([quickUri, tpl.quickstart]);

    const detail = [
      `Detected: ${kind === "other" ? "no known project type (a curl example is used)" : kind}`,
      "",
      writes.length ? "Creates:" : "Files already exist; nothing is overwritten.",
      ...writes.map(([u]) => `  ${vscode.workspace.asRelativePath(u)}`),
      "",
      "Mints an API key for this project on the local runtime. The key is kept in VS Code SecretStorage and given to VS Code terminals as LIBRAOS_API_KEY; it is never written to the workspace.",
      tpl.installCommand ? `\nThen offers to run: ${tpl.installCommand}` : "",
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
    void vscode.window.showInformationMessage(
      "LibraOS initialized. Open a new VS Code terminal to get LIBRAOS_BASE_URL and LIBRAOS_API_KEY.",
    );
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

  cmd("libraos.browseExamples", async () => {
    const pick = await vscode.window.showQuickPick(
      EXAMPLES.map((e) => ({ label: e.title, description: e.description, detail: `libraos/${e.repo} · ${e.path}`, id: e.id })),
      { title: "LibraOS Cookbook", matchOnDescription: true, matchOnDetail: true },
    );
    if (pick) await vscode.commands.executeCommand("libraos.openExample", pick.id);
  });

  cmd("libraos.openExample", async (id: string) => {
    const e = EXAMPLES.find((x) => x.id === id);
    if (!e) return;
    try {
      const r = await fetch(rawUrl(e), { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const doc = await vscode.workspace.openTextDocument({ content: await r.text(), language: e.languageId });
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      const pick = await vscode.window.showErrorMessage(`Could not fetch the example: ${String(err)}`, "Open on GitHub");
      if (pick) void vscode.env.openExternal(vscode.Uri.parse(webUrl(e)));
    }
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
  return { tree };
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
