// `process.delegation` (design F §3.4 «Delegation that starts or ends while a step is open», package F4b): a person's
// open workflow tasks follow their delegation while it is in force — a `delegation` row of the step's scope (approve:
// «تأییدها»; fill and review: «ارجاع کارها»), else the out-of-office delegate of their member profile — through the
// same resolution a step's opening uses (F3's `Resolution`: up to three steps, never in a circle, never to someone
// inactive or excluded from the step, such as the requester of an approval). The job runs when a delegation is
// written and at its start and end, and when an out-of-office switch changes and at its end:
//   · a task of the person moves to the delegate (`assigned_to` = delegate, `delegated_from` = the person), and the
//     delegate is told «مرحله‌ای به جانشینی از … منتظر شماست»;
//   · at the end it moves back if it is still open.
// Each move is journaled on the case, and the case's participants are recomputed (§3.6.5): the delegate reads the
// case while the task is theirs, through the participant source `process`. A demo pack's case moves inside its demo
// scope, any other outside it.
import { exclusionsOf } from "@shared/process/assignees";
import { formStepOf, processNodeLabel } from "@shared/process/graph";
import type { ServerConfig } from "../../../context";
import { pgArray, type Queryable } from "../../../db";
import { inDemoScope, isDemoRow } from "../../../db/scope";
import { systemCtx, updateIn, type RecordEvent } from "../../../engine";
import { enqueue } from "../../../jobs";
import { notifyPeople } from "../../notify/deliver";
import { Resolution } from "../../positions";
import { processesRunHere, refreshCase, resolveInput } from "../engine";
import { caseJournal } from "../engine/journal";
import { caseTasks, isId, loadVersionInfo, lockCase, peopleNames } from "../engine/store";

export const DELEGATION_JOB = "process.delegation";

const msOf = (v: unknown): number => (v instanceof Date ? v.getTime() : v === null || v === undefined || v === "" ? NaN : Date.parse(String(v)));

/** Queue the re-resolution of the open tasks of `users`: now, and at each later instant of `at`. */
export async function queueDelegation(q: Queryable, orgId: string, users: readonly unknown[], at: readonly unknown[] = []): Promise<void> {
  const people = [...new Set(users.filter(isId).map((u) => u.toLowerCase()))].sort();
  if (!people.length) return;
  const key = people.join(",");
  await enqueue(q, { kind: DELEGATION_JOB, orgId, payload: { users: people }, dedupeKey: `${DELEGATION_JOB}:${key}:now`, maxAttempts: 10 });
  for (const t of at.map(msOf)) {
    if (!Number.isFinite(t) || t <= Date.now()) continue;
    await enqueue(q, { kind: DELEGATION_JOB, orgId, payload: { users: people }, delayMs: t - Date.now() + 1000, dedupeKey: `${DELEGATION_JOB}:${key}:${t}`, maxAttempts: 10 });
  }
}

const PROFILE_FIELDS = ["out_of_office", "delegate_id", "ooo_until"];

/** A delegation or an out-of-office switch was written (on the web, a Windows app's push, an import): queue the job. */
export async function delegationChanged(cfg: ServerConfig, e: RecordEvent): Promise<void> {
  if (e.table === "delegation") {
    const r = await cfg.db.one<{ from_user: string | null; to_user: string | null; starts_at: unknown; ends_at: unknown }>(
      `select from_user, to_user, starts_at, ends_at from sm_delegations where org_id = $1 and id = $2`,
      [e.org_id, e.id],
    );
    if (!r) return;
    const was = e.changes?.from_user?.from;
    await queueDelegation(cfg.db, e.org_id, [r.from_user, r.to_user, was], [r.starts_at, r.ends_at]);
    return;
  }
  if (e.table !== "member_profile") return;
  if (e.kind === "record.updated" && !(e.changed ?? []).some((c) => PROFILE_FIELDS.includes(c))) return;
  const r = await cfg.db.one<{ user_id: string | null; delegate_id: string | null; out_of_office: boolean | null; ooo_until: unknown }>(
    `select user_id, delegate_id, out_of_office, ooo_until from sm_member_profiles where org_id = $1 and id = $2`,
    [e.org_id, e.id],
  );
  if (!r || (e.kind === "record.created" && !r.out_of_office)) return;
  await queueDelegation(cfg.db, e.org_id, [r.user_id, r.delegate_id, e.changes?.delegate_id?.from], [r.ooo_until]);
}

/**
 * Move the open tasks of `users` (assigned to them, or standing in for them) to whoever acts for their person now.
 * Returns how many tasks moved.
 */
export async function reresolveTasks(cfg: ServerConfig, orgId: string, users: readonly string[]): Promise<number> {
  const people = users.filter(isId).map((u) => u.toLowerCase());
  if (!people.length || !(await processesRunHere(cfg, orgId))) return 0;
  const cases = await cfg.db.query<{ case_id: string }>(
    `select distinct t.case_id from sm_process_tasks t join sm_process_cases c on c.id = t.case_id and c.deleted_at is null and c.state in ('active', 'waiting')
     where t.org_id = $1 and t.status = 'open' and t.deleted_at is null and (t.assigned_to = any($2::uuid[]) or t.delegated_from = any($2::uuid[]))`,
    [orgId, pgArray(people)],
  );
  const sys = await systemCtx(cfg, orgId);
  let moved = 0;
  for (const { case_id } of cases) {
    // a case of the demo pack's is moved inside its demo scope (its journal and notices are the pack's), any other
    // outside it, whoever queued the job
    const demo = await isDemoRow(cfg.db, orgId, String(case_id));
    moved += await inDemoScope(demo ? orgId : null, () => sys.write(async (tx) => {
      const kase = await lockCase(tx, orgId, String(case_id));
      if (!kase || (kase.state !== "active" && kase.state !== "waiting")) return 0;
      const version = await loadVersionInfo(tx, orgId, kase.version_id);
      if (!version) return 0;
      const tasks = await caseTasks(tx, orgId, kase.id);
      let n = 0;
      for (const t of tasks) {
        if (t.status !== "open" || !(people.includes(String(t.assigned_to)) || people.includes(String(t.delegated_from)))) continue;
        const node = version.graph.nodes.find((x) => x.id === t.step_key && x.type === "form_step");
        if (!node) continue;
        const step = formStepOf(node.config);
        const label = processNodeLabel(node);
        const principal = String(t.delegated_from ?? t.assigned_to);
        const run = new Resolution(tx, sys, resolveInput(kase, version, tasks, step, label));
        const [r] = await run.settle([{ user: principal, via: { rule: 0, kind: "users" } }], run.excluded(exclusionsOf(step, step.action)));
        if (!r) continue;
        const delegatedFrom = r.delegatedFrom ?? null;
        if (r.user === t.assigned_to && delegatedFrom === (t.delegated_from ?? null)) continue;
        await updateIn(tx, sys, "process_task", t.id, { assigned_to: r.user, delegated_from: delegatedFrom }, { trusted: true });
        const was = t.assigned_to;
        t.assigned_to = r.user;
        t.delegated_from = delegatedFrom;
        const names = await peopleNames(tx, [principal, r.user, was]);
        const name = (u: string | null) => (u ? names.get(u) ?? "—" : "—");
        if (delegatedFrom) {
          await caseJournal(tx, sys, kase, `«${label}» به جانشینی از ${name(principal)} به ${name(r.user)} سپرده شد`, { data: { task: t.id, from: was, to: r.user } });
          await notifyPeople(tx, orgId, {
            table: "process_case", id: kase.id, users: [r.user], event: "custom", label: "مرحله‌ای به جانشینی", channels: ["in_app", "email"], actor: null, source: "گردش‌کارها",
            subject: `مرحله‌ای به جانشینی از ${name(principal)} منتظر شماست`, body: `«${label}» از پروندهٔ ${kase.number ?? ""} «${kase.title ?? ""}»`,
          });
        } else {
          await caseJournal(tx, sys, kase, `جانشینی پایان یافت؛ «${label}» به ${name(r.user)} بازگشت`, { data: { task: t.id, from: was, to: r.user } });
        }
        n++;
      }
      if (n) await refreshCase(tx, sys, kase, version.graph, { tasks });
      return n;
    }));
  }
  return moved;
}
