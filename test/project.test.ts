import { describe, expect, it } from "vitest";
import { detectProject, projectConfig, projectTemplate } from "../src/project/detect";

describe("detectProject", () => {
  it.each([
    [["package.json", "tsconfig.json"], "typescript"],
    [["package.json"], "javascript"],
    [["pyproject.toml"], "python"],
    [["requirements.txt"], "python"],
    [["go.mod"], "go"],
    [["README.md"], "other"],
    [[], "other"],
  ])("%j → %s", (files, kind) => {
    expect(detectProject(files)).toBe(kind);
  });
});

describe("projectConfig", () => {
  it("holds no key, only the variable that carries it", () => {
    const c = JSON.parse(projectConfig("http://localhost:8900", "m"));
    expect(c).toEqual({ runtime: { url: "http://localhost:8900" }, model: "m", apiKeyEnv: "LIBRA_OS_API_KEY" });
  });
});

describe("projectTemplate", () => {
  for (const kind of ["typescript", "javascript", "python", "go", "other"] as const) {
    it(`${kind} reads the key from LIBRA_OS_API_KEY and names the model`, () => {
      const t = projectTemplate(kind, "Qwen/Qwen3.6-35B-A3B");
      expect(t.quickstart).toContain("LIBRA_OS_API_KEY");
      expect(t.quickstart).toContain('"Qwen/Qwen3.6-35B-A3B"');
      expect(t.quickstart).not.toMatch(/nk_|msk_/);
    });
  }

  it("only Python installs a package", () => {
    expect(projectTemplate("python", "m").installCommand).toBe("pip install libraos-sdk");
    expect(projectTemplate("typescript", "m").installCommand).toBeUndefined();
  });
});

import { FASTAPI_LAUNCH_NAME, fastapiTemplate, mergeLaunch, usesFastApi } from "../src/project/detect";

describe("FastAPI", () => {
  it("recognises FastAPI in requirements, pyproject and Pipfile text", () => {
    expect(usesFastApi("fastapi==0.115.12\nuvicorn")).toBe(true);
    expect(usesFastApi('[project]\ndependencies = ["fastapi>=0.110", "httpx"]')).toBe(true);
    expect(usesFastApi("[packages]\nfastapi = \"*\"")).toBe(true);
    expect(usesFastApi("flask\nhttpx")).toBe(false);
    expect(usesFastApi("starlette  # not fastapi-based")).toBe(true); // a comment naming it counts; harmless
    expect(usesFastApi("django")).toBe(false);
  });

  it("writes a FastAPI app that uses the project key, end_user and the configured model", () => {
    const t = fastapiTemplate("qwen-x");
    expect(t.quickstartFile).toBe("libraos_app.py");
    expect(t.quickstart).toContain('api_key=os.environ["LIBRA_OS_API_KEY"]');
    expect(t.quickstart).toContain("end_user=body.user_id");
    expect(t.quickstart).toContain('model="qwen-x"');
    expect(t.installCommand).toContain("fastapi");
    expect(t.launch).toMatchObject({ name: FASTAPI_LAUNCH_NAME, type: "debugpy", module: "uvicorn", console: "integratedTerminal" });
  });

  it("adds the launch configuration and keeps existing ones", () => {
    const cfg = fastapiTemplate("m").launch!;
    const fresh = JSON.parse(mergeLaunch(undefined, cfg)!);
    expect(fresh).toEqual({ version: "0.2.0", configurations: [cfg] });
    const existing = JSON.stringify({ version: "0.2.0", configurations: [{ name: "Mine", type: "node" }], compounds: [] });
    const merged = JSON.parse(mergeLaunch(existing, cfg)!);
    expect(merged.configurations.map((c: { name: string }) => c.name)).toEqual(["Mine", FASTAPI_LAUNCH_NAME]);
    expect(merged.compounds).toEqual([]);
  });

  it("does not touch a launch.json with comments, or add the configuration twice", () => {
    expect(mergeLaunch('{\n  // mine\n  "configurations": []\n}', fastapiTemplate("m").launch!)).toBeUndefined();
    const once = mergeLaunch(undefined, fastapiTemplate("m").launch!)!;
    expect(mergeLaunch(once, fastapiTemplate("m").launch!)).toBeUndefined();
  });
});
