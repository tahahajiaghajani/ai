// The path reader of the price sources a business types itself (gold board and exchange board):
// keys, array positions in both spellings, and an array item picked by a field (free price APIs answer
// with lists such as [{symbol: "USD", price: …}]).
import { describe, it, expect } from "vitest";
import { pickPath } from "@shared/json-path";

const answer = {
  data: { gold: { g18: "52,400,000" } },
  items: [
    { symbol: "USD", name: "دلار آمریکا", price: 1_052_000, sell: "1053000" },
    { symbol: "EUR", name: "یورو", price: 1_190_000 },
  ],
  coins: { emami: { value: "830000000" } },
  rows: { a: { key: "sekkeh", p: 1 }, b: { key: "bahar", p: 2 } },
};

describe("pickPath", () => {
  it("reads keys and array positions as before", () => {
    expect(pickPath(answer, "data.gold.g18")).toBe("52,400,000");
    expect(pickPath(answer, "items[1].price")).toBe(1_190_000);
    expect(pickPath(answer, "items.1.price")).toBe(1_190_000);
    expect(pickPath(answer, "coins.emami.value")).toBe("830000000");
  });

  it("picks an array item by a field", () => {
    expect(pickPath(answer, "items[symbol=USD].sell")).toBe("1053000");
    expect(pickPath(answer, 'items[symbol="EUR"].price')).toBe(1_190_000);
    expect(pickPath(answer, "items[ symbol = 'USD' ].price")).toBe(1_052_000);
    expect(pickPath(answer, "items[name=دلار آمریکا].price")).toBe(1_052_000);
    // the values of an object work like a list too
    expect(pickPath(answer, "rows[key=bahar].p")).toBe(2);
  });

  it("gives undefined, never throws, for what is not there", () => {
    expect(pickPath(answer, "items[symbol=GBP].price")).toBeUndefined();
    expect(pickPath(answer, "items[9].price")).toBeUndefined();
    expect(pickPath(answer, "items.price")).toBeUndefined();
    expect(pickPath(answer, "data.gold.g18.x")).toBeUndefined();
    expect(pickPath(null, "a.b")).toBeUndefined();
    expect(pickPath(answer, "")).toBe(answer);
  });
});
