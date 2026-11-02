// What the assistant is told about the page the person is on (AiPageContext): the route, the page title, the record
// of a detail page and the report with its filters. Pure functions of the route, so they are unit-tested.
import type { AiPageContext } from "@shared/ai/types";
import { isUuid } from "@shared/id";

/** Detail pages: the route's id is a record the question is probably about. */
const RECORD_ROUTES: { re: RegExp; type: string }[] = [
  { re: /^(?:sales|purchases)\/(?:invoices|returns|quotes|orders)\/([^/]+)$/, type: "invoice" },
  { re: /^accounting\/vouchers\/([^/]+)$/, type: "voucher" },
  { re: /^parties\/([^/]+)$/, type: "party" },
  { re: /^treasury\/docs\/([^/]+)$/, type: "treasury_doc" },
  { re: /^gold\/(?:docs|sale)\/([^/]+)$/, type: "gold_doc" },
  { re: /^fx\/deals\/([^/]+)(?:\/edit)?$/, type: "fx_deal" },
  { re: /^fx\/remittances\/([^/]+)$/, type: "remittance" },
  { re: /^fx\/revaluation\/([^/]+)$/, type: "fx_revaluation" },
  { re: /^inventory\/docs\/([^/]+)$/, type: "stock_doc" },
  { re: /^inventory\/count\/([^/]+)$/, type: "stock_count" },
  { re: /^sales\/price-lists\/([^/]+)$/, type: "price_list" },
];

/** Report pages and the report each one shows (its filters come from the query string). */
const REPORT_PAGES: Record<string, string> = {
  "reports/trial-balance": "trial_balance",
  "reports/ledger": "ledger",
  "reports/detail-balances": "detail_balances",
  "reports/journal": "journal",
  "reports/income-statement": "income_statement",
  "reports/balance-sheet": "balance_sheet",
  "sales/reports": "sales",
  "inventory/stock": "stock",
  "inventory/kardex": "kardex",
  "treasury/book": "cash_book",
  "treasury/cheques": "cheques",
  "treasury/cheques/issued": "cheques_issued",
  "gold/reports/stock": "gold_stock",
  "gold/reports/sales": "gold_sales",
  "gold/rates": "gold_rates",
  "fx/positions": "fx_positions",
  "fx/cash-report": "fx_cash",
  "fx/rates": "fx_rates",
};

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
  const report = REPORT_PAGES[path];
  if (report) {
    const p = params(search);
    ctx.report = p ? { key: report, params: p } : { key: report };
  }
  return ctx;
}

/** The page title from the window title («فاکتور فروش ۱۲ — سیراف» → «فاکتور فروش ۱۲»). */
export function titleOf(docTitle: string, appName: string): string | null {
  const t = docTitle.trim();
  if (!t || t === appName) return null;
  const suffix = ` — ${appName}`;
  return t.endsWith(suffix) ? t.slice(0, -suffix.length).trim() || null : t;
}
