// Platform status of an organisation (sm_org_admin): «فعال», «فقط‌خواندنی» (writes refused), «معلق»
// (closed to its members), internal notes and the per-organisation AI switch. Only the platform admin
// changes them (routes/admin.ts); every organisation reads its own status through ctx.
import type { Queryable } from "../../db";
import type { AuthUser, OrgPlatformStatus, OrgStatus, ServerConfig } from "../../context";
import { AppError, bad, notFound } from "../../http/errors";
import { platformAudit } from "./audit";
import { securityEvent } from "./security";

export const ORG_STATUSES: OrgStatus[] = ["active", "read_only", "suspended"];
export const ORG_STATUS_TITLE: Record<OrgStatus, string> = { active: "فعال", read_only: "فقط‌خواندنی", suspended: "معلق" };

export interface OrgAdminState {
  org_id: string;
  status: OrgStatus;
  status_reason: string | null;
  notes: string | null;
  ai_disabled: boolean;
  limits: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string | null;
}

export async function orgStatus(q: Queryable, orgId: string): Promise<OrgPlatformStatus> {
  const r = await q.one<{ status: OrgStatus; status_reason: string | null }>(`select status, status_reason from sm_org_admin where org_id = $1`, [orgId]);
  return { status: r?.status ?? "active", reason: r?.status_reason ?? null };
}

export async function orgAdminState(q: Queryable, orgId: string): Promise<OrgAdminState> {
  const r = await q.one<OrgAdminState>(`select org_id, status, status_reason, notes, ai_disabled, limits, updated_by, updated_at from sm_org_admin where org_id = $1`, [orgId]);
  return r ?? { org_id: orgId, status: "active", status_reason: null, notes: null, ai_disabled: false, limits: {}, updated_by: null, updated_at: null };
}

/**
 * True when the platform admin switched AI off for this organisation: the AI engine must then refuse
 * every model call of the organisation (and say so in its status).
 */
export async function orgAiDisabled(q: Queryable, orgId: string): Promise<boolean> {
  const r = await q.one<{ ai_disabled: boolean }>(`select ai_disabled from sm_org_admin where org_id = $1`, [orgId]);
  return !!r?.ai_disabled;
}

const withReason = (text: string, reason: string | null) => (reason ? `${text}؛ دلیل: ${reason}` : text);

/** The Persian refusal for an organisation that is not active (HTTP 423). */
export function statusError(s: OrgPlatformStatus): AppError {
  if (s.status === "suspended") return new AppError(423, "org_suspended", withReason("این سازمان از سوی مدیر سامانه معلق شده است", s.reason));
  return new AppError(423, "org_read_only", withReason("این سازمان از سوی مدیر سامانه فقط‌خواندنی شده است و تغییر تازه ثبت نمی‌شود", s.reason));
}

/** Refuses a write in an organisation that is read-only or suspended (called inside ctx.write). */
export async function assertWritable(q: Queryable, orgId: string): Promise<void> {
  const s = await orgStatus(q, orgId);
  if (s.status !== "active") throw statusError(s);
}

export interface OrgAdminPatch {
  status?: OrgStatus;
  status_reason?: string | null;
  notes?: string | null;
  ai_disabled?: boolean;
}

/**
 * Changes an organisation's platform state. A status other than «فعال» needs a reason (members see it);
 * status and AI changes are logged in the organisation's audit log, note edits only in the platform's.
 */
export async function updateOrgAdmin(
  cfg: ServerConfig,
  admin: AuthUser,
  orgId: string,
  patch: OrgAdminPatch,
  meta: { ip?: string | null; user_agent?: string | null } = {},
): Promise<OrgAdminState> {
  const db = cfg.db;
  const org = await db.one<{ id: string; name: string }>(`select id, name from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("سازمان پیدا نشد");
  // decided from the stored state, locked until commit (a row made first when there is none): another platform
  // administrator's edit in flight finishes first and only what this patch names changes — never a stale copy of the
  // rest (an «AI off» switch, a status) written back over it
  let before: OrgAdminState = await orgAdminState(db, orgId);
  let next: OrgAdminState = before;
  let statusChanged = false;
  const saved = await db.tx(async (tx) => {
    await tx.query(`insert into sm_org_admin (org_id) values ($1) on conflict (org_id) do nothing`, [orgId]);
    const locked = await tx.one<OrgAdminState>(`select org_id, status, status_reason, notes, ai_disabled, limits, updated_by, updated_at from sm_org_admin where org_id = $1 for update`, [orgId]);
    if (locked) before = locked;
    const status = patch.status ?? before.status;
    const reason = patch.status !== undefined || patch.status_reason !== undefined ? (patch.status_reason ?? "").trim() || null : before.status_reason;
    if (status !== "active" && !reason) throw bad("دلیل را بنویسید؛ اعضای سازمان آن را می‌بینند");
    next = {
      ...before,
      status,
      status_reason: status === "active" ? null : reason,
      notes: patch.notes !== undefined ? (patch.notes ?? "").trim() || null : before.notes,
      ai_disabled: patch.ai_disabled ?? before.ai_disabled,
    };
    statusChanged = next.status !== before.status || next.status_reason !== before.status_reason;
    const aiChanged = next.ai_disabled !== before.ai_disabled;
    const notesChanged = next.notes !== before.notes;
    const row = await tx.one<OrgAdminState>(
      `insert into sm_org_admin (org_id, status, status_reason, notes, ai_disabled, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (org_id) do update set status = excluded.status, status_reason = excluded.status_reason, notes = excluded.notes,
         ai_disabled = excluded.ai_disabled, updated_by = excluded.updated_by, updated_at = now()
       returning org_id, status, status_reason, notes, ai_disabled, limits, updated_by, updated_at`,
      [orgId, next.status, next.status_reason, next.notes, next.ai_disabled, admin.id],
    );
    if (statusChanged) {
      const title = ORG_STATUS_TITLE[next.status];
      await platformAudit(tx, cfg, admin, {
        org_id: orgId,
        action: "org_status",
        entity: "org",
        entity_id: orgId,
        summary: next.status_reason ? `وضعیت سازمان: ${title}؛ دلیل: ${next.status_reason}` : `وضعیت سازمان: ${title}`,
        data: { from: before.status, to: next.status, reason: next.status_reason },
      });
    }
    if (aiChanged)
      await platformAudit(tx, cfg, admin, {
        org_id: orgId,
        action: "org_ai",
        entity: "org",
        entity_id: orgId,
        summary: next.ai_disabled ? "هوش مصنوعی این سازمان از سوی مدیر سامانه خاموش شد" : "هوش مصنوعی این سازمان دوباره روشن شد",
        data: { ai_disabled: next.ai_disabled },
      });
    // internal notes are the platform's: logged without the organisation, so members never see them
    if (notesChanged)
      await platformAudit(tx, cfg, admin, { org_id: null, action: "org_notes", entity: "org", entity_id: orgId, summary: `یادداشت داخلی «${org.name}» ویرایش شد` });
    return row!;
  });
  if (statusChanged)
    await securityEvent(db, {
      kind: "org_status",
      user_id: admin.id,
      email: admin.email,
      org_id: orgId,
      ip: meta.ip,
      user_agent: meta.user_agent,
      data: { from: before.status, to: next.status, reason: next.status_reason },
    });
  return saved;
}
