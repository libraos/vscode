import * as vscode from "vscode";
import { collapseCallRows, formatLogRow, logKey, type ExplorerClient, type LogRow } from "./client";

// "LibraOS: Runtime Log": a terminal that follows the local runtime while an
// app runs. Each agent or model call appears as a CALL line with its agent,
// model, latency and tokens; server warnings and errors appear in between.
// It reads /v1/managed/logs (admin) with a setup token; nothing is written.

const POLL_MS = 1500;

export interface LogTerminalOptions {
  /** Server log level to show: warn by default, so calls are not drowned out. */
  serverLevel: "debug" | "info" | "warn" | "error";
}

export function openRuntimeLog(client: () => ExplorerClient | undefined, opts: LogTerminalOptions): vscode.Terminal {
  const write = new vscode.EventEmitter<string>();
  const seen = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let since = new Date(Date.now() - 2 * 60_000).toISOString(); // the last two minutes, then follow
  let lastError = "";
  let paused = false;

  const line = (s: string) => write.fire(s.replace(/\n/g, "\r\n") + "\r\n");

  const poll = async () => {
    if (paused) return;
    const c = client();
    if (!c) {
      report("The local runtime is not running. Waiting for it…");
      return;
    }
    try {
      const pollStart = new Date().toISOString();
      // source=requests (one row per agent or model call) needs PostgreSQL,
      // which the extension's runtime has.
      const [calls, server] = await Promise.all([
        c.logs({ source: "requests", since, limit: 200 }),
        c.logs({ source: "server", since, limit: 200, level: opts.serverLevel }),
      ]);
      const rows: { row: LogRow; source: "server" | "requests" }[] = [
        ...collapseCallRows(calls).map((row) => ({ row, source: "requests" as const })),
        ...server.map((row) => ({ row, source: "server" as const })),
      ].sort((a, b) => a.row.ts.localeCompare(b.row.ts));
      for (const { row, source } of rows) {
        const k = logKey(row, source);
        if (seen.has(k)) continue;
        seen.add(k);
        line(formatLogRow(row, source));
      }
      if (seen.size > 5000) seen.clear(); // bounded; the since window prevents repeats in practice
      // Overlap polls by a few seconds so rows stamped late are not missed.
      since = new Date(Date.parse(pollStart) - 5000).toISOString();
      lastError = "";
    } catch (err) {
      report(`Could not read the runtime log: ${(err as Error).message}`);
    }
  };

  const report = (msg: string) => {
    if (msg === lastError) return;
    lastError = msg;
    line(`\x1b[33m${msg}\x1b[0m`);
  };

  const pty: vscode.Pseudoterminal = {
    onDidWrite: write.event,
    open: () => {
      line("\x1b[1mLibraOS runtime log\x1b[0m: calls to agents and models, and server warnings and errors.");
      line("\x1b[90mRun your app or an example; its calls appear here. Press p to pause, c to clear, Ctrl+C to close.\x1b[0m");
      void poll();
      timer = setInterval(() => void poll(), POLL_MS);
    },
    close: () => {
      if (timer) clearInterval(timer);
    },
    handleInput: (data) => {
      if (data === "\x03") {
        if (timer) clearInterval(timer);
        terminal.dispose();
      } else if (data === "p") {
        paused = !paused;
        line(paused ? "\x1b[90m— paused (p to resume) —\x1b[0m" : "\x1b[90m— resumed —\x1b[0m");
      } else if (data === "c") {
        write.fire("\x1b[2J\x1b[3J\x1b[H");
      }
    },
  };
  const terminal = vscode.window.createTerminal({ name: "LibraOS: Runtime Log", pty, iconPath: new vscode.ThemeIcon("pulse") });
  terminal.show(true);
  return terminal;
}
