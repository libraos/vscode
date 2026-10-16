// Calls to the LibraOS Developer Console API: device sign-in (RFC 8628) and
// licence records. No VS Code imports, so it is unit-tested directly.
//
// The session token is sent only to the Console origin it was issued by, only
// in the Authorization header, and never appears in an error message.

type Fetch = typeof fetch;

export const CLIENT_ID = "libraos-vscode";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const TIMEOUT_MS = 15000;
// RFC 8628 §3.5: on slow_down the interval grows by 5 seconds.
const SLOW_DOWN_STEP_S = 5;

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// The session is no longer accepted: expired, or the account is gone.
export class UnauthorizedError extends CloudError {
  constructor() {
    super("your LibraOS session has ended", 401, "unauthenticated");
  }
}

// The Console origin, e.g. "https://console.libraos.com". Plain http is
// allowed only on loopback, so a session token never crosses a network in
// the clear.
export function consoleOrigin(consoleUrl: string): string {
  let u: URL;
  try {
    u = new URL(consoleUrl.trim());
  } catch {
    throw new CloudError(`the Console URL is not a valid URL: ${consoleUrl}`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    throw new CloudError("the Console URL must use https");
  }
  return u.origin;
}

async function call(
  f: Fetch,
  url: string,
  init: RequestInit & { token?: string; form?: Record<string, string>; json?: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (init.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  } else if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const path = new URL(url).pathname;
  let r: Response;
  try {
    r = await f(url, {
      method: init.method ?? "GET",
      headers,
      body,
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    const name = (err as { name?: string })?.name;
    throw new CloudError(
      name === "TimeoutError" ? `${path}: the Console did not answer in time` : `${path}: could not reach the Console`,
    );
  }
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON bodies (a proxy's error page) fall through to the status.
  }
  return { status: r.status, body: json };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function fail(path: string, status: number, body: Record<string, unknown>): never {
  if (status === 401) throw new UnauthorizedError();
  const code = str(body.error);
  const detail = str(body.message) ?? str(body.error_description);
  if (status === 501) throw new CloudError(`${path}: not available on this Console`, status, code ?? "not_implemented", body);
  if (status === 429) throw new CloudError(`${path}: too many requests; try again shortly`, status, code ?? "rate_limited", body);
  throw new CloudError(`${path}: ${detail ?? code ?? `HTTP ${status}`}`, status, code, body);
}

// ---- Device sign-in ---------------------------------------------------------

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number; // seconds
  interval: number; // seconds
}

export async function requestDeviceCode(origin: string, f: Fetch = fetch): Promise<DeviceCode> {
  const { status, body } = await call(f, `${origin}/v1/device/code`, { method: "POST", form: { client_id: CLIENT_ID } });
  if (status !== 200) fail("/v1/device/code", status, body);
  const deviceCode = str(body.device_code);
  const userCode = str(body.user_code);
  const verificationUri = str(body.verification_uri);
  if (!deviceCode || !userCode || !verificationUri) throw new CloudError("/v1/device/code: incomplete response");
  const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: str(body.verification_uri_complete),
    expiresIn: num(body.expires_in, 900),
    interval: num(body.interval, 5),
  };
}

export interface Session {
  token: string;
  expiresAt: number; // epoch ms
  email?: string;
  workspace?: string;
}

export type DeviceFailure = "expired" | "denied" | "cancelled";

export class DeviceFlowError extends CloudError {
  constructor(
    readonly reason: DeviceFailure,
    message: string,
  ) {
    super(message, undefined, reason);
  }
}

export interface PollOptions {
  fetch?: Fetch;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  // Network failures in a row tolerated before giving up.
  maxTransientErrors?: number;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Polls /v1/device/token until the person approves or denies, the code
// expires, or the signal is aborted. Waits `interval` before each poll and
// adds 5 s on every slow_down, as RFC 8628 requires.
export async function pollDeviceToken(origin: string, code: DeviceCode, opts: PollOptions = {}): Promise<Session> {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? abortableSleep;
  const maxTransient = opts.maxTransientErrors ?? 5;
  const deadline = now() + code.expiresIn * 1000;
  let interval = code.interval;
  let transient = 0;

  const cancelled = () => new DeviceFlowError("cancelled", "sign-in cancelled");
  for (;;) {
    if (opts.signal?.aborted) throw cancelled();
    try {
      await sleep(interval * 1000, opts.signal);
    } catch {
      throw cancelled();
    }
    if (now() >= deadline) throw new DeviceFlowError("expired", "the sign-in code expired; start again");

    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await call(f, `${origin}/v1/device/token`, {
        method: "POST",
        signal: opts.signal,
        form: { grant_type: DEVICE_GRANT, device_code: code.deviceCode, client_id: CLIENT_ID },
      });
    } catch (err) {
      if (opts.signal?.aborted) throw cancelled();
      if (++transient > maxTransient) throw err;
      continue;
    }
    const { status, body } = res;
    if (status >= 500 || status === 429) {
      if (status === 429) interval += SLOW_DOWN_STEP_S;
      if (++transient > maxTransient) fail("/v1/device/token", status, body);
      continue;
    }
    transient = 0;

    if (status === 200) {
      const token = str(body.access_token);
      if (!token) throw new CloudError("/v1/device/token: response had no token");
      const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 24 * 3600;
      return { token, expiresAt: now() + expiresIn * 1000, email: str(body.email), workspace: str(body.workspace) };
    }
    switch (str(body.error)) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += SLOW_DOWN_STEP_S;
        continue;
      case "expired_token":
        throw new DeviceFlowError("expired", "the sign-in code expired; start again");
      case "access_denied":
        throw new DeviceFlowError("denied", str(body.error_description) ?? "the sign-in was denied");
      default:
        fail("/v1/device/token", status, body);
    }
  }
}

// ---- Licences ---------------------------------------------------------------

export interface Terms {
  version: string;
  name: string;
  url?: string;
  summary: string;
}

export interface Licence {
  licenseId: string;
  edition: string;
  classification?: string;
  status: string;
  productionAllowed: boolean;
  issuedAt?: string;
  expiresAt?: string;
  termsVersion?: string;
  source?: string;
}

function toTerms(b: Record<string, unknown>): Terms {
  const version = str(b.terms_version);
  if (!version) throw new CloudError("/v1/licenses/terms: response had no terms_version");
  return { version, name: str(b.name) ?? "LibraOS Developer Terms", url: str(b.url), summary: str(b.summary) ?? "" };
}

function toLicence(b: unknown): Licence | undefined {
  if (!b || typeof b !== "object") return undefined;
  const r = b as Record<string, unknown>;
  const id = str(r.license_id);
  if (!id) return undefined;
  return {
    licenseId: id,
    edition: str(r.edition) ?? "unknown",
    classification: str(r.classification),
    status: str(r.status) ?? "unknown",
    productionAllowed: r.production_allowed === true,
    issuedAt: str(r.issued_at),
    expiresAt: str(r.expires_at),
    termsVersion: str(r.terms_version),
    source: str(r.source),
  };
}

// The Developer Licence terms. A current Console lists each edition under
// `editions`; an older one has only the top-level fields, which describe the
// developer licence there too.
export async function getTerms(origin: string, f: Fetch = fetch): Promise<Terms> {
  const { status, body } = await call(f, `${origin}/v1/licenses/terms`, {});
  if (status !== 200) fail("/v1/licenses/terms", status, body);
  const editions = body.editions;
  if (editions && typeof editions === "object" && !Array.isArray(editions)) {
    const dev = (editions as Record<string, unknown>).developer;
    if (dev && typeof dev === "object" && str((dev as Record<string, unknown>).terms_version)) {
      return toTerms(dev as Record<string, unknown>);
    }
  }
  return toTerms(body);
}

export async function listLicences(origin: string, token: string, f: Fetch = fetch): Promise<Licence[]> {
  const { status, body } = await call(f, `${origin}/v1/licenses`, { token });
  if (status !== 200) fail("/v1/licenses", status, body);
  const list = Array.isArray(body.licenses) ? body.licenses : [];
  return list.map(toLicence).filter((l): l is Licence => Boolean(l));
}

export type GrantResult =
  | { kind: "granted"; licence: Licence } // 201: first claim
  | { kind: "existing"; licence: Licence } // 200: already claimed and active
  | { kind: "terms_outdated"; terms: Terms; message?: string }
  | { kind: "already_evaluated"; licence?: Licence; message?: string };

export async function grantDeveloperLicence(
  origin: string,
  token: string,
  termsVersion: string,
  f: Fetch = fetch,
): Promise<GrantResult> {
  const { status, body } = await call(f, `${origin}/v1/licenses/developer/grant`, {
    method: "POST",
    token,
    json: { terms_version: termsVersion, accepted: true },
  });
  if (status === 200 || status === 201) {
    const licence = toLicence(body);
    if (!licence) throw new CloudError("/v1/licenses/developer/grant: response had no licence");
    return { kind: status === 201 ? "granted" : "existing", licence };
  }
  if (status === 409) {
    const code = str(body.error);
    if (code === "terms_outdated" && body.terms && typeof body.terms === "object") {
      return { kind: "terms_outdated", terms: toTerms(body.terms as Record<string, unknown>), message: str(body.message) };
    }
    if (code === "already_evaluated") {
      return { kind: "already_evaluated", licence: toLicence(body.license), message: str(body.message) };
    }
  }
  fail("/v1/licenses/developer/grant", status, body);
}

// ---- Installations (a Developer Licence benefit) ----------------------------

export interface Installation {
  installationId: string;
  name: string;
  runtimeVersion?: string;
  registeredAt?: string;
  lastSeenAt?: string;
}

export interface InstallationList {
  limit: number;
  installations: Installation[];
}

export const DEFAULT_INSTALLATION_LIMIT = 5;

function toInstallation(b: unknown): Installation | undefined {
  if (!b || typeof b !== "object") return undefined;
  const r = b as Record<string, unknown>;
  const id = str(r.installation_id);
  if (!id) return undefined;
  return {
    installationId: id,
    name: str(r.name) ?? id,
    runtimeVersion: str(r.runtime_version),
    registeredAt: str(r.registered_at),
    lastSeenAt: str(r.last_seen_at),
  };
}

function toInstallationList(body: Record<string, unknown>): InstallationList {
  const list = Array.isArray(body.installations) ? body.installations : [];
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : DEFAULT_INSTALLATION_LIMIT;
  return { limit, installations: list.map(toInstallation).filter((i): i is Installation => Boolean(i)) };
}

export async function listInstallations(origin: string, token: string, f: Fetch = fetch): Promise<InstallationList> {
  const { status, body } = await call(f, `${origin}/v1/installations`, { token });
  if (status !== 200) fail("/v1/installations", status, body);
  return toInstallationList(body);
}

export interface RegisterRequest {
  installationId: string;
  name: string;
  runtimeVersion?: string;
}

export type RegisterResult =
  | { kind: "registered"; installation?: Installation } // 201
  | { kind: "updated"; installation?: Installation } // 200: already registered
  | { kind: "developer_license_required"; message?: string } // 403
  | { kind: "limit_reached"; limit: number; installations: Installation[]; message?: string }; // 409

export async function registerInstallation(
  origin: string,
  token: string,
  req: RegisterRequest,
  f: Fetch = fetch,
): Promise<RegisterResult> {
  const json: Record<string, string> = { installation_id: req.installationId, name: req.name };
  if (req.runtimeVersion) json.runtime_version = req.runtimeVersion;
  const { status, body } = await call(f, `${origin}/v1/installations`, { method: "POST", token, json });
  if (status === 200 || status === 201) {
    return { kind: status === 201 ? "registered" : "updated", installation: toInstallation(body) };
  }
  const code = str(body.error);
  if (status === 403 && code === "developer_license_required") {
    return { kind: "developer_license_required", message: str(body.message) };
  }
  if (status === 409 && code === "installation_limit_reached") {
    return { kind: "limit_reached", ...toInstallationList(body), message: str(body.message) };
  }
  fail("/v1/installations", status, body);
}

// Removes a registered installation. False when it was not registered (404),
// which leaves the same outcome.
export async function removeInstallation(origin: string, token: string, installationId: string, f: Fetch = fetch): Promise<boolean> {
  const path = `/v1/installations/${encodeURIComponent(installationId)}`;
  const { status, body } = await call(f, `${origin}${path}`, { method: "DELETE", token });
  if (status === 204 || status === 200) return true;
  if (status === 404) return false;
  fail("/v1/installations/{id}", status, body);
}
