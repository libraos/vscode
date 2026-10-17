// Calls straight to an OpenAI-compatible model endpoint, from the extension,
// to list its models and test one before the runtime is pointed at it.

type Fetch = typeof fetch;

// Accepts a base with or without the /v1 suffix.
export function apiRoot(base: string): string {
  const b = base.replace(/\/+$/, "");
  return /\/v1$/.test(b) ? b : `${b}/v1`;
}

function headers(key?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function listModels(base: string, key?: string, f: Fetch = fetch): Promise<string[]> {
  const r = await f(`${apiRoot(base)}/models`, { headers: headers(key), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`listing models: HTTP ${r.status}`);
  const body = (await r.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
}

export interface ModelTest {
  ok: boolean;
  ms: number;
  reply?: string;
  error?: string;
}

// One tiny chat call. Never throws: a failed test is a result to show.
export async function testModel(base: string, model: string, key?: string, f: Fetch = fetch): Promise<ModelTest> {
  const t0 = Date.now();
  try {
    const r = await f(`${apiRoot(base)}/chat/completions`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    const body = JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] };
    const reply = body.choices?.[0]?.message?.content;
    return { ok: true, ms: Date.now() - t0, reply: typeof reply === "string" ? reply.trim() : "" };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: String(err) };
  }
}

// The runtime appends /v1/embeddings to LIBRA_OS_EMBEDDING_API_BASE itself, so
// the base it is given must not end in /v1 (it would call /v1/v1/embeddings).
export function embeddingBase(base: string): string {
  return base.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export interface EmbeddingTest {
  ok: boolean;
  ms: number;
  dims?: number;
  error?: string;
}

// One embedding call, so a wrong endpoint or model is caught before the
// runtime fails at ingest with "embedding API error 404".
export async function testEmbedding(base: string, model: string, key?: string, f: Fetch = fetch): Promise<EmbeddingTest> {
  const t0 = Date.now();
  try {
    const r = await f(`${apiRoot(base)}/embeddings`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ model, input: "LibraOS embedding check" }),
      signal: AbortSignal.timeout(60000),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    const body = JSON.parse(text) as { data?: { embedding?: unknown[] }[] };
    const v = body.data?.[0]?.embedding;
    if (!Array.isArray(v) || v.length === 0) return { ok: false, ms: Date.now() - t0, error: "the response had no embedding" };
    return { ok: true, ms: Date.now() - t0, dims: v.length };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: String(err) };
  }
}
