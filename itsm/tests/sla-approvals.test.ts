// Approvals end to end (src/server/modules/sla/approvals.ts, docs/spec/services/sla.md §4): rules that ask when their
// condition becomes true, any / all / count / percent, approvers from people, groups, the requester's manager, the
// record's fields and a module's owner source, sequential and parallel levels, separation of duties, delegation (asked
// instead, or deciding on someone's behalf), reminders and expiry by job, auto-approval, withdrawal when the record is
// done, ad-hoc requests, bulk decisions, the approvers' read access while their approval is pending, and the checks.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { aggregate, levelOutcome, levelsProblem, needed, roundOutcome } from "@shared/sla/approvals";
import { DEFAULT_LEVELS } from "@shared/tables/approvals";
import { tick } from "@server/jobs";
import { registerApproverSource } from "@server/modules/sla";
import type { Client } from "./helpers";
import { engineOrg, outbox, type EngineOrg } from "./engine-helpers";

const CASE: TableDef = {
  key: "apv_case",
  table: "sm_apv_cases",
  label: "درخواست خرید",
  plural: "درخواست‌های خرید",
  icon: "shopping-cart",
  module: "test",
  area: "work",
  extends: "task",
  numbered: { prefix: "PUR", pad: 5 },
  display: "short_description",
  fields: [
    { name: "kind", label: "نوع", type: "string", maxLength: 40 },
    { name: "amount", label: "مبلغ", type: "int" },
    { name: "approver_user", label: "تأییدکنندهٔ ویژه", type: "user" },
    { name: "approver_group", label: "گروه تأیید", type: "group" },
  ],
  scope: {},
};
registerTable(CASE);

describe("pure approval maths", () => {
  it("counts what a level needs", () => {
    expect(needed("any", null, 3)).toBe(1);
    expect(needed("all", null, 3)).toBe(3);
    expect(needed("count", 2, 3)).toBe(2);
    expect(needed("count", 5, 3)).toBe(3);
    expect(needed("percent", 50, 3)).toBe(2);
    expect(needed("percent", 100, 4)).toBe(4);
    expect(needed("any", null, 0)).toBe(0);
  });

  it("decides a level as soon as its rule is met or can no longer be met", () => {
    const rows = (...s: string[]) => s.map((state) => ({ state }));
    expect(levelOutcome(rows("approved", "requested"), "any")).toBe("approved");
    expect(levelOutcome(rows("approved", "requested"), "all")).toBe("pending");
    expect(levelOutcome(rows("rejected", "requested"), "all")).toBe("rejected");
    expect(levelOutcome(rows("rejected", "requested", "requested"), "count", 2)).toBe("pending");
    expect(levelOutcome(rows("rejected", "rejected", "requested"), "count", 2)).toBe("rejected");
    expect(levelOutcome(rows("skipped"), "any")).toBe("skipped");
    expect(levelOutcome(rows("canceled"), "any")).toBeNull();
  });

  it("adds up rounds and rules into the record's approval field", () => {
    const r = (state: string, level = 1, extra: Record<string, unknown> = {}) => ({ state, level, rule: "any", ...extra });
    expect(roundOutcome([r("approved", 1), r("requested", 2)])).toBe("pending");
    expect(roundOutcome([r("approved", 1), r("rejected", 2)])).toBe("rejected");
    expect(aggregate([])).toBe("not_requested");
    // the latest round of a rule counts; one rejected rule outweighs an approved one
    expect(aggregate([r("rejected", 1, { rule_id: "a", round: 1 }), r("approved", 1, { rule_id: "a", round: 2 })])).toBe("approved");
    expect(aggregate([r("approved", 1, { rule_id: "a" }), r("rejected", 1, { rule_id: "b" })])).toBe("rejected");
    expect(aggregate([r("approved", 1, { rule_id: "a" }), r("requested", 1, { rule_id: "b" })])).toBe("requested");
  });

  it("explains what is wrong with a rule's levels", () => {
    const type = (n: string) => ({ manager_id: "user", amount: "int" })[n];
    expect(levelsProblem([], type)).toContain("دست‌کم یک سطح");
    expect(levelsProblem([{ sources: [] }], type)).toContain("منبع");
    expect(levelsProblem([{ sources: [{ kind: "users", users: ["x"] }] }], type)).toContain("افراد");
    expect(levelsProblem([{ sources: [{ kind: "field", field: "amount" }] }], type)).toContain("کاربر یا گروه نیست");
    expect(levelsProblem([{ sources: [{ kind: "owner", of: "ci" }] }], type)).toContain("هنوز در دسترس نیست");
    expect(levelsProblem([{ sources: [{ kind: "manager" }], rule: "percent", threshold: 150 }], type)).toContain("حد نصاب");
    expect(levelsProblem([{ sources: [{ kind: "field", field: "manager_id" }], rule: "count", threshold: 2 }], type)).toBeNull();
  });
});

describe("approvals", () => {
  let e: EngineOrg;
  let P = "";
  let group = "";
  const who: Record<"R" | "M" | "A1" | "A2" | "A3" | "X", { client: Client; userId: string }> = {} as never;
  const id = (k: keyof typeof who) => who[k].userId;
  const ruleIds: string[] = [];
  let unregisterOwner: () => void = () => {};

  const rule = async (kind: string, data: Record<string, unknown>) => {
    const r = (await e.owner.post(`${P}/r/approval_rule`, { name: `قاعدهٔ ${kind}`, table_key: "apv_case", condition: { f: "kind", op: "eq", v: kind }, ...data })).row;
    ruleIds.push(r.id);
    return r;
  };
  /** a purchase request filed by the requester R */
  const file = async (kind: string, data: Record<string, unknown> = {}) => (await who.R.client.post(`${P}/r/apv_case`, { short_description: `خرید ${kind}`, kind, ...data })).row;
  const record = async (recId: string) => (await e.owner.get(`${P}/r/apv_case/${recId}`)).row;
  const rowsOf = (recId: string) =>
    e.db.query<Record<string, any>>(`select * from sm_approvals where org_id = $1 and record_id = $2 and deleted_at is null order by round, level, created_at, id`, [e.org, recId]);
  const rowFor = async (recId: string, k: keyof typeof who) => (await rowsOf(recId)).find((r) => r.approver_id === id(k))!;
  const decide = (k: keyof typeof who, approvalId: string, decision: "approved" | "rejected", comment?: string, status = 200) =>
    who[k].client.post(`${P}/approvals/${approvalId}/decide`, { decision, comment }, status);
  const mine = async (k: keyof typeof who) => (await who[k].client.get(`${P}/approvals/mine`)).approvals as Record<string, any>[];
  const events = async (kind: string, recId: string) => (await outbox(e.db, e.org, kind)).filter((j) => j.payload.id === recId).map((j) => j.payload.data);
  const dueNow = () => e.db.query(`update sm_jobs set run_at = now() - interval '1 second' where org_id = $1 and kind = 'approval.timer' and status = 'queued'`, [e.org]);

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    for (const k of ["R", "M", "A1", "A2", "A3", "X"] as const) who[k] = await e.member("member", `apv-${k.toLowerCase()}@example.com`);
    // requesters and approvers read only their own work records (an approver reads a record through its approval)
    for (const k of ["R", "A1", "A2", "A3", "X"] as const) await e.owner.put(`${P}/access/members/${id(k)}`, { roles: ["requester"], ...(k === "R" ? { manager_id: id("M") } : {}) });
    group = (await e.owner.post(`${P}/r/group`, { name: "کمیتهٔ خرید" })).row.id;
    await e.owner.post(`${P}/access/groups/${group}/members`, { user_ids: [id("A1"), id("A2"), id("A3")] });
    unregisterOwner = registerApproverSource("test_owner", async () => [id("A2")]);
  });

  afterAll(() => unregisterOwner());

  it("asks a rule's approvers when its condition becomes true; one approval is enough (any)", async () => {
    await rule("any", { levels: [{ name: "مالی", sources: [{ kind: "users", users: [id("A1"), id("A2")] }], rule: "any" }] });
    const rec = await file("any");
    expect(rec.approval).toBe("requested");
    const rows = await rowsOf(rec.id);
    expect(rows.map((r) => [r.approver_id, r.state, r.level, r.round, r.source]).sort()).toEqual(
      [[id("A1"), "requested", 1, 1, "users"], [id("A2"), "requested", 1, 1, "users"]].sort(),
    );
    expect(rows[0]).toMatchObject({ level_name: "مالی", record_number: rec.number, record_title: "خرید any", requested_by: id("R") });
    const asked = await events("record.approval_requested", rec.id);
    expect(asked).toHaveLength(1);
    expect([...asked[0].approvers].sort()).toEqual([id("A1"), id("A2")].sort());

    // the approvers read the record once asked; others do not
    await who.A1.client.get(`${P}/r/apv_case/${rec.id}`, 200);
    await who.X.client.get(`${P}/r/apv_case/${rec.id}`, 404);
    const list = await mine("A1");
    expect(list.find((a) => a.record_id === rec.id)).toMatchObject({ can_decide: true, table_label: "درخواست خرید", rule_name: "قاعدهٔ any", state: "requested" });
    // the nav count of «تأییدهای من»
    expect((await who.A1.client.get(`${P}/approvals/mine/count`)).count).toBe(list.filter((a) => a.state === "requested").length);
    expect((await who.X.client.get(`${P}/approvals/mine/count`)).count).toBe(0);

    const a1 = await rowFor(rec.id, "A1");
    const out = await decide("A1", a1.id, "approved", "بودجه دارد");
    expect(out.aggregate).toBe("approved");
    expect((await record(rec.id)).approval).toBe("approved");
    expect((await rowFor(rec.id, "A2")).state).toBe("no_longer_required");
    expect((await rowFor(rec.id, "A1"))).toMatchObject({ state: "approved", decided_by: id("A1"), comments: "بودجه دارد" });
    expect(await events("record.approval_decided", rec.id)).toEqual([expect.objectContaining({ decision: "approved", by: id("A1"), outcome: "approved" })]);
    const journal = await e.owner.get(`${P}/r/apv_case/${rec.id}/journal`);
    expect(journal.entries.some((x: { kind: string; body: string }) => x.kind === "approval" && x.body.includes("تأیید کرد"))).toBe(true);
    // decided: the approver grant keeps the record readable (whoever has or had an approval on it), never writable;
    // the decision cannot be taken twice
    expect((await who.A1.client.get(`${P}/r/apv_case/${rec.id}`, 200)).meta.canWrite).toBe(false);
    await who.X.client.get(`${P}/r/apv_case/${rec.id}`, 404);
    await decide("A1", a1.id, "rejected", "اشتباه شد", 409);
    expect(await mine("A1")).not.toContainEqual(expect.objectContaining({ record_id: rec.id }));
  });

  it("a level of everyone (all) needs every approval; a rejection needs a reason and ends it", async () => {
    await rule("all", { levels: [{ sources: [{ kind: "users", users: [id("A1"), id("A2")] }], rule: "all" }] });
    const rec = await file("all");
    expect((await decide("A1", (await rowFor(rec.id, "A1")).id, "approved")).aggregate).toBe("requested");
    const a2 = await rowFor(rec.id, "A2");
    const noReason = await decide("A2", a2.id, "rejected", "", 400);
    expect(noReason.error.details.fields.comment).toContain("علت رد");
    expect((await decide("A2", a2.id, "rejected", "گران است")).aggregate).toBe("rejected");
    expect((await record(rec.id)).approval).toBe("rejected");
  });

  it("count and percent over the members of a group", async () => {
    await rule("count", { levels: [{ sources: [{ kind: "groups", groups: [group] }], rule: "count", threshold: 2 }] });
    const rec = await file("count");
    const rows = await rowsOf(rec.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.group_id === group && r.source === "groups" && r.rule === "count" && r.threshold === 2)).toBe(true);
    expect((await decide("A1", (await rowFor(rec.id, "A1")).id, "rejected", "نه")).aggregate).toBe("requested");
    expect((await decide("A2", (await rowFor(rec.id, "A2")).id, "approved")).aggregate).toBe("requested");
    expect((await decide("A3", (await rowFor(rec.id, "A3")).id, "approved")).aggregate).toBe("approved");

    await rule("percent", { levels: [{ sources: [{ kind: "groups", groups: [group] }], rule: "percent", threshold: 50 }] });
    const p = await file("percent");
    expect((await decide("A1", (await rowFor(p.id, "A1")).id, "approved")).aggregate).toBe("requested");
    expect((await decide("A3", (await rowFor(p.id, "A3")).id, "approved")).aggregate).toBe("approved");
    expect((await rowFor(p.id, "A2")).state).toBe("no_longer_required");
  });

  it("finds approvers in the record's own fields and in a module's owner source", async () => {
    await rule("fields", { mode: "parallel", levels: [{ sources: [{ kind: "field", field: "approver_user" }] }, { sources: [{ kind: "field", field: "approver_group" }], rule: "all" }] });
    const rec = await file("fields", { approver_user: id("A3"), approver_group: group });
    const rows = await rowsOf(rec.id);
    expect(rows.filter((r) => r.level === 1).map((r) => r.approver_id)).toEqual([id("A3")]);
    expect(rows.filter((r) => r.level === 2).map((r) => r.approver_id).sort()).toEqual([id("A1"), id("A2"), id("A3")].sort());
    expect(rows.every((r) => r.source === "field" && r.state === "requested")).toBe(true);

    // the rule builder offers the owner sources modules registered
    expect((await e.owner.get(`${P}/approvals/sources`)).owners).toContain("test_owner");
    await rule("owner", { levels: [{ sources: [{ kind: "owner", of: "test_owner" }] }] });
    const o = await file("owner");
    expect((await rowsOf(o.id)).map((r) => [r.approver_id, r.source])).toEqual([[id("A2"), "owner"]]);
  });

  it("runs levels one after another (the requester's manager first) or all at once", async () => {
    await rule("seq", { mode: "sequential", levels: [{ name: "مدیر", sources: [{ kind: "manager" }] }, { name: "مالی", sources: [{ kind: "users", users: [id("A3")] }] }] });
    const rec = await file("seq");
    let rows = await rowsOf(rec.id);
    expect(rows.map((r) => [r.level, r.approver_id, r.state, r.source])).toEqual([[1, id("M"), "requested", "manager"], [2, id("A3"), "waiting", "users"]]);
    expect(rows[1].requested_at).toBeNull();
    // the second level is not anyone's turn yet
    expect(await mine("A3")).not.toContainEqual(expect.objectContaining({ record_id: rec.id }));
    const early = await decide("A3", rows[1].id, "approved", undefined, 409);
    expect(early.error.message).toContain("نوبت");
    expect((await decide("M", rows[0].id, "approved")).aggregate).toBe("requested");
    rows = await rowsOf(rec.id);
    expect(rows[1].state).toBe("requested");
    expect((await events("record.approval_requested", rec.id)).map((d) => d.level)).toEqual([1, 2]);
    expect(await mine("A3")).toContainEqual(expect.objectContaining({ record_id: rec.id, can_decide: true }));
    expect((await decide("A3", rows[1].id, "approved")).aggregate).toBe("approved");

    await rule("par", { mode: "parallel", levels: [{ sources: [{ kind: "manager" }] }, { sources: [{ kind: "users", users: [id("A3")] }] }] });
    const par = await file("par");
    expect((await rowsOf(par.id)).map((r) => r.state)).toEqual(["requested", "requested"]);
    const pr = await rowsOf(par.id);
    // one rejected level rejects the round and withdraws the other level
    expect((await decide("A3", pr[1].id, "rejected", "بودجه نیست")).aggregate).toBe("rejected");
    expect((await rowsOf(par.id))[0].state).toBe("no_longer_required");
  });

  it("separation of duties: the requester and the assignee never approve unless the rule allows it", async () => {
    await rule("sod", { levels: [{ sources: [{ kind: "users", users: [id("R"), id("A1")] }] }] });
    const rec = await file("sod");
    expect((await rowsOf(rec.id)).map((r) => r.approver_id)).toEqual([id("A1")]);

    // nobody but the requester: their manager is asked instead
    await rule("sod-only", { levels: [{ sources: [{ kind: "users", users: [id("R")] }] }] });
    const only = await file("sod-only");
    expect((await rowsOf(only.id)).map((r) => [r.approver_id, r.source])).toEqual([[id("M"), "manager"]]);

    // the assignee of the record is left out as well
    await rule("sod-assigned", { levels: [{ sources: [{ kind: "users", users: [id("A1"), id("A2")] }] }] });
    const assigned = (await e.owner.post(`${P}/r/apv_case`, { short_description: "خرید ارجاعی", kind: "sod-assigned", caller_id: id("R"), assigned_to: id("A1") })).row;
    expect((await rowsOf(assigned.id)).map((r) => r.approver_id)).toEqual([id("A2")]);
    // … and an approver who becomes the assignee after the request may not decide it
    await e.owner.patch(`${P}/r/apv_case/${assigned.id}`, { assigned_to: id("A2") });
    const refused = await decide("A2", (await rowFor(assigned.id, "A2")).id, "approved", undefined, 403);
    expect(refused.error.message).toContain("نمی‌توانید");

    // a rule that allows it asks the requester too
    await rule("sod-self", { allow_self_approval: true, levels: [{ sources: [{ kind: "users", users: [id("R"), id("A1")] }] }] });
    const self = await file("sod-self");
    expect((await rowsOf(self.id)).map((r) => r.approver_id).sort()).toEqual([id("R"), id("A1")].sort());
    expect((await decide("R", (await rowFor(self.id, "R")).id, "approved")).aggregate).toBe("approved");
  });

  it("delegation: an absent approver's delegate is asked, or decides on their behalf", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 86400_000).toISOString();
    // naming a delegate needs seeing colleagues (the directory): staff roles do, a requester-only member does not
    for (const k of ["A1", "A3"] as const) await e.owner.put(`${P}/access/members/${id(k)}`, { roles: ["requester", "hr_agent"] });
    const blind = await who.X.client.post(`${P}/r/delegation`, { from_user: id("X"), to_user: id("A2"), starts_at: past, scopes: ["approvals"] }, 403);
    expect(blind.error.message).toContain("جانشین");
    // the checks of a delegation
    const self = await who.A1.client.post(`${P}/r/delegation`, { from_user: id("A1"), to_user: id("A1"), starts_at: past, scopes: ["approvals"] }, 400);
    expect(self.error.details.fields.to_user).toBeTruthy();
    const backwards = await who.A1.client.post(`${P}/r/delegation`, { from_user: id("A1"), to_user: id("A2"), starts_at: future, ends_at: past, scopes: ["approvals"] }, 400);
    expect(backwards.error.details.fields.ends_at).toBeTruthy();
    await who.X.client.post(`${P}/r/delegation`, { from_user: id("A1"), to_user: id("X"), starts_at: past, scopes: ["approvals"] }, 403);

    const d1 = (await who.A1.client.post(`${P}/r/delegation`, { from_user: id("A1"), to_user: id("A2"), starts_at: past, ends_at: future, scopes: ["approvals"], reason: "مرخصی" })).row;
    await rule("deleg", { levels: [{ sources: [{ kind: "users", users: [id("A1")] }] }] });
    const rec = await file("deleg");
    expect((await rowsOf(rec.id)).map((r) => [r.approver_id, r.delegated_from])).toEqual([[id("A2"), id("A1")]]);

    // a delegation that starts after the request: the delegate decides on the approver's behalf
    await rule("deleg-late", { levels: [{ sources: [{ kind: "users", users: [id("A3")] }] }] });
    const late = await file("deleg-late");
    const d2 = (await who.A3.client.post(`${P}/r/delegation`, { from_user: id("A3"), to_user: id("A2"), starts_at: past, ends_at: future, scopes: ["approvals"] })).row;
    const forA2 = await who.A2.client.get(`${P}/approvals/mine`);
    expect(forA2.delegators).toContain(id("A3"));
    expect(forA2.approvals).toContainEqual(expect.objectContaining({ record_id: late.id, on_behalf_of: id("A3"), can_decide: true }));
    // the delegate also reads the record while it waits
    await who.A2.client.get(`${P}/r/apv_case/${late.id}`, 200);
    const a3 = await rowFor(late.id, "A3");
    await decide("A2", a3.id, "approved", "به جای همکار");
    expect((await rowFor(late.id, "A3"))).toMatchObject({ state: "approved", decided_by: id("A2"), delegated_from: id("A3") });
    expect(await events("record.approval_decided", late.id)).toEqual([expect.objectContaining({ by: id("A2"), on_behalf_of: id("A3") })]);

    // delegations of other scopes do not count; ended ones neither
    await who.A1.client.patch(`${P}/r/delegation/${d1.id}`, { active: false });
    await who.A3.client.patch(`${P}/r/delegation/${d2.id}`, { scopes: ["notifications"] });
    const after = await file("deleg");
    expect((await rowsOf(after.id)).map((r) => [r.approver_id, r.delegated_from])).toEqual([[id("A1"), null]]);
    expect((await who.A2.client.get(`${P}/approvals/mine`)).delegators).toEqual([]);
  });

  it("reminds and expires by job (reject, or approve when the rule says so)", async () => {
    await rule("expire", { remind_every: 600, expire_after: 3600, expire_action: "reject", levels: [{ sources: [{ kind: "users", users: [id("A1")] }] }] });
    const rec = await file("expire");
    const [row] = await rowsOf(rec.id);
    expect(Math.abs(Date.parse(row.due_at) - (Date.parse(row.requested_at) + 3600_000))).toBeLessThan(2000);
    const jobs = await e.db.query<{ n: number }>(`select count(*)::int as n from sm_jobs where org_id = $1 and kind = 'approval.timer' and status = 'queued' and payload->>'id' = $2`, [e.org, rec.id]);
    expect(jobs[0].n).toBe(1);

    // eleven minutes later: one reminder
    await e.db.query(`update sm_approvals set requested_at = requested_at - interval '11 minutes' where id = $1`, [row.id]);
    await dueNow();
    await tick(e.cfg);
    const reminders = (await events("record.approval_requested", rec.id)).filter((d) => d.reminder);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].approvers).toEqual([id("A1")]);
    expect((await rowsOf(rec.id))[0].reminded_at).toBeTruthy();
    await dueNow();
    await tick(e.cfg);
    expect((await events("record.approval_requested", rec.id)).filter((d) => d.reminder)).toHaveLength(1);

    // past its due time: rejected by the clock
    await e.db.query(`update sm_approvals set due_at = now() - interval '1 minute' where id = $1`, [row.id]);
    await dueNow();
    await tick(e.cfg);
    expect((await rowsOf(rec.id))[0]).toMatchObject({ state: "rejected", comments: "مهلت تأیید به پایان رسید" });
    expect((await record(rec.id)).approval).toBe("rejected");
    expect(await events("record.approval_decided", rec.id)).toEqual([expect.objectContaining({ decision: "expired", outcome: "rejected" })]);

    await rule("expire-ok", { expire_after: 60, expire_action: "approve", levels: [{ sources: [{ kind: "users", users: [id("A1")] }] }] });
    const ok = await file("expire-ok");
    await e.db.query(`update sm_approvals set due_at = now() - interval '1 second' where record_id = $1`, [ok.id]);
    await dueNow();
    await tick(e.cfg);
    expect((await record(ok.id)).approval).toBe("approved");
  });

  it("approves by itself when the auto-approve condition holds", async () => {
    await rule("auto", { auto_approve: { f: "amount", op: "lt", v: 1000 }, levels: [{ sources: [{ kind: "users", users: [id("A1")] }] }] });
    const small = await file("auto", { amount: 500 });
    expect(small.approval).toBe("approved");
    const rows = await rowsOf(small.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "approved", approver_id: null });
    expect(rows[0].comments).toContain("تأیید خودکار");
    const big = await file("auto", { amount: 5000 });
    expect(big.approval).toBe("requested");
  });

  it("asks again only when the condition becomes true again, and withdraws open approvals of a done record", async () => {
    await rule("again", { levels: [{ sources: [{ kind: "users", users: [id("A1")] }] }] });
    const rec = await file("again");
    // a change that keeps the condition true asks nobody again
    await e.owner.patch(`${P}/r/apv_case/${rec.id}`, { description: "جزئیات بیشتر" });
    expect(await rowsOf(rec.id)).toHaveLength(1);
    await e.owner.post(`${P}/r/apv_case/${rec.id}/transition`, { to: "canceled", data: { close_notes: "دیگر لازم نیست" } });
    expect((await rowsOf(rec.id))[0].state).toBe("no_longer_required");
    expect(await mine("A1")).not.toContainEqual(expect.objectContaining({ record_id: rec.id }));

    // the condition stops holding and holds again: a second round
    const two = await file("again");
    await decide("A1", (await rowFor(two.id, "A1")).id, "rejected", "نه");
    await e.owner.patch(`${P}/r/apv_case/${two.id}`, { kind: "other" });
    await e.owner.patch(`${P}/r/apv_case/${two.id}`, { kind: "again" });
    const rows = await rowsOf(two.id);
    expect(rows.map((r) => [r.round, r.state])).toEqual([[1, "rejected"], [2, "requested"]]);
    expect((await record(two.id)).approval).toBe("requested");
  });

  it("ad-hoc requests from the record page, withdrawal, and the record's approvals", async () => {
    const rec = (await e.owner.post(`${P}/r/apv_case`, { short_description: "خرید موردی", caller_id: id("R") })).row;
    expect(rec.approval).toBe("not_requested");
    const asked = await e.owner.post(`${P}/approvals/record/apv_case/${rec.id}/request`, { users: [id("A1"), id("A2")], rule: "all", comment: "لطفاً بررسی کنید", expire_hours: 24 });
    expect(asked.aggregate).toBe("requested");
    expect(asked.approvals).toHaveLength(2);
    expect(asked.approvals[0]).toMatchObject({ rule_id: null, rule: "all", comments: "لطفاً بررسی کنید" });
    expect((await events("record.approval_requested", rec.id))[0]).toMatchObject({ adhoc: true });
    await e.owner.post(`${P}/approvals/record/apv_case/${rec.id}/request`, { users: [id("A3")] }, 409);
    // the requester themselves cannot be asked alone
    const own = (await e.owner.post(`${P}/r/apv_case`, { short_description: "خرید دوم", caller_id: id("R") })).row;
    const nobody = await e.owner.post(`${P}/approvals/record/apv_case/${own.id}/request`, { users: [id("R"), e.ownerId] }, 400);
    expect(nobody.error.message).toContain("هیچ‌یک");
    // people who may not change the record cannot ask
    await who.X.client.post(`${P}/approvals/record/apv_case/${rec.id}/request`, { users: [id("A1")] }, 404);

    const view = await e.owner.get(`${P}/approvals/record/apv_case/${rec.id}`);
    expect(view).toMatchObject({ aggregate: "requested", can_request: true });
    expect(view.approvals.map((a: Record<string, any>) => a.rule_name)).toEqual(["درخواست موردی", "درخواست موردی"]);
    expect(view.display[id("A1")]).toBeTruthy();
    await who.X.client.get(`${P}/approvals/record/apv_case/${rec.id}`, 404);

    const withdrawn = await e.owner.post(`${P}/approvals/record/apv_case/${rec.id}/cancel`);
    expect(withdrawn).toEqual({ canceled: 2, aggregate: "not_requested" });
    expect((await rowsOf(rec.id)).map((r) => r.state)).toEqual(["canceled", "canceled"]);
    expect((await record(rec.id)).approval).toBe("not_requested");
  });

  it("decides in bulk, each approval on its own", async () => {
    await rule("bulk", { levels: [{ sources: [{ kind: "users", users: [id("A1")] }] }] });
    const one = await file("bulk");
    const two = await file("bulk");
    const ids = [(await rowFor(one.id, "A1")).id, (await rowFor(two.id, "A1")).id, "00000000-0000-4000-8000-000000000000"];
    const out = await who.A1.client.post(`${P}/approvals/decide`, { ids, decision: "approved", comment: "یک‌جا" });
    expect(out.done).toBe(2);
    expect(out.failed).toEqual([{ id: ids[2], message: "این تأیید پیدا نشد" }]);
    expect((await record(one.id)).approval).toBe("approved");
    expect((await record(two.id)).approval).toBe("approved");
    // someone else's approvals are not theirs to decide
    const three = await file("bulk");
    const other = await who.A2.client.post(`${P}/approvals/decide`, { ids: [(await rowFor(three.id, "A1")).id], decision: "approved" });
    expect(other).toMatchObject({ done: 0, failed: [expect.objectContaining({ message: "این تأیید پیدا نشد" })] });
    const decided = await who.A1.client.get(`${P}/approvals/mine?scope=decided`);
    expect(decided.approvals.filter((a: Record<string, any>) => a.record_id === one.id || a.record_id === two.id)).toHaveLength(2);
  });

  it("keeps approvals and rules consistent", async () => {
    await e.owner.post(`${P}/r/approval`, { table_key: "apv_case", record_id: "00000000-0000-4000-8000-000000000000", state: "approved" }, 403);
    // an approver reads their approval rows but changes them only by deciding
    const theirs = (await e.db.query<{ id: string }>(`select id from sm_approvals where org_id = $1 and approver_id = $2 limit 1`, [e.org, id("A1")]))[0];
    await who.A1.client.get(`${P}/r/approval/${theirs.id}`, 200);
    await who.A1.client.patch(`${P}/r/approval/${theirs.id}`, { state: "approved" }, 403);
    await who.X.client.get(`${P}/r/approval/${theirs.id}`, 404);
    const empty = await e.owner.post(`${P}/r/approval_rule`, { name: "بی‌سطح", table_key: "apv_case", levels: [] }, 400);
    expect(empty.error.details.fields.levels).toContain("دست‌کم یک سطح");
    const notUser = await e.owner.post(`${P}/r/approval_rule`, { name: "فیلد عددی", table_key: "apv_case", levels: [{ sources: [{ kind: "field", field: "amount" }] }] }, 400);
    expect(notUser.error.details.fields.levels).toContain("کاربر یا گروه نیست");
    const noTable = await e.owner.post(`${P}/r/approval_rule`, { name: "بی‌جدول", table_key: "nope", levels: [{ sources: [{ kind: "manager" }] }] }, 400);
    expect(noTable.error.details.fields.table_key).toBeTruthy();
    await e.owner.post(`${P}/r/approval_rule`, { name: "روی خودش", table_key: "approval", levels: [{ sources: [{ kind: "manager" }] }] }, 400);
    // a rule created without levels (the form hides them behind the builder) asks the requester's manager
    const plain = (await e.owner.post(`${P}/r/approval_rule`, { name: "بی‌سطح در فرم", table_key: "apv_case", active: false })).row;
    expect(plain.levels).toEqual(DEFAULT_LEVELS);
    // an inactive rule asks nobody
    for (const r of ruleIds) await e.owner.patch(`${P}/r/approval_rule/${r}`, { active: false });
    const quiet = await file("any");
    expect(quiet.approval).toBe("not_requested");
    expect(await rowsOf(quiet.id)).toHaveLength(0);
  });
});
