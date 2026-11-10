// What the assistant is told about the page the person is on (AiPageContext): the route, the page title, the record
// of a detail page and the report with its filters. Pure functions of the route, so they are unit-tested.
import type { AiPageContext } from "@shared/ai/types";
import { isUuid } from "@shared/id";
import { tableDef } from "@shared/tables";

/**
 * Detail pages: the route's id is a record the question is probably about. Modules add theirs, e.g.
 * `RECORD_ROUTES.push({ re: /^service-desk\/incidents\/([^/]+)$/, type: "incident" })`.
 */
export const RECORD_ROUTES: { re: RegExp; type: string }[] = [];

/** Report pages and the report each one shows (its filters come from the query string). Modules add theirs. */
export const REPORT_PAGES: Record<string, string> = {};

/** List pages of record modules: path → table (`recordModule()` registers each table's list and record pages). */
export const LIST_PAGES: Record<string, string> = {};

/** A record module's table at `path`: its list at `path`, its records at `path/<id>` (called by `recordModule()`). */
export function registerRecordRoute(path: string, table: string): void {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (!clean || LIST_PAGES[clean]) return;
  LIST_PAGES[clean] = table;
  RECORD_ROUTES.push({ re: new RegExp(`^${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)$`), type: table });
}

/** The query string's filters, bounded (a context is a hint, not a payload). */
function params(search: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of new URLSearchParams(search)) {
    if (n >= 12 || !/^[a-z_][a-z0-9_]{0,40}$/i.test(k) || !v || v.length > 120) continue;
    out[k] = v;
    n++;
  }
  return n ? out : undefined;
}

/** The context sent with a question asked on `rel` (org-relative path) + `search`, titled `title`. */
export function pageContext(rel: string, search: string, title: string | null): AiPageContext {
  const path = rel.replace(/^\/+|\/+$/g, "");
  const ctx: AiPageContext = { path };
  if (title) ctx.title = title;
  for (const r of RECORD_ROUTES) {
    const m = path.match(r.re);
    if (m && isUuid(m[1])) {
      ctx.record = { type: r.type, id: m[1], ...(title ? { label: title } : {}) };
      break;
    }
  }
  // every table also works at r/<table> (its list) and r/<table>/<id> (a record)
  const generic = /^r\/([a-z][a-z0-9_]*)(?:\/([^/]+))?$/.exec(path);
  if (!ctx.record && generic && tableDef(generic[1]) && generic[2] && isUuid(generic[2])) ctx.record = { type: generic[1], id: generic[2], ...(title ? { label: title } : {}) };
  const listTable = LIST_PAGES[path] ?? (generic && !generic[2] && tableDef(generic[1]) ? generic[1] : null);
  if (!ctx.record && listTable) {
    const p = params(search);
    ctx.list = p ? { table: listTable, params: p } : { table: listTable };
  }
  const report = REPORT_PAGES[path];
  if (report) {
    const p = params(search);
    ctx.report = p ? { key: report, params: p } : { key: report };
  }
  return ctx;
}

/** The page title from the window title («کاربران و دسترسی‌ها — <app name>» → «کاربران و دسترسی‌ها»). */
export function titleOf(docTitle: string, appName: string): string | null {
  const t = docTitle.trim();
  if (!t || t === appName) return null;
  const suffix = ` — ${appName}`;
  return t.endsWith(suffix) ? t.slice(0, -suffix.length).trim() || null : t;
}
