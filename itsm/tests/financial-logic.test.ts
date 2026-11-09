// Pure logic of IT financial management (src/shared/financial/logic.ts): the Jalali fiscal calendar, money in Rials
// and Tomans with Persian digits, exact allocation, monthly accruals, budget against actual and variance drivers.
import { describe, expect, it } from "vitest";
import { accrual, allocate, budgetVsActual, bvaCell, fiscalPeriods, fiscalYearOf, fiscalYearRange, formatRial, inputHash, monthlyShare, periodKeyOf, periodRange, toRial, varianceDrivers, varianceSentence } from "@shared/financial/logic";
import { fromJalali } from "@shared/jalali";

describe("fiscal calendar", () => {
  it("starts on 1 Farvardin and has twelve periods covering the year", () => {
    const r = fiscalYearRange(1405);
    expect(r.start).toBe(fromJalali(1405, 1, 1));
    const ps = fiscalPeriods(1405);
    expect(ps).toHaveLength(12);
    expect(ps[0]).toMatchObject({ month: 1, key: "1405-01", name: "فروردین ۱۴۰۵", start_date: r.start });
    expect(ps[11].end_date).toBe(r.end);
    for (let i = 1; i < 12; i++) expect(new Date(ps[i].start_date).getTime() - new Date(ps[i - 1].end_date).getTime()).toBe(86400_000);
    expect(fiscalYearOf(fromJalali(1405, 12, 29))).toBe(1405);
    expect(fiscalYearOf(fromJalali(1406, 1, 1))).toBe(1406);
    expect(periodKeyOf(fromJalali(1405, 8, 3))).toBe("1405-08");
    expect(periodRange("1405-11", "1406-02")).toEqual(["1405-11", "1405-12", "1406-01", "1406-02"]);
  });
});

describe("money", () => {
  it("shows Rials or Tomans with Persian digits and grouping", () => {
    expect(formatRial("1250000")).toBe("۱٬۲۵۰٬۰۰۰ ریال");
    expect(formatRial("1250000", "toman")).toBe("۱۲۵٬۰۰۰ تومان");
    expect(formatRial("1250000", "toman", { suffix: false })).toBe("۱۲۵٬۰۰۰");
    expect(toRial("12.5", "820000")).toBe("10250000");
  });
  it("allocates exactly with the largest remainder", () => {
    const parts = allocate("100", [{ key: "a", weight: "1" }, { key: "b", weight: "1" }, { key: "c", weight: "1" }]);
    expect(parts.map((p) => p.amount)).toEqual(["34", "33", "33"]);
    expect(parts.reduce((a, p) => a + Number(p.amount), 0)).toBe(100);
    const skewed = allocate("1000", [{ key: "x", weight: "70" }, { key: "y", weight: "30" }, { key: "z", weight: "0" }]);
    expect(skewed.map((p) => p.amount)).toEqual(["700", "300", "0"]);
    expect(allocate("10", [{ key: "x", weight: "0" }]).map((p) => p.amount)).toEqual(["0"]);
    expect(allocate("-90", [{ key: "a", weight: "1" }, { key: "b", weight: "2" }]).map((p) => p.amount)).toEqual(["-30", "-60"]);
  });
  it("spreads an annual amount over twelve months exactly", () => {
    let total = 0;
    for (let m = 1; m <= 12; m++) total += Number(monthlyShare("1000", m));
    expect(total).toBe(1000);
    expect(accrual("1200", 3)).toBe("100");
  });
});

describe("budget against actual", () => {
  it("spreads annual lines, sums by centre, type and month, and flags status", () => {
    const periods = ["1405-01", "1405-02", "1405-03"];
    const r = budgetVsActual(
      [
        { cost_center_id: "cc1", cost_type_id: "hw", period_key: null, amount: "1200" },
        { cost_center_id: "cc1", cost_type_id: "sw", period_key: "1405-02", amount: "50" },
        { cost_center_id: "cc2", cost_type_id: "hw", period_key: "1405-01", amount: "10" },
      ],
      [
        { cost_center_id: "cc1", cost_type_id: "hw", period_key: "1405-01", amount: "300" },
        { cost_center_id: "cc1", cost_type_id: "sw", period_key: "1405-02", amount: "20" },
        { cost_center_id: "cc1", cost_type_id: "hw", period_key: "1405-02", amount: "50" },
        { cost_center_id: "cc2", cost_type_id: "hw", period_key: "1405-01", amount: "9.5" },
        { cost_center_id: "cc3", cost_type_id: "hw", period_key: "1405-03", amount: "5" },
        { cost_center_id: "cc1", cost_type_id: "hw", period_key: "1405-07", amount: "999" },
      ],
      periods,
    );
    const cc1 = r.rows.find((x) => x.cost_center_id === "cc1")!;
    expect(cc1.budget).toBe("350");
    expect(cc1.actual).toBe("370");
    expect(cc1.status).toBe("over");
    expect(cc1.by_month.map((m) => m.budget)).toEqual(["100", "150", "100"]);
    expect(cc1.by_type.find((t) => t.cost_type_id === "hw")!.status).toBe("over");
    expect(r.rows.find((x) => x.cost_center_id === "cc2")!.used_pct).toBe(95);
    expect(r.rows.find((x) => x.cost_center_id === "cc3")!.status).toBe("unbudgeted");
    expect(r.total.actual).toBe("384.5");
    expect(r.rows.find((x) => x.cost_center_id === "cc1")!.by_type.find((t) => t.cost_type_id === "sw")!.status).toBe("under");
  });
  it("ranks variance drivers and words the result", () => {
    const d = varianceDrivers([{ key: "a", label: "الف", budget: "100", actual: "150" }, { key: "b", label: "ب", budget: "100", actual: "90" }, { key: "c", label: "ج", budget: "5", actual: "5" }]);
    expect(d.map((x) => x.key)).toEqual(["a", "b"]);
    expect(d[0].share_pct).toBeCloseTo(83.3, 1);
    expect(varianceSentence("زیرساخت", bvaCell("100", "120"))).toContain("بیشتر");
    expect(varianceSentence("زیرساخت", bvaCell("0", "5"))).toContain("بدون بودجه");
  });
  it("fingerprints inputs", () => {
    expect(inputHash({ a: 1 })).toBe(inputHash({ a: 1 }));
    expect(inputHash({ a: 1 })).not.toBe(inputHash({ a: 2 }));
  });
});
