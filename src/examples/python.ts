// The Python environment for downloaded examples: a `.venv` in the local copy
// with the examples' pinned requirements, which VS Code's Run and Debug use.
// No VS Code API here, so it can be tested directly.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import * as path from "node:path";

export type ExecFn = (file: string, args: string[], opts?: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string }>;

// libraos-sdk needs Python 3.10 or newer; the cookbook is tested on 3.12.
export const MIN_PYTHON: [number, number] = [3, 10];

export interface PythonCommand {
  file: string;
  args: string[]; // arguments that come before the script, e.g. ["-3"] for the Windows launcher
  version: string;
}

/** Interpreters to try, newest first. A plain `python3` can be too old. */
export function pythonCandidates(platform: NodeJS.Platform): { file: string; args: string[] }[] {
  const named = ["3.13", "3.12", "3.11", "3.10"].map((v) => ({ file: `python${v}`, args: [] as string[] }));
  if (platform === "win32") {
    return [
      ...["3.13", "3.12", "3.11", "3.10"].map((v) => ({ file: "py", args: [`-${v}`] })),
      { file: "py", args: ["-3"] },
      { file: "python", args: [] },
    ];
  }
  return [...named, { file: "python3", args: [] }, { file: "python", args: [] }];
}

export function parseVersion(out: string): [number, number] | undefined {
  const m = /(\d+)\.(\d+)/.exec(out.trim());
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

export function versionOk(v: [number, number]): boolean {
  return v[0] > MIN_PYTHON[0] || (v[0] === MIN_PYTHON[0] && v[1] >= MIN_PYTHON[1]);
}

/** The first interpreter on this machine new enough for the SDK. */
export async function findPython(exec: ExecFn, platform: NodeJS.Platform): Promise<PythonCommand | undefined> {
  for (const c of pythonCandidates(platform)) {
    try {
      const { stdout } = await exec(c.file, [...c.args, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], { timeout: 10000 });
      const v = parseVersion(stdout);
      if (v && versionOk(v)) return { ...c, version: stdout.trim() };
    } catch {
      // not installed, or not runnable: try the next one
    }
  }
  return undefined;
}

export function venvDir(root: string): string {
  return path.join(root, ".venv");
}

export function venvPython(root: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? path.join(venvDir(root), "Scripts", "python.exe") : path.join(venvDir(root), "bin", "python");
}

/** The interpreter path as VS Code settings should record it, relative to the folder. */
export function interpreterSetting(platform: NodeJS.Platform): string {
  return platform === "win32" ? "${workspaceFolder}\\.venv\\Scripts\\python.exe" : "${workspaceFolder}/.venv/bin/python";
}

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export interface SetupStep {
  label: string;
  file: string;
  args: string[];
}

/** The commands that create the environment, shown to the person before they run. */
export function setupSteps(root: string, py: PythonCommand, platform: NodeJS.Platform, requirements: string[], haveVenv: boolean): SetupStep[] {
  const vpy = venvPython(root, platform);
  const steps: SetupStep[] = [];
  if (!haveVenv) steps.push({ label: "Create .venv", file: py.file, args: [...py.args, "-m", "venv", venvDir(root)] });
  steps.push({ label: "Install requirements", file: vpy, args: ["-m", "pip", "install", "--disable-pip-version-check", ...requirements] });
  return steps;
}

export function displayStep(s: SetupStep, root: string): string {
  const rel = (a: string) => (a.startsWith(root + path.sep) ? path.relative(root, a) : a);
  const q = (a: string) => (/[\s"'$`\\]/.test(a) && !a.startsWith("-") ? JSON.stringify(a) : a);
  return [rel(s.file), ...s.args.map(rel)].map(q).join(" ");
}

/** Whether the environment can already import the SDK. */
export async function hasSdk(exec: ExecFn, root: string, platform: NodeJS.Platform): Promise<boolean> {
  const vpy = venvPython(root, platform);
  if (!(await exists(vpy))) return false;
  try {
    await exec(vpy, ["-c", "import libraos, httpx"], { timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Points the folder's VS Code Python interpreter at its `.venv`, keeping any
 * other settings already in `.vscode/settings.json`. Returns false when the
 * file exists but is not plain JSON, in which case it is left unchanged.
 */
export async function writeInterpreterSetting(root: string, platform: NodeJS.Platform): Promise<boolean> {
  const file = path.join(root, ".vscode", "settings.json");
  let settings: Record<string, unknown> = {};
  if (await exists(file)) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      settings = parsed as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  settings["python.defaultInterpreterPath"] = interpreterSetting(platform);
  settings["python.terminal.activateEnvironment"] = true;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(settings, null, 2) + "\n");
  return true;
}
