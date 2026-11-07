// UI policies and form state (src/ui/records/model/policies.ts): what each field of a form is — hidden, required,
// read-only, waiting for its parent — from the definition, the record's meta and live UI policies.
import { describe, expect, it } from "vitest";
import { tableDef } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { clientEnv, formState, missingRequired, transitionMissing, type UiPolicy } from "../src/ui/records/model/policies";

const todo = tableDef("todo")!;
const lookup = (k: string) => tableDef(k);
const ME = "11111111-1111-4111-8111-111111111111";
const env = clientEnv(ME, "Asia/Tehran");

describe("form state from the definition and meta", () => {
  it("hides engine fields on a new record and shows them read-only on an existing one", () => {
    const create = formState(todo, {}, [], { mode: "create", canWrite: true, env, lookup });
    expect(create.hidden.has("opened_at")).toBe(true);
    expect(create.hidden.has("created_at")).toBe(true);
    expect(create.hidden.has("workspace_id")).toBe(true); // hidden in code
    expect(create.required.has("short_description")).toBe(true);
    const update = formState(todo, {}, [], { mode: "update", canWrite: true, env, lookup });
    expect(update.hidden.has("opened_at")).toBe(false);
    expect(update.readonly.has("opened_at")).toBe(true);
    expect(update.readonly.has("approval")).toBe(true); // readonly in code
    expect(update.readonly.has("short_description")).toBe(false);
  });

  it("locks everything when the caller may not write or the record is locked, and honours meta.readonly", () => {
    const ro = formState(todo, {}, [], { mode: "update", canWrite: false, env, lookup });
    expect(ro.readonly.has("short_description")).toBe(true);
    expect(ro.required.has("short_description")).toBe(false); // nobody can fill it here
    const locked = formState(todo, {}, [], { mode: "update", canWrite: true, locked: true, env, lookup });
    expect(locked.readonly.has("priority")).toBe(true);
    const meta = formState(todo, {}, [], { mode: "update", canWrite: true, readonly: ["priority"], env, lookup });
    expect(meta.readonly.has("priority")).toBe(true);
    expect(meta.readonly.has("impact")).toBe(false);
  });

  it("marks a dependent field as waiting while its parent is empty", () => {
    const s = formState(todo, { category: null }, [], { mode: "create", canWrite: true, env, lookup });
    expect(s.waiting.get("subcategory")).toBe("دسته");
    expect(formState(todo, { category: "general" }, [], { mode: "create", canWrite: true, env, lookup }).waiting.has("subcategory")).toBe(false);
  });
});

describe("UI policies", () => {
  const policies: UiPolicy[] = [
    { key: "p1", when: { f: "priority", op: "in", v: ["1", "2"] }, actions: [{ field: "close_notes", mandatory: true }, { field: "estimate", visible: false }], message: "اولویت بالا: شرح بستن لازم است" },
    { key: "p2", when: { f: "assigned_to", op: "is_me" }, actions: [{ field: "impact", readonly: true }] },
    { key: "p3", when: null, actions: [{ field: "opened_at", readonly: false }, { field: "nope", visible: false }], order: 5 },
  ];

  it("applies a policy only while its condition holds, live on the form's values", () => {
    const low = formState(todo, { priority: "4" }, policies, { mode: "update", canWrite: true, env, lookup });
    expect(low.required.has("close_notes")).toBe(false);
    expect(low.hidden.has("estimate")).toBe(false);
    expect(low.messages).toEqual([]);
    const high = formState(todo, { priority: "1" }, policies, { mode: "update", canWrite: true, env, lookup });
    expect(high.required.has("close_notes")).toBe(true);
    expect(high.hidden.has("estimate")).toBe(true);
    expect(high.messages.map((m) => m.text)).toEqual(["اولویت بالا: شرح بستن لازم است"]);
  });

  it("evaluates is_me against the signed-in person", () => {
    expect(formState(todo, { assigned_to: ME }, policies, { mode: "update", canWrite: true, env, lookup }).readonly.has("impact")).toBe(true);
    expect(formState(todo, { assigned_to: "22222222-2222-4222-8222-222222222222" }, policies, { mode: "update", canWrite: true, env, lookup }).readonly.has("impact")).toBe(false);
  });

  it("never makes writable what the server would refuse, and ignores unknown fields", () => {
    const s = formState(todo, {}, policies, { mode: "update", canWrite: true, env, lookup });
    expect(s.readonly.has("opened_at")).toBe(true);
    expect(s.hidden.has("nope")).toBe(false);
  });

  it("lets a later policy win, keeps mandatory fields visible and respects create/update", () => {
    const order: UiPolicy[] = [
      { order: 2, actions: [{ field: "estimate", visible: true }] },
      { order: 1, actions: [{ field: "estimate", visible: false }] },
      { actions: [{ field: "impact", visible: false }, { field: "impact", mandatory: true }] },
      { on: "create", actions: [{ field: "urgency", visible: false }] },
    ];
    const u = formState(todo, {}, order, { mode: "update", canWrite: true, env, lookup });
    expect(u.hidden.has("estimate")).toBe(false);
    expect(u.hidden.has("impact")).toBe(false);
    expect(u.required.has("impact")).toBe(true);
    expect(u.hidden.has("urgency")).toBe(false);
    expect(formState(todo, {}, order, { mode: "create", canWrite: true, env, lookup }).hidden.has("urgency")).toBe(true);
  });

  it("treats a policy whose condition cannot be evaluated as not applying", () => {
    const bad: UiPolicy[] = [{ when: { f: "no_such_field", op: "eq", v: 1 }, actions: [{ field: "estimate", visible: false }] }];
    expect(formState(todo, {}, bad, { mode: "update", canWrite: true, env, lookup }).hidden.has("estimate")).toBe(false);
  });
});

describe("required values", () => {
  it("lists required fields still empty, and the fields a transition requires", () => {
    const s = formState(todo, {}, [], { mode: "create", canWrite: true, env, lookup });
    expect(missingRequired(todo, { short_description: "" }, s).map((f) => f.name)).toEqual(["short_description"]);
    expect(missingRequired(todo, { short_description: "چاپگر" }, s)).toEqual([]);
    const req = ["close_code", "close_notes"];
    expect(transitionMissing(todo, req, { close_code: "solved" }).map((f) => f.name)).toEqual(["close_notes"]);
    expect(transitionMissing(todo, req, {}, { close_code: "solved", close_notes: "انجام شد" })).toEqual([]);
  });

  it("works for a table without a state model", () => {
    const plain: TableDef = { ...tableDef("choice")! };
    const s = formState(plain, {}, [], { mode: "create", canWrite: true, env, lookup });
    expect([...s.required].sort()).toEqual(["label", "list", "value"]);
  });
});
