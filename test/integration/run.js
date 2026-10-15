// Loads the built extension in a real VS Code and checks it activates,
// registers its commands and renders the sidebar. Run: npm run test:integration
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

(async () => {
  try {
    await runTests({
      version: process.env.VSCODE_VERSION || "1.95.0",
      extensionDevelopmentPath: path.resolve(__dirname, "../.."),
      extensionTestsPath: path.resolve(__dirname, "suite.js"),
      launchArgs: ["--disable-extensions", path.resolve(__dirname, "fixture")],
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
