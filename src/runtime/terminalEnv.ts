// Which LibraOS variables each workspace folder's terminals get. Pure, so the
// rules can be tested without VS Code:
// - A Get Example folder whose Run and Debug use this Runtime gets the runtime
//   URL and a setup token (as LIBRA_OS_API_KEY and LIBRA_OS_SETUP_TOKEN).
// - Any other folder with a project key gets the runtime URL and that key.
// - Everything else gets nothing.

export interface FolderInfo {
  id: string;
  isExamples: boolean;
  projectKey?: string;
}

export function terminalEnv(
  folders: FolderInfo[],
  opts: { baseUrl: string; examplesToken?: string },
): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const f of folders) {
    if (f.isExamples && opts.examplesToken) {
      out.set(f.id, { LIBRA_OS_URL: opts.baseUrl, LIBRA_OS_API_KEY: opts.examplesToken, LIBRA_OS_SETUP_TOKEN: opts.examplesToken });
    } else if (f.projectKey) {
      out.set(f.id, { LIBRA_OS_URL: opts.baseUrl, LIBRA_OS_API_KEY: f.projectKey });
    }
  }
  return out;
}

/** When to renew a token: ten minutes before it expires, and never sooner than a minute. */
export function renewIn(expiresAt: number, now: number): number {
  return Math.max(60_000, expiresAt - now - 10 * 60_000);
}
