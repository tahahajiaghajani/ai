// The bank's own workflows (docs/DEMO_FA.md «گردش‌کارهای نمونه», release 1.1.5): two steps of the load.
//   · «workflow_defs»: the library fields, the tabbed forms, the organisational roles and their holders, a few
//     managers on the pack's own profiles and units, the processes — written as the system inside the demo scope like
//     every step (put → createIn, the engine's hooks) — and «انتشار» through the publish service. A real field, form,
//     position or process of the same name or key is never touched: that part is refused and recorded with the pack's
//     status, and whatever needs it is skipped and recorded too (a form without its field, a process without its form
//     or position). Each part runs again safely: the pack's own rows are found and reused.
//   · «workflow_cases»: the sample cases (./workflow-samples.ts `wfScripts`), started and moved on through the
//     workflows' own services as the pack's people — the same start, «ارسال», «لغو» a person does — so their runs,
//     rounds, tasks, journal and bells are the product's. A case's next step opens in the flows job its last act
//     queued: the step returns and the job queue runs those jobs before the load's next invocation (`memo.wait`), and
//     each script goes on from where the memo says (one act per transaction; its case id chosen before its start, so a
//     start repeated after a lost invocation is «late», never a second case). One sample shows «پایان مهلت»: its round
//     is dated back and the organisation's timer (outside the demo scope, the case inside it) times it out. A script
//     that cannot go on — its process refused, or its case stuck for two minutes with nothing queued — is recorded with
//     the pack's status and the load goes on.
import { uuidv7 } from "@shared/id";
import { normalizeSearch } from "@shared/model/conditions";
import { localDate } from "@shared/model/jalali-buckets";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { orgTz, savepoint, updateIn } from "../../engine";
import { memberCtx } from "../../access/service";
import { publishProcess } from "../process/publish";
import { cancelCaseAs, startProcess, submitStep } from "../process/api";
import { wakeTimer } from "../process/timers";
import { REGIONS } from "./bank";
import { bump, put, refuse, type LoadMemo, type StepArgs } from "./load";
import { phased } from "./modules";
import {
  formFields, PROJECT, WF_FIELDS, WF_FORMS, WF_POSITIONS, WF_PROCESSES, wfHolders, wfManagers, wfScripts,
  type WfActor, type WfMemo, type WfRefs, type WfScript,
} from "./workflow-samples";

// ----- shared -------------------------------------------------------------------------------------------------------

const wfOf = (memo: LoadMemo): WfMemo => (memo.wf ??= {});

/** The pack's people, units and groups as the definitions and scripts need them. */
export function refsOf(memo: LoadMemo): WfRefs {
  const branchManagers: string[] = [];
  for (const b of memo.branches) {
    const m = memo.itam?.managers?.[b.unit];
    if (!m) break;
    branchManagers.push(m);
  }
  return {
    personas: memo.people.personas,
    units: memo.units,
    branches: memo.branches.map((b) => ({ unit: b.unit, name: b.name })),
    branchManagers,
    groups: memo.groups,
    region0: memo.units[`region:${REGIONS[0]}`],
  };
}

/** A live row of `table` by `col` = `value`, and whether it is the pack's own (recorded in sm_demo_rows). */
async function existing(q: Queryable, orgId: string, table: string, col: string, value: string): Promise<{ id: string; demo: boolean; status: string | null } | null> {
  return q.one<{ id: string; demo: boolean; status: string | null }>(
    `select x.id, exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) as demo, ${table === "sm_processes" || table === "sm_field_defs" || table === "sm_forms" ? "x.status" : "null"} as status
     from ${table} x where x.org_id = $1 and x.${col} = $2 and x.deleted_at is null limit 1`,
    [orgId, value],
  );
}

const norm = (s: unknown) => normalizeSearch(String(s ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const list = (xs: string[]) => xs.map((x) => `«${x}»`).join("، ");

// ----- the definitions ----------------------------------------------------------------------------------------------

const DEF_PHASES = ["fields", "forms", "positions", "holders", "people", "processes", "publish"] as const;

/** The step «workflow_defs» (see the header). */
export async function stepWorkflowDefs(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const wf = wfOf(memo);
  const r = refsOf(memo);
  return phased(a, "workflow_defs", DEF_PHASES, async (phase) => {
    if (phase === "fields") {
      const have: string[] = [];
      await sys.write(async (tx) => {
        for (const f of Object.values(WF_FIELDS)) {
          const row = await existing(tx, orgId, "sm_field_defs", "name", f.name);
          if (row && !row.demo) {
            refuse(orgId, `workflow_defs.field:${f.name}`, `فیلد «${f.label}» (${f.name}) با همین نام فنی در سازمان هست؛ فیلد نمونه ساخته نشد`);
            continue;
          }
          if (!row) {
            const made = await savepoint(tx, () =>
              put(tx, sys, "field_def", {
                name: f.name, label: f.label, type: f.type, help: "help" in f ? f.help : null, status: "active",
                ...("options" in f ? { options: f.options.map((o) => ({ ...o })) } : {}),
                ...("validation" in f ? { validation: f.validation } : {}),
                ...("default_value" in f ? { default_value: f.default_value } : {}),
              }),
            ).catch((e: unknown) => {
              refuse(orgId, `workflow_defs.field:${f.name}`, e);
              return null;
            });
            if (!made) continue;
            bump(memo, "field_def");
          }
          have.push(f.name);
        }
      });
      wf.fields = have;
    } else if (phase === "forms") {
      const have = new Set(wf.fields ?? []);
      const forms: Record<string, string> = {};
      await sys.write(async (tx) => {
        for (const form of WF_FORMS) {
          const missing = formFields(form).filter((f) => !have.has(f));
          if (missing.length) {
            refuse(orgId, `workflow_defs.form:${form.key}`, `فرم «${form.name}» ساخته نشد: فیلد ${list(missing)} در بستهٔ نمایشی نیست`);
            continue;
          }
          const row = await existing(tx, orgId, "sm_forms", "name", form.name);
          if (row && !row.demo) {
            refuse(orgId, `workflow_defs.form:${form.key}`, `فرم «${form.name}» با همین نام در سازمان هست؛ فرم نمونه ساخته نشد`);
            continue;
          }
          if (row) {
            forms[form.key] = row.id;
            continue;
          }
          const made = await savepoint(tx, () => put(tx, sys, "form", { name: form.name, description: form.description, layout: form.layout })).catch((e: unknown) => {
            refuse(orgId, `workflow_defs.form:${form.key}`, e);
            return null;
          });
          if (!made) continue;
          forms[form.key] = String(made.id);
          bump(memo, "form");
        }
      });
      wf.forms = forms;
    } else if (phase === "positions") {
      const positions: Record<string, string> = {};
      await sys.write(async (tx) => {
        const all = await tx.query<{ id: string; key: string; name: string; demo: boolean }>(
          `select p.id, p.key, p.name, exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = p.id) as demo from sm_positions p where p.org_id = $1 and p.deleted_at is null`,
          [orgId],
        );
        for (const p of WF_POSITIONS) {
          const same = all.filter((x) => x.key === p.key || norm(x.name) === norm(p.name));
          if (same.some((x) => !x.demo)) {
            refuse(orgId, `workflow_defs.position:${p.key}`, `نقش سازمانی «${p.name}» یا کلید «${p.key}» در سازمان هست؛ نقش نمونه ساخته نشد`);
            continue;
          }
          const mine = same.find((x) => x.key === p.key);
          if (mine) {
            positions[p.key] = mine.id;
            continue;
          }
          const made = await savepoint(tx, () =>
            put(tx, sys, "position", { key: p.key, name: p.name, unit_kind: p.unit_kind, reports_to: p.reports_to ? (positions[p.reports_to] ?? null) : null, active: true, description: p.description }),
          ).catch((e: unknown) => {
            refuse(orgId, `workflow_defs.position:${p.key}`, e);
            return null;
          });
          if (!made) continue;
          positions[p.key] = String(made.id);
          bump(memo, "position");
        }
      });
      wf.positions = positions;
    } else if (phase === "holders") {
      const positions = wf.positions ?? {};
      const today = localDate((wf.at ??= Date.now()), orgTz(sys));
      await sys.write(async (tx) => {
        for (const h of wfHolders(r)) {
          const position = positions[h.position];
          if (!position) continue;
          const twin = await tx.one(
            `select 1 as x from sm_position_holders where org_id = $1 and position_id = $2 and user_id = $3 and org_unit_id is not distinct from $4::uuid and deleted_at is null`,
            [orgId, position, h.user, h.unit],
          );
          if (twin) continue;
          const valid_to = h.ends_in !== undefined ? new Date(Date.parse(`${today}T00:00:00Z`) + h.ends_in * 86_400_000).toISOString().slice(0, 10) : null;
          const made = await savepoint(tx, () => put(tx, sys, "position_holder", { position_id: position, user_id: h.user, org_unit_id: h.unit, kind: h.kind, valid_from: null, valid_to })).catch((e: unknown) => {
            refuse(orgId, `workflow_defs.holder:${h.position}`, e);
            return null;
          });
          if (made) bump(memo, "position_holder");
        }
      });
    } else if (phase === "people") {
      // the pack's own profiles and units only (each a row of the pack): a manager the pack set stays as it is
      const { profiles, units } = wfManagers(r);
      await sys.write(async (tx) => {
        for (const [user, manager] of profiles) {
          const p = await tx.one<{ id: string; manager_id: string | null }>(
            `select p.id, p.manager_id from sm_member_profiles p where p.org_id = $1 and p.user_id = $2 and p.deleted_at is null
               and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = p.id)`,
            [orgId, user],
          );
          if (p && !p.manager_id) await updateIn(tx, sys, "member_profile", p.id, { manager_id: manager }, { trusted: true });
        }
        for (const [unit, manager] of units) {
          const u = await tx.one<{ manager_id: string | null }>(
            `select u.manager_id from sm_org_units u where u.org_id = $1 and u.id = $2 and u.deleted_at is null and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = u.id)`,
            [orgId, unit],
          );
          if (u && !u.manager_id) await updateIn(tx, sys, "org_unit", unit, { manager_id: manager }, { trusted: true });
        }
      });
    } else if (phase === "processes") {
      const forms = wf.forms ?? {};
      const positions = wf.positions ?? {};
      const processes: Record<string, string> = {};
      await sys.write(async (tx) => {
        for (const p of WF_PROCESSES) {
          const missing = [
            ...p.forms.filter((k) => !forms[k]).map((k) => `فرم «${WF_FORMS.find((f) => f.key === k)?.name ?? k}»`),
            ...p.positions.filter((k) => !positions[k]).map((k) => `نقش سازمانی «${WF_POSITIONS.find((x) => x.key === k)?.name ?? k}»`),
            ...p.groups.filter((k) => !memo.groups[k]).map((k) => `گروه «${k}»`),
          ];
          if (missing.length) {
            refuse(orgId, `workflow_defs.process:${p.key}`, `گردش‌کار «${p.name}» ساخته نشد: ${missing.join("، ")} در بستهٔ نمایشی نیست`);
            continue;
          }
          const byKey = await existing(tx, orgId, "sm_processes", "key", p.key);
          const byName = await existing(tx, orgId, "sm_processes", "name", p.name);
          if ((byKey && !byKey.demo) || (byName && !byName.demo) || (byKey && byName && byKey.id !== byName.id)) {
            refuse(orgId, `workflow_defs.process:${p.key}`, `گردش‌کار «${p.name}» یا کلید «${p.key}» در سازمان هست؛ گردش‌کار نمونه ساخته نشد`);
            continue;
          }
          const mine = byKey ?? byName;
          if (mine) {
            processes[p.key] = mine.id;
            continue;
          }
          const made = await savepoint(tx, () => put(tx, sys, "process", { key: p.key, name: p.name, category: p.category, description: p.description, draft: p.draft(r, forms, 1) })).catch((e: unknown) => {
            refuse(orgId, `workflow_defs.process:${p.key}`, e);
            return null;
          });
          if (!made) continue;
          processes[p.key] = String(made.id);
          bump(memo, "process");
        }
      });
      wf.processes = processes;
    } else if (phase === "publish") {
      // «انتشار» through the publish service (its own transaction each), as the system inside the demo scope: the
      // versions and the forms' publish marks are the pack's too. One at a time up to the deadline.
      const done = new Set(wf.published ?? []);
      for (const [key, id] of Object.entries(wf.processes ?? {})) {
        if (done.has(key)) continue;
        if (Date.now() >= a.deadline) return false;
        const row = await sys.db.one<{ status: string; version_no: number }>(`select status, version_no from sm_processes where org_id = $1 and id = $2`, [orgId, id]);
        if (row && row.status !== "published") {
          try {
            await publishProcess(sys, id, { note: "نسخهٔ نمایشی بانک نمونه" });
            bump(memo, "process_version");
          } catch (e) {
            refuse(orgId, `workflow_defs.publish:${key}`, e);
            delete wf.processes![key];
          }
        }
        done.add(key);
        wf.published = [...done];
      }
    }
  });
}

// ----- the sample cases ---------------------------------------------------------------------------------------------

/** A case that cannot go on for this long with nothing of it queued is given up (recorded with the pack's status). */
export const STUCK_MS = 120_000;

interface CaseNow {
  state: string;
  run_ref: string | null;
  open_rounds: Record<string, number> | null;
}

const caseNow = (q: Queryable, orgId: string, id: string) =>
  q.one<CaseNow>(`select state, run_ref, open_rounds from sm_process_cases where org_id = $1 and id = $2 and deleted_at is null`, [orgId, id]);

/** The open tasks of a step's latest round (of one person, when `user` is given). */
async function openTasks(q: Queryable, orgId: string, caseId: string, step: string, user?: string): Promise<{ id: string; assigned_to: string }[]> {
  return q.query<{ id: string; assigned_to: string }>(
    `select t.id, t.assigned_to from sm_process_tasks t
     where t.org_id = $1 and t.case_id = $2 and t.step_key = $3 and t.status = 'open' and t.deleted_at is null and ($4::uuid is null or t.assigned_to = $4::uuid)
       and t.round = (select max(x.round) from sm_process_tasks x where x.org_id = t.org_id and x.case_id = t.case_id and x.step_key = t.step_key and x.deleted_at is null)
     order by t.opened_at, t.id`,
    [orgId, caseId, step, user ?? null],
  );
}

/** Did `user` already decide `step` (an act whose transaction committed before the memo saying so was saved)? */
async function actedOn(q: Queryable, orgId: string, caseId: string, step: string, user: string): Promise<boolean> {
  return !!(await q.one(`select 1 as x from sm_process_tasks where org_id = $1 and case_id = $2 and step_key = $3 and acted_by = $4 and status = 'done' and deleted_at is null limit 1`, [orgId, caseId, step, user]));
}

/**
 * The jobs a case still waits for: its run's flows jobs, and (`timer`) the organisation's workflow timer. `queued`:
 * one of them is waiting to be taken (it runs before the load's next invocation); otherwise they all run elsewhere.
 */
async function pendingJobs(q: Queryable, orgId: string, run: string | null, timer: boolean): Promise<{ any: boolean; queued: boolean }> {
  const rows = await q.query<{ status: string }>(
    `select status from sm_jobs where org_id = $1 and status in ('queued', 'running')
       and ((kind like 'flows.%' and payload ->> 'run' = $2::text) or ($3::bool and kind = 'process.timer' and run_at <= now() + interval '1 minute'))
     limit 20`,
    [orgId, run ?? "", timer],
  );
  return { any: rows.length > 0, queued: rows.some((r) => r.status === "queued") };
}

const CLOSED = new Set(["completed", "rejected", "canceled"]);

/** The step «workflow_cases» (see the header). True when every script is played (or given up). */
export async function stepWorkflowCases(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { cfg, orgId, memo } = a;
  const wf = wfOf(memo);
  const processes = wf.processes ?? {};
  const st = (wf.cases ??= { rows: {} });
  const at = (wf.at ??= Date.now());
  const refs = refsOf(memo);
  const scripts = wfScripts({ ...refs, today: localDate(at, orgTz(sys)), now: at }, memo.size, memo.seed);
  const actor = (who: WfActor): string | undefined => (who.startsWith("bm") ? refs.branchManagers[Number(who.slice(2))] : refs.personas[who as keyof typeof refs.personas]);
  const giveUp = (s: WfScript, why: unknown) => {
    refuse(orgId, `workflow_cases.${s.key}`, why);
    st.rows[s.key] = { ...(st.rows[s.key] ?? { id: uuidv7(), act: 0 }), done: true };
  };
  let progressed = false;
  let queued = false;
  let waiting = false;
  let stuck = false;
  for (const s of scripts) {
    const row = (st.rows[s.key] ??= { id: uuidv7(), act: 0 });
    if (row.done) continue;
    if (!processes[s.process]) {
      // the process was refused (recorded by the definitions): its samples are skipped
      row.done = true;
      continue;
    }
    // the project's second version is published once its sample on version 1 waits (./workflow-samples.ts)
    if (s.process === PROJECT && !s.v1 && !st.v2) {
      waiting = true;
      continue;
    }
    if (Date.now() >= a.deadline) {
      waiting = true;
      break;
    }
    const by = actor(s.by);
    if (!by) {
      giveUp(s, `پروندهٔ نمونه «${s.key}» آغاز نشد: آغازکنندهٔ آن در بستهٔ نمایشی نیست`);
      continue;
    }
    try {
      if (!row.started) {
        // the case's id is in the memo before its start: a start repeated after a lost invocation is «late»
        await startProcess(await memberCtx(cfg, orgId, by), { process: processes[s.process], values: s.values, case_id: row.id });
        row.started = true;
        progressed = true;
        continue;
      }
      const kase = await caseNow(sys.db, orgId, row.id);
      if (!kase) {
        // the start's transaction never committed (it threw after the memo was saved): start again
        row.started = false;
        waiting = true;
        continue;
      }
      const pending = await pendingJobs(sys.db, orgId, kase.run_ref, s.acts.some((x) => "timeout" in x));
      const act = s.acts[row.act];
      if (act && CLOSED.has(kase.state)) {
        giveUp(s, `پروندهٔ نمونه «${s.key}» پیش از پایان سناریو بسته شد (${kase.state})`);
        continue;
      }
      let acted = false;
      if (act && "cancel" in act) {
        if (!pending.any) {
          const who = actor(act.cancel);
          if (!who) throw new Error(`«${act.cancel}» در بستهٔ نمایشی نیست`);
          await cancelCaseAs(await memberCtx(cfg, orgId, who), row.id, { comment: act.comment });
          acted = true;
        }
      } else if (act && "timeout" in act) {
        const open = await openTasks(sys.db, orgId, row.id, act.timeout);
        if (open.length && !pending.any) {
          // the round opened ten days ago and its time ran out an hour ago; the organisation's timer looks now
          const opened = new Date(Date.now() - 10 * 86_400_000).toISOString();
          const due = new Date(Date.now() - 3_600_000).toISOString();
          await sys.write(async (tx: Tx) => {
            for (const t of open) await updateIn(tx, sys, "process_task", t.id, { opened_at: opened, due_at: due }, { trusted: true });
            await wakeTimer(tx, orgId, Date.now());
          });
          acted = true;
        }
      } else if (act) {
        const who = actor(act.as);
        if (!who) throw new Error(`«${act.as}» در بستهٔ نمایشی نیست`);
        const [task] = await openTasks(sys.db, orgId, row.id, act.step, who);
        if (task) {
          await submitStep(await memberCtx(cfg, orgId, who), task.id, { outcome: act.outcome ?? null, values: act.values ?? {}, comment: act.comment ?? null });
          acted = true;
        } else if (!pending.any && (await actedOn(sys.db, orgId, row.id, act.step, who))) acted = true;
      }
      if (acted) {
        row.act++;
        delete row.stuck;
        progressed = true;
        continue;
      }
      if (pending.any) {
        delete row.stuck;
        waiting = true;
        if (pending.queued) queued = true;
        continue;
      }
      if (!act) {
        const open = s.expect.open ?? [];
        const reached = kase.state === s.expect.state && (await Promise.all(open.map((x) => openTasks(sys.db, orgId, row.id, x)))).every((t) => t.length > 0);
        if (reached) {
          row.done = true;
          delete row.stuck;
          progressed = true;
          if (s.v1 && !st.v2) await publishSecond(sys, memo, wf, refs);
          continue;
        }
        if (CLOSED.has(kase.state)) {
          giveUp(s, `پروندهٔ نمونه «${s.key}» به «${kase.state}» رسید، نه «${s.expect.state}»`);
          continue;
        }
      }
      // nothing to do and nothing queued: wait a little, and give up after a while
      row.stuck ??= Date.now();
      if (Date.now() - row.stuck > STUCK_MS) giveUp(s, `پروندهٔ نمونه «${s.key}» پیش نرفت (${kase.state})`);
      else stuck = true;
    } catch (e) {
      giveUp(s, `پروندهٔ نمونه «${s.key}»: ${message(e)}`);
    }
  }
  const left = scripts.some((s) => processes[s.process] && !st.rows[s.key]?.done);
  if (!left) {
    for (const s of scripts) if (st.rows[s.key]?.started) bump(memo, "process_case");
    return true;
  }
  // the next invocation: at once when this one acted or a job of its cases waits in the queue (it runs first), a
  // moment later when they run elsewhere (another worker), or a few seconds when a case is stuck
  memo.wait = progressed || queued ? 0 : waiting ? 500 : stuck ? 2000 : 0;
  return false;
}

/** «گردش کار پروژه» version 2: its step goes to «مدیر گروه (نمونه)» «همه‌جا» (the version 1 case stays on version 1). */
async function publishSecond(sys: Ctx, memo: LoadMemo, wf: WfMemo, refs: WfRefs): Promise<void> {
  const st = wf.cases!;
  st.v2 = true;
  const id = wf.processes?.[PROJECT];
  const proc = WF_PROCESSES.find((p) => p.key === PROJECT);
  if (!id || !proc) return;
  try {
    const row = await sys.db.one<{ version_no: number }>(`select version_no from sm_processes where org_id = $1 and id = $2`, [sys.org.id, id]);
    if (Number(row?.version_no ?? 0) >= 2) return;
    await sys.write((tx) => updateIn(tx, sys, "process", id, { draft: proc.draft(refs, wf.forms ?? {}, 2) }, { trusted: true }));
    await publishProcess(sys, id, { note: "نسخهٔ ۲: «مرحلهٔ فرم» به «مدیر گروه (نمونه)» در همه‌جا می‌رسد" });
    bump(memo, "process_version");
  } catch (e) {
    refuse(sys.org.id, "workflow_cases.project_v2", e);
  }
}
