// «دوباره پیدا کردن انجام‌دهنده» (release 1.1.5; the shapes in src/shared/process/waiting.ts): a form step's round that
// waits with nobody to act — nobody was found, or more people than the step takes — runs its rules again:
//   · by the case's managers (`reresolveStep` in ../api/actions.ts, POST /process/cases/:id/reresolve): with the rules
//     of the case's own version and today's holders, or (`rules: "current"`) with the people settings — rules,
//     exclusions, fallback, «اگر کسی پیدا نشد», quorum — the process's current published version has for the same step,
//     only when that step does the same (fill, review, approve); the step's form and rights stay the case version's.
//     Journaled (and audited) whatever it finds;
//   · by the organisation's `process.reresolve` job, a little after holders, positions, group members, groups' roles,
//     members' roles or units, or memberships change — the picker's promise «با پیدا شدن دارنده، مرحله به او می‌رسد»:
//     only rounds that wait with nobody (more than the step takes waits for the managers to choose), with the case
//     version's rules, journaled when someone is found. A round that has any task — a manager gave it to someone — is
//     the managers' and stays as it is, as does a case they paused.
// A re-resolution never skips a step: «از این مرحله بگذرد» counts as «منتظر بماند» here (a skipped approval would be an
// approval nobody gave). Each case under its lock, in a transaction of its own; a case of the demo pack's inside its
// demo scope (docs/DEMO_FA.md), any other outside it. Only where cases advance.
import { formStepOf, quorumOf, type FormStep } from "@shared/process/graph";
import { STEP_ACTION_LABELS, tooManyMessage, poolLimit } from "@shared/process/assignees";
import type { Ctx, ServerConfig } from "../../../context";
import type { Queryable, Tx } from "../../../db";
import { inDemoScope, isDemoRow } from "../../../db/scope";
import { bad } from "../../../http/errors";
import { emitEvent, onRecordEvent, systemCtx } from "../../../engine";
import { enqueue, registerJobHandler } from "../../../jobs";
import { resolveAssignees } from "../../positions";
import { OPEN_STATES, processesRunHere, refreshCase, resolveInput, STEP_OPENED, type CaseRow, type VersionInfo } from "../engine";
import { caseJournal } from "../engine/journal";
import { caseTasks, loadVersionInfo, lockCase, peopleNames, stepWaitKey } from "../engine/store";
import { formNode, managersTold, nobodyLine, openRoundTasks, waitingLine, waitState } from "../engine/waiting";

export const RERESOLVE_JOB = "process.reresolve";
/** Changes of a burst (an import of holders, a directory sync) are taken together: the job runs this long after the first. */
const QUIET_MS = 30_000;

export interface RoundOutcome {
  status: "ok" | "managers" | "nobody" | "too_many";
  people: { user: string; delegatedFrom: string | null }[];
  message: string | null;
  notes: string[];
  label: string;
  round: number;
}

/** Who asked: a manager (named in the journal) or the organisation's job (null). */
export type By = { user: string; name: string } | null;

type PeopleSettings = Pick<FormStep, "assignees" | "exclude" | "fallback" | "ifNobody" | "action" | "quorum" | "threshold">;

/** The people settings of the same step in the process's current published version (same action), else a 400. */
async function currentSettings(tx: Tx, orgId: string, kase: CaseRow, nodeId: string, step: FormStep, label: string): Promise<PeopleSettings> {
  const proc = kase.process_id ? await tx.one<{ current_version_id: string | null }>(`select current_version_id from sm_processes where org_id = $1 and id = $2 and deleted_at is null`, [orgId, kase.process_id]) : null;
  const current = await loadVersionInfo(tx, orgId, proc?.current_version_id);
  const node = current?.graph.nodes.find((n) => n.id === nodeId && n.type === "form_step");
  if (!current || !node) throw bad(`نسخهٔ جاری این گردش‌کار مرحلهٔ «${label}» را ندارد؛ قاعده‌های نسخهٔ پرونده را به کار ببرید`);
  const now = formStepOf(node.config);
  if (now.action !== step.action || !!now.start !== !!step.start) {
    throw bad(`«${label}» در نسخهٔ جاری کار دیگری است («${STEP_ACTION_LABELS[now.action] ?? now.action}» به جای «${STEP_ACTION_LABELS[step.action] ?? step.action}»)؛ قاعده‌های نسخهٔ جاری برای این پرونده به کار نمی‌روند`);
  }
  return { assignees: now.assignees, exclude: now.exclude, fallback: now.fallback, ifNobody: now.ifNobody, action: step.action, quorum: now.quorum, threshold: now.threshold };
}

const namesOf = async (q: Queryable, people: { user: string }[]) => {
  const names = await peopleNames(q, people.map((p) => p.user));
  return people.map((p) => names.get(p.user) ?? "—").join("، ");
};

/**
 * Run the rules of a round that waits for people again (inside the caller's transaction; `kase` locked by it). Opens a
 * task for each person found (the round stays the same: its wait, its due time from now), and otherwise keeps what was
 * found now on the round's wait. null: the step does not wait for people — not open, an open task, its wait taken, or
 * (`onlyNobody`, the organisation's job) a round the managers handled, a paused case, or a round with more people than
 * it takes.
 */
export async function reresolveRoundIn(
  tx: Tx,
  sys: Ctx,
  kase: CaseRow,
  version: VersionInfo,
  nodeId: string,
  opts: { rules?: "case" | "current"; by: By; onlyNobody?: boolean },
): Promise<RoundOutcome | null> {
  const orgId = sys.org.id;
  const round = Number(kase.open_rounds?.[nodeId]);
  const node = formNode(version.graph, nodeId);
  if (!round || !node || !OPEN_STATES.has(kase.state) || kase.state === "attention") return null;
  const tasks = await caseTasks(tx, orgId, kase.id);
  const inRound = tasks.filter((t) => t.step_key === nodeId && Number(t.round) === round);
  if (inRound.some((t) => t.status === "open")) return null;
  // the organisation's job leaves alone a round the managers handled, and a case they paused
  if (opts.onlyNobody && (inRound.length || kase.paused_at)) return null;
  const wait = await tx.one<{ id: string; data: Record<string, unknown> | null; result: unknown }>(
    `select id, data, result from sm_flow_waits where org_id = $1 and key = $2 for update`,
    [orgId, stepWaitKey(kase.id, nodeId, round)],
  );
  if (!wait || wait.result) return null;
  const was = wait.data ?? {};
  if (opts.onlyNobody && (was.reason === "too_many" || (was.reason !== "nobody" && Array.isArray(was.candidates)))) return null;
  const settings: PeopleSettings = opts.rules === "current" ? await currentSettings(tx, orgId, kase, nodeId, node.step, node.label) : node.step;

  let people: { user: string; delegatedFrom: string | null }[] = [];
  let status: RoundOutcome["status"] = "ok";
  let message: string | null = null;
  let notes: string[] = [];
  let candidates: string[] | undefined;
  if (node.step.start) {
    // «ثبت درخواست» reopened by a «بازگشت»: the requester, if they are a member again
    const live = kase.requested_by
      ? await tx.one(`select 1 as x from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.user_id = $2 and m.deleted_at is null and m.is_active and not coalesce(u.disabled, false)`, [orgId, kase.requested_by])
      : null;
    if (live && kase.requested_by) people = [{ user: kase.requested_by, delegatedFrom: null }];
    else {
      status = "nobody";
      notes = ["درخواست‌دهنده عضو فعال سازمان نیست"];
    }
  } else {
    const r = await resolveAssignees(tx, sys, resolveInput(kase, version, tasks, { ...settings, ifNobody: settings.ifNobody === "skip" ? "wait" : settings.ifNobody }, node.label));
    status = r.status;
    message = r.message;
    notes = r.notes;
    candidates = r.candidates;
    people = r.people.map((p) => ({ user: p.user, delegatedFrom: p.delegatedFrom }));
  }
  const current = opts.rules === "current" ? " با قاعده‌های نسخهٔ جاری" : "";
  const asked = opts.by ? `${opts.by.name} (مسئول گردش‌کار) انجام‌دهندهٔ «${node.label}» را${current} دوباره جست` : `با تغییر دارندگان نقش‌ها، گروه‌ها یا نقش‌های دسترسی، انجام‌دهندهٔ «${node.label}» دوباره جسته شد`;
  const author = opts.by?.user ?? null;
  const now = Date.now();

  if (people.length) {
    const { tasks: opened, due } = await openRoundTasks(tx, sys, kase, node, round, people, now);
    await tx.query(`update sm_flow_waits set data = coalesce(data, '{}'::jsonb) - 'reason' - 'message' - 'notes' - 'candidates' where id = $1`, [wait.id]);
    await refreshCase(tx, sys, kase, version.graph, { tasks: [...tasks, ...opened] });
    const to = status === "managers" ? `مسئولان گردش‌کار (${await namesOf(tx, people)})` : await namesOf(tx, people);
    await caseJournal(tx, sys, kase, waitingLine(`${asked}؛ مرحله به ${to} سپرده شد.`, status === "managers" ? notes : []), {
      author,
      data: { step: nodeId, round, reresolved: true, rules: opts.rules ?? "case", to: people.map((p) => p.user) },
    });
    // as when a step opens: «مرحله‌ای منتظر شماست» to the people, and the timer wakes for the step's times
    await emitEvent(tx, sys, {
      kind: STEP_OPENED, table: "process_case", id: kase.id, number: kase.number,
      data: { node: nodeId, label: node.label, round, action: node.step.action, people: people.map((p) => p.user), status, due_at: due, message: null, notes, returned: false, reresolved: true },
    });
    return { status, people, message: null, notes, label: node.label, round };
  }

  // nobody, or more than the step takes: the round's wait keeps what was found now
  const reason = status === "too_many" ? "too_many" : "nobody";
  const line = reason === "too_many" ? message ?? tooManyMessage(poolLimit(settings.action, quorumOf(settings))) : nobodyLine(node.label, await managersTold(tx, orgId, kase));
  await tx.query(`update sm_flow_waits set data = (coalesce(data, '{}'::jsonb) - 'candidates') || $2::jsonb where id = $1`, [wait.id, JSON.stringify(waitState({ reason, message: line, notes, ...(candidates ? { candidates } : {}) }))]);
  if (opts.by) {
    const found = reason === "too_many" ? line : "کسی پیدا نشد";
    await caseJournal(tx, sys, kase, waitingLine(`${asked}؛ ${found}`, notes), { author, data: { step: nodeId, round, reresolved: true, rules: opts.rules ?? "case", waiting: reason, message: line, notes } });
  }
  return { status: reason, people: [], message: line, notes, label: node.label, round };
}

// ----- the organisation's job -------------------------------------------------------------------------------------

/** A case id as the job's cursor, without its dashes: never read as a row the payload names (jobs/index.ts DEMO_JOB_SQL). */
const packId = (id: string) => id.replace(/-/g, "");
const unpackId = (v: unknown): string | null => {
  const s = String(v ?? "");
  return /^[0-9a-f]{32}$/i.test(s) ? `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`.toLowerCase() : null;
};

/**
 * Queue the organisation's re-resolution a little after people's places change — once (a later change while it waits
 * starts its pass from the beginning), and only while some case waits.
 */
export async function queueReresolve(q: Queryable, orgId: string): Promise<void> {
  if (!(await q.one(`select 1 as x from sm_process_cases where org_id = $1 and state = 'waiting' and deleted_at is null limit 1`, [orgId]))) return;
  await enqueue(q, { kind: RERESOLVE_JOB, orgId, delayMs: QUIET_MS, dedupeKey: RERESOLVE_JOB, maxAttempts: 5 });
  await q.query(`update sm_jobs set payload = '{}'::jsonb where org_id = $1 and dedupe_key = $2 and status = 'queued' and payload <> '{}'::jsonb`, [orgId, RERESOLVE_JOB]);
}

export interface PassResult {
  /** rounds that got people */
  found: number;
  /** where the pass stopped at its deadline (null: it went through) */
  after: string | null;
}

/**
 * One pass of the organisation's re-resolution: the waiting cases from `after` on, each round that waits with nobody
 * (`reresolveRoundIn`, `onlyNobody`) with the case version's rules. A case that throws is logged and skipped.
 */
export async function reresolveWaiting(cfg: ServerConfig, orgId: string, opts: { after?: string | null; deadline?: number } = {}): Promise<PassResult> {
  const out: PassResult = { found: 0, after: null };
  if (!(await processesRunHere(cfg, orgId))) return out;
  const sys = await systemCtx(cfg, orgId);
  const deadline = opts.deadline ?? Infinity;
  let after = opts.after ?? null;
  for (;;) {
    const rows = await cfg.db.query<{ id: string }>(
      `select c.id::text as id from sm_process_cases c
       where c.org_id = $1 and c.deleted_at is null and c.state = 'waiting' and c.paused_at is null and ($2::uuid is null or c.id > $2::uuid)
         and exists (select 1 from jsonb_each_text(coalesce(c.open_rounds, '{}'::jsonb)) r(key, value)
                     where not exists (select 1 from sm_process_tasks t where t.org_id = c.org_id and t.case_id = c.id and t.step_key = r.key
                                         and t.round::text = r.value and t.deleted_at is null))
       order by c.id limit 100`,
      [orgId, after],
    );
    if (!rows.length) return out;
    for (const { id } of rows) {
      if (Date.now() > deadline) return { ...out, after };
      try {
        // read before the transaction (PGlite has one connection)
        const demo = await isDemoRow(cfg.db, orgId, id);
        out.found += await inDemoScope(demo ? orgId : null, () =>
          sys.write(async (tx) => {
            let n = 0;
            let kase = await lockCase(tx, orgId, id);
            const version = kase ? await loadVersionInfo(tx, orgId, kase.version_id) : null;
            if (!kase || !version) return 0;
            for (const node of Object.keys(kase.open_rounds ?? {})) {
              const r = await reresolveRoundIn(tx, sys, kase, version, node, { by: null, onlyNobody: true });
              if (r?.people.length) {
                n++;
                kase = (await lockCase(tx, orgId, id)) ?? kase;
              }
            }
            return n;
          }),
        );
      } catch (e) {
        cfg.log.warn(`process.reresolve: case ${id} was not re-resolved`, String((e as Error)?.message ?? e));
      }
      after = id;
    }
  }
}

/** The fields of a member profile whose change may give a waiting step people (roles, unit, manager). */
const PROFILE_FIELDS = ["roles", "org_unit_id", "manager_id"];

let installed = false;

/** The job and what queues it (once per process; from `installProcessTimers`). */
export function installReresolve(): void {
  if (installed) return;
  installed = true;
  registerJobHandler(RERESOLVE_JOB, async (job, jctx) => {
    if (!job.org_id) return;
    const r = await reresolveWaiting(jctx.cfg as ServerConfig, job.org_id, { after: unpackId(job.payload?.after), deadline: jctx.deadline - 500 });
    if (r.after) {
      await jctx.save({ after: packId(r.after) });
      return { again: 0 };
    }
  });
  onRecordEvent(
    "process.reresolve_watch",
    async (e, jctx) => {
      if (!e.org_id) return;
      if (e.table === "member_profile" && e.kind === "record.updated" && !(e.changed ?? []).some((c) => PROFILE_FIELDS.includes(c))) return;
      await queueReresolve(jctx.db, e.org_id);
    },
    { tables: ["position", "position_holder", "group", "group_member", "member_profile", "role"], kinds: ["record.created", "record.updated", "record.deleted"] },
  );
}

