import * as vscode from "vscode";
import { SETUP_CLIENT_ID } from "./compose";
import { RuntimeApiError, SetupClientMissing, setupToken, type SetupToken } from "./api";
import type { RuntimeManager } from "./manager";
import type { Secrets } from "../secrets";

// A setup token is an admin token for the local runtime, minted by its
// laptop-only setup client and valid for the runtime's access-token lifetime
// (1 hour by default). The cookbook's examples need one to create agents and
// ingest knowledge, which the project API key cannot do.
//
// Terminals carry it as LIBRA_OS_SETUP_TOKEN. The extension's own terminal
// environment sets LIBRA_OS_API_KEY to the project key in project windows and
// takes precedence over a terminal's env, so commands map the token to
// LIBRA_OS_API_KEY for one run instead of relying on that variable.
export const SETUP_TOKEN_ENV = "LIBRA_OS_SETUP_TOKEN";

/** A command line that runs `command` with the setup token as LIBRA_OS_API_KEY. */
export function withSetupToken(command: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return `$env:LIBRA_OS_API_KEY=$env:${SETUP_TOKEN_ENV}; ${command}`;
  return `LIBRA_OS_API_KEY="$${SETUP_TOKEN_ENV}" ${command}`;
}

export function untilLabel(expiresAt: number): string {
  return new Date(expiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const WARNING =
  "It is an admin token for the Runtime on this machine: it can create and delete agents, users and data there. It expires after an hour. Keep it on this machine; don't paste it into an app, a commit or a chat.";

export class SetupTokens {
  constructor(
    private readonly runtime: RuntimeManager,
    private readonly secrets: Secrets,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** A fresh token, or undefined after telling the person why there is none. */
  async get(): Promise<SetupToken | undefined> {
    if (this.runtime.status !== "running" || !(await this.secrets.hasRuntime())) {
      const pick = await vscode.window.showWarningMessage(
        "LibraOS: a setup token comes from the Runtime this extension manages, and it is not running.",
        this.runtime.status === "not-installed" ? "Install Runtime" : "Run Local Runtime",
      );
      if (pick === "Install Runtime") await vscode.commands.executeCommand("libraos.installRuntime");
      if (pick === "Run Local Runtime") await vscode.commands.executeCommand("libraos.startRuntime");
      return undefined;
    }
    const rs = await this.secrets.runtime();
    try {
      return await setupToken(this.runtime.baseUrl, SETUP_CLIENT_ID, rs.setupClientSecret);
    } catch (err) {
      if (err instanceof SetupClientMissing) {
        // Runtimes started by an older extension version have no setup client;
        // it is added when the runtime restarts with the current compose file.
        const pick = await vscode.window.showWarningMessage(
          "LibraOS: the running Runtime was started before setup tokens were available. Restart it to add them; its data is kept.",
          "Restart Runtime",
        );
        if (pick === "Restart Runtime") {
          await vscode.commands.executeCommand("libraos.stopRuntime");
          await vscode.commands.executeCommand("libraos.startRuntime");
          if (this.runtime.status === "running") return setupToken(this.runtime.baseUrl, SETUP_CLIENT_ID, rs.setupClientSecret);
        }
        return undefined;
      }
      this.output.appendLine(`[setup token] ${String(err)}`);
      void vscode.window.showErrorMessage(`LibraOS: could not get a setup token: ${err instanceof RuntimeApiError ? err.message : String(err)}`);
      return undefined;
    }
  }

  /** A terminal with LIBRA_OS_URL and the token, and optionally a command typed (not run). */
  terminal(token: SetupToken, opts: { name: string; cwd?: string; command?: string }): vscode.Terminal {
    const t = vscode.window.createTerminal({
      name: `${opts.name} (setup token until ${untilLabel(token.expiresAt)})`,
      cwd: opts.cwd,
      env: { LIBRA_OS_URL: this.runtime.baseUrl, [SETUP_TOKEN_ENV]: token.token },
    });
    t.show();
    if (opts.command) t.sendText(withSetupToken(opts.command, process.platform), false);
    return t;
  }

  // "Copy Setup Token": explains what the token is, then opens a terminal
  // with it (recommended) or copies it.
  async command(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Get a setup token for the local Runtime?",
      {
        modal: true,
        detail: [
          "Cookbook examples create agents and ingest documents. Your project API key cannot do that; a setup token can.",
          "",
          WARNING,
          "",
          `Open Terminal puts it in ${SETUP_TOKEN_ENV} for that terminal only. Run a command with it as LIBRA_OS_API_KEY="$${SETUP_TOKEN_ENV}" <command>.`,
        ].join("\n"),
      },
      "Open Terminal",
      "Copy to Clipboard",
    );
    if (!choice) return;
    const token = await this.get();
    if (!token) return;
    if (choice === "Open Terminal") {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      this.terminal(token, { name: "LibraOS", cwd: folder });
      void vscode.window.showInformationMessage(
        `Setup token ready in the new terminal until ${untilLabel(token.expiresAt)}. Run a command with it: LIBRA_OS_API_KEY="$${SETUP_TOKEN_ENV}" python first-agent.py`,
      );
      return;
    }
    await vscode.env.clipboard.writeText(token.token);
    void vscode.window.showInformationMessage(`Setup token copied. It works until ${untilLabel(token.expiresAt)}. Don't commit or share it.`);
  }
}
