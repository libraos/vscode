import { describe, expect, it } from "vitest";
import {
  composeArgs,
  composeEnv,
  composeFile,
  containerModelUrl,
  isDigestPinned,
  networkModeFor,
  POSTGRES_IMAGE,
  randomSecret,
  type NetworkMode,
} from "../src/runtime/compose";

const settings = (mode: NetworkMode) => ({
  image: "ghcr.io/libraos/libraos:v0.2.2@sha256:" + "a".repeat(64),
  port: 8911,
  pgPort: 55432,
  mode,
  modelBaseUrl: "http://127.0.0.1:8318/v1",
  modelName: "gpt-5.6-sol",
  modelApiKey: "model-key",
});
const secrets = { pgPassword: "pg-secret", jwtSecret: "jwt-secret", adminPassword: "admin-secret" };

describe.each(["host", "bridge"] as const)("composeFile (%s)", (mode) => {
  const f = composeFile(mode);

  it("never contains a secret value, only references to the environment", () => {
    for (const v of [...Object.values(secrets), "model-key"]) expect(f).not.toContain(v);
    expect(f).toContain("${LIBRA_OS_JWT_SECRET:?missing}");
    expect(f).toContain("${LIBRAOS_PG_PASSWORD:?missing}");
  });

  it("lifts the memlock cap", () => {
    expect(f).toMatch(/memlock: \{ soft: -1, hard: -1 \}/);
  });

  it("only uses variables composeEnv provides", () => {
    const provided = new Set(Object.keys(composeEnv(settings(mode), secrets)));
    for (const [, name] of f.matchAll(/\$\{([A-Z_]+)/g)) expect(provided).toContain(name);
  });

  it("keeps everything on loopback", () => {
    expect(f).not.toMatch(/0\.0\.0\.0/);
    for (const [, binding] of f.matchAll(/ports: \["([^"]+)"\]/g)) expect(binding.startsWith("127.0.0.1:")).toBe(true);
  });
});

describe("network modes", () => {
  it("host mode binds the runtime to loopback and reaches Postgres on loopback", () => {
    const f = composeFile("host");
    expect(f).toContain("network_mode: host");
    expect(f).toContain("LIBRA_OS_HOST: 127.0.0.1");
    expect(f).toContain("@127.0.0.1:${LIBRAOS_PG_PORT:?missing}/libraos");
  });

  it("bridge mode publishes the runtime on loopback", () => {
    const f = composeFile("bridge");
    expect(f).not.toContain("network_mode");
    expect(f).toContain('"127.0.0.1:${LIBRAOS_PORT:-8900}:8900"');
    expect(f).toContain("@postgres:5432/libraos");
  });

  it("chooses host on Linux only", () => {
    expect(networkModeFor("linux")).toBe("host");
    expect(networkModeFor("darwin")).toBe("bridge");
    expect(networkModeFor("win32")).toBe("bridge");
  });

  it("rewrites loopback model URLs for the bridge only", () => {
    expect(containerModelUrl("http://127.0.0.1:8318/v1", "bridge")).toBe("http://host.docker.internal:8318/v1");
    expect(containerModelUrl("http://localhost:11434/v1", "bridge")).toBe("http://host.docker.internal:11434/v1");
    expect(containerModelUrl("http://127.0.0.1:8318/v1", "host")).toBe("http://127.0.0.1:8318/v1");
    expect(containerModelUrl("https://api.meganova.ai", "bridge")).toBe("https://api.meganova.ai");
    expect(containerModelUrl("http://localhostess.example/v1", "bridge")).toBe("http://localhostess.example/v1");
  });
});

describe("composeEnv", () => {
  it("maps settings and secrets", () => {
    const env = composeEnv(settings("bridge"), secrets);
    expect(env.LIBRAOS_PORT).toBe("8911");
    expect(env.LIBRA_OS_ADMIN_PASSWORD).toBe("admin-secret");
    expect(env.OPENAI_API_KEY).toBe("model-key");
    expect(env.OPENAI_API_BASE).toBe("http://host.docker.internal:8318/v1");
    expect(env.LIBRAOS_MODEL).toBe("gpt-5.6-sol");
  });

  it("sends a placeholder key to keyless endpoints", () => {
    expect(composeEnv({ ...settings("host"), modelApiKey: undefined }, secrets).OPENAI_API_KEY).toBe("local");
  });
});

describe("helpers", () => {
  it("builds compose args against one project", () => {
    expect(composeArgs("/x/c.yml", "up", "-d")).toEqual(["compose", "-f", "/x/c.yml", "-p", "libraos-vscode", "up", "-d"]);
  });

  it("detects digest pinning", () => {
    expect(isDigestPinned(settings("host").image)).toBe(true);
    expect(isDigestPinned(POSTGRES_IMAGE)).toBe(true);
    expect(isDigestPinned("ghcr.io/libraos/libraos:latest")).toBe(false);
    expect(isDigestPinned("x@sha256:abc")).toBe(false);
  });

  it("generates URL-safe hex secrets", () => {
    expect(randomSecret(4, () => Buffer.from([0, 255, 16, 1]))).toBe("00ff1001");
  });
});
