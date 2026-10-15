import * as vscode from "vscode";
import type { RuntimeManager } from "../runtime/manager";
import { EXAMPLES } from "../examples/catalog";

type Node = vscode.TreeItem & { children?: Node[] };

function section(label: string, icon: string, children: Node[]): Node {
  const n: Node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  n.iconPath = new vscode.ThemeIcon(icon);
  n.children = children;
  return n;
}

function info(label: string, description: string, icon: string, tooltip?: string): Node {
  const n: Node = new vscode.TreeItem(label);
  n.description = description;
  n.iconPath = new vscode.ThemeIcon(icon);
  n.tooltip = tooltip;
  return n;
}

function action(label: string, command: string, icon: string, args: unknown[] = [], description?: string): Node {
  const n: Node = new vscode.TreeItem(label);
  n.command = { command, title: label, arguments: args };
  n.iconPath = new vscode.ThemeIcon(icon);
  n.description = description;
  return n;
}

export interface ProjectState {
  initialized: boolean;
  hasKey: boolean;
}

export class WorkspaceTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly runtime: RuntimeManager,
    private readonly project: () => Promise<ProjectState>,
  ) {
    runtime.onDidChange(() => this.changed.fire());
  }

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(n: Node): vscode.TreeItem {
    return n;
  }

  async getChildren(n?: Node): Promise<Node[]> {
    if (n) return n.children ?? [];
    const rt = this.runtime;
    const s = rt.settings();
    const proj = await this.project();

    const statusLabel: Record<string, [string, string]> = {
      "not-installed": ["Not installed", "circle-outline"],
      stopped: ["Stopped", "circle-outline"],
      starting: ["Starting…", "loading~spin"],
      running: [`Running${rt.version ? ` (${rt.version})` : ""}`, "pass-filled"],
    };
    const [stLabel, stIcon] = statusLabel[rt.status];

    const runtimeChildren: Node[] = [
      info("Status", stLabel, stIcon, rt.status === "running" ? rt.baseUrl : undefined),
      action("Model", "libraos.configureModel", "hubot", [], `${s.modelName}`),
    ];
    if (rt.status === "not-installed") runtimeChildren.push(action("Install Runtime", "libraos.installRuntime", "cloud-download"));
    else if (rt.status === "running") runtimeChildren.push(action("Stop Local Runtime", "libraos.stopRuntime", "debug-stop"));
    else if (rt.status === "stopped") runtimeChildren.push(action("Run Local Runtime", "libraos.startRuntime", "play"));
    runtimeChildren.push(action("Logs", "libraos.showLogs", "output"));

    const projectChildren: Node[] = proj.initialized
      ? [
          info("Initialized", "libraos.json", "check"),
          proj.hasKey
            ? action("Copy Project API Key", "libraos.copyApiKey", "key")
            : info("API key", "not minted: run the runtime, then Initialize again", "warning"),
        ]
      : [action("Initialize LibraOS Project", "libraos.initProject", "add")];

    return [
      section("Developer", "account", [
        action("Developer account", "libraos.signIn", "account", [], "Preview: not signed in"),
        info("Welcome Credits", "$10 offer, after sign-in", "gift"),
        info("License", "Not connected", "law"),
        action("Open Console", "libraos.openConsole", "link-external"),
      ]),
      section("Runtime", "server-process", runtimeChildren),
      section("Project", "folder", projectChildren),
      section(
        "Examples",
        "book",
        EXAMPLES.map((e) => action(e.title, "libraos.openExample", "file-code", [e.id], e.description)),
      ),
      action("Cloud Deployment", "libraos.cloudDeploy", "cloud-upload", [], "Coming Soon"),
    ];
  }
}
