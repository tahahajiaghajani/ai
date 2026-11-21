// A submission that reached the authority without being applied (design F §3.6.3 step 3, §3.6.4–3.6.5, §7.2, package
// F4b): a Windows app's push creates the submission row only — so does a person's own create through the record API —
// and the authority applies it when it arrives (the subscriber to `record.created` on `process_submission`, ./index.ts),
// once: `applySubmission` locks the submission's row first, and a start is applied once per case id.
//   · files: a «پیوست» value names the submission's own attachments (or files the case's field holds already).
//     Attachments push after their record and may come in a later push, or fail: missing ones are waited for — the
//     job `process.apply` looks again every minute — for up to 10 minutes from the arrival; then the submission is
//     refused «پیوست «…» نرسید؛ مرحله را دوباره بفرستید» and its task stays open;
//   · a refused or late result is told to the person; the pull brings them the submission's result and the task.
// Only where cases advance (`processesRunHere`): a linked Windows app records submissions and pushes them.
import type { FieldDef } from "@shared/model/types";
import { snapshotFields } from "@shared/forms/snapshot";
import { attachmentIds } from "@shared/forms/validators";
import type { Ctx, ServerConfig } from "../../../context";
import { pgArray, type Queryable, type Tx } from "../../../db";
import { inDemoScope } from "../../../db/scope";
import { systemCtx, updateIn } from "../../../engine";
import { enqueue } from "../../../jobs";
import { notifyPeople } from "../../notify/deliver";
import { applySubmission, processesRunHere, type ApplyResult } from "../engine";
import { isId, loadVersionInfo, type SubmissionRow } from "../engine/store";

/** The job that looks again for a submission's missing files. */
export const APPLY_JOB = "process.apply";
/** How long missing files are waited for, from the submission's arrival. */
export const FILES_WAIT_MS = 10 * 60_000;
/** How often they are looked for meanwhile. */
const FILES_RETRY_MS = 60_000;

/** «پیوست "…" نرسید» — the refusal after the wait. */
export const filesMissingNote = (labels: string[]) => `پیوست «${labels.join("»، «")}» نرسید؛ مرحله را دوباره بفرستید`;

export type PushedOutcome = ApplyResult["result"] | "waiting" | "skipped";

const iso = (ms: number) => new Date(ms).toISOString();

/** The version whose snapshot judges the submission: its task's case's, or (a start) its own or the process's current one. */
async function versionOf(tx: Tx, orgId: string, sub: SubmissionRow): Promise<{ id: string | null; caseId: string | null; data: Record<string, unknown> }> {
  if (sub.kind === "step" && isId(sub.task_id)) {
    const r = await tx.one<{ version_id: string | null; case_id: string; data: Record<string, unknown> | null }>(
      `select c.version_id, c.id as case_id, c.data from sm_process_tasks t join sm_process_cases c on c.id = t.case_id where t.org_id = $1 and t.id = $2`,
      [orgId, sub.task_id],
    );
    return { id: r?.version_id ?? null, caseId: r?.case_id ?? null, data: r?.data ?? {} };
  }
  if (sub.kind === "start" && isId(sub.process_id)) {
    const r = await tx.one<{ current_version_id: string | null }>(`select current_version_id from sm_processes where org_id = $1 and id = $2`, [orgId, sub.process_id]);
    const own = isId(sub.version_id) ? await tx.one<{ id: string }>(`select id from sm_process_versions where org_id = $1 and id = $2 and process_id = $3`, [orgId, sub.version_id, sub.process_id]) : null;
    return { id: own?.id ?? r?.current_version_id ?? null, caseId: null, data: {} };
  }
  return { id: null, caseId: null, data: {} };
}

/** Labels of the «پیوست» fields whose files have not arrived (neither the submission's own nor held by the case). */
export async function missingFiles(tx: Tx, orgId: string, sub: SubmissionRow): Promise<string[]> {
  const values = sub.values && typeof sub.values === "object" && !Array.isArray(sub.values) ? sub.values : {};
  if (!Object.keys(values).length) return [];
  const v = await versionOf(tx, orgId, sub);
  const version = v.id ? await loadVersionInfo(tx, orgId, v.id) : null;
  if (!version?.forms) return [];
  const defs: Map<string, FieldDef> = snapshotFields(version.forms);
  const wanted = new Map<string, string[]>();
  for (const [key, raw] of Object.entries(values)) {
    const f = defs.get(key);
    if (f?.check !== "attachments") continue;
    const ids = attachmentIds(f, raw).ids ?? [];
    if (ids.length) wanted.set(key, ids);
  }
  if (!wanted.size) return [];
  const all = [...new Set([...wanted.values()].flat())];
  const rows = await tx.query<{ id: string; table_key: string; record_id: string }>(
    `select id, table_key, record_id from sm_attachments where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
    [orgId, pgArray(all)],
  );
  const own = new Set(rows.filter((r) => r.table_key === "process_submission" && String(r.record_id) === sub.id).map((r) => String(r.id)));
  const onCase = new Set(rows.filter((r) => r.table_key === "process_case" && String(r.record_id) === v.caseId).map((r) => String(r.id)));
  const labels: string[] = [];
  for (const [key, ids] of wanted) {
    const f = defs.get(key)!;
    const held = new Set((attachmentIds(f, v.data[key]).ids ?? []).filter((x) => onCase.has(x)));
    if (ids.some((id) => !own.has(id) && !held.has(id))) labels.push(f.label);
  }
  return labels;
}

/**
 * Tell the person a pushed submission was refused or came late. The notice is about their submission, which they
 * always read — a candidate whose task closed as «دیگر لازم نیست» no longer reads the case.
 */
async function tellSubmitter(tx: Tx, orgId: string, sub: SubmissionRow, r: Pick<ApplyResult, "result" | "note" | "problems">): Promise<void> {
  if (!isId(sub.submitted_by) || (r.result !== "refused" && r.result !== "late")) return;
  let label = sub.kind === "start" ? "آغاز پرونده" : sub.kind === "cancel" ? "لغو پرونده" : "مرحله";
  if (sub.kind === "step" && isId(sub.task_id)) {
    const t = await tx.one<{ step_label: string | null }>(`select step_label from sm_process_tasks where org_id = $1 and id = $2`, [orgId, sub.task_id]);
    if (t?.step_label) label = t.step_label;
  }
  await notifyPeople(tx, orgId, {
    table: "process_submission",
    id: sub.id,
    users: [sub.submitted_by],
    event: "custom",
    label: "گردش‌کارها",
    subject: r.result === "late" ? `ثبت شما در «${label}» دیرهنگام رسید` : `ثبت شما در «${label}» پذیرفته نشد`,
    body: [r.note, ...Object.values(r.problems ?? {})].filter((x): x is string => !!x).join("؛ "),
    channels: ["in_app"],
    actor: null,
    source: "گردش‌کارها",
  });
}

/**
 * Is a submission demo work: a row of the demo pack (a pack person's push, or their create through the record API), or
 * a decision about a case of the pack's? Read before its transaction (PGlite has one connection).
 */
export async function demoSubmission(q: Queryable, orgId: string, submissionId: string): Promise<boolean> {
  const r = await q.one<{ demo: boolean }>(
    `select exists (
       select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id in (
         select s.id from sm_process_submissions s where s.org_id = $1 and s.id = $2
         union all select t.case_id from sm_process_submissions s join sm_process_tasks t on t.org_id = s.org_id and t.id = s.task_id where s.org_id = $1 and s.id = $2
         union all select c.id from sm_process_submissions s join sm_process_cases c on c.org_id = s.org_id and c.id::text = s.case_id where s.org_id = $1 and s.id = $2)
     ) as demo`,
    [orgId, submissionId.toLowerCase()],
  );
  return r?.demo === true;
}

/**
 * Apply a submission that waits (pending) on the authority. `since`: when it arrived (the start of the wait for its
 * files); null starts a wait now when files are missing. Returns what happened. Each submission is applied in its own
 * demo scope, whoever applies it — its event job, `process.apply`, or the organisation's own `process.timer`, which
 * re-checks what is still pending outside any demo scope. A submission of the demo pack's (a pack person's push, or
 * their create through the record API) or about a case of the pack's is demo work: the case it starts, its tasks and
 * journal are the pack's rows, its steps go to the pack's people, and the purge takes it. Any other is the
 * organisation's own work, outside the demo scope even when a demo job applies it (docs/DEMO_FA.md).
 */
export async function applyPending(cfg: ServerConfig, orgId: string, submissionId: string, since: number | null): Promise<PushedOutcome> {
  if (!isId(submissionId) || !(await processesRunHere(cfg, orgId))) return "skipped";
  const sys = await systemCtx(cfg, orgId);
  const apply = () => sys.write((tx) => applyPendingIn(tx, sys, submissionId, since));
  return inDemoScope((await demoSubmission(cfg.db, orgId, submissionId)) ? orgId : null, apply);
}

/** `applyPending` inside the caller's transaction (as the system, on the authority). */
export async function applyPendingIn(tx: Tx, sys: Ctx, submissionId: string, since: number | null): Promise<PushedOutcome> {
  const orgId = sys.org.id;
  const sub = await tx.one<SubmissionRow>(`select * from sm_process_submissions where org_id = $1 and id = $2 and deleted_at is null for update`, [orgId, submissionId.toLowerCase()]);
  if (!sub || (sub.result && sub.result !== "pending")) return "skipped";
  const missing = await missingFiles(tx, orgId, sub);
  if (missing.length) {
    const from = since ?? Date.now();
    const left = from + FILES_WAIT_MS - Date.now();
    if (left > 0) {
      await enqueue(tx, { kind: APPLY_JOB, orgId, payload: { submission: sub.id, since: from }, delayMs: Math.min(FILES_RETRY_MS, left), dedupeKey: `${APPLY_JOB}:${sub.id}`, maxAttempts: 20 });
      return "waiting";
    }
    const note = filesMissingNote(missing);
    // the step and the case it was for, as the apply would have recorded them (the task stays open)
    const task = sub.kind === "step" && isId(sub.task_id)
      ? await tx.one<{ case_id: string; step_key: string; round: number; process_id: string | null; version_id: string | null }>(
          `select case_id, step_key, round, process_id, version_id from sm_process_tasks where org_id = $1 and id = $2`,
          [orgId, sub.task_id],
        )
      : null;
    await updateIn(tx, sys, "process_submission", sub.id, { ...(task ?? {}), result: "refused", result_note: note, applied_at: iso(Date.now()) }, { trusted: true });
    await tellSubmitter(tx, orgId, sub, { result: "refused", note, problems: {} });
    return "refused";
  }
  const r = await applySubmission(tx, sys, sub.id);
  await tellSubmitter(tx, orgId, sub, r);
  return r.result;
}

