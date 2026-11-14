// The demo pack's workflow (src/server/modules/demo/workflow.ts, docs/DEMO_FA.md): «درخواست دسترسی به سامانه (نمونه)»
// is published by the publish service with no problem, recorded as the pack's own (fields, form, process, version), and
// works as the Windows app's end-to-end test uses it (scripts/desktop-e2e.mjs): a regular member («کارشناس پشتیبانی»,
// no part in the pack) finds it in «گردش‌کارهای من», starts it from its start form, and the case moves to the security
// team's approval; the pack's security analyst approves and the case moves to the service desk. The step runs again
// without a second copy, and never takes a real workflow's key. That the purge leaves no trace of the workflow and of
// the cases the pack's people start and work: tests/demo-purge.test.ts (a real member's case is real work: kept, its
// reference reported).
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client, signupWithOrg } from "./helpers";
import { systemCtx } from "@server/engine";
import { tick } from "@server/jobs";
import { inDemoScope } from "@server/db/scope";
import { inbox, submitStep } from "@server/modules/process/api";
import { checkDraft, cleanDraft } from "@server/modules/process/publish";
import { DEMO_WORKFLOW as W } from "@server/modules/demo/bank";
import { loadRefusals, newMemo, STEPS, type LoadMemo } from "@server/modules/demo/load";
import type { Ctx } from "@server/context";

let e: EngineOrg;
let sys: Ctx;
let memo: LoadMemo;
const P = () => `/o/${e.org}`;

async function drain(rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
}

/** Run one step of the pack inside its demo scope, as the job `demo.load` does. */
async function step(key: string) {
  const s = STEPS.find((x) => x.key === key)!;
  for (let i = 0; i < 50 && !(await inDemoScope(e.org, () => s.run({ cfg: e.cfg, orgId: e.org, memo, deadline: Date.now() + 600_000 }, sys))); i++);
}

beforeAll(async () => {
  e = await engineOrg();
  sys = await systemCtx(e.cfg, e.org);
  // the modules' seeds first (the bank's roles among them), brought forward as the pack's load does
  for (let i = 0; i < 30; i++) {
    await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and status in ('queued', 'running') and (kind like '%seed%' or kind like '%install%')`, [e.org]);
    const r = await tick(e.cfg, { budgetMs: 60_000 });
    if (!r.ran && !r.more) break;
  }
  memo = newMemo("small");
  for (const key of ["org", "groups", "people", "workflows"]) await step(key);
}, 1_200_000);

describe("the demo pack's workflow", () => {
  it("is published by the publish service, without a problem, as the pack's own rows", async () => {
    expect(loadRefusals(e.org)).toEqual({});
    expect(memo.counts).toMatchObject({ process: 1, form: 1, field_def: 4 });
    const proc = await e.db.one<{ id: string; status: string; version_no: number; current_version_id: string; draft: unknown }>(`select * from sm_processes where org_id = $1 and key = $2`, [e.org, W.key]);
    expect(proc).toMatchObject({ status: "published", version_no: 1 });
    expect((await checkDraft(sys, cleanDraft(proc!.draft))).problems.filter((p) => p.level === "error")).toEqual([]);
    expect((await e.db.one<{ status: string }>(`select status from sm_forms where org_id = $1 and name = $2`, [e.org, W.form]))?.status).toBe("published");
    // every row the step wrote is the pack's (the purge takes exactly what sm_demo_rows names)
    const ids = [
      proc!.id, proc!.current_version_id,
      ...(await e.db.query<{ id: string }>(`select id from sm_forms where org_id = $1 and name = $2`, [e.org, W.form])).map((r) => r.id),
      ...(await e.db.query<{ id: string }>(`select id from sm_field_defs where org_id = $1 and name like 'u_aftab_%'`, [e.org])).map((r) => r.id),
    ];
    expect(ids).toHaveLength(7);
    const demo = await e.db.query<{ row_id: string }>(`select row_id::text as row_id from sm_demo_rows where org_id = $1 and row_id = any($2::uuid[])`, [e.org, `{${ids.join(",")}}`]);
    expect(demo).toHaveLength(7);
  });

  it("a regular member starts it from «گردش‌کارهای من» and the case moves to the security team's approval", async () => {
    const m = await e.member("member");
    await e.owner.post(`${P()}/access/members/${m.userId}/preset`, { preset: "agent" });
    const mine = (await m.client.get(`${P()}/process/mine`)).processes;
    expect(mine.find((p: { key: string }) => p.key === W.key)).toMatchObject({ name: W.name, can_start: true });
    const view = await m.client.get(`${P()}/process/defs/${W.key}/view`);
    expect(view.start).toMatchObject({ can_start: true, label: W.steps.start, next: W.steps.approve, form: { name: W.form } });
    expect(view.start.rights).toMatchObject({ [W.fields.system.name]: "required", [W.fields.reason.name]: "required", [W.fields.access.name]: "edit" });
    expect(view.start.rights[W.fields.note.name] ?? "hidden").toBe("hidden");
    expect(view.steps.map((s: { label: string }) => s.label)).toEqual([W.steps.start, W.steps.approve, W.steps.grant]);
    const started = await m.client.post(`${P()}/process/start`, { process: W.key, values: { [W.fields.system.name]: "سامانهٔ اعتبارات", [W.fields.access.name]: "read", [W.fields.reason.name]: "بررسی پرونده‌های تسهیلات شعبه" } }, 201);
    expect(started).toMatchObject({ result: "applied" });
    await drain();
    const d = await m.client.get(`${P()}/process/cases/${started.case}`);
    expect(d.case).toMatchObject({ state: "active", process_name: W.name, title: "دسترسی به سامانهٔ اعتبارات" });
    // the start is the member's own step done; the next one is someone else's, open («در جریان» in the case's channel)
    expect(d.statuses).toMatchObject({ request: { status: "mine_done" }, approve: { status: "active" } });
    // the security team holds the step: the pack's analyst among them
    const soc = memo.people.personas.soc!;
    const box = await inDemoScope(e.org, async () => inbox(await e.ctxOf(soc)));
    const row = box.rows.find((r) => r.kind === "process_step" && r.case_id === started.case);
    expect(row).toMatchObject({ step: W.steps.approve, can_act: true });
    // the analyst approves (the pack's person: demo work) and the case moves to the service desk
    await inDemoScope(e.org, async () => submitStep(await e.ctxOf(soc), row!.id, { outcome: "approved", values: { [W.fields.note.name]: "دسترسی خواندنی بی‌اشکال است" } }));
    await drain();
    const after = await m.client.get(`${P()}/process/cases/${started.case}`);
    expect(after.statuses).toMatchObject({ approve: { status: "done" }, grant: { status: "active" } });
  }, 300_000);

  it("runs again without a second copy, and never takes a real workflow's key", async () => {
    await step("workflows");
    expect(loadRefusals(e.org)).toEqual({});
    expect((await e.db.query(`select 1 from sm_processes where org_id = $1 and key = $2`, [e.org, W.key])).length).toBe(1);
    expect((await e.db.query(`select 1 from sm_process_versions v join sm_processes p on p.id = v.process_id where p.org_id = $1 and p.key = $2`, [e.org, W.key])).length).toBe(1);
    // another organisation whose own workflow has the pack's key: the part is refused and nothing of the pack is written
    const owner2 = new Client(e.app);
    const org2 = await signupWithOrg(owner2, { email: "own-workflows@example.com", timezone: "Asia/Tehran" });
    const sys2 = await systemCtx(e.cfg, org2);
    await owner2.post(`/o/${org2}/process/defs`, { name: "گردش‌کار خود سازمان", key: W.key }, 201);
    const memo2: LoadMemo = { ...newMemo("small"), groups: memo.groups, people: memo.people };
    await inDemoScope(org2, () => STEPS.find((x) => x.key === "workflows")!.run({ cfg: e.cfg, orgId: org2, memo: memo2, deadline: Date.now() + 60_000 }, sys2));
    expect(Object.keys(loadRefusals(org2))).toEqual(["process"]);
    expect((await e.db.query(`select 1 from sm_field_defs where org_id = $1 and name like 'u_aftab_%'`, [org2])).length).toBe(0);
    expect((await e.db.one<{ name: string }>(`select name from sm_processes where org_id = $1 and key = $2`, [org2, W.key]))?.name).toBe("گردش‌کار خود سازمان");
  }, 300_000);
});
