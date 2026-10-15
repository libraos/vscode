import { describe, expect, it } from "vitest";
import { EXAMPLES, rawUrl } from "../src/examples/catalog";

describe("catalog", () => {
  it("has unique ids and public raw URLs", () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const e of EXAMPLES) expect(rawUrl(e)).toMatch(/^https:\/\/raw\.githubusercontent\.com\/libraos\/(cookbook|sdk)\/main\//);
  });
});
