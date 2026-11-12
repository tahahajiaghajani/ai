// Regression guards of the speed work measured on the installed server edition (docs/qa/PERFORMANCE_E2E_FA.md §2):
// each was found in a page's timeline or the database's slow statements and fixed without a behaviour change; these
// keep the fix from being undone by a refactor. (The validator of GET /meta/tables has its own test: meta-etag.)
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lazy, Suspense } from "@ui/lib/lazy";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("speed fixes stay in place", () => {
  it("the knowledge search normalises each article once (a materialised CTE), not once per term and column", () => {
    // inlined, the CTE's regexp normalisation ran at every reference: 545-585 ms for an incident's 58 terms over 61
    // articles (the «دانش» panel of every incident record); materialised: 148-183 ms for the whole endpoint
    const s = src("src/server/modules/knowledge/search.ts");
    expect(s).toMatch(/const base = `with c as materialized \(select t\.id/);
    expect(s).not.toMatch(/with c as \(select/);
  });

  it("an organisation's page opened directly fetches the app's code and the organisation with the session", () => {
    // before: /auth/me, then the signed-in app's chunk, then GET /api/o/:org (started at 303 ms, now at 51 ms)
    const m = src("src/ui/main.tsx");
    expect(m).toMatch(/if \(opened\) \{\s*preloadApp\(\);\s*void queryClient\.prefetchQuery\(\{ queryKey: \["org", opened\[1\]\], queryFn: \(\) => orgApi\(opened\[1\]\)\.get\(""\)/);
    // the same query key and request as the organisation's own query
    expect(src("src/ui/lib/org.tsx")).toContain('useQuery({ queryKey: ["org", orgId], queryFn: () => orgApi(orgId).get<OrgInfo>("")');
  });

  it("a record page asks for the record with the table definitions, and its activity, attachments and links with the record", () => {
    const p = src("src/ui/records/page/RecordPage.tsx");
    const page = p.slice(p.indexOf("export function RecordPage("), p.indexOf("function PageSkeleton"));
    expect(page.indexOf('useRecord(id === "new" ? null : table')).toBeGreaterThan(-1);
    expect(page.indexOf('useRecord(id === "new" ? null : table')).toBeLessThan(page.indexOf("if (missing)"));
    const view = p.slice(p.indexOf("function ViewRecord("), p.indexOf("const [mode, setMode]"));
    for (const call of ["useActivity(def, id)", "useAttachments(def.key, id, !!def.features?.attachments)", "useLinks(def.key, id, !!def.features?.links)"]) expect(view).toContain(call);
  });

  it("code-split components never suspend: React's 300 ms reveal throttle no longer stacks up on a page load", async () => {
    // every UI file takes lazy and Suspense from src/ui/lib/lazy.tsx, none from React
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));
    const ui = join(__dirname, "..", "src", "ui");
    const fromReact = walk(ui)
      .filter((f) => !f.endsWith(join("lib", "lazy.tsx")))
      .filter((f) => /import \{[^}]*\b(lazy|Suspense)\b[^}]*\} from "react"/.test(readFileSync(f, "utf8")));
    expect(fromReact).toEqual([]);
    // before its code is there: the fallback of the Suspense around it (nothing outside one) — React.lazy would suspend
    const Page = lazy(async () => ({ default: ({ title }: { title: string }) => createElement("h1", null, title) }));
    expect(renderToStaticMarkup(createElement(Suspense, { fallback: createElement("i", null, "loading") }, createElement(Page, { title: "سلام" })))).toBe("<i>loading</i>");
    expect(renderToStaticMarkup(createElement(Page, { title: "سلام" }))).toBe("");
    // once loaded: the component itself, with its props
    await Page.preload();
    expect(renderToStaticMarkup(createElement(Page, { title: "سلام" }))).toBe("<h1>سلام</h1>");
    // a failed load is thrown while rendering (to the error boundary), and stays failed like React.lazy's
    const Broken = lazy<() => null>(() => Promise.reject(new Error("chunk failed")));
    await Broken.preload();
    expect(() => renderToStaticMarkup(createElement(Broken))).toThrow("chunk failed");
    expect(() => renderToStaticMarkup(createElement(Broken))).toThrow("chunk failed");
  });

  it("the consoles count an organisation's failed jobs from a partial index, not by scanning every job the queue keeps", async () => {
    // done jobs stay three days: 150,000 rows after the bank demo pack «متوسط», a 55 ms parallel scan; with the index
    // an index-only scan of the failed ones (0.02 ms)
    const { MIGRATIONS } = await import("@server/db/migrations");
    const m = MIGRATIONS.find((x) => x.id === "0103_jobs_failed_idx");
    expect(m?.sql).toMatch(/create index if not exists sm_jobs_failed_idx on sm_jobs \(org_id, done_at\) where status = 'failed'/);
    expect(src("src/server/modules/admin/platform.ts")).toMatch(/from sm_jobs where status = 'failed' and done_at > now\(\) - interval '24 hours' \$\{orgId \? "and org_id = \$1" : ""\}/);
  });
});

