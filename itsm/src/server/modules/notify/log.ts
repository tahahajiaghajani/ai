// The delivery log (sm_notification_log): one row per channel and recipient — sent, failed, skipped (with the reason:
// no access, switched off, no address…) or held for quiet hours and digests. It is the evidence of what went out
// (ISO/IEC 20000-1 §7.4); it keeps the subject and a hash of the body, never the body itself.
import { createHash } from "node:crypto";
import { uuidv7 } from "@shared/id";
import type { Queryable } from "../../db";

export type LogStatus = "sent" | "failed" | "skipped" | "held";

/** Why a delivery did not happen (Persian labels for the log page). */
export const SKIP_REASONS: Record<string, string> = {
  no_access: "گیرنده به رکورد یا یادداشت دسترسی ندارد",
  inactive: "گیرنده عضو فعال سازمان نیست",
  opted_out: "گیرنده این اعلان را خاموش کرده است",
  no_address: "نشانی ایمیل یا شمارهٔ همراه ندارد",
  no_channel: "کانال ارسال تنظیم نشده است",
  channel_inactive: "کانال غیرفعال است",
  quiet: "ساعت سکوت گیرنده",
  digest: "در خلاصهٔ ایمیلی",
  record_gone: "رکورد دیگر وجود ندارد",
};

export interface LogInput {
  org: string;
  rule_key?: string | null;
  rule_name?: string | null;
  event: string;
  table_key?: string | null;
  record_id?: string | null;
  record_number?: string | null;
  channel: string;
  recipient_id?: string | null;
  target?: string | null;
  status: LogStatus;
  reason?: string | null;
  error?: string | null;
  provider_id?: string | null;
  subject?: string | null;
  /** hashed, never stored */
  body?: string | null;
  due_at?: Date | string | null;
  payload?: Record<string, unknown> | null;
}

export const bodyHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export async function logDelivery(q: Queryable, x: LogInput): Promise<string> {
  const id = uuidv7();
  await q.query(
    `insert into sm_notification_log (id, org_id, rule_key, rule_name, event, table_key, record_id, record_number, channel, recipient_id, target,
       status, reason, error, provider_id, subject, body_hash, due_at, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::timestamptz, $19::jsonb)`,
    [
      id, x.org, x.rule_key ?? null, x.rule_name ?? null, x.event, x.table_key ?? null, x.record_id ?? null, x.record_number ?? null, x.channel,
      x.recipient_id ?? null, x.target ? String(x.target).slice(0, 300) : null, x.status, x.reason ?? null, x.error ? String(x.error).slice(0, 1000) : null,
      x.provider_id ? String(x.provider_id).slice(0, 300) : null, x.subject ? String(x.subject).slice(0, 300) : null, x.body ? bodyHash(x.body) : null,
      x.due_at ? new Date(x.due_at).toISOString() : null, x.payload ? JSON.stringify(x.payload) : null,
    ],
  );
  return id;
}

/** Mark a held row as gone out (or skipped) once its quiet time or digest came. */
export async function settleHeld(q: Queryable, id: string, status: Exclude<LogStatus, "held">, extra: { reason?: string | null; error?: string | null; provider_id?: string | null; subject?: string | null } = {}): Promise<void> {
  await q.query(
    `update sm_notification_log set status = $2, reason = coalesce($3, reason), error = $4, provider_id = coalesce($5, provider_id),
       subject = coalesce($6, subject), payload = null, updated_at = now() where id = $1`,
    [id, status, extra.reason ?? null, extra.error ?? null, extra.provider_id ?? null, extra.subject ?? null],
  );
}

export interface LogRow {
  id: string;
  created_at: string;
  updated_at: string;
  rule_key: string | null;
  rule_name: string | null;
  event: string;
  table_key: string | null;
  record_id: string | null;
  record_number: string | null;
  channel: string;
  recipient_id: string | null;
  target: string | null;
  status: LogStatus;
  reason: string | null;
  error: string | null;
  provider_id: string | null;
  subject: string | null;
  due_at: string | null;
}
