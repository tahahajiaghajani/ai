// `applySubmission` (design F §3.6.4, F4a): what a person did — a start, a step or a cancel — applied to the case in
// ONE transaction on the authority (online right after the submission is created; for a Windows app's push, when it
// arrives — F4b's subscriber). The submission's row is locked first, so a submission is applied once however often
// it is offered; then the case's row (every writer of a case takes it).
//   · step: the task must be open, its round open and its wait still there (else «late»: the values stay on the
//     submission, nothing is applied), and the submitter its person, the person it stands in for, or their delegate
//     now. Keys outside the person's rights (`effectiveRights` of the version's form, the step's rights and their
//     field groups) are dropped and counted; the values are checked against the version's snapshot (required fields
//     bind submit and approve, a comment binds reject and return; files must be the submission's own); then merged
//     key by key, the submission's files copied to the case. The task closes, a journal entry records the decision,
//     and the round settles by the step's rule — the first submit for fill and review, `levelOutcome` of the shared
//     approval maths for an approve quorum, any «بازگشت» at once: the round's other tasks become «دیگر لازم نیست»,
//     the case is recomputed and the step's wait resumes with the decision's port in the same transaction.
//   · start: the starters are checked; the case is created with the submission's `case_id` (once: a second start of
//     the same id is late), on the submission's version (graph, forms, title) but with the starters and the access
//     settings (managers, manager groups, confidential) of the process's current version, which a publish pushes to
//     every case, its values checked with the start step's rights, its title from the version's template,
//     the round-1 start task recorded as done, and the run started (trigger kind `process`, the case as its record).
//   · cancel: the requester, while no step after the start has been done; the open tasks close as «لغو» and the run
//     is canceled after the commit.
// Refusals carry Persian messages (field messages under `problems`); the online services (./service.ts) turn them
// into a 400 that rolls the submission back, a pushed one keeps them in `result_note`.
import type { FieldDef, FieldGroup } from "@shared/model/types";
import { FIELD_GROUPS } from "@shared/model/types";
import { effectiveRights, type Right } from "@shared/forms/layout";
import { snapshotFields } from "@shared/forms/snapshot";
import { attachmentIds } from "@shared/forms/validators";
import { formatFieldMoney } from "@shared/forms/fieldtypes";
import { formatJalali } from "@shared/jalali";
import { levelOutcome } from "@shared/sla/approvals";
import { localDate } from "@shared/model/jalali-buckets";
import { uuidv7 } from "@shared/id";
import { faDigits } from "@shared/format";
import { delegationScope, type AssigneeRule } from "@shared/process/assignees";
import {
  formStepOf, OUTCOME_PORT, outEdges, processNodeLabel, quorumOf, startOf, stepOutcomes, type FormStep, type StepOutcome,
} from "@shared/process/graph";
import { renderTitle } from "@shared/process/title";
import type { Ctx } from "../../../context";
import { lockKey, pgArray, type Tx } from "../../../db";
import { notFound } from "../../../http/errors";
import { memberCtx } from "../../../access";
import { access } from "../../../access/provider";
import { condEnv, createIn, emitEvent, orgTz, updateIn } from "../../../engine";
import { enqueue } from "../../../jobs";
import { resumeFlowWait, startRun } from "../../flows";
import { activeDelegations, delegateOf } from "../../sla/approvals";
import { checkFormRefs, checkFormValues } from "../../forms";
import { Resolution } from "../../positions";
import { caseJournal } from "./journal";
import { OPEN_STATES, refreshCase } from "./progress";
import { caseTasks, isId, loadVersionInfo, lockCase, peopleNames, stepWaitKey, type CaseRow, type SubmissionRow, type TaskRow, type VersionInfo } from "./store";

export type ApplyOutcome = "applied" | "late" | "refused";

export interface ApplyResult {
  result: ApplyOutcome;
  /** what the person is told (Persian) */
  note: string | null;
  /** field → message (refused) */
  problems: Record<string, string>;
  caseId: string | null;
  /** the step's round settled with this decision */
  settled: StepOutcome | null;
  /** fields of the submission the apply fills in (the task's case, step and round; whom it acted for) */
  patch?: Record<string, unknown>;
}

/** «دیرهنگام»: the step was settled or withdrawn before this submission arrived. */
export const LATE_NOTE = "این مرحله را همکارتان پیش‌تر انجام داده بود؛ آنچه نوشتید نگه داشته شد ولی در پرونده ثبت نشد";
/** A case a process manager paused takes no decision until it is resumed (F4c). */
export const PAUSED_NOTE = "این پرونده را مسئولان گردش‌کار موقتاً متوقف کرده‌اند؛ پس از ادامهٔ آن، مرحله را دوباره بفرستید";
/** A comment binds reject and return. */
export const COMMENT_NEEDED = "برای رد یا بازگشت، توضیح بنویسید";

const ALL_GROUPS = Object.keys(FIELD_GROUPS) as FieldGroup[];
const iso = (ms: number) => new Date(ms).toISOString();
const refused = (note: string | null, problems: Record<string, string> = {}, caseId: string | null = null): ApplyResult => ({ result: "refused", note, problems, caseId, settled: null });
const late = (note: string, caseId: string | null): ApplyResult => ({ result: "late", note, problems: {}, caseId, settled: null });

/** The submitter as an apply sees them: an active member, with their field groups and their identity for conditions. */
interface Submitter {
  user: string;
  name: string;
  groups: FieldGroup[];
  ctx: Ctx;
}

async function submitterOf(tx: Tx, sys: Ctx, userId: string | null): Promise<Submitter | null> {
  if (!isId(userId)) return null;
  try {
    const ctx = await memberCtx(sys.cfg, sys.org.id, userId.toLowerCase(), tx);
    return { user: ctx.user.id, name: ctx.user.full_name || ctx.user.email, groups: ALL_GROUPS.filter((g) => access().hasFieldGroup(ctx, g)), ctx };
  } catch {
    return null;
  }
}

/**
 * Apply submission `submissionId` (inside the caller's transaction, as the system). A submission already applied,
 * late or refused returns its stored result: it is applied once.
 */
export async function applySubmission(tx: Tx, sys: Ctx, submissionId: string): Promise<ApplyResult> {
  const sub = isId(submissionId)
    ? await tx.one<SubmissionRow>(`select * from sm_process_submissions where org_id = $1 and id = $2 and deleted_at is null for update`, [sys.org.id, submissionId.toLowerCase()])
    : null;
  if (!sub) throw notFound("ثبت مرحله پیدا نشد");
  if (sub.result && sub.result !== "pending") return { result: sub.result as ApplyOutcome, note: sub.result_note, problems: {}, caseId: sub.case_id, settled: null };
  const who = await submitterOf(tx, sys, sub.submitted_by);
  let r: ApplyResult;
  if (!who) r = refused("ثبت‌کننده عضو فعال این سازمان نیست");
  else if (sub.kind === "start") r = await applyStart(tx, sys, sub, who);
  else if (sub.kind === "step") r = await applyStep(tx, sys, sub, who);
  else if (sub.kind === "cancel") r = await applyCancel(tx, sys, sub, who);
  else r = refused("نوع این ثبت شناخته نیست");
  const messages = [r.note, ...Object.values(r.problems)].filter((x): x is string => !!x);
  await updateIn(
    tx,
    sys,
    "process_submission",
    sub.id,
    { ...r.patch, result: r.result, result_note: messages.length ? [...new Set(messages)].join("؛ ").slice(0, 2000) : null, applied_at: iso(Date.now()) },
    { trusted: true },
  );
  return r;
}

// ----- values ----------------------------------------------------------------------------------------------------

interface Taken {
  values: Record<string, unknown>;
  dropped: string[];
  problems: Record<string, string>;
  defs: Map<string, FieldDef>;
}

/** The submission's files (id → name). */
async function submissionFiles(tx: Tx, orgId: string, subId: string): Promise<Map<string, { name: string }>> {
  const rows = await tx.query<{ id: string; name: string }>(
    `select id, name from sm_attachments where org_id = $1 and table_key = 'process_submission' and record_id = $2 and deleted_at is null`,
    [orgId, subId],
  );
  return new Map(rows.map((r) => [String(r.id), { name: String(r.name) }]));
}

/** The case's files a field already holds (id → name): a value may keep them. */
async function heldFiles(tx: Tx, orgId: string, caseId: string | null, ids: string[]): Promise<Map<string, { name: string }>> {
  if (!caseId || !ids.length) return new Map();
  const rows = await tx.query<{ id: string; name: string }>(
    `select id, name from sm_attachments where org_id = $1 and table_key = 'process_case' and record_id = $2 and id = any($3::uuid[]) and deleted_at is null`,
    [orgId, caseId, pgArray(ids)],
  );
  return new Map(rows.map((r) => [String(r.id), { name: String(r.name) }]));
}

/**
 * The values of `sub` a person may give at `step` (its form in the version's snapshot), coerced and checked — keys
 * outside their rights dropped, required fields binding when `requireAll`, files only the submission's own (or those
 * the field already holds on the case), references to live rows.
 */
async function takeValues(tx: Tx, sys: Ctx, version: VersionInfo, step: FormStep, sub: SubmissionRow, who: Submitter, stored: Record<string, unknown>, caseId: string | null, requireAll: boolean): Promise<Taken> {
  const input = sub.values && typeof sub.values === "object" && !Array.isArray(sub.values) ? sub.values : {};
  const snapshot = version.forms;
  const defs = snapshot ? snapshotFields(snapshot) : new Map<string, FieldDef>();
  if (!step.form || !snapshot?.forms[step.form]) return { values: {}, dropped: Object.keys(input), problems: {}, defs };
  const layout = snapshot.forms[step.form].layout;
  const rights: Record<string, Right> = effectiveRights(layout, step.rights, defs, { groups: who.groups });
  const own = await submissionFiles(tx, sys.org.id, sub.id);
  const heldIds: Record<string, string[]> = {};
  for (const [key, f] of defs) {
    if (f.check !== "attachments") continue;
    const ids = attachmentIds(f, stored[key]).ids ?? [];
    if (ids.length) heldIds[key] = ids;
  }
  const held = await heldFiles(tx, sys.org.id, caseId, Object.values(heldIds).flat());
  const tz = orgTz(sys);
  const r = checkFormValues(snapshot, step.form, input, {
    rights,
    stored,
    requireAll,
    tz,
    today: sub.submitted_at ? localDate(Date.parse(String(sub.submitted_at)), tz) : undefined,
    attachments: new Map([...held, ...own]),
    env: await condEnv(who.ctx),
  });
  const problems = { ...r.problems };
  // a field keeps the case's files it holds; it never takes another field's
  for (const [key, v] of Object.entries(r.values)) {
    const f = defs.get(key);
    if (f?.check !== "attachments" || !Array.isArray(v) || problems[key]) continue;
    if (v.some((id) => !own.has(String(id)) && !(heldIds[key] ?? []).includes(String(id)))) problems[key] = `پیوست‌های «${f.label}» باید از پرونده‌های همین رکورد باشند`;
  }
  if (!Object.keys(problems).length && Object.keys(r.values).length) Object.assign(problems, await checkFormRefs(tx, sys, snapshot, step.form, r.values));
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.values)) if (typeof v !== "symbol") values[k] = v;
  return { values, dropped: r.dropped, problems, defs };
}

/** Copy the submission's files that `values` name to the case (new ids), and name the copies instead. */
async function copyFiles(tx: Tx, sys: Ctx, subId: string, caseId: string, defs: Map<string, FieldDef>, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const named = Object.entries(values).filter(([k, v]) => defs.get(k)?.check === "attachments" && Array.isArray(v) && v.length);
  if (!named.length) return values;
  const files = await tx.query<{ id: string; name: string; mime: string; size: number; sha256: string; uploaded_by: string | null }>(
    `select id, name, mime, size, sha256, uploaded_by from sm_attachments where org_id = $1 and table_key = 'process_submission' and record_id = $2 and deleted_at is null`,
    [sys.org.id, subId],
  );
  const byId = new Map(files.map((f) => [String(f.id), f]));
  const copies = new Map<string, string>();
  const out = { ...values };
  for (const [key, v] of named) {
    const next: string[] = [];
    for (const raw of v as unknown[]) {
      const id = String(raw);
      const f = byId.get(id);
      if (!f) {
        next.push(id);
        continue;
      }
      let copy = copies.get(id);
      if (!copy) {
        copy = uuidv7();
        copies.set(id, copy);
        await tx.query(
          `insert into sm_attachments (id, org_id, table_key, record_id, name, mime, size, sha256, uploaded_by, origin)
           values ($1, $2, 'process_case', $3, $4, $5, $6, $7, $8, $9)`,
          [copy, sys.org.id, caseId, f.name, f.mime, f.size, f.sha256, f.uploaded_by, sys.cfg.origin ?? null],
        );
        await emitEvent(tx, sys, { kind: "record.attachment_added", table: "process_case", id: caseId, data: { attachment_id: copy, name: f.name, mime: f.mime } });
      }
      next.push(copy);
    }
    out[key] = next;
  }
  return out;
}

/** «۲ مقدار … کنار گذاشته شد» — how many keys the person could not change here. */
const droppedNote = (n: number) => (n ? `${faDigits(n)} مقدار که در این مرحله اجازهٔ تغییرشان را نداشتید کنار گذاشته شد` : null);

// ----- start ------------------------------------------------------------------------------------------------------

/** Does the person match one of the starters' rules (a position they hold, a group, a role, named people…)? */
async function isStarter(tx: Tx, sys: Ctx, starters: AssigneeRule[], user: string): Promise<boolean> {
  const run = new Resolution(tx, sys, { step: { assignees: starters }, action: "fill", requestedBy: user });
  for (const [i, rule] of starters.entries()) {
    if (rule.kind === "users" ? rule.users.includes(user) : (await run.rule(rule, i, false)).some((f) => f.user === user)) return true;
  }
  return false;
}

/** The text of a title pill: a start-form field's value as people read it, or a person's name. */
async function titleText(tx: Tx, orgId: string, defs: Map<string, FieldDef>, values: Record<string, unknown>, people: Record<string, string | null>): Promise<(key: string) => string | null> {
  const names = await peopleNames(tx, [...Object.values(people), ...[...defs].filter(([k, f]) => f.type === "user" && isId(values[k])).map(([k]) => String(values[k]))]);
  const unitIds = [...defs].filter(([k, f]) => f.type === "ref" && f.ref === "org_unit" && isId(values[k])).map(([k]) => String(values[k]));
  const units = unitIds.length
    ? new Map((await tx.query<{ id: string; name: string }>(`select id, name from sm_org_units where org_id = $1 and id = any($2::uuid[])`, [orgId, pgArray(unitIds)])).map((u) => [String(u.id), String(u.name)]))
    : new Map<string, string>();
  return (key) => {
    if (key in people) return people[key] ? names.get(people[key]!) ?? null : null;
    const f = defs.get(key);
    const v = values[key];
    if (v === null || v === undefined || v === "") return null;
    if (!f) return typeof v === "object" ? null : String(v);
    if (f.type === "money") return formatFieldMoney(f, v);
    const options = Array.isArray(f.choices) ? f.choices : [];
    if (f.type === "choice") return options.find((o) => o.value === v)?.label ?? String(v);
    if (f.type === "multichoice" && Array.isArray(v)) return v.map((x) => options.find((o) => o.value === x)?.label ?? String(x)).join("، ");
    if (f.type === "date" || f.type === "datetime") return formatJalali(String(v));
    if (f.type === "bool") return v === true ? "بله" : "خیر";
    if (f.type === "user") return names.get(String(v)) ?? null;
    if (f.type === "ref") return units.get(String(v)) ?? null;
    if (Array.isArray(v) || typeof v === "object") return null;
    return typeof v === "number" ? faDigits(v) : String(v);
  };
}

async function applyStart(tx: Tx, sys: Ctx, sub: SubmissionRow, who: Submitter): Promise<ApplyResult> {
  const orgId = sys.org.id;
  const caseId = isId(sub.case_id) ? sub.case_id.toLowerCase() : null;
  if (!caseId) return refused("شناسهٔ پرونده معتبر نیست");
  // two starts of the same case id (a push offered twice, from two devices) take turns: the second finds the case
  await lockKey(tx, `process.case:${caseId}`);
  if (await tx.one(`select 1 as x from sm_process_cases where id = $1`, [caseId])) return late("این پرونده پیش‌تر ثبت شده است", caseId);
  const proc = isId(sub.process_id)
    ? await tx.one<{ id: string; name: string; status: string; current_version_id: string | null }>(
        `select id, name, status, current_version_id from sm_processes where org_id = $1 and id = $2 and deleted_at is null`,
        [orgId, sub.process_id],
      )
    : null;
  if (!proc) return refused("گردش‌کار پیدا نشد");
  if (proc.status !== "published") return refused(proc.status === "retired" ? "این گردش‌کار بازنشسته شده است و درخواست تازه نمی‌پذیرد" : "این گردش‌کار هنوز منتشر نشده است");
  let version = sub.version_id ? await loadVersionInfo(tx, orgId, sub.version_id) : null;
  if (!version || version.process_id !== String(proc.id)) version = await loadVersionInfo(tx, orgId, proc.current_version_id);
  if (!version) return refused("نسخهٔ منتشرشدهٔ این گردش‌کار پیدا نشد");
  // who may start and who may see: the current version's (a start filled on an older one must not bring them back)
  const current = version.id === proc.current_version_id ? version : await loadVersionInfo(tx, orgId, proc.current_version_id);
  if (!current || current.process_id !== String(proc.id)) return refused("نسخهٔ منتشرشدهٔ این گردش‌کار پیدا نشد");
  const { trigger, start } = startOf(version.graph);
  if (!trigger || !start) return refused("طرح این گردش‌کار «ثبت درخواست» ندارد");
  const step = formStepOf(start.config);
  if (current.starters.length && !(await isStarter(tx, sys, current.starters, who.user))) return refused("شما اجازهٔ آغاز این گردش‌کار را ندارید");
  let requestedFor = who.user;
  if (isId(sub.requested_for) && sub.requested_for.toLowerCase() !== who.user) {
    const other = await submitterOf(tx, sys, sub.requested_for);
    if (!other) return refused("کسی که درخواست برای اوست عضو فعال این سازمان نیست");
    requestedFor = other.user;
  }
  const taken = await takeValues(tx, sys, version, step, sub, who, {}, null, true);
  if (Object.keys(taken.problems).length) return refused(null, taken.problems);
  const now = Date.now();
  const label = processNodeLabel(start);
  const text = await titleText(tx, orgId, taken.defs, taken.values, { requested_by: who.user, requested_for: requestedFor });
  const title = renderTitle(version.title_template, text, version.name || String(proc.name));
  // the run first (its id is the case's run), then the case with the submission's id, its files and the start task
  const runId = await startRun(tx, {
    orgId,
    flow: { id: String(proc.id), name: version.name || String(proc.name) },
    version: { id: version.id, no: version.version_no },
    trigger: { kind: "process", table: "process_case", id: caseId, event: "start", actor: who.user, inputs: { submission: sub.id } },
    actorId: who.user,
    runAs: { kind: "system", userId: null },
    depth: 0,
  });
  const names = await peopleNames(tx, [who.user]);
  const kase = (await createIn(
    tx,
    sys,
    "process_case",
    {
      title, process_id: proc.id, process_name: version.name || proc.name, version_id: version.id, version_no: version.version_no, state: "active",
      requested_by: who.user, requested_for: requestedFor, managers: current.managers, manager_groups: current.manager_groups,
      confidential: current.confidential, started_at: iso(now), run_ref: runId, data: taken.values, participants: [who.user],
      progress: {
        [trigger.id]: { status: "done", port: "out", round: 1, at: iso(now) },
        [start.id]: { status: "done", outcome: "submitted", port: "out", round: 1, at: iso(now), actors: [...names.values()] },
      },
      current_steps: [], open_rounds: {},
    },
    { trusted: true, id: caseId },
  )) as unknown as CaseRow;
  const data = await copyFiles(tx, sys, sub.id, caseId, taken.defs, taken.values);
  if (data !== taken.values) await updateIn(tx, sys, "process_case", caseId, { data }, { trusted: true });
  await createIn(
    tx,
    sys,
    "process_task",
    {
      case_id: caseId, case_number: kase.number, case_title: title, process_id: proc.id, version_id: version.id, step_key: start.id, step_label: label,
      action: "fill", round: 1, assigned_to: who.user, status: "done", outcome: "submitted", acted_by: who.user, submission_id: sub.id,
      opened_at: iso(now), closed_at: iso(now),
    },
    { trusted: true },
  );
  await caseJournal(tx, sys, kase, `${who.name} پرونده را ثبت کرد`, { author: who.user, data: { submission: sub.id } });
  return { result: "applied", note: droppedNote(taken.dropped.length), problems: {}, caseId, settled: "submitted", patch: { version_id: version.id, step_key: start.id, round: 1 } };
}

// ----- step -------------------------------------------------------------------------------------------------------

/** What the approvals maths reads of a round's tasks. */
const asApproval = (t: TaskRow) => ({
  state: t.status === "open" ? "requested" : t.status === "done" && (t.outcome === "approved" || t.outcome === "rejected") ? t.outcome : "no_longer_required",
  decided_at: t.closed_at,
});

/** The decision a round settles with after a task closed (null: it waits for more people). */
export function roundSettles(step: Pick<FormStep, "action" | "quorum" | "threshold">, decision: StepOutcome, round: readonly TaskRow[]): StepOutcome | null {
  if (decision === "returned") return "returned";
  if (step.action !== "approve") return decision;
  const o = levelOutcome(round.map(asApproval), quorumOf(step), step.threshold ?? null);
  return o === "approved" || o === "rejected" ? o : null;
}

const VERBS: Record<StepOutcome, string> = { submitted: "ثبت کرد", approved: "تأیید کرد", rejected: "رد کرد", returned: "برای اصلاح بازگرداند" };

async function applyStep(tx: Tx, sys: Ctx, sub: SubmissionRow, who: Submitter): Promise<ApplyResult> {
  const orgId = sys.org.id;
  const first = isId(sub.task_id) ? await tx.one<TaskRow>(`select case_id from sm_process_tasks where org_id = $1 and id = $2 and deleted_at is null`, [orgId, sub.task_id]) : null;
  if (!first) return refused("این مرحله پیدا نشد");
  const kase = await lockCase(tx, orgId, String(first.case_id));
  if (!kase) return refused("پرونده پیدا نشد");
  // under the case's lock: every close of a task of this case has committed or waits behind us
  const task = (await tx.one<TaskRow>(`select * from sm_process_tasks where org_id = $1 and id = $2 for update`, [orgId, sub.task_id]))!;
  const patch: Record<string, unknown> = { case_id: kase.id, step_key: task.step_key, round: task.round, process_id: kase.process_id, version_id: kase.version_id };
  const lateResult = (): ApplyResult => ({ ...late(LATE_NOTE, kase.id), patch });
  if (!OPEN_STATES.has(kase.state) || task.status !== "open" || Number(kase.open_rounds?.[task.step_key]) !== Number(task.round)) return lateResult();
  // the step's wait: gone when a join's cancel_rest withdrew the branch or the run ended (its tasks close next)
  const key = stepWaitKey(kase.id, task.step_key, Number(task.round));
  const wait = await tx.one<{ id: string }>(`select id from sm_flow_waits where org_id = $1 and key = $2 for update`, [orgId, key]);
  if (!wait) return lateResult();
  // paused by a process manager (F4c): nothing is decided until it is resumed; the task stays open
  if (kase.paused_at) return { ...refused(PAUSED_NOTE, {}, kase.id), patch };

  // the person: the task's, the one it stands in for, or a delegate of either now
  const me = who.user;
  let actedFor: string | null = null;
  const version = await loadVersionInfo(tx, orgId, kase.version_id);
  const node = version?.graph.nodes.find((n) => n.id === task.step_key);
  if (!version || !node || node.type !== "form_step") return refused("این مرحله در نسخهٔ گردش‌کار نیست", {}, kase.id);
  const step = formStepOf(node.config);
  if (me === task.assigned_to) actedFor = task.delegated_from ?? null;
  else if (me !== task.delegated_from) {
    const list = await activeDelegations(tx, sys, delegationScope(step.action));
    if (task.assigned_to && delegateOf(list, task.assigned_to) === me) actedFor = task.assigned_to;
    else if (task.delegated_from && delegateOf(list, task.delegated_from) === me) actedFor = task.delegated_from;
    else return { ...refused("این مرحله به شما سپرده نشده است", {}, kase.id), patch };
  }

  // the decision
  const decision = String(sub.outcome ?? (step.action === "approve" ? "" : "submitted")) as StepOutcome;
  const offered = step.start ? (["submitted"] as StepOutcome[]) : stepOutcomes(step.action).filter((o) => o !== "returned" || outEdges(version.graph, node.id, "returned").length > 0);
  if (!offered.includes(decision)) return { ...refused(decision === "returned" ? "این مرحله «بازگشت برای اصلاح» ندارد" : "این تصمیم در این مرحله ممکن نیست", {}, kase.id), patch };
  const comment = String(sub.comment ?? "").trim();
  if ((decision === "rejected" || decision === "returned") && !comment) return { ...refused(null, { comment: COMMENT_NEEDED }, kase.id), patch };
  if (decision === "returned" && sub.return_to && !outEdges(version.graph, node.id, "returned").some((e) => e.target === sub.return_to)) {
    return { ...refused("مرحله‌ای که پرونده به آن بازمی‌گردد معتبر نیست", {}, kase.id), patch };
  }

  // the values: rights, checks, files
  const stored = { ...(kase.data ?? {}) };
  const taken = await takeValues(tx, sys, version, step, sub, who, stored, kase.id, decision === "submitted" || decision === "approved");
  if (Object.keys(taken.problems).length) return { ...refused(null, taken.problems, kase.id), patch };
  const merged = await copyFiles(tx, sys, sub.id, kase.id, taken.defs, taken.values);
  const data = { ...stored };
  for (const [k, v] of Object.entries(merged)) data[k] = v;

  // the task closes, the decision is journaled
  const now = Date.now();
  await updateIn(tx, sys, "process_task", task.id, { status: "done", outcome: decision, comment: comment || null, acted_by: me, acted_for: actedFor, submission_id: sub.id, closed_at: iso(now) }, { trusted: true });
  const label = processNodeLabel(node);
  const forName = actedFor ? (await peopleNames(tx, [actedFor])).get(actedFor) : null;
  await caseJournal(tx, sys, kase, `${who.name} «${label}» را ${VERBS[decision]}${forName ? ` (به جانشینی از ${forName})` : ""}${comment ? `: ${comment}` : ""}`, {
    kind: step.action === "approve" ? "approval" : "system",
    author: me,
    data: { step: node.id, round: task.round, decision, submission: sub.id, on_behalf_of: actedFor },
  });

  // the round: settled by its rule?
  let tasks = await caseTasks(tx, orgId, kase.id);
  const round = tasks.filter((t) => t.step_key === task.step_key && Number(t.round) === Number(task.round));
  const settled = roundSettles(step, decision, round);
  let extra = {};
  if (settled) {
    for (const t of round.filter((x) => x.status === "open")) await updateIn(tx, sys, "process_task", t.id, { status: "not_needed", closed_at: iso(now) }, { trusted: true });
    tasks = await caseTasks(tx, orgId, kase.id);
    const acted = tasks
      .filter((t) => t.step_key === task.step_key && Number(t.round) === Number(task.round) && t.status === "done" && t.acted_by)
      .sort((a, b) => String(a.closed_at ?? "").localeCompare(String(b.closed_at ?? "")));
    const names = await peopleNames(tx, acted.map((t) => t.acted_by));
    const actors = [...new Set(acted.map((t) => names.get(String(t.acted_by)) ?? "—"))];
    const port = OUTCOME_PORT[settled];
    extra = { [node.id]: { status: "done", outcome: settled, port, round: Number(task.round), at: iso(now), actors } };
    await resumeFlowWait(tx, orgId, key, { port, outcome: settled, round: Number(task.round), actors, by: me });
  }
  await refreshCase(tx, sys, kase, version.graph, { tasks, extra, set: { data } });
  return { result: "applied", note: droppedNote(taken.dropped.length), problems: {}, caseId: kase.id, settled, patch: { ...patch, on_behalf_of: actedFor } };
}

// ----- cancel -----------------------------------------------------------------------------------------------------

async function applyCancel(tx: Tx, sys: Ctx, sub: SubmissionRow, who: Submitter): Promise<ApplyResult> {
  const orgId = sys.org.id;
  const kase = isId(sub.case_id) ? await lockCase(tx, orgId, sub.case_id) : null;
  if (!kase) return refused("پرونده پیدا نشد");
  if (!OPEN_STATES.has(kase.state)) return late("این پرونده پیش‌تر بسته شده است", kase.id);
  if (who.user !== kase.requested_by && who.user !== kase.requested_for) return refused("پرونده را فقط درخواست‌دهنده لغو می‌کند", {}, kase.id);
  const version = await loadVersionInfo(tx, orgId, kase.version_id);
  const start = version ? startOf(version.graph).start : null;
  const tasks = await caseTasks(tx, orgId, kase.id);
  if (tasks.some((t) => t.status === "done" && t.step_key !== start?.id)) {
    return refused("پس از انجام نخستین مرحله، پرونده را فقط مسئولان گردش‌کار لغو می‌کنند", {}, kase.id);
  }
  const now = iso(Date.now());
  for (const t of tasks.filter((x) => x.status === "open")) {
    await updateIn(tx, sys, "process_task", t.id, { status: "canceled", closed_at: now }, { trusted: true });
    t.status = "canceled";
  }
  const comment = String(sub.comment ?? "").trim();
  await caseJournal(tx, sys, kase, `${who.name} پرونده را لغو کرد${comment ? `: ${comment}` : ""}`, { author: who.user, data: { submission: sub.id } });
  if (version) await refreshCase(tx, sys, kase, version.graph, { tasks, set: { state: "canceled", outcome: "canceled", ended_at: now } });
  else await updateIn(tx, sys, "process_case", kase.id, { state: "canceled", outcome: "canceled", ended_at: now, current_steps: [], open_rounds: {} }, { trusted: true });
  // the run stops after this commits (its waiting steps then find nothing open)
  if (kase.run_ref) await enqueue(tx, { kind: "process.cancel_run", orgId, payload: { run: kase.run_ref }, dedupeKey: `process.cancel_run:${kase.run_ref}`, maxAttempts: 10 });
  return { result: "applied", note: null, problems: {}, caseId: kase.id, settled: null, patch: { process_id: kase.process_id, version_id: kase.version_id } };
}
