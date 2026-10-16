// The Developer section of the sidebar, as plain rows. No VS Code imports, so
// every state is unit-tested; tree.ts turns rows into tree items.
import type { Licence } from "../cloud/client";

export const MEGANOVA_CONSOLE = "https://console.meganova.ai/home";

export type LicenceState =
  | { kind: "loading" }
  | { kind: "loaded"; licences: Licence[] }
  | { kind: "unavailable" } // the Console does not offer licences
  | { kind: "error"; message: string };

export type DeveloperState =
  | { signedIn: false }
  | { signedIn: true; email?: string; workspace?: string; licence: LicenceState };

export interface Row {
  label: string;
  description?: string;
  icon: string;
  tooltip?: string;
  command?: { id: string; args?: unknown[] };
  link?: string; // opened in the browser
}

const LICENCE_NOTE = "A licence is a record of your rights under the LibraOS licence terms. The runtime does not check it.";

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
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// The record to show first: an active one, else the newest.
export function primaryLicence(licences: Licence[]): Licence | undefined {
  return licences.find((l) => l.status === "active") ?? licences[0];
}

export function licenceSummary(l: Licence): string {
  const edition = title(l.edition);
  const until = day(l.expiresAt);
  switch (l.status) {
    case "active":
      return until ? `${edition}, active until ${until}` : `${edition}, active`;
    case "expired":
      return until ? `${edition}, expired ${until}` : `${edition}, expired`;
    default:
      return `${edition}, ${l.status}`;
  }
}

function licenceRows(state: LicenceState): Row[] {
  switch (state.kind) {
    case "loading":
      return [{ label: "Licence", description: "Loading…", icon: "loading~spin" }];
    case "unavailable":
      return [{ label: "Licence", description: "Not available on this Console", icon: "law" }];
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
      const l = primaryLicence(state.licences);
      if (!l) {
        return [
          { label: "Licence", description: "Not claimed", icon: "law", tooltip: LICENCE_NOTE },
          { label: "Claim Developer Licence", icon: "verified", command: { id: "libraos.claimLicence" } },
        ];
      }
      const tooltip = [
        `${title(l.edition)} licence ${l.licenseId}`,
        `Status: ${l.status}`,
        day(l.issuedAt) ? `Issued: ${day(l.issuedAt)}` : "",
        day(l.expiresAt) ? `Expires: ${day(l.expiresAt)}` : "",
        `Production use: ${l.productionAllowed ? "allowed" : "not included"}`,
        l.termsVersion ? `Terms: ${l.termsVersion}` : "",
      ]
        .filter(Boolean)
        .concat("", LICENCE_NOTE)
        .join("\n");
      const icon = l.status === "active" ? "verified-filled" : "warning";
      return [{ label: "Licence", description: licenceSummary(l), icon, tooltip }];
    }
  }
}

export function developerRows(s: DeveloperState): Row[] {
  const credits: Row = {
    label: "Inference Credits",
    description: "Account not linked",
    icon: "credit-card",
    tooltip: "Credits and usage are managed on MegaNova. Linking your LibraOS account is not available yet.",
    link: MEGANOVA_CONSOLE,
  };
  const openConsole: Row = { label: "Open Console", icon: "link-external", command: { id: "libraos.openConsole" } };

  if (!s.signedIn) {
    return [
      { label: "Sign In", description: "Not signed in", icon: "account", command: { id: "libraos.signIn" } },
      { label: "Licence", description: "Sign in to see it", icon: "law", tooltip: LICENCE_NOTE },
      credits,
      openConsole,
    ];
  }
  return [
    { label: "Signed in", description: accountLabel(s), icon: "account", tooltip: "Signed in to the LibraOS Developer Console" },
    ...licenceRows(s.licence),
    credits,
    openConsole,
    { label: "Sign Out", icon: "sign-out", command: { id: "libraos.signOut" } },
  ];
}
