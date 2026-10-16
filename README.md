# LibraOS — AI Runtime for VS Code

**Build · Run · Integrate · Deploy.** Turn your codebase into an AI-powered application.

This extension adds the LibraOS Runtime to the app you already have. It
installs and runs the runtime locally, connects it to a model, wires your
project to it, and gives you runnable examples. It is not a coding assistant:
it does not chat with you or write your code. Its job is to remove the setup
steps between your editor and a running runtime.

> **Preview.** Inference credits and Cloud Deployment are not available yet
> and are shown as such in the sidebar.

## What it does

| | |
|---|---|
| **Install Runtime** | Checks for Docker, shows exactly what will run, and pulls the runtime and its Postgres, pinned by digest so Docker verifies what it pulls. |
| **Configure Model** | Points the runtime at an OpenAI-compatible endpoint: the MegaNova AI gateway, a local proxy, Ollama, or any other. Lists the endpoint's models, lets you pick one, and test-calls it before saving. |
| **Run / Stop Local Runtime** | Starts and stops the runtime, with its health in the status bar. |
| **Initialize LibraOS Project** | Detects TypeScript, JavaScript, Python or Go, adds a `libraos.json` (no secrets) and a quickstart file, and mints an API key for the project on the local runtime. Python projects are offered `pip install libraos-sdk`. |
| **Browse Cookbook** | Opens runnable examples from [`libraos/cookbook`](https://github.com/libraos/cookbook) and [`libraos/sdk`](https://github.com/libraos/sdk). |
| **Show Runtime Logs** | The runtime's recent log in the LibraOS output channel. |
| **Sign In / Sign Out** | Signs in to your LibraOS developer account with a one-time code you approve in the browser (device sign-in). VS Code never asks for or sees a password. |
| **Claim Developer Licence** | Shows the current developer terms and, after you confirm, records your organization's Developer Licence. The sidebar shows its status, edition and expiry. |
| **Open Console** | The LibraOS Developer Console, for keys, licences and usage. |

## Requirements

- VS Code 1.95 or newer.
- Docker with Compose v2.
- A model endpoint: a key for an OpenAI-compatible gateway, a local proxy, or
  Ollama on your machine.

## Install

The extension is not on the Marketplace yet. Download `libraos-<version>.vsix`
from the [Releases](https://github.com/libraos/vscode/releases) page, then either:

- in VS Code, open the Extensions view, choose **…** › **Install from VSIX…**
  and pick the file; or
- run `code --install-extension libraos-<version>.vsix`.

Cursor and other VS Code–based editors install it the same way. Check the file
against the `.sha256` published next to it.

## Quick start

1. Open your project folder and the **LibraOS** view in the activity bar.
2. **Configure Model**: pick an endpoint and a model; the extension test-calls it.
3. **Install Runtime**, then **Run Local Runtime**.
4. **Initialize LibraOS Project**.
5. Open a new VS Code terminal and run the quickstart file, for example
   `node libraos-quickstart.mts` or `python libraos_quickstart.py`.

## Developer account and licence

**Sign In** asks the Developer Console for a one-time code, opens the sign-in
page in your browser with the code filled in, and waits. Enter your account
email there; LibraOS emails you a link, and approving it signs VS Code in. The
notification can be cancelled at any time. A session lasts 24 hours; when it
ends, the extension says you are signed out and you sign in again.

**Claim Developer Licence** shows the terms summary and a link to the full
terms, and claims only after you confirm. A licence is a record of your rights
under the LibraOS licence terms: who claimed which edition, under which terms,
and until when. The runtime does not check it, and there is nothing to install
or configure. Today every self-serve claim is a 90-day organization
evaluation; production use needs a commercial licence. Claiming again while the
licence is active shows the same record; once an evaluation has ended,
claiming again does not renew it.

**Inference credits** are managed on MegaNova. Linking a LibraOS account to a
MegaNova account is not available yet, so the sidebar shows "Account not
linked" with a link to the [MegaNova console](https://console.meganova.ai/home)
and never a balance.

## Where your secrets live

- Every credential (the model key, the runtime's generated database, signing
  and admin secrets, each project's API key, and your Developer Console
  session) is kept in VS Code **SecretStorage**. None is written to settings,
  your workspace or the generated compose file.
- The Console session token is sent only to the Console address it was issued
  by (`libraos.consoleUrl`), only over https (plain http only to `localhost`),
  and only in the `Authorization` header. **Sign Out** deletes it.
- Your project's API key reaches your code through the `LIBRA_OS_API_KEY`
  environment variable, which the extension sets in VS Code terminals only for
  the current session. Use **Copy Project API Key** to set it elsewhere, and
  never commit it.
- The runtime and its database listen on `127.0.0.1` only. On Linux the
  runtime shares the host network so it can reach model endpoints on your
  machine; on macOS and Windows it runs on Docker's bridge network and
  `localhost` model URLs are rewritten to `host.docker.internal`.
- Installing asks for confirmation and shows the images and commands first.

Variables set in VS Code terminals: `LIBRA_OS_URL` and `LIBRA_OS_API_KEY`, the
names the LibraOS SDK, CLI and cookbook read.

## Settings

| Setting | Default | |
|---|---|---|
| `libraos.model.baseUrl` | `https://api.meganova.ai` | OpenAI-compatible endpoint the runtime calls |
| `libraos.model.name` | `Qwen/Qwen3.6-35B-A3B` | Model the runtime uses |
| `libraos.runtime.port` | `8900` | Runtime port on `127.0.0.1` |
| `libraos.runtime.postgresPort` | `55432` | Postgres port on `127.0.0.1` (Linux) |
| `libraos.runtime.image` | pinned release | Runtime image; keep it pinned by `@sha256:` digest |
| `libraos.consoleUrl` | `https://console.libraos.com` | Developer Console, used for sign-in and licences |

## Roadmap

- Inference credits, once LibraOS and MegaNova accounts can be linked.
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

In a real VS Code: Configure Model → Install → Run → Initialize Project → the
key reaches a new terminal → the quickstart gets an answer → Stop. The dialogs
are answered by the test; Docker, the runtime, the model, files and terminals
are real, and nothing is left behind:

```bash
LIBRAOS_E2E_MODEL_BASE=http://127.0.0.1:11434/v1 LIBRAOS_E2E_MODEL=qwen3:8b LIBRAOS_E2E_MODEL_KEY=… \
xvfb-run -a npm run test:e2e
```

The runtime path alone, without VS Code:

```bash
LIBRAOS_E2E=1 LIBRAOS_E2E_MODEL_KEY=… \
LIBRAOS_E2E_MODEL_BASE=https://api.meganova.ai LIBRAOS_E2E_MODEL=Qwen/Qwen3.6-35B-A3B \
npx vitest run test/e2e.runtime.test.ts
```

## License

This extension is MIT licensed. The LibraOS Runtime it installs is distributed
under its own licence.
