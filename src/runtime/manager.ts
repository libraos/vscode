import * as vscode from "vscode";
import { checkDocker, run } from "./docker";
import {
  composeArgs,
  composeEnv,
  composeFile,
  isDigestPinned,
  networkModeFor,
  POSTGRES_IMAGE,
  type RuntimeSettings,
} from "./compose";
import { health, runtimeUrl, type Health } from "./api";
import type { Secrets } from "../secrets";

const INSTALLED = "libraos.runtime.installed";

export type RuntimeState = "not-installed" | "stopped" | "starting" | "running";

export class RuntimeManager {
  private state: RuntimeState = "not-installed";
  private lastHealth: Health = { ok: false };
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly secrets: Secrets,
    readonly output: vscode.OutputChannel,
  ) {
    this.state = this.installed ? "stopped" : "not-installed";
  }

  get installed(): boolean {
    return this.ctx.globalState.get<boolean>(INSTALLED, false);
  }

  get status(): RuntimeState {
    return this.state;
  }

  get version(): string | undefined {
    return this.lastHealth.version;
  }

  settings(): RuntimeSettings & { modelApiKey?: string } {
    const c = vscode.workspace.getConfiguration("libraos");
    return {
      image: c.get<string>("runtime.image", ""),
      port: c.get<number>("runtime.port", 8900),
      pgPort: c.get<number>("runtime.postgresPort", 55432),
      mode: networkModeFor(process.platform),
      modelBaseUrl: c.get<string>("model.baseUrl", "https://api.meganova.ai"),
      modelName: c.get<string>("model.name", "Qwen/Qwen3.6-35B-A3B"),
    };
  }

  get baseUrl(): string {
    return runtimeUrl(this.settings().port);
  }

  private get composePath(): vscode.Uri {
    return vscode.Uri.joinPath(this.ctx.globalStorageUri, "runtime", "docker-compose.yml");
  }

  private async env(): Promise<Record<string, string>> {
    const s = this.settings();
    s.modelApiKey = await this.secrets.modelKey();
    return composeEnv(s, await this.secrets.runtime());
  }

  private async compose(title: string, ...cmd: string[]): Promise<boolean> {
    const args = composeArgs(this.composePath.fsPath, ...cmd);
    this.output.appendLine(`$ docker ${args.join(" ")}`);
    const env = await this.env();
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      () => run("docker", args, { env, onOutput: (s) => this.output.append(s) }),
    );
    if (res.code !== 0) {
      this.output.show(true);
      void vscode.window.showErrorMessage(`LibraOS: ${title} failed. See the LibraOS output for details.`);
      return false;
    }
    return true;
  }

  async refresh(): Promise<void> {
    if (!this.installed) {
      this.setState("not-installed");
      return;
    }
    this.lastHealth = await health(this.baseUrl);
    if (this.lastHealth.ok) this.setState("running");
    else if (this.state !== "starting") this.setState("stopped");
    else this.changed.fire();
  }

  private setState(s: RuntimeState): void {
    this.state = s;
    this.changed.fire();
  }

  // Shows what will run, asks before running it, writes the compose file and
  // pulls the pinned images.
  async install(): Promise<boolean> {
    const d = await checkDocker();
    if (!d.docker || !d.compose) {
      const pick = await vscode.window.showErrorMessage(
        `LibraOS needs Docker with Compose v2 to run the local runtime. ${d.detail}`,
        "Get Docker",
      );
      if (pick) void vscode.env.openExternal(vscode.Uri.parse("https://docs.docker.com/get-docker/"));
      return false;
    }
    const s = this.settings();
    const unpinned = [s.image, POSTGRES_IMAGE].filter((i) => !isDigestPinned(i));
    const detail = [
      `Writes ${this.composePath.fsPath}`,
      s.mode === "host"
        ? `Network: host, runtime bound to 127.0.0.1:${s.port} and Postgres to 127.0.0.1:${s.pgPort}`
        : `Network: Docker bridge, runtime published on 127.0.0.1:${s.port}`,
      `Runs: docker compose -p libraos-vscode pull`,
      "",
      "Images:",
      `  ${s.image}`,
      `  ${POSTGRES_IMAGE}`,
      "",
      unpinned.length
        ? `Warning: not pinned by digest, so Docker cannot verify them: ${unpinned.join(", ")}`
        : "Both images are pinned by digest; Docker verifies what it pulls.",
      "",
      "Secrets are generated and kept in VS Code SecretStorage, not on disk.",
    ].join("\n");
    const ok = await vscode.window.showInformationMessage(
      "Install the LibraOS local runtime?",
      { modal: true, detail },
      "Install",
    );
    if (ok !== "Install") return false;

    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.composePath, ".."));
    await vscode.workspace.fs.writeFile(this.composePath, Buffer.from(composeFile(this.settings().mode)));
    await this.secrets.runtime();
    if (!(await this.compose("Pulling the LibraOS runtime images", "pull"))) return false;
    await this.ctx.globalState.update(INSTALLED, true);
    this.setState("stopped");
    void vscode.window.showInformationMessage("LibraOS runtime installed. Run it with “Run Local Runtime”.");
    return true;
  }

  async start(): Promise<boolean> {
    if (!this.installed && !(await this.install())) return false;
    // Rewrite the file in case the extension was updated since install.
    await vscode.workspace.fs.writeFile(this.composePath, Buffer.from(composeFile(this.settings().mode)));
    this.setState("starting");
    if (!(await this.compose("Starting the LibraOS runtime", "up", "-d"))) {
      await this.refresh();
      return false;
    }
    const deadline = Date.now() + 180_000;
    const ok = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Waiting for the LibraOS runtime to become healthy" },
      async () => {
        while (Date.now() < deadline) {
          this.lastHealth = await health(this.baseUrl);
          if (this.lastHealth.ok) return true;
          await new Promise((r) => setTimeout(r, 2000));
        }
        return false;
      },
    );
    if (!ok) {
      this.setState("stopped");
      await this.logs();
      void vscode.window.showErrorMessage("LibraOS: the runtime did not become healthy within 3 minutes. See its logs.");
      return false;
    }
    this.setState("running");
    void vscode.window.showInformationMessage(`LibraOS runtime is running at ${this.baseUrl}`);
    return true;
  }

  async stop(): Promise<void> {
    if (!this.installed) return;
    // `down` removes the containers; the data volumes are kept.
    await this.compose("Stopping the LibraOS runtime", "down");
    await this.refresh();
  }

  async logs(): Promise<void> {
    if (!this.installed) {
      void vscode.window.showInformationMessage("The LibraOS runtime is not installed yet.");
      return;
    }
    this.output.show(true);
    const args = composeArgs(this.composePath.fsPath, "logs", "--no-color", "--tail", "300", "libraos");
    this.output.appendLine(`$ docker ${args.join(" ")}`);
    await run("docker", args, { env: await this.env(), onOutput: (s) => this.output.append(s) });
  }
}
