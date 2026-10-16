import { describe, expect, it } from "vitest";
import {
  defaultInstallationName,
  installationTarget,
  registerInstallationFlow,
  removeInstallationFlow,
  validateName,
  type InstallationsApi,
  type RegisterDeps,
  type Ui,
} from "../src/cloud/installations";
import { UnauthorizedError, type Installation, type RegisterResult } from "../src/cloud/client";
import { RuntimeApiError, type RuntimeInstallation } from "../src/runtime/api";

const LOCAL: RuntimeInstallation = { installationId: "local-uuid", persistent: true, version: "v0.3.0" };
const others: Installation[] = [1, 2, 3, 4, 5].map((n) => ({ installationId: `id-${n}`, name: `box ${n}` }));

// Records every dialog and answers from a script keyed by dialog kind.
function fakeUi(answers: { warn?: (string | undefined)[]; input?: string | undefined; pick?: number | undefined; confirm?: boolean } = {}) {
  const log: string[] = [];
  const warn = [...(answers.warn ?? [])];
  const ui: Ui = {
    info: async (m) => (log.push(`info: ${m}`), undefined),
    warn: async (m, ...a) => {
      log.push(`warn: ${m}${a.length ? ` [${a.join("|")}]` : ""}`);
      return warn.shift();
    },
    error: (m) => void log.push(`error: ${m}`),
    confirm: async (m) => (log.push(`confirm: ${m}`), answers.confirm ?? true),
    input: async (title, value, validate) => {
      log.push(`input: ${title} = ${value}`);
      const v = "input" in answers ? answers.input : value;
      if (v !== undefined && validate(v)) throw new Error(`invalid input ${v}`);
      return v;
    },
    pick: async (title, items) => {
      log.push(`pick: ${title} (${items.map((i) => i.label).join(", ")})`);
      return answers.pick === undefined ? undefined : items[answers.pick];
    },
  };
  return { ui, log };
}

function fakeApi(results: (RegisterResult | Error)[], list: Installation[] = []) {
  const calls: string[] = [];
  const api: InstallationsApi = {
    register: async (r) => {
      calls.push(`register ${r.installationId} ${r.name} ${r.runtimeVersion ?? "-"}`);
      const next = results.shift();
      if (!next) throw new Error("no scripted result");
      if (next instanceof Error) throw next;
      return next;
    },
    list: async () => (calls.push("list"), { limit: 5, installations: list }),
    remove: async (id) => (calls.push(`remove ${id}`), id !== "gone"),
  };
  return { api, calls };
}

function deps(ui: Ui, api: InstallationsApi, local: () => Promise<RuntimeInstallation | "not_running"> = async () => LOCAL) {
  const events: string[] = [];
  const d: RegisterDeps = {
    ui,
    api,
    local,
    defaultName: "my-app",
    claimLicence: async () => void events.push("claim"),
    startRuntime: async () => void events.push("start"),
    signedOut: async () => void events.push("signed out"),
    changed: async (id) => void events.push(`changed ${id ?? "-"}`),
  };
  return { d, events };
}

describe("registerInstallationFlow", () => {
  it("201: registers with the editable name and the runtime's version", async () => {
    const { ui, log } = fakeUi({ input: "  laptop  " });
    const { api, calls } = fakeApi([{ kind: "registered" }]);
    const { d, events } = deps(ui, api);
    expect(await registerInstallationFlow(d)).toBe("registered");
    expect(calls).toEqual(["register local-uuid laptop v0.3.0"]);
    expect(log[0]).toBe("input: Name this installation = my-app");
    expect(log.at(-1)).toMatch(/Registered “laptop”/);
    expect(events).toEqual(["changed local-uuid"]);
  });

  it("200: an existing registration is updated", async () => {
    const { ui, log } = fakeUi();
    const { api } = fakeApi([{ kind: "updated" }]);
    const { d } = deps(ui, api);
    expect(await registerInstallationFlow(d)).toBe("updated");
    expect(log.join("\n")).toMatch(/already registered/);
  });

  it("warns when the runtime's id is not persistent", async () => {
    const { ui, log } = fakeUi();
    const { api } = fakeApi([{ kind: "registered" }]);
    const { d } = deps(ui, api, async () => ({ ...LOCAL, persistent: false }));
    await registerInstallationFlow(d);
    expect(log.some((l) => l.startsWith("warn:") && /changes when it restarts/.test(l))).toBe(true);
  });

  it("cancelling the name sends nothing", async () => {
    const { ui } = fakeUi({ input: undefined });
    const { api, calls } = fakeApi([]);
    expect(await registerInstallationFlow(deps(ui, api).d)).toBe("cancelled");
    expect(calls).toEqual([]);
  });

  it("403: offers the Developer Licence claim", async () => {
    const { ui, log } = fakeUi({ warn: ["Claim Developer Licence"] });
    const { api } = fakeApi([{ kind: "developer_license_required" }]);
    const { d, events } = deps(ui, api);
    expect(await registerInstallationFlow(d)).toBe("licence_required");
    expect(log.join("\n")).toMatch(/Developer Licence benefit.*\[Claim Developer Licence\]/);
    expect(events).toEqual(["claim"]);
  });

  it("409: shows the list, removes the chosen one after confirmation, then registers", async () => {
    const { ui, log } = fakeUi({ warn: ["Remove One…"], pick: 1, confirm: true });
    const { api, calls } = fakeApi([{ kind: "limit_reached", limit: 5, installations: others }, { kind: "registered" }]);
    const { d, events } = deps(ui, api);
    expect(await registerInstallationFlow(d)).toBe("registered");
    expect(log.join("\n")).toMatch(/All 5 installation slots are in use/);
    expect(log.some((l) => l.startsWith("pick:") && l.includes("box 1, box 2, box 3, box 4, box 5"))).toBe(true);
    expect(log.some((l) => l === "confirm: Remove “box 2” from your registered installations?")).toBe(true);
    expect(calls).toEqual(["register local-uuid my-app v0.3.0", "remove id-2", "register local-uuid my-app v0.3.0"]);
    expect(events).toEqual(["changed -", "changed local-uuid"]);
  });

  it("409: declining removal (dialog, pick or confirmation) removes nothing", async () => {
    for (const answers of [{ warn: [undefined] }, { warn: ["Remove One…"], pick: undefined }, { warn: ["Remove One…"], pick: 0, confirm: false }]) {
      const { ui } = fakeUi(answers);
      const { api, calls } = fakeApi([{ kind: "limit_reached", limit: 5, installations: others }]);
      expect(await registerInstallationFlow(deps(ui, api).d)).toBe("limit_reached");
      expect(calls.filter((c) => c.startsWith("remove"))).toEqual([]);
    }
  });

  it("409 twice: does not loop", async () => {
    const { ui, log } = fakeUi({ warn: ["Remove One…"], pick: 0 });
    const full = { kind: "limit_reached" as const, limit: 5, installations: others };
    const { api, calls } = fakeApi([full, full]);
    expect(await registerInstallationFlow(deps(ui, api).d)).toBe("limit_reached");
    expect(calls.filter((c) => c.startsWith("register"))).toHaveLength(2);
    expect(log.at(-1)).toMatch(/^error: .*still reached/);
  });

  it("401: signs out", async () => {
    const { ui } = fakeUi();
    const { api } = fakeApi([new UnauthorizedError()]);
    const { d, events } = deps(ui, api);
    expect(await registerInstallationFlow(d)).toBe("signed_out");
    expect(events).toEqual(["signed out"]);
  });

  it("runtime 404: says the runtime must be updated, sends nothing", async () => {
    const { ui, log } = fakeUi();
    const { api, calls } = fakeApi([]);
    const { d } = deps(ui, api, async () => {
      throw new RuntimeApiError("/v1/managed/installation: not_found", 404);
    });
    expect(await registerInstallationFlow(d)).toBe("runtime_outdated");
    expect(log).toEqual([expect.stringMatching(/^error: .*Update the runtime/)]);
    expect(calls).toEqual([]);
  });

  it("runtime not running: offers to start it", async () => {
    const { ui } = fakeUi({ warn: ["Run Local Runtime"] });
    const { api, calls } = fakeApi([]);
    const { d, events } = deps(ui, api, async () => "not_running");
    expect(await registerInstallationFlow(d)).toBe("not_running");
    expect(events).toEqual(["start"]);
    expect(calls).toEqual([]);
  });

  it("other errors are reported", async () => {
    const { ui, log } = fakeUi();
    const { api } = fakeApi([new Error("/v1/installations: HTTP 500")]);
    expect(await registerInstallationFlow(deps(ui, api).d)).toBe("failed");
    expect(log.at(-1)).toMatch(/could not register.*HTTP 500/);
  });
});

describe("removeInstallationFlow", () => {
  const rdeps = (ui: Ui, api: InstallationsApi) => {
    const events: string[] = [];
    return {
      events,
      d: { ui, api, signedOut: async () => void events.push("signed out"), changed: async () => void events.push("changed") },
    };
  };

  it("removes the sidebar item after confirmation", async () => {
    const { ui, log } = fakeUi({ confirm: true });
    const { api, calls } = fakeApi([]);
    const { d, events } = rdeps(ui, api);
    expect(await removeInstallationFlow(d, { installationId: "id-3", name: "box 3" })).toBe("removed");
    expect(calls).toEqual(["remove id-3"]);
    expect(log[0]).toMatch(/^confirm: Remove “box 3”/);
    expect(events).toEqual(["changed"]);
  });

  it("not confirmed: nothing removed", async () => {
    const { ui } = fakeUi({ confirm: false });
    const { api, calls } = fakeApi([]);
    expect(await removeInstallationFlow(rdeps(ui, api).d, { installationId: "id-3", name: "box 3" })).toBe("cancelled");
    expect(calls).toEqual([]);
  });

  it("already gone (404) still counts as removed", async () => {
    const { ui, log } = fakeUi();
    const { api } = fakeApi([]);
    expect(await removeInstallationFlow(rdeps(ui, api).d, { installationId: "gone", name: "old" })).toBe("removed");
    expect(log.at(-1)).toMatch(/was not registered any more/);
  });

  it("from the palette: picks from the list", async () => {
    const { ui } = fakeUi({ pick: 4 });
    const { api, calls } = fakeApi([], others);
    expect(await removeInstallationFlow(rdeps(ui, api).d)).toBe("removed");
    expect(calls).toEqual(["list", "remove id-5"]);
  });

  it("from the palette with nothing registered", async () => {
    const { ui } = fakeUi();
    const { api } = fakeApi([], []);
    expect(await removeInstallationFlow(rdeps(ui, api).d)).toBe("none");
  });

  it("401: signs out", async () => {
    const { ui } = fakeUi();
    const api: InstallationsApi = { ...fakeApi([]).api, remove: async () => Promise.reject(new UnauthorizedError()) };
    const { d, events } = rdeps(ui, api);
    expect(await removeInstallationFlow(d, { installationId: "x", name: "x" })).toBe("signed_out");
    expect(events).toEqual(["signed out"]);
  });
});

describe("helpers", () => {
  it("default name: workspace folder, else host name, at most 64 characters", () => {
    expect(defaultInstallationName("my-app", "host")).toBe("my-app");
    expect(defaultInstallationName(undefined, "host")).toBe("host");
    expect(defaultInstallationName("x".repeat(80), "host")).toHaveLength(64);
  });

  it("validates names", () => {
    expect(validateName("  ")).toBeTruthy();
    expect(validateName("x".repeat(65))).toBeTruthy();
    expect(validateName("laptop")).toBeUndefined();
  });

  it("reads the Remove target from a tree item, an arg or an id", () => {
    expect(installationTarget({ arg: { installationId: "a", name: "A" } })).toEqual({ installationId: "a", name: "A" });
    expect(installationTarget({ installationId: "a" })).toEqual({ installationId: "a", name: "a" });
    expect(installationTarget("a")).toEqual({ installationId: "a", name: "a" });
    expect(installationTarget(undefined)).toBeUndefined();
    expect(installationTarget({ label: "x" })).toBeUndefined();
  });
});
