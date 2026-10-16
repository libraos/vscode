import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDigestPinned } from "../src/runtime/compose";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const image: string = pkg.contributes.configuration.properties["libraos.runtime.image"].default;

describe("default runtime image", () => {
  it("is a release tag pinned by a multi-arch index digest", () => {
    expect(image).toMatch(/^ghcr\.io\/libraos\/libraos:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    expect(isDigestPinned(image)).toBe(true);
  });

  it("is v0.2.2", () => {
    expect(image).toBe(
      "ghcr.io/libraos/libraos:v0.2.2@sha256:0ccb121cd5760af47a91c491010a63123030533ebe516bd732d94a0575dccdc2",
    );
  });

  it("is the image the end-to-end test runs", () => {
    expect(readFileSync(join(__dirname, "e2e.runtime.test.ts"), "utf8")).toContain(image);
  });
});
