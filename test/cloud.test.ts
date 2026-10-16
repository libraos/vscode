import { describe, expect, it } from "vitest";
import {
  CLIENT_ID,
  CloudError,
  consoleOrigin,
  DeviceFlowError,
  getTerms,
  grantDeveloperLicence,
  listInstallations,
  listLicences,
  registerInstallation,
  removeInstallation,
  pollDeviceToken,
  requestDeviceCode,
  UnauthorizedError,
  type DeviceCode,
} from "../src/cloud/client";

type Reply = { status: number; body: unknown } | Error;

// Answers each call with the next reply for its path; records every request.
function scripted(script: Record<string, Reply[]>, seen: Request[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    const q = script[new URL(req.url).pathname];
    const next = q?.shift();
    if (!next) throw new TypeError("fetch failed");
    if (next instanceof Error) throw next;
    return new Response(next.status === 204 ? null : JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
}

const ORIGIN = "https://console.example.test";
const code: DeviceCode = {
  deviceCode: "dc-secret",
  userCode: "WDJB-MJHT",
  verificationUri: `${ORIGIN}/device`,
  expiresIn: 900,
  interval: 5,
};
const pending = { status: 400, body: { error: "authorization_pending", error_description: "waiting for approval" } };
const slow = { status: 400, body: { error: "slow_down", error_description: "polling too fast" } };
const granted = {
  status: 200,
  body: { access_token: "tok-123", token_type: "Bearer", expires_in: 86400, tenant_id: "t1", workspace: "Acme", email: "dev@acme.test" },
};

// A clock that only moves when the poller sleeps, so tests run instantly.
function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new Error("aborted");
      sleeps.push(ms);
      t += ms;
    },
  };
}

describe("consoleOrigin", () => {
  it("accepts https and loopback http", () => {
    expect(consoleOrigin("https://console.libraos.com/")).toBe("https://console.libraos.com");
    expect(consoleOrigin("http://127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080");
    expect(consoleOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("refuses plain http to another host and non-URLs", () => {
    expect(() => consoleOrigin("http://console.libraos.com")).toThrow(/https/);
    expect(() => consoleOrigin("not a url")).toThrow(CloudError);
  });
});

describe("requestDeviceCode", () => {
  it("posts the client id as a form and reads the answer", async () => {
    const seen: Request[] = [];
    const f = scripted(
      {
        "/v1/device/code": [
          {
            status: 200,
            body: {
              device_code: "dc",
              user_code: "ABCD-EFGH",
              verification_uri: `${ORIGIN}/device`,
              verification_uri_complete: `${ORIGIN}/device?user_code=ABCD-EFGH`,
              expires_in: 900,
              interval: 5,
            },
          },
        ],
      },
      seen,
    );
    const c = await requestDeviceCode(ORIGIN, f);
    expect(c).toEqual({
      deviceCode: "dc",
      userCode: "ABCD-EFGH",
      verificationUri: `${ORIGIN}/device`,
      verificationUriComplete: `${ORIGIN}/device?user_code=ABCD-EFGH`,
      expiresIn: 900,
      interval: 5,
    });
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(await seen[0].text()).toBe(`client_id=${CLIENT_ID}`);
    expect(seen[0].headers.get("authorization")).toBeNull();
  });

  it("reports a Console without device sign-in", async () => {
    const f = scripted({ "/v1/device/code": [{ status: 501, body: { error: "device_auth_disabled" } }] });
    await expect(requestDeviceCode(ORIGIN, f)).rejects.toThrow(/not available on this Console/);
  });

  it("reports an unreachable Console without throwing a raw fetch error", async () => {
    await expect(requestDeviceCode(ORIGIN, scripted({}))).rejects.toThrow(/could not reach the Console/);
  });
});

describe("pollDeviceToken", () => {
  it("waits the interval while pending, then returns the session", async () => {
    const clock = fakeClock();
    const seen: Request[] = [];
    const f = scripted({ "/v1/device/token": [pending, pending, granted] }, seen);
    const s = await pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep });
    expect(s).toEqual({ token: "tok-123", expiresAt: clock.now() + 86400 * 1000, email: "dev@acme.test", workspace: "Acme" });
    expect(clock.sleeps).toEqual([5000, 5000, 5000]);
    const form = new URLSearchParams(await seen[0].text());
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(form.get("device_code")).toBe("dc-secret");
    expect(form.get("client_id")).toBe(CLIENT_ID);
  });

  it("adds 5 seconds to the interval on every slow_down", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": [slow, pending, slow, granted] });
    await pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep });
    expect(clock.sleeps).toEqual([5000, 10000, 10000, 15000]);
  });

  it("stops on expired_token", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": [pending, { status: 400, body: { error: "expired_token" } }] });
    const err = await pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(DeviceFlowError);
    expect(err.reason).toBe("expired");
  });

  it("stops at its own deadline even if the server keeps saying pending", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": Array.from({ length: 10 }, () => pending) });
    const err = await pollDeviceToken(ORIGIN, { ...code, expiresIn: 12 }, { fetch: f, now: clock.now, sleep: clock.sleep }).catch(
      (e) => e,
    );
    expect(err.reason).toBe("expired");
    expect(clock.sleeps).toEqual([5000, 5000, 5000]);
  });

  it("stops on access_denied", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": [{ status: 400, body: { error: "access_denied", error_description: "the sign-in request was denied" } }] });
    const err = await pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep }).catch((e) => e);
    expect(err.reason).toBe("denied");
    expect(err.message).toBe("the sign-in request was denied");
  });

  it("fails on invalid_grant", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": [{ status: 400, body: { error: "invalid_grant", error_description: "unknown device_code" } }] });
    await expect(pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep })).rejects.toThrow(/unknown device_code/);
  });

  it("is cancelled by its signal while waiting", async () => {
    const abort = new AbortController();
    const f = scripted({ "/v1/device/token": [pending, pending, pending] });
    const p = pollDeviceToken(ORIGIN, { ...code, interval: 1 }, { fetch: f, signal: abort.signal });
    setTimeout(() => abort.abort(), 20);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(DeviceFlowError);
    expect(err.reason).toBe("cancelled");
  });

  it("does not poll at all when already cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const seen: Request[] = [];
    const err = await pollDeviceToken(ORIGIN, code, { fetch: scripted({}, seen), signal: abort.signal }).catch((e) => e);
    expect(err.reason).toBe("cancelled");
    expect(seen).toHaveLength(0);
  });

  it("rides out a few network errors and server errors", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": [new TypeError("fetch failed"), { status: 502, body: {} }, granted] });
    const s = await pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep });
    expect(s.token).toBe("tok-123");
  });

  it("gives up after too many network errors in a row", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": Array.from({ length: 4 }, () => new TypeError("fetch failed")) });
    await expect(
      pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep, maxTransientErrors: 2 }),
    ).rejects.toThrow(/could not reach the Console/);
  });

  it("never puts the device code in an error message", async () => {
    const clock = fakeClock();
    const f = scripted({ "/v1/device/token": [{ status: 400, body: { error: "invalid_request" } }] });
    const err = await pollDeviceToken(ORIGIN, code, { fetch: f, now: clock.now, sleep: clock.sleep }).catch((e) => e);
    expect(String(err.message)).not.toContain("dc-secret");
  });
});

const record = {
  license_id: "lic_abc",
  organization_id: "t1",
  edition: "developer",
  classification: "organization_evaluation",
  status: "active",
  production_allowed: false,
  issued_at: "2026-10-16T10:00:00Z",
  expires_at: "2027-01-14T10:00:00Z",
  terms_version: "developer-2026-10",
  accepted_at: "2026-10-16T10:00:00Z",
  source: "self_service",
};
const terms = { terms_version: "developer-2026-10", name: "LibraOS Developer Terms", summary: "Free development use." };

describe("licences", () => {
  it("reads the terms without a token", async () => {
    const seen: Request[] = [];
    const f = scripted({ "/v1/licenses/terms": [{ status: 200, body: { ...terms, url: "https://libraos.com/terms" } }] }, seen);
    expect(await getTerms(ORIGIN, f)).toEqual({
      version: "developer-2026-10",
      name: "LibraOS Developer Terms",
      summary: "Free development use.",
      url: "https://libraos.com/terms",
    });
    expect(seen[0].headers.get("authorization")).toBeNull();
  });

  it("lists licences with the bearer token", async () => {
    const seen: Request[] = [];
    const f = scripted({ "/v1/licenses": [{ status: 200, body: { licenses: [record] } }] }, seen);
    const list = await listLicences(ORIGIN, "tok-123", f);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ licenseId: "lic_abc", edition: "developer", status: "active", productionAllowed: false });
    expect(seen[0].headers.get("authorization")).toBe("Bearer tok-123");
    expect(seen[0].url).toBe(`${ORIGIN}/v1/licenses`);
  });

  it("turns a 401 into UnauthorizedError, without the token in the message", async () => {
    const f = scripted({ "/v1/licenses": [{ status: 401, body: { error: "unauthenticated", message: "a valid session token is required" } }] });
    const err = await listLicences(ORIGIN, "tok-123", f).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).not.toContain("tok-123");
  });

  it("201 is a first claim and sends the accepted terms version", async () => {
    const seen: Request[] = [];
    const f = scripted({ "/v1/licenses/developer/grant": [{ status: 201, body: record }] }, seen);
    const r = await grantDeveloperLicence(ORIGIN, "tok-123", "developer-2026-10", f);
    expect(r.kind).toBe("granted");
    expect(await seen[0].json()).toEqual({ terms_version: "developer-2026-10", accepted: true });
    expect(seen[0].headers.get("authorization")).toBe("Bearer tok-123");
  });

  it("200 is a repeat claim of an active licence", async () => {
    const f = scripted({ "/v1/licenses/developer/grant": [{ status: 200, body: record }] });
    const r = await grantDeveloperLicence(ORIGIN, "t", "developer-2026-10", f);
    expect(r).toMatchObject({ kind: "existing", licence: { licenseId: "lic_abc" } });
  });

  it("409 terms_outdated carries the current terms", async () => {
    const f = scripted({
      "/v1/licenses/developer/grant": [
        { status: 409, body: { error: "terms_outdated", message: "review the current terms", terms: { ...terms, terms_version: "developer-2026-11" } } },
      ],
    });
    const r = await grantDeveloperLicence(ORIGIN, "t", "developer-2026-10", f);
    expect(r).toMatchObject({ kind: "terms_outdated", terms: { version: "developer-2026-11" } });
  });

  it("409 already_evaluated carries the ended licence", async () => {
    const f = scripted({
      "/v1/licenses/developer/grant": [
        { status: 409, body: { error: "already_evaluated", message: "contact sales", license: { ...record, status: "expired" } } },
      ],
    });
    const r = await grantDeveloperLicence(ORIGIN, "t", "developer-2026-10", f);
    expect(r).toMatchObject({ kind: "already_evaluated", licence: { status: "expired" } });
  });

  it("401 on grant is UnauthorizedError; other errors carry the server's code", async () => {
    const f = scripted({
      "/v1/licenses/developer/grant": [
        { status: 401, body: { error: "unauthenticated" } },
        { status: 429, body: { error: "rate_limited" } },
        { status: 400, body: { error: "terms_not_accepted", message: "accept the terms to claim a developer licence" } },
      ],
    });
    await expect(grantDeveloperLicence(ORIGIN, "t", "v", f)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(grantDeveloperLicence(ORIGIN, "t", "v", f)).rejects.toThrow(/too many requests/);
    await expect(grantDeveloperLicence(ORIGIN, "t", "v", f)).rejects.toThrow(/accept the terms/);
  });
});

describe("developer terms", () => {
  it("prefers editions.developer over the top-level fields", async () => {
    const f = scripted({
      "/v1/licenses/terms": [
        {
          status: 200,
          body: {
            ...terms,
            terms_version: "legacy-1",
            editions: {
              developer: { terms_version: "developer-2026-10", name: "LibraOS Developer Licence", url: "https://libraos.com/dev", summary: "Free." },
              evaluation: { terms_version: "eval-1", name: "Evaluation", summary: "90 days." },
            },
          },
        },
      ],
    });
    expect(await getTerms(ORIGIN, f)).toEqual({
      version: "developer-2026-10",
      name: "LibraOS Developer Licence",
      url: "https://libraos.com/dev",
      summary: "Free.",
    });
  });

  it("falls back to the top-level fields on an older Console", async () => {
    for (const body of [terms, { ...terms, editions: {} }, { ...terms, editions: { developer: { name: "no version" } } }]) {
      const f = scripted({ "/v1/licenses/terms": [{ status: 200, body }] });
      expect((await getTerms(ORIGIN, f)).version).toBe("developer-2026-10");
    }
  });
});

const installation = {
  installation_id: "6f1c3a52-1111-4222-8333-444455556666",
  name: "laptop",
  runtime_version: "v0.3.0",
  registered_at: "2026-10-16T10:00:00Z",
  last_seen_at: "2026-10-16T10:00:00Z",
};
const req = { installationId: installation.installation_id, name: "laptop", runtimeVersion: "v0.3.0" };

describe("installations", () => {
  it("lists with the bearer token", async () => {
    const seen: Request[] = [];
    const f = scripted({ "/v1/installations": [{ status: 200, body: { limit: 5, installations: [installation, { name: "no id" }] } }] }, seen);
    expect(await listInstallations(ORIGIN, "tok-123", f)).toEqual({
      limit: 5,
      installations: [
        {
          installationId: installation.installation_id,
          name: "laptop",
          runtimeVersion: "v0.3.0",
          registeredAt: "2026-10-16T10:00:00Z",
          lastSeenAt: "2026-10-16T10:00:00Z",
        },
      ],
    });
    expect(seen[0].headers.get("authorization")).toBe("Bearer tok-123");
  });

  it("201 registers and sends id, name and runtime version", async () => {
    const seen: Request[] = [];
    const f = scripted({ "/v1/installations": [{ status: 201, body: installation }] }, seen);
    const r = await registerInstallation(ORIGIN, "tok-123", req, f);
    expect(r).toMatchObject({ kind: "registered", installation: { name: "laptop" } });
    expect(seen[0].method).toBe("POST");
    expect(await seen[0].json()).toEqual({ installation_id: req.installationId, name: "laptop", runtime_version: "v0.3.0" });
    expect(seen[0].headers.get("authorization")).toBe("Bearer tok-123");
  });

  it("200 is an update of an existing registration; no version is not sent", async () => {
    const seen: Request[] = [];
    const f = scripted({ "/v1/installations": [{ status: 200, body: installation }] }, seen);
    expect((await registerInstallation(ORIGIN, "t", { ...req, runtimeVersion: undefined }, f)).kind).toBe("updated");
    expect(await seen[0].json()).toEqual({ installation_id: req.installationId, name: "laptop" });
  });

  it("403 developer_license_required", async () => {
    const f = scripted({ "/v1/installations": [{ status: 403, body: { error: "developer_license_required", message: "claim it" } }] });
    expect(await registerInstallation(ORIGIN, "t", req, f)).toEqual({ kind: "developer_license_required", message: "claim it" });
  });

  it("409 installation_limit_reached carries the list", async () => {
    const f = scripted({
      "/v1/installations": [{ status: 409, body: { error: "installation_limit_reached", limit: 5, installations: [installation] } }],
    });
    const r = await registerInstallation(ORIGIN, "t", req, f);
    expect(r).toMatchObject({ kind: "limit_reached", limit: 5, installations: [{ name: "laptop" }] });
  });

  it("401 is UnauthorizedError; 400 carries the server's message", async () => {
    const f = scripted({
      "/v1/installations": [
        { status: 401, body: { error: "unauthenticated" } },
        { status: 400, body: { error: "invalid_installation_id", message: "installation_id must be a UUID" } },
        { status: 403, body: { error: "forbidden" } },
      ],
    });
    await expect(registerInstallation(ORIGIN, "t", req, f)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(registerInstallation(ORIGIN, "t", req, f)).rejects.toThrow(/must be a UUID/);
    await expect(registerInstallation(ORIGIN, "t", req, f)).rejects.toThrow(/forbidden/);
  });

  it("removes with DELETE; 404 means it was not registered", async () => {
    const seen: Request[] = [];
    const path = `/v1/installations/${installation.installation_id}`;
    const f = scripted(
      {
        [path]: [
          { status: 204, body: "" },
          { status: 404, body: { error: "not_found" } },
          { status: 401, body: {} },
        ],
      },
      seen,
    );
    expect(await removeInstallation(ORIGIN, "tok-123", installation.installation_id, f)).toBe(true);
    expect(seen[0].method).toBe("DELETE");
    expect(seen[0].headers.get("authorization")).toBe("Bearer tok-123");
    expect(await removeInstallation(ORIGIN, "t", installation.installation_id, f)).toBe(false);
    await expect(removeInstallation(ORIGIN, "t", installation.installation_id, f)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("escapes the id in the path", async () => {
    const seen: Request[] = [];
    await removeInstallation(ORIGIN, "t", "a/../b", scripted({}, seen)).catch(() => undefined);
    expect(new URL(seen[0].url).pathname).toBe("/v1/installations/a%2F..%2Fb");
  });
});
