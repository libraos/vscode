import * as vscode from "vscode";
import {
  agentsBoundTo,
  bindingViews,
  callSummaryText,
  type AgentDetail,
  type AgentSummary,
  type Collection,
  type ExplorerClient,
} from "./client";

// The Runtime Explorer: what the local runtime holds right now. Agents with
// their bound collections, call stats and memory; collections with their
// documents and the agents bound to them. Read-only.

export type ExplorerNode = vscode.TreeItem & {
  load?: () => Promise<ExplorerNode[]>;
  agentId?: string;
  collectionId?: string;
};

function item(label: string, opts: Partial<ExplorerNode> & { icon?: string } = {}): ExplorerNode {
  const n: ExplorerNode = new vscode.TreeItem(label, opts.load ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
  const { icon, ...rest } = opts;
  Object.assign(n, rest);
  if (icon) n.iconPath = new vscode.ThemeIcon(icon);
  return n;
}

export interface ExplorerState {
  /** Why the explorer cannot read the runtime, or undefined when it can. */
  unavailable(): string | undefined;
}

export class ExplorerTree implements vscode.TreeDataProvider<ExplorerNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  // One snapshot per refresh, so Agents and Knowledge agree with each other.
  private snapshot?: Promise<{ agents: AgentSummary[]; details: Map<string, AgentDetail>; collections: Collection[] }>;

  constructor(
    private readonly client: () => ExplorerClient | undefined,
    private readonly state: ExplorerState,
  ) {}

  refresh(): void {
    this.snapshot = undefined;
    this.changed.fire();
  }

  getTreeItem(n: ExplorerNode): vscode.TreeItem {
    return n;
  }

  async getChildren(n?: ExplorerNode): Promise<ExplorerNode[]> {
    if (n?.load) {
      try {
        return await n.load();
      } catch (err) {
        return [item(`Could not load: ${(err as Error).message}`, { icon: "warning" })];
      }
    }
    if (n) return [];
    const why = this.state.unavailable();
    if (why) return [item(why, { icon: "info" })];
    const c = this.client();
    if (!c) return [item("The local runtime is not available.", { icon: "info" })];
    let snap;
    try {
      snap = await this.load(c);
    } catch (err) {
      if (/no setup token/.test((err as Error).message)) {
        return [
          item("Enable the explorer", {
            icon: "key",
            description: "restarts the Runtime once; data is kept",
            tooltip: "The explorer reads the runtime with a setup token. A runtime started by an earlier version of the extension needs one restart to provide it.",
            command: { command: "libraos.explorer.enable", title: "Enable the explorer" },
          }),
        ];
      }
      return [item(`Could not read the runtime: ${(err as Error).message}`, { icon: "warning", tooltip: String(err) })];
    }
    return [
      item("Agents", {
        icon: "hubot",
        description: String(snap.agents.length),
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        load: async () => snap.agents.map((a) => this.agentNode(c, a, snap.details.get(a.id), snap.collections)),
      }),
      item("Knowledge", {
        icon: "database",
        description: String(snap.collections.length),
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        load: async () =>
          snap.collections.length
            ? snap.collections.map((col) => this.collectionNode(col, [...snap.details.values()]))
            : [item("No collections yet. Ingest documents to create one.", { icon: "info" })],
      }),
    ];
  }

  private load(c: ExplorerClient) {
    this.snapshot ??= (async () => {
      const [agents, collections] = await Promise.all([c.agents(), c.collections()]);
      // The list omits bindings and tool scope (libraos/libraos#1735), so read
      // each agent once per refresh.
      const details = new Map<string, AgentDetail>();
      await Promise.all(
        agents.map(async (a) => {
          try {
            details.set(a.id, await c.agent(a.id));
          } catch {
            // keep the summary; the node shows what it has
          }
        }),
      );
      return { agents, details, collections };
    })();
    return this.snapshot;
  }

  private agentNode(c: ExplorerClient, a: AgentSummary, d: AgentDetail | undefined, collections: Collection[]): ExplorerNode {
    const bindings = d ? bindingViews(d, collections) : [];
    const missing = bindings.filter((b) => !b.exists).length;
    return item(a.id, {
      icon: missing ? "warning" : "hubot",
      description: [a.agent_type, a.model && a.model !== "none" ? a.model : undefined, bindings.length ? `${bindings.length} KB` : undefined].filter(Boolean).join(" · "),
      tooltip: new vscode.MarkdownString(
        [`**${a.name || a.id}**`, a.agent_type ? `Type: ${a.agent_type}` : "", a.model ? `Model: ${a.model}` : "", d?.tool_scope ? `Tool scope: ${d.tool_scope}` : "", a.version ? `Version: ${a.version}` : ""]
          .filter(Boolean)
          .join("  \n"),
      ),
      contextValue: "libraos.explorer.agent",
      agentId: a.id,
      load: async () => {
        const rows: ExplorerNode[] = [];
        rows.push(
          item("Knowledge", {
            icon: "database",
            description: bindings.length ? `${bindings.length} bound` : "none bound",
            load: async () =>
              bindings.length
                ? bindings.map((b) =>
                    item(b.id, {
                      icon: b.exists ? "database" : "warning",
                      description: b.exists ? `${b.collection?.document_count ?? 0} docs · ${b.collection?.chunk_count ?? 0} chunks` : "not in the runtime's collections",
                      tooltip: b.exists ? undefined : "The agent names this collection, but the runtime has no collection with this id. Ingest into it, or fix the binding.",
                      contextValue: b.exists ? "libraos.explorer.collection" : undefined,
                      collectionId: b.exists ? b.id : undefined,
                    }),
                  )
                : [item("No collections bound. A binding to a collection that does not exist yet is dropped silently (libraos/libraos#615).", { icon: "info" })],
          }),
        );
        if (d?.tool_scope) rows.push(item("Tool scope", { icon: "tools", description: d.tool_scope }));
        const [calls, memory] = await Promise.allSettled([c.callSummary(a.id), c.memoryHealth(a.id)]);
        rows.push(
          item("Calls", {
            icon: calls.status === "fulfilled" && calls.value.error_count ? "error" : "pulse",
            description: calls.status === "fulfilled" ? callSummaryText(calls.value) : "unavailable",
          }),
        );
        rows.push(
          item("Memory", {
            icon: "history",
            description:
              memory.status === "fulfilled"
                ? `${memory.value.status ?? "unknown"}${typeof memory.value.total_entries === "number" ? ` · ${memory.value.total_entries} entries` : ""}`
                : "unavailable",
          }),
        );
        return rows;
      },
    });
  }

  private collectionNode(col: Collection, agents: AgentDetail[]): ExplorerNode {
    const bound = agentsBoundTo(col, agents);
    return item(col.name || col.id, {
      icon: "database",
      description: `${col.document_count ?? 0} docs · ${col.chunk_count ?? 0} chunks${bound.length ? ` · ${bound.length} agent${bound.length === 1 ? "" : "s"}` : ""}`,
      tooltip: new vscode.MarkdownString([`**${col.name || col.id}**`, col.description ?? "", col.access_level ? `Access: ${col.access_level}` : ""].filter(Boolean).join("  \n")),
      contextValue: "libraos.explorer.collection",
      collectionId: col.id,
      load: async () =>
        bound.length
          ? bound.map((id) => item(id, { icon: "hubot", description: "bound agent", agentId: id, contextValue: "libraos.explorer.agentRef" }))
          : [item("No agents bound", { icon: "info" })],
    });
  }
}
