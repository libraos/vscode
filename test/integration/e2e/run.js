// End-to-end in a real VS Code: the extension installs and runs the LibraOS
// runtime with Docker, points it at a real model endpoint, initializes a real
// project, and the project's quickstart gets an answer. Opt-in; leaves nothing
// behind.
//
//   LIBRAOS_E2E_MODEL_BASE=http://127.0.0.1:8318/v1 \
//   LIBRAOS_E2E_MODEL=gpt-5.6-sol LIBRAOS_E2E_MODEL_KEY=... \
//   xvfb-run -a npm run test:e2e
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { runTests } = require("@vscode/test-electron");

const port = process.env.LIBRAOS_E2E_PORT || "8957";
const pgPort = process.env.LIBRAOS_E2E_PG_PORT || "55957";

function cleanup() {
  // Only the extension's own compose project and volumes.
  for (const args of [
    ["rm", "-f", "libraos-vscode-libraos-1", "libraos-vscode-postgres-1"],
    ["volume", "rm", "-f", "libraos-vscode_pgdata", "libraos-vscode_documents"],
    ["network", "rm", "libraos-vscode_default"],
  ]) {
    try {
      execFileSync("docker", args, { stdio: "ignore" });
    } catch {}
  }
}

(async () => {
  for (const k of ["LIBRAOS_E2E_MODEL_BASE", "LIBRAOS_E2E_MODEL", "LIBRAOS_E2E_MODEL_KEY"]) {
    if (!process.env[k]) {
      console.error(`set ${k}`);
      process.exit(2);
    }
  }
  // A fresh TypeScript project as the developer's workspace.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "libraos-vscode-e2e-"));
  fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "my-app", private: true, type: "module" }, null, 2));
  fs.writeFileSync(path.join(work, "tsconfig.json"), "{}\n");
  fs.mkdirSync(path.join(work, ".vscode"));
  fs.writeFileSync(
    path.join(work, ".vscode", "settings.json"),
    JSON.stringify({ "libraos.runtime.port": Number(port), "libraos.runtime.postgresPort": Number(pgPort) }, null, 2),
  );
  // A clean profile: no secrets or global state from earlier runs.
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "libraos-vscode-e2e-user-"));
  cleanup();
  let code = 0;
  try {
    await runTests({
      version: process.env.VSCODE_VERSION || "1.95.0",
      extensionDevelopmentPath: path.resolve(__dirname, "../../.."),
      extensionTestsPath: path.resolve(__dirname, "suite.js"),
      launchArgs: ["--disable-extensions", "--user-data-dir", userData, work],
      extensionTestsEnv: { LIBRAOS_E2E_WORKSPACE: work, LIBRAOS_E2E_PORT: port },
    });
  } catch (err) {
    console.error(err);
    code = 1;
  } finally {
    cleanup();
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
  process.exit(code);
})();
