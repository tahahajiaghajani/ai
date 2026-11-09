// The security administration tools (SEC-055, SEC-058 … SEC-062): access-risk analytics over the role catalogue,
// memberships and sign-ins (dormant privileged accounts, external members with internal roles, separation-of-duties
// conflicts, too many administrators), the privileged-action review over the platform's logs (security events, the
// audit log, role and membership history) with a SHA-256 chain for tamper evidence of an exported review, the
// hardening console's checks and score, caller verification with one-time codes, and personal-data discovery and
// redaction in a record's text fields. Only members who read the users area in full (access administrators, auditors)
// use the first three; verification and PII scans follow the record's own access.
import { createHash, createHmac, randomInt } from "node:crypto";
import { detectPii, redact } from "@shared/security/pii";
import { roleCatalog } from "@shared/access/builtins";
import { roleClosure } from "@shared/access/model";
import type { AccessRiskFlag, HardeningCheck, HardeningReport, PiiFieldFinding, PrivilegedAction, PrivilegedReview, VerificationState } from "@shared/security/api";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { addJournalIn, createIn, defFor, get, update, updateIn } from "../../engine";
import { accessSettings, listMemberAccess, snapshotFor } from "../../access";
import { bad, forbidden, notFound, tooMany } from "../../http/errors";
import { notifyPeople } from "../notify";
import { securityEvent } from "../platform/security";
import { countRows, isUuid, liveRow, liveRows, readScope, readsArea, securityConfig, sysOf, type Row } from "./common";

/** Access administrators and auditors: the users area read in full. */
async function needReviewer(ctx: Ctx): Promise<void> {
  if ((await readScope(ctx, "users")) !== "all") throw forbidden("این بخش برای مدیران دسترسی و ممیزان است");
}

const PRIVILEGED = new Set(["tenant_admin", "security_manager", "grc_manager", "vulnerability_manager"]);
const DORMANT_DAYS = 90;

// ---------------------------------------------------------------------------------------------------------------
// Access-risk analytics (SEC-060)

export async function accessRisk(ctx: Ctx): Promise<{ flags: AccessRiskFlag[]; members: number; privileged: number }> {
  await needReviewer(ctx);
  const { members } = await listMemberAccess(ctx);
  const snap = await snapshotFor(ctx, ctx.db, true);
  const catalog = roleCatalog(snap.roles, accessSettings(ctx.org).preset);
  const logins = new Map((await ctx.db.query<{ id: string; last_login_at: string | null }>(`select u.id, u.last_login_at from sm_users u join sm_org_members m on m.user_id = u.id where m.org_id = $1 and m.deleted_at is null`, [ctx.org.id])).map((r) => [r.id, r.last_login_at]));
  const flags: AccessRiskFlag[] = [];
  const active = members.filter((m) => m.is_active);
  const admins: string[] = [];
  for (const m of active) {
    const groupRoles = snap.memberships.filter((x) => x.user_id === m.user_id && x.kind !== "observer").flatMap((x) => snap.groups.get(x.group_id)?.roles ?? []);
    const explicit = [...m.roles, ...groupRoles, ...(m.membership_role === "owner" || m.membership_role === "admin" ? ["tenant_admin"] : [])];
    const closure = new Set(roleClosure(explicit, catalog));
    const privileged = [...closure].filter((r) => PRIVILEGED.has(r));
    if (closure.has("tenant_admin")) admins.push(m.user_id);
    const last = logins.get(m.user_id) ?? null;
    if (privileged.length && (!last || Date.now() - Date.parse(last) > DORMANT_DAYS * 86_400_000)) {
      flags.push({ kind: "dormant_privileged", label: "حساب ممتاز بی‌استفاده", user_id: m.user_id, name: m.name, detail: `${privileged.join("، ")} — ${last ? `آخرین ورود بیش از ${DORMANT_DAYS} روز پیش` : "هرگز وارد نشده است"}`, severity: "high" });
    }
    const external = m.persona === "requester" || closure.has("vendor_agent");
    const internal = [...closure].filter((r) => r === "tenant_admin" || r === "agent" || PRIVILEGED.has(r) || r === "security_analyst");
    if (external && internal.length) flags.push({ kind: "external_internal_role", label: "کاربر بیرونی یا درخواست‌دهنده با نقش داخلی", user_id: m.user_id, name: m.name, detail: internal.join("، "), severity: "medium" });
    if (closure.has("auditor") && (closure.has("tenant_admin") || closure.has("security_manager") || closure.has("grc_manager"))) {
      flags.push({ kind: "sod_conflict", label: "تعارض تفکیک وظایف", user_id: m.user_id, name: m.name, detail: "هم ممیز است و هم مدیر همان حوزه‌ها", severity: "high" });
    }
  }
  const limit = Math.max(2, Math.ceil(active.length * 0.1));
  if (admins.length > limit) {
    for (const u of admins) {
      const m = active.find((x) => x.user_id === u)!;
      flags.push({ kind: "broad_admin", label: "مدیران سامانه بیش از اندازه", user_id: u, name: m.name, detail: `${admins.length.toLocaleString("fa-IR")} مدیر سامانه در برابر ${active.length.toLocaleString("fa-IR")} عضو فعال (سقف پیشنهادی ${limit.toLocaleString("fa-IR")})`, severity: "low" });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity] || a.name.localeCompare(b.name));
  return { flags, members: active.length, privileged: active.filter((m) => flags.some((f) => f.user_id === m.user_id && f.kind === "dormant_privileged")).length };
}

// ---------------------------------------------------------------------------------------------------------------
// Privileged-action and read-audit review (SEC-059)

const EVENT_LABELS: Record<string, string> = {
  password_reset: "بازنشانی گذرواژهٔ عضو", member_changed: "تغییر نقش یا دسترسی عضو", member_added: "افزودن عضو", platform_admin: "مدیر سکو", support_start: "شروع جلسهٔ پشتیبانی",
  support_end: "پایان جلسهٔ پشتیبانی", org_status: "تغییر وضعیت سازمان", ai_key: "کلید هوش مصنوعی", api_key: "کلید API", webhook: "وب‌هوک", sessions_revoked: "خروج از همهٔ دستگاه‌ها",
  user_disabled: "غیرفعال‌سازی کاربر", user_enabled: "فعال‌سازی کاربر", security_record_read: "خواندن پروندهٔ امنیتی", sign_in: "ورود ناموفق",
};
const HISTORY_FIELDS: Record<string, string[]> = { role: ["grants", "field_groups", "contains", "workspaces", "domains", "active"], member_profile: ["roles", "workspaces", "persona"], group: ["roles", "restricted", "workspace_id"], workspace: ["secure", "active"] };

export async function privilegedActions(ctx: Ctx, days = 30): Promise<PrivilegedReview> {
  await needReviewer(ctx);
  const from = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86_400_000).toISOString();
  const q = ctx.db;
  const events = await q.query<Row>(
    `select at, kind, user_id, email, ok, data from sm_security_events where org_id = $1 and at >= $2 and (kind = any($3::text[]) or (kind = 'sign_in' and not ok)) order by at desc limit 1000`,
    [ctx.org.id, from, `{${Object.keys(EVENT_LABELS).join(",")}}`],
  );
  const audits = await q.query<Row>(`select a.at, a.action, a.entity, a.summary, a.user_id, a.actor_kind from sm_audit a where a.org_id = $1 and a.at >= $2 order by a.at desc limit 1000`, [ctx.org.id, from]);
  const hist = await q.query<Row>(
    `select h.at, h.table_key, h.field, h.actor, h.record_id from sm_history h where h.org_id = $1 and h.at >= $2 and h.table_key = any($3::text[]) order by h.at desc limit 2000`,
    [ctx.org.id, from, `{${Object.keys(HISTORY_FIELDS).join(",")}}`],
  );
  const names = new Map((await q.query<{ id: string; name: string }>(`select u.id, coalesce(nullif(u.full_name, ''), u.email) as name from sm_users u join sm_org_members m on m.user_id = u.id where m.org_id = $1`, [ctx.org.id])).map((r) => [r.id, r.name]));
  const who = (id: unknown) => (isUuid(id) ? (names.get(String(id)) ?? null) : null);
  const iso = (v: unknown) => new Date(String(v)).toISOString();
  const entries: PrivilegedAction[] = [
    ...events.map((e) => ({ at: iso(e.at), source: "security_event" as const, kind: String(e.kind), label: EVENT_LABELS[String(e.kind)] ?? String(e.kind), user_id: (e.user_id as string) ?? null, actor: who((e.data as Row | null)?.by) ?? who(e.user_id) ?? (e.email as string | null), detail: summarizeData(e.data as Row | null), ok: e.ok !== false })),
    ...audits.map((a) => ({ at: iso(a.at), source: "audit" as const, kind: String(a.action), label: `${a.action} ${a.entity ?? ""}`.trim(), user_id: (a.user_id as string) ?? null, actor: a.actor_kind === "support" ? "پشتیبانی سکو" : who(a.user_id), detail: String(a.summary ?? ""), ok: true })),
    ...hist.filter((h) => (HISTORY_FIELDS[String(h.table_key)] ?? []).includes(String(h.field))).map((h) => ({ at: iso(h.at), source: "history" as const, kind: `${h.table_key}.${h.field}`, label: `تغییر «${tableDef(String(h.table_key))?.fields.find((f) => f.name === h.field)?.label ?? h.field}» در ${tableDef(String(h.table_key))?.label ?? h.table_key}`, user_id: (h.actor as string) ?? null, actor: who(h.actor), detail: String(h.record_id), ok: true })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 1500);
  let chain = "";
  for (const e of [...entries].reverse()) chain = createHash("sha256").update(chain + JSON.stringify(e)).digest("hex");
  return { entries, chain };
}

function summarizeData(d: Row | null): string {
  if (!d) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (["by", "by_name"].includes(k) || v === null || v === undefined) continue;
    parts.push(`${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120)}`);
  }
  return parts.join("، ").slice(0, 400);
}

/** The read audit of security records (SEC-001 «read audit»): who opened which incident or evidence, once a minute. */
const lastRead = new Map<string, number>();
export async function logSecureRead(ctx: Ctx, table: string, row: Row): Promise<void> {
  if (ctx.actor === "system") return;
  const key = `${ctx.org.id}:${ctx.user.id}:${row.id}`;
  if (Date.now() - (lastRead.get(key) ?? 0) < 60_000) return;
  lastRead.set(key, Date.now());
  if (lastRead.size > 20_000) lastRead.clear();
  await securityEvent(ctx.cfg.db, { kind: "security_record_read", org_id: ctx.org.id, user_id: ctx.user.id, email: ctx.user.email, data: { table, id: row.id, number: row.number ?? null } });
}

// ---------------------------------------------------------------------------------------------------------------
// Hardening console (SEC-061)

export async function hardening(ctx: Ctx): Promise<HardeningReport> {
  await needReviewer(ctx);
  const sys = sysOf(ctx);
  const cfg = await securityConfig(ctx.db, ctx);
  const checks: HardeningCheck[] = [];
  const add = (c: HardeningCheck) => checks.push(c);
  const ws = cfg.secure_workspace_id ? await liveRow(ctx.db, sys, "workspace", cfg.secure_workspace_id) : null;
  add({ key: "secure_workspace", label: "فضای کاری امن برای پرونده‌های امنیتی", status: ws?.secure ? "pass" : "fail", detail: ws?.secure ? `«${ws.name}» امن است` : "فضای کاری امن تعریف نشده است", remedy: ws?.secure ? null : "از «تنظیمات امنیت» پیش‌فرض‌ها را بیفزایید", weight: 15 });
  const soc = cfg.soc_group_id ? await liveRow(ctx.db, sys, "group", cfg.soc_group_id) : null;
  add({ key: "soc_restricted", label: "گروه مرکز عملیات امنیت محدود است", status: soc?.restricted ? "pass" : soc ? "warn" : "fail", detail: soc ? (soc.restricted ? "فقط اعضا رکوردهای گروه را می‌بینند" : "گروه محدود نیست") : "گروه تعیین نشده است", remedy: soc?.restricted ? null : "گروه را «محدود» کنید", weight: 10 });
  const risk = await accessRisk(ctx);
  const dormant = risk.flags.filter((f) => f.kind === "dormant_privileged").length;
  add({ key: "dormant_privileged", label: "حساب ممتاز بی‌استفاده وجود ندارد", status: dormant ? "fail" : "pass", detail: dormant ? `${dormant.toLocaleString("fa-IR")} حساب ممتاز بیش از ${DORMANT_DAYS} روز استفاده نشده است` : "همهٔ حساب‌های ممتاز فعال‌اند", remedy: dormant ? "نقش‌های ممتاز حساب‌های بی‌استفاده را بردارید" : null, weight: 15 });
  const sod = risk.flags.filter((f) => f.kind === "sod_conflict").length;
  add({ key: "sod", label: "تفکیک وظایف ممیز و مدیر", status: sod ? "fail" : "pass", detail: sod ? `${sod.toLocaleString("fa-IR")} تعارض` : "تعارضی نیست", remedy: sod ? "نقش ممیز را از مدیران جدا کنید" : null, weight: 10 });
  const broad = risk.flags.some((f) => f.kind === "broad_admin");
  add({ key: "admins", label: "شمار مدیران سامانه در حد لازم", status: broad ? "warn" : "pass", detail: broad ? "مدیران سامانه بیش از ۱۰٪ اعضا هستند" : "در حد پیشنهادی", remedy: broad ? "نقش‌های محدودتر بدهید" : null, weight: 5 });
  const mb = Number(ctx.org.settings?.attachment_max_mb ?? 10);
  add({ key: "attachments", label: "سقف اندازهٔ پیوست", status: mb <= 25 ? "pass" : "warn", detail: `${mb.toLocaleString("fa-IR")} مگابایت`, remedy: mb <= 25 ? null : "سقف را ۲۵ مگابایت یا کمتر کنید", weight: 5 });
  add({ key: "ai_ceiling", label: "سقف طبقه‌بندی برای هوش مصنوعی", status: cfg.ai_max_classification === "public" || cfg.ai_max_classification === "internal" ? "pass" : "warn", detail: `تا «${cfg.ai_max_classification}»؛ پرونده‌های «سری» هرگز`, remedy: null, weight: 5 });
  const keys = await ctx.db.query<{ n: string }>(`select count(*) as n from sm_api_keys where org_id = $1 and revoked_at is null and (created_at < now() - interval '365 days' or (last_used_at is not null and last_used_at < now() - interval '90 days'))`, [ctx.org.id]).catch(() => [{ n: "0" }]);
  const staleKeys = Number(keys[0]?.n ?? 0);
  add({ key: "api_keys", label: "کلیدهای API کهنه یا بی‌استفاده", status: staleKeys ? "warn" : "pass", detail: staleKeys ? `${staleKeys.toLocaleString("fa-IR")} کلید` : "کلید کهنه‌ای نیست", remedy: staleKeys ? "کلیدهای کهنه را باطل و دوباره بسازید" : null, weight: 5 });
  const policies = await countRows(ctx.db, sys, "grc_policy", { and: [{ f: "state", op: "eq", v: "published" }, { f: "kind", op: "eq", v: "policy" }] });
  add({ key: "policy", label: "خط‌مشی امنیت اطلاعات منتشرشده", status: policies ? "pass" : "fail", detail: policies ? `${policies.toLocaleString("fa-IR")} خط‌مشی` : "خط‌مشی منتشرشده‌ای نیست", remedy: policies ? null : "خط‌مشی امنیت اطلاعات را بنویسید و منتشر کنید", weight: 10 });
  const vulnOk = Number(cfg.vuln_sla_critical) <= 30;
  add({ key: "vuln_sla", label: "موعد رفع آسیب‌پذیری بحرانی", status: vulnOk ? "pass" : "warn", detail: `${Number(cfg.vuln_sla_critical).toLocaleString("fa-IR")} روز`, remedy: vulnOk ? null : "موعد رفع بحرانی را ۳۰ روز یا کمتر کنید", weight: 5 });
  add({ key: "mfa", label: "احراز هویت چندعاملی", status: "na", detail: "سکو هنوز احراز هویت چندعاملی ندارد", remedy: "درخواست به سکو ثبت شده است", weight: 0 });
  add({ key: "transport", label: "ارتباط رمزنگاری‌شده", status: ctx.cfg.mode === "desktop" || String(ctx.cfg.origin ?? "").startsWith("https") || ctx.cfg.origin === "cloud" ? "pass" : "warn", detail: ctx.cfg.mode === "desktop" ? "نسخهٔ ویندوز: داده روی همین دستگاه" : "نسخهٔ وب پشت HTTPS اجرا می‌شود", remedy: null, weight: 5 });
  const scored = checks.filter((c) => c.status !== "na");
  const total = scored.reduce((s, c) => s + c.weight, 0) || 1;
  const got = scored.reduce((s, c) => s + (c.status === "pass" ? c.weight : c.status === "warn" ? c.weight / 2 : 0), 0);
  return { score: Math.round((got / total) * 100), checks };
}

// ---------------------------------------------------------------------------------------------------------------
// Caller verification (SEC-062)

const CODE_TTL = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const hashCode = (ctx: Ctx, id: string, code: string) => createHmac("sha256", ctx.cfg.secret || "itsm").update(`${ctx.org.id}:${id}:${code}`).digest("hex");

const VERIFY_TABLES = new Set(["incident", "request", "request_item", "change_request", "sec_incident", "todo"]);

/**
 * Send a one-time code to the person on a record the caller works (they must be able to change it) before a
 * sensitive action. The code reaches the person through the notification service (only if they read the record).
 */
export async function startVerification(ctx: Ctx, input: { table: string; id: string; user_id: string; channel?: "in_app" | "email" | "sms" }): Promise<VerificationState> {
  if (!VERIFY_TABLES.has(input.table) || !tableDef(input.table)) throw bad("احراز هویت روی این نوع رکورد پشتیبانی نمی‌شود");
  if (!isUuid(input.user_id)) throw bad("فرد را انتخاب کنید");
  const rec = await get(ctx, input.table, input.id);
  if (!rec.meta.canWrite) throw forbidden("فقط کسی که رکورد را پیگیری می‌کند هویت فرد را می‌پرسد");
  const sys = sysOf(ctx, ctx.user.id);
  const recent = await countRows(ctx.db, sys, "sec_verification", { and: [{ f: "record_id", op: "eq", v: input.id }, { f: "created_at", op: "gte", v: new Date(Date.now() - 15 * 60_000).toISOString() }] });
  if (recent >= 3) throw tooMany("برای این رکورد چند رمز پیاپی فرستاده شده است؛ ۱۵ دقیقه بعد دوباره امتحان کنید");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const channel = input.channel ?? "in_app";
  const expires = new Date(Date.now() + CODE_TTL).toISOString();
  return sys.write(async (tx) => {
    const row = await createIn(tx, sys, "sec_verification", { user_id: input.user_id, record_table: input.table, record_id: input.id, record_number: (rec.row.number as string) ?? null, channel, status: "pending", expires_at: expires, attempts: 0, requested_by: ctx.user.id }, { trusted: true });
    await updateIn(tx, sys, "sec_verification", row.id, { code_hash: hashCode(ctx, row.id, code) }, { trusted: true, keepVersion: true });
    await notifyPeople(tx, ctx.org.id, {
      table: input.table, id: input.id, users: [input.user_id], event: "custom", label: "رمز تأیید هویت", mandatory: true, channels: channel === "in_app" ? ["in_app"] : ["in_app", channel],
      subject: "رمز یک‌بارمصرف تأیید هویت", body: `رمز تأیید هویت شما ${code} است. آن را فقط به کارشناسی بگویید که اکنون دربارهٔ ${rec.row.number ?? "درخواست شما"} با شما در تماس است. اعتبار: ۱۰ دقیقه.`, short_text: `رمز تأیید هویت: ${code}`, source: "احراز هویت تماس‌گیرنده",
    });
    return { id: row.id, status: "pending", expires_at: expires, attempts: 0, channel };
  });
}

/** Check the code the person read back (at most five tries, ten minutes); the record gets an internal note. */
export async function checkVerification(ctx: Ctx, id: string, code: string): Promise<VerificationState> {
  const sys = sysOf(ctx, ctx.user.id);
  const v = await liveRow(ctx.db, sysOf(ctx), "sec_verification", id);
  if (!v || v.requested_by !== ctx.user.id) throw notFound("درخواست احراز هویت پیدا نشد");
  const state = (s: Row): VerificationState => ({ id: s.id, status: s.status, expires_at: s.expires_at ?? null, attempts: Number(s.attempts ?? 0), channel: s.channel });
  if (v.status !== "pending") return state(v);
  const expired = Date.parse(String(v.expires_at)) < Date.now();
  const tries = Number(v.attempts ?? 0) + 1;
  const ok = !expired && String(code ?? "").replace(/\D/g, "").length === 6 && hashCode(ctx, id, String(code).replace(/\D/g, "")) === v.code_hash;
  const status = ok ? "verified" : expired ? "expired" : tries >= MAX_ATTEMPTS ? "failed" : "pending";
  return sys.write(async (tx) => {
    const row = await updateIn(tx, sys, "sec_verification", id, { attempts: tries, status, ...(ok ? { verified_at: new Date().toISOString() } : {}) }, { trusted: true });
    if (status !== "pending") {
      const def = tableDef(String(v.record_table));
      const rec = def ? await liveRow(tx, sysOf(ctx), def.key, v.record_id) : null;
      if (def?.features?.journal && rec) await addJournalIn(tx, sys, def, rec, { kind: "work_note", body: ok ? "هویت فرد با رمز یک‌بارمصرف تأیید شد." : expired ? "رمز تأیید هویت منقضی شد؛ هویت تأیید نشد." : "هویت فرد تأیید نشد (رمز نادرست پس از چند تلاش)." }, { trusted: true, author: ctx.user.id });
    }
    return state(row);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Sensitive data discovery and redaction (SEC-055)

const TEXT = new Set(["string", "text", "markdown"]);

/** Personal data in the text fields of a record the caller reads (masked values; fields they may not see skipped). */
export async function scanPii(ctx: Ctx, table: string, id: string): Promise<PiiFieldFinding[]> {
  const { def } = await defFor(ctx, table);
  const r = await get(ctx, table, id);
  const out: PiiFieldFinding[] = [];
  for (const f of def.fields) {
    if (!TEXT.has(f.type) || f.base || !(f.name in r.row)) continue;
    const text = r.row[f.name];
    if (typeof text !== "string" || !text) continue;
    const found = detectPii(text);
    if (found.length) out.push({ field: f.name, label: f.label, findings: found.map((x) => ({ kind: x.kind, label: x.label, masked: x.masked })) });
  }
  return out;
}

/** Replace the personal data found in the chosen fields (the caller's own update: write access and field rights). */
export async function redactPii(ctx: Ctx, table: string, id: string, fields: string[]): Promise<{ fields: string[]; redacted: number }> {
  const { def } = await defFor(ctx, table);
  const r = await get(ctx, table, id);
  const patch: Row = {};
  let n = 0;
  for (const name of fields) {
    const f = def.fields.find((x) => x.name === name);
    if (!f || !TEXT.has(f.type) || typeof r.row[name] !== "string") continue;
    const found = detectPii(String(r.row[name]));
    if (!found.length) continue;
    patch[name] = redact(String(r.row[name]), found);
    n += found.length;
  }
  if (!n) return { fields: [], redacted: 0 };
  await update(ctx, table, id, patch, { version: r.row.version as number });
  return { fields: Object.keys(patch), redacted: n };
}

export { readsArea };
