import { describe, expect, it } from "vitest";
import {
  ExplorerClient,
  ExplorerError,
  agentsBoundTo,
  bindingViews,
  boundAgentIds,
  callSummaryText,
  collapseCallRows,
  formatLogRow,
  logKey,
  retrieveMarkdown,
  type Collection,
} from "../src/explorer/client";

const col = (id: string, extra: Partial<Collection> = {}): Collection => ({ id, name: id, document_count: 2, chunk_count: 9, ...extra });

describe("bindings", () => {
  it("reads agent ids from either string or object bindings", () => {
    expect(boundAgentIds(col("kb", { agent_bindings: ["a", { agent_id: "b" }, { id: "c" }, 7, null] }))).toEqual(["a", "b", "c"]);
  });

  it("marks a binding to a collection the runtime does not have", () => {
    const views = bindingViews({ id: "agent", knowledge_bindings: ["handbook", "missing"] }, [col("handbook")]);
    expect(views.map((v) => [v.id, v.exists])).toEqual([
      ["handbook", true],
      ["missing", false],
    ]);
  });

  it("joins bindings from both the agent and the collection side", () => {
    const agents = [{ id: "x", knowledge_bindings: ["kb"] }, { id: "y" }];
    expect(agentsBoundTo(col("kb", { agent_bindings: ["z"] }), agents)).toEqual(["x", "z"]);
  });
});

describe("text", () => {
  it("summarises calls", () => {
    expect(callSummaryText({ agent_id: "a", total_calls: 0, error_count: 0, avg_latency_ms: 0, total_tokens: 0 })).toBe("no calls yet");
    expect(callSummaryText({ agent_id: "a", total_calls: 3, error_count: 1, avg_latency_ms: 812.6, total_tokens: 1450 })).toBe(
      "3 calls · 1 error · avg 813 ms · 1450 tokens",
    );
  });

  it("formats an agent call as one line with agent, model, latency and tokens", () => {
    const row = { ts: "2026-10-16T23:50:01Z", level: "info", msg: "ok first-assistant", fields: { agent_id: "first-assistant", model: "qwen", latency_ms: 950, prompt_tokens: 100, completion_tokens: 20 } };
    const plain = formatLogRow(row, "requests", false);
    expect(plain).toMatch(/^\d\d:\d\d:\d\d CALL  ok first-assistant  agent=first-assistant  model=qwen  950 ms  120 tokens$/);
    expect(formatLogRow(row, "requests", true)).toContain("\x1b[");
  });

  it("does not repeat the agent and model when the runtime's message already names them", () => {
    const row = { ts: "2026-10-16T23:48:10Z", level: "error", msg: "call error agent=demo model=none err=refused", fields: { agent_id: "demo", model: "none", latency_ms: 1327, prompt_tokens: 0, completion_tokens: 0 } };
    expect(formatLogRow(row, "requests", false)).toMatch(/CALL  call error agent=demo model=none err=refused  1327 ms  0 tokens$/);
  });

  it("formats server rows with their level and fields on one line", () => {
    const plain = formatLogRow({ ts: "2026-10-16T23:50:01Z", level: "warn", msg: "model preflight\nfailed", fields: { model: "none" } }, "server", false);
    expect(plain).toMatch(/WARN  model preflight failed  model=none$/);
  });

  it("keys rows so overlapping polls show each once", () => {
    const r = { ts: "t", level: "info", msg: "m" };
    expect(logKey(r, "server")).toBe(logKey({ ...r }, "server"));
    expect(logKey(r, "server")).not.toBe(logKey(r, "requests"));
  });

  it("explains an empty retrieval and lists the final chunks first", () => {
    expect(retrieveMarkdown({ query: "q", stages: {} })).toContain("No chunks matched");
    const md = retrieveMarkdown({
      query: "leave policy",
      stages: { fused: [{ id: "1", content: "Ten days", score: 0.5, source: "handbook.md" }], reranked: [{ id: "1", content: "Ten days of leave", score: 0.91, source: "handbook.md", collection: "hr" }] },
      took_ms: { total: 42 },
    });
    expect(md).toContain("### 1. handbook.md — score 0.910 · hr");
    expect(md).toContain("| fused | 1 | handbook.md | 0.500 |");
    expect(md).toContain("Took 42 ms.");
  });
});

describe("ExplorerClient", () => {
  const fake = (routes: Record<string, [number, unknown]>) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const path = url.replace("http://rt", "");
      const [status, body] = routes[path] ?? [404, { error: "not_found" }];
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it("sends the setup token and the API version header, and sorts agents", async () => {
    const { f, calls } = fake({ "/v1/agents": [200, { data: [{ id: "b" }, { id: "a" }], has_more: false }] });
    const c = new ExplorerClient("http://rt", async () => "tok", f);
    expect((await c.agents()).map((a) => a.id)).toEqual(["a", "b"]);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer tok");
    expect(h["anthropic-beta"]).toBe("managed-agents-2026-04-01");
  });

  it("asks for request rows and server rows with since and level", async () => {
    const { f, calls } = fake({});
    const c = new ExplorerClient("http://rt", async () => "tok", f);
    await c.logs({ source: "server", since: "2026-10-16T23:00:00.000Z", level: "warn" }).catch(() => undefined);
    expect(calls[0].url).toBe("http://rt/v1/managed/logs?source=server&limit=200&since=2026-10-16T23%3A00%3A00.000Z&level=warn");
  });

  it("reports the runtime's error message and refuses to call without a token", async () => {
    const { f } = fake({ "/api/knowledge/collections": [403, { error: "admin_required", message: "admin role required" }] });
    await expect(new ExplorerClient("http://rt", async () => "tok", f).collections()).rejects.toThrow(/HTTP 403 admin role required/);
    await expect(new ExplorerClient("http://rt", async () => undefined, f).collections()).rejects.toBeInstanceOf(ExplorerError);
  });
});

describe("collapseCallRows", () => {
  it("keeps one line per call: the model row, not the agent-level duplicate", () => {
    const rows = [
      { ts: "2026-10-17T00:42:45.120Z", level: "info", msg: "call success agent=ticket-router model=", fields: { agent_id: "ticket-router", model: "", latency_ms: 9558 } },
      { ts: "2026-10-17T00:42:45.130Z", level: "info", msg: "call success agent=ticket-router model=glm", fields: { agent_id: "ticket-router", model: "glm", latency_ms: 9557 } },
      { ts: "2026-10-17T00:43:00Z", level: "error", msg: "call error agent=x model=", fields: { agent_id: "x", model: "", latency_ms: 10 } },
    ];
    expect(collapseCallRows(rows).map((r) => r.msg)).toEqual(["call success agent=ticket-router model=glm", "call error agent=x model="]);
  });
});
