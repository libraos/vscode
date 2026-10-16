# Changelog

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
