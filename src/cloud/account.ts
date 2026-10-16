import * as vscode from "vscode";
import type { Secrets, StoredSession } from "../secrets";
import {
  CloudError,
  consoleOrigin,
  DeviceFlowError,
  getTerms,
  grantDeveloperLicence,
  listLicences,
  pollDeviceToken,
  requestDeviceCode,
  UnauthorizedError,
  type Terms,
} from "./client";
import { accountLabel, licenceSummary, type DeveloperState, type LicenceState } from "../views/developer";

const DEFAULT_CONSOLE = "https://console.libraos.com";

export function consoleUrl(): string {
  return vscode.workspace.getConfiguration("libraos").get<string>("consoleUrl", DEFAULT_CONSOLE) || DEFAULT_CONSOLE;
}

// Opens only web links: a server-supplied URL must not launch anything else.
function openWeb(url: string): Thenable<boolean> | undefined {
  const u = vscode.Uri.parse(url);
  return u.scheme === "https" || u.scheme === "http" ? vscode.env.openExternal(u) : undefined;
}

// The developer account: device sign-in, the session, and its licences.
// The session token lives only in SecretStorage and is sent only to the
// Console origin that issued it.
export class CloudAccount {
  private current: DeveloperState = { signedIn: false };
  private signingIn = false;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly secrets: Secrets,
    private readonly output: vscode.OutputChannel,
  ) {}

  get state(): DeveloperState {
    return this.current;
  }

  private set(s: DeveloperState): void {
    this.current = s;
    this.changed.fire();
  }

  // The stored session, if it is for the configured Console and has not
  // expired. An expired one is deleted.
  private async session(): Promise<StoredSession | undefined> {
    const s = await this.secrets.cloudSession();
    if (!s) return undefined;
    let origin: string;
    try {
      origin = consoleOrigin(consoleUrl());
    } catch {
      return undefined;
    }
    if (s.origin !== origin) return undefined;
    if (Date.now() >= s.expiresAt) {
      await this.endSession(true);
      return undefined;
    }
    return s;
  }

  private async endSession(notify: boolean): Promise<void> {
    await this.secrets.setCloudSession(undefined);
    this.set({ signedIn: false });
    if (notify) {
      void vscode.window
        .showWarningMessage("Your LibraOS session ended, so you are signed out.", "Sign In")
        .then((r) => r && vscode.commands.executeCommand("libraos.signIn"));
    }
  }

  async refresh(): Promise<void> {
    const s = await this.session();
    if (!s) {
      if (this.current.signedIn) this.set({ signedIn: false });
      return;
    }
    const who = { signedIn: true as const, email: s.email, workspace: s.workspace };
    if (!this.current.signedIn) this.set({ ...who, licence: { kind: "loading" } });
    let licence: LicenceState;
    try {
      licence = { kind: "loaded", licences: await listLicences(s.origin, s.token) };
    } catch (err) {
      if (err instanceof UnauthorizedError) return this.endSession(true);
      if (err instanceof CloudError && err.status === 501) licence = { kind: "unavailable" };
      else {
        this.output.appendLine(`Loading licences failed: ${String((err as Error).message ?? err)}`);
        licence = { kind: "error", message: String((err as Error).message ?? err) };
      }
    }
    this.set({ ...who, licence });
  }

  async signIn(): Promise<void> {
    if (this.signingIn) {
      void vscode.window.showInformationMessage("A LibraOS sign-in is already in progress.");
      return;
    }
    const existing = await this.session();
    if (existing) {
      const r = await vscode.window.showInformationMessage(
        `Signed in to LibraOS as ${accountLabel({ signedIn: true, ...existing, licence: { kind: "loading" } }) ?? "your account"}.`,
        "Sign Out",
      );
      if (r) await this.signOut();
      return;
    }
    let origin: string;
    try {
      origin = consoleOrigin(consoleUrl());
    } catch (err) {
      void vscode.window.showErrorMessage(`LibraOS: ${(err as Error).message}`);
      return;
    }

    this.signingIn = true;
    try {
      const code = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "LibraOS: requesting a sign-in code" },
        () => requestDeviceCode(origin),
      );
      const page = code.verificationUriComplete ?? code.verificationUri;
      try {
        consoleOrigin(page); // https, or http on loopback only
      } catch {
        throw new CloudError("the Console returned an unusable sign-in page address");
      }
      const minutes = Math.max(1, Math.round(code.expiresIn / 60));
      const go = await vscode.window.showInformationMessage(
        `Sign in to LibraOS with code ${code.userCode}`,
        {
          modal: true,
          detail: [
            `Your browser opens ${code.verificationUri} with this code filled in. Enter your account email there; LibraOS emails you a link, and approving it signs VS Code in.`,
            "",
            `Check that the page shows ${code.userCode}. The code expires in ${minutes} minutes and is copied to your clipboard.`,
            "",
            "VS Code never asks for or sees a password.",
          ].join("\n"),
        },
        "Open Sign-in Page",
      );
      if (go !== "Open Sign-in Page") return;
      await vscode.env.clipboard.writeText(code.userCode);
      await openWeb(page);

      const session = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `LibraOS: waiting for you to approve code ${code.userCode}`,
          cancellable: true,
        },
        (progress, token) => {
          progress.report({ message: "check your email for the approval link" });
          const abort = new AbortController();
          token.onCancellationRequested(() => abort.abort());
          return pollDeviceToken(origin, code, { signal: abort.signal });
        },
      );
      await this.secrets.setCloudSession({ origin, ...session });
      this.set({ signedIn: true, email: session.email, workspace: session.workspace, licence: { kind: "loading" } });
      void vscode.window.showInformationMessage(
        `Signed in to LibraOS${session.email ? ` as ${session.email}` : ""}.`,
      );
      await this.refresh();
    } catch (err) {
      if (err instanceof DeviceFlowError) {
        if (err.reason === "cancelled") return;
        if (err.reason === "denied") {
          void vscode.window.showWarningMessage("LibraOS sign-in was denied.");
          return;
        }
        const r = await vscode.window.showWarningMessage("The LibraOS sign-in code expired before it was approved.", "Sign In Again");
        if (r) void vscode.commands.executeCommand("libraos.signIn");
        return;
      }
      this.output.appendLine(`Sign-in failed: ${(err as Error).message ?? String(err)}`);
      void vscode.window.showErrorMessage(`LibraOS sign-in failed: ${(err as Error).message ?? String(err)}`);
    } finally {
      this.signingIn = false;
    }
  }

  async signOut(): Promise<void> {
    await this.endSession(false);
    void vscode.window.showInformationMessage("Signed out of LibraOS.");
  }

  async claimLicence(): Promise<void> {
    const s = await this.session();
    if (!s) {
      const r = await vscode.window.showInformationMessage("Sign in to claim the Developer Licence.", "Sign In");
      if (r) await this.signIn();
      if (!(await this.session())) return;
      return this.claimLicence();
    }
    try {
      let terms: Terms = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "LibraOS: fetching the licence terms" },
        () => getTerms(s.origin),
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await this.confirmTerms(terms))) return;
        const result = await grantDeveloperLicence(s.origin, s.token, terms.version);
        switch (result.kind) {
          case "granted":
            void vscode.window.showInformationMessage(
              `Developer Licence claimed: ${licenceSummary(result.licence)}. It is a record of your rights; there is nothing to install.`,
            );
            return this.refresh();
          case "existing":
            void vscode.window.showInformationMessage(
              `Your organization already holds the Developer Licence: ${licenceSummary(result.licence)}.`,
            );
            return this.refresh();
          case "already_evaluated": {
            const r = await vscode.window.showWarningMessage(
              `This organization's free evaluation has ended${result.licence ? ` (${licenceSummary(result.licence)})` : ""}. Claiming again does not renew it; to continue, contact LibraOS sales.`,
              "Open Console",
            );
            if (r) void vscode.commands.executeCommand("libraos.openConsole");
            return this.refresh();
          }
          case "terms_outdated":
            void vscode.window.showWarningMessage("The licence terms changed since they were shown. Review the current version.");
            terms = result.terms;
            continue;
        }
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) return this.endSession(true);
      const msg = (err as Error).message ?? String(err);
      this.output.appendLine(`Claiming the licence failed: ${msg}`);
      void vscode.window.showErrorMessage(`LibraOS: could not claim the Developer Licence: ${msg}`);
    }
  }

  // Shows the terms and asks for explicit acceptance. Reading the full terms
  // opens them and asks again.
  private async confirmTerms(terms: Terms): Promise<boolean> {
    for (;;) {
      const buttons = terms.url ? ["Accept and Claim", "Read Full Terms"] : ["Accept and Claim"];
      const pick = await vscode.window.showInformationMessage(
        "Claim the LibraOS Developer Licence?",
        {
          modal: true,
          detail: [
            `${terms.name} (${terms.version})`,
            "",
            terms.summary,
            ...(terms.url ? ["", `Full terms: ${terms.url}`] : []),
            "",
            "Claiming records that your organization accepts these terms. A licence is a record of your rights under the LibraOS licence; the runtime does not check it.",
          ].join("\n"),
        },
        ...buttons,
      );
      if (pick === "Accept and Claim") return true;
      if (pick === "Read Full Terms" && terms.url) {
        await openWeb(terms.url);
        continue;
      }
      return false;
    }
  }
}
