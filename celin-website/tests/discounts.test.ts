import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { basketPieces, invoiceLines, linePieces, piecePrice } from "@/lib/basket";
import type { ProPrices } from "@/lib/catalog-types";
import { levelsInfo } from "@/lib/levels";
import { orderDiscounts, type OrderDetail } from "@/lib/order-meta";
import { parsePlaceError } from "@/lib/orders";
import { DEFAULT_STEPS, invoice, pricingFor } from "@/lib/pricing";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";
import { DiscountLadder } from "@/components/account/discount-ladder";
import { StepNote } from "@/components/pro/step-note";

/**
 * The quantity discount made explicit: every piece of one order counts (one helper turns basket lines into the
 * invoice's pieces), the percentage off the whole order while choosing, in the basket and on the invoice, and the
 * full ladder on /pro and /account/pro — all from the settings.
 */

const member = pricingFor("member", { memberPct: 200, steps: DEFAULT_STEPS });
const pro = pricingFor("pro", { memberPct: 200, steps: DEFAULT_STEPS });
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("basket lines → the invoice", () => {
  const prices: ProPrices = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [id(i), { price: 100_000 * (i + 1), stock: 5, variants: {} }]));
  prices[id(0)].variants[id(99)] = { price: null, stock: 3 };
  prices[id(1)].variants[id(98)] = { price: 250_000, stock: 3 };

  it("counts every piece of the basket, whichever design or option", () => {
    const lines = Array.from({ length: 11 }, (_, i) => ({ productId: id(i), variantId: null, qty: 1 }));
    expect(basketPieces(lines)).toBe(11);
    expect(linePieces({ qty: 4 })).toBe(4);
    const bill = invoice(invoiceLines(lines, prices), member);
    expect(bill).toMatchObject({ pieces: 11, pct: 130, off: 35 });
  });

  it("prices a line by its option (falling back to the product) and leaves out lines that are gone", () => {
    expect(piecePrice(prices, { productId: id(0), variantId: id(99) })).toBe(100_000);
    expect(piecePrice(prices, { productId: id(1), variantId: id(98) })).toBe(250_000);
    expect(piecePrice(prices, { productId: id(1), variantId: id(97) })).toBeUndefined();
    expect(piecePrice(prices, { productId: id(50), variantId: null })).toBeUndefined();
    expect(
      invoiceLines(
        [
          { productId: id(1), variantId: id(98), qty: 2 },
          { productId: id(50), variantId: null, qty: 9 },
        ],
        prices,
      ),
    ).toEqual([{ price: 250_000, qty: 2 }]);
  });
});

describe("the step while buying", () => {
  const render = (pieces: number, chosen: number, p = member, lang: "fa" | "en" = "fa") => renderToStaticMarkup(createElement(StepNote, { lang, pricing: p, pieces, chosen }));

  it("says when the quantity being chosen takes the whole order to a step, in a polite live region", () => {
    const html = render(6, 1);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("با این تعداد، کل سفارش شما ۲۵٪ تخفیف تعداد می‌گیرد.");
    expect(html).toContain("با ۵ قطعه‌ی دیگر از هر اثری، کل سفارش ۳۵٪ تخفیف می‌گیرد.");
  });

  it("stays quiet when the basket had the step already, and still shows the next one", () => {
    const html = render(7, 1);
    expect(html).not.toContain("با این تعداد");
    expect(html).toContain("با ۴ قطعه‌ی دیگر");
    expect(render(30, 2)).not.toContain("قطعه‌ی دیگر"); // the last step
    expect(render(10, 1, member, "en")).toContain("1 more piece of any design and the whole order gets 35% off.");
  });

  it("renders nothing for Pro accounts (no steps)", () => {
    expect(render(30, 5, pro)).toBe("");
  });

  it("the copy names the whole order and the percentage, in both languages", () => {
    for (const lang of ["fa", "en"] as const) {
      const a = accountCopy(lang);
      expect(a.cart.stepDiscount("11", "35%")).toMatch(lang === "fa" ? /۳۵|35%.*کل سفارش/ : /35% off the whole order/);
      expect(a.cart.stepDiscount("11", "")).not.toMatch(/\s{2}|\(\s/);
      expect(a.order.stepDiscount("11", "35%")).toBe(a.cart.stepDiscount("11", "35%"));
      expect(commonCopy(lang).price.atPieces("11", "35%")).toContain("35%");
    }
    expect(accountCopy("fa").cart.stepDiscount("۱۱", "۳۵٪")).toBe("تخفیف تعداد ۳۵٪ روی کل سفارش (۱۱ قطعه)");
    expect(accountCopy("fa").cart.saleDiscount("", "۱۰٪")).toBe("تخفیف روزهای خاص (۱۰٪)");
  });
});

describe("the invoice keeps what the order was placed with", () => {
  const order = (over: Partial<OrderDetail>): OrderDetail => ({ subtotal: 0, list_subtotal: 0, items_count: 0, pricing: {}, ...over }) as OrderDetail;

  it("an 11-piece member order: the list, the step of the whole order and its percentage", () => {
    expect(orderDiscounts(order({ subtotal: 1_501_500, list_subtotal: 2_310_000, items_count: 11, pricing: { level: "member", list: 200, pct: 130, pieces: 11 } }))).toEqual({
      list: 2_310_000,
      step: 808_500,
      stepOff: 35,
      pieces: 11,
      sale: null,
    });
  });

  it("an order with the special-day discount: the step, then the sale, as the database stored them", () => {
    expect(orderDiscounts(order({ subtotal: 1_351_350, list_subtotal: 2_310_000, items_count: 11, pricing: { level: "member", list: 200, pct: 130, pieces: 11, sale: { pct: 10, fa: "جشن یلدا", en: "Yalda" }, stepped: 1_501_500 } }))).toEqual({
      list: 2_310_000,
      step: 808_500,
      stepOff: 35,
      pieces: 11,
      sale: { amount: 150_150, pct: 10, fa: "جشن یلدا", en: "Yalda" },
    });
  });

  it("older orders and Pro orders read as before", () => {
    expect(orderDiscounts(order({ subtotal: 900, list_subtotal: 0, items_count: 3 }))).toMatchObject({ list: 900, step: 0, stepOff: 0, pieces: 3, sale: null });
    expect(orderDiscounts(order({ subtotal: 600, list_subtotal: 1000, items_count: 7 }))).toMatchObject({ list: 1000, step: 400, stepOff: 0, pieces: 7 });
    // a Pro order with the sale: no step, only the sale
    expect(orderDiscounts(order({ subtotal: 900, list_subtotal: 1000, items_count: 1, pricing: { level: "pro", list: 100, pct: 100, pieces: 1, sale: { pct: 10, fa: "", en: "" }, stepped: 1000 } }))).toMatchObject({ list: 1000, step: 0, sale: { amount: 100 } });
  });

  it("maps the database's refusals", () => {
    expect(parsePlaceError("price_changed")).toEqual({ reason: "price_changed" });
    expect(parsePlaceError("pack_unavailable:33333333-3333-4333-8333-333333333333")).toEqual({ reason: "pack_unavailable", id: "33333333-3333-4333-8333-333333333333" });
    expect(parsePlaceError("bad_pack")).toEqual({ reason: "failed" });
    expect(parsePlaceError("bad_pricing")).toEqual({ reason: "failed" });
  });
});

describe("«تخفیف تعداد» in full on /pro and /account/pro", () => {
  it("comes from the settings, formatted for the page", () => {
    const fa = levelsInfo(DEFAULT_SETTINGS.pro, "fa");
    expect(fa.ladder).toHaveLength(5);
    expect(fa.ladder[0]).toEqual({ from: "۱", to: "۵", off: null, wholesale: false });
    expect(fa.ladder[4]).toEqual({ from: "۲۴", to: null, off: "۵۰٪", wholesale: true });
    expect(fa).toMatchObject({ steps: true, firstMin: "۶", maxOff: "۵۰٪", example: { n: "۱۱", off: "۳۵٪" } });
    const other = levelsInfo({ ...DEFAULT_SETTINGS.pro, memberPct: 300, steps: [{ min: 10, pct: 200 }] }, "en");
    expect(other).toMatchObject({ firstMin: "10", maxOff: "33%", example: { n: "10", off: "33%" } });
    expect(levelsInfo({ ...DEFAULT_SETTINGS.pro, steps: [] }, "fa")).toMatchObject({ steps: false, ladder: [], firstMin: null, example: null });
  });

  it("renders the ladder as a table with its rules and a worked example — percentages, never prices", () => {
    for (const lang of ["fa", "en"] as const) {
      const html = renderToStaticMarkup(createElement(DiscountLadder, { lang, levels: levelsInfo(DEFAULT_SETTINGS.pro, lang) }));
      expect(html.match(/<tr/g)).toHaveLength(6);
      expect(html).toContain("<caption");
      expect(html).toContain(lang === "fa" ? "۱۱ تا ۱۵ قطعه" : "11–15 pieces");
      expect(html).toContain(lang === "fa" ? "از ۱۱ اثر مختلف از هر کدام یک عدد" : "one each of 11 different designs");
      // the ladder speaks in percentages (the only amount on it is the Pro threshold, in the closing paragraph)
      expect(html.split("</table>")[0]).not.toMatch(/تومان|Toman/);
    }
  });

  it("the FAQ and the benefit card say every piece of one order counts together", () => {
    const l = levelsInfo(DEFAULT_SETTINGS.pro, "fa");
    expect(accountCopy("fa").proPage.faqSteps(l).a).toContain("از ۶ قطعه کل فاکتور تخفیف می‌گیرد و تا ۵۰٪ می‌رسد");
    expect(accountCopy("fa").proPage.benefits(l)[1].text).toContain("همه‌ی قطعه‌های یک سفارش با هم شمرده می‌شوند");
  });
});

describe("brand words", () => {
  it("our own copy never says «تخفیف ویژه», «حراج» or «ضمانت»", () => {
    const dir = path.resolve(__dirname, "../src");
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
    for (const f of files(dir)) expect(readFileSync(f, "utf8"), f).not.toMatch(/تخفیف ویژه|حراج|ضمانت/);
  });
});
