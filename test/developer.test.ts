import { describe, expect, it } from "vitest";
import { developerRows, licenceSummary, MEGANOVA_CONSOLE, primaryLicence, type DeveloperState } from "../src/views/developer";
import type { Licence } from "../src/cloud/client";

const lic = (over: Partial<Licence> = {}): Licence => ({
  licenseId: "lic_1",
  edition: "developer",
  status: "active",
  productionAllowed: false,
  issuedAt: "2026-10-16T10:00:00Z",
  expiresAt: "2027-01-14T10:00:00Z",
  termsVersion: "developer-2026-10",
  ...over,
});

const signedIn = (licence: Extract<DeveloperState, { signedIn: true }>["licence"]): DeveloperState => ({
  signedIn: true,
  email: "dev@acme.test",
  workspace: "Acme",
  licence,
});

const show = (s: DeveloperState) => developerRows(s).map((r) => `${r.label}${r.description ? ` = ${r.description}` : ""}`);

describe("developerRows", () => {
  it("signed out: offers sign-in, no licence, credits not linked", () => {
    expect(show({ signedIn: false })).toEqual([
      "Sign In = Not signed in",
      "Licence = Sign in to see it",
      "Inference Credits = Account not linked",
      "Open Console",
    ]);
    expect(developerRows({ signedIn: false })[0].command?.id).toBe("libraos.signIn");
  });

  it("signed in, nothing claimed: offers the claim", () => {
    const rows = developerRows(signedIn({ kind: "loaded", licences: [] }));
    expect(show(signedIn({ kind: "loaded", licences: [] }))).toEqual([
      "Signed in = dev@acme.test (Acme)",
      "Licence = Not claimed",
      "Claim Developer Licence",
      "Inference Credits = Account not linked",
      "Open Console",
      "Sign Out",
    ]);
    expect(rows.find((r) => r.label === "Claim Developer Licence")?.command?.id).toBe("libraos.claimLicence");
    expect(rows.at(-1)?.command?.id).toBe("libraos.signOut");
  });

  it("active licence: edition and expiry, no claim offered", () => {
    const rows = developerRows(signedIn({ kind: "loaded", licences: [lic()] }));
    expect(show(signedIn({ kind: "loaded", licences: [lic()] }))[1]).toBe("Licence = Developer, active until 2027-01-14");
    expect(rows.some((r) => r.label === "Claim Developer Licence")).toBe(false);
    const tip = rows[1].tooltip ?? "";
    expect(tip).toContain("Production use: not included");
    expect(tip).toContain("The runtime does not check it");
  });

  it("expired licence", () => {
    expect(show(signedIn({ kind: "loaded", licences: [lic({ status: "expired" })] }))[1]).toBe(
      "Licence = Developer, expired 2027-01-14",
    );
  });

  it("loading, unavailable and error states", () => {
    expect(show(signedIn({ kind: "loading" }))[1]).toBe("Licence = Loading…");
    expect(show(signedIn({ kind: "unavailable" }))[1]).toBe("Licence = Not available on this Console");
    const err = developerRows(signedIn({ kind: "error", message: "/v1/licenses: HTTP 500" }))[1];
    expect(err.description).toMatch(/Could not load/);
    expect(err.command?.id).toBe("libraos.refresh");
  });

  it("signed in without an email still says so", () => {
    expect(show({ signedIn: true, licence: { kind: "loading" } })[0]).toBe("Signed in");
  });

  it("credits link to MegaNova and never show a balance", () => {
    for (const s of [{ signedIn: false } as DeveloperState, signedIn({ kind: "loaded", licences: [lic()] })]) {
      const credits = developerRows(s).find((r) => r.label === "Inference Credits")!;
      expect(credits.link).toBe(MEGANOVA_CONSOLE);
      expect(credits.description).toBe("Account not linked");
      expect(JSON.stringify(credits)).not.toMatch(/\$\d/);
    }
  });

  it("never suggests activation or a licence file", () => {
    const all = [
      { signedIn: false } as DeveloperState,
      signedIn({ kind: "loaded", licences: [] }),
      signedIn({ kind: "loaded", licences: [lic()] }),
      signedIn({ kind: "loaded", licences: [lic({ status: "expired" })] }),
    ].flatMap((s) => developerRows(s));
    expect(JSON.stringify(all)).not.toMatch(/activat|licen[cs]e file|licen[cs]e key/i);
  });
});

describe("primaryLicence and licenceSummary", () => {
  it("prefers an active record over a newer ended one", () => {
    const ended = lic({ licenseId: "new", status: "expired" });
    const active = lic({ licenseId: "old", edition: "commercial" });
    expect(primaryLicence([ended, active])?.licenseId).toBe("old");
    expect(primaryLicence([ended])?.licenseId).toBe("new");
    expect(primaryLicence([])).toBeUndefined();
  });

  it("summarises other statuses and open-ended records", () => {
    expect(licenceSummary(lic({ status: "suspended" }))).toBe("Developer, suspended");
    expect(licenceSummary(lic({ edition: "enterprise", expiresAt: undefined }))).toBe("Enterprise, active");
  });
});
