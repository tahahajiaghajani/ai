// Regression tests of the click-through QA round (docs/qa/CLICKTHROUGH.md, scripts/ui-crawl.mjs): every nav item and
// palette entry opens a registered route, a page that throws keeps the shell (error boundary), and the crawler's
// route classification sees the record lists the registry builds.
import { describe, expect, it, beforeAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PageBoundary, crashMessage } from "../src/ui/components/crash";
import { queryBounded } from "../src/shared/cmdb/logic";

const ROOT = join(__dirname, "..");
const UI = join(ROOT, "src", "ui");

function files(dir: string, re = /\.(tsx|ts)$/): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, re));
    else if (re.test(name)) out.push(p);
  }
  return out;
}

/** React Router's matching of a registered path (`:param` = one segment, a trailing `*` = the rest, maybe nothing). */
function matcher(route: string): RegExp {
  const parts = route.split("/");
  const splat = parts[parts.length - 1] === "*";
  const body = (splat ? parts.slice(0, -1) : parts).map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  return new RegExp(`^${body}${splat ? "(?:/.*)?" : ""}$`);
}

interface Registry {
  routes: string[];
  portal: string[];
  nav: { key: string; path: string; access?: { area: string; op?: string } | { area: string; op?: string }[] }[];
  tables: string[];
  newRecordPath: (table: string) => string;
  recordPath: (table: string, id: string) => string;
  tableDef: (table: string) => { key: string; area?: string; fields: { name: string; readonly?: boolean; system?: boolean; base?: boolean; hidden?: boolean }[] } | undefined;
  tablePath: (table: string) => string;
  gateAllows: (grants: Record<string, unknown>, gate: { area: string; op?: string }) => boolean;
  builtinRoles: (preset?: string) => { key: string; grants: Record<string, unknown> }[];
  /** route path → the table its record list shows (queues included) */
  listed: Map<string, string>;
  enterableOnCreate: (def: { fields: unknown[] }) => boolean;
}

const compiled = new Map<string, RegExp>();
const re = (r: string) => compiled.get(r) ?? compiled.set(r, matcher(r)).get(r)!;
/** The route React Router picks for a path: static segments outrank `:params`, which outrank a splat. */
function bestRoute(routes: string[], path: string): string | null {
  const score = (r: string) => r.split("/").reduce((n, s) => n + (s === "*" ? 0 : s.startsWith(":") ? 2 : 3), 0);
  const hits = routes.filter((r) => re(r).test(path)).sort((a, b) => score(b) - score(a));
  return hits[0] ?? null;
}
let reg: Registry;
let classify: (routes: string[]) => { path: string; kind: string }[];

beforeAll(async () => {
  const crawl = (await import(join(ROOT, "scripts", "ui-crawl.mjs"))) as {
    loadRegistry: () => Promise<Registry>;
    classify: typeof classify;
  };
  reg = await crawl.loadRegistry();
  classify = crawl.classify;
}, 120000);

describe("the UI registry", () => {
  it("every nav item opens a registered route", () => {
    const res = reg.routes.map(matcher);
    const orphans = reg.nav.filter((i) => !res.some((r) => r.test(i.path.split("?")[0]))).map((i) => `${i.key} → ${i.path}`);
    expect(orphans).toEqual([]);
  });

  it("starts every table's «… تازه» on a new-record page, never on a record page that reads «new» as an id", () => {
    // «مقالهٔ دانش تازه» on kb/articles went to kb/a/new — the reading view — and showed «این مقاله پیدا نشد»
    // pages that read the id «new» themselves: the report designer opens an empty report
    const readsNew = new Set(["analytics/reports/:id"]);
    // the requester portal's own pages sit under the splat `portal/*` (src/ui/modules/portal/Shell.tsx)
    const routes = [...reg.routes, ...reg.portal.filter((p) => p && p !== "*").map((p) => `portal/${p}`)];
    const bad: string[] = [];
    for (const t of reg.tables) {
      const p = reg.newRecordPath(t).split("?")[0];
      const r = bestRoute(routes, p);
      // record lists register `<path>/new` (and `r/:table/new`); a route ending in a parameter took «new» as an id
      if (!r) bad.push(`${t}: ${p} → no route`);
      else if (/(^|\/):[^/]+$/.test(r) && !readsNew.has(r)) bad.push(`${t}: ${p} → ${r}`);
    }
    expect(bad).toEqual([]);
  });

  it("opens every table's records on a registered page", () => {
    const bad = reg.tables.map((t) => reg.recordPath(t, "0190f0f0-0000-7000-8000-000000000000")).filter((p) => !bestRoute(reg.routes, p));
    expect(bad).toEqual([]);
  });

  it("registers each route once and only org-relative paths", () => {
    const dup = reg.routes.filter((r, i) => reg.routes.indexOf(r) !== i);
    expect(dup).toEqual([]);
    expect(reg.routes.filter((r) => r.startsWith("/"))).toEqual([]);
  });

  it("classifies record lists, their forms and parameterised pages", () => {
    const kinds = new Map(classify(reg.routes).map((r) => [r.path, r.kind]));
    expect(kinds.get("releases")).toBe("list");
    expect(kinds.get("releases/new")).toBe("new");
    expect(kinds.get("releases/:id")).toBe("param");
    expect(kinds.get("releases/roadmap")).toBe("page");
    expect(kinds.get("portal/*")).toBe("nested");
    expect([...kinds.values()].filter((k) => k === "list").length).toBeGreaterThan(300);
  });
});

describe("a page that throws keeps the shell (error boundary)", () => {
  it("turns a render error into the page's error state", () => {
    expect(PageBoundary.getDerivedStateFromError(new Error("boom")).error?.message).toBe("boom");
    expect(PageBoundary.getDerivedStateFromError("plain").error?.message).toBe("plain");
    expect(crashMessage(new TypeError(""))).toBe("TypeError");
  });

  it("renders the error state with retry and the way back, not the page", () => {
    class Crashed extends PageBoundary {
      state = { error: new Error("Cannot read properties of undefined") };
    }
    const html = renderToStaticMarkup(createElement(Crashed, { home: "/org-1", children: createElement("p", null, "page body") }));
    expect(html).toContain("این صفحه با خطا روبه‌رو شد");
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).toContain("تلاش دوباره");
    expect(html).toContain('href="/org-1"');
    expect(html).toContain("data-crash");
    expect(html).not.toContain("page body");
  });

  it("renders the page itself while nothing threw", () => {
    expect(renderToStaticMarkup(createElement(PageBoundary, { home: "/o", children: createElement("p", null, "page body") }))).toBe("<p>page body</p>");
  });

  it("wraps every page of the organisation and the whole app", () => {
    const app = readFileSync(join(ROOT, "src/ui/App.tsx"), "utf8");
    expect(app).toMatch(/<PageBoundary home=\{`\/\$\{org\}`\}>\{children\}<\/PageBoundary>/);
    expect(app).toMatch(/element=\{<Page org=\{org!\}>\{r\.element\}<\/Page>\}/);
    expect(app).toMatch(/return \(\s*<PageBoundary>\s*<Suspense/);
  });
});

describe("release roadmap («نقشهٔ راه انتشار»)", () => {
  it("draws its legend with swatches: a timeline band is absolutely positioned and floated over the page header", () => {
    const bad = files(UI)
      .filter((f) => !f.endsWith(join("records", "board", "TimelineGrid.tsx")))
      .filter((f) => /className="[^"]*\brk-tg-band\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(UI, f));
    expect(bad, "use <i className=\"rk-sw\" data-k=…> for a legend").toEqual([]);
    expect(readFileSync(join(UI, "modules/release/Roadmap.tsx"), "utf8")).toMatch(/className="rk-sw" data-k="maintenance"/);
  });

  it("starts a month's name at its first day, so the first one is not cut off at the edge («بان» for «آبان»)", () => {
    const css = readFileSync(join(UI, "records/records.css"), "utf8");
    expect(css).toMatch(/\.rk-tg-head b \{[^}]*align-self: flex-start/);
  });

  it("offers «تلاش دوباره» with the reason when the roadmap does not load", () => {
    const src = readFileSync(join(UI, "modules/release/Roadmap.tsx"), "utf8");
    expect(src).toMatch(/title="نقشهٔ راه بارگذاری نشد"\s*description=\{data\.error \? errorText\(data\.error\)/);
    expect(src).toContain("data.refetch()");
  });
});

describe("CMDB query («پرس‌وجوی پیکربندی»)", () => {
  it("is bounded by a class, a condition or a step", () => {
    expect(queryBounded({ class: null, condition: null, steps: [] })).toBe(false);
    expect(queryBounded({})).toBe(false);
    expect(queryBounded({ class: "server" })).toBe(true);
    expect(queryBounded({ condition: { f: "name", op: "eq", v: "x" } })).toBe(true);
    expect(queryBounded({ steps: [{ type: "depends_on" }] })).toBe(true);
  });

  it("keeps «اجرا» off until the query is bounded (the server answered 400 to the empty query)", () => {
    const page = readFileSync(join(UI, "modules/cmdb/QueryPage.tsx"), "utf8");
    expect(page).toMatch(/disabled=\{!bounded\}/);
    expect(readFileSync(join(ROOT, "src/server/modules/cmdb/query.ts"), "utf8")).toMatch(/if \(!queryBounded\(/);
  });
});

describe("«… تازه» only where a person can enter something", () => {
  it("offers no new-record form for the tables the system writes", () => {
    // their «… تازه» opened a form of read-only fields whose «ثبت» the server refused
    for (const t of ["license_reconcile_run", "sec_verification", "grc_policy_ack"]) {
      const def = reg.tableDef(t);
      expect(def, t).toBeDefined();
      expect(reg.enterableOnCreate(def!), t).toBe(false);
    }
    for (const t of ["incident", "release", "kb_article", "change_request"]) expect(reg.enterableOnCreate(reg.tableDef(t)!), t).toBe(true);
  });

  it("ignores the engine's, read-only and hidden fields", () => {
    expect(reg.enterableOnCreate({ fields: [{ name: "number", system: true }, { name: "x", readonly: true }, { name: "y", hidden: true }] })).toBe(false);
    expect(reg.enterableOnCreate({ fields: [{ name: "number", system: true }, { name: "name" }] })).toBe(true);
  });

  it("hides the list's «… تازه» and import, and explains on the form's own address", () => {
    const list = readFileSync(join(UI, "records/list/RecordList.tsx"), "utf8");
    expect(list).toMatch(/const creatable = def\.can\.create && enterableOnCreate\(def\)/);
    expect(list).not.toMatch(/\{def\.can\.create \?/);
    const page = readFileSync(join(UI, "records/page/RecordPage.tsx"), "utf8");
    expect(page).toMatch(/if \(!enterableOnCreate\(def\)\)/);
  });
});

describe("the sidebar offers each role only lists it may read", () => {
  it("hides the lists a built-in role cannot read (an agent saw workflows, SLA rules and notification settings, a requester the problem and CMDB queues: «فهرست پیدا نشد»)", () => {
    // a table's own list and every queue (a module's RecordListRoute of the table)
    const lists = new Map([...reg.tables.map((t) => [reg.tablePath(t), t] as const), ...reg.listed]);
    const bad: string[] = [];
    for (const role of reg.builtinRoles("open")) {
      for (const i of reg.nav) {
        const t = lists.get(i.path);
        if (!t || (i.access && ![i.access].flat().every((g) => reg.gateAllows(role.grants, g)))) continue;
        const area = reg.tableDef(t)?.area;
        if (area && !reg.gateAllows(role.grants, { area })) bad.push(`${role.key}: ${i.key} → ${t} (${area})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gates a table's nav item by its own area unless the module names another", () => {
    const item = (key: string) => reg.nav.find((i) => i.key === key);
    expect(item("flows:flow")?.access).toEqual({ area: "flows" });
    expect(item("sla:business_rule")?.access).toEqual({ area: "settings" });
    expect(item("notify:email_channel")?.access).toEqual({ area: "notifications" });
    expect(item("notify:rules")?.access).toEqual({ area: "notifications" });
    expect(item("release:release")?.access).toEqual({ area: "release" });
    // queues without a gate of their own take the table's
    expect(item("problem:q:mine")?.access).toEqual({ area: "problem" });
    expect(item("cmdb:query")?.access).toEqual({ area: "cmdb" });
    expect(item("cmdb:map")?.access).toEqual({ area: "cmdb" });
    // «توافق‌های در خطر» filters on the SLM's internal compliance fields: the SLM's readers, not every service reader
    expect(item("slm:q:risk")?.access).toEqual([{ area: "service" }, { area: "sla" }]);
    expect(item("slm:q:in_force")?.access).toEqual({ area: "service" });
    // the tenant console's own pages (a member with a view of the settings saw them)
    expect(item("admin:licences")?.access).toEqual({ area: "settings" });
    expect(item("admin:studio")?.access).toEqual({ area: "settings" });
  });
});

describe("timeline bars open what they show, or are not buttons", () => {
  it("draws bars without onOpen as static (the on-call shifts looked clickable and did nothing)", async () => {
    const { TimelineGrid } = await import("../src/ui/records/board/TimelineGrid");
    const items = [{ id: "s0", start: "2026-11-05T08:00:00Z", end: "2026-11-07T08:00:00Z", label: "کشیک" }];
    const base = { from: "2026-11-01", days: 30, tz: "Asia/Tehran", today: "2026-11-10", items };
    const still = renderToStaticMarkup(createElement(TimelineGrid, base));
    expect(still).toContain("is-static");
    expect(still).not.toContain("<button");
    const live = renderToStaticMarkup(createElement(TimelineGrid, { ...base, onOpen: () => undefined }));
    expect(live).toMatch(/<button[^>]*class="rk-tg-bar/);
    expect(readFileSync(join(UI, "modules/event/OnCall.tsx"), "utf8")).not.toContain("onOpen={() => undefined}");
  });
});
