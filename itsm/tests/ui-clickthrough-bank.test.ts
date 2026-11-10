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

describe("a requester's incident and service pages ask nothing of the CMDB they cannot read", () => {
  it("the CI side panel and the «مدل خدمت» map are gated by the CMDB area (404 GET r/ci/:id, 404 POST cmdb/map, «نقشه بارگذاری نشد»)", async () => {
    const { tableDef } = await import("../src/shared/tables");
    // the gate is the CI table's own access area
    expect(tableDef("ci")?.area).toBe("cmdb");
    const panel = src("src/ui/modules/cmdb/CiContextPanel.tsx");
    expect(panel).toContain('const canCi = allows({ area: "cmdb" });');
    expect(panel).toMatch(/recordsApi\.get\(api, "ci", ciId\), enabled: !!ciId && canCi/);
    const map = src("src/ui/modules/cmdb/CiParts.tsx");
    expect(map).toContain('const canMap = allows({ area: "cmdb" });');
    expect(map).toMatch(/cmdbApi\.map\(api, q\), staleTime: 30_000, enabled: canMap/);
    expect(map).toContain("if (!canMap) return");
  });

  it("the demo requester persona holds no CMDB read (the gate hides, the server keeps refusing)", async () => {
    const { gateAllows } = await import("../src/shared/access");
    expect(gateAllows({ cmdb: { read: "none", create: false, write: "none", delete: "none", approve: false, admin: false } } as never, { area: "cmdb" })).toBe(false);
    expect(gateAllows({ cmdb: { read: "all", create: false, write: "none", delete: "none", approve: false, admin: false } } as never, { area: "cmdb" })).toBe(true);
  });
});

describe("«داده‌های نمایشی»: the end of a background load or purge refreshes the app", () => {
  it("invalidates every query when the pack leaves «loading» or «purging» (the demo banner stayed after the purge until a reload)", () => {
    const s = src("src/ui/modules/admin/Demo.tsx");
    // the banner reads ["demo-banner"] with a one-minute staleTime and a five-minute refetch
    expect(src("src/ui/components/shell/SupportBanner.tsx")).toContain('queryKey: ["demo-banner", orgId]');
    expect(s).toMatch(/useEffect\(\(\) => \{\s*const was = lastState\.current;/);
    expect(s).toMatch(/\(was === "loading" \|\| was === "purging"\)\) void qc\.invalidateQueries\(\);/);
    expect(s).toContain("}, [s?.state, qc]);");
  });
});
