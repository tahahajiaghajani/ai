import { describe, expect, it } from "vitest";
import { atPct, cleanListPct, cleanSteps, DEFAULT_STEPS, invoice, listPrice, nextStep, pctFor, pricingArg, pricingFor } from "@/lib/pricing";

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
