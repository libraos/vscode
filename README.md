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
| **Browse Cookbook** | The [`libraos/cookbook`](https://github.com/libraos/cookbook) learning paths and [`libraos/sdk`](https://github.com/libraos/sdk) examples, with what each one needs before it runs. See [Cookbook examples](#cookbook-examples). |
| **Copy Setup Token** | A one-hour admin token for the local runtime, for cookbook examples that create agents or ingest documents. See [Setup token](#setup-token). |
| **Show Runtime Logs** | The runtime's recent log in the LibraOS output channel. |
| **Sign In / Sign Out** | Optional. Personal use needs no sign-in and no licence. Sign in only to claim the free Developer Licence and its benefits, with a one-time code you approve in the browser (device sign-in). VS Code never asks for or sees a password. |
| **Claim Developer Licence** | Shows the current developer terms and, after you confirm, records your free Developer Licence. Personal use needs no licence. |
| **Register This Instance for Developer Benefits** | A Developer Licence benefit: registers the local runtime with your account (up to 5 benefit-registered instances), so you can see and remove them from the sidebar. |
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

## Cookbook examples

**Browse Cookbook** and the sidebar's **Examples** follow the cookbook's
[learning paths](https://github.com/libraos/cookbook/blob/main/docs/learning-paths.md):

- **Learn Step by Step:** First Agent and Ticket Routing (L1), then any of
  Document Q&A, Tools or Memory (L2), Customer Support and HTTP Async Job &
  Recovery (L3), and the complete applications (L4).
- **Explore by Capability:** Knowledge, Tools, Memory or Async on its own.
- **See Complete Applications:** Personal Assistant, Marketing Team and
  Mission Console.
- **SDK Examples:** single-file examples from `libraos/sdk`, marked as SDK
  examples.

Click an example in the sidebar, or choose **Get Example**, to run it in VS Code:

1. The first time, it asks where to keep the examples. It downloads the whole
   cookbook from GitHub into a `libraos-cookbook` folder there, so the files
   examples share (`get-started/.env`, `shared/`, `packs/`) are in place. SDK
   examples go into `libraos-sdk-examples`, with only the files they need.
   Later examples reuse the copy. When the cookbook changes on GitHub, it
   offers to update the copy, keeping your `.env`, `.venv` and your own files.
2. For a Python example, it offers to create a `.venv` in that folder with the
   examples' pinned packages (`libraos-sdk` 2.0.0 and the rest of
   `requirements-dev.txt`), using Python 3.10 or newer. It shows the commands
   first and installs nothing outside the folder. The folder's VS Code settings
   point Run and Debug at that `.venv`.
   First Agent comes in Python, TypeScript and Bash, and Get Example asks
   which one. TypeScript runs with `npx tsx`, so it needs no Python setup.
3. It opens the example: in a new window for the examples folder (recommended,
   so Run and Debug use its `.venv`), or in this window. You get the source
   file, its README beside it, and a terminal with the run command typed in
   but not run.
4. Cookbook examples run against the cookbook's local Runtime, which reads
   `get-started/.env`. If that file is missing, it offers to create it from
   the cookbook's template for you to fill in.

Each example in the sidebar also has inline buttons: **What This Example
Needs** shows its language and SDK versions, Runtime switches, mounted app
folders, tool-callback setup, users or sign-in clients, and how far it has been
validated. **Open Tutorial** opens its README on GitHub. **View Example on
GitHub** opens its source there.

### Setup token

The project API key can call models and chat with agents that already exist,
but the runtime refuses it for creating agents, ingesting documents or
importing bundles (`403 api_key_scope`). Most cookbook examples start by
creating an agent, so they need a setup identity. **Copy Setup Token** (in the
Runtime section while it runs) gets one from the local runtime:

- It is an admin token for the runtime on this machine, minted by a
  laptop-only service client whose secret stays in SecretStorage. It expires
  after an hour. Keep it on this machine.
- **Open Terminal** puts it in `LIBRA_OS_SETUP_TOKEN` for that terminal only.
  Run a command with it as `LIBRA_OS_API_KEY="$LIBRA_OS_SETUP_TOKEN" <command>`.
  It is passed this way because VS Code gives the extension's
  `LIBRA_OS_API_KEY` (your project key) precedence in project windows.
- **Get Example** offers **Run on This Extension's Runtime** for the examples
  that can use it: First Agent in Python, Ticket Routing, Document Q&A and
  HTTP Async Jobs. It opens a terminal with the token and the command typed.
- A runtime started by an earlier version of the extension has no setup client
  yet; the command offers to restart it. Its data is kept.

### Which Runtime to run them on

The Runtime this extension manages is for your own app. VS Code terminals get
`LIBRA_OS_URL` and an inference-scoped project API key, which covers
model-serving routes and chat with existing agents. Most cookbook examples need
more: a setup identity that creates agents and ingests knowledge, and some
need memory or mission switches, mounted app folders, callback secrets and
allowed hosts, two ordinary users, or sign-in clients. Use the cookbook's
[get-started setup](https://github.com/libraos/cookbook/blob/main/get-started/README.md)
and [recipe setup](https://github.com/libraos/cookbook/blob/main/docs/recipe-setup.md)
for those. The extension does not change its Runtime's configuration for an
example. Both Runtimes default to port 8900, so stop one before starting the
other, or change a port.

The cookbook is written against Runtime v0.2.2 and `libraos-sdk` 2.0.0, the
Runtime version this extension pins. The native HTTP async recipe uses the
`/agents/v1/{agent}/jobs` routes. The SDK's managed jobs example uses
`/v1/managed/agents/jobs`, which older Runtime releases may not serve. The two
have different response shapes.

A listed example is not a compatibility certification. The Tools, Memory and
HTTP Async recipes have passed the cookbook's offline protocol tests, but live
Runtime and model runs have not been recorded for them yet. See the cookbook's
[validation notes](https://github.com/libraos/cookbook/blob/main/docs/validation.md).

## Developer account and licence

**Sign In** asks the Developer Console for a one-time code, opens the sign-in
page in your browser with the code filled in, and waits. Enter your account
email there; LibraOS emails you a link, and approving it signs VS Code in. The
notification can be cancelled at any time. A session lasts 24 hours; when it
ends, the extension says you are signed out and you sign in again.

### Licences

**Personal (default).** Personal use of LibraOS is free and needs no account
and no licence record. The runtime never checks a licence, and nothing stops
it from running. Signed out, or with nothing claimed, the sidebar shows
**Licence: Personal (default)**.

**Developer Licence.** Free, for one person with a LibraOS account, with no
expiry. It covers personal use and non-production development inside an
organization. Production use needs a commercial or small-organization licence;
see the Licenses page in the Console. **Claim Developer Licence** shows the
terms summary and a link to the full terms, and claims only after you confirm.
A licence is a record of your rights, not something to install or configure.

Benefits, listed under the licence in the sidebar:

- **Benefit-registered instances**, up to 5. **Register This Instance for Developer Benefits** reads
  the local runtime's installation id (a random id the runtime creates once per
  database; the extension reads it with its own admin session to the runtime,
  which never leaves your machine) and sends it, with a name you choose and the
  runtime version, to the Console. Nothing is registered unless you run the
  command, and the runtime itself never calls out. When all slots are in use,
  the command lists them and offers to remove one; **Remove** on an
  instance frees its slot right away. Removing a registration does not
  affect the runtime. The id belongs to the runtime's database, not to a
  machine: runtimes sharing a database are one instance, and a copied
  database keeps the same id.
- **Inference credits**: coming (see below).

Organization evaluation and small-organization licence records are shown with
their expiry when your organization holds one.

**Inference credits** are managed on MegaNova. Linking a LibraOS account to a
MegaNova account is not available yet, so the sidebar shows them as "Coming"
with a link to the [MegaNova console](https://console.meganova.ai/home) and
never a balance.

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
