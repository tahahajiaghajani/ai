// Regression tests of the click-through round on the merged 1.1-beta build (docs/qa/CLICKTHROUGH.md): the crawl
// without demo data, with the bank demo pack and after its purge.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("«مقالهٔ تازه» in a new organisation", () => {
  it("tells a knowledge administrator that no base exists yet and offers «پایگاه دانش تازه» (it said «ask the knowledge manager»)", () => {
    const s = src("src/ui/modules/knowledge/NewArticle.tsx");
    expect(s).toMatch(/!home\.data\?\.bases\?\.length && allows\(\{ area: "knowledge", op: "admin" \}\)/);
    expect(s).toContain("هنوز پایگاه دانشی ساخته نشده است");
    expect(s).toContain("/kb/bases/new");
    // the base list is a record list with its own new-record form
    expect(src("src/ui/modules/knowledge/index.tsx")).toMatch(/table: "kb_base", path: "kb\/bases"/);
  });
});
