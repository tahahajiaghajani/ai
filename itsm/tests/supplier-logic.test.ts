// Pure logic of supplier and contract management (src/shared/supplier): notice dates, Jalali month arithmetic,
// reminders once per threshold, expiry and automatic renewal, the renewal calendar's months, scorecards and the
// rule-based clause extraction from Persian and English contract text.
import { describe, expect, it } from "vitest";
import { addJalaliMonths, calendarMonths, dueReminder, endOutcome, monthKey, noticeDate, periodLabel, ratingToScore, reminderList, supplierScore } from "@shared/supplier/logic";
import { extractContract, parseContractDate } from "@shared/supplier/extract";
import { fromJalali } from "@shared/jalali";

describe("dates", () => {
  it("computes the notice date and adds Jalali months keeping the day where it can", () => {
    expect(noticeDate("2026-06-30", 30)).toBe("2026-05-31");
    expect(noticeDate(null, 30)).toBeNull();
    expect(addJalaliMonths(fromJalali(1405, 1, 15), 1)).toBe(fromJalali(1405, 2, 15));
    expect(addJalaliMonths(fromJalali(1405, 6, 31), 1)).toBe(fromJalali(1405, 7, 30));
    expect(addJalaliMonths(fromJalali(1405, 12, 1), 12)).toBe(fromJalali(1406, 12, 1));
    expect(monthKey(fromJalali(1405, 8, 10))).toBe("1405-08");
    expect(periodLabel("1405-08")).toBe("آبان ۱۴۰۵");
  });
});

describe("reminders", () => {
  it("announces the nearest threshold reached once, skipping those passed over together", () => {
    const today = "2026-01-01";
    expect(dueReminder("2026-04-15", today, [90, 60, 30])).toBeNull();
    const r = dueReminder("2026-01-20", today, [90, 60, 30, 7]);
    expect(r).toEqual({ threshold: 30, days_left: 19, skipped: [60, 90] });
    expect(dueReminder("2026-01-20", today, [90, 60, 30, 7], [30, 60, 90])).toBeNull();
    expect(dueReminder("2025-12-01", today, [30])).toBeNull();
    expect(reminderList("x")).toEqual([90, 60, 30, 7]);
    expect(reminderList([7, 30, 30, -1])).toEqual([30, 7]);
  });
  it("expires or renews automatically past the end", () => {
    expect(endOutcome({ state: "active", end_date: "2026-01-01", renewal_type: "manual" }, "2026-01-02")).toEqual({ action: "expire" });
    expect(endOutcome({ state: "active", end_date: "2026-01-05" }, "2026-01-02")).toEqual({ action: "none" });
    const r = endOutcome({ state: "active", end_date: fromJalali(1404, 1, 1), renewal_type: "auto", renewal_term_months: 12 }, fromJalali(1405, 6, 1));
    expect(r).toEqual({ action: "renew", end_date: fromJalali(1406, 1, 1), terms: 2 });
  });
});

describe("calendar and scores", () => {
  it("buckets entries into Jalali months, empty months kept", () => {
    const from = fromJalali(1405, 7, 10);
    const months = calendarMonths([
      { date: fromJalali(1405, 7, 20), kind: "end", table: "contract", id: "1", title: "ب" },
      { date: fromJalali(1405, 7, 12), kind: "notice", table: "contract", id: "2", title: "الف" },
      { date: fromJalali(1405, 9, 1), kind: "renewal", table: "saas_subscription", id: "3", title: "ج" },
    ], from, 3);
    expect(months.map((m) => m.key)).toEqual(["1405-07", "1405-08", "1405-09"]);
    expect(months[0].entries.map((e) => e.id)).toEqual(["2", "1"]);
    expect(months[1].entries).toHaveLength(0);
    expect(months[2].label).toBe("آذر ۱۴۰۵");
  });
  it("weights the metrics that have data", () => {
    const w = { w_delivery: 30, w_quality: 25, w_sla: 25, w_review: 20 };
    expect(supplierScore({ delivery: 100, quality: 50, sla: null, review: null }, w)).toBe(Math.round((100 * 30 + 50 * 25) / 55));
    expect(supplierScore({ delivery: null, quality: null, sla: null, review: null }, w)).toBeNull();
    expect(ratingToScore(5)).toBe(100);
    expect(ratingToScore(3)).toBe(50);
  });
});

describe("clause extraction", () => {
  it("reads Jalali and Gregorian dates", () => {
    expect(parseContractDate("از تاریخ ۱۴۰۵/۰۱/۰۱")).toBeNull(); // Persian digits are normalised by the extractor first
    expect(parseContractDate("1405/01/01")).toBe(fromJalali(1405, 1, 1));
    expect(parseContractDate("effective 2026-03-21")).toBe("2026-03-21");
    expect(parseContractDate("1405/13/01")).toBeNull();
  });
  it("extracts terms and obligations with their evidence and page", () => {
    const text = [
      "ماده ۳ — مدت قرارداد: این قرارداد از تاریخ ۱۴۰۵/۰۱/۰۱ به مدت ۱۲ ماه معتبر است.",
      "ماده ۴ — مبلغ کل قرارداد ۱٬۲۰۰٬۰۰۰٬۰۰۰ ریال است که به صورت ماهانه پرداخت می‌شود.",
      "ماده ۵ — در صورت عدم اعلام کتبی ۳۰ روز پیش از پایان، قرارداد به‌طور خودکار تمدید خودکار می‌شود.",
      "ماده ۶ — پیمانکار متعهد است زمان پاسخ به خرابی حیاتی را حداکثر ۲ ساعت نگه دارد.",
      "ماده ۷ — کارفرما موظف است ظرف ۱۰ روز صورت‌حساب را پرداخت کند.",
    ].join("\n");
    const r = extractContract([{ page: 2, text }]);
    const f = (k: string) => r.fields.find((x) => x.field === k);
    expect(f("start_date")?.value).toBe(fromJalali(1405, 1, 1));
    expect(f("end_date")?.value).toBe(fromJalali(1405, 12, 29));
    expect(f("value")?.value).toBe("1200000000");
    expect(f("payment_frequency")?.value).toBe("monthly");
    expect(f("notice_period_days")?.value).toBe(30);
    expect(f("renewal_type")?.value).toBe("auto");
    expect(String(f("uc_targets")?.value)).toContain("۲ ساعت".replace("۲", "2"));
    expect(f("value")?.page).toBe(2);
    expect(r.obligations.map((o) => o.party)).toEqual(["supplier", "us"]);
    expect(r.obligations[1].due_hint).toContain("ظرف");
  });
  it("converts Tomans to Rials and reads English contracts", () => {
    const r = extractContract([{ page: 1, text: "Total amount: 50,000,000 toman. This agreement shall automatically renew. Effective 2026-03-21 and end date 2027-03-20." }]);
    expect(r.fields.find((x) => x.field === "value")?.value).toBe("500000000");
    expect(r.fields.find((x) => x.field === "renewal_type")?.value).toBe("auto");
    expect(r.fields.find((x) => x.field === "end_date")?.value).toBe("2027-03-20");
  });
});
