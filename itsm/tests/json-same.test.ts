// JSON compared as JSON, not as text (src/shared/json.ts, docs/PERFORMANCE_FA.md §20): PostgreSQL's jsonb keeps no key
// order, so a value read back from the database and the same value built in code are equal JSON with different
// `JSON.stringify` texts. The record engine's change detection compares them as JSON.
import { describe, expect, it } from "vitest";
import { canonicalJson, sameJson } from "@shared/json";
import { sameValue } from "@server/engine/write";
import type { FieldDef } from "@shared/model/types";

describe("JSON compared as JSON", () => {
  it("writes every object's keys in one order, at every level, and keeps arrays in theirs", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }, 3], c: null } })).toBe('{"a":{"c":null,"d":[{"x":2,"y":1},3]},"b":1}');
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(undefined)).toBeUndefined();
  });

  it("finds equal JSON equal whatever the key order, and keeps JSON.stringify's view of the rest", () => {
    expect(sameJson({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameJson([{ a: 1, b: 2 }], [{ b: 2, a: 1 }])).toBe(true);
    // arrays are ordered
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    // as JSON.stringify writes them: an undefined key is no key, a date is its ISO text, null and undefined differ
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJson({ at: new Date(0) }, { at: "1970-01-01T00:00:00.000Z" })).toBe(true);
    expect(sameJson(null, undefined)).toBe(false);
    expect(sameJson(null, null)).toBe(true);
  });

  it("is what the record engine uses to tell whether a JSON field changed", () => {
    const f = { name: "detail", label: "detail", type: "json" } as FieldDef;
    expect(sameValue(f, { warned: null, missing: ["owned_by"], completeness: 25 }, { completeness: 25, missing: ["owned_by"], warned: null })).toBe(true);
    expect(sameValue(f, { missing: ["owned_by"] }, { missing: ["location_id"] })).toBe(false);
  });
});
