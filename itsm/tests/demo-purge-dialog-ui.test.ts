// «حذف کامل داده‌های نمایشی»'s dialog (src/ui/modules/admin/Demo.tsx PurgeReport): the dry run of the purge plan
// (GET /demo/report, src/server/modules/demo/index.ts purgePreview) while it loads, when it comes and when it does not.
// Since 1.1.5 the preview runs the whole plan in one transaction within the request's budget, so on the web version it
// can fail (503 timeout, db_busy, db_timeout): the dialog says why, offers «تلاش دوباره» and keeps the typed
// confirmation (the purge plans itself again), never an endless skeleton (F6F7-11: a load failure shows an error
// state). The list of kept records routed again names a few of them, as the server sends (clean.ts `samples`).
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PurgeReport } from "../src/ui/modules/admin/Demo";
import { ApiError } from "../src/ui/lib/api";

type Props = Parameters<typeof PurgeReport>[0];
type Report = NonNullable<Props["report"]["data"]>;

const report = (over: Partial<Props["report"]>): Props["report"] => ({ data: undefined, error: null, isError: false, isFetching: false, refetch: (() => Promise.resolve()) as never, ...over });
const render = (r: Props["report"]) => renderToStaticMarkup(createElement(PurgeReport, { report: r, typed: "", onType: () => undefined }));

/** The words of the page, tags dropped. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const preview: Report = {
  tables: { sm_incidents: 40, sm_users: 12 },
  rows: 52,
  accounts: 12,
  deleted: [{ table: "process_case", label: "پرونده‌های گردش‌کار", rows: 2, samples: ["PRC0000101 — درخواست نمایشی"] }],
  cleaned: [],
  rerouted: [
    { table: "process_case", label: "پرونده‌های گردش‌کار", rows: 3, routed: 3, samples: ["PRC0000123 — پروژهٔ نوسازی (ب)", "PRC0000124 — خرید چاپگر"] },
    { table: "incident", label: "رخدادها", rows: 1, routed: 0, samples: ["INC0001002 — قطعی شعبهٔ ونک"] },
  ],
};

describe("the purge dialog's preview", () => {
  it("while the dry run runs: a skeleton, no confirmation yet", () => {
    const html = render(report({ isFetching: true }));
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('aria-label="عبارت تأیید"');
  });

  it("a dry run that failed says why and offers «تلاش دوباره», and the typed confirmation stays (the purge plans itself again) — never an endless skeleton", () => {
    const error = new ApiError(503, "timeout", "پاسخ سرور بیش از حد طول کشید؛ کار در پس‌زمینه ادامه دارد. چند لحظهٔ دیگر صفحه را تازه کنید.");
    let retried = 0;
    const html = render(report({ isError: true, error, refetch: (() => (retried++, Promise.resolve())) as never }));
    expect(html).not.toContain('aria-busy="true"');
    const text = words(html);
    expect(text).toContain("پیش‌نمایش حذف آماده نشد");
    expect(text).toContain(error.message);
    expect(text).toContain("تلاش دوباره");
    // the purge can still be started: it plans everything again by itself
    expect(text).toContain("حذف خودش دوباره بررسی می‌کند");
    expect(html).toContain('aria-label="عبارت تأیید"');
    expect(retried).toBe(0);
  });

  it("the records routed again are named, as the server sends a few of each table (clean.ts `samples`)", () => {
    const html = render(report({ data: preview }));
    const text = words(html);
    // the deleted list had its samples already; the routed-again list now has them too
    expect(text).toContain("PRC0000101 — درخواست نمایشی");
    expect(text).toContain("PRC0000123 — پروژهٔ نوسازی (ب)، PRC0000124 — خرید چاپگر");
    expect(text).toContain("INC0001002 — قطعی شعبهٔ ونک");
    // the third table's header has the column
    const routed = html.slice(html.indexOf("رکوردهایی که دوباره ارجاع می‌شوند"));
    expect(routed).toMatch(/<th[^>]*>نمونه<\/th>/);
    expect(html).toContain('aria-label="عبارت تأیید"');
  });
});
