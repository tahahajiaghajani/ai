// The platform admin's own actions in sm_audit (actor_kind 'platform'): user and business changes
// made from «مدیریت سامانه». Rows about one business carry its org_id and appear in that
// business's audit log too; account-level rows (org_id null) only in the console.
import type { Queryable } from "../../db";
import type { AuthUser, ServerConfig } from "../../context";
import { uuidv7 } from "@shared/id";

export interface PlatformAuditInput {
  org_id?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  summary: string;
  data?: Record<string, unknown> | null;
}

export async function platformAudit(q: Queryable, cfg: ServerConfig, admin: AuthUser, e: PlatformAuditInput): Promise<void> {
  await q.query(
    `insert into sm_audit (id, org_id, user_id, action, entity, entity_id, summary, data, origin, actor_kind)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'platform')`,
    [uuidv7(), e.org_id ?? null, admin.id, e.action, e.entity, e.entity_id ?? null, e.summary.slice(0, 300), e.data ?? null, cfg.origin],
  );
}
