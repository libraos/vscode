import * as vscode from "vscode";
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import {
  EXAMPLES,
  GUIDES,
  PATHS,
  SETUP_GUIDE,
  badge,
  directoryUrl,
  downloadScope,
  exampleCard,
  examplesFor,
  fileWebUrl,
  findExample,
  isMultiFile,
  isPythonCommand,
  localFolderName,
  pythonRequirements,
  runLine,
  tutorialUrl,
  variants,
  type Example,
  type PathId,
  type Variant,
} from "./catalog";
import { covers, downloadFiles, fetchTree, readSource, safeJoin, selectFiles, writeSource, type FetchFn } from "./download";
import {
  displayStep,
  exists,
  findPython,
  hasSdk,
  setupSteps,
  venvPython,
  writeInterpreterSetting,
  type ExecFn,
} from "./python";

const GET_EXAMPLE = "Get Example";
const OPEN_TUTORIAL = "Open Tutorial";
const VIEW_ON_GITHUB = "View on GitHub";
const PARENT_KEY = "libraos.examples.parentFolder";
const PENDING_KEY = "libraos.examples.pendingOpen";

const exec: ExecFn = (file, args, opts) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { cwd: opts?.cwd, timeout: opts?.timeout ?? 600000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) }),
    ),
  );

function openWeb(url: string): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

type GuideItem = vscode.QuickPickItem & { guide: "paths" | "setup" | "validation" };
type PathItem = vscode.QuickPickItem & { path: PathId };
type ExampleItem = vscode.QuickPickItem & { id: string };

interface Pending {
  root: string;
  id: string;
  variant: string;
  at: number;
}

export interface PrepareOptions {
  /** Folder that holds the local copy; the copy itself is a subfolder. */
  parent: string;
  /** Set up the Python environment without asking (tests). */
  python?: "ask" | "yes" | "no";
  /** Language to run, for an example that offers several; the first by default. */
  variant?: string;
}

export interface PrepareResult {
  root: string;
  main: string;
  runCwd: string;
  variant: string;
  command: string;
  python?: string;
}

class Examples {
  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  // ── Browse ──────────────────────────────────────────────────────────────

  async browse(): Promise<void> {
    const items: (PathItem | GuideItem | vscode.QuickPickItem)[] = [
      ...PATHS.map((p) => ({ label: p.label, detail: p.detail, path: p.id })),
      { label: "Guides", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(book) Learning paths", description: "the cookbook's map of every example", guide: "paths" as const },
      { label: "$(server-environment) Cookbook setup or this extension's Runtime?", description: "which Runtime to run examples on", guide: "setup" as const },
      { label: "$(beaker) What has been validated", description: "offline tests and live checks", guide: "validation" as const },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: "LibraOS Cookbook", placeHolder: "Choose how to explore" });
    if (!pick) return;
    if ("guide" in pick) {
      if (pick.guide === "setup") return this.setupGuide();
      await openWeb(pick.guide === "paths" ? GUIDES.learningPaths : GUIDES.validation);
      return;
    }
    if (!("path" in pick)) return;
    const id = await this.pickExample(pick.path, pick.label);
    if (id) await this.showCard(id);
  }

  async pickExample(path?: PathId, title = "LibraOS Cookbook"): Promise<string | undefined> {
    const list = path ? examplesFor(path) : EXAMPLES;
    const pick = await vscode.window.showQuickPick<ExampleItem>(
      list.map((e) => ({ label: e.title, description: badge(e, path), detail: `${e.description} · libraos/${e.repo}/${e.dir}`, id: e.id })),
      { title, matchOnDescription: true, matchOnDetail: true },
    );
    return pick?.id;
  }

  // What the example shows and needs, with the ways to open it.
  async showCard(id: string): Promise<void> {
    const e = findExample(id);
    if (!e) return;
    const choice = await vscode.window.showInformationMessage(e.title, { modal: true, detail: exampleCard(e) }, GET_EXAMPLE, OPEN_TUTORIAL, VIEW_ON_GITHUB);
    if (choice === GET_EXAMPLE) await this.getExample(e.id);
    if (choice === OPEN_TUTORIAL) await openWeb(tutorialUrl(e));
    if (choice === VIEW_ON_GITHUB) await this.viewOnGitHub(e.id);
  }

  async resolve(id: unknown): Promise<Example | undefined> {
    const chosen = typeof id === "string" ? id : await this.pickExample();
    return chosen ? findExample(chosen) : undefined;
  }

  async viewOnGitHub(id?: unknown): Promise<void> {
    const e = await this.resolve(id);
    if (!e) return;
    await openWeb(isMultiFile(e) || !e.files ? directoryUrl(e) : fileWebUrl(e, e.files[0]));
  }

  // ── Get Example ─────────────────────────────────────────────────────────

  // Downloads the example (with what it shares with other examples) into a
  // local folder, sets up its Python environment, and opens it so it can be
  // run in VS Code.
  async getExample(id?: unknown): Promise<void> {
    const e = await this.resolve(id);
    if (!e) return;
    const variant = await this.chooseVariant(e);
    if (!variant) return;
    const parent = await this.chooseParent();
    if (!parent) return;
    let result: PrepareResult | undefined;
    try {
      result = await this.prepare(e, { parent, python: "ask", variant: variant.label });
    } catch (err) {
      this.output.appendLine(`[examples] ${e.id}: ${String((err as Error).stack ?? err)}`);
      const pick = await vscode.window.showErrorMessage(`LibraOS: could not get “${e.title}”: ${(err as Error).message}`, VIEW_ON_GITHUB, "Show Log");
      if (pick === VIEW_ON_GITHUB) await this.viewOnGitHub(e.id);
      if (pick === "Show Log") this.output.show();
      return;
    }
    if (!result) return;
    await this.openWhere(e, result);
  }

  private async chooseVariant(e: Example): Promise<Variant | undefined> {
    const all = variants(e);
    if (all.length === 1) return all[0];
    const pick = await vscode.window.showQuickPick(
      all.map((v) => ({ label: v.label, description: v.main.split("/").pop(), variant: v })),
      { title: `${e.title}: which language?` },
    );
    return pick?.variant;
  }

  private async chooseParent(): Promise<string | undefined> {
    const saved = this.ctx.globalState.get<string>(PARENT_KEY);
    if (saved && (await exists(saved))) return saved;
    const picked = await vscode.window.showOpenDialog({
      title: "Where should LibraOS keep the examples? A “libraos-cookbook” folder is created inside it.",
      openLabel: "Keep Examples Here",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(os.homedir()),
    });
    const dir = picked?.[0]?.fsPath;
    if (dir) await this.ctx.globalState.update(PARENT_KEY, dir);
    return dir;
  }

  /** Download and set up; no prompts except the Python confirmation when `python` is "ask". */
  async prepare(e: Example, opts: PrepareOptions): Promise<PrepareResult | undefined> {
    const root = path.join(opts.parent, localFolderName(e.repo));
    await this.ensureFiles(e, root);

    const all = variants(e);
    const v = all.find((x) => x.label === opts.variant) ?? all[0];
    const result: PrepareResult = { root, main: safeJoin(root, v.main), runCwd: safeJoin(root, e.run.cwd), variant: v.label, command: v.command };
    if (isPythonCommand(v.command)) {
      const ready = await this.ensurePython(e, root, opts.python ?? "ask");
      if (ready) result.python = venvPython(root, process.platform);
    }
    return result;
  }

  private async ensureFiles(e: Example, root: string): Promise<void> {
    const scope = downloadScope(e);
    const local = await readSource(root);
    if (local && local.repo !== e.repo) throw new Error(`${root} holds a copy of libraos/${local.repo}, not libraos/${e.repo}`);
    // A folder LibraOS started filling (.libraos/ exists) can be resumed after
    // an interrupted download; any other non-empty folder is left alone.
    if (!local && (await exists(root)) && !(await exists(path.join(root, ".libraos")))) {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(root));
      if (entries.length > 0) throw new Error(`${root} already exists and was not created by LibraOS; move it or choose another folder`);
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `LibraOS: getting “${e.title}”`, cancellable: false },
      async (progress) => {
        progress.report({ message: "checking GitHub" });
        let tree;
        try {
          tree = await fetchTree(e.repo, fetch as unknown as FetchFn);
        } catch (err) {
          // Offline, or rate-limited: an existing complete copy still works.
          if (covers(local, scope)) {
            this.output.appendLine(`[examples] using the local copy; GitHub check failed: ${(err as Error).message}`);
            return;
          }
          throw err;
        }
        const upToDate = local && local.treeSha === tree.sha && covers(local, scope);
        if (upToDate) return;

        if (local && local.treeSha !== tree.sha) {
          const choice = await vscode.window.showInformationMessage(
            `The LibraOS ${e.repo} has changed since your copy was made.`,
            {
              modal: true,
              detail: `Update ${root}? Files that come from GitHub are replaced, including any you changed. Your .env, .venv and files you added are kept.`,
            },
            "Update",
            "Keep My Copy",
          );
          if (choice !== "Update") {
            if (covers(local, scope)) return;
            throw new Error("this example is not in your copy yet; update the copy to get it");
          }
        }

        const files = selectFiles(tree, scope);
        if (files.length === 0) throw new Error(`nothing to download for ${e.dir}`);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root, ".libraos")));
        await downloadFiles(root, e.repo, files, fetch as unknown as FetchFn, {
          onProgress: (done, total) => progress.report({ message: `${done} of ${total} files` }),
        });
        const paths = scope === "all" ? ["*"] : [...new Set([...(local?.treeSha === tree.sha ? local.paths : []), ...scope])];
        await writeSource(root, { repo: e.repo, ref: "main", treeSha: tree.sha, fetchedAt: new Date().toISOString(), paths });
        this.output.appendLine(`[examples] downloaded ${files.length} files from libraos/${e.repo} into ${root}`);
      },
    );
  }

  private async ensurePython(e: Example, root: string, mode: "ask" | "yes" | "no"): Promise<boolean> {
    const platform = process.platform;
    if (await hasSdk(exec, root, platform)) {
      await writeInterpreterSetting(root, platform);
      return true;
    }
    if (mode === "no") return false;

    const py = await findPython(exec, platform);
    if (!py) {
      void vscode.window.showWarningMessage(
        "LibraOS: the examples need Python 3.10 or newer (3.12 is tested), and none was found. Install Python, then run Get Example again.",
      );
      return false;
    }
    const steps = setupSteps(root, py, platform, pythonRequirements(e, root, path.join), await exists(path.join(root, ".venv")));
    if (mode === "ask") {
      const choice = await vscode.window.showInformationMessage(
        "Set up Python for the LibraOS examples?",
        {
          modal: true,
          detail: [
            `This creates a virtual environment in ${path.join(root, ".venv")} with Python ${py.version} and installs the examples' pinned packages from PyPI:`,
            "",
            ...steps.map((s) => `  ${displayStep(s, root)}`),
            "",
            "VS Code's Run and Debug then use it for the examples. Nothing is installed outside that folder.",
          ].join("\n"),
        },
        "Set Up Python",
        "Skip",
      );
      if (choice !== "Set Up Python") return false;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "LibraOS: setting up Python for the examples", cancellable: false },
      async (progress) => {
        for (const s of steps) {
          progress.report({ message: s.label });
          this.output.appendLine(`[examples] $ ${displayStep(s, root)}`);
          try {
            const { stdout, stderr } = await exec(s.file, s.args, { cwd: root });
            if (stdout.trim()) this.output.appendLine(stdout.trim());
            if (stderr.trim()) this.output.appendLine(stderr.trim());
          } catch (err) {
            const x = err as Error & { stdout?: string; stderr?: string };
            this.output.appendLine(`${x.stdout ?? ""}\n${x.stderr ?? ""}`.trim());
            throw new Error(`${s.label} failed; see the LibraOS output for pip's message`);
          }
        }
      },
    );
    if (!(await hasSdk(exec, root, platform))) throw new Error("the Python environment was created but cannot import libraos");
    await writeInterpreterSetting(root, platform);
    return true;
  }

  // ── Opening ─────────────────────────────────────────────────────────────

  // The copy opens best as its own window: VS Code then uses its .venv for
  // Run and Debug, and its terminals do not get your project's LibraOS key.
  private async openWhere(e: Example, r: PrepareResult): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const here = folders.some((f) => path.resolve(f.uri.fsPath) === path.resolve(r.root));
    if (here) return this.openInWindow(e, r);

    const choice = folders.length
      ? await vscode.window.showInformationMessage(
          `“${e.title}” is ready in ${r.root}.`,
          {
            modal: true,
            detail:
              "Open the examples folder in a new window to run it there: VS Code uses the folder's Python environment for Run and Debug, and its terminals do not get your project's LibraOS key. Open Here keeps this window; the terminal command still uses the examples' Python environment.",
          },
          "Open in New Window",
          "Open Here",
        )
      : "Open in New Window";
    if (choice === "Open Here") return this.openInWindow(e, r);
    if (choice !== "Open in New Window") return;
    const pending: Pending = { root: r.root, id: e.id, variant: r.variant, at: Date.now() };
    await this.ctx.globalState.update(PENDING_KEY, pending);
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(r.root), { forceNewWindow: folders.length > 0 });
  }

  /** Opens the example's main file, its README beside it, and a terminal with the run command typed. */
  async openInWindow(e: Example, r: PrepareResult): Promise<void> {
    await vscode.window.showTextDocument(vscode.Uri.file(r.main), { preview: false });
    const readme = safeJoin(r.root, e.tutorial);
    if (await exists(readme)) await vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.file(readme));

    const terminal = vscode.window.createTerminal({ name: `LibraOS: ${e.title}`, cwd: r.runCwd });
    terminal.show();
    if (isPythonCommand(r.command) && !r.python) {
      terminal.sendText(`# Python is not set up for the examples yet: run “LibraOS: Get Example” again and choose Set Up Python.`, false);
      return;
    }
    // Typed, not run: the README lists what has to be in place first.
    terminal.sendText(runLine(r.command, r.python ?? "python", process.platform), false);

    // Cookbook examples read the local Runtime's settings from get-started/.env.
    // Without it the first run stops with a KeyError, so offer the template.
    const envFile = path.join(r.root, "get-started", ".env");
    const envTemplate = path.join(r.root, "get-started", ".env.example");
    const needsEnv = e.repo === "cookbook" && e.needs.includes("setupIdentity") && !(await exists(envFile)) && (await exists(envTemplate));
    const actions = needsEnv ? ["Create get-started/.env", "What It Needs"] : ["What It Needs"];
    const message = needsEnv
      ? `“${e.title}” is open. It runs against the cookbook's local Runtime, which reads get-started/.env, and that file does not exist yet.`
      : `“${e.title}” is open. The command is typed in the terminal; check the README's setup first.`;
    void vscode.window.showInformationMessage(message, ...actions).then(async (choice) => {
      if (choice === "What It Needs") await this.showCard(e.id);
      if (choice === "Create get-started/.env") await this.createEnv(envTemplate, envFile, r.root);
    });
  }

  // Copies the cookbook's template; the secrets in it are filled in by the
  // person. The file stays on this machine and the cookbook ignores it in Git.
  private async createEnv(template: string, target: string, root: string): Promise<void> {
    if (await exists(target)) return;
    await vscode.workspace.fs.copy(vscode.Uri.file(template), vscode.Uri.file(target), { overwrite: false });
    await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: false });
    const guide = path.join(root, "get-started", "README.md");
    void vscode.window
      .showInformationMessage(
        "Fill in get-started/.env: the JWT secret, the admin password, the quickstart secret and one model block. Then start the cookbook's Runtime with docker compose up -d in get-started (stop this extension's Runtime first; both use port 8900).",
        "Open Setup Steps",
      )
      .then((c) => c && vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(guide)));
  }

  /** In a window opened by Get Example, finish opening the example. */
  async resumePending(): Promise<void> {
    const p = this.ctx.globalState.get<Pending>(PENDING_KEY);
    if (!p || Date.now() - p.at > 10 * 60 * 1000) return;
    const folder = (vscode.workspace.workspaceFolders ?? []).find((f) => path.resolve(f.uri.fsPath) === path.resolve(p.root));
    const e = findExample(p.id);
    if (!folder || !e) return;
    await this.ctx.globalState.update(PENDING_KEY, undefined);
    const python = venvPython(p.root, process.platform);
    const v = variants(e).find((x) => x.label === p.variant) ?? variants(e)[0];
    await this.openInWindow(e, {
      root: p.root,
      main: safeJoin(p.root, v.main),
      runCwd: safeJoin(p.root, e.run.cwd),
      variant: v.label,
      command: v.command,
      python: isPythonCommand(v.command) && (await exists(python)) ? python : undefined,
    });
  }

  async setupGuide(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      "Cookbook setup or this extension's Runtime?",
      { modal: true, detail: SETUP_GUIDE },
      "Open Cookbook Setup",
      "Open Learning Paths",
    );
    if (choice === "Open Cookbook Setup") await openWeb(GUIDES.recipeSetup);
    if (choice === "Open Learning Paths") await openWeb(GUIDES.learningPaths);
  }
}

function idOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object" && "exampleId" in arg && typeof (arg as { exampleId: unknown }).exampleId === "string")
    return (arg as { exampleId: string }).exampleId;
  return undefined;
}

export interface ExamplesApi {
  prepare(id: string, opts: PrepareOptions): Promise<PrepareResult | undefined>;
  open(id: string, r: PrepareResult): Promise<void>;
}

export function registerExampleCommands(ctx: vscode.ExtensionContext, output: vscode.OutputChannel): ExamplesApi {
  const x = new Examples(ctx, output);
  const reg = (id: string, fn: (...args: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("libraos.browseExamples", () => x.browse());
  // Clicking an example in the sidebar gets it; the inline buttons and the
  // Command Palette reach the rest. From inline buttons the argument is the
  // tree item, which carries the example id.
  reg("libraos.openExample", (arg?: unknown) => x.getExample(idOf(arg)));
  reg("libraos.getExample", (arg?: unknown) => x.getExample(idOf(arg)));
  reg("libraos.showExampleNeeds", async (arg?: unknown) => {
    const e = await x.resolve(idOf(arg));
    if (e) await x.showCard(e.id);
  });
  reg("libraos.openExampleTutorial", async (arg?: unknown) => {
    const e = await x.resolve(idOf(arg));
    if (e) await openWeb(tutorialUrl(e));
  });
  reg("libraos.viewExampleSource", (arg?: unknown) => x.viewOnGitHub(idOf(arg)));
  reg("libraos.cookbookSetupGuide", () => x.setupGuide());
  reg("libraos.openLearningPaths", () => openWeb(GUIDES.learningPaths));
  void x.resumePending();
  return {
    prepare: (id, opts) => {
      const e = findExample(id);
      if (!e) throw new Error(`unknown example ${id}`);
      return x.prepare(e, opts);
    },
    open: (id, r) => {
      const e = findExample(id);
      if (!e) throw new Error(`unknown example ${id}`);
      return x.openInWindow(e, r);
    },
  };
}
