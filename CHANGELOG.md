# Changelog

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
