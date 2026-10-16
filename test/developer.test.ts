import { describe, expect, it } from "vitest";
import {
  activeDeveloperLicence,
  developerRows,
  licenceKind,
  licenceSummary,
  MEGANOVA_CONSOLE,
  primaryLicence,
  type DeveloperState,
  type Row,
} from "../src/views/developer";
import type { Installation, Licence } from "../src/cloud/client";

// A Developer Licence as the Console records it: no expiry, no production.
const dev = (over: Partial<Licence> = {}): Licence => ({
  licenseId: "lic_dev",
  edition: "developer",
  classification: "developer",
  status: "active",
  productionAllowed: false,
  issuedAt: "2026-10-16T10:00:00Z",
  termsVersion: "developer-2026-10",
  ...over,
});
// Records from before the Developer Licence: organization evaluations.
const legacyEval = (over: Partial<Licence> = {}): Licence =>
  dev({ licenseId: "lic_eval", classification: "organization_evaluation", expiresAt: "2027-01-14T10:00:00Z", ...over });
const smallOrg = (over: Partial<Licence> = {}): Licence =>
  dev({
    licenseId: "lic_small",
    edition: "small_organization",
    classification: "small_organization",
    productionAllowed: true,
    expiresAt: "2027-10-16T10:00:00Z",
    ...over,
  });

const inst = (id: string, name: string, over: Partial<Installation> = {}): Installation => ({
  installationId: id,
  name,
  runtimeVersion: "v0.3.0",
  registeredAt: "2026-10-16T10:00:00Z",
  lastSeenAt: "2026-10-16T10:00:00Z",
  ...over,
});

type SignedIn = Extract<DeveloperState, { signedIn: true }>;
const signedIn = (licence: SignedIn["licence"], more: Partial<SignedIn> = {}): DeveloperState => ({
  signedIn: true,
  email: "dev@acme.test",
  workspace: "Acme",
  licence,
  ...more,
});

const line = (r: Row) => `${r.label}${r.description ? ` = ${r.description}` : ""}`;
const show = (s: DeveloperState) => developerRows(s).map(line);
const find = (rows: Row[], label: string): Row | undefined => {
  for (const r of rows) {
    if (r.label === label) return r;
    const c = r.children && find(r.children, label);
    if (c) return c;
  }
  return undefined;
};

describe("licence display", () => {
  it("signed out: Personal (default), with what it means", () => {
    expect(show({ signedIn: false })).toEqual(["Sign In = Not signed in", "Licence = Personal (default)", "Open Console"]);
    const rows = developerRows({ signedIn: false });
    expect(rows[0].command?.id).toBe("libraos.signIn");
    expect(rows[1].tooltip).toMatch(/free/);
    expect(rows[1].tooltip).toMatch(/no account/);
    expect(rows[1].tooltip).toMatch(/never checks a licence/);
  });

  it("signed in, nothing held: Personal (default) and the free claim", () => {
    const s = signedIn({ kind: "loaded", licences: [] });
    expect(show(s)).toEqual([
      "Signed in = dev@acme.test (Acme)",
      "Licence = Personal (default)",
      "Claim Developer Licence = free",
      "Open Console",
      "Sign Out",
    ]);
    const rows = developerRows(s);
    expect(find(rows, "Claim Developer Licence")?.command?.id).toBe("libraos.claimLicence");
    expect(find(rows, "Claim Developer Licence")?.tooltip).toMatch(/non-production development inside an organization/);
    expect(rows.at(-1)?.command?.id).toBe("libraos.signOut");
  });

  it("Developer Licence held: no expiry, benefits, no claim offered", () => {
    const s = signedIn(
      { kind: "loaded", licences: [dev()] },
      { installations: { kind: "loaded", limit: 5, installations: [] } },
    );
    const rows = developerRows(s);
    expect(rows.map(line)).toEqual(["Signed in = dev@acme.test (Acme)", "Developer Licence = Active, no expiry", "Open Console", "Sign Out"]);
    const licence = rows[1];
    expect(licence.children?.map(line)).toEqual([
      "Registered installations = 0/5",
      "Inference Credits = Coming",
      "Model Catalog = Coming",
    ]);
    expect(licence.tooltip).toContain("Production use: not included");
    expect(licence.tooltip).toMatch(/non-production development inside an organization/);
    expect(licence.tooltip).toMatch(/never checks it/);
    expect(find(rows, "Claim Developer Licence")).toBeUndefined();
    expect(find(rows, "Licence")).toBeUndefined(); // no Personal row
  });

  it("an organization evaluation is shown with its expiry, beside Personal", () => {
    const s = signedIn({ kind: "loaded", licences: [legacyEval()] });
    expect(show(s)).toEqual([
      "Signed in = dev@acme.test (Acme)",
      "Licence = Personal (default)",
      "Claim Developer Licence = free",
      "Organization Evaluation = Active until 2027-01-14",
      "Open Console",
      "Sign Out",
    ]);
    expect(show(signedIn({ kind: "loaded", licences: [legacyEval({ status: "expired" })] }))[3]).toBe(
      "Organization Evaluation = Expired 2027-01-14",
    );
    expect(licenceKind(dev({ edition: "evaluation", classification: "organization_evaluation" }))).toBe("evaluation");
  });

  it("a small-organization licence is shown with its expiry", () => {
    const rows = developerRows(signedIn({ kind: "loaded", licences: [dev(), smallOrg()] }, { installations: { kind: "loading" } }));
    expect(rows.map(line)).toContain("Small Organization Licence = Active until 2027-10-16");
    const row = find(rows, "Small Organization Licence")!;
    expect(row.tooltip).toContain("Production use: allowed");
    expect(row.tooltip).toMatch(/Re-certified yearly/);
  });

  it("other editions keep their name", () => {
    expect(show(signedIn({ kind: "loaded", licences: [dev({ edition: "commercial", classification: undefined, expiresAt: undefined })] }))).toContain(
      "Commercial Licence = Active, no expiry",
    );
  });

  it("a revoked Developer Licence falls back to Personal and the claim", () => {
    expect(show(signedIn({ kind: "loaded", licences: [dev({ status: "revoked" })] }))).toContain("Licence = Personal (default)");
  });

  it("loading, unavailable and error states", () => {
    expect(show(signedIn({ kind: "loading" }))[1]).toBe("Licence = Loading…");
    expect(show(signedIn({ kind: "unavailable" })).slice(1, 3)).toEqual(["Licence = Personal (default)", "Open Console"]);
    const err = developerRows(signedIn({ kind: "error", message: "/v1/licenses: HTTP 500" }))[1];
    expect(err.description).toMatch(/Could not load/);
    expect(err.command?.id).toBe("libraos.refresh");
  });

  it("signed in without an email still says so", () => {
    expect(show({ signedIn: true, licence: { kind: "loading" } })[0]).toBe("Signed in");
  });

  it("never implies a licence is needed to use the runtime", () => {
    const all = [
      { signedIn: false } as DeveloperState,
      signedIn({ kind: "loaded", licences: [] }),
      signedIn({ kind: "loaded", licences: [dev()] }, { installations: { kind: "loaded", limit: 5, installations: [] } }),
      signedIn({ kind: "loaded", licences: [legacyEval({ status: "expired" })] }),
    ].flatMap((s) => developerRows(s));
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/activat|licen[cs]e file|licen[cs]e key|requires? a licen|licen[cs]e (is )?required/i);
    expect(text).not.toMatch(/Not claimed/);
  });
});

describe("developer benefits", () => {
  const held = (installations: SignedIn["installations"], localInstallationId?: string) =>
    developerRows(signedIn({ kind: "loaded", licences: [dev()] }, { installations, localInstallationId }));

  it("lists registered installations n/limit with Remove on each", () => {
    const rows = held({ kind: "loaded", limit: 5, installations: [inst("a", "laptop"), inst("b", "build box", { runtimeVersion: undefined })] });
    const reg = find(rows, "Registered installations")!;
    expect(reg.description).toBe("2/5");
    expect(reg.children?.map(line)).toEqual(["laptop = v0.3.0", "build box", "Register This Installation"]);
    expect(reg.children?.[0].contextValue).toBe("libraos.installation");
    expect(reg.children?.[0].arg).toEqual({ installationId: "a", name: "laptop" });
    expect(reg.children?.[2].command?.id).toBe("libraos.registerInstallation");
  });

  it("marks this machine and stops offering to register it", () => {
    const reg = find(held({ kind: "loaded", limit: 5, installations: [inst("a", "laptop"), inst("b", "ci")] }, "b"), "Registered installations")!;
    expect(reg.children?.map(line)).toEqual(["laptop = v0.3.0", "ci = this machine · v0.3.0"]);
  });

  it("loading, unavailable and error states", () => {
    expect(find(held({ kind: "loading" }), "Registered installations")?.description).toBe("Loading…");
    expect(find(held(undefined), "Registered installations")?.description).toBe("Loading…");
    expect(find(held({ kind: "unavailable" }), "Registered installations")?.description).toMatch(/Not available/);
    const err = find(held({ kind: "error", message: "boom" }), "Registered installations")!;
    expect(err.command?.id).toBe("libraos.refresh");
  });

  it("credits are coming, link to MegaNova and never show a balance", () => {
    const credits = find(held({ kind: "loading" }), "Inference Credits")!;
    expect(credits.description).toBe("Coming");
    expect(credits.link).toBe(MEGANOVA_CONSOLE);
    expect(JSON.stringify(credits)).not.toMatch(/\$\d/);
    expect(find(held({ kind: "loading" }), "Model Catalog")?.description).toBe("Coming");
  });

  it("benefits appear only with a Developer Licence", () => {
    expect(find(developerRows({ signedIn: false }), "Inference Credits")).toBeUndefined();
    expect(find(developerRows(signedIn({ kind: "loaded", licences: [legacyEval()] })), "Registered installations")).toBeUndefined();
  });
});

describe("primaryLicence, licenceSummary, activeDeveloperLicence", () => {
  it("prefers an active record over a newer ended one", () => {
    const ended = dev({ licenseId: "new", status: "expired" });
    const active = dev({ licenseId: "old", edition: "commercial" });
    expect(primaryLicence([ended, active])?.licenseId).toBe("old");
    expect(primaryLicence([ended])?.licenseId).toBe("new");
    expect(primaryLicence([])).toBeUndefined();
  });

  it("summarises records", () => {
    expect(licenceSummary(dev())).toBe("Developer Licence, active, no expiry");
    expect(licenceSummary(dev({ status: "suspended" }))).toBe("Developer Licence, suspended");
    expect(licenceSummary(legacyEval())).toBe("Organization Evaluation, active until 2027-01-14");
  });

  it("finds only an active Developer Licence, never a legacy evaluation", () => {
    expect(activeDeveloperLicence({ kind: "loaded", licences: [legacyEval(), dev()] })?.licenseId).toBe("lic_dev");
    expect(activeDeveloperLicence({ kind: "loaded", licences: [legacyEval()] })).toBeUndefined();
    expect(activeDeveloperLicence({ kind: "loading" })).toBeUndefined();
  });
});
