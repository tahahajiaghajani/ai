// The upload of a standalone Windows app's organisation (design F §7.2, package F4b) is an ordinary push of every local
// row by the owner, after the link flow checked it has no open case (./link.ts). The push guards of the workflow tables
// (../access/guards.ts) refuse members' writes to cases, tasks, versions, publish fields and others' submissions; this
// rule lets the upload through as a second guard: CREATES of finished data — closed cases, their closed tasks and
// settled submissions, published versions and processes — by the organisation's owner holding `process_design`
// approve. Never an update, never a deletion, never an open case or anything of one, never another member's push, and
// never a new version of a process this authority already holds (versions come with their process only).
// And only during the upload itself: «/sync/adopt», which creates the organisation here from the Windows app's copy,
// opens a window for the account that adopted it (`openUploadWindow`, UPLOAD_WINDOW_MS); an organisation that already
// lives here never opens one again. Outside it the authority's own history — who approved what, and when — is never
// written by a push (§6.4: people never write these rows). Within it, a task or a submission joins only a case the same
// upload brings (absent here yet, or stored from a push): a case this authority ran keeps its own history.
import { grantIn } from "@shared/access";
import type { Queryable } from "../../../db";
import type { Ctx } from "../../../context";
import { subjectOf } from "../../../access";
import { isSystemCtx, type PushArgs } from "../../../engine";
import { isId } from "../engine/store";
import { OPEN_CASE_STATES as OPEN } from "./link";

const FINISHED_CASE = new Set(["completed", "rejected", "canceled"]);
const FINISHED_TASK = new Set(["done", "not_needed", "canceled"]);
const SETTLED_SUBMISSION = new Set(["applied", "late", "refused"]);

/** How long after «/sync/adopt» the adopting account's pushes may bring finished workflow data (§7.2). */
export const UPLOAD_WINDOW_MS = 6 * 3_600_000;
/** The window's sm_kv key: `{ user, until }`. */
export const uploadWindowKey = (orgId: string) => `process.upload:${orgId.toLowerCase()}`;

/**
 * Open the upload window of an organisation «/sync/adopt» has just created here from a standalone Windows app (in the
 * transaction that creates it): its owner's pushes may bring the app's finished workflow data until `UPLOAD_WINDOW_MS`.
 */
export async function openUploadWindow(q: Queryable, orgId: string, userId: string, now = Date.now()): Promise<void> {
  await q.query(
    `insert into sm_kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [uploadWindowKey(orgId), JSON.stringify({ user: userId.toLowerCase(), until: new Date(now + UPLOAD_WINDOW_MS).toISOString() })],
  );
}

/** Is the organisation's upload window open for this account (the one that adopted it, before it closes)? */
export async function uploadWindowOpen(q: Queryable, orgId: string, userId: string, now = Date.now()): Promise<boolean> {
  const r = await q.one<{ value: { user?: unknown; until?: unknown } | null }>(`select value from sm_kv where key = $1`, [uploadWindowKey(orgId)]);
  const v = r?.value;
  return !!v && String(v.user ?? "") === userId.toLowerCase() && Date.parse(String(v.until ?? "")) > now;
}

/**
 * May a pushed task or submission of the upload name this case? A case absent here (the upload brings it, perhaps in a
 * later page) or a closed case an upload stored — a pushed row carries its device as `origin`, the authority's own
 * writes the authority's. A case this authority ran never takes uploaded steps or decisions.
 */
async function caseOfUpload(q: Queryable, ctx: Ctx, caseId: unknown): Promise<boolean> {
  if (!isId(caseId)) return true;
  const r = await q.one<{ state: string; org_id: string; origin: string | null }>(`select state, org_id, origin from sm_process_cases where id = $1`, [caseId.toLowerCase()]);
  return !r || (r.org_id === ctx.org.id && !OPEN.includes(r.state) && (r.origin ?? null) !== (ctx.cfg.origin ?? null));
}

/**
 * May an upload bring this version? Only a version of a process absent here, or one whose stored row (pushed first
 * in an upload) already declares at least that number — and only a number this process never had here. A pushed
 * version of a process published here would otherwise put a new graph live without a publish (a start that names it
 * runs on it): no approval, no audit entry, no diff.
 */
async function versionUploadable(q: Queryable, orgId: string, processId: unknown, no: unknown): Promise<boolean> {
  const n = Number(no);
  if (!isId(processId) || !Number.isInteger(n) || n < 1) return false;
  const proc = await q.one<{ org_id: string; version_no: number | null }>(`select org_id, version_no from sm_processes where id = $1`, [processId.toLowerCase()]);
  if (proc && (proc.org_id !== orgId || Number(proc.version_no ?? 0) < n)) return false;
  const taken = await q.one(`select 1 as x from sm_process_versions where process_id = $1 and version_no = $2 limit 1`, [processId.toLowerCase(), n]);
  return !taken;
}

/** Holds the pushing account `process_design` approve (the publisher's grant; the owner's)? */
function approves(p: PushArgs): boolean {
  try {
    return grantIn(subjectOf(p.ctx).eff, "process_design").approve === true;
  } catch {
    return false;
  }
}

/** The upload rule (registered with `setUploadRule`): the owner's push of finished workflow data, during the upload. */
export async function uploadAllowed(p: PushArgs): Promise<boolean> {
  if (p.prev || isSystemCtx(p.ctx) || p.ctx.member?.role !== "owner" || !approves(p)) return false;
  if (!(await uploadWindowOpen(p.tx, p.ctx.org.id, p.ctx.user.id))) return false;
  const n = p.next;
  switch (p.def.key) {
    case "process_case":
      return FINISHED_CASE.has(String(n.state));
    case "process_task":
      return FINISHED_TASK.has(String(n.status)) && (await caseOfUpload(p.tx, p.ctx, n.case_id));
    case "process_submission":
      return SETTLED_SUBMISSION.has(String(n.result)) && (await caseOfUpload(p.tx, p.ctx, n.case_id));
    case "process_version":
      return versionUploadable(p.tx, p.ctx.org.id, n.process_id, n.version_no);
    case "process":
      return n.status === "published" || n.status === "retired";
    default:
      return false;
  }
}
