import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  output: string;
}

// Runs a command without a shell, so no argument is ever re-parsed.
export function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string; onOutput?: (chunk: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        shell: false,
      });
    } catch (err) {
      resolve({ code: -1, output: String(err) });
      return;
    }
    const onData = (b: Buffer) => {
      const s = b.toString();
      output += s;
      opts.onOutput?.(s);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => resolve({ code: -1, output: output + String(err) }));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

export interface DockerStatus {
  docker: boolean;
  compose: boolean;
  detail: string;
}

export async function checkDocker(): Promise<DockerStatus> {
  const d = await run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (d.code !== 0) {
    return { docker: false, compose: false, detail: d.output.trim() || "docker not found" };
  }
  const c = await run("docker", ["compose", "version", "--short"]);
  return {
    docker: true,
    compose: c.code === 0,
    detail: c.code === 0 ? `Docker ${d.output.trim()}, Compose ${c.output.trim()}` : "Docker Compose v2 not found",
  };
}
