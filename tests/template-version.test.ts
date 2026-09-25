import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace template version", () => {
  it("matches the constant the app compares against", () => {
    const file = readFileSync(new URL("../workspace-template/.github/taskflow-version", import.meta.url), "utf-8").trim();
    const src = readFileSync(new URL("../src/lib/github/bootstrap.ts", import.meta.url), "utf-8");
    expect(src).toContain(`export const TEMPLATE_VERSION = "${file}";`);
  });
});
