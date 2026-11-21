// The push filter's judgement of a row a Windows app pushes after a demo purge (modules/demo/pushed.ts): what the purge
// removed never comes back, a new row that belongs to it is not stored, a new row's pointer to it is emptied, and a
// record the server has keeps the server's value there while the push's other changes are taken. Pure: the purged ids
// are given (tests/demo-sync.test.ts runs the whole push against the ledger on a linked app).
import { describe, it, expect } from "vitest";
import { tableDef } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import type { AggregateDef, WireAggregate } from "@server/sync/registry";
import { judgePurged, namesPurged, PURGED_REF, PURGED_ROW } from "@server/modules/demo/pushed";

const record = (key: string): AggregateDef => ({ entity: key, table: tableDef(key)!.table, area: "work", order: 10, engine: "record" });
const side = (entity: "journal" | "history" | "attachment" | "link"): AggregateDef => ({ entity, table: `sm_${entity}`, area: "work", order: 20, engine: entity });
const member: AggregateDef = { entity: "member", table: "sm_org_members", area: "users", order: 1 };
const wire = (entity: string, row: Record<string, unknown>, id = uuidv7()): WireAggregate => ({ entity, id, base_rev: 0, row: { id, ...row }, children: {} });

describe("what a push names of a purge", () => {
  const persona = uuidv7();
  const demoCase = uuidv7();
  const demoProcess = uuidv7();
  const demoUnit = uuidv7();
  const demoRecord = uuidv7();
  const real = uuidv7();
  const purged = new Set([persona, demoCase, demoProcess, demoUnit, demoRecord]);
  const todo = tableDef("todo")!;

  it("a purged row never comes back, whatever it is", () => {
    for (const [agg, def] of [[record("todo"), todo], [side("journal"), null], [member, null]] as const) {
      expect(judgePurged(agg, def, wire(agg.entity, {}, demoRecord), def ? { custom: {} } : null, purged)).toEqual({ kind: "drop", message: PURGED_ROW });
    }
  });

  it("a new record whose requester is a purged person belongs to purged data: it is dropped", () => {
    expect(judgePurged(record("todo"), todo, wire("todo", { short_description: "x", caller_id: persona }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
  });

  it("a stored record that names purged data keeps the server's value there and takes the push's other changes", () => {
    // (it was answered «conflict» with the server's copy: the person's offline edit of a real record was lost)
    const edit = wire("todo", { short_description: "ویرایش بیرون از خط", caller_id: persona, created_by: persona, assigned_to: persona, watch_list: [persona, real] });
    expect(judgePurged(record("todo"), todo, edit, { custom: {} }, purged)).toEqual({ kind: "write" });
    expect(edit.row.short_description).toBe("ویرایش بیرون از خط");
    for (const f of ["caller_id", "created_by", "assigned_to"]) expect(f in edit.row, f).toBe(false);
    expect(edit.row.watch_list).toEqual([real]);
  });

  it("pointers are emptied on a new row, left as stored on an existing one; lists lose the purged ids", () => {
    const fresh = wire("todo", { short_description: "x", assigned_to: persona, watch_list: [persona, real], unit_id: demoUnit, caller_id: real });
    expect(judgePurged(record("todo"), todo, fresh, null, purged)).toEqual({ kind: "write" });
    expect(fresh.row).toMatchObject({ assigned_to: null, watch_list: [real], unit_id: null, caller_id: real });
    const stored = wire("todo", { short_description: "x", assigned_to: persona, watch_list: [persona], unit_id: demoUnit });
    expect(judgePurged(record("todo"), todo, stored, { custom: {} }, purged)).toEqual({ kind: "write" });
    expect("assigned_to" in stored.row).toBe(false);
    expect("unit_id" in stored.row).toBe(false);
    expect(stored.row.watch_list).toEqual([]);
  });

  it("a stored record's custom values naming purged data are the server's again (a pushed custom replaces them whole)", () => {
    const def = { ...todo, fields: [...todo.fields, { name: "u_reviewer", label: "بازبین", type: "user", custom: true, required: true }] } as typeof todo;
    const stored = wire("todo", { short_description: "x", custom: { u_reviewer: persona, u_note: "یادداشت" } });
    expect(judgePurged(record("todo"), def, stored, { custom: { u_reviewer: real } }, purged)).toEqual({ kind: "write" });
    expect(stored.row.custom).toEqual({ u_reviewer: real, u_note: "یادداشت" });
    // a new record whose required custom reference is purged belongs to purged data
    expect(judgePurged(record("todo"), def, wire("todo", { short_description: "x", custom: { u_reviewer: persona } }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
  });

  it("a workflow submission of a purged case or process belongs to it, even when it names it in text", () => {
    const submission = tableDef("process_submission")!;
    const agg = record("process_submission");
    expect(judgePurged(agg, submission, wire("process_submission", { kind: "step", case_id: demoCase, submitted_by: real }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
    expect(judgePurged(agg, submission, wire("process_submission", { kind: "start", process_id: demoProcess, case_id: uuidv7(), submitted_by: real }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
    expect(judgePurged(agg, submission, wire("process_submission", { kind: "start", process_id: uuidv7(), case_id: uuidv7(), submitted_by: persona }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
    expect(judgePurged(agg, submission, wire("process_submission", { kind: "start", process_id: uuidv7(), case_id: uuidv7(), submitted_by: real }), null, purged)).toEqual({ kind: "write" });
  });

  it("side rows and memberships of purged data go with it", () => {
    expect(judgePurged(side("journal"), null, wire("journal", { table_key: "todo", record_id: demoRecord, author: real }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
    expect(judgePurged(side("history"), null, wire("history", { table_key: "todo", record_id: real, actor: persona }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
    expect(judgePurged(side("link"), null, wire("link", { from_table: "todo", from_id: real, to_table: "todo", to_id: demoRecord }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
    expect(judgePurged(member, null, wire("member", { user_id: persona, role: "member" }), null, purged)).toEqual({ kind: "drop", message: PURGED_REF });
    expect(judgePurged(side("journal"), null, wire("journal", { table_key: "todo", record_id: real, author: real }), null, purged)).toEqual({ kind: "write" });
  });

  it("nothing purged: nothing is judged", () => {
    const row = wire("todo", { assigned_to: persona });
    expect(namesPurged(row, new Set())).toBe(false);
    expect(namesPurged(row, purged)).toBe(true);
    expect(namesPurged(wire("todo", { assigned_to: real }), purged)).toBe(false);
    expect(judgePurged(record("todo"), todo, row, null, new Set())).toEqual({ kind: "write" });
    expect(row.row.assigned_to).toBe(persona);
  });
});
