// Who writes workflow rows (design F §3.5–3.6, §6.4, package F4b), on every path: the record API, imports, flows'
// record steps, and a Windows app's push (which runs no `beforeWrite`, hence the `validatePush` twins):
//   · cases, tasks and published versions — only the server code that owns them, writing trusted (the workflow engine,
//     the publish service); the system may still delete or restore them (retention, purge). People never write them:
//     a person acts by creating a submission, which the authority applies as the system (§3.6.4);
//   · a case takes no attachment from people (files come with submissions); readers may comment;
//   · a process's status, version and publish stamps — only the publish service (trusted); a published process is
//     retired, never deleted;
//   · submissions — people create their own (the row rule: `submitted_by` is me); nobody but the system changes or
//     deletes them afterwards. A pushed submission starts `pending`, with no result and no «به نیابت از» of its own —
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

export const submissionHooks: Pick<TableHooks, "beforeWrite" | "derivePush" | "validatePush" | "validatePushDelete"> = {
  beforeWrite(w) {
    if (owned(w)) return;
    if (w.op !== "create") throw forbidden(SUBMISSION_KEPT);
    // whom a person acted for is the authority's to say (the apply fills it in)
    if (!isSystemCtx(w.ctx)) w.next.on_behalf_of = null;
  },
  async derivePush(p) {
    if (p.prev || (await uploaded(p))) return null;
    return { result: "pending", result_note: null, applied_at: null, on_behalf_of: null };
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
