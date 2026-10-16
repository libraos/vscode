// Registering this machine's runtime with the developer account, and removing
// registrations. No VS Code imports: the dialogs come in through `Ui`, so every
// branch is unit-tested with fakes.
//
// Nothing is registered unless the developer runs the command. The runtime
// never calls out; the extension reads the id from the local runtime and sends
// it to the Console only here.
import { RuntimeApiError, type RuntimeInstallation } from "../runtime/api";
import { UnauthorizedError, type Installation, type InstallationList, type RegisterRequest, type RegisterResult } from "./client";

export const MAX_NAME = 64;

export interface Ui {
  info(message: string, ...actions: string[]): Promise<string | undefined>;
  warn(message: string, ...actions: string[]): Promise<string | undefined>;
  error(message: string): void;
  // A modal confirmation; true only when `confirm` was chosen.
  confirm(message: string, detail: string, confirm: string): Promise<boolean>;
  input(title: string, value: string, validate: (v: string) => string | undefined): Promise<string | undefined>;
  pick<T extends { label: string }>(title: string, items: T[]): Promise<T | undefined>;
}

// The Console calls, already bound to the signed-in session.
export interface InstallationsApi {
  register(req: RegisterRequest): Promise<RegisterResult>;
  list(): Promise<InstallationList>;
  remove(installationId: string): Promise<boolean>;
}

export interface RegisterDeps {
  ui: Ui;
  api: InstallationsApi;
  // Reads the local runtime's installation; "not_running" when it is not up.
  local(): Promise<RuntimeInstallation | "not_running">;
  defaultName: string;
  claimLicence(): Promise<void>;
  startRuntime(): Promise<void>;
  signedOut(): Promise<void>;
  changed(localInstallationId?: string): Promise<void>;
}

export type RegisterOutcome =
  | "registered"
  | "updated"
  | "cancelled"
  | "not_running"
  | "runtime_outdated"
  | "licence_required"
  | "limit_reached"
  | "signed_out"
  | "failed";

export function validateName(v: string): string | undefined {
  const t = v.trim();
  if (!t) return "Enter a name";
  if (t.length > MAX_NAME) return `At most ${MAX_NAME} characters`;
  return undefined;
}

// A name for this machine: the workspace folder, else the host name.
export function defaultInstallationName(folder: string | undefined, hostname: string): string {
  const n = (folder || hostname || "LibraOS runtime").trim();
  return n.length > MAX_NAME ? n.slice(0, MAX_NAME) : n;
}

function day(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

export function describeInstallation(i: Installation): string {
  return [i.runtimeVersion, day(i.lastSeenAt) ? `last registered from ${day(i.lastSeenAt)}` : undefined, i.installationId]
    .filter(Boolean)
    .join(" · ");
}

function message(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

export async function registerInstallationFlow(d: RegisterDeps): Promise<RegisterOutcome> {
  try {
    let local: RuntimeInstallation | "not_running";
    try {
      local = await d.local();
    } catch (err) {
      if (err instanceof RuntimeApiError && err.status === 404) {
        d.ui.error("The local runtime is too old to report an installation id. Update the runtime, then register again.");
        return "runtime_outdated";
      }
      d.ui.error(`LibraOS: could not read the local runtime's installation id: ${message(err)}`);
      return "failed";
    }
    if (local === "not_running") {
      const r = await d.ui.warn("Start the local runtime to register this installation.", "Run Local Runtime");
      if (r) await d.startRuntime();
      return "not_running";
    }
    const installation = local;

    const name = await d.ui.input("Name this installation", d.defaultName, validateName);
    if (name === undefined) return "cancelled";
    const req: RegisterRequest = {
      installationId: installation.installationId,
      name: name.trim(),
      runtimeVersion: installation.version,
    };

    // At most one retry, after the developer frees a slot.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await d.api.register(req);
      switch (result.kind) {
        case "registered":
        case "updated":
          await d.changed(installation.installationId);
          void d.ui.info(
            result.kind === "registered"
              ? `Registered “${req.name}” with your Developer Licence.`
              : `“${req.name}” was already registered; its name and runtime version are updated.`,
          );
          if (!installation.persistent) {
            void d.ui.warn(
              "This runtime has no database, so its installation id changes when it restarts. Register again after a restart, and remove the old entry.",
            );
          }
          return result.kind;
        case "developer_license_required": {
          const r = await d.ui.warn(
            "Registering installations is a Developer Licence benefit. The Developer Licence is free.",
            "Claim Developer Licence",
          );
          if (r) await d.claimLicence();
          return "licence_required";
        }
        case "limit_reached": {
          if (attempt > 0) break;
          const r = await d.ui.warn(
            `All ${result.limit} installation slots are in use. Remove one to register this installation.`,
            "Remove One…",
          );
          if (!r) return "limit_reached";
          const removed = await chooseAndRemove(d.ui, d.api, result.installations);
          if (!removed) return "limit_reached";
          await d.changed();
          continue;
        }
      }
    }
    d.ui.error("LibraOS: the installation limit is still reached.");
    return "limit_reached";
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      await d.signedOut();
      return "signed_out";
    }
    d.ui.error(`LibraOS: could not register this installation: ${message(err)}`);
    return "failed";
  }
}

async function chooseAndRemove(ui: Ui, api: InstallationsApi, list: Installation[]): Promise<boolean> {
  const pick = await ui.pick(
    "Remove a registered installation",
    list.map((i) => ({ label: i.name, description: describeInstallation(i), installation: i })),
  );
  if (!pick) return false;
  return confirmAndRemove(ui, api, pick.installation);
}

async function confirmAndRemove(ui: Ui, api: InstallationsApi, i: Pick<Installation, "installationId" | "name">): Promise<boolean> {
  const ok = await ui.confirm(
    `Remove “${i.name}” from your registered installations?`,
    "This frees its slot right away. The runtime itself is not touched and keeps working; you can register it again later.",
    "Remove",
  );
  if (!ok) return false;
  const existed = await api.remove(i.installationId);
  void ui.info(existed ? `Removed “${i.name}”.` : `“${i.name}” was not registered any more.`);
  return true;
}

export interface RemoveDeps {
  ui: Ui;
  api: InstallationsApi;
  signedOut(): Promise<void>;
  changed(): Promise<void>;
}

export type RemoveOutcome = "removed" | "cancelled" | "none" | "signed_out" | "failed";

// Removes the given installation, or asks which one when none is given.
export async function removeInstallationFlow(
  d: RemoveDeps,
  target?: Pick<Installation, "installationId" | "name">,
): Promise<RemoveOutcome> {
  try {
    let done: boolean;
    if (target) {
      done = await confirmAndRemove(d.ui, d.api, target);
    } else {
      const { installations } = await d.api.list();
      if (!installations.length) {
        void d.ui.info("No installations are registered.");
        return "none";
      }
      done = await chooseAndRemove(d.ui, d.api, installations);
    }
    if (!done) return "cancelled";
    await d.changed();
    return "removed";
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      await d.signedOut();
      return "signed_out";
    }
    d.ui.error(`LibraOS: could not remove the installation: ${message(err)}`);
    return "failed";
  }
}

// The target of a Remove action: a sidebar item's arg, or an id.
export function installationTarget(x: unknown): Pick<Installation, "installationId" | "name"> | undefined {
  if (typeof x === "string" && x) return { installationId: x, name: x };
  const arg = (x as { arg?: unknown })?.arg ?? x;
  if (arg && typeof arg === "object") {
    const r = arg as Record<string, unknown>;
    if (typeof r.installationId === "string" && r.installationId) {
      return { installationId: r.installationId, name: typeof r.name === "string" && r.name ? r.name : r.installationId };
    }
  }
  return undefined;
}
