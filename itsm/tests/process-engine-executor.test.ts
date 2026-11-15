// F4a — the flows executor's additions for workflows (design F D4, §3.5, §3.6.6): a run of kind `process` executes
// the graph of its `process_version` (the graph resolver by run kind) with handlers scoped to its kind; a run may start
// at a chosen node («ادامه از مرحلهٔ …»); a join in mode «any» with `cancel_rest` withdraws the other branches through
// their handlers' `cancel` (a workflow's open tasks close as «دیگر لازم نیست»), so a later resume finds no wait; the
// end a run reaches travels with `record.flow_ended`; process runs stay out of «اجراها» (/flows/runs, 404 on detail).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { E, N, flowsKit, type FlowsKit } from "./flows-helpers";
import { registerRunKind, resumeFlowWait, startRun, type StartInput } from "@server/modules/flows";
import { create, onRecordEvent, systemCtx } from "@server/engine";
import type { FlowGraph } from "@shared/flows";
import type { Ctx } from "@server/context";

describe("the executor for workflow runs", () => {
  let o: EngineOrg;
  let k: FlowsKit;
  let sys: Ctx;
  const offs: (() => void)[] = [];
  afterEach(() => {
    while (offs.length) offs.pop()!();
  });
  beforeAll(async () => {
    o = await engineOrg();
    k = flowsKit(o);
    sys = await systemCtx(o.cfg, o.org);
  });

  const orgId = () => sys.org.id;
  let seq = 0;
  /** a process, its published version with `graph`, and a case of it */
  async function published(graph: FlowGraph, data: Record<string, unknown> = {}) {
    const n = ++seq;
    const proc = await create(sys, "process", { name: `گردش‌کار ${n}`, key: `proc_${n}`, status: "published" }, { trusted: true });
    const version = await create(sys, "process_version", { process_id: proc.row.id, name: `گردش‌کار ${n}`, version_no: 1, graph }, { trusted: true });
    const kase = await create(sys, "process_case", { title: `پرونده ${n}`, process_id: proc.row.id, version_id: version.row.id, version_no: 1, state: "active", requested_by: o.ownerId, data }, { trusted: true });
    return { proc: proc.row.id as string, version: version.row.id as string, kase: kase.row.id as string, name: `گردش‌کار ${n}` };
  }
  const input = (p: { proc: string; version: string; kase: string; name: string }, extra: Partial<StartInput> = {}): StartInput => ({
    orgId: orgId(),
    flow: { id: p.proc, name: p.name },
    version: { id: p.version, no: 1 },
    trigger: { kind: "process", table: "process_case", id: p.kase },
    actorId: o.ownerId,
    runAs: { kind: "system", userId: null },
    depth: 0,
    ...extra,
  });
  const run = (id: string) => o.db.one<{ state: string; error: string | null; trigger_kind: string; context: any }>(`select state, error, trigger_kind, context from sm_flow_runs where id = $1`, [id]);
  const steps = async (id: string) => (await o.db.query<{ node_id: string; status: string; port: string | null; output: any }>(`select node_id, status, port, output from sm_flow_run_steps where run_id = $1 order by started_at, key`, [id])).map((s) => `${s.node_id}:${s.status}${s.port ? `:${s.port}` : ""}`);
  const waits = (id: string) => o.db.query<{ node_id: string; key: string | null }>(`select node_id, key from sm_flow_waits where run_id = $1 order by created_at`, [id]);

  it("runs the graph of the case's process_version, and ends with the «پایان» it reached on record.flow_ended", async () => {
    const ended: any[] = [];
    offs.push(onRecordEvent("test-process-ended", async (e) => void ended.push(e), { tables: ["process_case"], kinds: ["record.flow_ended"] }));
    const p = await published(
      {
        nodes: [
          N("t", "trigger"),
          N("v", "set_vars", { vars: [{ name: "seen", value: "{{trigger.record.number}}" }, { name: "amount", value: "{{case.u_amount}}" }] }),
          // a condition on the case's values (they are not engine fields: the run reads them under `case`)
          N("big", "branch", { mode: "data", rules: [{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }] }),
          N("no", "end", { outcome: "rejected" }),
          N("ok", "end"),
        ],
        edges: [E("t", "v"), E("v", "big"), E("big", "no", "yes"), E("big", "ok", "no")],
      },
      { u_amount: 750000000 },
    );
    const id = await startRun(o.db, input(p));
    await k.drain();
    expect(await run(id)).toMatchObject({ state: "completed", trigger_kind: "process" });
    expect(await steps(id)).toEqual(["t:completed:out", "v:completed:out", "big:completed:yes", "no:completed"]);
    const vars = (await run(id))!.context.vars;
    expect(vars.seen).toMatch(/^PRC\d{7}$/);
    expect(vars.amount).toBe(750000000);
    const e = ended.find((x) => x.id === p.kase);
    expect(e?.data).toMatchObject({ run_id: id, kind: "process", state: "completed", end: { node: "no", outcome: "rejected" } });
  });

  it("fails a process run whose version is gone (no flow version stands in)", async () => {
    const p = await published({ nodes: [N("t", "trigger")], edges: [] });
    const id = await startRun(o.db, input(p, { version: { id: "00000000-0000-4000-8000-0000000000aa", no: 9 } }));
    await k.drain();
    expect(await run(id)).toMatchObject({ state: "failed", error: "نسخهٔ گردش‌کار پیدا نشد" });
  });

  it("starts at a chosen node («ادامه از مرحلهٔ …») on the same version", async () => {
    const p = await published({
      nodes: [N("t", "trigger"), N("a", "set_vars", { vars: [{ name: "a", value: "1" }] }), N("b", "set_vars", { vars: [{ name: "b", value: "2" }] }), N("ok", "end")],
      edges: [E("t", "a"), E("a", "b"), E("b", "ok")],
    });
    const id = await startRun(o.db, input(p, { startAt: "b" }));
    await k.drain();
    expect(await run(id)).toMatchObject({ state: "completed" });
    expect(await steps(id)).toEqual(["b:completed:out", "ok:completed"]);
    expect((await run(id))!.context.vars).toEqual({ b: "2" });
  });

  describe("join «any» with cancel_rest", () => {
    // a test kind with a step that waits on its own key and records what its `cancel` withdrew
    const canceled: string[] = [];
    let graphs = new Map<string, FlowGraph>();
    const kind = () =>
      registerRunKind("ptest", {
        graph: async (_q, r) => graphs.get(r.flow_id) ?? null,
        handlers: {
          waiter: {
            async run(s) {
              return { wait: { kind: "pstep", key: `pstep:${s.run.id}:${s.node.id}` } };
            },
            async resume(_s, w) {
              return { port: String(w.result?.port ?? "out") };
            },
            async cancel(a) {
              canceled.push(`${a.node.id}:${a.wait.key}`);
            },
          },
        },
      });
    const g = (cancelRest: boolean): FlowGraph => ({
      nodes: [N("t", "trigger"), N("p", "parallel"), N("x", "set_vars", { vars: [{ name: "x", value: "1" }] }), N("w", "waiter" as never), N("j", "join", { mode: "any", ...(cancelRest ? { cancel_rest: true } : {}) }), N("after", "waiter" as never), N("ok", "end")],
      edges: [E("t", "p"), E("p", "x"), E("p", "w"), E("x", "j"), E("w", "j"), E("j", "after"), E("after", "ok")],
    });
    const start = async (graph: FlowGraph) => {
      const flowId = `00000000-0000-4000-8000-${String(900 + ++seq).padStart(12, "0")}`;
      graphs.set(flowId, graph);
      return startRun(o.db, { orgId: orgId(), flow: { id: flowId, name: "آزمون" }, version: { id: null, no: 1 }, trigger: { kind: "ptest" }, actorId: o.ownerId, runAs: { kind: "system", userId: null }, depth: 0 });
    };

    it("withdraws the other branch: its wait is gone, its handler's cancel ran, a late resume finds nothing", async () => {
      offs.push(kind());
      canceled.length = 0;
      const id = await start(g(true));
      await k.drain();
      expect(await run(id)).toMatchObject({ state: "waiting" });
      // only the step after the join waits; the withdrawn branch's wait is deleted and its cancel ran once
      expect((await waits(id)).map((w) => w.node_id)).toEqual(["after"]);
      expect(canceled).toEqual([`w:pstep:${id}:w`]);
      const join = await o.db.one<{ output: any; port: string | null }>(`select output, port from sm_flow_run_steps where run_id = $1 and node_id = 'j'`, [id]);
      expect(join).toMatchObject({ port: "out", output: { arrived: 1, expected: 2, canceled: 1 } });
      // a decision on the withdrawn step arrives later: no wait takes it (the apply reports it late)
      expect(await resumeFlowWait(o.db, orgId(), `pstep:${id}:w`, { port: "out" })).toBe(0);
      expect(await resumeFlowWait(o.db, orgId(), `pstep:${id}:after`, { port: "out" })).toBe(1);
      await k.drain();
      expect(await run(id)).toMatchObject({ state: "completed" });
      expect(await steps(id)).not.toContain("w:completed:out");
    });

    it("without cancel_rest the other branch keeps waiting", async () => {
      offs.push(kind());
      canceled.length = 0;
      const id = await start(g(false));
      await k.drain();
      expect((await waits(id)).map((w) => w.node_id).sort()).toEqual(["after", "w"]);
      expect(canceled).toEqual([]);
    });

    it("keeps a kind's handlers to its own runs: an automation flow does not know the node", async () => {
      offs.push(kind());
      const id = await startRun(o.db, { orgId: orgId(), flow: { id: "00000000-0000-4000-8000-000000000999", name: "خودکار" }, version: { id: null, no: null }, graph: { nodes: [N("t", "trigger"), N("w", "waiter" as never)], edges: [E("t", "w")] }, trigger: { kind: "test" }, actorId: o.ownerId, runAs: { kind: "system", userId: null }, depth: 0, test: true });
      await k.drain();
      expect(await run(id)).toMatchObject({ state: "failed" });
      expect((await run(id))!.error).toContain("در این نسخه پیاده نشده است");
    });
  });

  it("keeps process runs out of «اجراها»: not listed, and their detail is 404", async () => {
    const p = await published({ nodes: [N("t", "trigger"), N("ok", "end")], edges: [E("t", "ok")] });
    const id = await startRun(o.db, input(p));
    await k.drain();
    const all = await o.owner.get(`${k.P}/flows/runs`);
    expect(all.runs.map((r: { id: string }) => r.id)).not.toContain(id);
    expect((await o.owner.get(`${k.P}/flows/runs?flow=${p.proc}`)).runs).toEqual([]);
    await o.owner.get(`${k.P}/flows/runs/${id}`, 404);
  });
});
