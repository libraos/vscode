// Runs inside VS Code. The dialogs a developer would click are answered here;
// everything else — Docker, the runtime, the model, files, terminals — is real.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const vscode = require("vscode");

const env = process.env;
const work = env.LIBRAOS_E2E_WORKSPACE;
const base = `http://127.0.0.1:${env.LIBRAOS_E2E_PORT}`;
const log = (...a) => console.log("[e2e]", ...a);

// What a developer would answer, by dialog.
function answerDialogs() {
  const seen = [];
  const pickFirstItem = (kind) => (message, ...rest) => {
    const items = rest.filter((x) => typeof x === "string");
    seen.push(`${kind}: ${message}`);
    // Confirm every modal and every offered action ("Install", "Initialize", …).
    return Promise.resolve(items[0]);
  };
  vscode.window.showInformationMessage = pickFirstItem("info");
  vscode.window.showWarningMessage = pickFirstItem("warn");
  vscode.window.showErrorMessage = (message, ...rest) => {
    seen.push(`ERROR: ${message}`);
    return Promise.resolve(undefined);
  };
  vscode.window.showQuickPick = async (items, opts) => {
    const list = await items;
    const title = (opts && opts.title) || "";
    seen.push(`pick: ${title}`);
    if (title.includes("where should the runtime send")) return list.find((i) => i.label === "Local proxy");
    if (title.startsWith("Models at")) {
      log(`endpoint lists ${list.length - 1} models`);
      return list.find((i) => i.label === env.LIBRAOS_E2E_MODEL);
    }
    return undefined;
  };
  vscode.window.showInputBox = async (opts) => {
    seen.push(`input: ${opts.title}`);
    if (opts.title === "Model endpoint base URL") return env.LIBRAOS_E2E_MODEL_BASE;
    if (opts.title === "Model API key") return env.LIBRAOS_E2E_MODEL_KEY;
    return opts.value;
  };
  return seen;
}

async function health() {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function labels(tree, node) {
  return (await tree.getChildren(node)).map((n) => `${n.label}${n.description ? ` = ${n.description}` : ""}`);
}

exports.run = async function run() {
  const seen = answerDialogs();
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "libraos");
  await vscode.commands.executeCommand("workbench.view.extension.libraos");
  for (let i = 0; i < 50 && !ext.isActive; i++) await new Promise((r) => setTimeout(r, 100));
  const tree = ext.exports.tree;
  // The tree is rebuilt on every refresh; read a section from a fresh root.
  const section = async (i) => labels(tree, (await tree.getChildren())[i]);

  try {
    log("1. Configure Model");
    await vscode.commands.executeCommand("libraos.configureModel");
    const cfg = vscode.workspace.getConfiguration("libraos");
    assert.strictEqual(cfg.get("model.baseUrl"), env.LIBRAOS_E2E_MODEL_BASE);
    assert.strictEqual(cfg.get("model.name"), env.LIBRAOS_E2E_MODEL);
    assert.ok(!seen.some((s) => s.startsWith("ERROR")), `model test failed: ${seen.filter((s) => s.startsWith("ERROR"))}`);
    assert.ok(seen.some((s) => s.includes(`${env.LIBRAOS_E2E_MODEL} answered`)), "the model test call answered");

    log("2. Install Runtime");
    await vscode.commands.executeCommand("libraos.installRuntime");
    const installed = await section(1);
    log("   runtime:", installed.join(" | "));
    assert.ok(installed.some((r) => r === "Status = Stopped"), "tree shows the runtime installed");

    log("3. Run Local Runtime");
    await vscode.commands.executeCommand("libraos.startRuntime");
    assert.ok(await health(), "runtime healthy");
    const runtimeRows = await section(1);
    log("   runtime:", runtimeRows.join(" | "));
    assert.ok(runtimeRows.some((r) => r.startsWith("Status = Running")), "tree shows Running");

    log("4. Initialize LibraOS Project");
    await vscode.commands.executeCommand("libraos.initProject");
    const config = JSON.parse(fs.readFileSync(path.join(work, "libraos.json"), "utf8"));
    assert.strictEqual(config.model, env.LIBRAOS_E2E_MODEL);
    assert.ok(!JSON.stringify(config).includes("nk_"), "no key in libraos.json");
    assert.ok(fs.existsSync(path.join(work, "libraos-quickstart.mts")), "quickstart written");
    const projectRows = await section(2);
    log("   project:", projectRows.join(" | "));
    assert.ok(projectRows.includes("Copy Project API Key"), "a project key was minted");

    log("5. The key reaches a new VS Code terminal, not the workspace");
    const out = path.join(work, ".terminal-env");
    const term = vscode.window.createTerminal({ name: "e2e", cwd: work });
    term.sendText(`printf '%s|%s' "$LIBRA_OS_URL" "\${LIBRA_OS_API_KEY:0:3}" > "${out}"; exit`);
    for (let i = 0; i < 100 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
    const termEnv = fs.readFileSync(out, "utf8");
    fs.rmSync(out);
    log("   terminal sees:", termEnv.replace(/\|.*/, "|<key prefix hidden>"));
    assert.ok(termEnv.startsWith(base + "|") && termEnv.split("|")[1].length === 3, `terminal env = ${termEnv}`);
    const workspaceText = fs
      .readdirSync(work, { recursive: true })
      .filter((f) => fs.statSync(path.join(work, f)).isFile())
      .map((f) => fs.readFileSync(path.join(work, f), "utf8"))
      .join("\n");
    assert.ok(!/nk_[A-Za-z0-9]{8}/.test(workspaceText), "no API key anywhere in the workspace");

    log("6. Copy Project API Key, then run the quickstart the way a developer would");
    await vscode.commands.executeCommand("libraos.copyApiKey");
    const key = await vscode.env.clipboard.readText();
    assert.ok(key.length > 10, "key copied");
    const answer = execFileSync("node", ["libraos-quickstart.mts"], {
      cwd: work,
      env: { ...process.env, LIBRA_OS_URL: base, LIBRA_OS_API_KEY: key },
      encoding: "utf8",
      timeout: 120000,
    }).trim();
    log("   quickstart answer:", answer.slice(0, 160));
    assert.ok(answer.length > 0, "the model answered through the runtime");

    log("7. Logs, then Stop");
    await vscode.commands.executeCommand("libraos.showLogs");
    await vscode.commands.executeCommand("libraos.stopRuntime");
    assert.ok(!(await health()), "runtime stopped");
    log("   runtime:", (await section(1)).join(" | "));
  } finally {
    log("dialogs answered:", seen.length);
    for (const s of seen) log("  ", s.replace(env.LIBRAOS_E2E_MODEL_KEY, "<key>"));
  }
  log("PASS");
};
