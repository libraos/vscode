import { randomBytes, createHash } from "node:crypto";
import type * as vscode from "vscode";
import { randomSecret, type RuntimeSecrets } from "./runtime/compose";

// Everything secret lives in VS Code SecretStorage: never in settings, the
// workspace, or the generated compose file.
const PG = "libraos.runtime.pgPassword";
const JWT = "libraos.runtime.jwtSecret";
const ADMIN = "libraos.runtime.adminPassword";
const MODEL_KEY = "libraos.model.apiKey";

export class Secrets {
  constructor(private readonly store: vscode.SecretStorage) {}

  // Generated once and kept: the Postgres password is fixed when its volume
  // is first initialised, so it must not change between runs.
  async runtime(): Promise<RuntimeSecrets> {
    const get = async (k: string, bytes: number) => {
      let v = await this.store.get(k);
      if (!v) {
        v = randomSecret(bytes, randomBytes);
        await this.store.store(k, v);
      }
      return v;
    };
    return {
      pgPassword: await get(PG, 24),
      jwtSecret: await get(JWT, 32),
      adminPassword: await get(ADMIN, 24),
    };
  }

  async hasRuntime(): Promise<boolean> {
    return Boolean(await this.store.get(PG));
  }

  modelKey(): Thenable<string | undefined> {
    return this.store.get(MODEL_KEY);
  }

  async setModelKey(v: string | undefined): Promise<void> {
    if (v) await this.store.store(MODEL_KEY, v);
    else await this.store.delete(MODEL_KEY);
  }

  projectKey(folder: vscode.Uri): Thenable<string | undefined> {
    return this.store.get(projectKeyName(folder));
  }

  setProjectKey(folder: vscode.Uri, v: string): Thenable<void> {
    return this.store.store(projectKeyName(folder), v);
  }
}

function projectKeyName(folder: vscode.Uri): string {
  return "libraos.project." + createHash("sha256").update(folder.toString()).digest("hex").slice(0, 16);
}
