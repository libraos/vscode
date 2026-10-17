# Changelog

## Unreleased

- **Click an example to run it.** Runnable examples (▶) run in one click on the Runtime this extension manages: Run Example downloads only that example (11 files for First Agent and Async Jobs, instead of the whole cookbook), creates the Python environment if needed, starts the Runtime if it is stopped, and runs the example in a terminal with a one-hour setup token, with the Runtime Log beside it. No folder dialog, no `.env`, no passwords, no switch; one confirmation the first time, with **Always Run Without Asking**.
- **First Agent in three entries**: Python, TypeScript and Bash, each runs its own script directly instead of asking for a language. TypeScript and Bash take the token once libraos/cookbook#18 is merged; until then Run Example says so instead of failing.
- Async Jobs runs submit and resume in one go.
- Examples that need the cookbook's own setup show what they need when clicked. The inline buttons are Run, Get Example and What It Needs; the tutorial and GitHub links are in the right-click menu.
- Marketing Team and Mission Console say **strong model** in the sidebar, and their cards start with why: the mission is planned as one JSON object with at least 10 tasks, which small local models fail (GLM-4.7-Flash did; Claude Sonnet completed it). Kernel side: libraos/libraos#1752.

## 0.4.0 (preview)

- **Configure Embedding Model.** Knowledge search needs an embedding model. By default the runtime embeds through the model endpoint, which a chat-only server (a local proxy, llama.cpp) cannot do; ingest then failed with `embedding API error 404`. The command points the runtime at Ollama on this machine or another endpoint, test-calls the model, and sets `LIBRA_OS_EMBED_DIM` to its vector size, which the runtime's store must match (`768-dim embedding, the store expects 4096` otherwise).
- **Runtime Log: one line per call.** The runtime records each agent call twice (an agent-level row and the model call); the log now shows the model row only.
- **Example cards, from running every example on Runtime v0.2.2:** Document Q&A says it needs an embedding model; the SDK streaming example says its default agent `default-assistant` does not exist on v0.2.2 and to set `LIBRA_OS_AGENT_ID=default`.

- **Runtime Explorer.** A new view lists the local runtime's agents, with their bound collections, tool scope, call stats and memory, and its knowledge collections, with documents, chunks and bound agents. Bindings to collections the runtime does not have are marked. **Show Agent Definition** opens an agent as read-only JSON; **Debug Retrieval** shows the chunks a question would retrieve, stage by stage.
- **Runtime Log in a terminal.** Follows the runtime while your app runs: one line per agent or model call with latency, tokens and errors, plus server warnings and errors.
- **FastAPI apps.** Initialize LibraOS Project offers a FastAPI backend for Python projects (detected from your dependencies, or chosen), with `POST /ask`, per-user `end_user`, and a Run and Debug configuration that starts it under uvicorn.
- The SDK managed jobs example now says Runtime v0.2.2 does not serve its route.

- **Copy Setup Token.** The project API key cannot create agents or ingest documents, so most cookbook examples failed against the Runtime this extension manages (`403 api_key_scope`). Copy Setup Token gets a one-hour admin token from the local Runtime, minted by a laptop-only service client whose secret stays in SecretStorage. **Open Terminal** puts it in `LIBRA_OS_SETUP_TOKEN` for that terminal; run a command with `LIBRA_OS_API_KEY="$LIBRA_OS_SETUP_TOKEN" <command>`. A Runtime started by an earlier version offers a restart to add the client; its data is kept.
- **Get Example: Run on This Extension's Runtime.** For First Agent (Python), Ticket Routing, Document Q&A and HTTP Async Jobs, Get Example offers a terminal with a setup token and the command typed, so they run without the cookbook's own Runtime.
- **Run and Debug in the examples folder.** In the examples window, **Examples' Run and Debug** (Runtime section), or **Use This Runtime for Run and Debug** in Get Example, gives that window's terminals a setup token as `LIBRA_OS_API_KEY`, so VS Code's Run button and debugger run First Agent (Python), Ticket Routing, Document Q&A and HTTP Async Jobs against the Runtime this extension manages. The token stays in memory, is renewed before it expires, is withdrawn when the Runtime stops, and never reaches project folders.
- **Personal licence first.** Signed out, the Developer section lists **Licence: Personal (default)** first, then the optional **Sign In** for the Developer Licence.

## 0.3.2 (preview)

- **Get Example: examples open and run in VS Code.** Clicking an example downloads it from GitHub into a local folder you choose: the whole cookbook once, into `libraos-cookbook`, so files shared between examples are in place, and only the needed files for SDK examples. It then opens the source file from disk with its README beside it, and a terminal with the run command typed in but not run. In 0.3.1, most examples opened only on GitHub, and single-file examples opened as unsaved buffers that VS Code's Run button could not run.
- **Python is set up for you.** For a Python example, Get Example offers to create a `.venv` in the examples folder with the pinned packages, `libraos-sdk` 2.0.0 among them, so the script no longer fails with `ModuleNotFoundError: No module named 'libraos'`. It picks Python 3.10 or newer, skipping an older `python3`, shows the commands before running them, and points the folder's Run and Debug at the `.venv`.
- **First Agent in Python, TypeScript or Bash.** Get Example asks which language, opens that file, and types its command: `npx tsx first-agent.ts` for TypeScript, which needs no Python setup.
- **Updates keep your work.** When the cookbook changes on GitHub, Get Example offers to update your copy, keeping your `.env`, `.venv` and your own files.
- **`get-started/.env` from the template.** Cookbook examples read the cookbook Runtime's settings from `get-started/.env`. If it is missing, Get Example offers to create it from the cookbook's template.
- **What This Example Needs**, **Open Tutorial** and **View Example on GitHub** are inline buttons on each example.

## 0.3.1 (preview)

- **Cookbook v2 navigation.** Browse Cookbook and the sidebar's Examples follow the cookbook's learning paths: **Learn Step by Step** (L1 to L4), **Explore by Capability** (Knowledge, Tools, Memory, Async) and **See Complete Applications**, with SDK examples listed separately. New entries: Python First Agent, Tools: Order Lookup, Memory: User Isolation, HTTP Async Job & Recovery, Personal Assistant, Marketing Team and Mission Console.
- **What an example needs, before it opens.** Choosing an example shows its language and SDK versions, Runtime switches, mounted app folders, callback setup, users or sign-in clients, which Runtime to run it on, and its validation status. A listing is not a compatibility certification.
- **Open Tutorial** opens the example's README. **View Source** opens a single-file example in an editor, and the repository folder for an example with several files. Both are inline buttons in the sidebar and commands in the Command Palette.
- **Cookbook Setup or This Runtime?** explains when to use the cookbook's get-started setup instead of the Runtime the extension manages. The extension's Runtime and its configuration are unchanged.
- **Sign-in prompt** matches the Console's approval page, which now asks you to type the code instead of showing it: the prompt says to paste or type the code in the browser to approve, notes that a Console session or a Google or GitHub account can approve without the email, and the waiting notice says the same.

## 0.3.0 (preview)

- **Personal is the default.** Signed out, or signed in with no licence record, the sidebar shows **Licence: Personal (default)**. Personal use is free, needs no account, and the runtime never checks a licence. Wording that suggested a licence was needed to use the runtime is gone. **Sign In is optional**: it is only for claiming the free Developer Licence and its benefits.
- **Developer Licence.** **Claim Developer Licence** shows the current developer terms and claims only after you confirm. The Developer Licence is free and does not expire. It covers personal use and non-production development inside an organization; production use needs a commercial or small-organization licence (see the Console's Licenses page). Once held, the sidebar shows it with "no expiry" and its benefits.
- **Benefits under the Developer Licence:** benefit-registered instances (live) and inference credits (coming, with a link to the MegaNova console, never a balance).
- **Register This Instance for Developer Benefits.** Reads the local runtime's installation id (the extension's own admin session to the runtime, which stays on your machine), asks for a name (the workspace folder or host name by default), and registers it with your account. Nothing is registered unless you run the command. Up to 5 benefit-registered instances; the id belongs to the runtime's database, so runtimes sharing a database are one instance. When all slots are in use, it lists them and offers to remove one. Without a Developer Licence it offers the claim; a runtime too old to report an id is reported as needing an update.
- **Benefit-registered instances n/5** in the sidebar, with each instance, "this machine" marked, and a **Remove** action (with confirmation) that frees the slot right away. Also available from the Command Palette.
- Organization evaluation and small-organization licence records are shown with their expiry when your organization holds them.
- **Icons show up.** Both icons had a solid white background. The activity bar uses an icon's transparency as a mask, so it showed a plain square instead of the logo, and the Extensions view showed the logo on a white tile. The extension icon is now the LibraOS mark on a transparent background, and the activity bar uses the monochrome mark as an SVG, so it takes the theme's colour.

Registration and the new licence display need the matching Console and runtime releases. The Personal default and the icons work without them.

## 0.2.0 (preview)

- **Sign In / Sign Out** to your LibraOS developer account with device sign-in: a one-time code, approved in the browser through a link emailed to you. VS Code never asks for a password. The session token is kept only in SecretStorage and sent only to the configured Console; an ended session (24 hours) signs you out with a notice.
- **Developer Licence** in the sidebar: not signed in, not claimed, active with edition and expiry, or expired. **Claim Developer Licence** shows the terms and asks for explicit confirmation first; a repeat claim, changed terms and an ended evaluation each get a plain explanation. A licence is a record of rights; the runtime does not check it.
- **Inference credits** show "Account not linked" with a link to the MegaNova console, until accounts can be linked. No balance is shown.
- **Open Console** opens `libraos.consoleUrl`.
- The signed-in account is shown in the sidebar and the status bar tooltip.
- Runtime pinned to `v0.2.2` by its multi-arch index digest.

## 0.1.0 (preview)

- Install, run and stop the LibraOS Runtime locally with Docker Compose, images pinned by digest.
- Configure the model endpoint: list its models, pick one, test-call it before saving.
- Initialize a TypeScript, JavaScript, Python or Go project: `libraos.json`, a quickstart file and a project API key.
- Project API key kept in SecretStorage and given to VS Code terminals as `LIBRA_OS_API_KEY`, with the runtime URL as `LIBRA_OS_URL`.
- Cookbook and SDK examples.
- Sidebar with Developer, Runtime, Project and Examples, plus a status bar item.
- Sign-in, Developer License, welcome credits and Cloud Deployment shown as coming.
