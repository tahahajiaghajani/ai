// The FilterBuilder's model (src/ui/records/model/filter.ts): the editable tree ⇄ the engine's condition JSON,
// operators and values per field type, relative Jalali windows, the fields a filter may name (one dot-walk), quick
// filters, URL form and the Persian summary. Every condition it produces must pass the engine's own validator.
import { describe, expect, it } from "vitest";
import type { Cond } from "@shared/model/conditions";
import { validateCond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import {
  addChild, andAll, convertValue, countConditions, decodeFilter, defaultOp, defaultValue, describeFilter, emptyGroup, encodeFilter, filterPaths, fromCond,
  isComplete, newLeaf, opsForPath, presetOf, quickCond, quickFilters, removeNode, RELATIVE_PRESETS, toCond, updateNode, withField, withOp,
} from "../src/ui/records/model/filter";

const todo = tableDef("todo")!;
const lookup = (k: string) => tableDef(k);

describe("tree ⇄ condition", () => {
  it("round-trips nested AND/OR groups", () => {
    const c: Cond = {
      and: [
        { f: "state", op: "in", v: ["new", "in_progress"] },
        { or: [{ f: "assigned_to", op: "is_me" }, { f: "assigned_to", op: "empty" }] },
        { f: "opened_at", op: "relative", v: { unit: "week", n: 1 } },
      ],
    };
    expect(toCond(fromCond(c))).toEqual(c);
    expect(validateCond(toCond(fromCond(c)), todo)).toBeNull();
  });

  it("puts a single leaf under a root group and gives it back as a leaf", () => {
    const tree = fromCond({ f: "priority", op: "eq", v: "1" });
    expect(tree.kind).toBe("group");
    expect(tree.items).toHaveLength(1);
    expect(toCond(tree)).toEqual({ f: "priority", op: "eq", v: "1" });
  });

  it("turns a negated leaf into its negative operator and keeps other negations as groups", () => {
    expect(toCond(fromCond({ not: { f: "state", op: "eq", v: "new" } }))).toEqual({ f: "state", op: "ne", v: "new" });
    expect(toCond(fromCond({ not: { f: "opened_at", op: "relative", v: { unit: "day", n: 7 } } }))).toEqual({ not: { f: "opened_at", op: "relative", v: { unit: "day", n: 7 } } });
    const g = fromCond({ not: { or: [{ f: "state", op: "eq", v: "new" }, { f: "priority", op: "eq", v: "1" }] } });
    expect(g.items[0]).toMatchObject({ kind: "group", join: "or", not: true });
    expect(toCond(g)).toEqual({ not: { or: [{ f: "state", op: "eq", v: "new" }, { f: "priority", op: "eq", v: "1" }] } });
  });

  it("drops incomplete leaves, empty groups and merges nested groups of the same kind", () => {
    const root = emptyGroup("and");
    root.items.push(newLeaf("state", "in", []), newLeaf("", ""), newLeaf("priority", "eq", "2"), { ...emptyGroup("and"), items: [newLeaf("assigned_to", "is_me")] });
    root.items.push({ ...emptyGroup("or"), items: [] });
    expect(toCond(root)).toEqual({ and: [{ f: "priority", op: "eq", v: "2" }, { f: "assigned_to", op: "is_me" }] });
    expect(countConditions(root)).toBe(2);
    expect(toCond(emptyGroup())).toBeNull();
  });

  it("edits the tree immutably", () => {
    const root = fromCond({ and: [{ f: "priority", op: "eq", v: "1" }, { f: "state", op: "eq", v: "new" }] });
    const first = root.items[0];
    const edited = updateNode(root, first.id, (n) => ({ ...n, v: "2" }) as typeof n);
    expect(toCond(edited)).toEqual({ and: [{ f: "priority", op: "eq", v: "2" }, { f: "state", op: "eq", v: "new" }] });
    expect(toCond(root)).toEqual({ and: [{ f: "priority", op: "eq", v: "1" }, { f: "state", op: "eq", v: "new" }] });
    expect(toCond(removeNode(edited, first.id))).toEqual({ f: "state", op: "eq", v: "new" });
    const added = addChild(root, root.id, newLeaf("assigned_to", "is_me"));
    expect((toCond(added) as { and: Cond[] }).and).toHaveLength(3);
  });
});

describe("operators and values", () => {
  it("knows when a leaf is complete for each value shape", () => {
    expect(isComplete(newLeaf("assigned_to", "is_me"))).toBe(true);
    expect(isComplete(newLeaf("priority", "eq", ""))).toBe(false);
    expect(isComplete(newLeaf("knowledge", "eq", false))).toBe(true);
    expect(isComplete(newLeaf("state", "in", ["new"]))).toBe(true);
    expect(isComplete(newLeaf("estimate", "between", [1, null]))).toBe(false);
    expect(isComplete(newLeaf("estimate", "between", [1, 5]))).toBe(true);
    expect(isComplete(newLeaf("opened_at", "relative", { unit: "month", from: -1, to: -1 }))).toBe(true);
    expect(isComplete(newLeaf("opened_at", "relative", { unit: "fortnight" }))).toBe(false);
  });

  it("offers filter operators only (no rule operators) and starts each type with its usual one", () => {
    const ops = opsForPath(todo, "state", lookup);
    expect(ops).toContain("in");
    expect(ops).not.toContain("changed");
    expect(opsForPath(todo, "caller_id.email", lookup)).toContain("contains");
    expect(opsForPath(todo, "nope", lookup)).toEqual([]);
    const f = (n: string) => todo.fields.find((x) => x.name === n)!;
    expect(defaultOp(f("assigned_to"), "user")).toBe("is_me");
    expect(defaultOp(f("assignment_group_id"), "group")).toBe("is_my_group");
    expect(defaultOp(f("state"), null)).toBe("in");
    expect(defaultOp(f("tags"), null)).toBe("contains");
    expect(defaultOp(f("due_at"), null)).toBe("relative");
    expect(defaultOp(f("estimate"), null)).toBe("eq");
    expect(defaultOp(f("short_description"), null)).toBe("contains");
    expect(defaultOp(f("knowledge"), null)).toBe("eq");
    expect(defaultValue("eq", f("knowledge"))).toBe(true);
  });

  it("picks the field's operator and value when the field changes, and carries values across operators", () => {
    const l = withField(newLeaf(), "due_at", todo, lookup);
    expect(l).toMatchObject({ f: "due_at", op: "relative", v: { unit: "day", n: 7, dir: "past" } });
    expect(isComplete(l)).toBe(true);
    expect(validateCond(toCond(l), todo)).toBeNull();
    const p = withOp(newLeaf("priority", "eq", "2"), "in", todo, lookup);
    expect(p.v).toEqual(["2"]);
    expect(withOp(p, "eq", todo, lookup).v).toBe("2");
    expect(convertValue(5, "eq", "between")).toEqual([5, null]);
    expect(convertValue([5, 9], "between", "gt")).toBe(5);
    expect(convertValue("x", "eq", "empty")).toBeUndefined();
  });

  it("every default leaf of every filterable field is a valid condition", () => {
    for (const p of filterPaths(todo, lookup, { walk: true })) {
      const l = withField(newLeaf(), p.path, todo, lookup);
      const c = toCond(l);
      if (c) expect(validateCond(c, todo, { lookup }), p.path).toBeNull();
    }
  });
});

describe("relative windows", () => {
  it("labels presets in Persian and recognises a window however it is written", () => {
    expect(RELATIVE_PRESETS.find((p) => p.key === "7d")!.label).toBe("۷ روز گذشته");
    expect(RELATIVE_PRESETS.find((p) => p.key === "month")!.label).toBe("این ماه");
    expect(RELATIVE_PRESETS.find((p) => p.key === "week")!.label).toBe("این هفته");
    expect(presetOf({ unit: "day", from: -6, to: 0 })?.key).toBe("7d");
    expect(presetOf({ unit: "month", n: 1, dir: "past" })?.key).toBe("month");
    expect(presetOf({ unit: "day", from: -40, to: -3 })).toBeUndefined();
  });
});

describe("fields a filter may name", () => {
  it("lists the table's fields (filterable ones first) and walks one level into readable references", () => {
    const own = filterPaths(todo, lookup);
    expect(own[0].common).toBe(true);
    expect(own.some((p) => p.path === "workspace_id")).toBe(true); // hidden but filterable
    expect(own.some((p) => p.path === "domain_id")).toBe(false); // hidden and not filterable
    const walked = filterPaths(todo, lookup, { walk: true });
    const email = walked.find((p) => p.path === "caller_id.email");
    expect(email).toMatchObject({ label: "درخواست‌دهنده ← ایمیل", table: "user", via: { name: "caller_id" } });
    // references to tables that do not exist are not walked (the service portfolio's `service` exists now)
    const ghost = { ...todo, fields: [...todo.fields, { name: "ghost_id", label: "ناموجود", type: "ref", ref: "no_such_table", filter: true }] } as typeof todo;
    expect(filterPaths(ghost, lookup, { walk: true }).some((p) => p.path.startsWith("ghost_id."))).toBe(false);
    expect(walked.some((p) => p.path.startsWith("service_id."))).toBe(true);
  });
});

describe("quick filters, composition and URL form", () => {
  it("derives quick filters from the table's fields", () => {
    const keys = quickFilters(todo).map((q) => q.key);
    expect(keys).toEqual(["mine", "my-groups", "open", "unassigned", "watching"]);
    const c = quickCond(todo, ["mine", "open"]);
    expect(c).toEqual({ and: [{ f: "assigned_to", op: "is_me" }, { f: "active", op: "eq", v: true }] });
    expect(validateCond(c, todo)).toBeNull();
    expect(quickCond(todo, [])).toBeNull();
  });

  it("ANDs conditions, flattening and skipping empties", () => {
    expect(andAll(null, { f: "a", op: "empty" }, undefined)).toEqual({ f: "a", op: "empty" });
    expect(andAll({ and: [{ f: "a", op: "empty" }] }, { f: "b", op: "nempty" })).toEqual({ and: [{ f: "a", op: "empty" }, { f: "b", op: "nempty" }] });
    expect(andAll()).toBeNull();
  });

  it("encodes into and decodes from a URL parameter, refusing what is not a condition", () => {
    const c: Cond = { or: [{ f: "state", op: "eq", v: "new" }, { f: "priority", op: "in", v: ["1", "2"] }] };
    expect(decodeFilter(encodeFilter(c))).toEqual(c);
    expect(decodeFilter("{bad json")).toBeNull();
    expect(decodeFilter(JSON.stringify({ f: "state", op: "drop table" }))).toBeNull();
    expect(decodeFilter(JSON.stringify([1, 2]))).toBeNull();
    expect(encodeFilter(null)).toBe("");
  });

  it("describes a filter as a Persian sentence with option labels and names", () => {
    const s = describeFilter({ and: [{ f: "state", op: "in", v: ["new", "in_progress"] }, { f: "assigned_to", op: "is_me" }] }, todo, { lookup });
    expect(s).toContain("«وضعیت» یکی از «جدید»");
    expect(s).toContain("«کارشناس» من هستم");
    expect(describeFilter(null, todo)).toBe("همهٔ رکوردها");
  });
});
