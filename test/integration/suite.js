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
  "libraos.configureEmbeddings",
  "libraos.installRuntime",
  "libraos.startRuntime",
  "libraos.stopRuntime",
  "libraos.resetRuntimeData",
  "libraos.showLogs",
  "libraos.explorer.refresh",
  "libraos.explorer.enable",
  "libraos.explorer.openAgent",
  "libraos.explorer.debugRetrieve",
  "libraos.showRuntimeLog",
  "libraos.initProject",
  "libraos.copyApiKey",
  "libraos.copySetupToken",
  "libraos.toggleExamplesRuntime",
  "libraos.browseExamples",
  "libraos.openExample",
  "libraos.runExample",
  "libraos.getExample",
  "libraos.showExampleNeeds",
  "libraos.openExampleTutorial",
  "libraos.viewExampleSource",
  "libraos.openLearningPaths",
  "libraos.cookbookSetupGuide",
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
  assert.deepStrictEqual(developer, ["Licence = Personal (default)", "Sign In = Optional: Developer Licence benefits", "Open Console"]);
  const personal = (await api.tree.getChildren((await api.tree.getChildren())[0]))[0];
  assert.match(String(personal.tooltip), /never checks a licence/, "Personal explains the runtime never checks a licence");
  const inline = ext.packageJSON.contributes.menus["view/item/context"];
  assert.ok(
    inline.some((m) => m.command === "libraos.removeInstallation" && m.when.includes("viewItem == libraos.installation")),
    "registered installations have a Remove action",
  );
  // Examples follow the cookbook's learning paths, and each example offers
  // its tutorial and source inline.
  const examples = await api.tree.getChildren((await api.tree.getChildren())[3]);
  assert.deepStrictEqual(examples.map((n) => n.label), [
    "Learn Step by Step",
    "Explore by Capability",
    "See Complete Applications",
    "SDK Examples",
    "Learning Paths",
    "Cookbook Setup or This Runtime?",
  ]);
  const learn = await api.tree.getChildren(examples[0]);
  assert.deepStrictEqual(learn.slice(0, 4).map((n) => `${n.label} = ${n.description}`), [
    "First Agent (Python) = L1 · first-agent.py",
    "First Agent (TypeScript) = L1 · first-agent.ts",
    "First Agent (Bash) = L1 · first-agent.sh",
    "Ticket Routing = L1",
  ]);
  assert.ok(learn.every((n) => n.contextValue.startsWith("libraos.example") && n.command.command === "libraos.openExample"));
  assert.strictEqual(learn[0].contextValue, "libraos.example.runnable", "First Agent runs on click");
  assert.strictEqual(learn.find((n) => n.label === "Memory: User Isolation").contextValue, "libraos.example", "Memory needs the cookbook setup");
  const capability = (await api.tree.getChildren(examples[1])).map((n) => n.description.split(" · ")[0]);
  assert.deepStrictEqual(capability, ["Knowledge", "Tools", "Memory", "Async"]);
  const apps = (await api.tree.getChildren(examples[2])).map((n) => n.label);
  assert.deepStrictEqual(apps, ["Personal Assistant", "Marketing Team", "Mission Console"]);
  assert.deepStrictEqual(ext.packageJSON.activationEvents, ["workspaceContains:.libraos/source.json"], "an examples folder opened by Get Example activates the extension");
  assert.ok(inline.some((m) => m.command === "libraos.runExample" && m.group.startsWith("inline") && m.when.includes("viewItem == libraos.example.runnable")), "runnable examples have an inline Run");
  for (const c of ["libraos.getExample", "libraos.showExampleNeeds", "libraos.openExampleTutorial", "libraos.viewExampleSource"]) {
    assert.ok(inline.some((m) => m.command === c && m.when.includes("viewItem =~ /^libraos\\.example/")), `examples have ${c}`);
  }
  // The Runtime Explorer explains what it needs before the runtime runs.
  const explorerRows = await api.explorer.getChildren();
  assert.deepStrictEqual(explorerRows.map((n) => n.label), ["Run the local Runtime to see its agents and knowledge."]);
  assert.ok(ext.packageJSON.contributes.views.libraos.some((v) => v.id === "libraos.explorer"), "the Runtime Explorer view is contributed");
  assert.strictEqual(api.account.state.signedIn, false, "a fresh install is signed out");
  console.log("integration: ok —", COMMANDS.length, "commands, activation on view open");
};
