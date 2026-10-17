// Which kind of project the workspace holds, from the files at its root.

export type ProjectKind = "typescript" | "javascript" | "python" | "go" | "other";

export function detectProject(rootFiles: string[]): ProjectKind {
  const has = (f: string) => rootFiles.includes(f);
  if (has("package.json")) return has("tsconfig.json") ? "typescript" : "javascript";
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("Pipfile")) return "python";
  if (has("go.mod")) return "go";
  return "other";
}

export interface ProjectTemplate {
  // File written next to the developer's code.
  quickstartFile: string;
  quickstart: string;
  // Command that adds the SDK, shown before it runs. Undefined when the
  // language uses plain HTTP.
  installCommand?: string;
  languageId: string;
  /** A Run and Debug configuration to add to .vscode/launch.json. */
  launch?: Record<string, unknown>;
}

export const CONFIG_FILE = "libraos.json";

// Non-secret project config. The API key stays in VS Code SecretStorage and
// reaches the app through the LIBRA_OS_API_KEY environment variable.
export function projectConfig(baseUrl: string, model: string): string {
  return (
    JSON.stringify(
      {
        runtime: { url: baseUrl },
        model,
        apiKeyEnv: "LIBRA_OS_API_KEY",
      },
      null,
      2,
    ) + "\n"
  );
}

const chatTs = (model: string) => `// LibraOS quickstart: one chat call against the runtime.
// VS Code terminals get LIBRA_OS_URL and LIBRA_OS_API_KEY from the LibraOS
// extension. Elsewhere, set them yourself; never commit the key.
const baseUrl = process.env.LIBRA_OS_URL ?? "http://localhost:8900";
const apiKey = process.env.LIBRA_OS_API_KEY;
if (!apiKey) throw new Error("LIBRA_OS_API_KEY is not set");

const res = await fetch(\`\${baseUrl}/v1/chat/completions\`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
  body: JSON.stringify({
    model: ${JSON.stringify(model)},
    messages: [{ role: "user", content: "Hello, LibraOS!" }],
  }),
});
if (!res.ok) throw new Error(\`LibraOS: HTTP \${res.status} \${await res.text()}\`);
const body = await res.json();
console.log(body.choices[0].message.content);
`;

const chatPy = (model: string) => `"""LibraOS quickstart: one chat call against the runtime.

VS Code terminals get LIBRA_OS_URL and LIBRA_OS_API_KEY from the LibraOS
extension. Elsewhere, set them yourself; never commit the key.
"""
import asyncio
import os

from libraos import Client


async def main() -> None:
    async with Client(
        base_url=os.environ.get("LIBRA_OS_URL", "http://localhost:8900"),
        api_key=os.environ["LIBRA_OS_API_KEY"],
    ) as client:
        msg = await client.messages.create(
            "default",
            [{"role": "user", "content": "Hello, LibraOS!"}],
            model=${JSON.stringify(model)},
            max_tokens=512,
        )
        print(msg.text)


asyncio.run(main())
`;

const chatGo = (model: string) => `// LibraOS quickstart: one chat call against the runtime.
//
// VS Code terminals get LIBRA_OS_URL and LIBRA_OS_API_KEY from the LibraOS
// extension. Elsewhere, set them yourself; never commit the key.
//
// Run: go run libraos_quickstart.go
//go:build ignore

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	baseURL := os.Getenv("LIBRA_OS_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8900"
	}
	apiKey := os.Getenv("LIBRA_OS_API_KEY")
	if apiKey == "" {
		panic("LIBRA_OS_API_KEY is not set")
	}
	reqBody, _ := json.Marshal(map[string]any{
		"model":    ${JSON.stringify(model)},
		"messages": []map[string]string{{"role": "user", "content": "Hello, LibraOS!"}},
	})
	req, _ := http.NewRequest("POST", baseURL+"/v1/chat/completions", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		panic(fmt.Sprintf("LibraOS: HTTP %d %s", res.StatusCode, raw))
	}
	var out struct {
		Choices []struct {
			Message struct{ Content string } \`json:"message"\`
		} \`json:"choices"\`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		panic(err)
	}
	fmt.Println(out.Choices[0].Message.Content)
}
`;

export function projectTemplate(kind: ProjectKind, model: string): ProjectTemplate {
  switch (kind) {
    case "typescript":
      return { quickstartFile: "libraos-quickstart.mts", quickstart: chatTs(model), languageId: "typescript" };
    case "javascript":
      return {
        quickstartFile: "libraos-quickstart.mjs",
        quickstart: chatTs(model),
        languageId: "javascript",
      };
    case "python":
      return {
        quickstartFile: "libraos_quickstart.py",
        quickstart: chatPy(model),
        installCommand: "pip install libraos-sdk",
        languageId: "python",
      };
    case "go":
      return { quickstartFile: "libraos_quickstart.go", quickstart: chatGo(model), languageId: "go" };
    default:
      return { quickstartFile: "libraos-quickstart.sh", quickstart: chatSh(model), languageId: "shellscript" };
  }
}

const chatSh = (model: string) => `#!/usr/bin/env bash
# LibraOS quickstart: one chat call against the runtime.
# VS Code terminals get LIBRA_OS_URL and LIBRA_OS_API_KEY from the LibraOS
# extension. Elsewhere, set them yourself; never commit the key.
set -euo pipefail
curl -sS "\${LIBRA_OS_URL:-http://localhost:8900}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${LIBRA_OS_API_KEY:?LIBRA_OS_API_KEY is not set}" \\
  -d '{"model": ${JSON.stringify(model)}, "messages": [{"role": "user", "content": "Hello, LibraOS!"}]}'
echo
`;

// ── Python web frameworks ───────────────────────────────────────────────────

/** Whether a Python project's dependency files name FastAPI. */
export function usesFastApi(dependencyText: string): boolean {
  return /(^|[\s"'\[,])fastapi\b/im.test(dependencyText);
}

export const FASTAPI_FILE = "libraos_app.py";
export const FASTAPI_LAUNCH_NAME = "LibraOS: FastAPI app";

const fastapiPy = (model: string) => `"""A FastAPI backend that answers with a LibraOS agent.

Run it with Run and Debug, "${FASTAPI_LAUNCH_NAME}" (breakpoints work), or:
    uvicorn libraos_app:app --reload --port 8000
Then try:
    curl -s localhost:8000/ask -H 'content-type: application/json' -d '{"question": "Hello!"}'

VS Code terminals and Run and Debug get LIBRA_OS_URL and LIBRA_OS_API_KEY from
the LibraOS extension. Elsewhere, set them yourself; never commit the key.
Watch each call in "LibraOS: Show Runtime Log in Terminal".
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from libraos import Client
from pydantic import BaseModel

AGENT = os.environ.get("LIBRA_OS_AGENT", "default")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One client for the app's lifetime; it holds a connection pool.
    async with Client(
        base_url=os.environ.get("LIBRA_OS_URL", "http://localhost:8900"),
        api_key=os.environ["LIBRA_OS_API_KEY"],
    ) as client:
        app.state.libraos = client
        yield


app = FastAPI(title="LibraOS app", lifespan=lifespan)


class Ask(BaseModel):
    question: str
    # Your app's own id for the person asking: the runtime keeps each user's
    # conversation memory separate by it.
    user_id: str | None = None


class Answer(BaseModel):
    answer: str


@app.post("/ask", response_model=Answer)
async def ask(body: Ask) -> Answer:
    try:
        msg = await app.state.libraos.messages.create(
            AGENT,
            [{"role": "user", "content": body.question}],
            model=${JSON.stringify(model)},
            max_tokens=512,
            end_user=body.user_id,
        )
    except Exception as err:  # the SDK raises LibraOS errors with the runtime's message
        raise HTTPException(status_code=502, detail=f"LibraOS: {err}") from err
    return Answer(answer=msg.text)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
`;

export function fastapiTemplate(model: string): ProjectTemplate {
  return {
    quickstartFile: FASTAPI_FILE,
    quickstart: fastapiPy(model),
    installCommand: 'pip install libraos-sdk fastapi "uvicorn[standard]"',
    languageId: "python",
    launch: {
      name: FASTAPI_LAUNCH_NAME,
      type: "debugpy",
      request: "launch",
      module: "uvicorn",
      args: ["libraos_app:app", "--reload", "--port", "8000"],
      jinja: true,
      // The integrated terminal is what receives LIBRA_OS_URL and LIBRA_OS_API_KEY.
      console: "integratedTerminal",
    },
  };
}

/**
 * Adds `config` to a launch.json, keeping everything already there. Returns
 * the new file text, or undefined when nothing should be written: a
 * configuration with the same name exists, or the file is not plain JSON
 * (comments), in which case it is left for the person to edit.
 */
export function mergeLaunch(existing: string | undefined, config: Record<string, unknown>): string | undefined {
  let doc: { version?: string; configurations?: Record<string, unknown>[]; [k: string]: unknown } = { version: "0.2.0", configurations: [] };
  if (existing !== undefined && existing.trim()) {
    try {
      const parsed = JSON.parse(existing);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      doc = parsed;
    } catch {
      return undefined;
    }
  }
  const configs = Array.isArray(doc.configurations) ? doc.configurations : [];
  if (configs.some((c) => c && c.name === config.name)) return undefined;
  return JSON.stringify({ ...doc, version: doc.version ?? "0.2.0", configurations: [...configs, config] }, null, 2) + "\n";
}
