// Hooks of the integration hub's tables (same transaction as the write): an integration user's service account is made
// with its row and follows it (name, switched off, removed — its keys revoked); plan ceilings on integration users and
// webhooks; targets, URLs and kinds checked; signing secrets and endpoint tokens made when none was given (shown once by
// the hub's «راز تازه»); schedules queued when saved.
import { randomToken } from "../../auth/password";
import { tableDef } from "@shared/tables";
import { bad } from "../../http/errors";
import { webOnly, registerHooks, type WriteArgs } from "../../engine";
import { enqueue } from "../../jobs";
import { isSystem } from "../../access/provider";
import { needWithinLimit } from "../admin/common";
import { createServiceMember, syncServiceMember } from "./users";
import { invalidateSubscriptions } from "./webhooks";

const HOUR = 3600_000;

const tableOk = (key: unknown) => {
  const d = tableDef(String(key ?? ""));
  return !!d && !d.virtual;
};

const httpsOnly = (w: WriteArgs, url: unknown, what: string) => {
  const s = String(url ?? "");
  if (!s) return;
  if (w.ctx.cfg.mode !== "desktop" && !/^https:\/\//i.test(s)) throw bad(`${what} باید با https:// شروع شود`);
};

async function integrationUser(w: WriteArgs): Promise<void> {
  if (w.op === "create") {
    w.next.user_id = await createServiceMember(w.tx, w.ctx, String(w.next.name ?? "بی‌نام"));
    return;
  }
}

async function integrationUserAfter(w: WriteArgs & { row: Record<string, unknown> }): Promise<void> {
  if (w.op === "update" && (w.changed.has("name") || w.changed.has("active"))) await syncServiceMember(w.tx, w.ctx, w.row);
  if (w.op === "delete") await syncServiceMember(w.tx, w.ctx, { ...(w.prev ?? {}), ...w.row }, true);
}

async function webhook(w: WriteArgs): Promise<void> {
  if (w.op !== "create" && w.op !== "update") return;
  if (w.op === "create") await needWithinLimit(w.tx, w.ctx.cfg, w.ctx.org.id, "webhooks", 1);
  if (!tableOk(w.next.table_key)) throw bad(`جدول «${String(w.next.table_key ?? "")}» وجود ندارد`);
  httpsOnly(w, w.next.url, "نشانی وب‌هوک");
  if (w.op === "create" && !w.next.secret) w.next.secret = randomToken(24);
  invalidateSubscriptions();
}

function inbound(w: WriteArgs): void {
  if (w.op !== "create" && w.op !== "update") return;
  if (!tableOk(w.next.target_table)) throw bad(`جدول «${String(w.next.target_table ?? "")}» وجود ندارد`);
  if (w.next.action === "upsert" && (!w.next.match_field || !w.next.match_path)) throw bad("برای «ساخت یا به‌روزرسانی» فیلد هم‌بستگی و مسیر شناسه را تعیین کنید");
  if (w.op === "create" && !w.next.token) w.next.token = randomToken(24);
}

function directory(w: WriteArgs): void {
  if (w.op !== "create" && w.op !== "update") return;
  if (w.next.kind === "ldap" && w.next.ldap_url && !/^ldaps?:\/\/[^\s/]+/i.test(String(w.next.ldap_url))) throw bad("نشانی LDAP باید با ldap:// یا ldaps:// شروع شود");
  if (w.next.kind === "scim" && w.op === "create" && !w.next.scim_token) w.next.scim_token = randomToken(32);
  // the member whose access applies the synchronisation is set by the hub's «اعمال» (never typed)
  if (!isSystem(w.ctx) && !w.trusted && w.changed.has("approved_by")) throw bad("تأییدکننده با «اعمال» تعیین می‌شود");
}

function issueConnection(w: WriteArgs): void {
  if (w.op !== "create" && w.op !== "update") return;
  if (w.next.kind === "github" && w.next.repo && !/^[\w.-]+\/[\w.-]+$/.test(String(w.next.repo))) throw bad("مخزن GitHub باید owner/name باشد");
  if (w.next.kind === "jira" && !w.next.base_url) throw bad("نشانی Jira را وارد کنید");
  httpsOnly(w, w.next.base_url, "نشانی");
  for (const t of (Array.isArray(w.next.tables) ? w.next.tables : []) as string[]) if (!tableOk(t)) throw bad(`جدول «${t}» وجود ندارد`);
  if (w.op === "create" && !w.next.webhook_secret) w.next.webhook_secret = randomToken(24);
}

async function exportSchedule(w: WriteArgs & { row?: Record<string, unknown> }): Promise<void> {
  if (w.op !== "create" && w.op !== "update") return;
  for (const t of (Array.isArray(w.next.tables) ? w.next.tables : []) as string[]) if (!tableOk(t)) throw bad(`جدول «${t}» وجود ندارد`);
  if (w.next.destination === "webhook") {
    if (!w.next.url) throw bad("نشانی مقصد را وارد کنید");
    httpsOnly(w, w.next.url, "نشانی مقصد");
  }
}

async function exportScheduleAfter(w: WriteArgs & { row: Record<string, unknown> }): Promise<void> {
  if (w.op !== "create" && !(w.op === "update" && (w.changed.has("active") || w.changed.has("every_hours")))) return;
  if (w.row.active === false) return;
  const hours = Number(w.row.every_hours ?? 24);
  await enqueue(w.tx, { kind: "integration.export.run", orgId: w.ctx.org.id, payload: { id: w.row.id }, delayMs: hours * HOUR, dedupeKey: `export:${w.row.id}`, maxAttempts: 2 });
}

let installed = false;
export function installIntegrationHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("integration_user", { beforeWrite: integrationUser, ...webOnly("کاربر یکپارچه‌سازی"), afterWrite: integrationUserAfter });
  registerHooks("webhook_subscription", { beforeWrite: webhook, ...webOnly("وب‌هوک") });
  registerHooks("inbound_endpoint", { beforeWrite: inbound, ...webOnly("نقطهٔ دریافت") });
  registerHooks("directory_source", { beforeWrite: directory, ...webOnly("منبع فهرست کاربران") });
  registerHooks("issue_connection", { beforeWrite: issueConnection, ...webOnly("اتصال Jira/GitHub") });
  registerHooks("export_schedule", { beforeWrite: exportSchedule, ...webOnly("خروجی زمان‌بندی‌شده"), afterWrite: exportScheduleAfter });
}
