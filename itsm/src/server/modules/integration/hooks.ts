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
import { createServiceMember, needPrincipalWithin, syncServiceMember } from "./users";
import { redactRefs } from "./issues";
import { invalidateSubscriptions } from "./webhooks";
import { validateLoginSettings } from "./directory-login";
import { directoryLan } from "./directory";
import { lanAllowed } from "../../net";

const HOUR = 3600_000;

const tableOk = (key: unknown) => {
  const d = tableDef(String(key ?? ""));
  return !!d && !d.virtual;
};

const httpsOnly = (w: WriteArgs, url: unknown, what: string) => {
  const s = String(url ?? "");
  if (!s) return;
  if (!lanAllowed(w.ctx.cfg) && !/^https:\/\//i.test(s)) throw bad(`${what} باید با https:// شروع شود`);
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

/**
 * What an approval of a directory source covers: where it reads, how it authenticates, what it maps and grants, and
 * whether it applies. A person other than the approver who changes any of these takes the approval back (and the
 * source back to preview): the source acts with its approver's access, never with settings they did not approve.
 */
export const DIRECTORY_APPROVED_FIELDS = [
  "kind", "ldap_url", "bind_dn", "bind_password", "base_dn", "user_filter", "attr_map", "group_map", "default_role", "membership_role", "auto_roles",
  "deactivate_missing", "unit_from", "mode", "scim_token",
  // «ورود با حساب سازمانی» and Windows sign-in: which domain controllers and certificates, who signs in, who is made, which proxies are believed
  "dc_urls", "tls_mode", "ca_cert", "group_base_dn", "nested_groups", "login_enabled", "login_domains", "login_attr", "jit", "sso_mode", "proxy_ips", "proxy_secret", "proxy_header", "ntlm",
];

function directory(w: WriteArgs): void {
  if (w.op !== "create" && w.op !== "update") return;
  if (w.next.kind === "ldap" && w.next.ldap_url && !/^ldaps?:\/\/[^\s/]+/i.test(String(w.next.ldap_url))) throw bad("نشانی LDAP باید با ldap:// یا ldaps:// شروع شود");
  // the web version reaches only public directories: their bind password never crosses the Internet in clear text
  const addressSet = w.op === "create" || w.changed.has("ldap_url") || w.changed.has("kind");
  if (addressSet && w.next.kind === "ldap" && w.next.ldap_url && !directoryLan(w.ctx.cfg) && !/^ldaps:\/\//i.test(String(w.next.ldap_url))) {
    throw bad("در نسخهٔ وب فقط ldaps:// (LDAP روی TLS) پذیرفته می‌شود تا گذرواژهٔ اتصال رمزنگاری‌نشده از اینترنت نگذرد");
  }
  if (w.next.kind === "scim" && w.op === "create" && !w.next.scim_token) w.next.scim_token = randomToken(32);
  if (isSystem(w.ctx) || w.trusted) return;
  // the member whose access applies the synchronisation is set by the hub's «اعمال» (never typed)
  if (w.changed.has("approved_by")) throw bad("تأییدکننده با «اعمال» تعیین می‌شود");
  if (w.op === "update" && w.prev?.approved_by && String(w.prev.approved_by) !== w.ctx.user.id && DIRECTORY_APPROVED_FIELDS.some((f) => w.changed.has(f))) {
    w.next.approved_by = null;
    if (w.next.mode === "apply") w.next.mode = "preview";
  }
  // sign-in settings: addresses, TLS, the root CA, proxies; changing who signs in needs a recent proof of identity
  validateLoginSettings(w);
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

/** A row that acts as an integration user (webhook, inbound endpoint, export, issue connection) names one within the writer's access. */
async function principalWithin(w: WriteArgs): Promise<void> {
  if (w.op !== "create" && w.op !== "update") return;
  if (isSystem(w.ctx) || w.trusted || !(w.op === "create" || w.changed.has("principal_id"))) return;
  await needPrincipalWithin(w.ctx, w.next.principal_id, w.tx);
}

let installed = false;
export function installIntegrationHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("integration_user", { beforeWrite: integrationUser, ...webOnly("کاربر یکپارچه‌سازی"), afterWrite: integrationUserAfter });
  for (const t of ["webhook_subscription", "inbound_endpoint", "issue_connection", "export_schedule"]) registerHooks(t, { beforeWrite: principalWithin });
  registerHooks("webhook_subscription", { beforeWrite: webhook, ...webOnly("وب‌هوک") });
  registerHooks("inbound_endpoint", { beforeWrite: inbound, ...webOnly("نقطهٔ دریافت") });
  registerHooks("directory_source", { beforeWrite: directory, ...webOnly("منبع فهرست کاربران") });
  registerHooks("issue_connection", { beforeWrite: issueConnection, ...webOnly("اتصال Jira/GitHub") });
  registerHooks("export_schedule", { beforeWrite: exportSchedule, ...webOnly("خروجی زمان‌بندی‌شده"), afterWrite: exportScheduleAfter });
  registerHooks("external_ref", { redactRows: redactRefs });
}
