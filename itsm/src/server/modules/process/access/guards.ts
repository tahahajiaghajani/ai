// Who writes workflow rows (design F §3.5–3.6, §6.4, package F4b), on every path: the record API, imports, flows'
// record steps, and a Windows app's push (which runs no `beforeWrite`, hence the `validatePush` twins):
//   · cases, tasks and published versions — only the server code that owns them, writing trusted (the workflow engine,
//     the publish service); the system may still delete or restore them (retention, purge). People never write them:
//     a person acts by creating a submission, which the authority applies as the system (§3.6.4);
//   · a case takes no attachment from people (files come with submissions); readers may comment;
//   · a process's status, version and publish stamps — only the publish service (trusted); a published process is
//     retired, never deleted;
//   · submissions — people create their own (the row rule: `submitted_by` is me), made when the authority takes them;
//     the system creates them only trusted (never a flow's record step); nobody but the system changes or deletes
//     them afterwards. A pushed submission starts `pending`, with no result and no «به نیابت از» of its own —
//     the authority decides whom a person acted for — and must be the pushing account's.
// The one exception is the upload of a standalone organisation (§7.2): F4b's sync part sets `setUploadRule`, and a
// push it accepts (creates of finished data by a holder of `process_design` approve) passes these guards as it is.
import { isSystemCtx, registerHooks, type PushArgs, type SideArgs, type TableHooks, type WriteArgs } from "../../../engine";
import { forbidden } from "../../../http/errors";

export const CASE_WRITE = "پرونده‌های گردش‌کار را فقط خود سامانه به‌روز می‌کند؛ کار هر مرحله را از «گردش‌کارها» انجام دهید";
export const TASK_WRITE = "مرحله‌های گردش‌کار را فقط خود سامانه به‌روز می‌کند؛ کار هر مرحله را از «گردش‌کارها» انجام دهید";
export const VERSION_WRITE = "نسخه‌های گردش‌کار فقط با انتشار ساخته می‌شوند و پس از آن تغییر نمی‌کنند";
export const PROCESS_STATUS_WRITE = "وضعیت، نسخه و انتشار گردش‌کار را فقط «انتشار» و «بازنشسته‌کردن» تغییر می‌دهند";
export const PROCESS_DELETE = "گردش‌کاری که منتشر شده است حذف نمی‌شود؛ آن را بازنشسته کنید";
export const CASE_FILES = "پیوست‌های پرونده فقط همراه ثبت مرحله‌ها می‌آیند";
export const SUBMISSION_KEPT = "ثبت مرحله پس از فرستادن تغییر نمی‌کند و پاک نمی‌شود";
export const SUBMISSION_OWN = "ثبت مرحله از برنامهٔ ویندوز فقط به نام خودتان پذیرفته می‌شود";
export const SUBMISSION_PEOPLE = "مرحله را فقط خود افراد ثبت می‌کنند؛ جریان خودکار به نام کسی مرحله ثبت نمی‌کند";

/** Is this push the upload of a standalone organisation's finished data (§7.2)? Set by F4b's sync part. */
export type UploadRule = (p: PushArgs) => boolean | Promise<boolean>;
let uploadRule: UploadRule = () => false;

/** Let the upload rule of §7.2 through the push guards below (returns the function that removes it). */
export function setUploadRule(rule: UploadRule): () => void {
  const before = uploadRule;
  uploadRule = rule;
  return () => {
    uploadRule = before;
  };
}

const uploaded = async (p: PushArgs): Promise<boolean> => p.ctx.actor !== "system" && (await uploadRule(p)) === true;

/** Server code that owns the rows writes them trusted; the system alone may also delete or restore them. */
const owned = (w: WriteArgs): boolean => !!w.trusted || ((w.op === "delete" || w.op === "restore") && isSystemCtx(w.ctx));

/** Rows only the system writes: refused on the API and on a push (but for the upload of §7.2). */
export function systemOnly(refusal: string): Pick<TableHooks, "beforeWrite" | "validatePush" | "validatePushDelete"> {
  return {
    beforeWrite(w) {
      if (!owned(w)) throw forbidden(refusal);
    },
    async validatePush(p) {
      return p.ctx.actor === "system" || (await uploaded(p)) ? null : refusal;
    },
    validatePushDelete: () => refusal,
  };
}

/** A person adds an attachment to a case: refused (comments are welcome). */
export function caseSideBefore(s: SideArgs): void {
  if (s.kind === "attachment" && !isSystemCtx(s.ctx)) throw forbidden(CASE_FILES);
}

// ----- process: the publish's own fields ----------------------------------------------------------------------------

const PUBLISH_FIELDS = ["status", "version_no", "current_version_id", "published_at", "published_by"] as const;

/** A publish field holds what a new process starts with. */
function pristine(k: (typeof PUBLISH_FIELDS)[number], v: unknown): boolean {
  if (k === "status") return v === null || v === undefined || v === "draft";
  if (k === "version_no") return v === null || v === undefined || Number(v) === 0;
  return v === null || v === undefined || v === "";
}

/** Has the process been published (it has a version, or is past its draft)? */
const published = (row: Record<string, unknown> | null | undefined): boolean => !!row && (!pristine("status", row.status) || !pristine("version_no", row.version_no));

const publishTouched = (op: "create" | "update", next: Record<string, unknown>, changed: ReadonlySet<string>): boolean =>
  PUBLISH_FIELDS.some((k) => (op === "create" ? !pristine(k, next[k]) : changed.has(k)));

export const processHooks: Pick<TableHooks, "beforeWrite" | "validatePush" | "validatePushDelete"> = {
  beforeWrite(w) {
    if (owned(w)) return;
    if (w.op === "delete") {
      if (published(w.prev)) throw forbidden(PROCESS_DELETE);
      return;
    }
    if ((w.op === "create" || w.op === "update") && publishTouched(w.op, w.next, w.changed)) throw forbidden(PROCESS_STATUS_WRITE);
  },
  async validatePush(p) {
    if (p.ctx.actor === "system" || (await uploaded(p))) return null;
    return publishTouched(p.prev ? "update" : "create", p.next, p.changed) ? PROCESS_STATUS_WRITE : null;
  },
  validatePushDelete: (p) => (published(p.prev) ? PROCESS_DELETE : null),
};

// ----- submissions --------------------------------------------------------------------------------------------------

/** What the authority fills in on a submission (a Windows app's copy may lack it). */
const AUTHORITY_FIELDS = ["result", "result_note", "applied_at", "on_behalf_of", "case_id", "step_key", "round", "process_id", "version_id", "submitted_at"] as const;

const instant = (v: unknown): number => (v instanceof Date ? v.getTime() : v === null || v === undefined || v === "" ? NaN : Date.parse(String(v)));

/**
 * When a pushed submission was made, as the apply reads it (relative date limits count from its day): the Windows
 * app's time, never later than its arrival and, for a step, never before its task opened.
 */
async function pushedSubmittedAt(p: PushArgs): Promise<string> {
  const now = Date.now();
  let t = instant(p.next.submitted_at);
  if (!Number.isFinite(t) || t > now) t = now;
  const task = typeof p.next.task_id === "string" && /^[0-9a-f-]{36}$/i.test(p.next.task_id)
    ? await p.tx.one<{ opened_at: unknown }>(`select opened_at from sm_process_tasks where org_id = $1 and id = $2`, [p.ctx.org.id, p.next.task_id])
    : null;
  const opened = instant(task?.opened_at);
  if (Number.isFinite(opened) && t < opened) t = Math.min(opened, now);
  return new Date(t).toISOString();
}

export const submissionHooks: Pick<TableHooks, "beforeWrite" | "derivePush" | "validatePush" | "validatePushDelete"> = {
  beforeWrite(w) {
    if (owned(w)) return;
    if (w.op !== "create") throw forbidden(SUBMISSION_KEPT);
    // the system writes submissions only trusted (the online services): a flow's record step, which runs as the
    // system, would otherwise decide a step in anyone's name — the subscriber applies every pending submission
    if (isSystemCtx(w.ctx)) throw forbidden(SUBMISSION_PEOPLE);
    // whom a person acted for is the authority's to say (the apply fills it in); a create through the record API is
    // made now — relative date limits count from the day the authority took it, as online
    w.next.on_behalf_of = null;
    w.next.submitted_at = new Date().toISOString();
  },
  async derivePush(p) {
    // the same submission sent again (the answer to the first push was lost): what the authority filled in stays, so
    // an unchanged copy is no change — its outbox row clears, and the next pull brings the result
    if (p.prev) return Object.fromEntries(AUTHORITY_FIELDS.map((k) => [k, p.prev![k] ?? null]));
    if (await uploaded(p)) return null;
    const out: Record<string, unknown> = { result: "pending", result_note: null, applied_at: null, on_behalf_of: null, submitted_at: await pushedSubmittedAt(p) };
    // a start from a Windows app that holds only the published versions names its version: the process is the version's
    if (!p.next.process_id && typeof p.next.version_id === "string" && /^[0-9a-f-]{36}$/i.test(p.next.version_id)) {
      const v = await p.tx.one<{ process_id: string }>(`select process_id from sm_process_versions where org_id = $1 and id = $2`, [p.ctx.org.id, p.next.version_id]);
      if (v) out.process_id = v.process_id;
    }
    return out;
  },
  async validatePush(p) {
    if (p.ctx.actor === "system" || (await uploaded(p))) return null;
    // a stored submission comes back only unchanged (an outbox sent twice)
    if (p.prev) return p.changed.size ? SUBMISSION_KEPT : null;
    return String(p.next.submitted_by ?? "").toLowerCase() === p.ctx.user.id.toLowerCase() ? null : SUBMISSION_OWN;
  },
  validatePushDelete: () => SUBMISSION_KEPT,
};

let installed = false;

/** Register the write guards of the workflow tables (idempotent). */
export function installProcessGuards(): void {
  if (installed) return;
  installed = true;
  registerHooks("process_case", { ...systemOnly(CASE_WRITE), beforeSide: caseSideBefore });
  registerHooks("process_task", systemOnly(TASK_WRITE));
  registerHooks("process_version", systemOnly(VERSION_WRITE));
  registerHooks("process", processHooks);
  registerHooks("process_submission", submissionHooks);
}
