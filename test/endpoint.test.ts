import { describe, expect, it } from "vitest";
import { apiRoot, listModels, testModel } from "../src/model/endpoint";

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("apiRoot", () => {
  it.each([
    ["https://api.meganova.ai", "https://api.meganova.ai/v1"],
    ["http://127.0.0.1:8318/v1", "http://127.0.0.1:8318/v1"],
    ["http://127.0.0.1:8318/v1/", "http://127.0.0.1:8318/v1"],
  ])("%s → %s", (a, b) => expect(apiRoot(a)).toBe(b));
});

describe("listModels", () => {
  it("returns sorted ids", async () => {
    expect(await listModels("http://x", "k", respond(200, { data: [{ id: "b" }, { id: "a" }, { nope: 1 }] }))).toEqual(["a", "b"]);
  });

  it("throws on an HTTP error", async () => {
    await expect(listModels("http://x", "k", respond(401, { error: "bad key" }))).rejects.toThrow(/401/);
  });

  it("sends the key as a bearer token", async () => {
    let auth: string | null = null;
    const f = (async (_: unknown, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ data: [] }));
    }) as typeof fetch;
    await listModels("http://x", "secret", f);
    expect(auth).toBe("Bearer secret");
  });
});

describe("testModel", () => {
  it("reports the reply", async () => {
    const r = await testModel("http://x", "m", "k", respond(200, { choices: [{ message: { content: " ready " } }] }));
    expect(r).toMatchObject({ ok: true, reply: "ready" });
  });

  it("reports failure without throwing", async () => {
    const r = await testModel("http://x", "m", "k", respond(404, { error: "unknown model" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 404/);
  });
});

import { embeddingBase, testEmbedding } from "../src/model/endpoint";

describe("embeddings", () => {
  it("drops /v1 from the base, because the runtime appends /v1/embeddings", () => {
    expect(embeddingBase("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(embeddingBase("https://api.meganova.ai/")).toBe("https://api.meganova.ai");
  });

  it("reports the dimension of a working embedding model", async () => {
    let url = "";
    const f = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await testEmbedding("http://127.0.0.1:11434", "nomic-embed-text", undefined, f)).toMatchObject({ ok: true, dims: 3 });
    expect(url).toBe("http://127.0.0.1:11434/v1/embeddings");
  });

  it("explains a chat-only endpoint's 404", async () => {
    const f = (async () => new Response('{"error":{"message":"File Not Found"}}', { status: 404 })) as unknown as typeof fetch;
    const t = await testEmbedding("http://127.0.0.1:30000/v1", "glm", undefined, f);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/HTTP 404/);
  });
});
