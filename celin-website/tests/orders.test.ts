import { describe, expect, it } from "vitest";
import { cleanLines, parsePlaceError } from "@/lib/orders";

const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const V1 = "66666666-6666-4666-8666-666666666666";

describe("cart lines from the browser", () => {
  it("keeps valid lines, merges duplicates and caps quantities", () => {
    const lines = cleanLines([
      { productId: P1, variantId: null, qty: 2 },
      { productId: P1, variantId: null, qty: 3 },
      { productId: P2, variantId: V1, qty: 500 },
      { productId: "seed-x", variantId: null, qty: 1 },
      { productId: P2, variantId: "nope", qty: 1 },
      { productId: P2, variantId: null, qty: 0 },
      null,
      "junk",
    ]);
    expect(lines).toEqual([
      { productId: P1, variantId: null, qty: 5 },
      { productId: P2, variantId: V1, qty: 99 },
    ]);
  });
  it("returns nothing for non-arrays", () => {
    expect(cleanLines({})).toEqual([]);
    expect(cleanLines(undefined)).toEqual([]);
  });
});

describe("database errors", () => {
  it("maps reasons with the item id", () => {
    expect(parsePlaceError(`out_of_stock:${P1}`)).toEqual({ reason: "out_of_stock", id: P1 });
    expect(parsePlaceError(`variant_required:${P2}`)).toEqual({ reason: "variant_required", id: P2 });
    expect(parsePlaceError("empty_order")).toEqual({ reason: "empty" });
    expect(parsePlaceError("no_account")).toEqual({ reason: "no_account" });
    expect(parsePlaceError("something else")).toEqual({ reason: "failed" });
  });
});
