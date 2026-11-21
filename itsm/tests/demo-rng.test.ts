// The demo pack's random sequence survives a step being split over job invocations: on a slow machine or for a larger
// pack a step runs in several invocations, and it must make the same bank as one that ran at once — never a replay of
// the sequence its first part already used. (The PGlite proof once found a device class and the branch officer's assets
// missing: the fleet's second batch had replayed the first one's draws.) The batched steps (people, the fleet) keep
// `Rng.state` in `memo.rng` after each batch (load.ts `batchRng`); the incidents and the rest of the bank's phased steps
// restore it at any cursor (`resumeRng`, modules.ts `phased`), since their first phase draws too.
import { describe, expect, it } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client, signupWithOrg } from "./helpers";
import { systemCtx } from "@server/engine";
import { tick } from "@server/jobs";
import { inDemoScope } from "@server/db/scope";
import { Rng } from "@server/modules/demo/bank";
import { loadRefusals, newMemo, resumeRng, STEPS, type LoadMemo, type StepArgs } from "@server/modules/demo/load";
import { phased } from "@server/modules/demo/modules";

const PHASES = ["skills", "people", "rosters", "absences", "oncall"];

/**
 * A phased step drawing `per` values in each phase, run over job invocations that each get through `perInvocation`
 * phases (the deadline passes then); its third phase works in chunks of four draws and stops between chunks when the
 * deadline passes, as the CSM cases and field orders do. `rngOf` makes the step's generator at each invocation.
 */
async function phasedDraws(perInvocation: number, rngOf: (memo: LoadMemo, seed: number) => Rng = resumeRng): Promise<number[]> {
  const memo = newMemo("small");
  const out: number[] = [];
  for (let invocation = 0; invocation < 40; invocation++) {
    const a: StepArgs = { cfg: null as never, orgId: "org", memo, deadline: Date.now() + 60_000 };
    const rng = rngOf(memo, memo.seed + 53);
    let phases = 0;
    const done = await phased(a, "workforce", PHASES, async (phase) => {
      if (phase === "rosters") {
        for (let at = Number(memo.units["test:at"] ?? 0); at < 12; at += 4) {
          if (Date.now() > a.deadline) {
            memo.units["test:at"] = String(at);
            return false;
          }
          for (let k = 0; k < 4; k++) out.push(rng.int(0, 1_000_000));
          memo.rng = rng.state;
          // the deadline passes after each chunk when invocations get through less than a phase
          if (perInvocation === 0) a.deadline = 0;
        }
        delete memo.units["test:at"];
      } else for (let k = 0; k < 5; k++) out.push(rng.int(0, 1_000_000));
      if (perInvocation > 0 && ++phases >= perInvocation) a.deadline = 0;
    }, rng);
    if (done) {
      // the step is done: nothing of its sequence stays in the memo (the next step starts from its own seed)
      expect(memo.rng).toBeUndefined();
      return out;
    }
  }
  throw new Error("the step never ended");
}

describe("the demo pack's random sequence across job invocations", () => {
  it("a generator set to a saved state continues the sequence", () => {
    const a = new Rng(1405);
    for (let i = 0; i < 7; i++) a.next();
    const b = new Rng(0);
    b.state = a.state;
    for (let i = 0; i < 20; i++) expect(b.next()).toBe(a.next());
  });

  it("a phased step split over invocations makes the same values as one run at once (and as before: the seed's own sequence)", async () => {
    const once = await phasedDraws(PHASES.length);
    const plain = new Rng(newMemo("small").seed + 53);
    expect(once).toEqual(Array.from({ length: once.length }, () => plain.int(0, 1_000_000)));
    // one phase per invocation (its second phase resumes at cursor 1), two, and a chunked phase stopped between chunks
    expect(await phasedDraws(1)).toEqual(once);
    expect(await phasedDraws(2)).toEqual(once);
    expect(await phasedDraws(0)).toEqual(once);
  });

  it("never replays: neither a fresh generator per invocation nor one restored only past the first batch", async () => {
    const once = await phasedDraws(PHASES.length);
    expect(await phasedDraws(1, (_memo, seed) => new Rng(seed))).not.toEqual(once);
    // a batched step's rule (load.ts batchRng: its cursor-0 part draws nothing) would restart a phased step's sequence
    // at its second phase
    const pastFirstBatch = (memo: LoadMemo, seed: number) => {
      const rng = new Rng(seed);
      if (memo.cursor > 1 && typeof memo.rng === "number") rng.state = memo.rng;
      return rng;
    };
    expect(await phasedDraws(1, pastFirstBatch)).not.toEqual(once);
  });
});

// The bank's own workflows (src/server/modules/demo/workflows.ts) over job invocations: its definitions run in phases
// and its sample cases one act at a time while the job queue moves their runs between invocations. Split after every
// phase and every act — as a slow machine or a busy queue splits it — the load makes the same fields, forms, roles,
// holders, workflows, versions and cases (their values, people, states and tasks) as one that ran at once.
describe("the bank's workflows across job invocations", () => {
  const settle = async (e: EngineOrg) => {
    for (let i = 0; i < 80; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  /** Load the pack's base and its workflows in `org`; `split`: every invocation ends after its first piece of work. */
  async function load(e: EngineOrg, org: string, at: number, split: boolean): Promise<{ memo: LoadMemo; invocations: number }> {
    for (let i = 0; i < 30; i++) {
      await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and status in ('queued', 'running') and (kind like '%seed%' or kind like '%install%')`, [org]);
      const r = await tick(e.cfg, { budgetMs: 60_000 });
      if (!r.ran && !r.more) break;
    }
    const sys = await systemCtx(e.cfg, org);
    const memo = newMemo("small");
    memo.wf = { at };
    let invocations = 0;
    for (const key of ["org", "groups", "people", "branch_staff", "workflow_defs", "workflow_cases"]) {
      const s = STEPS.find((x) => x.key === key)!;
      const mine = key.startsWith("workflow");
      for (let i = 0; ; i++) {
        if (i > 3000) throw new Error(`${key} never ended`);
        const deadline = mine && split ? Date.now() + 2 : Date.now() + 600_000;
        if (mine) invocations++;
        if (await inDemoScope(org, () => s.run({ cfg: e.cfg, orgId: org, memo, deadline }, sys))) break;
        await settle(e);
      }
      memo.cursor = 0;
    }
    await settle(e);
    return { memo, invocations };
  }

  /** What the load made, every id named by what it is (people by name, units and groups by name, forms by name…). */
  async function picture(e: EngineOrg, org: string, memo: LoadMemo): Promise<unknown> {
    const names = new Map<string, string>();
    const add = async (sql: string) => {
      for (const r of await e.db.query<{ id: string; n: string }>(sql, [org])) names.set(String(r.id).toLowerCase(), r.n);
    };
    await add(`select u.id::text as id, 'person:' || u.full_name as n from sm_users u join sm_org_members m on m.user_id = u.id where m.org_id = $1`);
    await add(`select id::text as id, 'group:' || name as n from sm_groups where org_id = $1`);
    await add(`select id::text as id, 'unit:' || name as n from sm_org_units where org_id = $1`);
    await add(`select id::text as id, 'form:' || name as n from sm_forms where org_id = $1`);
    await add(`select id::text as id, 'position:' || key as n from sm_positions where org_id = $1`);
    await add(`select id::text as id, 'process:' || key as n from sm_processes where org_id = $1`);
    await add(`select v.id::text as id, 'version:' || p.key || ':' || v.version_no as n from sm_process_versions v join sm_processes p on p.id = v.process_id where v.org_id = $1`);
    for (const [key, row] of Object.entries(memo.wf?.cases?.rows ?? {})) names.set(row.id.toLowerCase(), `case:${key}`);
    const named = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => names.get(id.toLowerCase()) ?? "?").replace(/PRC\d+/g, "PRC#"));
    const rows = async (sql: string) => named(await e.db.query(sql, [org]));
    const cases: Record<string, unknown> = {};
    for (const [key, row] of Object.entries(memo.wf?.cases?.rows ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      cases[key] = {
        case: named(await e.db.one(`select state, outcome, title, version_no, process_id, requested_by, data from sm_process_cases where org_id = $1 and id = $2`, [org, row.id])),
        tasks: named(await e.db.query(`select step_key, round, assigned_to, status, outcome, acted_by from sm_process_tasks where org_id = $1 and case_id = $2 order by step_key, round, assigned_to`, [org, row.id])),
      };
    }
    return {
      fields: await rows(`select name, label, type, options, validation, default_value, status from sm_field_defs where org_id = $1 and name like 'u\\_aftab\\_%' order by name`),
      forms: await rows(`select name, description, layout, status from sm_forms where org_id = $1 order by name`),
      positions: await rows(`select key, name, unit_kind, reports_to, active from sm_positions where org_id = $1 order by key`),
      holders: ((await rows(`select position_id, user_id, org_unit_id, kind, valid_from, valid_to from sm_position_holders where org_id = $1`)) as unknown[]).map((x) => JSON.stringify(x)).sort(),
      profiles: ((await rows(`select user_id, manager_id from sm_member_profiles where org_id = $1 and manager_id is not null`)) as unknown[]).map((x) => JSON.stringify(x)).sort(),
      processes: await rows(`select key, name, category, status, version_no, draft from sm_processes where org_id = $1 order by key`),
      versions: ((await rows(`select process_id, version_no, graph, starters, managers, manager_groups, title_template from sm_process_versions where org_id = $1`)) as unknown[]).map((x) => JSON.stringify(x)).sort(),
      cases,
      counts: memo.counts,
    };
  }

  it("split after every phase and every act, they make the same definitions and cases as one run", async () => {
    const e = await engineOrg();
    const org2 = await signupWithOrg(new Client(e.app), { email: "split-bank@example.com", timezone: "Asia/Tehran" });
    const at = Date.now();
    const once = await load(e, e.org, at, false);
    const split = await load(e, org2, at, true);
    expect(loadRefusals(e.org)).toEqual({});
    expect(loadRefusals(org2)).toEqual({});
    // the second load was cut into many more invocations
    expect(split.invocations).toBeGreaterThan(once.invocations * 3);
    const a = await picture(e, e.org, once.memo);
    const b = await picture(e, org2, split.memo);
    expect(JSON.stringify(a)).not.toContain('"?"');
    expect(b).toEqual(a);
    expect(Object.keys((a as { cases: object }).cases).length).toBeGreaterThanOrEqual(14);
    // nothing of a phase's random sequence stays once the steps end
    expect(split.memo.rng).toBeUndefined();
  }, 1_800_000);
});
