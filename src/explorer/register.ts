import * as vscode from "vscode";
import { ExplorerClient, retrieveMarkdown } from "./client";
import { ExplorerTree, type ExplorerNode } from "./tree";
import { openRuntimeLog } from "./logTerminal";
import type { RuntimeManager } from "../runtime/manager";
import type { SetupTokens } from "../runtime/setupToken";
import type { SetupToken } from "../runtime/api";

const SCHEME = "libraos-runtime";
const REFRESH_MS = 15_000;

// Wires the Runtime Explorer view, its commands and the runtime log terminal.
// Everything reads the runtime this extension manages, with a setup token that
// is kept in memory and replaced five minutes before it expires.
export function registerExplorer(ctx: vscode.ExtensionContext, runtime: RuntimeManager, tokens: SetupTokens): ExplorerTree {
  let token: SetupToken | undefined;
  let tokenMissing = false;
  const currentToken = async () => {
    if (!token || token.expiresAt - Date.now() < 5 * 60_000) {
      token = await tokens.quiet();
      tokenMissing = !token;
    }
    return token?.token;
  };
  const client = () => (runtime.status === "running" ? new ExplorerClient(runtime.baseUrl, currentToken) : undefined);

  const tree = new ExplorerTree(client, {
    unavailable: () => {
      if (runtime.status !== "running") return "Run the local Runtime to see its agents and knowledge.";
      if (tokenMissing) return "Restart the Runtime to enable the explorer: run “LibraOS: Enable Runtime Explorer”.";
      return undefined;
    },
  });
  const view = vscode.window.createTreeView("libraos.explorer", { treeDataProvider: tree, showCollapseAll: true });

  // Read-only documents: agent definitions and retrieval results.
  const docs = new Map<string, string>();
  const changed = new vscode.EventEmitter<vscode.Uri>();
  const show = async (path: string, content: string, language: string) => {
    const uri = vscode.Uri.from({ scheme: SCHEME, path });
    docs.set(uri.toString(), content);
    changed.fire(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, language);
    if (language === "markdown") await vscode.commands.executeCommand("markdown.showPreview", uri);
    else await vscode.window.showTextDocument(doc, { preview: true });
  };

  const refresh = () => tree.refresh();
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (timer) clearInterval(timer);
    timer = view.visible && runtime.status === "running" ? setInterval(refresh, REFRESH_MS) : undefined;
  };
  let last = runtime.status;
  runtime.onDidChange(() => {
    if (runtime.status === last) return;
    last = runtime.status;
    token = undefined;
    tokenMissing = false;
    refresh();
    schedule();
  });

  const reg = (id: string, fn: (...a: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("libraos.explorer.refresh", refresh);
  reg("libraos.explorer.enable", async () => {
    // tokens.get() explains a stopped runtime, or offers the restart that adds the setup client.
    token = await tokens.get();
    tokenMissing = !token;
    refresh();
  });
  reg("libraos.explorer.openAgent", async (n?: ExplorerNode | string) => {
    const id = typeof n === "string" ? n : n?.agentId;
    const c = client();
    if (!id || !c) return;
    try {
      const agent = await c.agent(id);
      await show(`/agents/${id}.json`, JSON.stringify(agent, null, 2) + "\n", "json");
    } catch (err) {
      void vscode.window.showErrorMessage(`LibraOS: could not read agent ${id}: ${(err as Error).message}`);
    }
  });
  reg("libraos.explorer.debugRetrieve", async (n?: ExplorerNode) => {
    const c = client();
    if (!c) {
      void vscode.window.showWarningMessage("LibraOS: run the local Runtime first.");
      return;
    }
    const collection = n?.collectionId;
    const query = await vscode.window.showInputBox({
      title: collection ? `Debug retrieval in ${collection}` : "Debug retrieval across all collections",
      prompt: "A question an agent might get. Shows the chunks the runtime would retrieve, stage by stage.",
      ignoreFocusOut: true,
    });
    if (!query) return;
    try {
      const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "LibraOS: retrieving" }, () =>
        c.debugRetrieve(query, collection ? [collection] : undefined),
      );
      await show(`/retrieval/${Date.now()}.md`, retrieveMarkdown(r), "markdown");
    } catch (err) {
      void vscode.window.showErrorMessage(`LibraOS: retrieval failed: ${(err as Error).message}`);
    }
  });
  reg("libraos.showRuntimeLog", () => {
    const level = vscode.workspace.getConfiguration("libraos").get<"debug" | "info" | "warn" | "error">("runtimeLog.serverLevel", "warn");
    openRuntimeLog(client, { serverLevel: level });
  });

  ctx.subscriptions.push(
    view,
    view.onDidChangeVisibility(() => {
      schedule();
      if (view.visible) refresh();
    }),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { onDidChange: changed.event, provideTextDocumentContent: (uri) => docs.get(uri.toString()) ?? "" }),
    { dispose: () => timer && clearInterval(timer) },
  );
  return tree;
}
