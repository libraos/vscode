// The Developer section of the sidebar, as plain rows. No VS Code imports, so
// every state is unit-tested; tree.ts turns rows into tree items.
import type { Installation, Licence } from "../cloud/client";

export const MEGANOVA_CONSOLE = "https://console.meganova.ai/home";

export type LicenceState =
  | { kind: "loading" }
  | { kind: "loaded"; licences: Licence[] }
  | { kind: "unavailable" } // the Console does not offer licences
  | { kind: "error"; message: string };

export type InstallationsState =
  | { kind: "loading" }
  | { kind: "loaded"; limit: number; installations: Installation[] }
  | { kind: "unavailable" } // the Console does not offer installations yet
  | { kind: "error"; message: string };

export type DeveloperState =
  | { signedIn: false }
  | {
      signedIn: true;
      email?: string;
      workspace?: string;
      licence: LicenceState;
      // Loaded only while a Developer Licence is held.
      installations?: InstallationsState;
      // The local runtime's installation id, when it is running and reports one.
      localInstallationId?: string;
    };

export interface Row {
  label: string;
  description?: string;
  icon: string;
  tooltip?: string;
  command?: { id: string; args?: unknown[] };
  link?: string; // opened in the browser
  children?: Row[];
  contextValue?: string; // enables item actions (e.g. Remove)
  arg?: unknown; // passed to item actions
}

export const PERSONAL_NOTE = [
  "Personal use of LibraOS is free and needs no account and no licence record.",
  "The runtime never checks a licence.",
].join("\n");

const LICENCE_NOTE = "A licence is a record of your rights under the LibraOS licence terms. The runtime never checks it.";

export const DEVELOPER_SCOPE =
  "Covers personal use and non-production development inside an organization. Production use needs a commercial or small-organization licence.";

export type LicenceKind = "developer" | "evaluation" | "small_organization" | "other";

// Records from before the Developer Licence carry edition "developer" with
// classification "organization_evaluation": they are organization evaluations.
export function licenceKind(l: Licence): LicenceKind {
  if (l.edition === "small_organization") return "small_organization";
  if (l.edition === "evaluation" || l.classification === "organization_evaluation") return "evaluation";
  if (l.edition === "developer") return "developer";
  return "other";
}

export function accountLabel(s: DeveloperState): string | undefined {
  if (!s.signedIn) return undefined;
  if (s.email && s.workspace) return `${s.email} (${s.workspace})`;
  return s.email ?? s.workspace;
}

function day(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function title(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function licenceTitle(l: Licence): string {
  switch (licenceKind(l)) {
    case "developer":
      return "Developer Licence";
    case "evaluation":
      return "Organization Evaluation";
    case "small_organization":
      return "Small Organization Licence";
    default:
      return `${title(l.edition)} Licence`;
  }
}

// The record to show first: an active one, else the newest.
export function primaryLicence(licences: Licence[]): Licence | undefined {
  return licences.find((l) => l.status === "active") ?? licences[0];
}

// The status part of a record: "active, no expiry", "active until …", "expired …".
export function licenceStatus(l: Licence): string {
  const until = day(l.expiresAt);
  switch (l.status) {
    case "active":
      return until ? `active until ${until}` : "active, no expiry";
    case "expired":
      return until ? `expired ${until}` : "expired";
    default:
      return l.status;
  }
}

export function licenceSummary(l: Licence): string {
  return `${licenceTitle(l)}, ${licenceStatus(l)}`;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function recordTooltip(l: Licence, extra: string[] = []): string {
  const facts = [
    `${licenceTitle(l)} ${l.licenseId}`,
    `Status: ${licenceStatus(l)}`,
    day(l.issuedAt) ? `Issued: ${day(l.issuedAt)}` : "",
    `Production use: ${l.productionAllowed ? "allowed" : "not included"}`,
    l.termsVersion ? `Terms: ${l.termsVersion}` : "",
  ].filter(Boolean);
  return [...facts, ...extra.flatMap((e) => ["", e]), "", LICENCE_NOTE].join("\n");
}

function personalRows(offerClaim: boolean): Row[] {
  const rows: Row[] = [{ label: "Licence", description: "Personal (default)", icon: "law", tooltip: PERSONAL_NOTE }];
  if (offerClaim) {
    rows.push({
      label: "Claim Developer Licence",
      description: "free",
      icon: "verified",
      tooltip: `Free, no expiry. ${DEVELOPER_SCOPE}\nBenefits: register up to 5 installations; inference credits and the full model catalog are coming.`,
      command: { id: "libraos.claimLicence" },
    });
  }
  return rows;
}

function installationRows(s: InstallationsState | undefined, localId: string | undefined): Row {
  const register: Row = {
    label: "Register This Installation",
    icon: "add",
    tooltip: "Registers the local runtime's installation id with your account. Nothing is sent unless you ask.",
    command: { id: "libraos.registerInstallation" },
  };
  const base = { label: "Registered installations", icon: "server" };
  switch (s?.kind ?? "loading") {
    case "loading":
      return { ...base, description: "Loading…", icon: "loading~spin" };
    case "unavailable":
      return { ...base, description: "Not available on this Console yet", tooltip: "This Console does not offer installation registration yet." };
    case "error":
      return {
        ...base,
        description: "Could not load: refresh to retry",
        icon: "warning",
        tooltip: (s as { message: string }).message,
        command: { id: "libraos.refresh" },
      };
  }
  const { limit, installations } = s as Extract<InstallationsState, { kind: "loaded" }>;
  const children: Row[] = installations.map((i) => {
    const local = Boolean(localId && i.installationId === localId);
    return {
      label: i.name,
      description: [local ? "this machine" : "", i.runtimeVersion ?? ""].filter(Boolean).join(" · ") || undefined,
      icon: local ? "device-desktop" : "vm",
      tooltip: [
        `Installation ${i.installationId}`,
        i.runtimeVersion ? `Runtime: ${i.runtimeVersion}` : "",
        day(i.registeredAt) ? `Registered: ${day(i.registeredAt)}` : "",
        day(i.lastSeenAt) ? `Last registered from: ${day(i.lastSeenAt)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      contextValue: "libraos.installation",
      arg: { installationId: i.installationId, name: i.name },
    };
  });
  if (!installations.some((i) => i.installationId === localId)) children.push(register);
  return {
    ...base,
    description: `${installations.length}/${limit}`,
    tooltip: `You can register up to ${limit} installations. Remove one to free a slot.`,
    children,
  };
}

function developerLicenceRow(l: Licence, s: Extract<DeveloperState, { signedIn: true }>): Row {
  const benefits: Row[] = [
    installationRows(s.installations, s.localInstallationId),
    {
      label: "Inference Credits",
      description: "Coming",
      icon: "credit-card",
      tooltip: "Developer Licence holders will receive MegaNova inference credits. Linking accounts is not available yet.",
      link: MEGANOVA_CONSOLE,
    },
    {
      label: "Model Catalog",
      description: "Coming",
      icon: "library",
      tooltip: "The full scored model catalog is coming for Developer Licence holders.",
    },
  ];
  return {
    label: "Developer Licence",
    description: cap(licenceStatus(l)),
    icon: l.status === "active" ? "verified-filled" : "warning",
    tooltip: recordTooltip(l, [DEVELOPER_SCOPE, "Also includes priority support."]),
    children: benefits,
  };
}

function licenceRows(s: Extract<DeveloperState, { signedIn: true }>): Row[] {
  const state = s.licence;
  switch (state.kind) {
    case "loading":
      return [{ label: "Licence", description: "Loading…", icon: "loading~spin" }];
    case "unavailable":
      return personalRows(false);
    case "error":
      return [
        {
          label: "Licence",
          description: "Could not load: refresh to retry",
          icon: "warning",
          tooltip: state.message,
          command: { id: "libraos.refresh" },
        },
      ];
    case "loaded": {
      const byKind = (k: LicenceKind) => state.licences.filter((l) => licenceKind(l) === k);
      const developer = byKind("developer").find((l) => l.status === "active");
      const rows: Row[] = developer ? [developerLicenceRow(developer, s)] : personalRows(true);
      for (const k of ["small_organization", "evaluation", "other"] as const) {
        const l = primaryLicence(byKind(k));
        if (!l) continue;
        rows.push({
          label: licenceTitle(l),
          description: cap(licenceStatus(l)),
          icon: l.status === "active" ? "verified-filled" : "history",
          tooltip: recordTooltip(l, k === "small_organization" ? ["Re-certified yearly."] : []),
        });
      }
      return rows;
    }
  }
}

export function developerRows(s: DeveloperState): Row[] {
  const openConsole: Row = { label: "Open Console", icon: "link-external", command: { id: "libraos.openConsole" } };

  if (!s.signedIn) {
    return [
      { label: "Sign In", description: "Not signed in", icon: "account", command: { id: "libraos.signIn" } },
      ...personalRows(false),
      openConsole,
    ];
  }
  return [
    { label: "Signed in", description: accountLabel(s), icon: "account", tooltip: "Signed in to the LibraOS Developer Console" },
    ...licenceRows(s),
    openConsole,
    { label: "Sign Out", icon: "sign-out", command: { id: "libraos.signOut" } },
  ];
}

// The held Developer Licence, if any.
export function activeDeveloperLicence(state: LicenceState): Licence | undefined {
  return state.kind === "loaded"
    ? state.licences.find((l) => licenceKind(l) === "developer" && l.status === "active")
    : undefined;
}
