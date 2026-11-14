// The upload of a standalone Windows app's organisation (design F §7.2, package F4b) is an ordinary push of every local
// row by the owner, after the link flow checked it has no open case (./link.ts). The push guards of the workflow tables
// (../access/guards.ts) refuse members' writes to cases, tasks, versions, publish fields and others' submissions; this
// rule lets the upload through as a second guard: CREATES of finished data — closed cases, their closed tasks and
// settled submissions, published versions and processes — by an account holding `process_design` approve. Never an
// update, never a deletion, never an open case or anything of one.
import { grantIn } from "@shared/access";
import type { Queryable } from "../../../db";
import { subjectOf } from "../../../access";
import { isSystemCtx, type PushArgs } from "../../../engine";
import { isId } from "../engine/store";
import { OPEN_CASE_STATES as OPEN } from "./link";

const FINISHED_CASE = new Set(["completed", "rejected", "canceled"]);
const FINISHED_TASK = new Set(["done", "not_needed", "canceled"]);
const SETTLED_SUBMISSION = new Set(["applied", "late", "refused"]);

/** Is a pushed row's case absent from the authority, or closed there? (An upload brings closed cases only.) */
async function caseClosedOrNew(q: Queryable, orgId: string, caseId: unknown): Promise<boolean> {
  if (!isId(caseId)) return true;
  const r = await q.one<{ state: string; org_id: string }>(`select state, org_id from sm_process_cases where id = $1`, [caseId.toLowerCase()]);
  return !r || (r.org_id === orgId && !OPEN.includes(r.state));
}

/** Holds the pushing account `process_design` approve (the publisher's grant; the owner's)? */
function approves(p: PushArgs): boolean {
  try {
    return grantIn(subjectOf(p.ctx).eff, "process_design").approve === true;
  } catch {
    return false;
  }
}

/** The upload rule (registered with `setUploadRule`): a member's push of finished workflow data it may create. */
export async function uploadAllowed(p: PushArgs): Promise<boolean> {
  if (p.prev || isSystemCtx(p.ctx) || !approves(p)) return false;
  const n = p.next;
  switch (p.def.key) {
    case "process_case":
      return FINISHED_CASE.has(String(n.state));
    case "process_task":
      return FINISHED_TASK.has(String(n.status)) && (await caseClosedOrNew(p.tx, p.ctx.org.id, n.case_id));
    case "process_submission":
      return SETTLED_SUBMISSION.has(String(n.result)) && (await caseClosedOrNew(p.tx, p.ctx.org.id, n.case_id));
    case "process_version":
      return true;
    case "process":
      return n.status === "published" || n.status === "retired";
    default:
      return false;
  }
}
