// Acting online (design F §3.6.3 step 2, §7.1, F4a): «آغاز پرونده»، «انجام مرحله» and «لغو پرونده» as ONE
// transaction — the submission created as the system for the person (with the files they send), then applied. On a
// runtime that does not advance cases (a Windows app linked to a web version, `processesRunHere`), only the
// submission is recorded: it pushes as a create and the authority applies it («در صف ارسال»).
//   · refused: a 400 with the field messages (or a 409 with the reason) — the transaction, the submission included,
//     rolls back;
//   · late: the submission stays (its values kept), and the person is told why nothing changed.
// F4c's routes call these; values of a «پیوست» field name the files sent with the call as `{ upload: <index> }`.
import type { Ctx } from "../../../context";
import { uuidv7 } from "@shared/id";
import { addAttachmentIn, createIn, orgSchema, systemCtx, updateIn, validationError, type UploadFile } from "../../../engine";
import { bad, conflict, notFound } from "../../../http/errors";
import { applySubmission, type ApplyOutcome } from "./apply";
import { processesRunHere } from "./here";
import { isId } from "./store";

export interface SubmitResult {
  submission: string;
  /** pending: recorded here, applied by the authority once pushed */
  result: ApplyOutcome | "pending";
  note: string | null;
  case: string | null;
}

export interface StartCaseInput {
  /** the process's id or key */
  process: string;
  values?: Record<string, unknown>;
  requested_for?: string | null;
  /** the case's id chosen by the caller (default: a new one) */
  case_id?: string | null;
  files?: UploadFile[];
}

export interface SubmitTaskInput {
  outcome?: string | null;
  comment?: string | null;
  values?: Record<string, unknown>;
  return_to?: string | null;
  files?: UploadFile[];
}

const iso = (ms: number) => new Date(ms).toISOString();

/** `{ upload: n }` in a value → the id of the n-th file sent with the call. */
function nameUploads(values: Record<string, unknown> | undefined, ids: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    out[k] = Array.isArray(v)
      ? v.map((x) => (x && typeof x === "object" && "upload" in (x as object) ? ids[Number((x as { upload: unknown }).upload)] ?? null : x)).filter((x) => x !== null)
      : v;
  }
  return out;
}

async function submit(ctx: Ctx, row: Record<string, unknown>, files: UploadFile[] = []): Promise<SubmitResult> {
  if (ctx.actor === "system" || !ctx.user?.id) throw bad("این کار را باید یکی از اعضای سازمان انجام دهد");
  if (files.length > 50) throw bad("حداکثر ۵۰ پرونده با هر ثبت فرستاده می‌شود");
  const here = await processesRunHere(ctx.cfg, ctx.org.id);
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  // warm the per-request caches outside the transaction (PGlite has one connection)
  await orgSchema(ctx);
  await orgSchema(sys);
  return sys.write(async (tx) => {
    const sub = await createIn(tx, sys, "process_submission", { ...row, values: row.values ?? {}, submitted_by: ctx.user.id, submitted_at: iso(Date.now()), result: "pending" }, { trusted: true });
    if (files.length) {
      const def = (await orgSchema(sys, tx)).def("process_submission")!;
      const ids: string[] = [];
      for (const f of files) ids.push((await addAttachmentIn(tx, ctx, def, String(sub.id), f)).id);
      await updateIn(tx, sys, "process_submission", String(sub.id), { values: nameUploads(row.values as Record<string, unknown>, ids) }, { trusted: true });
    }
    if (!here) return { submission: String(sub.id), result: "pending", note: null, case: (row.case_id as string | null) ?? null };
    const r = await applySubmission(tx, sys, String(sub.id));
    if (r.result === "refused") throw Object.keys(r.problems).length ? validationError(r.problems) : conflict(r.note ?? "این ثبت پذیرفته نشد");
    return { submission: String(sub.id), result: r.result, note: r.note, case: r.caseId };
  });
}

/** «آغاز پرونده»: start a case of a published process. */
export async function startCase(ctx: Ctx, input: StartCaseInput): Promise<SubmitResult> {
  const ref = String(input.process ?? "").trim();
  const proc = await ctx.db.one<{ id: string }>(
    `select id from sm_processes where org_id = $1 and deleted_at is null and ${isId(ref) ? "id = $2::uuid" : "key = $2"}`,
    [ctx.org.id, isId(ref) ? ref.toLowerCase() : ref],
  );
  if (!proc) throw notFound("گردش‌کار پیدا نشد");
  const caseId = isId(input.case_id) ? input.case_id.toLowerCase() : uuidv7();
  return submit(ctx, { kind: "start", process_id: proc.id, case_id: caseId, values: input.values ?? {}, requested_for: input.requested_for ?? null }, input.files);
}

/** «انجام مرحله»: decide or fill an open task of mine. */
export async function submitTask(ctx: Ctx, taskId: string, input: SubmitTaskInput): Promise<SubmitResult> {
  const task = isId(taskId)
    ? await ctx.db.one<{ id: string; case_id: string; step_key: string; round: number; process_id: string | null; version_id: string | null }>(
        `select id, case_id, step_key, round, process_id, version_id from sm_process_tasks where org_id = $1 and id = $2 and deleted_at is null`,
        [ctx.org.id, taskId.toLowerCase()],
      )
    : null;
  if (!task) throw notFound("این مرحله پیدا نشد");
  return submit(
    ctx,
    {
      kind: "step", task_id: task.id, case_id: task.case_id, step_key: task.step_key, round: task.round, process_id: task.process_id, version_id: task.version_id,
      outcome: input.outcome ?? null, comment: input.comment ?? null, values: input.values ?? {}, return_to: input.return_to ?? null,
    },
    input.files,
  );
}

/** «لغو پرونده» by its requester (before any step after the start was done). */
export async function cancelCase(ctx: Ctx, caseId: string, input: { comment?: string | null } = {}): Promise<SubmitResult> {
  if (!isId(caseId)) throw notFound("پرونده پیدا نشد");
  return submit(ctx, { kind: "cancel", case_id: caseId.toLowerCase(), comment: input.comment ?? null });
}
