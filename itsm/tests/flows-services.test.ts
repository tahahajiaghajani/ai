// Flows wired to the services built next to them (docs/spec/SERVICES.md, docs/spec/services/flows.md §8):
// «ارسال اعلان» through the notification service (notifyPeople: delivered under each recipient's access),
// «درخواست تأیید» through the approvals service (an ad-hoc round of the record; the decision wakes the run through
// record.approval_decided → resumeFlowWait; withdrawals and canceled runs; the built-in approval for runs without a
// record) and «به وقت کاری» counted on the organisation's calendar and its Iranian holidays.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { E, N, flowsKit, graph, line, trail, type FlowsKit } from "./flows-helpers";
import { builtinStepHandler, serviceInstalled, stepHandler } from "@server/modules/flows";
import { notifyStep } from "@server/modules/notify";
import { approvalStep, roundKey, roundResult, seedCalendars, slaBusinessClock } from "@server/modules/sla";

type Who = { client: Client; userId: string };

describe("flows on the services", () => {
  let o: EngineOrg;
  let k: FlowsKit;
  let P = "";
  let agent: Who; // legacy member: reads every «کار»
  let caller: Who;
  let req: Who; // requester role: only their own records
  let watcher: Who; // an observer of the group
  const A: Who[] = [];
  let group = "";

  const test = async (flow: string, rec?: { id: string }) =>
    (await o.owner.post(`${k.P}/flows/${flow}/test`, rec ? { table: "todo", record_id: rec.id } : {})).run.id as string;
  const settle = async (runId: string) => {
    await k.drain();
    return k.detail(runId);
  };
  const inbox = async (w: Who, recordId: string) =>
    ((await w.client.get(`${P}/notify/inbox`)).items as { record_id: string; title: string; body: string; event: string }[]).filter((x) => x.record_id === recordId);
  const approvals = (recordId: string) =>
    o.db.query<Record<string, any>>(`select * from sm_approvals where org_id = $1 and record_id = $2 and deleted_at is null order by round, level, id`, [o.org, recordId]);
  const decide = (w: Who, id: string, decision: "approved" | "rejected", comment?: string) => w.client.post(`${P}/approvals/${id}/decide`, { decision, comment });

  beforeAll(async () => {
    o = await engineOrg();
    k = flowsKit(o);
    P = k.P;
    agent = await o.member("member", "flow-agent@example.com");
    caller = await o.member("member", "flow-caller@example.com");
    req = await o.member("member", "flow-req@example.com");
    watcher = await o.member("member", "flow-watcher@example.com");
    for (let i = 1; i <= 3; i++) A.push(await o.member("member", `flow-a${i}@example.com`));
    await o.owner.put(`${P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
    group = (await o.owner.post(`${P}/r/group`, { name: "کمیتهٔ تأیید" })).row.id;
    await o.owner.post(`${P}/access/groups/${group}/members`, { user_ids: A.map((a) => a.userId) });
    await o.owner.post(`${P}/access/groups/${group}/members`, { user_ids: [watcher.userId], kind: "observer" });
  });

  it("installs the services' handlers over the engine's stand-ins", () => {
    expect(stepHandler("notify")).toBe(notifyStep);
    expect(stepHandler("approval")).toBe(approvalStep);
    expect(serviceInstalled("notify") && serviceInstalled("approval")).toBe(true);
    expect(builtinStepHandler("approval")).not.toBe(approvalStep);
  });

  describe("«ارسال اعلان» → notifyPeople", () => {
    it("notifies people, the record's user fields and groups; whoever cannot read the record gets nothing", async () => {
      const flow = await k.flow(
        {},
        line(N("n", "notify", { to: { users: [agent.userId, req.userId], fields: ["caller_id"], groups: [group] }, subject: "درخواست {{trigger.record.number}}", body: "شرح: {{trigger.record.short_description}}" })),
      );
      const t = await k.todo({ short_description: "چاپگر خراب", caller_id: caller.userId });
      const d = await settle(await test(flow, t));
      expect(d.run.state).toBe("completed");
      const out = d.steps.find((s: any) => s.node_id === "n").output;
      expect(out.sent).toBe(true);
      expect([...out.recipients].sort()).toEqual([agent, req, caller, watcher, ...A].map((w) => w.userId).sort());
      expect(out.count).toBe(7);
      expect(out.$log).toBeUndefined();
      // delivered in the inbox as the service renders it
      const [item] = await inbox(agent, t.id);
      expect(item).toMatchObject({ event: "custom", title: `درخواست ${t.number}` });
      expect(item.body).toContain("شرح: چاپگر خراب");
      expect(await inbox(caller, t.id)).toHaveLength(1);
      expect(await inbox(watcher, t.id)).toHaveLength(1);
      // the requester cannot read the owner's record: nothing reaches them, and the log says why
      expect(await inbox(req, t.id)).toHaveLength(0);
      const log = await o.db.query<{ recipient_id: string; status: string; reason: string | null; rule_key: string }>(
        `select recipient_id, status, reason, rule_key from sm_notification_log where org_id = $1 and record_id = $2 and channel = 'in_app'`,
        [o.org, t.id],
      );
      expect(log.find((l) => l.recipient_id === req.userId)).toMatchObject({ status: "skipped", reason: "no_access" });
      expect(log.find((l) => l.recipient_id === agent.userId)).toMatchObject({ status: "sent" });
      expect(log[0].rule_key).toMatch(/^direct:گردش‌کار «/);
    });

    it("needs a record to notify about", async () => {
      const flow = await k.flow({}, line(N("n", "notify", { to: { users: [agent.userId] }, subject: "سلام" })));
      const d = await settle(await test(flow));
      expect(d.run.state).toBe("failed");
      expect(d.run.error).toMatch(/رکورد/);
    });
  });

  describe("«درخواست تأیید» → the approvals service", () => {
    const approvalFlow = (config: Record<string, unknown>) =>
      k.flow(
        {},
        graph(
          [
            N("a", "approval", { title: "تأیید {{trigger.record.short_description}}", message: "لطفاً بررسی کنید", ...config }),
            N("yes", "update_record", { values: { priority: "1" } }),
            N("no", "add_comment", { body: "رد شد: {{steps.a.output.comment}}" }),
            N("err", "set_vars", { vars: [{ name: "why", value: "{{steps.a.error}}" }] }),
          ],
          [E("trigger", "a"), E("a", "yes", "approved"), E("a", "no", "rejected"), E("a", "err", "error")],
        ),
      );

    it("asks for an ad-hoc round of the record and resumes when the rule (count) is met", async () => {
      const flow = await approvalFlow({ approvers: { users: [A[0].userId, A[1].userId, A[2].userId] }, rule: "count", threshold: 2 });
      const t = await k.todo({ short_description: "خرید لپ‌تاپ" });
      const runId = await test(flow, t);
      let d = await settle(runId);
      expect(d.run.state).toBe("waiting");
      const rows = await approvals(t.id);
      expect(rows.map((r) => [r.state, r.rule_id, r.rule, r.threshold, r.level_name, r.comments])).toEqual(
        A.map(() => ["requested", null, "count", 2, "تأیید خرید لپ‌تاپ", "لطفاً بررسی کنید"]),
      );
      expect(d.waits[0]).toMatchObject({ kind: "approval", can_decide: false });
      const w = await o.db.one<{ key: string }>(`select key from sm_flow_waits where run_id = $1`, [runId]);
      expect(w!.key).toBe(roundKey(rows));
      expect((await o.owner.get(`${P}/r/todo/${t.id}`)).row.approval).toBe("requested");
      // the approvers see it in «تأییدهای من»
      expect(((await A[0].client.get(`${P}/approvals/mine`)).approvals as any[]).some((x) => x.record_id === t.id && x.can_decide)).toBe(true);

      await decide(A[0], rows.find((r) => r.approver_id === A[0].userId)!.id, "approved");
      d = await settle(runId);
      expect(d.run.state).toBe("waiting");
      await decide(A[2], rows.find((r) => r.approver_id === A[2].userId)!.id, "approved", "موافقم");
      d = await settle(runId);
      expect(d.run.state).toBe("completed");
      expect(trail(d)).toContain("a:completed:approved");
      const out = d.steps.find((s: any) => s.node_id === "a" && s.status === "completed").output;
      expect(out).toMatchObject({ decision: "approved", by: A[2].userId, comment: "موافقم" });
      // a decision without a comment does not echo the request's message
      expect(out.decisions.map((x: any) => [x.by, x.decision, x.comment])).toEqual([[A[0].userId, "approved", ""], [A[2].userId, "approved", "موافقم"]]);
      const rec = (await o.owner.get(`${P}/r/todo/${t.id}`)).row;
      expect(rec.priority).toBe("1");
      expect(rec.approval).toBe("approved");
    });

    it("takes the rejected path when the round is rejected (all), with the approver's comment", async () => {
      const flow = await approvalFlow({ approvers: { groups: [group] }, rule: "all" });
      const t = await k.todo({ short_description: "سفر کاری" });
      const runId = await test(flow, t);
      await settle(runId);
      const rows = await approvals(t.id);
      // the group's members (not its observer) are asked
      expect(rows.map((r) => r.approver_id).sort()).toEqual(A.map((a) => a.userId).sort());
      expect(rows.every((r) => r.group_id === group && r.source === "groups")).toBe(true);
      await decide(A[1], rows.find((r) => r.approver_id === A[1].userId)!.id, "rejected", "بودجه نیست");
      const d = await settle(runId);
      expect(d.run.state).toBe("completed");
      expect(trail(d)).toContain("a:completed:rejected");
      const j = await o.owner.get(`${P}/r/todo/${t.id}/journal`);
      expect(j.entries.some((e: any) => e.body === "رد شد: بودجه نیست")).toBe(true);
      expect((await approvals(t.id)).filter((r) => r.state === "no_longer_required")).toHaveLength(2);
    });

    it("fails the step (error path) when the round is withdrawn before a decision", async () => {
      const flow = await approvalFlow({ approvers: { users: [A[0].userId, A[1].userId] }, rule: "any" });
      const t = await k.todo({ short_description: "پس گرفتن" });
      const runId = await test(flow, t);
      await settle(runId);
      await o.owner.post(`${P}/approvals/record/todo/${t.id}/cancel`, {});
      const d = await settle(runId);
      expect(d.run.state).toBe("completed");
      expect(trail(d)).toContain("a:failed:error");
      expect(d.context.vars.why).toMatch(/پس گرفته شد/);
    });

    it("withdraws only its own round when its run is canceled", async () => {
      const flow = await approvalFlow({ approvers: { users: [A[0].userId] } });
      const t = await k.todo({ short_description: "لغو اجرا" });
      const runId = await test(flow, t);
      await settle(runId);
      expect((await approvals(t.id)).map((r) => r.state)).toEqual(["requested"]);
      await o.owner.post(`${k.P}/flows/runs/${runId}/cancel`);
      expect((await k.detail(runId)).run.state).toBe("canceled");
      expect((await approvals(t.id)).map((r) => r.state)).toEqual(["canceled"]);
      expect((await o.owner.get(`${P}/r/todo/${t.id}`)).row.approval).toBe("not_requested");
      // the record can be asked again (the round is closed)
      const again = await test(flow, t);
      await settle(again);
      expect((await approvals(t.id)).map((r) => [r.round, r.state])).toEqual([[1, "canceled"], [2, "requested"]]);
      await decide(A[0], (await approvals(t.id))[1].id, "approved");
      expect((await settle(again)).run.state).toBe("completed");
    });

    it("errors when an open request of the record is still pending, and keeps the built-in approval for runs without a record", async () => {
      const t = await k.todo({ short_description: "دو درخواست" });
      await o.owner.post(`${P}/approvals/record/todo/${t.id}/request`, { users: [A[0].userId] });
      const flow = await approvalFlow({ approvers: { users: [A[1].userId] } });
      const d = await settle(await test(flow, t));
      expect(trail(d)).toContain("a:failed:error");
      expect(d.context.vars.why).toMatch(/هنوز باز است/);

      const loose = await approvalFlow({ approvers: { users: [A[1].userId] }, rule: "count", threshold: 1 });
      const runId = await test(loose);
      const w = (await settle(runId)).waits[0];
      expect(w).toMatchObject({ kind: "approval" });
      expect(w.data.rule).toBe("count");
      expect((await A[1].client.post(`${k.P}/flows/waits/${w.id}/decide`, { decision: "approve" })).final).toBe("approved");
      const done = await settle(runId);
      expect(trail(done)).toContain("a:completed:approved");
    });

    it("re-reads its round every hour: a decision that came without its event still wakes the run", async () => {
      const flow = await approvalFlow({ approvers: { users: [A[0].userId] } });
      const t = await k.todo({ short_description: "بی‌رویداد" });
      const runId = await test(flow, t);
      const w = (await settle(runId)).waits[0];
      expect(Date.parse(w.due_at) - Date.now()).toBeGreaterThan(3_500_000);
      // as the Windows app applies a pulled row: the row changes, no event is raised here
      const [row] = await approvals(t.id);
      await o.db.query(`update sm_approvals set state = 'approved', decided_by = $2, decided_at = now() where id = $1`, [row.id, A[0].userId]);
      expect((await settle(runId)).run.state).toBe("waiting");
      await k.fireTimers();
      const d = await settle(runId);
      expect(d.run.state).toBe("completed");
      expect(trail(d)).toContain("a:completed:approved");
      expect(d.steps.find((s: any) => s.node_id === "a" && s.status === "completed").output.by).toBe(A[0].userId);
    });

    it("adds a round's rows up for the waiting flow", () => {
      const r = (state: string, extra: Record<string, unknown> = {}) => ({ id: `${state}-${Math.random()}`, state, level: 1, rule: "any", threshold: null, ...extra });
      expect(roundResult([r("requested"), r("requested")])).toBeNull();
      expect(roundResult([r("approved", { decided_by: "u1", comments: "خوب" }), r("no_longer_required")])).toMatchObject({ port: "approved", by: "u1", comment: "خوب" });
      expect(roundResult([r("rejected", { rule: "all" }), r("no_longer_required", { rule: "all" })])).toMatchObject({ port: "rejected" });
      // withdrawn before the rule was met: not an approval, even when the rows left would count as one
      expect(roundResult([r("approved", { rule: "count", threshold: 2 }), r("no_longer_required", { rule: "count", threshold: 2 })])).toMatchObject({ port: "error", decision: "withdrawn" });
      expect(roundResult([r("canceled"), r("canceled")])).toMatchObject({ port: "error" });
      expect(roundKey([{ id: "b" }, { id: "a" }])).toBe("approval:a");
    });
  });

  describe("«به وقت کاری» → the organisation's calendar", () => {
    beforeAll(async () => {
      await seedCalendars(o.cfg, o.org, { years: [1404, 1405] });
    });

    it("adds working hours over the week, the weekend and Nowruz", async () => {
      // Wednesday 27 Esfand 1404, 15:00 Tehran: 1 h left that day, 4 h on Thursday, Friday off, 1–4 Farvardin are
      // holidays, so the sixth hour ends on Wednesday 5 Farvardin 1405 at 09:00
      const from = Date.parse("2026-03-18T15:00:00+03:30");
      const due = await slaBusinessClock.add({ cfg: o.cfg, orgId: o.org, from, ms: 6 * 3_600_000 });
      expect(new Date(due).toISOString()).toBe(new Date("2026-03-25T09:00:00+03:30").toISOString());
      // the 24 × 7 calendar names its own
      const cals = (await o.owner.get(`${P}/r/calendar`)).rows as { id: string; name: string }[];
      const always = cals.find((c) => c.name === "شبانه‌روزی")!;
      expect(await slaBusinessClock.add({ cfg: o.cfg, orgId: o.org, from, ms: 6 * 3_600_000, calendarId: always.id })).toBe(from + 6 * 3_600_000);
    });

    it("is what «انتظار زمانی» asks when it counts business time", async () => {
      const flow = await k.flow({}, line(N("w", "wait_duration", { duration: { amount: 3, unit: "hour" }, business: true })));
      const t0 = Date.now();
      const lo = await slaBusinessClock.add({ cfg: o.cfg, orgId: o.org, from: t0, ms: 3 * 3_600_000 });
      const runId = await test(flow);
      const d = await settle(runId);
      const hi = await slaBusinessClock.add({ cfg: o.cfg, orgId: o.org, from: Date.now(), ms: 3 * 3_600_000 });
      expect(d.run.state).toBe("waiting");
      const step = d.steps.find((s: any) => s.node_id === "w");
      expect(step.output.$log ?? []).toEqual([]);
      const due = Date.parse(d.context.steps.w.output.due_at);
      expect(due).toBeGreaterThanOrEqual(lo);
      expect(due).toBeLessThanOrEqual(hi);
    });
  });
});
