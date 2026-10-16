// Downloads example files from a public libraos GitHub repository into a
// local folder, keeping the repository's layout so the examples' relative
// paths (../.env, ../../shared/…) keep working. No VS Code API here, so it can
// be tested directly.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface RemoteFile {
  path: string;
  size: number;
}

export interface RemoteTree {
  sha: string;
  files: RemoteFile[];
}

// A single example never needs more than this; the limits stop a surprise
// repository change from filling a disk.
export const MAX_FILES = 400;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

// Written into each local copy. It records what was downloaded and marks the
// folder as one the extension manages.
export const SOURCE_FILE = ".libraos/source.json";

export interface SourceInfo {
  repo: string;
  ref: string;
  treeSha: string;
  fetchedAt: string;
  paths: string[];
}

export async function fetchTree(repo: string, fetchFn: FetchFn, ref = "main"): Promise<RemoteTree> {
  const url = `https://api.github.com/repos/libraos/${repo}/git/trees/${ref}?recursive=1`;
  const r = await fetchFn(url, { signal: AbortSignal.timeout(20000) });
  if (r.status === 403 || r.status === 429) throw new Error("GitHub's rate limit for anonymous requests was reached; try again in a few minutes");
  if (!r.ok) throw new Error(`could not list libraos/${repo} on GitHub (HTTP ${r.status})`);
  const body = (await r.json()) as { sha?: string; truncated?: boolean; tree?: { path: string; type: string; size?: number }[] };
  if (!body.sha || !Array.isArray(body.tree)) throw new Error(`unexpected listing from GitHub for libraos/${repo}`);
  if (body.truncated) throw new Error(`the listing of libraos/${repo} is too large to download file by file`);
  return {
    sha: body.sha,
    files: body.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, size: t.size ?? 0 })),
  };
}

/**
 * The files to download. `scope` is "all" for the whole repository, or a list
 * of repository paths: a path selects that file, or every file under it when
 * it names a directory.
 */
export function selectFiles(tree: RemoteTree, scope: "all" | string[]): RemoteFile[] {
  const wanted =
    scope === "all"
      ? tree.files
      : tree.files.filter((f) => scope.some((p) => f.path === p || f.path.startsWith(p.replace(/\/$/, "") + "/")));
  const files = wanted.filter((f) => f.size <= MAX_FILE_BYTES && isSafeRelative(f.path));
  if (files.length > MAX_FILES) throw new Error(`refusing to download ${files.length} files (limit ${MAX_FILES})`);
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error(`refusing to download ${Math.round(total / 1e6)} MB (limit ${MAX_TOTAL_BYTES / 1e6} MB)`);
  return files;
}

export function isSafeRelative(p: string): boolean {
  if (!p || p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** Resolves a repository path inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  if (!isSafeRelative(rel)) throw new Error(`unsafe path from the repository: ${rel}`);
  const full = path.resolve(root, ...rel.split("/"));
  const base = path.resolve(root) + path.sep;
  if (!full.startsWith(base)) throw new Error(`unsafe path from the repository: ${rel}`);
  return full;
}

export function rawFileUrl(repo: string, rel: string, ref = "main"): string {
  return `https://raw.githubusercontent.com/libraos/${repo}/${ref}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Downloads `files` into `root`. Existing files with the same path are
 * replaced; nothing else in `root` is touched or deleted, so a local `.env`,
 * `.venv` or your own files survive an update.
 */
export async function downloadFiles(
  root: string,
  repo: string,
  files: RemoteFile[],
  fetchFn: FetchFn,
  opts: { ref?: string; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<number> {
  const queue = [...files];
  let done = 0;
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const dest = safeJoin(root, f.path);
      const r = await fetchFn(rawFileUrl(repo, f.path, opts.ref), { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`could not download ${f.path} (HTTP ${r.status})`);
      const data = new Uint8Array(await r.arrayBuffer());
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, data);
      done++;
      opts.onProgress?.(done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, files.length || 1) }, worker));
  return done;
}

export async function readSource(root: string): Promise<SourceInfo | undefined> {
  try {
    const info = JSON.parse(await readFile(path.join(root, ...SOURCE_FILE.split("/")), "utf8")) as SourceInfo;
    return typeof info.treeSha === "string" && Array.isArray(info.paths) ? info : undefined;
  } catch {
    return undefined;
  }
}

export async function writeSource(root: string, info: SourceInfo): Promise<void> {
  const file = path.join(root, ...SOURCE_FILE.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(info, null, 2) + "\n");
}

/** Whether every file an example needs is already in the local copy's record. */
export function covers(info: SourceInfo | undefined, scope: "all" | string[]): boolean {
  if (!info) return false;
  if (info.paths.includes("*")) return true;
  if (scope === "all") return false;
  return scope.every((p) => info.paths.includes(p));
}
