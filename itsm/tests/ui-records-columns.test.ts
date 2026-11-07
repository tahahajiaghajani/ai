// List columns (src/ui/records/model/columns.ts): defaults, a person's choice kept per organisation/person/table,
// clean-up against the current definition, moves/toggles and the fields a list request asks for.
import { describe, expect, it } from "vitest";
import { tableDef } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { MAX_COLUMNS, columnsKey, loadColumns, moveColumn, requestFields, sanitizeColumns, saveColumns, toggleColumn, type KeyValueStore } from "../src/ui/records/model/columns";
import { defaultColumns } from "../src/ui/records/model/schema";

const todo = tableDef("todo")!;
const lookup = (k: string) => tableDef(k);

function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("default columns", () => {
  it("are the table's list columns, else the number, display field, list fields and state", () => {
    expect(defaultColumns(todo)).toEqual(["number", "short_description", "state", "priority", "assigned_to", "due_at", "updated_at"]);
    const bare: TableDef = { ...tableDef("choice")!, list: undefined };
    expect(defaultColumns(bare)).toEqual(["label", "list", "value", "sort_order", "active"]);
  });
});

describe("sanitising", () => {
  it("drops unknown, hidden, unlistable and duplicate columns and resolves dot-walks", () => {
    expect(sanitizeColumns(["number", "nope", "number", "workspace_id", "description", "caller_id.email", "caller_id.nope", 7], todo, lookup)).toEqual([
      "number",
      "description",
      "caller_id.email",
    ]);
  });

  it("falls back to the defaults when nothing usable is left, and caps the count", () => {
    expect(sanitizeColumns([], todo)).toEqual(defaultColumns(todo));
    expect(sanitizeColumns("bad", todo)).toEqual(defaultColumns(todo));
    const many = todo.fields.filter((f) => !f.hidden && f.type !== "json" && f.type !== "secret").map((f) => f.name);
    expect(sanitizeColumns(many, todo).length).toBe(MAX_COLUMNS);
  });
});

describe("persistence", () => {
  it("keeps a person's choice per organisation, person and table", () => {
    const s = store();
    const key = columnsKey("org1", "user1", "todo");
    expect(key).toBe("itsm.cols.org1.user1.todo");
    expect(loadColumns(s, key, todo).columns).toEqual(defaultColumns(todo));
    saveColumns(s, key, { columns: ["number", "short_description", "u_gone"], widths: { number: 120 } }, todo);
    const back = loadColumns(s, key, todo, lookup);
    expect(back.columns).toEqual(["number", "short_description"]);
    expect(back.widths).toEqual({ number: 120 });
    expect(loadColumns(s, columnsKey("org1", "user2", "todo"), todo).columns).toEqual(defaultColumns(todo));
  });

  it("stores the defaults as nothing (a later change of the defaults reaches the person) and survives bad data", () => {
    const s = store();
    const key = columnsKey("o", "u", "todo");
    saveColumns(s, key, { columns: ["state"] }, todo);
    expect(s.data.has(key)).toBe(true);
    saveColumns(s, key, { columns: defaultColumns(todo) }, todo);
    expect(s.data.has(key)).toBe(false);
    s.data.set(key, "{not json");
    expect(loadColumns(s, key, todo).columns).toEqual(defaultColumns(todo));
    s.data.set(key, JSON.stringify(["priority", "state"]));
    expect(loadColumns(s, key, todo).columns).toEqual(["priority", "state"]);
    s.data.set(key, JSON.stringify({ columns: ["state"], widths: { state: 5, priority: 200 } }));
    expect(loadColumns(s, key, todo)).toEqual({ columns: ["state"] });
    expect(() => saveColumns(null, key, { columns: ["state"] }, todo)).not.toThrow();
  });
});

describe("editing and requests", () => {
  it("toggles and moves columns, never hiding the last one", () => {
    expect(toggleColumn(["a", "b"], "b")).toEqual(["a"]);
    expect(toggleColumn(["a"], "a")).toEqual(["a"]);
    expect(toggleColumn(["a"], "c")).toEqual(["a", "c"]);
    expect(moveColumn(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveColumn(["a", "b", "c"], 2, 9)).toEqual(["a", "b", "c"]);
  });

  it("asks for the columns plus the number, display field, state and extra fields", () => {
    expect(requestFields(todo, ["priority", "caller_id.email"], ["assigned_to", null])).toEqual(["number", "short_description", "state", "priority", "caller_id.email", "assigned_to"]);
  });
});
