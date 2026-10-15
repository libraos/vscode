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
