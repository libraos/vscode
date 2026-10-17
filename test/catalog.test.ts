import { describe, expect, it } from "vitest";
import {
  EXAMPLES,
  GUIDES,
  PATHS,
  SETUP_GUIDE,
  badge,
  directoryUrl,
  exampleCard,
  examplesFor,
  findExample,
  isMultiFile,
  rawUrl,
  canUseSetupToken,
  runtimeFit,
  tutorialUrl,
  validationText,
} from "../src/examples/catalog";

const ex = (id: string) => {
  const e = findExample(id);
  if (!e) throw new Error(`missing example ${id}`);
  return e;
};

describe("catalog structure", () => {
  it("has unique ids, and every example is on at least one known path", () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    const known = new Set(PATHS.map((p) => p.id));
    for (const e of EXAMPLES) {
      expect(e.paths.length).toBeGreaterThan(0);
      for (const p of e.paths) expect(known.has(p)).toBe(true);
    }
  });

  it("offers the cookbook's three entry points first, then SDK examples", () => {
    expect(PATHS.map((p) => p.label)).toEqual([
      "Learn Step by Step",
      "Explore by Capability",
      "See Complete Applications",
      "SDK Examples",
    ]);
  });

  it("orders Learn Step by Step from L1 to L4", () => {
    const learn = examplesFor("learn");
    expect(learn.map((e) => e.id)).toEqual([
      "first-agent",
      "first-agent-ts",
      "first-agent-sh",
      "ticket-routing",
      "document-qa",
      "tool-calling",
      "memory-isolation",
      "customer-support",
      "async-jobs",
      "personal-assistant",
      "marketing-team",
    ]);
    for (const e of learn) expect(e.level).toBeDefined();
  });

  it("lists one example per capability, in the cookbook's order", () => {
    expect(examplesFor("capability").map((e) => e.capability)).toEqual(["Knowledge", "Tools", "Memory", "Async"]);
    expect(badge(ex("tool-calling"), "capability")).toBe("Tools");
    expect(badge(ex("tool-calling"), "learn")).toBe("L2 · Tools");
  });

  it("lists the complete applications and no entry for the planned Existing App Integration", () => {
    expect(examplesFor("apps").map((e) => e.id)).toEqual(["personal-assistant", "marketing-team", "mission-console"]);
    for (const e of EXAMPLES) expect(`${e.id} ${e.title} ${e.dir}`.toLowerCase()).not.toMatch(/existing.app|integration/);
  });

  it("keeps SDK examples identified as SDK examples", () => {
    for (const e of examplesFor("sdk")) {
      expect(e.repo).toBe("sdk");
      expect(e.paths).toEqual(["sdk"]);
      expect(badge(e)).toBe("SDK");
    }
    for (const e of EXAMPLES.filter((x) => x.repo === "sdk")) expect(e.paths).toEqual(["sdk"]);
  });

  it("includes the Python First Agent", () => {
    expect(ex("first-agent").files?.map((f) => f.path)).toContain("get-started/01-first-agent/first-agent.py");
  });
});

describe("tutorial and source routing", () => {
  it("sends Open Tutorial to a Markdown file on GitHub main", () => {
    for (const e of EXAMPLES) {
      expect(tutorialUrl(e)).toMatch(/^https:\/\/github\.com\/libraos\/(cookbook|sdk)\/blob\/main\/.+\.md$/);
    }
    expect(tutorialUrl(ex("memory-isolation"))).toBe(
      "https://github.com/libraos/cookbook/blob/main/recipes/memory-isolation/README.md",
    );
  });

  it("routes multi-file examples to their repository directory, never to one copied file", () => {
    for (const id of ["tool-calling", "memory-isolation", "async-jobs", "customer-support", "ticket-routing", "personal-assistant", "marketing-team", "mission-console"]) {
      const e = ex(id);
      expect(isMultiFile(e)).toBe(true);
      expect(e.files).toBeUndefined();
      expect(directoryUrl(e)).toBe(`https://github.com/libraos/cookbook/tree/main/${e.dir}`);
      expect(exampleCard(e)).toContain("with the rest of the cookbook");
    }
  });

  it("opens single-file examples from raw GitHub main, inside their own directory", () => {
    for (const e of EXAMPLES.filter((x) => !isMultiFile(x))) {
      for (const f of e.files!) {
        expect(f.path.startsWith(`${e.dir}/`)).toBe(true);
        expect(rawUrl(e, f)).toBe(`https://raw.githubusercontent.com/libraos/${e.repo}/main/${f.path}`);
      }
    }
  });

  it("links the cookbook guides", () => {
    for (const url of Object.values(GUIDES)) expect(url).toMatch(/^https:\/\/github\.com\/libraos\/cookbook\/blob\/main\/.+\.md$/);
  });
});

describe("prerequisites and runtime guidance", () => {
  it("requires two distinct ordinary users for memory isolation, not the project key", () => {
    const card = exampleCard(ex("memory-isolation"));
    expect(card).toContain("Two distinct ordinary users");
    expect(card).toContain("project API key alone is not enough");
    expect(card).toContain("LIBRA_OS_OBSERVATIONAL_MEMORY=1");
  });

  it("names the switches, mounts and callback setup each example needs", () => {
    const tools = exampleCard(ex("tool-calling"));
    expect(tools).toContain("callback secret");
    expect(tools).toContain("app folder mounted");
    expect(exampleCard(ex("marketing-team"))).toContain("LIBRA_OS_WORKFLOWS_ENABLED=true");
    expect(exampleCard(ex("personal-assistant"))).toContain("LIBRA_OS_OIDC_CLIENTS");
    expect(exampleCard(ex("personal-assistant"))).toContain("embedding model");
  });

  it("never implies the extension-managed Runtime is configured for an example that needs more", () => {
    for (const e of EXAMPLES.filter((x) => runtimeFit(x) === "cookbook")) {
      expect(exampleCard(e)).toContain("The Runtime this extension manages is not");
    }
    // The project key never stands in for a setup identity.
    expect(exampleCard(ex("tool-calling"))).toContain("cannot create agents");
    expect(exampleCard(ex("first-agent"))).toContain("The project API key cannot");
  });

  it("runs on the extension's Runtime with a setup token only where the script reads it and nothing else is missing", () => {
    expect(EXAMPLES.filter((e) => runtimeFit(e) === "setupToken").map((e) => e.id)).toEqual([
      "first-agent",
      "first-agent-ts",
      "first-agent-sh",
      "ticket-routing",
      "document-qa",
      "async-jobs",
    ]);
    expect(canUseSetupToken(ex("first-agent-ts"))).toBe(true);
    expect(canUseSetupToken(ex("memory-isolation"))).toBe(false); // memory switch and two users
    expect(canUseSetupToken(ex("tool-calling"))).toBe(false); // mount and callback
    expect(exampleCard(ex("first-agent"))).toContain("click it to run it with a setup token");
    expect(exampleCard(ex("async-jobs"))).toContain("“first-assistant” must exist first: run First Agent the same way");
  });

  it("keeps native HTTP async recovery distinct from the SDK's managed jobs", () => {
    const native = exampleCard(ex("async-jobs"));
    expect(native).toContain("/agents/v1/{agent}/jobs");
    expect(native).toContain("Not the SDK's managed jobs client");
    const sdk = exampleCard(ex("py-async-job"));
    expect(sdk).toContain("/v1/managed/agents/jobs");
    expect(sdk).toContain("v0.2.2, the version this extension pins, does not serve it");
    expect(sdk).toContain("HTTP Async Job & Recovery");
    for (const e of EXAMPLES) expect(exampleCard(e)).not.toMatch(/1708/);
  });

  it("states the tested versions and when to use the cookbook setup", () => {
    expect(SETUP_GUIDE).toContain("Runtime v0.2.2 and libraos-sdk 2.0.0");
    expect(SETUP_GUIDE).toContain("inference-scoped project API key");
    expect(SETUP_GUIDE).toContain("does not change its Runtime for an example");
    expect(SETUP_GUIDE).toContain("Copy Setup Token");
    expect(SETUP_GUIDE).toContain("port 8900");
  });
});

describe("validation status", () => {
  it("marks the new P0 recipes as offline-tested only, without live verification", () => {
    for (const id of ["tool-calling", "memory-isolation", "async-jobs"]) {
      expect(validationText(ex(id))).toContain("Live Runtime and model runs have not been recorded");
    }
  });

  it("says on every card that a listing is not a compatibility certification", () => {
    for (const e of EXAMPLES) expect(exampleCard(e)).toContain("not a compatibility certification");
  });
});
