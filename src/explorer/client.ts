// Read-only client for the local runtime's monitoring endpoints, used by the
// Runtime Explorer and the runtime log terminal. These endpoints need an admin
// identity, so the token is a setup token for the runtime this extension
// manages. No VS Code API here, so it can be tested directly.

type Fetch = typeof fetch;

export interface AgentSummary {
  id: string;
  name?: string;
  model?: string;
  agent_type?: string;
  version?: number;
  created_at?: string;
}

export interface AgentDetail extends AgentSummary {
  system?: string;
  tool_scope?: string;
  knowledge_bindings?: string[];
  [key: string]: unknown;
}

export interface Collection {
  id: string;
  name?: string;
  description?: string;
  access_level?: string;
  document_count?: number;
  chunk_count?: number;
  agent_bindings?: unknown[];
  created_at?: string;
}

export interface CallSummary {
  agent_id: string;
  total_calls: number;
  error_count: number;
  avg_latency_ms: number;
  total_tokens: number;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
}

export interface MemoryHealth {
  agent_id: string;
  status?: string;
  total_entries?: number;
  scopes?: Record<string, unknown>;
}

export interface LogRow {
  ts: string;
  level: string;
  msg: string;
  fields?: Record<string, unknown>;
  request_id?: string;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  source?: string;
  score: number;
  collection?: string;
}

export interface RetrieveResult {
  query: string;
  stages: Partial<Record<"bm25" | "vector" | "fused" | "reranked" | "filtered", RetrievedChunk[] | null>>;
  took_ms?: Record<string, number>;
  trace_id?: string;
}

export class ExplorerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class ExplorerClient {
  constructor(
    private readonly base: string,
    private readonly token: () => Promise<string | undefined>,
    private readonly f: Fetch = fetch,
  ) {}

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    if (!token) throw new ExplorerError("no setup token for the local runtime");
    const r = await this.f(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        // The API version the SDK and the cookbook send; /v1/agents requires it.
        "anthropic-beta": "managed-agents-2026-04-01",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!r.ok) {
      const e = json as { error?: unknown; message?: unknown } | undefined;
      const detail = typeof e?.message === "string" ? e.message : typeof e?.error === "string" ? e.error : text.slice(0, 120);
      throw new ExplorerError(`${method} ${path}: HTTP ${r.status}${detail ? ` ${detail}` : ""}`, r.status);
    }
    return json as T;
  }

  // The runtime returns every agent in one response (has_more is always false).
  async agents(): Promise<AgentSummary[]> {
    const r = await this.req<{ data?: AgentSummary[] }>("GET", "/v1/agents");
    return [...(r?.data ?? [])].sort((x, y) => x.id.localeCompare(y.id));
  }

  agent(id: string): Promise<AgentDetail> {
    return this.req("GET", `/v1/agents/${encodeURIComponent(id)}`);
  }

  async collections(): Promise<Collection[]> {
    const r = await this.req<Collection[] | { collections?: Collection[] }>("GET", "/api/knowledge/collections");
    const list = Array.isArray(r) ? r : (r?.collections ?? []);
    return [...list].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  }

  callSummary(agentId: string): Promise<CallSummary> {
    return this.req("GET", `/api/call-log/agents/${encodeURIComponent(agentId)}/summary`);
  }

  memoryHealth(agentId: string): Promise<MemoryHealth> {
    return this.req("GET", `/api/memory-health/${encodeURIComponent(agentId)}`);
  }

  async logs(opts: { source: "server" | "requests"; since?: string; limit?: number; level?: string }): Promise<LogRow[]> {
    const q = new URLSearchParams({ source: opts.source, limit: String(opts.limit ?? 200) });
    if (opts.since) q.set("since", opts.since);
    if (opts.level) q.set("level", opts.level);
    const r = await this.req<{ logs?: LogRow[] }>("GET", `/v1/managed/logs?${q}`);
    return r?.logs ?? [];
  }

  debugRetrieve(query: string, collections?: string[], topK = 10): Promise<RetrieveResult> {
    return this.req("POST", "/api/knowledge/debug-retrieve", { query, collections: collections?.length ? collections : undefined, top_k: topK });
  }
}

/** The agent ids a collection lists as bound, whatever form the runtime uses. */
export function boundAgentIds(c: Collection): string[] {
  return (c.agent_bindings ?? [])
    .map((b) => (typeof b === "string" ? b : b && typeof b === "object" ? ((b as { agent_id?: unknown; id?: unknown }).agent_id ?? (b as { id?: unknown }).id) : undefined))
    .filter((x): x is string => typeof x === "string" && x.length > 0);
}

export interface BindingView {
  id: string;
  /** False when the agent names a collection the runtime does not have. */
  exists: boolean;
  collection?: Collection;
}

/** An agent's bindings joined with the collections that exist. */
export function bindingViews(agent: AgentDetail, collections: Collection[]): BindingView[] {
  return (agent.knowledge_bindings ?? []).map((id) => {
    const collection = collections.find((c) => c.id === id || c.name === id);
    return { id, exists: Boolean(collection), collection };
  });
}

/** Agents that a collection is bound to, from both directions of the data. */
export function agentsBoundTo(c: Collection, agents: AgentDetail[]): string[] {
  const ids = new Set(boundAgentIds(c));
  for (const a of agents) if ((a.knowledge_bindings ?? []).some((b) => b === c.id || b === c.name)) ids.add(a.id);
  return [...ids].sort();
}

export function callSummaryText(s: CallSummary): string {
  if (!s.total_calls) return "no calls yet";
  const errors = s.error_count ? ` · ${s.error_count} error${s.error_count === 1 ? "" : "s"}` : "";
  return `${s.total_calls} call${s.total_calls === 1 ? "" : "s"}${errors} · avg ${Math.round(s.avg_latency_ms)} ms · ${s.total_tokens} tokens`;
}

const LEVEL_COLOR: Record<string, string> = { error: "31", warn: "33", warning: "33", info: "36", debug: "90" };

/** One terminal line for a log row, with ANSI colour when `color` is set. */
export function formatLogRow(row: LogRow, source: "server" | "requests", color = true): string {
  const d = new Date(row.ts);
  const time = Number.isNaN(d.getTime()) ? row.ts : d.toTimeString().slice(0, 8);
  const level = (row.level || "info").toLowerCase();
  const tag = source === "requests" ? "call" : level;
  let detail = "";
  if (source === "requests" && row.fields) {
    const f = row.fields;
    // The runtime's message usually names the agent and model already.
    const named = /\bagent=/.test(row.msg);
    const parts = [
      f.agent_id && !named ? `agent=${f.agent_id}` : "",
      f.model && !named ? `model=${f.model}` : "",
      typeof f.latency_ms === "number" ? `${f.latency_ms} ms` : "",
      typeof f.prompt_tokens === "number" || typeof f.completion_tokens === "number" ? `${Number(f.prompt_tokens ?? 0) + Number(f.completion_tokens ?? 0)} tokens` : "",
    ].filter(Boolean);
    detail = parts.length ? `  ${parts.join("  ")}` : "";
  } else if (row.fields && Object.keys(row.fields).length) {
    detail = "  " + Object.entries(row.fields).slice(0, 6).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
  }
  const msg = row.msg.replace(/\r?\n/g, " ");
  const head = `${time} ${tag.toUpperCase().padEnd(5)}`;
  if (!color) return `${head} ${msg}${detail}`;
  const c = LEVEL_COLOR[level] ?? "37";
  return `\x1b[90m${time}\x1b[0m \x1b[${c}m${tag.toUpperCase().padEnd(5)}\x1b[0m ${msg}\x1b[90m${detail}\x1b[0m`;
}

/**
 * The runtime records an agent call twice: an agent-level row without a model
 * and the model call itself, with the same agent and latency. Keep the model
 * row, so each call is one line.
 */
export function collapseCallRows(rows: LogRow[]): LogRow[] {
  const f = (r: LogRow) => r.fields ?? {};
  return rows.filter((r) => {
    if (f(r).model) return true;
    const agent = f(r).agent_id;
    const latency = Number(f(r).latency_ms);
    const second = r.ts.slice(0, 19);
    return !rows.some(
      (o) => o !== r && f(o).model && f(o).agent_id === agent && o.ts.slice(0, 19) === second && Math.abs(Number(f(o).latency_ms) - latency) <= 5,
    );
  });
}

/** A stable key for a log row, to show each row once across overlapping polls. */
export function logKey(row: LogRow, source: string): string {
  return `${source}|${row.ts}|${row.request_id ?? ""}|${row.msg}`;
}

/** Markdown for a debug-retrieve result: the final chunks first, then each stage's ranking. */
export function retrieveMarkdown(r: RetrieveResult): string {
  const lines: string[] = [`# Retrieval for “${r.query}”`, ""];
  const final = r.stages.filtered?.length ? r.stages.filtered : r.stages.reranked?.length ? r.stages.reranked : (r.stages.fused ?? []);
  if (r.took_ms?.total !== undefined) lines.push(`Took ${r.took_ms.total} ms.`, "");
  if (!final?.length) {
    lines.push("No chunks matched. Check that the collection has documents, and that an embedding model is configured for vector search.");
    return lines.join("\n");
  }
  lines.push("## What the agent would get", "");
  final.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.source || c.id} — score ${c.score.toFixed(3)}${c.collection ? ` · ${c.collection}` : ""}`, "", "> " + c.content.trim().replace(/\n+/g, "\n> ").slice(0, 1200), "");
  });
  lines.push("## Ranking by stage", "", "| Stage | Chunks | Top source | Top score |", "|---|---|---|---|");
  for (const s of ["bm25", "vector", "fused", "reranked", "filtered"] as const) {
    const list = r.stages[s] ?? [];
    lines.push(`| ${s} | ${list.length} | ${list[0]?.source || list[0]?.id || "—"} | ${list[0] ? list[0].score.toFixed(3) : "—"} |`);
  }
  return lines.join("\n");
}
