import * as vscode from "vscode";
import type { Secrets, StoredSession } from "../secrets";
import {
  CloudError,
  consoleOrigin,
  DeviceFlowError,
  getTerms,
  grantDeveloperLicence,
  listInstallations,
  listLicences,
  pollDeviceToken,
  registerInstallation,
  removeInstallation,
  requestDeviceCode,
  UnauthorizedError,
  type Terms,
} from "./client";
import {
  accountLabel,
  activeDeveloperLicence,
  DEVELOPER_SCOPE,
  licenceKind,
  licenceSummary,
  type DeveloperState,
  type InstallationsState,
  type LicenceState,
} from "../views/developer";
import type { RuntimeInstallation } from "../runtime/api";
import {
  installationTarget,
  registerInstallationFlow,
  removeInstallationFlow,
  type InstallationsApi,
  type Ui,
} from "./installations";

const DEFAULT_CONSOLE = "https://console.libraos.com";

export function consoleUrl(): string {
  return vscode.workspace.getConfiguration("libraos").get<string>("consoleUrl", DEFAULT_CONSOLE) || DEFAULT_CONSOLE;
}

// The Console's Licenses page, where commercial and small-organization
// licences are handled.
export function licensesPage(): string | undefined {
  try {
    return `${consoleOrigin(consoleUrl())}/licenses`;
  } catch {
    return undefined;
  }
}

// The local runtime, as the account needs it. The admin session used to read
// the installation id stays on this machine.
export interface LocalRuntime {
  // Throws on errors (a RuntimeApiError 404 means the runtime is too old).
  installation(): Promise<RuntimeInstallation | "not_running">;
  defaultName(): string;
}

const ui: Ui = {
  info: (m, ...a) => Promise.resolve(vscode.window.showInformationMessage(m, ...a)),
  warn: (m, ...a) => Promise.resolve(vscode.window.showWarningMessage(m, ...a)),
  error: (m) => void vscode.window.showErrorMessage(m),
  confirm: async (m, detail, c) => (await vscode.window.showWarningMessage(m, { modal: true, detail }, c)) === c,
  input: (title, value, validate) => Promise.resolve(vscode.window.showInputBox({ title, value, validateInput: validate, ignoreFocusOut: true })),
  pick: (title, items) => Promise.resolve(vscode.window.showQuickPick(items, { title, matchOnDescription: true })),
};

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
    private readonly runtime?: LocalRuntime,
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
    if (!activeDeveloperLicence(licence)) {
      this.set({ ...who, licence });
      return;
    }
    const prev = this.current.signedIn ? this.current : undefined;
    if (!prev?.installations) this.set({ ...who, licence, installations: { kind: "loading" } });
    let installations: InstallationsState;
    try {
      installations = { kind: "loaded", ...(await listInstallations(s.origin, s.token)) };
    } catch (err) {
      if (err instanceof UnauthorizedError) return this.endSession(true);
      if (err instanceof CloudError && (err.status === 404 || err.status === 501)) installations = { kind: "unavailable" };
      else {
        this.output.appendLine(`Loading installations failed: ${String((err as Error).message ?? err)}`);
        installations = { kind: "error", message: String((err as Error).message ?? err) };
      }
    }
    this.set({ ...who, licence, installations, localInstallationId: await this.localInstallationId() });
  }

  // The local runtime's installation id, quietly: undefined when it is not
  // running, too old, or not the extension's own.
  private async localInstallationId(): Promise<string | undefined> {
    try {
      const r = await this.runtime?.installation();
      return r && r !== "not_running" ? r.installationId : undefined;
    } catch {
      return undefined;
    }
  }

  private api(s: StoredSession): InstallationsApi {
    return {
      register: (req) => registerInstallation(s.origin, s.token, req),
      list: () => listInstallations(s.origin, s.token),
      remove: (id) => removeInstallation(s.origin, s.token, id),
    };
  }

  // A signed-in session, offering sign-in first when there is none.
  private async requireSession(why: string): Promise<StoredSession | undefined> {
    const s = await this.session();
    if (s) return s;
    const r = await vscode.window.showInformationMessage(why, "Sign In");
    if (r) await this.signIn();
    return this.session();
  }

  async registerInstallation(): Promise<void> {
    if (!this.runtime) return;
    const s = await this.requireSession("Sign in to register this installation with your Developer Licence.");
    if (!s) return;
    const runtime = this.runtime;
    const outcome = await registerInstallationFlow({
      ui,
      api: this.api(s),
      local: () => runtime.installation(),
      defaultName: runtime.defaultName(),
      claimLicence: () => this.claimLicence(),
      startRuntime: async () => {
        await vscode.commands.executeCommand("libraos.startRuntime");
      },
      signedOut: () => this.endSession(true),
      changed: () => this.refresh(),
    });
    this.output.appendLine(`Register this installation: ${outcome}`);
  }

  async removeInstallation(item?: unknown): Promise<void> {
    const s = await this.requireSession("Sign in to manage your registered installations.");
    if (!s) return;
    const outcome = await removeInstallationFlow(
      { ui, api: this.api(s), signedOut: () => this.endSession(true), changed: () => this.refresh() },
      installationTarget(item),
    );
    this.output.appendLine(`Remove installation: ${outcome}`);
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
          case "existing": {
            await this.refresh();
            if (licenceKind(result.licence) !== "developer") {
              // An older Console records an organization evaluation instead.
              void vscode.window.showInformationMessage(`The Console recorded: ${licenceSummary(result.licence)}.`);
              return;
            }
            const r = await vscode.window.showInformationMessage(
              result.kind === "granted"
                ? "Developer Licence claimed. It is a record of your rights; there is nothing to install. You can now register up to 5 instances for its benefits."
                : "You already hold the Developer Licence.",
              "Register This Instance",
            );
            if (r) await this.registerInstallation();
            return;
          }
          case "already_evaluated": {
            // Only an older Console answers this.
            const r = await vscode.window.showWarningMessage(
              `This Console could not record a Developer Licence${result.licence ? ` (it holds ${licenceSummary(result.licence)})` : ""}. ${result.message ?? ""}`.trim(),
              "Open Licenses Page",
            );
            const page = licensesPage();
            if (r && page) await openWeb(page);
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
            `The Developer Licence is free and does not expire. ${DEVELOPER_SCOPE}${licensesPage() ? ` See ${licensesPage()}` : ""}`,
            "",
            "Personal use needs no licence. A licence is a record of your rights; the runtime never checks it.",
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
