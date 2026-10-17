import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  EXAMPLES,
  downloadScope,
  findExample,
  getExampleText,
  isPython,
  localFolderName,
  isRunnable,
  pythonRequirements,
  readsTokenFromEnv,
  runCommand,
  runLine,
  runScope,
  variants,
} from "../src/examples/catalog";
import {
  MAX_FILES,
  covers,
  downloadFiles,
  fetchTree,
  rawFileUrl,
  readSource,
  safeJoin,
  selectFiles,
  writeSource,
  type FetchFn,
  type RemoteTree,
} from "../src/examples/download";
import {
  displayStep,
  findPython,
  interpreterSetting,
  setupSteps,
  venvPython,
  writeInterpreterSetting,
  type ExecFn,
} from "../src/examples/python";

const ex = (id: string) => findExample(id)!;
const tmp = () => mkdtemp(path.join(os.tmpdir(), "libraos-getexample-"));

function fakeFetch(files: Record<string, string>, treeSha = "t1"): { fn: FetchFn; urls: string[] } {
  const urls: string[] = [];
  const fn: FetchFn = async (url) => {
    urls.push(url);
    if (url.startsWith("https://api.github.com/")) {
      const body = { sha: treeSha, truncated: false, tree: Object.entries(files).map(([p, c]) => ({ path: p, type: "blob", size: c.length })) };
      return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const rel = decodeURIComponent(url.replace(/^https:\/\/raw\.githubusercontent\.com\/libraos\/[^/]+\/main\//, ""));
    const c = files[rel];
    return c === undefined
      ? { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new TextEncoder().encode(c).buffer as ArrayBuffer };
  };
  return { fn, urls };
}

describe("catalog: Get Example data", () => {
  it("gives every example a main file and run directory inside its own folder", () => {
    for (const e of EXAMPLES) {
      expect(e.main.startsWith(`${e.dir}/`), `${e.id} main`).toBe(true);
      expect(e.run.cwd === e.dir || e.run.cwd.startsWith(`${e.dir}/`), `${e.id} cwd`).toBe(true);
      expect(e.run.command.length).toBeGreaterThan(0);
    }
  });

  it("copies the whole cookbook, so shared files and ../ paths work, but only the chosen SDK files", () => {
    expect(downloadScope(ex("mission-console"))).toBe("all");
    expect(downloadScope(ex("first-agent"))).toBe("all");
    expect(downloadScope(ex("py-quickstart"))).toEqual(["python/examples/00_quickstart.py", "python/README.md"]);
    expect(localFolderName("cookbook")).toBe("libraos-cookbook");
    expect(localFolderName("sdk")).toBe("libraos-sdk-examples");
  });

  it("installs the cookbook's pinned requirements, and the same pins for SDK examples", () => {
    expect(pythonRequirements(ex("first-agent"), "/x/libraos-cookbook", path.join)).toEqual(["-r", path.join("/x/libraos-cookbook", "requirements-dev.txt")]);
    expect(pythonRequirements(ex("py-quickstart"), "/x", path.join)).toContain("libraos-sdk==2.0.0");
  });

  it("types a run command that uses the examples' .venv interpreter", () => {
    const py = variants(ex("first-agent"))[0].command;
    expect(runLine(py, "/home/a/libraos-cookbook/.venv/bin/python", "linux")).toBe("/home/a/libraos-cookbook/.venv/bin/python first-agent.py");
    expect(runLine(py, "/Users/a b/libraos-cookbook/.venv/bin/python", "darwin")).toBe("'/Users/a b/libraos-cookbook/.venv/bin/python' first-agent.py");
    expect(runLine(ex("async-jobs").run.command, "C:\\u\\libraos-cookbook\\.venv\\Scripts\\python.exe", "win32")).toBe(
      '& "C:\\u\\libraos-cookbook\\.venv\\Scripts\\python.exe" async_jobs.py submit --receipt job-receipt.json',
    );
    expect(isPython(ex("personal-assistant"))).toBe(false);
    expect(runLine(ex("personal-assistant").run.command, "unused", "linux")).toBe("npm install && npm run dev");
  });

  it("lists First Agent as three entries, one script each", () => {
    for (const [id, file, cmd] of [
      ["first-agent", "first-agent.py", "{python} first-agent.py"],
      ["first-agent-ts", "first-agent.ts", "npx -y tsx first-agent.ts"],
      ["first-agent-sh", "first-agent.sh", "bash first-agent.sh"],
    ]) {
      expect(variants(ex(id))).toEqual([{ label: expect.any(String), main: `get-started/01-first-agent/${file}`, command: cmd }]);
    }
    expect(ex("first-agent-ts").tokenSince).toBe("libraos/cookbook#18");
  });

  it("says on the card what Get Example does", () => {
    expect(getExampleText(ex("first-agent"))).toContain("▶ Run Example");
    expect(getExampleText(ex("tool-calling"))).toContain("libraos-cookbook");
    expect(getExampleText(ex("tool-calling"))).toContain("Python environment");
    expect(getExampleText(ex("marketing-team"))).not.toContain("Python");
    expect(getExampleText(ex("py-quickstart"))).toContain("libraos-sdk-examples");
  });
});

describe("download", () => {
  const tree: RemoteTree = {
    sha: "t1",
    files: [
      { path: "recipes/a/a.py", size: 10 },
      { path: "recipes/a/README.md", size: 10 },
      { path: "recipes/ab/x.py", size: 10 },
      { path: "big.bin", size: 6 * 1024 * 1024 },
      { path: "../escape", size: 1 },
    ],
  };

  it("selects a directory's files exactly, skipping oversized and unsafe paths", () => {
    expect(selectFiles(tree, ["recipes/a"]).map((f) => f.path)).toEqual(["recipes/a/a.py", "recipes/a/README.md"]);
    expect(selectFiles(tree, "all").map((f) => f.path)).toEqual(["recipes/a/a.py", "recipes/a/README.md", "recipes/ab/x.py"]);
  });

  it("refuses an unexpectedly large download", () => {
    const many: RemoteTree = { sha: "x", files: Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ path: `f${i}`, size: 1 })) };
    expect(() => selectFiles(many, "all")).toThrow(/refusing/);
  });

  it("never writes outside the local copy", () => {
    expect(() => safeJoin("/r", "../x")).toThrow(/unsafe/);
    expect(() => safeJoin("/r", "/etc/passwd")).toThrow(/unsafe/);
    expect(() => safeJoin("/r", "a/../../x")).toThrow(/unsafe/);
    expect(safeJoin("/r", "a/b.py")).toBe(path.resolve("/r", "a", "b.py"));
  });

  it("reports GitHub rate limiting plainly", async () => {
    const fn: FetchFn = async () => ({ ok: false, status: 403, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(fetchTree("cookbook", fn)).rejects.toThrow(/rate limit/);
  });

  it("downloads files into the repository layout and keeps local files on update", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "get-started"), { recursive: true });
    await writeFile(path.join(root, "get-started", ".env"), "LOCAL=1\n");
    const upstream = { "get-started/01-first-agent/first-agent.py": "print('v2')\n", "get-started/.env.example": "X=\n", "dir with space/f.md": "ok" };
    const { fn, urls } = fakeFetch(upstream);
    const t = await fetchTree("cookbook", fn);
    const n = await downloadFiles(root, "cookbook", selectFiles(t, "all"), fn);
    expect(n).toBe(3);
    expect(await readFile(path.join(root, "get-started", "01-first-agent", "first-agent.py"), "utf8")).toBe("print('v2')\n");
    expect(await readFile(path.join(root, "get-started", ".env"), "utf8")).toBe("LOCAL=1\n");
    expect(urls).toContain(rawFileUrl("cookbook", "dir with space/f.md"));
    expect(rawFileUrl("cookbook", "dir with space/f.md")).toBe("https://raw.githubusercontent.com/libraos/cookbook/main/dir%20with%20space/f.md");
  });

  it("fails on a missing file instead of leaving a silent gap", async () => {
    const root = await tmp();
    const { fn } = fakeFetch({});
    await expect(downloadFiles(root, "cookbook", [{ path: "gone.py", size: 1 }], fn)).rejects.toThrow(/gone\.py.*404/);
  });

  it("records what a local copy holds", async () => {
    const root = await tmp();
    expect(await readSource(root)).toBeUndefined();
    await writeSource(root, { repo: "sdk", ref: "main", treeSha: "t", fetchedAt: "now", paths: ["python/examples/00_quickstart.py"] });
    const info = await readSource(root);
    expect(covers(info, ["python/examples/00_quickstart.py"])).toBe(true);
    expect(covers(info, ["python/examples/09_streaming_messages.py"])).toBe(false);
    expect(covers({ ...info!, paths: ["*"] }, "all")).toBe(true);
    expect(covers(undefined, "all")).toBe(false);
  });
});

describe("python", () => {
  const fakeExec =
    (versions: Record<string, string>): ExecFn =>
    async (file, args) => {
      const key = [file, ...args.filter((a) => /^-\d/.test(a))].join(" ");
      if (!(key in versions)) throw new Error("ENOENT");
      return { stdout: versions[key] + "\n", stderr: "" };
    };

  it("skips a python3 that is too old and finds a newer interpreter", async () => {
    const py = await findPython(fakeExec({ python3: "3.8.10", "python3.12": "3.12.13" }), "linux");
    expect(py).toMatchObject({ file: "python3.12", version: "3.12.13" });
  });

  it("uses plain python3 when it is new enough", async () => {
    expect(await findPython(fakeExec({ python3: "3.11.4" }), "darwin")).toMatchObject({ file: "python3" });
  });

  it("uses the Windows launcher", async () => {
    expect(await findPython(fakeExec({ "py -3.12": "3.12.1" }), "win32")).toMatchObject({ file: "py", args: ["-3.12"] });
  });

  it("finds nothing when every interpreter is too old or missing", async () => {
    expect(await findPython(fakeExec({ python3: "3.9.2", python: "2.7.18" }), "linux")).toBeUndefined();
  });

  it("creates the venv only when missing, then installs into it", () => {
    const root = "/h/libraos-cookbook";
    const py = { file: "python3.12", args: [], version: "3.12.13" };
    const steps = setupSteps(root, py, "linux", ["-r", `${root}/requirements-dev.txt`], false);
    expect(steps.map((s) => displayStep(s, root))).toEqual([
      "python3.12 -m venv .venv",
      ".venv/bin/python -m pip install --disable-pip-version-check -r requirements-dev.txt",
    ]);
    expect(setupSteps(root, py, "linux", ["x"], true)).toHaveLength(1);
    expect(venvPython("C:\\c", "win32")).toMatch(/\.venv[\\/]Scripts[\\/]python\.exe$/);
  });

  it("points VS Code's Python at the .venv and keeps other settings", async () => {
    const root = await tmp();
    await mkdir(path.join(root, ".vscode"));
    await writeFile(path.join(root, ".vscode", "settings.json"), JSON.stringify({ "editor.tabSize": 2 }));
    expect(await writeInterpreterSetting(root, "linux")).toBe(true);
    const s = JSON.parse(await readFile(path.join(root, ".vscode", "settings.json"), "utf8"));
    expect(s).toMatchObject({ "editor.tabSize": 2, "python.defaultInterpreterPath": interpreterSetting("linux") });
  });

  it("leaves a settings file with comments alone", async () => {
    const root = await tmp();
    await mkdir(path.join(root, ".vscode"));
    const jsonc = '{\n  // mine\n  "a": 1\n}\n';
    await writeFile(path.join(root, ".vscode", "settings.json"), jsonc);
    expect(await writeInterpreterSetting(root, "linux")).toBe(false);
    expect(await readFile(path.join(root, ".vscode", "settings.json"), "utf8")).toBe(jsonc);
  });
});

describe("Run Example", () => {
  it("runs only the examples the extension's runtime can serve", () => {
    expect(EXAMPLES.filter(isRunnable).map((e) => e.id)).toEqual(["first-agent", "first-agent-ts", "first-agent-sh", "ticket-routing", "document-qa", "async-jobs"]);
  });

  it("downloads only the example's folder and what it reads from outside it", () => {
    expect(runScope(ex("first-agent-ts"))).toEqual(["get-started/01-first-agent", "get-started/README.md", "requirements-dev.txt", "get-started/package.json"]);
    expect(runScope(ex("tool-calling"))).toBe("all");
    expect(runScope(ex("py-quickstart"))).toEqual(["python/examples/00_quickstart.py", "python/README.md"]);
  });

  it("submits and then resumes the async job in one run, starting from a fresh receipt", () => {
    expect(runCommand(ex("async-jobs"), "linux")).toBe(
      "rm -f job-receipt.json && {python} async_jobs.py submit --receipt job-receipt.json && {python} async_jobs.py resume --receipt job-receipt.json --timeout 300",
    );
    expect(runCommand(ex("async-jobs"), "win32").startsWith("Remove-Item -ErrorAction SilentlyContinue job-receipt.json; ")).toBe(true);
    expect(runCommand(ex("first-agent"), "linux")).toBe("{python} first-agent.py");
    // Every {python} is filled in, not only the first.
    expect(runLine(runCommand(ex("async-jobs"), "linux"), "/v/python", "linux")).toBe(
      "rm -f job-receipt.json && /v/python async_jobs.py submit --receipt job-receipt.json && /v/python async_jobs.py resume --receipt job-receipt.json --timeout 300",
    );
  });

  it("recognises scripts that take their token from LIBRA_OS_API_KEY", () => {
    expect(readsTokenFromEnv('token = os.environ.get("LIBRA_OS_API_KEY")')).toBe(true);
    expect(readsTokenFromEnv("secret = env.LIBRA_OS_SERVICE_CLIENTS")).toBe(false);
  });
});
