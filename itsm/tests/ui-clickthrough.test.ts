// Regression tests of the click-through QA round (docs/qa/CLICKTHROUGH.md, scripts/ui-crawl.mjs): every nav item and
// palette entry opens a registered route, a page that throws keeps the shell (error boundary), and the crawler's
// route classification sees the record lists the registry builds.
import { describe, expect, it, beforeAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PageBoundary, crashMessage } from "../src/ui/components/crash";

const ROOT = join(__dirname, "..");

/** React Router's matching of a registered path (`:param` = one segment, a trailing `*` = the rest, maybe nothing). */
function matcher(route: string): RegExp {
  const parts = route.split("/");
  const splat = parts[parts.length - 1] === "*";
  const body = (splat ? parts.slice(0, -1) : parts).map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  return new RegExp(`^${body}${splat ? "(?:/.*)?" : ""}$`);
}

interface Registry {
  routes: string[];
  nav: { key: string; path: string }[];
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
    const html = renderToStaticMarkup(createElement(Crashed, { home: "/org-1" }, createElement("p", null, "page body")));
    expect(html).toContain("این صفحه با خطا روبه‌رو شد");
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).toContain("تلاش دوباره");
    expect(html).toContain('href="/org-1"');
    expect(html).toContain("data-crash");
    expect(html).not.toContain("page body");
  });

  it("renders the page itself while nothing threw", () => {
    expect(renderToStaticMarkup(createElement(PageBoundary, { home: "/o" }, createElement("p", null, "page body")))).toBe("<p>page body</p>");
  });

  it("wraps every page of the organisation and the whole app", () => {
    const app = readFileSync(join(ROOT, "src/ui/App.tsx"), "utf8");
    expect(app).toMatch(/<PageBoundary home=\{`\/\$\{org\}`\}>\{children\}<\/PageBoundary>/);
    expect(app).toMatch(/element=\{<Page org=\{org!\}>\{r\.element\}<\/Page>\}/);
    expect(app).toMatch(/return \(\s*<PageBoundary>\s*<Suspense/);
  });
});
