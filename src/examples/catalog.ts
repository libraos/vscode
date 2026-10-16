// A curated index of the public cookbook and SDK examples, organized the way
// the cookbook's learning paths are: Learn Step by Step, Explore by Capability
// and See Complete Applications, plus SDK examples. Content is opened from
// GitHub `main` on demand, so it is always the current version; the index
// itself (which examples exist, and what they need) is maintained here.
//
// Listing an example is not a compatibility certification. Each entry carries
// the cookbook's own validation status, and what the example needs from the
// Runtime that the extension-managed Runtime does not set up.

export type Repo = "cookbook" | "sdk";
export type PathId = "learn" | "capability" | "apps" | "sdk";
export type Level = "L1" | "L2" | "L3" | "L4";
export type Capability = "Knowledge" | "Tools" | "Memory" | "Async";

// What an example needs before it runs. The extension-managed Runtime provides
// none of these except Postgres-backed jobs, which every Runtime has.
export type Need =
  | "setupIdentity" // creates agents, ingests knowledge or imports bundles
  | "existingAgent" // talks to an agent that must already exist
  | "memory" // LIBRA_OS_OBSERVATIONAL_MEMORY on the Runtime
  | "documents" // document indexing and an embedding model
  | "workflows" // LIBRA_OS_WORKFLOWS_ENABLED on the Runtime
  | "appMount" // an app folder mounted into the Runtime
  | "callback" // callback secret, allowed hosts and a webhook process
  | "twoUsers" // two distinct ordinary users
  | "signIn"; // a registered OIDC client for browser sign-in

export type Validation =
  | "offlineOnly" // new v2 recipe: offline protocol tests, no live run recorded
  | "offlineAndReported" // offline tests plus earlier reported live runs on v0.2.2
  | "clientTests" // app: client/protocol tests and a reported run, no offline CI of the app itself
  | "app" // app: not covered by the cookbook's offline tests
  | "sdk"; // SDK example: outside the cookbook's validation

export interface SourceFile {
  label: string;
  path: string;
  languageId: string;
}

export interface Example {
  id: string;
  title: string;
  /** The observable result, in a few words. */
  description: string;
  repo: Repo;
  paths: PathId[];
  level?: Level;
  capability?: Capability;
  /** Repository directory that holds the example. */
  dir: string;
  /** Markdown file that explains it: the tutorial. */
  tutorial: string;
  /**
   * Standalone files that can be opened in an editor on their own. Absent for
   * multi-file examples, whose source is the repository directory.
   */
  files?: SourceFile[];
  needs: Need[];
  /** Language, SDK and version requirements, and anything else to know first. */
  requirements: string[];
  validation: Validation;
  /** Agent that must already exist, for `existingAgent`. */
  agent?: string;
}

export const COOKBOOK_VERSIONS =
  "The cookbook is written against Runtime v0.2.2 and libraos-sdk 2.0.0 (the same Runtime version this extension pins). Check `/api/version` on the Runtime you run.";

const PY = "Python 3.12 and libraos-sdk 2.0.0";
const PY_REQ = "Python 3.12; install the folder's requirements.txt";
const NODE = "Node 22.12 or newer";

export const EXAMPLES: Example[] = [
  // ── Learn Step by Step / Explore by Capability ──────────────────────────
  {
    id: "first-agent",
    title: "First Agent",
    description: "Create an agent and get replies that keep the conversation's context",
    repo: "cookbook",
    paths: ["learn"],
    level: "L1",
    dir: "get-started/01-first-agent",
    tutorial: "get-started/README.md",
    files: [
      { label: "Python", path: "get-started/01-first-agent/first-agent.py", languageId: "python" },
      { label: "TypeScript", path: "get-started/01-first-agent/first-agent.ts", languageId: "typescript" },
      { label: "Bash", path: "get-started/01-first-agent/first-agent.sh", languageId: "shellscript" },
    ],
    needs: ["setupIdentity"],
    requirements: [`${PY} for the Python file; Node 20 or newer for TypeScript; curl for Bash`],
    validation: "offlineAndReported",
  },
  {
    id: "ticket-routing",
    title: "Ticket Routing",
    description: "Schema-valid intents and a measured classification accuracy",
    repo: "cookbook",
    paths: ["learn"],
    level: "L1",
    dir: "recipes/ticket-routing",
    tutorial: "recipes/ticket-routing/README.md",
    needs: ["setupIdentity"],
    requirements: [PY, "A model that supports structured output"],
    validation: "offlineAndReported",
  },
  {
    id: "document-qa",
    title: "Document Q&A",
    description: "Answers backed by the supplied handbook, and no invented policy",
    repo: "cookbook",
    paths: ["learn", "capability"],
    level: "L2",
    capability: "Knowledge",
    dir: "recipes/document-qa",
    tutorial: "recipes/document-qa/README.md",
    files: [{ label: "Python", path: "recipes/document-qa/document_qa.py", languageId: "python" }],
    needs: ["setupIdentity"],
    requirements: [PY],
    validation: "offlineAndReported",
  },
  {
    id: "tool-calling",
    title: "Tools: Order Lookup",
    description: "Order status plus a signed callback receipt from your webhook",
    repo: "cookbook",
    paths: ["learn", "capability"],
    level: "L2",
    capability: "Tools",
    dir: "recipes/tool-calling",
    tutorial: "recipes/tool-calling/README.md",
    needs: ["setupIdentity", "callback", "appMount"],
    requirements: [PY_REQ, "A model that supports tool calls and structured output", "The recipe's Compose overlay, started with the cookbook's get-started Compose file"],
    validation: "offlineOnly",
  },
  {
    id: "memory-isolation",
    title: "Memory: User Isolation",
    description: "User A's preference is recalled in a new conversation; user B cannot recall it",
    repo: "cookbook",
    paths: ["learn", "capability"],
    level: "L2",
    capability: "Memory",
    dir: "recipes/memory-isolation",
    tutorial: "recipes/memory-isolation/README.md",
    needs: ["setupIdentity", "memory", "twoUsers"],
    requirements: [PY_REQ],
    validation: "offlineOnly",
  },
  {
    id: "customer-support",
    title: "Customer Support",
    description: "Knowledge-base answers and live order lookups for a known customer",
    repo: "cookbook",
    paths: ["learn"],
    level: "L3",
    dir: "recipes/customer-support",
    tutorial: "recipes/customer-support/README.md",
    needs: ["setupIdentity", "callback"],
    requirements: [`${PY}, FastAPI and uvicorn`, "Uses the documented bundle-import path and agent-registry reload"],
    validation: "offlineAndReported",
  },
  {
    id: "async-jobs",
    title: "HTTP Async Job & Recovery",
    description: "A job ID that survives a client restart; resume reads the same job",
    repo: "cookbook",
    paths: ["learn", "capability"],
    level: "L3",
    capability: "Async",
    dir: "recipes/async-jobs",
    tutorial: "recipes/async-jobs/README.md",
    needs: ["existingAgent"],
    agent: "first-assistant",
    requirements: [
      `${PY_REQ} (httpx only; no SDK)`,
      "Native HTTP job routes under /agents/v1/{agent}/jobs with native states (done, result). Not the SDK's managed jobs client; do not mix the two response shapes",
      "Submit and resume with the same identity",
    ],
    validation: "offlineOnly",
  },
  // ── See Complete Applications ───────────────────────────────────────────
  {
    id: "personal-assistant",
    title: "Personal Assistant",
    description: "Signed-in chat with past conversations, private documents and long-term memory",
    repo: "cookbook",
    paths: ["learn", "apps"],
    level: "L4",
    dir: "apps/personal-assistant",
    tutorial: "apps/personal-assistant/README.md",
    needs: ["setupIdentity", "signIn", "memory", "documents", "appMount"],
    requirements: [NODE, "Read “Sign in with LibraOS” (get-started/02-sign-in-with-libraos) first", "An embedding model; the setup script creates a demo user"],
    validation: "app",
  },
  {
    id: "marketing-team",
    title: "Marketing Team",
    description: "One mission becomes a planned team, parallel tasks and an attributed report",
    repo: "cookbook",
    paths: ["learn", "apps"],
    level: "L4",
    dir: "apps/digital-marketing-team",
    tutorial: "apps/digital-marketing-team/README.md",
    needs: ["setupIdentity", "signIn", "workflows"],
    requirements: [NODE, "A model strong enough to return a valid JSON mission plan", "Its pack (packs/marketing-team) describes the mission contract"],
    validation: "clientTests",
  },
  {
    id: "mission-console",
    title: "Mission Console",
    description: "Run a pack's mission and follow plan, progress, decisions and report",
    repo: "cookbook",
    paths: ["apps"],
    dir: "apps/mission-console",
    tutorial: "apps/mission-console/README.md",
    needs: ["setupIdentity", "signIn", "workflows"],
    requirements: [NODE, "Uses the Marketing Team's setup script for its demo user and knowledge", "Today its catalog has one mission, the marketing-team pack's"],
    validation: "clientTests",
  },
  // ── SDK examples ────────────────────────────────────────────────────────
  {
    id: "py-quickstart",
    title: "Python SDK quickstart",
    description: "Create an employee and an agent, then message it",
    repo: "sdk",
    paths: ["sdk"],
    dir: "python/examples",
    tutorial: "python/README.md",
    files: [{ label: "Python", path: "python/examples/00_quickstart.py", languageId: "python" }],
    needs: ["setupIdentity"],
    requirements: ["libraos-sdk 2.0.0; reads LIBRA_OS_URL and LIBRA_OS_API_KEY"],
    validation: "sdk",
  },
  {
    id: "py-streaming",
    title: "Streaming messages (Python)",
    description: "Stream an answer token by token",
    repo: "sdk",
    paths: ["sdk"],
    dir: "python/examples",
    tutorial: "python/README.md",
    files: [{ label: "Python", path: "python/examples/09_streaming_messages.py", languageId: "python" }],
    needs: ["existingAgent"],
    agent: "default-assistant",
    requirements: ["libraos-sdk 2.0.0; reads LIBRA_OS_URL, LIBRA_OS_API_KEY and LIBRA_OS_AGENT_ID"],
    validation: "sdk",
  },
  {
    id: "py-async-job",
    title: "Managed async jobs (Python SDK)",
    description: "Submit a job with the SDK's jobs client and follow it to completion",
    repo: "sdk",
    paths: ["sdk"],
    dir: "python/examples",
    tutorial: "python/README.md",
    files: [{ label: "Python", path: "python/examples/08_async_job_long_running.py", languageId: "python" }],
    needs: ["setupIdentity", "existingAgent"],
    agent: "research-agent",
    requirements: [
      "libraos-sdk 2.0.0; reads LIBRA_OS_URL, LIBRA_OS_API_KEY and LIBRA_OS_AGENT_ID",
      "Managed jobs route /v1/managed/agents/jobs. Current Runtime source serves it; older releases may not, so check yours. For the native HTTP route with recovery, see “HTTP Async Job & Recovery”",
    ],
    validation: "sdk",
  },
  {
    id: "py-custom-tool",
    title: "Custom tools via webhook (Python SDK)",
    description: "The webhook side of a custom tool: verify and answer signed callbacks",
    repo: "sdk",
    paths: ["sdk"],
    dir: "python/examples",
    tutorial: "python/README.md",
    files: [{ label: "Python", path: "python/examples/05_custom_tool_webhook.py", languageId: "python" }],
    needs: ["callback"],
    requirements: ["libraos-sdk 2.0.0, FastAPI and uvicorn; reads LIBRA_OS_CB_SECRET", "Only the webhook side: registering the tool on an agent is a separate step. For a full walk-through, see “Tools: Order Lookup”"],
    validation: "sdk",
  },
];

export interface PathInfo {
  id: PathId;
  label: string;
  detail: string;
}

export const PATHS: PathInfo[] = [
  { id: "learn", label: "Learn Step by Step", detail: "L1 to L4: First Agent, then pick Knowledge, Tools or Memory, then combine them" },
  { id: "capability", label: "Explore by Capability", detail: "Knowledge, Tools, Memory or Async, each on its own" },
  { id: "apps", label: "See Complete Applications", detail: "Personal Assistant, Marketing Team and Mission Console" },
  { id: "sdk", label: "SDK Examples", detail: "Single-file examples from libraos/sdk" },
];

const LEVEL_ORDER: Record<Level, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };
const CAPABILITY_ORDER: Capability[] = ["Knowledge", "Tools", "Memory", "Async"];

/** Examples on one path, in the cookbook's order. */
export function examplesFor(path: PathId): Example[] {
  const list = EXAMPLES.filter((e) => e.paths.includes(path));
  if (path === "learn") return [...list].sort((a, b) => LEVEL_ORDER[a.level!] - LEVEL_ORDER[b.level!]);
  if (path === "capability")
    return [...list].sort((a, b) => CAPABILITY_ORDER.indexOf(a.capability!) - CAPABILITY_ORDER.indexOf(b.capability!));
  return list;
}

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

/** Short label shown next to an example on a given path. */
export function badge(e: Example, path?: PathId): string {
  if (path === "capability" && e.capability) return e.capability;
  if (e.level && e.capability) return `${e.level} · ${e.capability}`;
  return e.level ?? (e.repo === "sdk" ? "SDK" : "App");
}

export function isMultiFile(e: Example): boolean {
  return !e.files || e.files.length === 0;
}

const GH = "https://github.com/libraos";

export function tutorialUrl(e: Example): string {
  return `${GH}/${e.repo}/blob/main/${e.tutorial}`;
}

/** The repository directory, which GitHub shows with its README. */
export function directoryUrl(e: Example): string {
  return `${GH}/${e.repo}/tree/main/${e.dir}`;
}

export function fileWebUrl(e: Example, f: SourceFile): string {
  return `${GH}/${e.repo}/blob/main/${f.path}`;
}

export function rawUrl(e: Example, f: SourceFile): string {
  return `https://raw.githubusercontent.com/libraos/${e.repo}/main/${f.path}`;
}

// Cookbook guides that sit above any one example.
export const GUIDES = {
  learningPaths: `${GH}/cookbook/blob/main/docs/learning-paths.md`,
  recipeSetup: `${GH}/cookbook/blob/main/docs/recipe-setup.md`,
  getStarted: `${GH}/cookbook/blob/main/get-started/README.md`,
  validation: `${GH}/cookbook/blob/main/docs/validation.md`,
};

const NEED_TEXT: Record<Need, string> = {
  setupIdentity:
    "A setup identity that can create agents and ingest knowledge, such as the cookbook's local quickstart token. This extension's project API key cannot: it covers only model-serving and agent chat routes",
  existingAgent: "", // filled in per example, see needText
  memory: "Observational memory switched on in the Runtime (LIBRA_OS_OBSERVATIONAL_MEMORY=1)",
  documents: "Document indexing (LIBRA_OS_SUPERNOVA_ENABLED=true) and an embedding model (LIBRA_OS_EMBEDDING_API_BASE, LIBRA_OS_EMBEDDING_MODEL)",
  workflows: "The mission workflow switched on in the Runtime (LIBRA_OS_WORKFLOWS_ENABLED=true)",
  appMount: "The example's app folder mounted into the Runtime's apps directory",
  callback:
    "A callback secret set in both the Runtime and your webhook process, the callback host allowed in the Runtime, and the webhook running",
  twoUsers:
    "Two distinct ordinary users in the same organization, each with their own access token. One key with different end-user values is not the same test, and the project API key alone is not enough",
  signIn: "The app registered as a sign-in (OIDC) client in the Runtime (LIBRA_OS_OIDC_CLIENTS)",
};

function needText(e: Example, n: Need): string {
  if (n === "existingAgent") return `An agent named “${e.agent ?? "(see the example)"}” already on the Runtime`;
  return NEED_TEXT[n];
}

// Needs that only a Runtime configured for the example can meet. The
// extension's Runtime has none of these switches, mounts, callback settings,
// users or sign-in clients, and it gives terminals only an inference-scoped key.
const COOKBOOK_ONLY: Need[] = ["setupIdentity", "memory", "documents", "workflows", "appMount", "callback", "twoUsers", "signIn"];

export type RuntimeFit = "cookbook" | "extensionWithAgent" | "any";

export function runtimeFit(e: Example): RuntimeFit {
  if (e.needs.some((n) => COOKBOOK_ONLY.includes(n))) return "cookbook";
  if (e.needs.includes("existingAgent")) return "extensionWithAgent";
  return "any";
}

export function runtimeAdvice(e: Example): string {
  switch (runtimeFit(e)) {
    case "cookbook": {
      const why: string[] = [];
      if (e.needs.some((n) => n !== "setupIdentity" && n !== "existingAgent" && COOKBOOK_ONLY.includes(n)))
        why.push("it does not set the Runtime switches, mounts, callback settings, users or sign-in clients listed above");
      if (e.needs.includes("setupIdentity")) why.push("its project API key cannot create agents or ingest knowledge");
      return `Use a Runtime configured for this example, such as the cookbook's get-started setup. The Runtime this extension manages is not: ${why.join(", and ")}.`;
    }
    case "extensionWithAgent":
      return `The extension's project API key can call this example's routes, but the agent “${e.agent}” must exist first, and creating it needs a setup identity. The cookbook's get-started Runtime provides one.`;
    case "any":
      return "Runs against any Runtime with the access described in its README.";
  }
}

const VALIDATION_TEXT: Record<Validation, string> = {
  offlineOnly: "Offline protocol tests pass. Live Runtime and model runs have not been recorded for this new recipe yet.",
  offlineAndReported: "Offline tests pass, and earlier live runs on Runtime v0.2.2 were reported. The README lists what live checks remain.",
  clientTests:
    "The mission client's protocol tests pass, and a full browser mission was reported on Runtime v0.2.2. A full mission and model run is not part of offline CI.",
  app: "Not covered by the cookbook's offline tests. See its README for how it was run.",
  sdk: "SDK example. It is not part of the cookbook's validation.",
};

export function validationText(e: Example): string {
  return `${VALIDATION_TEXT[e.validation]} Listing it here is not a compatibility certification.`;
}

/** The text shown before someone opens an example. */
export function exampleCard(e: Example): string {
  const lines: string[] = [];
  const head = e.level || e.capability ? `${badge(e)}. ` : "";
  lines.push(`${head}${e.description}.`, "");
  lines.push("Before you run it:");
  for (const r of e.requirements) lines.push(`• ${r}.`);
  for (const n of e.needs) lines.push(`• ${needText(e, n)}.`);
  lines.push("", `Runtime: ${runtimeAdvice(e)}`);
  lines.push("", `Validation: ${validationText(e)}`);
  if (isMultiFile(e)) {
    lines.push("", "This example has several files. View Source opens its folder on GitHub; the README lists every file, dependency and setting.");
  }
  return lines.join("\n");
}

/** When to use the cookbook's setup instead of the extension-managed Runtime. */
export const SETUP_GUIDE = [
  "The Runtime this extension manages is for your own app. It runs the pinned Runtime with Postgres and your model, and gives VS Code terminals LIBRA_OS_URL and an inference-scoped project API key. That key covers model-serving routes and chat with existing agents.",
  "",
  "Most cookbook examples need more: a setup identity that creates agents and ingests knowledge, memory or mission switches, mounted app folders, tool-callback secrets and allowed hosts, ordinary users or sign-in clients. The cookbook's get-started Compose setup provides these; the extension does not configure them and does not change its Runtime for an example.",
  "",
  "Both default to port 8900, so stop the extension's Runtime before starting the cookbook's, or give one a different port.",
  "",
  COOKBOOK_VERSIONS,
].join("\n");
