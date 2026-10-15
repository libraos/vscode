# LibraOS — AI Runtime for VS Code

**Build · Run · Integrate · Deploy.** Turn your codebase into an AI-powered application.

This extension adds the LibraOS Runtime to the app you already have. It
installs and runs the runtime locally, connects it to a model, wires your
project to it, and gives you runnable examples. It is not a coding assistant:
it does not chat with you or write your code. Its job is to remove the setup
steps between your editor and a running runtime.

> **Preview.** Developer sign-in, the Developer License, the $10 welcome
> credits and Cloud Deployment arrive with the LibraOS Developer Console and
> are shown as such in the sidebar.

## What it does

| | |
|---|---|
| **Install Runtime** | Checks for Docker, shows exactly what will run, and pulls the runtime and its Postgres, pinned by digest so Docker verifies what it pulls. |
| **Configure Model** | Points the runtime at an OpenAI-compatible endpoint: the MegaNova AI gateway, a local proxy, Ollama, or any other. Lists the endpoint's models, lets you pick one, and test-calls it before saving. |
| **Run / Stop Local Runtime** | Starts and stops the runtime, with its health in the status bar. |
| **Initialize LibraOS Project** | Detects TypeScript, JavaScript, Python or Go, adds a `libraos.json` (no secrets) and a quickstart file, and mints an API key for the project on the local runtime. Python projects are offered `pip install libraos-sdk`. |
| **Browse Cookbook** | Opens runnable examples from [`libraos/cookbook`](https://github.com/libraos/cookbook) and [`libraos/sdk`](https://github.com/libraos/sdk). |
| **Show Runtime Logs** | The runtime's recent log in the LibraOS output channel. |
| **Open Console** | The LibraOS Developer Console, for keys, licences and usage. |

## Requirements

- VS Code 1.95 or newer.
- Docker with Compose v2.
- A model endpoint: a key for an OpenAI-compatible gateway, a local proxy, or
  Ollama on your machine.

## Quick start

1. Open your project folder and the **LibraOS** view in the activity bar.
2. **Configure Model**: pick an endpoint and a model; the extension test-calls it.
3. **Install Runtime**, then **Run Local Runtime**.
4. **Initialize LibraOS Project**.
5. Open a new VS Code terminal and run the quickstart file, for example
   `node libraos-quickstart.mts` or `python libraos_quickstart.py`.

## Where your secrets live

- Every credential (the model key, the runtime's generated database, signing
  and admin secrets, and each project's API key) is kept in VS Code
  **SecretStorage**. None is written to settings, your workspace or the
  generated compose file.
- Your project's API key reaches your code through the `LIBRAOS_API_KEY`
  environment variable, which the extension sets in VS Code terminals only for
  the current session. Use **Copy Project API Key** to set it elsewhere, and
  never commit it.
- The runtime and its database listen on `127.0.0.1` only. On Linux the
  runtime shares the host network so it can reach model endpoints on your
  machine; on macOS and Windows it runs on Docker's bridge network and
  `localhost` model URLs are rewritten to `host.docker.internal`.
- Installing asks for confirmation and shows the images and commands first.

Variables set in VS Code terminals: `LIBRAOS_BASE_URL` and `LIBRAOS_API_KEY`,
plus `LIBRA_OS_URL`, `NOVA_OS_URL` and `NOVA_OS_API_KEY` for the examples that
read those names.

## Settings

| Setting | Default | |
|---|---|---|
| `libraos.model.baseUrl` | `https://api.meganova.ai` | OpenAI-compatible endpoint the runtime calls |
| `libraos.model.name` | `Qwen/Qwen3.6-35B-A3B` | Model the runtime uses |
| `libraos.runtime.port` | `8900` | Runtime port on `127.0.0.1` |
| `libraos.runtime.postgresPort` | `55432` | Postgres port on `127.0.0.1` (Linux) |
| `libraos.runtime.image` | pinned release | Runtime image; keep it pinned by `@sha256:` digest |
| `libraos.consoleUrl` | `https://app.libraos.com` | Developer Console |

## Roadmap

- Sign in, Developer License and welcome credits, with the Developer Console.
- Agent test and logs.
- Cloud Deployment.

## Development

```bash
npm ci
npm run typecheck
npm test                    # unit tests
npm run test:integration    # loads the extension in VS Code (needs a display, or xvfb-run)
npm run package             # builds libraos-<version>.vsix
```

End to end against real Docker and a real model endpoint, leaving nothing behind:

```bash
LIBRAOS_E2E=1 LIBRAOS_E2E_MODEL_KEY=… \
LIBRAOS_E2E_MODEL_BASE=https://api.meganova.ai LIBRAOS_E2E_MODEL=Qwen/Qwen3.6-35B-A3B \
npx vitest run test/e2e.runtime.test.ts
```

## License

This extension is MIT licensed. The LibraOS Runtime it installs is distributed
under its own licence.
