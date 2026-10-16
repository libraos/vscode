import { describe, expect, it } from "vitest";
import { adminToken, health, mintServiceKey, RuntimeApiError } from "../src/runtime/api";

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
