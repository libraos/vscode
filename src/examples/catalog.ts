// A curated index of runnable examples from the public cookbook and SDK
// repositories. Content is fetched from GitHub when opened, so it is always the
// version on main.

export interface Example {
  id: string;
  title: string;
  description: string;
  repo: "cookbook" | "sdk";
  path: string;
  languageId: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "first-agent-ts",
    title: "Create your first agent (TypeScript)",
    description: "Create an agent and talk to it",
    repo: "cookbook",
    path: "get-started/01-first-agent/first-agent.ts",
    languageId: "typescript",
  },
  {
    id: "first-agent-sh",
    title: "Create your first agent (bash)",
    description: "The same flow with curl",
    repo: "cookbook",
    path: "get-started/01-first-agent/first-agent.sh",
    languageId: "shellscript",
  },
  {
    id: "py-quickstart",
    title: "Python SDK quickstart",
    description: "libraos-sdk in a few lines",
    repo: "sdk",
    path: "python/examples/00_quickstart.py",
    languageId: "python",
  },
  {
    id: "py-streaming",
    title: "Streaming messages (Python)",
    description: "Stream an answer token by token",
    repo: "sdk",
    path: "python/examples/09_streaming_messages.py",
    languageId: "python",
  },
  {
    id: "py-async-job",
    title: "Long-running async jobs (Python)",
    description: "Submit a job and follow it to completion",
    repo: "sdk",
    path: "python/examples/08_async_job_long_running.py",
    languageId: "python",
  },
  {
    id: "py-custom-tool",
    title: "Custom tools via webhook (Python)",
    description: "Let an agent call your backend",
    repo: "sdk",
    path: "python/examples/05_custom_tool_webhook.py",
    languageId: "python",
  },
  {
    id: "recipe-document-qa",
    title: "Recipe: document Q&A",
    description: "Answer questions from your documents",
    repo: "cookbook",
    path: "recipes/document-qa/document_qa.py",
    languageId: "python",
  },
  {
    id: "recipe-ticket-routing",
    title: "Recipe: ticket routing",
    description: "Classify tickets into a validated intent",
    repo: "cookbook",
    path: "recipes/ticket-routing/ticket_routing.py",
    languageId: "python",
  },
  {
    id: "recipe-customer-support",
    title: "Recipe: customer support agent",
    description: "A support agent grounded in a knowledge base",
    repo: "cookbook",
    path: "recipes/customer-support/support_agent.py",
    languageId: "python",
  },
];

export function rawUrl(e: Example): string {
  return `https://raw.githubusercontent.com/libraos/${e.repo}/main/${e.path}`;
}

export function webUrl(e: Example): string {
  return `https://github.com/libraos/${e.repo}/blob/main/${e.path}`;
}
