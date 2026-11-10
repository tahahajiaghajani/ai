// Regressions of the continuity review: an approved BIA's or plan's substance (targets, impacts, criteria, steps)
// changes only with the right to approve it — others take it back to review first; an exercise (whose result marks
// its plan tested) is recorded only for a plan its author may change.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";

let w: EventWorld;
type Row = Record<string, any>;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 100 })).rows as Row[];
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;
/** the status a request ended with (the client throws on anything but the expected status) */
const code = (p: Promise<unknown>) => p.then(() => 200, (e: Error) => Number(/→ (\d{3})/.exec(String(e.message))?.[1] ?? 0));

beforeAll(async () => {
  w = await eventWorld();
  await w.o.post(`${w.P}/continuity/seed`, {});
  // the operations manager works in the network team (continuity: write the team's records, no approval)
  await w.o.post(`${w.P}/access/groups/${w.g.network}/members`, { user_ids: [w.p.mgr.userId] });
  await w.drain();
}, 120_000);

describe("continuity approvals and exercises", () => {
  it("keeps an approved BIA's targets for approvers; others take it back to review first", async () => {
    const b = await w.o.post(`${w.P}/continuity/bia/from-template`, { title: "تحلیل اثر شبکهٔ هسته" });
    await w.o.patch(`${w.P}/r/bia/${b.row.id}`, { rto: 4 * 3600, rpo: 3600, mtpd: 24 * 3600, assignment_group_id: w.g.network });
    await w.o.post(`${w.P}/r/bia/${b.row.id}/transition`, { to: "in_review" });
    const approved = (await w.o.post(`${w.P}/r/bia/${b.row.id}/transition`, { to: "approved" })).row;
    expect(await code(w.p.mgr.client.patch(`${w.P}/r/bia/${b.row.id}`, { rto: 259_200, mtpd: 345_600 }))).toBe(400);
    expect(await one("bia", b.row.id)).toMatchObject({ state: "approved", rto: 4 * 3600, mtpd: 24 * 3600, approved_by: approved.approved_by });
    // what is not the BIA's substance stays editable; the targets after «بازبینی دوباره»
    await w.p.mgr.client.patch(`${w.P}/r/bia/${b.row.id}`, { notes: "یادداشت تیم" });
    await w.p.mgr.client.post(`${w.P}/r/bia/${b.row.id}/transition`, { to: "in_review" });
    expect((await w.p.mgr.client.patch(`${w.P}/r/bia/${b.row.id}`, { rto: 8 * 3600 })).row.rto).toBe(8 * 3600);
  });

  it("keeps an approved plan's targets and steps for approvers", async () => {
    const plan = (await w.o.post(`${w.P}/r/continuity_plan`, { title: "طرح بازیابی شبکهٔ هسته", plan_type: "drp", assignment_group_id: w.g.network, rto: 4 * 3600 })).row;
    const step = (await w.o.post(`${w.P}/r/plan_step`, { plan_id: plan.id, seq: 1, title: "اعلام بحران", owner_id: w.p.mgr.userId })).row;
    await w.p.mgr.client.patch(`${w.P}/r/plan_step/${step.id}`, { title: "اعلام بحران به مدیر" });
    await w.o.post(`${w.P}/r/continuity_plan/${plan.id}/transition`, { to: "in_review" });
    await w.o.post(`${w.P}/r/continuity_plan/${plan.id}/transition`, { to: "approved" });
    expect(await code(w.p.mgr.client.patch(`${w.P}/r/continuity_plan/${plan.id}`, { rto: 72 * 3600 }))).toBe(400);
    expect(await code(w.p.mgr.client.patch(`${w.P}/r/plan_step/${step.id}`, { title: "گام بی‌تأیید" }))).toBe(400);
    expect((await one("continuity_plan", plan.id)).rto).toBe(4 * 3600);
    expect((await one("plan_step", step.id)).title).toBe("اعلام بحران به مدیر");
    // the approver (the owner) may
    await w.o.patch(`${w.P}/r/plan_step/${step.id}`, { title: "اعلام بحران به کمیته" });
  });

  it("records an exercise only of a plan its author may change (its result marks the plan tested)", async () => {
    const foreign = (await w.o.post(`${w.P}/r/continuity_plan`, { title: "طرح بازیابی پایگاه داده", plan_type: "drp", assignment_group_id: w.g.db, rto: 4 * 3600 })).row;
    const status = await code(w.p.mgr.client.post(`${w.P}/r/exercise`, { title: "مانور طرح دیگران", plan_id: foreign.id, exercise_type: "tabletop", scheduled_at: new Date().toISOString(), rto_target: 999_999, assignment_group_id: w.g.network }));
    expect(status).toBe(400);
    expect(await q("exercise", { f: "plan_id", op: "eq", v: foreign.id })).toHaveLength(0);
    const own = (await w.o.post(`${w.P}/r/continuity_plan`, { title: "طرح بازیابی سوییچ", plan_type: "drp", assignment_group_id: w.g.network, rto: 3600 })).row;
    const ex = (await w.p.mgr.client.post(`${w.P}/r/exercise`, { title: "مانور سوییچ", plan_id: own.id, exercise_type: "tabletop", scheduled_at: new Date().toISOString(), assignment_group_id: w.g.network })).row;
    expect(ex.rto_target).toBe(3600);
  });
});
