// The flow executor (src/server/modules/flows): every node type, waits that resume through the job queue (timers,
// record events, results), approvals inside flows (the built-in stand-in and a registered approvals service),
// error paths, subflows, the endless-loop and endless-chain guards, the run identity, versions kept by running runs,
// cancelling, and the step registry the notification / AI services plug into.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { E, N, flowsKit, graph, line, trail, type FlowsKit } from "./flows-helpers";
import { registerFlowSkill, registerFlowStepHandler, resumeFlowWait, setFlowBusinessClock } from "@server/modules/flows";

describe("flow executor", () => {
  let o: EngineOrg;
  let k: FlowsKit;
  const offs: (() => void)[] = [];
  afterEach(() => {
    while (offs.length) offs.pop()!();
  });
  beforeAll(async () => {
    o = await engineOrg();
    k = flowsKit(o);
  });
  const test = async (flow: string, rec?: { id: string }, extra: Record<string, unknown> = {}) =>
    (await o.owner.post(`${k.P}/flows/${flow}/test`, { ...(rec ? { table: "todo", record_id: rec.id } : {}), ...extra })).run.id as string;
  const settle = async (runId: string) => {
    await k.drain();
    return k.detail(runId);
  };

  it("starts a published flow on a record event, reads the record as the triggering member and writes it", async () => {
    const flow = await k.live(
      { trigger: "record", trigger_events: ["created"] },
      line(N("u", "update_record", { values: { priority: "1", description: "از {{trigger.record.short_description}} ({{trigger.record.$labels.state}})" } })),
    );
    const t = await k.todo({ short_description: "چاپگر" });
    await k.drain();
    const row = (await o.owner.get(`${k.P}/r/todo/${t.id}`)).row;
    expect(row.priority).toBe("1");
    expect(row.description).toBe("از چاپگر (جدید)");
    const [run] = await k.runs(flow);
    expect(run.state).toBe("completed");
    expect(run.trigger_kind).toBe("record");
    expect(run.actor_id).toBe(o.ownerId);
    const d = await k.detail(run.id);
    expect(trail(d)).toEqual(["trigger:completed:out", "u:completed:out"]);
    expect(d.context.trigger.event).toBe("created");
    expect(d.steps[1].output.record.priority).toBe("1");
    // the history of the record names the member the run acted as
    const h = await o.owner.get(`${k.P}/r/todo/${t.id}/history`);
    expect(h.entries.find((e: any) => e.field === "priority" && e.new === "1").actor).toBe(o.ownerId);
    await k.activate(flow, false);
  });

  it("matches the trigger's events, changed fields and condition", async () => {
    const flow = await k.live(
      { trigger: "record", trigger_events: ["updated"], trigger_fields: ["urgency"], trigger_condition: { f: "impact", op: "eq", v: "1" } },
      line(N("c", "add_comment", { body: "تغییر فوریت" })),
    );
    const t = await k.todo({ impact: "1" });
    await o.owner.patch(`${k.P}/r/todo/${t.id}`, { description: "بی‌ربط" });
    await k.drain();
    expect(await k.runs(flow)).toHaveLength(0);
    await o.owner.patch(`${k.P}/r/todo/${t.id}`, { urgency: "1" });
    await k.drain();
    expect(await k.runs(flow)).toHaveLength(1);
    const other = await k.todo({ impact: "3" });
    await o.owner.patch(`${k.P}/r/todo/${other.id}`, { urgency: "1" });
    await k.drain();
    expect(await k.runs(flow)).toHaveLength(1);
    await k.activate(flow, false);
  });

  it("creates records and passes their outputs to later steps", async () => {
    const flow = await k.flow(
      {},
      line(
        N("c", "create_record", { table: "todo", values: { short_description: "زیرکار {{trigger.record.number}}", parent_id: "{{trigger.record.id}}" } }),
        N("u", "update_record", { values: { description: "ساخته شد: {{steps.c.output.number}}" } }),
        N("v", "set_vars", { vars: [{ name: "child", value: "{{steps.c.output.id}}" }] }),
      ),
    );
    const t = await k.todo();
    const d = await settle(await test(flow, t));
    expect(d.run.state).toBe("completed");
    const child = d.context.vars.child;
    const childRow = (await o.owner.get(`${k.P}/r/todo/${child}`)).row;
    expect(childRow.parent_id).toBe(t.id);
    expect((await o.owner.get(`${k.P}/r/todo/${t.id}`)).row.description).toBe(`ساخته شد: ${childRow.number}`);
  });

  it("adds comments and work notes", async () => {
    const flow = await k.flow({}, line(N("a", "add_comment", { kind: "comment", body: "سلام {{trigger.record.short_description}}" }), N("b", "add_comment", { body: "یادداشت داخلی" })));
    const t = await k.todo({ short_description: "الف" });
    await settle(await test(flow, t));
    const j = await o.owner.get(`${k.P}/r/todo/${t.id}/journal`);
    expect(j.entries.map((e: any) => `${e.kind}:${e.body}`).sort()).toEqual(["comment:سلام الف", "work_note:یادداشت داخلی"]);
  });

  it("branches on a record condition and on data", async () => {
    const g = graph(
      [
        N("b", "branch", { condition: { f: "priority", op: "in", v: ["1", "2"] } }),
        N("d", "branch", { mode: "data", rules: [{ left: "{{trigger.record.short_description}}", op: "contains", right: "فوری" }, { left: "{{trigger.inputs.n}}", op: "gt", right: "5" }], match: "any" }),
        N("hi", "set_vars", { vars: [{ name: "path", value: "high" }] }),
        N("lo", "set_vars", { vars: [{ name: "path", value: "low" }] }),
        N("yes", "set_vars", { vars: [{ name: "data", value: "yes" }] }),
      ],
      [E("trigger", "b"), E("b", "hi", "yes"), E("b", "lo", "no"), E("hi", "d"), E("lo", "d"), E("d", "yes", "yes")],
    );
    const flow = await k.flow({}, g);
    let d = await settle(await test(flow, await k.todo({ priority: "1", short_description: "عادی" }), { inputs: { n: 9 } }));
    expect(d.context.vars).toEqual({ path: "high", data: "yes" });
    d = await settle(await test(flow, await k.todo({ priority: "4", short_description: "عادی" }), { inputs: { n: 1 } }));
    expect(d.context.vars).toEqual({ path: "low" });
    expect(trail(d)).toContain("d:completed:no");
  });

  it("runs parallel branches and joins them: all, the first, and branches that end early", async () => {
    const mk = (mode: string) =>
      graph(
        [
          N("p", "parallel"),
          N("a", "set_vars", { vars: [{ name: "a", value: 1 }] }),
          N("w", "wait_duration", { duration: { amount: 1, unit: "hour" } }),
          N("b", "set_vars", { vars: [{ name: "b", value: 2 }] }),
          N("c", "branch", { mode: "data", rules: [{ left: "1", op: "eq", right: "2" }] }),
          N("j", "join", { mode }),
          N("after", "set_vars", { vars: [{ name: "after", value: "{{vars.a}}-{{vars.b}}" }] }),
        ],
        [E("trigger", "p"), E("p", "a"), E("p", "w"), E("p", "c"), E("a", "j"), E("w", "b"), E("b", "j"), E("c", "j", "yes"), E("j", "after")],
      );
    // «all»: waits for a and b; branch c ends without reaching the join (its "no" path is empty) and is not waited for
    const all = await test(await k.flow({}, mk("all")));
    let d = await settle(all);
    expect(d.run.state).toBe("waiting");
    expect(d.context.vars.after).toBeUndefined();
    // «any»: the first branch to arrive continues at once; the others finish on their own and are absorbed
    const any = await test(await k.flow({}, mk("any")));
    d = await settle(any);
    expect(d.run.state).toBe("waiting");
    expect(d.context.vars.after).toBe("1-");
    await k.fireTimers();
    d = await settle(all);
    expect(d.run.state).toBe("completed");
    expect(d.context.vars.after).toBe("1-2");
    expect(d.steps.filter((s: any) => s.node_id === "after")).toHaveLength(1);
    d = await settle(any);
    expect(d.run.state).toBe("completed");
    expect(d.steps.filter((s: any) => s.node_id === "after")).toHaveLength(1);
    expect(d.context.vars.after).toBe("1-");
  });

  it("loops over records of a query and over a list, with the current item", async () => {
    const tag = `حلقه-${Date.now()}`;
    for (let i = 0; i < 3; i++) await k.todo({ short_description: `${tag} ${i}` });
    const g = graph(
      [
        N("l", "for_each", { table: "todo", condition: { f: "short_description", op: "starts", v: tag }, sort: "number" }),
        N("u", "update_record", { record: "{{item.id}}", values: { description: "شماره {{item_index}}" } }),
        N("l2", "for_each", { source: "list", list: "{{trigger.inputs.names}}" }),
        N("v", "set_vars", { vars: [{ name: "last", value: "{{item}}" }] }),
        N("done", "set_vars", { vars: [{ name: "count", value: "{{steps.l.output.count}}" }] }),
      ],
      [E("trigger", "l"), E("l", "u", "each"), E("l", "l2", "done"), E("l2", "v", "each"), E("l2", "done", "done")],
    );
    const d = await settle(await test(await k.flow({}, g), undefined, { inputs: { names: ["الف", "ب"] } }));
    expect(d.run.state).toBe("completed");
    expect(d.context.vars).toEqual({ last: "ب", count: 3 });
    // loop items live in their own table while the loop runs, never in the run's state
    expect(JSON.stringify(d)).not.toContain('"items"');
    expect(await o.db.one(`select 1 from sm_flow_loop_items where run_id = $1`, [d.run.id])).toBeNull();
    const rows = (await o.owner.post(`${k.P}/r/todo/query`, { filter: { f: "short_description", op: "starts", v: tag }, sort: "number", fields: ["description"] })).rows;
    expect(rows.map((r: any) => r.description)).toEqual(["شماره 0", "شماره 1", "شماره 2"]);
    // an empty loop goes straight to «پس از همه»
    const empty = await settle(await test(await k.flow({}, graph([N("l", "for_each", { source: "list", list: "{{trigger.inputs.none}}" }), N("x", "set_vars", { vars: [{ name: "x", value: 1 }] })], [E("trigger", "l"), E("l", "x", "done")]))));
    expect(empty.context.vars.x).toBe(1);
  });

  it("waits for a duration through a timer job, and counts business time with the calendar service when it is installed", async () => {
    const flow = await k.flow({}, line(N("w", "wait_duration", { duration: { amount: 2, unit: "hour" } }), N("v", "set_vars", { vars: [{ name: "done", value: true }] })));
    const runId = await test(flow);
    let d = await settle(runId);
    expect(d.run.state).toBe("waiting");
    expect(d.run.current_nodes).toEqual(["w"]);
    expect(d.steps.find((s: any) => s.node_id === "w").status).toBe("waiting");
    const job = await o.db.one<{ run_at: string }>(`select run_at from sm_jobs where kind = 'flows.timer' and payload->>'run' = $1`, [runId]);
    expect(Date.parse(String(job!.run_at)) - Date.now()).toBeGreaterThan(7_000_000);
    await k.fireTimers();
    d = await settle(runId);
    expect(d.run.state).toBe("completed");
    expect(d.steps.find((s: any) => s.node_id === "w").status).toBe("completed");
    // «به وقت کاری» asks the business clock (the SLA service registers one)
    offs.push(setFlowBusinessClock({ add: async ({ from, ms }) => from + ms * 3 }));
    const biz = await test(await k.flow({}, line(N("w", "wait_duration", { duration: { amount: 1, unit: "hour" }, business: true }))));
    const b = await settle(biz);
    expect(Date.parse(b.context.steps.w.output.due_at) - Date.now()).toBeGreaterThan(3 * 3_600_000 - 60_000);
    // a time in the past does not wait
    const past = await settle(await test(await k.flow({}, line(N("w", "wait_duration", { mode: "until", until: "{{now - 1h}}" })))));
    expect(past.run.state).toBe("completed");
  });

  it("waits for a condition on the record and resumes when the record changes, or takes the timeout path", async () => {
    const g = graph(
      [N("w", "wait_condition", { condition: { f: "state", op: "eq", v: "in_progress" }, timeout: { amount: 1, unit: "day" } }), N("ok", "set_vars", { vars: [{ name: "r", value: "ok" }] }), N("late", "set_vars", { vars: [{ name: "r", value: "late" }] })],
      [E("trigger", "w"), E("w", "ok"), E("w", "late", "timeout")],
    );
    const flow = await k.flow({}, g);
    const t = await k.todo();
    const runId = await test(flow, t);
    expect((await settle(runId)).run.state).toBe("waiting");
    await o.owner.patch(`${k.P}/r/todo/${t.id}`, { description: "هنوز نه" });
    expect((await settle(runId)).run.state).toBe("waiting");
    await o.owner.post(`${k.P}/r/todo/${t.id}/transition`, { to: "in_progress" });
    const d = await settle(runId);
    expect(d.run.state).toBe("completed");
    expect(d.context.vars.r).toBe("ok");
    expect(await o.db.one(`select 1 from sm_flow_waits where run_id = $1`, [runId])).toBeNull();
    // the timeout: the wait's timer fires after its deadline
    const t2 = await k.todo();
    const late = await test(flow, t2);
    await settle(late);
    await o.db.query(`update sm_flow_waits set data = jsonb_set(data, '{timeout_at}', to_jsonb((extract(epoch from now()) * 1000 - 1000)::bigint)) where run_id = $1`, [late]);
    await k.fireTimers();
    const dl = await settle(late);
    expect(dl.context.vars.r).toBe("late");
  });

  it("asks for approval with the built-in stand-in: approvers decide on the run's page", async () => {
    const m = await o.member("member");
    const g = graph(
      [N("a", "approval", { approvers: { users: [o.ownerId, m.userId] }, title: "تأیید {{trigger.record.short_description}}", rule: "all" }), N("yes", "update_record", { values: { priority: "1" } }), N("no", "add_comment", { body: "رد شد: {{steps.a.output.comment}}" })],
      [E("trigger", "a"), E("a", "yes", "approved"), E("a", "no", "rejected")],
    );
    const flow = await k.flow({}, g);
    const t = await k.todo({ short_description: "خرید" });
    const runId = await test(flow, t);
    let d = await settle(runId);
    expect(d.run.state).toBe("waiting");
    const w = d.waits[0];
    expect(w.kind).toBe("approval");
    expect(w.data.title).toBe("تأیید خرید");
    expect(w.can_decide).toBe(true);
    const outsider = await o.member("viewer");
    await outsider.client.post(`${k.P}/flows/waits/${w.id}/decide`, { decision: "approve" }, 403);
    expect((await o.owner.post(`${k.P}/flows/waits/${w.id}/decide`, { decision: "approve" })).final).toBeNull();
    await o.owner.post(`${k.P}/flows/waits/${w.id}/decide`, { decision: "approve" }, 409);
    expect((await settle(runId)).run.state).toBe("waiting");
    expect((await m.client.post(`${k.P}/flows/waits/${w.id}/decide`, { decision: "reject", comment: "بودجه نیست" })).final).toBe("rejected");
    d = await settle(runId);
    expect(d.run.state).toBe("completed");
    expect(trail(d)).toContain("a:completed:rejected");
    const j = await o.owner.get(`${k.P}/r/todo/${t.id}/journal`);
    expect(j.entries[0].body).toBe("رد شد: بودجه نیست");
  });

  it("lets an approvals service replace the stand-in and wake the run with resumeFlowWait", async () => {
    const asked: string[] = [];
    let withdrawn = 0;
    offs.push(
      registerFlowStepHandler("approval", {
        transactional: true,
        async run(s) {
          // a real service inserts its approval rows in s.tx, atomically with the step
          const id = `ext-${s.stepKey}-${s.run.id.slice(-6)}`;
          asked.push(id);
          return { wait: { kind: "approval", key: `approval:${id}`, data: { id } } };
        },
        async resume(_s, w) {
          return { port: w.result?.decision === "approved" ? "approved" : "rejected", output: { decision: w.result?.decision } };
        },
        async cancel() {
          withdrawn++;
        },
      }),
    );
    const g = graph([N("a", "approval", { approvers: { users: [o.ownerId] }, title: "تأیید" }), N("ok", "set_vars", { vars: [{ name: "ok", value: true }] })], [E("trigger", "a"), E("a", "ok", "approved")]);
    const flow = await k.flow({}, g);
    const runId = await test(flow);
    const d0 = await settle(runId);
    expect(d0.run.state).toBe("waiting");
    expect(d0.waits[0].can_decide).toBe(false);
    expect(await o.db.tx((tx) => resumeFlowWait(tx, o.org, `approval:${asked[0]}`, { decision: "approved" }))).toBe(1);
    const d = await settle(runId);
    expect(d.run.state).toBe("completed");
    expect(d.context.vars.ok).toBe(true);
    // cancelling a run withdraws what its waiting step asked for
    const second = await test(flow);
    await settle(second);
    await o.owner.post(`${k.P}/flows/runs/${second}/cancel`);
    expect(withdrawn).toBe(1);
    expect((await k.detail(second)).run.state).toBe("canceled");
  });

  it("logs notifications until the notification service is installed, and runs registered handlers instead", async () => {
    const flow = await k.flow({}, line(N("n", "notify", { to: { fields: ["caller_id"], users: ["{{trigger.actor}}"] }, subject: "درخواست {{trigger.record.number}}" })));
    const t = await k.todo();
    let d = await settle(await test(flow, t));
    expect(d.run.state).toBe("completed");
    const step = d.steps.find((s: any) => s.node_id === "n");
    expect(step.output.sent).toBe(false);
    expect(step.output.recipients).toEqual([o.ownerId]);
    expect(step.output.subject).toBe(`درخواست ${t.number}`);
    expect(step.output.$log[0]).toMatch(/اعلان/);
    const sent: unknown[] = [];
    offs.push(registerFlowStepHandler("notify", { async run(s) { sent.push(s.text(s.node.config.subject)); return { output: { sent: true } }; } }));
    d = await settle(await test(flow, t));
    expect(sent).toEqual([`درخواست ${t.number}`]);
    expect((await o.owner.get(`${k.P}/flows/catalog`)).services.notify).toBe(true);
  });

  it("runs AI skills the AI layer registers, and does nothing without them", async () => {
    const flow = await k.flow({}, line(N("ai", "ai_skill", { skill: "summarize", inputs: [{ name: "text", value: "{{trigger.record.short_description}}" }] }), N("v", "set_vars", { vars: [{ name: "s", value: "{{steps.ai.output.text}}" }] })));
    const t = await k.todo({ short_description: "متن بلند" });
    let d = await settle(await test(flow, t));
    expect(d.context.steps.ai.output).toEqual({ skipped: true });
    offs.push(registerFlowSkill({ key: "summarize", label: "خلاصه", run: async (_s, inputs) => ({ text: `خلاصهٔ ${inputs.text}` }) }));
    d = await settle(await test(flow, t));
    expect(d.context.vars.s).toBe("خلاصهٔ متن بلند");
    expect((await o.owner.get(`${k.P}/flows/catalog`)).skills.map((s: any) => s.key)).toEqual(["summarize"]);
  });

  it("takes the error path of a failing step, and fails the run without one", async () => {
    const g = graph(
      [N("u", "update_record", { values: { priority: "9" } }), N("e", "set_vars", { vars: [{ name: "err", value: "{{steps.u.error}}" }] })],
      [E("trigger", "u"), E("u", "e", "error")],
    );
    const t = await k.todo();
    let d = await settle(await test(await k.flow({}, g), t));
    expect(d.run.state).toBe("completed");
    expect(d.context.vars.err).toMatch(/اولویت/);
    expect(trail(d)).toContain("u:failed:error");
    // the failed write left nothing behind
    expect((await o.owner.get(`${k.P}/r/todo/${t.id}`)).row.priority).not.toBe("9");
    d = await settle(await test(await k.flow({}, line(N("u", "update_record", { values: { priority: "9" } }), N("x", "set_vars", { vars: [{ name: "x", value: 1 }] }))), t));
    expect(d.run.state).toBe("failed");
    expect(d.run.error).toMatch(/به‌روزرسانی رکورد/);
    expect(d.context.vars.x).toBeUndefined();
  });

  it("ends the whole run with «پایان», failed or completed, with outputs", async () => {
    const g = graph([N("p", "parallel"), N("w", "wait_duration", { duration: { amount: 1, unit: "day" } }), N("end", "end", { outcome: "failed", message: "پایان زودهنگام {{trigger.inputs.why}}" })], [E("trigger", "p"), E("p", "w"), E("p", "end")]);
    const d = await settle(await test(await k.flow({}, g), undefined, { inputs: { why: "آزمون" } }));
    expect(d.run.state).toBe("failed");
    expect(d.run.error).toBe("پایان زودهنگام آزمون");
    expect(d.waits).toEqual([]);
  });

  it("runs subflows and waits for their outputs; a failing subflow takes the error path", async () => {
    const child = await k.live({ trigger: "manual" }, line(N("v", "set_vars", { vars: [{ name: "x", value: "{{trigger.inputs.n}}" }] }), N("end", "end", { outputs: [{ name: "double", value: "{{vars.x}}{{vars.x}}" }] })));
    const bad = await k.live({ trigger: "manual" }, line(N("end", "end", { outcome: "failed", message: "نشد" })));
    const g = graph(
      [N("s", "subflow", { flow: child, inputs: [{ name: "n", value: "7" }] }), N("s2", "subflow", { flow: bad }), N("v", "set_vars", { vars: [{ name: "got", value: "{{steps.s.output.outputs.double}}" }, { name: "err", value: "{{steps.s2.error}}" }] })],
      [E("trigger", "s"), E("s", "s2"), E("s2", "v", "error")],
    );
    const d = await settle(await test(await k.flow({}, g)));
    expect(d.run.state).toBe("completed");
    expect(d.context.vars.got).toBe("77");
    expect(d.context.vars.err).toMatch(/نشد/);
    const childRuns = await k.runs(child);
    expect(childRuns[0].parent_run_id).toBe(d.run.id);
    expect(childRuns[0].depth).toBe(1);
  });

  it("stops a run that executes too many steps", async () => {
    const many = Array.from({ length: 600 }, (_, i) => i);
    const g = graph([N("l", "for_each", { source: "list", list: "{{trigger.inputs.many}}", limit: 500 }), N("a", "set_vars", { vars: [{ name: "a", value: "{{item}}" }] }), N("b", "set_vars", { vars: [{ name: "b", value: "{{item}}" }] })], [E("trigger", "l"), E("l", "a", "each"), E("a", "b")]);
    const d = await settle(await test(await k.flow({}, g), undefined, { inputs: { many } }));
    expect(d.run.state).toBe("failed");
    expect(d.run.error).toMatch(/حلقه/);
    expect(d.run.steps_count).toBe(1000);
  });

  it("stops chains of flows started by records flows write (depth guard)", async () => {
    const flow = await k.live(
      { trigger: "record", trigger_events: ["updated"], trigger_fields: ["description"], name: "زنجیره" },
      line(N("u", "update_record", { values: { description: "{{trigger.record.description}}+" } })),
    );
    const t = await k.todo({ description: "x" });
    await o.owner.patch(`${k.P}/r/todo/${t.id}`, { description: "y" });
    await k.drain();
    const runs = await k.runs(flow);
    // the person's change starts depth 0; each run's write starts the next, up to depth 5
    expect(runs.map((r: any) => r.depth).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect((await o.owner.get(`${k.P}/r/todo/${t.id}`)).row.description).toBe("y++++++");
    await k.activate(flow, false);
  });

  it("acts as the configured identity: the system, a named member, or the triggering member through the access provider", async () => {
    const viewer = await o.member("viewer");
    const t = await k.todo();
    // a viewer may not write records: a run acting as them fails on the write
    const asViewer = await k.flow({ run_as: "user", run_as_user: viewer.userId }, line(N("u", "update_record", { values: { priority: "2" } })));
    await k.publish(asViewer);
    await k.activate(asViewer);
    const r1 = (await o.owner.post(`${k.P}/flows/${asViewer}/run`, { table: "todo", record_id: t.id })).run.id;
    const d1 = await settle(r1);
    expect(d1.run.state).toBe("failed");
    expect(d1.run.run_as).toBe(viewer.userId);
    const asSystem = await k.live({ run_as: "system" }, line(N("u", "update_record", { values: { priority: "2" } })));
    const r2 = (await o.owner.post(`${k.P}/flows/${asSystem}/run`, { table: "todo", record_id: t.id })).run.id;
    const d2 = await settle(r2);
    expect(d2.run.state).toBe("completed");
    expect(d2.run.run_as).toBeNull();
    const h = await o.owner.get(`${k.P}/r/todo/${t.id}/history`);
    expect(h.entries.find((e: any) => e.field === "priority" && e.new === "2").actor).toBeNull();
  });

  it("keeps the version a run started with when the flow is published again", async () => {
    const flow = await k.flow({}, line(N("w", "wait_duration", { duration: { amount: 1, unit: "hour" } }), N("v", "set_vars", { vars: [{ name: "v", value: "one" }] })));
    await k.publish(flow);
    await k.activate(flow);
    const first = (await o.owner.post(`${k.P}/flows/${flow}/run`, {})).run.id;
    await settle(first);
    const cur = await o.owner.get(`${k.P}/r/flow/${flow}`);
    await o.owner.patch(`${k.P}/r/flow/${flow}`, { graph: line(N("v", "set_vars", { vars: [{ name: "v", value: "two" }] })), version: cur.row.version });
    expect((await o.owner.get(`${k.P}/r/flow/${flow}`)).row.dirty).toBe(true);
    expect((await k.publish(flow)).version.version_no).toBe(2);
    const second = (await o.owner.post(`${k.P}/flows/${flow}/run`, {})).run.id;
    await k.fireTimers();
    const [a, b] = [await settle(first), await settle(second)];
    expect([a.run.version_no, a.context.vars.v]).toEqual([1, "one"]);
    expect([b.run.version_no, b.context.vars.v]).toEqual([2, "two"]);
    expect((await o.owner.get(`${k.P}/r/flow/${flow}`)).row.dirty).toBe(false);
  });

  it("cancels a waiting run: its waits go, nothing resumes it", async () => {
    const flow = await k.flow({}, line(N("w", "wait_duration", { duration: { amount: 1, unit: "hour" } }), N("v", "set_vars", { vars: [{ name: "v", value: 1 }] })));
    const runId = await test(flow);
    await settle(runId);
    const c = await o.owner.post(`${k.P}/flows/runs/${runId}/cancel`);
    expect(c.state).toBe("canceled");
    await k.fireTimers();
    const d = await settle(runId);
    expect(d.run.state).toBe("canceled");
    expect(d.context.vars.v).toBeUndefined();
    expect(d.waits).toEqual([]);
    await o.owner.post(`${k.P}/flows/runs/${runId}/cancel`, {}, 403);
  });
});
