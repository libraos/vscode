import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

describe("withSetupToken", () => {
  it("maps the token to LIBRA_OS_API_KEY for one command, by reference, never by value", async () => {
    const { withSetupToken, SETUP_TOKEN_ENV } = await import("../src/runtime/setupToken");
    expect(SETUP_TOKEN_ENV).toBe("LIBRA_OS_SETUP_TOKEN");
    expect(withSetupToken("python first-agent.py", "darwin")).toBe('LIBRA_OS_API_KEY="$LIBRA_OS_SETUP_TOKEN" python first-agent.py');
    expect(withSetupToken("python first-agent.py", "win32")).toBe("$env:LIBRA_OS_API_KEY=$env:LIBRA_OS_SETUP_TOKEN; python first-agent.py");
  });
});
