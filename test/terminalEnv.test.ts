import { describe, expect, it } from "vitest";
import { renewIn, terminalEnv } from "../src/runtime/terminalEnv";

const base = "http://127.0.0.1:8900";

describe("terminalEnv", () => {
  it("gives a project folder its project key, as before", () => {
    const plan = terminalEnv([{ id: "app", isExamples: false, projectKey: "pk" }], { baseUrl: base });
    expect(plan.get("app")).toEqual({ LIBRA_OS_URL: base, LIBRA_OS_API_KEY: "pk" });
  });

  it("gives an examples folder the setup token only when its Run and Debug use this Runtime", () => {
    const folders = [{ id: "cookbook", isExamples: true }];
    expect(terminalEnv(folders, { baseUrl: base }).get("cookbook")).toBeUndefined();
    expect(terminalEnv(folders, { baseUrl: base, examplesToken: "tok" }).get("cookbook")).toEqual({
      LIBRA_OS_URL: base,
      LIBRA_OS_API_KEY: "tok",
      LIBRA_OS_SETUP_TOKEN: "tok",
    });
  });

  it("never gives the setup token to a project folder in the same window", () => {
    const plan = terminalEnv(
      [
        { id: "app", isExamples: false, projectKey: "pk" },
        { id: "cookbook", isExamples: true },
        { id: "notes", isExamples: false },
      ],
      { baseUrl: base, examplesToken: "tok" },
    );
    expect(plan.get("app")).toEqual({ LIBRA_OS_URL: base, LIBRA_OS_API_KEY: "pk" });
    expect(plan.get("cookbook")?.LIBRA_OS_API_KEY).toBe("tok");
    expect(plan.has("notes")).toBe(false);
  });

  it("an examples folder that also has a project key uses its project key when the switch is off", () => {
    const folders = [{ id: "cookbook", isExamples: true, projectKey: "pk" }];
    expect(terminalEnv(folders, { baseUrl: base }).get("cookbook")?.LIBRA_OS_API_KEY).toBe("pk");
    expect(terminalEnv(folders, { baseUrl: base, examplesToken: "tok" }).get("cookbook")?.LIBRA_OS_API_KEY).toBe("tok");
  });
});

describe("renewIn", () => {
  it("renews ten minutes before expiry, and not sooner than a minute", () => {
    expect(renewIn(3_600_000, 0)).toBe(3_000_000);
    expect(renewIn(30_000, 0)).toBe(60_000);
  });
});
