import * as vscode from "vscode";
import {
  EXAMPLES,
  GUIDES,
  PATHS,
  SETUP_GUIDE,
  badge,
  directoryUrl,
  exampleCard,
  examplesFor,
  fileWebUrl,
  findExample,
  isMultiFile,
  rawUrl,
  tutorialUrl,
  type Example,
  type PathId,
  type SourceFile,
} from "./catalog";

const OPEN_TUTORIAL = "Open Tutorial";
const VIEW_SOURCE = "View Source";

function openWeb(url: string): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

type GuideItem = vscode.QuickPickItem & { guide: "paths" | "setup" | "validation" };
type PathItem = vscode.QuickPickItem & { path: PathId };
type ExampleItem = vscode.QuickPickItem & { id: string };

// Browse Cookbook: choose an entry point, then an example on it.
async function browse(): Promise<void> {
  const items: (PathItem | GuideItem | vscode.QuickPickItem)[] = [
    ...PATHS.map((p) => ({ label: p.label, detail: p.detail, path: p.id })),
    { label: "Guides", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(book) Learning paths", description: "the cookbook's map of every example", guide: "paths" as const },
    { label: "$(server-environment) Cookbook setup or this extension's Runtime?", description: "which Runtime to run examples on", guide: "setup" as const },
    { label: "$(beaker) What has been validated", description: "offline tests and live checks", guide: "validation" as const },
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "LibraOS Cookbook", placeHolder: "Choose how to explore" });
  if (!pick) return;
  if ("guide" in pick) {
    if (pick.guide === "setup") return setupGuide();
    await openWeb(pick.guide === "paths" ? GUIDES.learningPaths : GUIDES.validation);
    return;
  }
  if (!("path" in pick)) return;
  const id = await pickExample(pick.path, pick.label);
  if (id) await showExample(id);
}

async function pickExample(path?: PathId, title = "LibraOS Cookbook"): Promise<string | undefined> {
  const list = path ? examplesFor(path) : EXAMPLES;
  const pick = await vscode.window.showQuickPick<ExampleItem>(
    list.map((e) => ({
      label: e.title,
      description: badge(e, path),
      detail: `${e.description} · libraos/${e.repo}/${e.dir}${isMultiFile(e) ? " (several files)" : ""}`,
      id: e.id,
    })),
    { title, matchOnDescription: true, matchOnDetail: true },
  );
  return pick?.id;
}

// The example card: what it shows, what it needs, where it can run and how
// far it has been validated, before anything is opened.
async function showExample(id: string): Promise<void> {
  const e = findExample(id);
  if (!e) return;
  const choice = await vscode.window.showInformationMessage(
    e.title,
    { modal: true, detail: exampleCard(e) },
    OPEN_TUTORIAL,
    VIEW_SOURCE,
  );
  if (choice === OPEN_TUTORIAL) await openTutorial(e.id);
  if (choice === VIEW_SOURCE) await viewSource(e.id);
}

async function resolve(id: unknown): Promise<Example | undefined> {
  const chosen = typeof id === "string" ? id : await pickExample();
  return chosen ? findExample(chosen) : undefined;
}

async function openTutorial(id?: unknown): Promise<void> {
  const e = await resolve(id);
  if (e) await openWeb(tutorialUrl(e));
}

// Multi-file examples open their repository folder: copying one file out of
// them would not run. Single-file examples open in an untitled editor.
async function viewSource(id?: unknown): Promise<void> {
  const e = await resolve(id);
  if (!e) return;
  if (isMultiFile(e) || !e.files) {
    await openWeb(directoryUrl(e));
    return;
  }
  let file: SourceFile | undefined = e.files[0];
  if (e.files.length > 1) {
    const pick = await vscode.window.showQuickPick(
      e.files.map((f) => ({ label: f.label, description: f.path, file: f })),
      { title: `${e.title}: choose a language` },
    );
    file = pick?.file;
  }
  if (file) await openFile(e, file);
}

async function openFile(e: Example, f: SourceFile): Promise<void> {
  try {
    const r = await fetch(rawUrl(e, f), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = await vscode.workspace.openTextDocument({ content: await r.text(), language: f.languageId });
    await vscode.window.showTextDocument(doc);
  } catch (err) {
    const pick = await vscode.window.showErrorMessage(`Could not fetch the example: ${String(err)}`, "Open on GitHub");
    if (pick) await openWeb(fileWebUrl(e, f));
  }
}

async function setupGuide(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "Cookbook setup or this extension's Runtime?",
    { modal: true, detail: SETUP_GUIDE },
    "Open Cookbook Setup",
    "Open Learning Paths",
  );
  if (choice === "Open Cookbook Setup") await openWeb(GUIDES.recipeSetup);
  if (choice === "Open Learning Paths") await openWeb(GUIDES.learningPaths);
}

export function registerExampleCommands(ctx: vscode.ExtensionContext): void {
  const reg = (id: string, fn: (...args: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("libraos.browseExamples", browse);
  reg("libraos.openExample", async (id?: unknown) => {
    const chosen = typeof id === "string" ? id : await pickExample();
    if (chosen) await showExample(chosen);
  });
  // From the tree's inline buttons the argument is the tree item, which
  // carries the example id; from the Command Palette there is none.
  reg("libraos.openExampleTutorial", (arg?: unknown) => openTutorial(idOf(arg)));
  reg("libraos.viewExampleSource", (arg?: unknown) => viewSource(idOf(arg)));
  reg("libraos.cookbookSetupGuide", setupGuide);
  reg("libraos.openLearningPaths", () => openWeb(GUIDES.learningPaths));
}

function idOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object" && "exampleId" in arg && typeof (arg as { exampleId: unknown }).exampleId === "string")
    return (arg as { exampleId: string }).exampleId;
  return undefined;
}
