// Calls to a running runtime. Only the endpoints the extension needs.

export interface Health {
  ok: boolean;
  version?: string;
}

type Fetch = typeof fetch;

export function runtimeUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function health(base: string, f: Fetch = fetch, timeoutMs = 3000): Promise<Health> {
  try {
    const r = await f(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false };
    let version: string | undefined;
    try {
      const v = await f(`${base}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
      if (v.ok) {
        const body = (await v.json()) as Record<string, unknown>;
        const raw = body.libraos_version ?? body.nova_os_version ?? body.version;
        version = typeof raw === "string" ? raw : undefined;
      }
    } catch {
      // Version is cosmetic.
    }
    return { ok: true, version };
  } catch {
    return { ok: false };
  }
}

export class RuntimeApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function postJson(f: Fetch, url: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await f(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Non-JSON error bodies fall through to the status check.
  }
  if (!r.ok) {
    const reason = typeof json.error === "string" ? json.error : `HTTP ${r.status}`;
    throw new RuntimeApiError(`${new URL(url).pathname}: ${reason}`, r.status);
  }
  return json;
}

// Signs in as the local runtime's admin, whose password the extension
// generated. Never used for a person's own password.
export async function adminToken(base: string, email: string, password: string, f: Fetch = fetch): Promise<string> {
  const body = await postJson(f, `${base}/api/auth/login`, { email, password });
  const token = body.access_token;
  if (typeof token !== "string" || !token) throw new RuntimeApiError("login returned no token");
  return token;
}

export interface SetupToken {
  token: string;
  expiresAt: number;
}

/** The runtime has no setup client: it was started before the extension added one. */
export class SetupClientMissing extends RuntimeApiError {}

// Exchanges the setup client's secret for a short-lived admin token
// (OAuth client_credentials). Used by "Copy Setup Token".
export async function setupToken(base: string, clientId: string, secret: string, f: Fetch = fetch, now = Date.now): Promise<SetupToken> {
  const r = await f(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: secret }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const code = typeof body.error === "string" ? body.error : "";
    if (code === "unsupported_grant_type" || code === "invalid_client" || code === "unauthorized_client") {
      throw new SetupClientMissing(`the runtime has no setup client yet (${code})`);
    }
    throw new RuntimeApiError(`setup token request failed: HTTP ${r.status}${code ? ` ${code}` : ""}`);
  }
  const token = body.access_token;
  if (typeof token !== "string" || !token) throw new RuntimeApiError("setup token response had no token");
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  return { token, expiresAt: now() + expiresIn * 1000 };
}

export interface MintedKey {
  id: string;
  secret: string;
}

// Mints an inference-scoped service key for the developer's app.
export async function mintServiceKey(base: string, token: string, name: string, f: Fetch = fetch): Promise<MintedKey> {
  const body = await postJson(f, `${base}/api/service-keys`, { name }, token);
  if (typeof body.secret !== "string" || typeof body.id !== "string") {
    throw new RuntimeApiError("service key response missing secret");
  }
  return { id: body.id, secret: body.secret };
}

export interface RuntimeInstallation {
  installationId: string;
  persistent: boolean;
  version?: string;
}

// The runtime's installation id (admin only). A runtime older than this
// endpoint answers 404. Nothing here leaves the machine: the runtime is on
// 127.0.0.1 and the admin token is used only against it.
export async function getInstallation(base: string, token: string, f: Fetch = fetch): Promise<RuntimeInstallation> {
  const url = `${base}/v1/managed/installation`;
  const r = await f(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Non-JSON error bodies fall through to the status check.
  }
  if (!r.ok) {
    const reason = typeof json.error === "string" ? json.error : `HTTP ${r.status}`;
    throw new RuntimeApiError(`/v1/managed/installation: ${reason}`, r.status);
  }
  const id = json.installation_id;
  if (typeof id !== "string" || !id) throw new RuntimeApiError("/v1/managed/installation: response had no installation_id");
  return {
    installationId: id,
    persistent: json.persistent === true,
    version: typeof json.version === "string" && json.version ? json.version : undefined,
  };
}
