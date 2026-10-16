// End-to-end check of the local runtime path against real Docker and a real
// model endpoint. Skipped unless LIBRAOS_E2E=1. Needs LIBRAOS_E2E_MODEL_KEY
// (a key for the model endpoint) and leaves nothing behind. Optional:
// LIBRAOS_E2E_MODEL_BASE / _MODEL pick the endpoint and model.
//
//   LIBRAOS_E2E=1 LIBRAOS_E2E_MODEL_KEY=... npx vitest run test/e2e.runtime.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { SETUP_CLIENT_ID, composeEnv, composeFile, networkModeFor, randomSecret } from "../src/runtime/compose";
import { adminToken, health, mintServiceKey, runtimeUrl, setupToken } from "../src/runtime/api";
import { run } from "../src/runtime/docker";
import { projectTemplate } from "../src/project/detect";

const enabled = process.env.LIBRAOS_E2E === "1";
const port = Number(process.env.LIBRAOS_E2E_PORT ?? 8955);
const project = "libraos-vscode-e2e";
const model = process.env.LIBRAOS_E2E_MODEL ?? "Qwen/Qwen3.6-35B-A3B";
const modelBase = process.env.LIBRAOS_E2E_MODEL_BASE ?? "https://api.meganova.ai";
const mode = networkModeFor(process.platform);
const image =
  process.env.LIBRAOS_E2E_IMAGE ??
  "ghcr.io/libraos/libraos:v0.2.2@sha256:0ccb121cd5760af47a91c491010a63123030533ebe516bd732d94a0575dccdc2";

describe.skipIf(!enabled)("local runtime end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "libraos-e2e-"));
  const file = join(dir, "docker-compose.yml");
  const secrets = {
    pgPassword: randomSecret(24, randomBytes),
    jwtSecret: randomSecret(32, randomBytes),
    adminPassword: randomSecret(24, randomBytes),
    setupClientSecret: randomSecret(32, randomBytes),
  };
  const env = composeEnv(
    {
      image,
      port,
      pgPort: Number(process.env.LIBRAOS_E2E_PG_PORT ?? 55955),
      mode,
      modelBaseUrl: modelBase,
      modelName: model,
      modelApiKey: process.env.LIBRAOS_E2E_MODEL_KEY,
    },
    secrets,
  );
  const compose = (...cmd: string[]) => run("docker", ["compose", "-f", file, "-p", project, ...cmd], { env });
  const base = runtimeUrl(port);
  let apiKey = "";

  afterAll(async () => {
    await compose("down", "-v");
  }, 120_000);

  it("starts and becomes healthy", async () => {
    writeFileSync(file, composeFile(mode));
    const up = await compose("up", "-d");
    expect(up.code, up.output).toBe(0);
    const deadline = Date.now() + 180_000;
    let h = await health(base);
    while (!h.ok && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      h = await health(base);
    }
    if (!h.ok) console.log((await compose("logs", "--tail", "80", "libraos")).output);
    expect(h.ok).toBe(true);
    console.log("runtime version:", h.version);
  }, 240_000);

  it("mints a project key with the generated admin credentials", async () => {
    const token = await adminToken(base, env.LIBRA_OS_ADMIN_EMAIL, secrets.adminPassword);
    const key = await mintServiceKey(base, token, "vscode:e2e");
    expect(key.secret).toBeTruthy();
    apiKey = key.secret;
  }, 30_000);

  const createAgent = (token: string, name: string) =>
    fetch(`${base}/v1/agents`, {
      method: "POST",
      // The version header the SDK and the cookbook's examples send.
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "anthropic-beta": "managed-agents-2026-04-01" },
      body: JSON.stringify({ name, agent_type: "persona", tool_scope: "none", system: "Reply briefly." }),
    });

  it("the project key cannot create agents, which is why examples need a setup token", async () => {
    const r = await createAgent(apiKey, "e2e-denied");
    expect(r.status).toBe(403);
    expect(await r.text()).toMatch(/api_key_scope/);
  }, 30_000);

  it("a setup token from the setup client creates agents and expires in about an hour", async () => {
    const t = await setupToken(base, SETUP_CLIENT_ID, secrets.setupClientSecret);
    const minutes = (t.expiresAt - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(55);
    expect(minutes).toBeLessThanOrEqual(60);
    const r = await createAgent(t.token, "e2e-setup-token");
    expect([200, 201]).toContain(r.status);
  }, 30_000);

  it("a wrong setup secret gets no token", async () => {
    await expect(setupToken(base, SETUP_CLIENT_ID, "wrong")).rejects.toThrow();
  }, 30_000);

  // The cookbook's Python First Agent with the token mapped to LIBRA_OS_API_KEY,
  // as Get Example's terminal does. Needs LIBRAOS_E2E_COOKBOOK_PYTHON (a Python
  // with libraos-sdk) and LIBRAOS_E2E_COOKBOOK (a cookbook checkout).
  it.skipIf(!process.env.LIBRAOS_E2E_COOKBOOK || !process.env.LIBRAOS_E2E_COOKBOOK_PYTHON || !process.env.LIBRAOS_E2E_MODEL_KEY)(
    "the cookbook's Python First Agent runs with a setup token",
    async () => {
      const t = await setupToken(base, SETUP_CLIENT_ID, secrets.setupClientSecret);
      const out = execFileSync(process.env.LIBRAOS_E2E_COOKBOOK_PYTHON!, ["first-agent.py"], {
        cwd: join(process.env.LIBRAOS_E2E_COOKBOOK!, "get-started", "01-first-agent"),
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LIBRA_OS_URL: base, LIBRA_OS_API_KEY: t.token },
        encoding: "utf8",
        timeout: 240_000,
      });
      console.log("first-agent.py:", out.trim().slice(0, 300));
      expect(out).toContain("create agent: ok");
      expect(out).toMatch(/agent: .+/);
    },
    260_000,
  );

  for (const [kind, cmd] of [
    ["javascript", ["node"]],
    // Node 22.6+ strips TypeScript types itself.
    ["typescript", ["node"]],
    ["other", ["bash"]],
    ...(process.env.LIBRAOS_E2E_GO ? [["go", ["go", "run"]]] : []),
    ...(process.env.LIBRAOS_E2E_PYTHON ? [["python", [process.env.LIBRAOS_E2E_PYTHON]]] : []),
  ] as [Parameters<typeof projectTemplate>[0], string[]][]) {
    it(`the ${kind} quickstart gets an answer`, () => {
      const t = projectTemplate(kind, model);
      const f = join(dir, t.quickstartFile);
      writeFileSync(f, t.quickstart);
      const out = execFileSync(cmd[0], [...cmd.slice(1), f], {
        cwd: dir,
        env: { ...process.env, LIBRA_OS_URL: base, LIBRA_OS_API_KEY: apiKey },
        encoding: "utf8",
        timeout: 180_000,
      });
      console.log(`${kind}:`, out.trim().slice(0, 200));
      expect(out.trim().length).toBeGreaterThan(0);
    }, 200_000);
  }
});
