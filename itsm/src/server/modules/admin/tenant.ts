// The tenant administration console (catalogue ADM-001/002/019/026/029/030/031/035): the home with the set-up checklist,
// the plan's limits and what is used of them and the features as they apply to the organisation; branding; system
// logs (jobs, notification deliveries, flow runs, integration calls, security events); seats and licences; the
// organisation's notices. Only counts and log metadata — never record contents — appear here (a delivery's subject,
// a flow's context or a webhook's payload stay where their own access rules apply).
import type { Ctx } from "../../context";
import { COLOR_KEYS } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { bad, notFound } from "../../http/errors";
import { updateRow } from "../../db/sql";
import { createIn, updateIn } from "../../engine";
import { notifyPeople } from "../notify";
import { audit } from "../data/crud";
import { configRow, featureStates, liveRows, orgPlan, patchConfig, sysOf, usageOf, type Row } from "./common";
import { cancelJob, jobSummary, retryJob } from "./platform";
import { needAccessView } from "../../access";
import { ADMIN_CHANGELOG } from "./changelog";

// ---------------------------------------------------------------- onboarding (ADM-002)

export interface OnboardingStep {
  key: string;
  label: string;
  path: string;
  done: boolean;
  /** marked done by hand */
  manual: boolean;
}

const STEPS: { key: string; label: string; path: string; sql: string }[] = [
  { key: "units", label: "ساختار سازمانی (واحدها)", path: "access/org", sql: `select count(*)::int as n from sm_org_units where org_id = $1 and deleted_at is null` },
  { key: "people", label: "افزودن اعضا", path: "settings/member-import", sql: `select (count(*) - 1)::int as n from sm_org_members where org_id = $1 and deleted_at is null` },
  { key: "groups", label: "گروه‌های پشتیبانی", path: "access/groups", sql: `select count(*)::int as n from sm_groups where org_id = $1 and deleted_at is null` },
  { key: "roles", label: "نقش‌های اعضا", path: "access/members", sql: `select count(*)::int as n from sm_member_profiles where org_id = $1 and deleted_at is null and jsonb_array_length(coalesce(roles, '[]'::jsonb)) > 0` },
  { key: "email", label: "صندوق ایمیل", path: "notify/email", sql: `select count(*)::int as n from sm_email_channels where org_id = $1 and deleted_at is null` },
  { key: "calendars", label: "تقویم کاری و تعطیلات", path: "sla/calendars", sql: `select count(*)::int as n from sm_calendars where org_id = $1 and deleted_at is null` },
  { key: "ai", label: "اتصال هوش مصنوعی", path: "settings/ai", sql: `select count(*)::int as n from sm_ai_connections where org_id = $1` },
  { key: "branding", label: "برند و ظاهر", path: "settings/branding", sql: `select (case when logo is not null or settings ? 'brand' then 1 else 0 end)::int as n from sm_orgs where id = $1` },
];

export async function onboarding(ctx: Ctx): Promise<OnboardingStep[]> {
  const cfgRow = await liveRows(ctx.db, sysOf(ctx), "admin_config", { f: "key", op: "eq", v: "main" }, { limit: 1 });
  const manual = ((cfgRow[0]?.onboarding ?? {}) as Record<string, unknown>) ?? {};
  const out: OnboardingStep[] = [];
  for (const s of STEPS) {
    const r = await ctx.db.one<{ n: number }>(s.sql, [ctx.org.id]).catch(() => null);
    const isManual = !!manual[s.key];
    out.push({ key: s.key, label: s.label, path: s.path, done: (r?.n ?? 0) > 0 || isManual, manual: isManual });
  }
  return out;
}

export async function markStep(ctx: Ctx, key: string, done: boolean): Promise<OnboardingStep[]> {
  ctx.need("settings", "edit");
  if (!STEPS.some((s) => s.key === key)) throw notFound("گام راه‌اندازی پیدا نشد");
  await ctx.write(async (tx) => {
    const row = await configRow(tx, ctx);
    const next = { ...((row.onboarding ?? {}) as Record<string, unknown>) };
    if (done) next[key] = { at: new Date().toISOString(), by: ctx.user.id };
    else delete next[key];
    await patchConfig(tx, ctx, { onboarding: next });
  });
  return onboarding(ctx);
}

/** The console's home: set-up steps, limits and usage, features, what is new. */
export async function consoleHome(ctx: Ctx) {
  ctx.need("settings", "view");
  const [steps, plan, usage, features, jobs] = await Promise.all([onboarding(ctx), orgPlan(ctx.db, ctx.org.id, ctx.cfg.mode), usageOf(ctx.db, ctx.org.id), featureStates(ctx.db, ctx.org.id, ctx.cfg.mode), jobSummary(ctx.cfg, ctx.org.id)]);
  return {
    onboarding: steps,
    plan: { key: plan.key, name: plan.plan?.name ?? (ctx.cfg.mode === "desktop" ? "نصب مستقل" : null), limits: plan.limits },
    usage,
    features,
    jobs: { failed_24h: jobs.failed_24h, backlog_seconds: jobs.backlog_seconds, queued: jobs.totals.queued },
    changelog: ADMIN_CHANGELOG.slice(0, 3),
  };
}

/** The tenant administrator's switch of a feature (only flags the platform lets tenants switch). */
export async function setFeature(ctx: Ctx, key: string, enabled: boolean) {
  ctx.need("settings", "full");
  const states = await featureStates(ctx.db, ctx.org.id, ctx.cfg.mode);
  const s = states.find((x) => x.key === key);
  if (!s) throw notFound("قابلیت پیدا نشد");
  if (!s.toggle) throw bad(`«${s.label}» را فقط مدیر سامانه تغییر می‌دهد (${s.reason})`);
  await ctx.write(async (tx) => {
    const row = await configRow(tx, ctx);
    const flags = { ...((row.flags ?? {}) as Record<string, unknown>), [key]: enabled };
    await patchConfig(tx, ctx, { flags });
    await audit(tx, ctx, "feature_toggle", "admin_config", String(row.id), `«${s.label}»: ${enabled ? "روشن" : "خاموش"}`, { key, enabled });
  });
  return featureStates(ctx.db, ctx.org.id, ctx.cfg.mode);
}

// ---------------------------------------------------------------- branding (ADM-019)

export interface Brand {
  /** a design-system colour name (never hex: contrast and dark mode come from the tokens) */
  accent: string | null;
  portal_title: string | null;
  login_message: string | null;
  email_footer: string | null;
  support_email: string | null;
}

export function brandOf(settings: unknown): Brand {
  const b = ((settings as Record<string, unknown> | null)?.brand ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { accent: s(b.accent), portal_title: s(b.portal_title), login_message: s(b.login_message), email_footer: s(b.email_footer), support_email: s(b.support_email) };
}

export async function saveBrand(ctx: Ctx, input: Partial<Brand> & { logo?: string | null }): Promise<{ brand: Brand; logo: string | null }> {
  ctx.need("settings", "edit");
  if (input.accent && !(COLOR_KEYS as readonly string[]).includes(input.accent)) throw bad("رنگ برند باید یکی از رنگ‌های سامانه باشد");
  if (input.logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(input.logo)) throw bad("نشان باید تصویر PNG، JPEG، WebP یا SVG باشد");
  if (input.logo && input.logo.length > 400_000) throw bad("نشان بزرگ‌تر از ۳۰۰ کیلوبایت است");
  const cur = brandOf(ctx.org.settings);
  const brand: Brand = {
    accent: input.accent === undefined ? cur.accent : input.accent || null,
    portal_title: input.portal_title === undefined ? cur.portal_title : (input.portal_title?.trim() || null)?.slice(0, 80) ?? null,
    login_message: input.login_message === undefined ? cur.login_message : (input.login_message?.trim() || null)?.slice(0, 500) ?? null,
    email_footer: input.email_footer === undefined ? cur.email_footer : (input.email_footer?.trim() || null)?.slice(0, 1000) ?? null,
    support_email: input.support_email === undefined ? cur.support_email : (input.support_email?.trim().toLowerCase() || null),
  };
  const row = await ctx.write(async (tx) => {
    const settings = { ...((ctx.org.settings ?? {}) as Record<string, unknown>), brand };
    const patch: Record<string, unknown> = { settings, origin: ctx.cfg.origin };
    if (input.logo !== undefined) patch.logo = input.logo || null;
    const r = await updateRow<{ logo: string | null }>(tx, "sm_orgs", { id: ctx.org.id }, patch, "logo");
    await audit(tx, ctx, "branding", "org", ctx.org.id, "برند و ظاهر سازمان", { brand, logo: input.logo === undefined ? "unchanged" : input.logo ? "set" : "removed" });
    return r;
  });
  return { brand, logo: row?.logo ?? null };
}

// ---------------------------------------------------------------- system logs (ADM-030/031)

export type LogKind = "jobs" | "notifications" | "flows" | "integrations" | "security";

export async function systemLogs(ctx: Ctx, kind: LogKind, f: { status?: string | null; q?: string | null; before?: string | null; limit?: number }) {
  ctx.need("settings", "full");
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const params: unknown[] = [ctx.org.id];
  const where = ["org_id = $1"];
  const before = (col: string) => {
    if (f.before && !Number.isNaN(Date.parse(f.before))) where.push(`${col} < $${params.push(f.before)}::timestamptz`);
  };
  switch (kind) {
    case "jobs": {
      if (f.status) where.push(`status = $${params.push(f.status)}`);
      if (f.q) where.push(`kind ilike $${params.push(`%${f.q}%`)}`);
      before("created_at");
      const rows = await ctx.db.query(`select id, kind, status, attempts, max_attempts, run_at, created_at, done_at, last_error from sm_jobs where ${where.join(" and ")} order by created_at desc, id desc limit ${limit}`, params);
      return { kind, rows, summary: await jobSummary(ctx.cfg, ctx.org.id) };
    }
    case "notifications": {
      if (f.status) where.push(`status = $${params.push(f.status)}`);
      if (f.q) where.push(`(coalesce(rule_name, '') ilike $${params.push(`%${f.q}%`)} or coalesce(record_number, '') ilike $${params.length})`);
      before("created_at");
      const rows = await ctx.db.query(
        `select id, created_at, rule_name, event, table_key, record_number, channel, status, reason, error from sm_notification_log where ${where.join(" and ")} order by created_at desc, id desc limit ${limit}`,
        params,
      );
      return { kind, rows };
    }
    case "flows": {
      if (f.status) where.push(`state = $${params.push(f.status)}`);
      if (f.q) where.push(`flow_name ilike $${params.push(`%${f.q}%`)}`);
      before("started_at");
      const rows = await ctx.db.query(
        `select id, flow_id, flow_name, state, test, trigger_kind, trigger_table, steps_count, error, started_at, ended_at from sm_flow_runs where ${where.join(" and ")} order by started_at desc, id desc limit ${limit}`,
        params,
      );
      return { kind, rows };
    }
    case "integrations": {
      if (f.status === "failed") where.push(`not ok`);
      if (f.q) where.push(`(kind ilike $${params.push(`%${f.q}%`)} or coalesce(target, '') ilike $${params.length} or coalesce(summary, '') ilike $${params.length})`);
      before("at");
      const rows = await ctx.db.query(`select id, at, kind, ref_id, method, target, status, ok, latency_ms, summary, error from sm_int_log where ${where.join(" and ")} order by at desc, id desc limit ${limit}`, params);
      return { kind, rows };
    }
    case "security": {
      if (f.status === "failed") where.push(`not ok`);
      if (f.q) where.push(`(kind ilike $${params.push(`%${f.q}%`)} or coalesce(email, '') ilike $${params.length})`);
      before("at");
      const rows = await ctx.db.query(`select id, at, kind, ok, user_id, email, ip from sm_security_events where ${where.join(" and ")} order by at desc limit ${limit}`, params);
      return { kind, rows };
    }
    default:
      throw bad("نوع گزارش شناخته نیست");
  }
}

/** The organisation's own failed or queued jobs: retry or cancel (audited). */
export async function orgJobAction(ctx: Ctx, id: string, action: "retry" | "cancel") {
  ctx.need("settings", "full");
  const r = action === "retry" ? await retryJob(ctx.db, id, ctx.org.id) : await cancelJob(ctx.db, id, ctx.org.id);
  await audit(ctx.db, ctx, `job_${action}`, "job", r.id, `${action === "retry" ? "اجرای دوباره" : "لغو"} کار ${r.kind}`);
  return r;
}

// ---------------------------------------------------------------- seats and licences (ADM-026)

export type SeatKind = "admin" | "agent" | "occasional" | "integration" | "none";

const AGENT_ROLES = new Set(["requester"]);

/** The seat a member consumes: administrators, agents (any role beyond requester), auditors as occasional, service accounts as integration. */
export function seatOf(m: { role: string; email: string; roles: string[]; persona: string | null; integration: boolean }): SeatKind {
  if (m.integration) return "integration";
  if (m.email.endsWith("@service.invalid")) return "none";
  if (m.role === "owner" || m.role === "admin" || m.roles.includes("tenant_admin")) return "admin";
  if (!m.roles.length) return m.role === "member" ? "agent" : m.role === "viewer" ? "occasional" : "none";
  if (m.roles.every((r) => AGENT_ROLES.has(r))) return "none";
  if (m.roles.every((r) => r === "auditor" || AGENT_ROLES.has(r))) return "occasional";
  return "agent";
}

export async function licences(ctx: Ctx) {
  ctx.need("settings", "view");
  const pools = await liveRows(ctx.db, sysOf(ctx), "licence_pool", null, { order: "t.kind, t.name" });
  const members = await ctx.db.query<{ user_id: string; name: string; email: string; role: string; last_login_at: string | null; roles: unknown; persona: string | null; integration: boolean }>(
    `select m.user_id, coalesce(nullif(u.full_name, ''), u.email) as name, lower(u.email) as email, m.role, u.last_login_at, p.roles, p.persona,
            exists (select 1 from sm_integration_users i where i.org_id = m.org_id and i.user_id = m.user_id and i.deleted_at is null) as integration
     from sm_org_members m join sm_users u on u.id = m.user_id
     left join sm_member_profiles p on p.org_id = m.org_id and p.user_id = m.user_id and p.deleted_at is null
     where m.org_id = $1 and m.deleted_at is null and m.is_active order by name`,
    [ctx.org.id],
  );
  const idleBefore = Date.now() - 30 * 86400_000;
  const people = members.map((m) => {
    const roles = Array.isArray(m.roles) ? (m.roles as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const seat = seatOf({ role: m.role, email: m.email, roles, persona: m.persona, integration: m.integration });
    const idle = seat !== "none" && seat !== "integration" && (!m.last_login_at || Date.parse(m.last_login_at) < idleBefore);
    return { user_id: m.user_id, name: m.name, email: m.email, seat, roles, last_login_at: m.last_login_at, idle };
  });
  const kinds: SeatKind[] = ["admin", "agent", "occasional", "integration"];
  // who holds which seat (names, addresses, roles, last sign-in) is the members' list: only for those who see members
  // and their access (the membership's «users» view and the access model's directory read); others get the totals
  const seesPeople = ctx.can("users", "view") && (await needAccessView(ctx).then(() => true).catch(() => false));
  const summary = kinds.map((k) => {
    const quantity = pools.filter((p) => p.kind === k && p.active !== false && (!p.valid_until || String(p.valid_until) >= new Date().toISOString().slice(0, 10))).reduce((a, p) => a + Number(p.quantity ?? 0), 0);
    const used = people.filter((p) => p.seat === k).length;
    const idle = people.filter((p) => p.seat === k && p.idle).length;
    return { kind: k, quantity, used, idle, over: quantity > 0 && used > quantity, warning: quantity > 0 && used >= quantity * 0.9 };
  });
  return { pools, summary, people: seesPeople ? people.filter((p) => p.seat !== "none") : [] };
}

// ---------------------------------------------------------------- notices (ADM-035)

/** Notices in force for every member (the platform owner's and the organisation's). */
export async function activeNotices(ctx: Ctx): Promise<Row[]> {
  const now = new Date().toISOString();
  return liveRows(ctx.db, ctx, "system_notice", { and: [{ f: "active", op: "eq", v: true }, { f: "starts_at", op: "lte", v: now }, { or: [{ f: "ends_at", op: "empty" }, { f: "ends_at", op: "gt", v: now }] }] }, { order: "t.starts_at desc", limit: 20 });
}

/** Tell every active member about a notice of the organisation (bell; e-mail too when critical). */
export async function publishNotice(ctx: Ctx, id: string): Promise<{ notified: number }> {
  ctx.need("settings", "edit");
  return ctx.write(async (tx) => {
    const [n] = await liveRows(tx, ctx, "system_notice", { f: "id", op: "in", v: [id] }, { limit: 1 });
    if (!n) throw notFound("اطلاعیه پیدا نشد");
    if (n.published_at) throw bad("این اطلاعیه پیش‌تر اعلام شده است");
    const members = await tx.query<{ user_id: string }>(
      `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id
       where m.org_id = $1 and m.deleted_at is null and m.is_active and not u.disabled and lower(u.email) not like '%@service.invalid'`,
      [ctx.org.id],
    );
    const users = members.map((m) => m.user_id);
    const critical = n.severity === "critical" || n.severity === "maintenance";
    for (let i = 0; i < users.length; i += 200) {
      await notifyPeople(tx, ctx.org.id, {
        table: "system_notice",
        id,
        users: users.slice(i, i + 200),
        subject: String(n.title),
        body: String(n.body ?? n.title),
        short_text: String(n.title),
        label: "اطلاعیهٔ سامانه",
        source: "اطلاعیهٔ سازمان",
        channels: critical ? ["in_app", "email"] : ["in_app"],
        mandatory: critical,
        actor: ctx.user.id,
      });
    }
    await updateIn(tx, ctx, "system_notice", id, { published_at: new Date().toISOString() }, { trusted: true });
    await audit(tx, ctx, "notice_publish", "system_notice", id, `اعلام «${n.title}» به ${faDigits(users.length)} عضو`);
    return { notified: users.length };
  });
}

/** A notice of the organisation, created and announced in one step. */
export async function createNotice(ctx: Ctx, input: { title: string; body?: string; severity?: string; starts_at?: string | null; ends_at?: string | null; publish?: boolean }) {
  ctx.need("settings", "edit");
  const row = await ctx.write((tx) => createIn(tx, ctx, "system_notice", { title: input.title, body: input.body ?? "", severity: input.severity ?? "info", starts_at: input.starts_at ?? undefined, ends_at: input.ends_at ?? null, active: true }));
  if (input.publish) await publishNotice(ctx, String(row.id));
  return row;
}
