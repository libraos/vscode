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
