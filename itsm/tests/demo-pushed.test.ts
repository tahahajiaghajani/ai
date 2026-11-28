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

  it("a new row the purge would have removed with purged data is dropped, never stored with its parent emptied", () => {
    // the purge's own rule (refs.ts): a holder in a pack unit, a requested item of a purged request, a record of a purged
    // workspace (emptied, the workspace would open it to everyone) — before, each was stored with the pointer emptied
    const demoRequest = uuidv7();
    const demoWorkspace = uuidv7();
    const more = new Set([...purged, demoRequest, demoWorkspace]);
    const holder = wire("position_holder", { position_id: real, user_id: real, org_unit_id: demoUnit, kind: "primary" });
    expect(judgePurged(record("position_holder"), tableDef("position_holder")!, holder, null, more)).toEqual({ kind: "drop", message: PURGED_REF });
    const item = wire("request_item", { short_description: "قلم درخواست", request_id: demoRequest });
    expect(judgePurged(record("request_item"), tableDef("request_item")!, item, null, more)).toEqual({ kind: "drop", message: PURGED_REF });
    const inWorkspace = wire("todo", { short_description: "x", workspace_id: demoWorkspace });
    expect(judgePurged(record("todo"), todo, inWorkspace, null, more)).toEqual({ kind: "drop", message: PURGED_REF });
    // a requester-side pointer that is no requester or beneficiary of the purge's rule is cleared, as the purge clears it
    const opened = wire("todo", { short_description: "x", opened_by: persona, caller_id: real });
    expect(judgePurged(record("todo"), todo, opened, null, more)).toEqual({ kind: "write" });
    expect(opened.row).toMatchObject({ opened_by: null, caller_id: real });
    // the same holder in a real unit is stored as pushed
    const kept = wire("position_holder", { position_id: real, user_id: real, org_unit_id: real, kind: "primary" });
    expect(judgePurged(record("position_holder"), tableDef("position_holder")!, kept, null, more)).toEqual({ kind: "write" });
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

  it("a new definition whose audience, scope or producer named only purged data is stored ended, never «for everyone»", () => {
    // (before, the lists were emptied and the row stored as pushed: «خالی یعنی همه»)
    const audience = uuidv7();
    const service = uuidv7();
    const group = uuidv7();
    const more = new Set([...purged, audience, service, group]);
    const judge = (key: string, row: Record<string, unknown>) => {
      const agg = wire(key, row);
      return { v: judgePurged(record(key), tableDef(key)!, agg, null, more), row: agg.row };
    };
    // a published catalogue item for a purged audience leaves the catalogue; a draft stays a draft (it cannot be ordered)
    const item = judge("catalog_item", { name: "قلم شعبه", catalog_id: real, type: "standard", state: "published", available_for: [audience] });
    expect(item.v).toMatchObject({ kind: "ended" });
    expect(item.row).toMatchObject({ state: "retired", available_for: [] });
    const draft = judge("catalog_item", { name: "قلم پیش‌نویس", catalog_id: real, type: "standard", state: "draft", available_for: [audience] });
    expect(draft.v).toMatchObject({ kind: "ended" });
    expect(draft.row).toMatchObject({ state: "draft", available_for: [] });
    // a portal topic for a purged person, an SLA of a purged service, a flow run as a purged person: switched off
    const topic = judge("portal_topic", { name: "موضوع شعبه", active: true, aud_users: [persona] });
    expect(topic.v).toMatchObject({ kind: "ended" });
    expect(topic.row).toMatchObject({ active: false, aud_users: [] });
    const sla = judge("sla_definition", { name: "پاسخ خدمت شعبه", table_key: "incident", active: true, service_id: service });
    expect(sla.v).toMatchObject({ kind: "ended" });
    expect(sla.row).toMatchObject({ active: false, service_id: null });
    const flow = judge("flow", { name: "جریان شعبه", trigger: "record", run_as: "user", active: true, run_as_user: persona });
    expect(flow.v).toMatchObject({ kind: "ended" });
    expect(flow.row).toMatchObject({ active: false, run_as_user: null });
    // an audience of «همه» that loses a criterion ends; one of «هر یک» keeps its other criteria
    const all = judge("catalog_audience", { name: "کارشناسان شعبه", match: "all", active: true, units: [demoUnit], roles: ["agent"] });
    expect(all.v).toMatchObject({ kind: "ended" });
    expect(all.row).toMatchObject({ active: false, units: [], roles: ["agent"] });
    const any = judge("catalog_audience", { name: "کارشناسان یا شعبه", match: "any", active: true, units: [demoUnit], roles: ["agent"] });
    expect(any.v).toEqual({ kind: "write" });
    expect(any.row).toMatchObject({ active: true, units: [], roles: ["agent"] });
    // a list that keeps a live id only narrows
    const link = judge("portal_link", { name: "پیوند شعبه", url: "https://desk.example.com", active: true, aud_groups: [group, real] });
    expect(link.v).toEqual({ kind: "write" });
    expect(link.row).toMatchObject({ active: true, aud_groups: [real] });
  });

  it("a stored definition whose audience or scope would name only purged data keeps the server's copy: nothing of the push", () => {
    // (before, an offline edit made after the purge won the stale check and wrote the whole row back: «فعال» again, with
    // its audience emptied)
    const service = uuidv7();
    const more = new Set([...purged, service]);
    const topic = wire("portal_topic", { name: "ویرایش بیرون از خط", active: true, aud_users: [persona] });
    expect(judgePurged(record("portal_topic"), tableDef("portal_topic")!, topic, { custom: {} }, more)).toMatchObject({ kind: "stored" });
    const sla = wire("sla_definition", { name: "پاسخ خدمت شعبه", table_key: "incident", active: true, service_id: service });
    expect(judgePurged(record("sla_definition"), tableDef("sla_definition")!, sla, { custom: {} }, more)).toMatchObject({ kind: "stored" });
    // one that keeps a live audience takes the push's changes, as any stored record does
    const kept = wire("portal_topic", { name: "ویرایش بیرون از خط", active: true, aud_users: [persona, real] });
    expect(judgePurged(record("portal_topic"), tableDef("portal_topic")!, kept, { custom: {} }, more)).toEqual({ kind: "write" });
    expect(kept.row).toMatchObject({ name: "ویرایش بیرون از خط", aud_users: [real] });
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
