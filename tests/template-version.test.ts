import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace template version", () => {
  it("matches the constant the app compares against", () => {
    const file = readFileSync(new URL("../workspace-template/.github/taskflow-version", import.meta.url), "utf-8").trim();
    const src = readFileSync(new URL("../src/lib/github/bootstrap.ts", import.meta.url), "utf-8");
    expect(src).toContain(`export const TEMPLATE_VERSION = "${file}";`);
  });
});

describe("bundled workspace template", () => {
  it("is in sync with workspace-template/ (npm run template)", async () => {
    const { TEMPLATE_FILES } = await import("@/lib/github/template.generated");
    for (const f of TEMPLATE_FILES) {
      const disk = readFileSync(new URL(`../workspace-template/${f.path}`, import.meta.url), "utf-8");
      expect(f.content, f.path).toBe(disk);
    }
  });
});
