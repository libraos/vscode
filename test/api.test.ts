import { describe, expect, it } from "vitest";
import { adminToken, getInstallation, health, mintServiceKey, RuntimeApiError } from "../src/runtime/api";

function fakeFetch(routes: Record<string, { status: number; body: unknown }>, seen: Request[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    const r = routes[new URL(req.url).pathname];
    if (!r) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
}

describe("health", () => {
  it("reports ok and the runtime version", async () => {
    const f = fakeFetch({ "/health": { status: 200, body: {} }, "/api/version": { status: 200, body: { nova_os_version: "v0.2.2" } } });
    expect(await health("http://x", f)).toEqual({ ok: true, version: "v0.2.2" });
  });

  it("reports not ok when unreachable", async () => {
    expect(await health("http://x", fakeFetch({}))).toEqual({ ok: false });
  });
});

describe("adminToken and mintServiceKey", () => {
  it("logs in, then mints with the bearer token", async () => {
    const seen: Request[] = [];
    const f = fakeFetch(
      {
        "/api/auth/login": { status: 200, body: { access_token: "tok" } },
        "/api/service-keys": { status: 201, body: { id: "k1", secret: "nk_abc" } },
      },
      seen,
    );
    const token = await adminToken("http://x", "a@b", "pw", f);
    expect(token).toBe("tok");
    expect(await mintServiceKey("http://x", token, "vscode:app", f)).toEqual({ id: "k1", secret: "nk_abc" });
    expect(seen[1].headers.get("authorization")).toBe("Bearer tok");
    expect(await seen[1].json()).toEqual({ name: "vscode:app" });
  });

  it("surfaces the server's error code", async () => {
    const f = fakeFetch({ "/api/service-keys": { status: 403, body: { error: "admin_required" } } });
    await expect(mintServiceKey("http://x", "t", "n", f)).rejects.toThrow(RuntimeApiError);
    await expect(mintServiceKey("http://x", "t", "n", f)).rejects.toThrow(/admin_required/);
  });
});

describe("getInstallation", () => {
  it("reads the installation id with the admin token", async () => {
    const seen: Request[] = [];
    const f = fakeFetch(
      { "/v1/managed/installation": { status: 200, body: { installation_id: "uuid-1", persistent: true, version: "v0.3.0" } } },
      seen,
    );
    expect(await getInstallation("http://127.0.0.1:8900", "tok", f)).toEqual({ installationId: "uuid-1", persistent: true, version: "v0.3.0" });
    expect(seen[0].headers.get("authorization")).toBe("Bearer tok");
    expect(seen[0].method).toBe("GET");
  });

  it("reports a non-persistent id", async () => {
    const f = fakeFetch({ "/v1/managed/installation": { status: 200, body: { installation_id: "u", persistent: false } } });
    expect(await getInstallation("http://x", "t", f)).toEqual({ installationId: "u", persistent: false, version: undefined });
  });

  it("an older runtime answers 404", async () => {
    const f = fakeFetch({ "/v1/managed/installation": { status: 404, body: { error: "not_found" } } });
    const err = await getInstallation("http://x", "t", f).catch((e) => e);
    expect(err).toBeInstanceOf(RuntimeApiError);
    expect(err.status).toBe(404);
  });

  it("refuses a response without an id", async () => {
    const f = fakeFetch({ "/v1/managed/installation": { status: 200, body: {} } });
    await expect(getInstallation("http://x", "t", f)).rejects.toThrow(/no installation_id/);
  });
});
