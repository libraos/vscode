import * as vscode from "vscode";
import type { RuntimeManager } from "../runtime/manager";
import { PATHS, badge, examplesFor, type Example, type PathId } from "../examples/catalog";
import { developerRows, type DeveloperState, type Row } from "./developer";

type Node = vscode.TreeItem & { children?: Node[]; arg?: unknown };

const PATH_ICON: Record<PathId, string> = { learn: "mortar-board", capability: "extensions", apps: "window", sdk: "package" };

function group(label: string, icon: string, tooltip: string, children: Node[]): Node {
  const n: Node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  n.iconPath = new vscode.ThemeIcon(icon);
  n.tooltip = tooltip;
  n.children = children;
  return n;
}

// Clicking an example gets it: downloads it, sets up Python and opens it.
// The inline buttons show what it needs, its tutorial and its GitHub source.
function exampleNode(e: Example, path: PathId): Node {
  const n = action(e.title, "libraos.openExample", "cloud-download", [e.id], badge(e, path)) as Node & {
    exampleId: string;
  };
  n.exampleId = e.id;
  n.tooltip = `${e.description}\n\nClick to download it, set it up and open it in VS Code.`;
  n.contextValue = "libraos.example";
  n.id = `example:${path}:${e.id}`;
  return n;
}

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

function fromRow(r: Row): Node {
  const n: Node = new vscode.TreeItem(
    r.label,
    r.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
  );
  if (r.children) n.children = r.children.map(fromRow);
  n.contextValue = r.contextValue;
  n.arg = r.arg;
  n.description = r.description;
  n.iconPath = new vscode.ThemeIcon(r.icon);
  n.tooltip = r.tooltip;
  if (r.command) n.command = { command: r.command.id, title: r.label, arguments: r.command.args };
  else if (r.link) n.command = { command: "vscode.open", title: r.label, arguments: [vscode.Uri.parse(r.link)] };
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
    private readonly developer: () => DeveloperState,
    /** Whether a Get Example folder is open, and whether its Run and Debug use this Runtime. */
    private readonly examples: () => Promise<{ open: boolean; useRuntime: boolean }> = async () => ({ open: false, useRuntime: false }),
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
      action("Embeddings", "libraos.configureEmbeddings", "symbol-array", [], s.embeddingModel ? `${s.embeddingModel}` : "model endpoint default"),
    ];
    if (rt.status === "not-installed") runtimeChildren.push(action("Install Runtime", "libraos.installRuntime", "cloud-download"));
    else if (rt.status === "running") {
      runtimeChildren.push(action("Stop Local Runtime", "libraos.stopRuntime", "debug-stop"));
      runtimeChildren.push(action("Runtime Log", "libraos.showRuntimeLog", "pulse", [], "live, in a terminal"));
      runtimeChildren.push(action("Copy Setup Token", "libraos.copySetupToken", "key", [], "for cookbook examples, 1 h"));
    }
    else if (rt.status === "stopped") runtimeChildren.push(action("Run Local Runtime", "libraos.startRuntime", "play"));
    runtimeChildren.push(action("Logs", "libraos.showLogs", "output"));
    const ex = await this.examples();
    if (ex.open) {
      runtimeChildren.push(
        ex.useRuntime
          ? action("Examples' Run and Debug", "libraos.toggleExamplesRuntime", "debug-alt", [], rt.status === "running" ? "use this Runtime (click to stop)" : "use this Runtime when it runs")
          : action("Examples' Run and Debug", "libraos.toggleExamplesRuntime", "debug-alt", [], "off: click to use this Runtime"),
      );
    }

    const projectChildren: Node[] = proj.initialized
      ? [
          info("Initialized", "libraos.json", "check"),
          proj.hasKey
            ? action("Copy Project API Key", "libraos.copyApiKey", "key")
            : info("API key", "not minted: run the runtime, then Initialize again", "warning"),
        ]
      : [action("Initialize LibraOS Project", "libraos.initProject", "add")];

    return [
      section("Developer", "account", developerRows(this.developer()).map(fromRow)),
      section("Runtime", "server-process", runtimeChildren),
      section("Project", "folder", projectChildren),
      section("Examples", "book", [
        ...PATHS.map((p) => group(p.label, PATH_ICON[p.id], p.detail, examplesFor(p.id).map((e) => exampleNode(e, p.id)))),
        action("Learning Paths", "libraos.openLearningPaths", "map", [], "cookbook guide"),
        action("Cookbook Setup or This Runtime?", "libraos.cookbookSetupGuide", "server-environment"),
      ]),
      action("Cloud Deployment", "libraos.cloudDeploy", "cloud-upload", [], "Coming Soon"),
    ];
  }
}
