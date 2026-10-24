import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commonCopy } from "@/content/copy/common";

const dir = path.resolve(__dirname, "../src/content/copy");

describe("Persian copy", () => {
  it("writes «۱۲ رقمی» with a space (a number never runs into رقمی)", () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/[0-9۰-۹]رقمی/);
    }
    expect(commonCopy("fa").proSheet.codeHelp).toContain("کد ۱۲ رقمی");
  });
});
