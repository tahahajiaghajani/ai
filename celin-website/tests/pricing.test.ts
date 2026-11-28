import { describe, expect, it } from "vitest";
import { formatPct } from "@/lib/format";
import { atPct, cleanListPct, cleanSalePct, cleanSteps, DEFAULT_STEPS, invoice, ladder, listPrice, nextStep, offPct, pctFor, pricingArg, pricingFor, stepReached, unitAt, type SaleRule } from "@/lib/pricing";

const member = pricingFor("member", { memberPct: 200, steps: DEFAULT_STEPS });
const pro = pricingFor("pro", { memberPct: 200, steps: DEFAULT_STEPS });

describe("price levels", () => {
  it("members see twice the admin's price, Pro the price itself", () => {
    expect(listPrice(1_250_000, member)).toBe(2_500_000);
    expect(listPrice(1_250_000, pro)).toBe(1_250_000);
    expect(pro.steps).toEqual([]);
  });

  it("the owner's steps: 1–5 ×2, 6–10 ×1.5, 11–15 ×1.3, 16–23 ×1.1, 24+ ×1", () => {
    const at = (n: number) => pctFor(n, member);
    expect([1, 5].map(at)).toEqual([200, 200]);
    expect([6, 10].map(at)).toEqual([150, 150]);
    expect([11, 15].map(at)).toEqual([130, 130]);
    expect([16, 23].map(at)).toEqual([110, 110]);
    expect([24, 99, 500].map(at)).toEqual([100, 100, 100]);
    expect(pctFor(500, pro)).toBe(100);
  });

  it("the next step says how many more pieces", () => {
    expect(nextStep(4, member)).toEqual({ min: 6, pct: 150, more: 2 });
    expect(nextStep(10, member)).toEqual({ min: 11, pct: 130, more: 1 });
    expect(nextStep(24, member)).toBeNull();
    expect(nextStep(1, pro)).toBeNull();
  });
});

describe("invoice", () => {
  it("lists every line at the list price and charges the step of the whole order", () => {
    const bill = invoice(
      [
        { price: 1_000_000, qty: 4 },
        { price: 700_000, qty: 3 },
      ],
      member,
    );
    // 7 pieces → 150%
    expect(bill.pieces).toBe(7);
    expect(bill.pct).toBe(150);
    expect(bill.list).toBe(2_000_000 * 4 + 1_400_000 * 3);
    expect(bill.total).toBe(1_500_000 * 4 + 1_050_000 * 3);
    expect(bill.stepDiscount).toBe(bill.list - bill.total);
  });

  it("below the first step there is no discount", () => {
    const bill = invoice([{ price: 990_000, qty: 5 }], member);
    expect(bill.stepDiscount).toBe(0);
    expect(bill.total).toBe(9_900_000);
  });

  it("from 24 pieces a member pays the admin's price", () => {
    const bill = invoice([{ price: 333_333, qty: 24 }], member);
    expect(bill.total).toBe(333_333 * 24);
  });

  it("Pro pays the admin's price at any quantity, with no step line", () => {
    const bill = invoice([{ price: 1_234_567, qty: 3 }], pro);
    expect(bill).toMatchObject({ list: 1_234_567 * 3, total: 1_234_567 * 3, stepDiscount: 0, pct: 100 });
  });

  it("rounds each piece like SQL round(): half away from zero, per piece then × qty", () => {
    expect(atPct(5, 110)).toBe(6); // 5.5 → 6
    expect(atPct(1_234_567, 130)).toBe(1_604_937); // 1,604,937.1
    expect(atPct(1_111_115, 110)).toBe(1_222_227); // 1,222,226.5 → 1,222,227
    const bill = invoice([{ price: 1_111_115, qty: 16 }], member);
    expect(bill.total).toBe(1_222_227 * 16);
  });

  it("a line on request counts its pieces but no money", () => {
    const bill = invoice(
      [
        { price: null, qty: 3 },
        { price: 100_000, qty: 3 },
      ],
      member,
    );
    expect(bill.pieces).toBe(6);
    expect(bill.total).toBe(150_000 * 3);
  });
});

describe("settings", () => {
  it("keeps a clean ladder: ascending pieces, falling percentages, between 100 and the list price", () => {
    expect(
      cleanSteps(
        [
          { min: 11, pct: 130 },
          { min: 6, pct: 150 },
          { min: 6, pct: 140 },
          { min: 1, pct: 120 },
          { min: 16, pct: 135 },
          { min: 24, pct: 90 },
          { min: 30, pct: 200 },
          { min: 20, pct: 100 },
        ],
        200,
      ),
    ).toEqual([
      { min: 6, pct: 150 },
      { min: 11, pct: 130 },
      { min: 20, pct: 100 },
    ]);
    expect(cleanSteps("nonsense", 200)).toEqual([]);
  });

  it("a list percentage outside 100–1000 falls back to 200", () => {
    expect(cleanListPct(250)).toBe(250);
    expect(cleanListPct(50)).toBe(200);
    expect(cleanListPct("x")).toBe(200);
  });

  it("the SQL argument carries the level, the list percentage and the steps as pairs", () => {
    expect(pricingArg(member)).toEqual({ level: "member", list: 200, steps: [[6, 150], [11, 130], [16, 110], [24, 100]] });
    expect(pricingArg(pro)).toEqual({ level: "pro", list: 100, steps: [] });
  });
});

const yalda: SaleRule = { pct: 10, title_fa: "جشن یلدا", title_en: "Yalda", until: "" };

describe("the quantity discount in percent off the list price", () => {
  it("floors, so the site never promises more than the invoice gives", () => {
    expect([150, 130, 110, 100].map((p) => offPct(200, p))).toEqual([25, 35, 45, 50]);
    expect(offPct(200, 200)).toBe(0);
    expect(offPct(300, 200)).toBe(33);
    expect(offPct(Number.NaN, 100)).toBe(0);
    expect(offPct(200, Number.NaN)).toBe(0);
    expect(formatPct(35, "fa")).toBe("۳۵٪");
    expect(formatPct(35, "en")).toBe("35%");
  });

  it("lays the ladder out from one piece up, from the settings", () => {
    expect(ladder(member)).toEqual([
      { from: 1, to: 5, pct: 200, off: 0 },
      { from: 6, to: 10, pct: 150, off: 25 },
      { from: 11, to: 15, pct: 130, off: 35 },
      { from: 16, to: 23, pct: 110, off: 45 },
      { from: 24, to: null, pct: 100, off: 50 },
    ]);
    expect(ladder(pricingFor("member", { memberPct: 250, steps: [] }))).toEqual([{ from: 1, to: null, pct: 250, off: 0 }]);
  });

  it("knows when a change of pieces reaches a step (and only then)", () => {
    expect(stepReached(5, 6, member)).toEqual({ pct: 150, off: 25 });
    expect(stepReached(6, 7, member)).toBeNull();
    expect(stepReached(0, 11, member)).toEqual({ pct: 130, off: 35 });
    expect(stepReached(12, 3, member)).toBeNull();
    expect(stepReached(0, 50, pro)).toBeNull();
  });

  it("the owner's case: one each of 11 different pieces is an 11-piece order, 35% off the whole invoice", () => {
    const lines = Array.from({ length: 11 }, (_, i) => ({ price: 100_000 + i * 15_000, qty: 1 }));
    const bill = invoice(lines, member);
    expect(bill).toMatchObject({ pieces: 11, pct: 130, off: 35, sale: 0, saleDiscount: 0 });
    expect(bill.list - bill.total).toBe(bill.stepDiscount);
    expect(bill.total).toBe(lines.reduce((n, l) => n + atPct(l.price, 130), 0));
  });
});

describe("the special-day discount", () => {
  it("rounds each piece once, exactly like SQL round(price × pct × (100 − sale) / 10000)", () => {
    expect(unitAt(1_234_567, 130, 0)).toBe(atPct(1_234_567, 130));
    // 10 × 110 × 50 / 10000 = 5.5 → 6 (half away from zero)
    expect(unitAt(10, 110, 50)).toBe(6);
    // 1,111,115 × 110 × 90 / 10000 = 1,100,003.85 → 1,100,004
    expect(unitAt(1_111_115, 110, 10)).toBe(1_100_004);
    // the largest price the admin can enter at the largest list percentage: beyond 2^53 in the middle, exact in BigInt
    expect(unitAt(1e13, 1000, 10)).toBe(9e13);
    expect(unitAt(9_999_999_999_999, 999, 1)).toBe(Number((9_999_999_999_999n * 999n * 99n + 5000n) / 10000n));
  });

  it("comes off every piece after the step, as its own invoice line", () => {
    const withSale = pricingFor("member", { memberPct: 200, steps: DEFAULT_STEPS }, yalda);
    const bill = invoice(
      [
        { price: 1_000_000, qty: 4 },
        { price: 700_000, qty: 3 },
      ],
      withSale,
    );
    // 7 pieces → 150%, then 10% off
    expect(bill.list).toBe(2_000_000 * 4 + 1_400_000 * 3);
    expect(bill.stepped).toBe(1_500_000 * 4 + 1_050_000 * 3);
    expect(bill.total).toBe(1_350_000 * 4 + 945_000 * 3);
    expect(bill.stepDiscount).toBe(bill.list - bill.stepped);
    expect(bill.saleDiscount).toBe(bill.stepped - bill.total);
    expect(bill).toMatchObject({ pct: 150, off: 25, sale: 10 });
  });

  it("Pro accounts pay the admin's price less the sale when the admin includes them", () => {
    const bill = invoice([{ price: 1_234_567, qty: 3 }], pricingFor("pro", { memberPct: 200, steps: DEFAULT_STEPS }, yalda));
    expect(bill).toMatchObject({ list: 1_234_567 * 3, stepped: 1_234_567 * 3, stepDiscount: 0, total: unitAt(1_234_567, 100, 10) * 3 });
  });

  it("accepts only 1–90 and sends the sale to SQL only while it applies", () => {
    expect([0, 1, 90, 91, -5, "12", "x"].map(cleanSalePct)).toEqual([0, 1, 90, 0, 0, 12, 0]);
    expect(pricingFor("member", { memberPct: 200, steps: [] }, { ...yalda, pct: 95 }).sale).toBeNull();
    expect(pricingArg(pricingFor("member", { memberPct: 200, steps: [] }, yalda))).toEqual({ level: "member", list: 200, steps: [], sale: { pct: 10, fa: "جشن یلدا", en: "Yalda" } });
    expect(pricingArg(member)).not.toHaveProperty("sale");
  });
});
