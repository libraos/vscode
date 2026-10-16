const assert = require("node:assert");
const vscode = require("vscode");

const COMMANDS = [
  "libraos.refresh",
  "libraos.signIn",
  "libraos.signOut",
  "libraos.claimLicence",
  "libraos.registerInstallation",
  "libraos.removeInstallation",
  "libraos.openConsole",
  "libraos.configureModel",
  "libraos.installRuntime",
  "libraos.startRuntime",
  "libraos.stopRuntime",
  "libraos.showLogs",
  "libraos.initProject",
  "libraos.copyApiKey",
  "libraos.browseExamples",
  "libraos.openExample",
  "libraos.cloudDeploy",
];

exports.run = async function run() {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "libraos");
  assert.ok(ext, "extension is loaded");

  // Opening the view activates the extension, as a user would.
  await vscode.commands.executeCommand("workbench.view.extension.libraos");
  for (let i = 0; i < 50 && !ext.isActive; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(ext.isActive, "extension activates when its view opens");

  const all = await vscode.commands.getCommands(true);
  for (const c of COMMANDS) assert.ok(all.includes(c), `command registered: ${c}`);

  const pkgCommands = ext.packageJSON.contributes.commands.map((c) => c.command).sort();
  assert.deepStrictEqual(pkgCommands, [...COMMANDS].sort(), "package.json declares exactly the registered commands");

  // The sidebar renders its sections. Commands that show a notification are
  // not awaited here: a notification waits for a user to dismiss it.
  const api = ext.exports;
  assert.ok(api && typeof api.tree === "object", "extension exposes its tree for tests");
  const sections = (await api.tree.getChildren()).map((n) => n.label);
  assert.deepStrictEqual(sections, ["Developer", "Runtime", "Project", "Examples", "Cloud Deployment"]);
  const runtime = await api.tree.getChildren((await api.tree.getChildren())[1]);
  assert.ok(runtime.some((n) => n.label === "Install Runtime"), "a fresh install offers Install Runtime");
  const developer = (await api.tree.getChildren((await api.tree.getChildren())[0])).map(
    (n) => `${n.label}${n.description ? ` = ${n.description}` : ""}`,
  );
  assert.deepStrictEqual(developer, ["Sign In = Not signed in", "Licence = Personal (default)", "Open Console"]);
  const personal = (await api.tree.getChildren((await api.tree.getChildren())[0]))[1];
  assert.match(String(personal.tooltip), /never checks a licence/, "Personal explains the runtime never checks a licence");
  const inline = ext.packageJSON.contributes.menus["view/item/context"];
  assert.ok(
    inline.some((m) => m.command === "libraos.removeInstallation" && m.when.includes("viewItem == libraos.installation")),
    "registered installations have a Remove action",
  );
  assert.strictEqual(api.account.state.signedIn, false, "a fresh install is signed out");
  console.log("integration: ok —", COMMANDS.length, "commands, activation on view open");
};
