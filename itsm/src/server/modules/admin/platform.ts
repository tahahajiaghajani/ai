// The platform owner's console (catalogue ADM-015/016/025/029/031/032/035, routes/admin-platform.ts under /api/admin —
// only `is_platform_admin`, never an organisation's administrator): plans and limits, organisations' plans and usage,
// feature flags, announcements to organisations, the job monitor, the version and upgrade status and the audit log of
// every organisation. Every change is written to sm_audit as the platform's own action (actor_kind 'platform').
import type { AuthUser, ServerConfig } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { uuidv7 } from "@shared/id";
import { APP_VERSION, SYNC_PROTOCOL } from "@shared/constants";
import { bad, conflict, notFound } from "../../http/errors";
import { platformAudit } from "../platform/audit";
import { enqueue, tick, registerJobHandler } from "../../jobs";
import { createIn, systemCtx, updateIn } from "../../engine";
import { migrationStatus } from "../../db/migrate";
import { notifyPeople } from "../notify";
import {
  cleanLimits, FLAG_KEY, flagState, limitTone, PLAN_KEY, type FlagRow, type FlagStage, type Limits, type PlanRow,
} from "@shared/admin/plans";
import { flagRows, liveRows, orgPlan, planRows, usageOf } from "./common";
import { ADMIN_CHANGELOG } from "./changelog";

type Admin = AuthUser;

// ---------------------------------------------------------------- plans

export async function listPlans(cfg: ServerConfig): Promise<{ plans: (PlanRow & { orgs: number })[] }> {
  const plans = await planRows(cfg.db);
  const rows = await cfg.db.query<{ plan: string | null; n: number }>(
    `select a.limits->>'plan' as plan, count(*)::int as n from sm_orgs o left join sm_org_admin a on a.org_id = o.id where o.deleted_at is null group by 1`,
  );
  const def = plans.find((p) => p.is_default)?.key ?? null;
  const count = (key: string) => rows.filter((r) => (r.plan ?? def) === key || (r.plan && !plans.some((p) => p.key === r.plan) && key === def)).reduce((a, r) => a + r.n, 0);
  return { plans: plans.map((p) => ({ ...p, orgs: count(p.key) })) };
}

export interface PlanInput {
  name: string;
  description?: string | null;
  limits: Record<string, unknown>;
  features?: string[];
  sort_order?: number;
  is_default?: boolean;
  active?: boolean;
}

export async function savePlan(cfg: ServerConfig, admin: Admin, key: string, input: PlanInput): Promise<PlanRow> {
  if (!PLAN_KEY.test(key)) throw bad("کلید طرح باید با حرف کوچک لاتین شروع شود و فقط حرف، رقم و _ داشته باشد");
  const limits = cleanLimits(input.limits);
  await cfg.db.tx(async (tx) => {
    if (input.is_default) await tx.query(`update sm_plans set is_default = false where key <> $1`, [key]);
    await tx.query(
      `insert into sm_plans (key, name, description, limits, features, sort_order, is_default, active, updated_by, updated_at)
       values ($1, $2, $3, $4::jsonb, $5::text[], $6, $7, $8, $9, now())
       on conflict (key) do update set name = excluded.name, description = excluded.description, limits = excluded.limits, features = excluded.features,
         sort_order = excluded.sort_order, is_default = excluded.is_default or sm_plans.is_default and not $10, active = excluded.active, updated_by = excluded.updated_by, updated_at = now()`,
      [key, input.name.trim(), input.description ?? null, JSON.stringify(limits), pgArray(input.features ?? []), input.sort_order ?? 0, !!input.is_default, input.active !== false, admin.id, input.is_default === false],
    );
    const def = await tx.one<{ n: number }>(`select count(*)::int as n from sm_plans where is_default`);
    if (!def?.n) throw bad("یک طرح باید پیش‌فرض بماند");
    await platformAudit(tx, cfg, admin, { action: "plan_save", entity: "plan", summary: `طرح «${input.name}» (${key})`, data: { key, limits } });
  });
  return (await planRows(cfg.db)).find((p) => p.key === key)!;
}

export async function deletePlan(cfg: ServerConfig, admin: Admin, key: string): Promise<void> {
  const plans = await listPlans(cfg);
  const p = plans.plans.find((x) => x.key === key);
  if (!p) throw notFound("طرح پیدا نشد");
  if (p.is_default) throw bad("طرح پیش‌فرض حذف نمی‌شود؛ نخست طرح دیگری را پیش‌فرض کنید");
  if (p.orgs) throw conflict(`${p.orgs.toLocaleString("fa-IR")} سازمان این طرح را دارند`);
  await cfg.db.tx(async (tx) => {
    await tx.query(`delete from sm_plans where key = $1`, [key]);
    await platformAudit(tx, cfg, admin, { action: "plan_delete", entity: "plan", summary: `حذف طرح «${p.name}»`, data: { key } });
  });
}

/** An organisation's plan and its own limit overrides (stored in its platform state). */
export async function setOrgPlan(cfg: ServerConfig, admin: Admin, orgId: string, input: { plan: string; overrides?: Record<string, unknown> }): Promise<OrgUsage> {
  const org = await cfg.db.one<{ name: string }>(`select name from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("سازمان پیدا نشد");
  const plans = await planRows(cfg.db);
  if (!plans.some((p) => p.key === input.plan)) throw bad("طرح پیدا نشد");
  const limits = { plan: input.plan, ...cleanLimits(input.overrides ?? {}) };
  await cfg.db.tx(async (tx) => {
    await tx.query(
      `insert into sm_org_admin (org_id, limits, updated_by, updated_at) values ($1, $2::jsonb, $3, now())
       on conflict (org_id) do update set limits = excluded.limits, updated_by = excluded.updated_by, updated_at = now()`,
      [orgId, JSON.stringify(limits), admin.id],
    );
    await platformAudit(tx, cfg, admin, { org_id: orgId, action: "org_plan", entity: "org", entity_id: orgId, summary: `طرح «${org.name}»: ${input.plan}`, data: limits });
  });
  return orgUsage(cfg, orgId);
}

export interface OrgUsage {
  org_id: string;
  plan: string;
  plan_name: string | null;
  overrides: Limits;
  limits: Limits;
  usage: Record<string, number>;
  tones: Record<string, "ok" | "warning" | "danger">;
}

export async function orgUsage(cfg: ServerConfig, orgId: string): Promise<OrgUsage> {
  const [plan, usage] = await Promise.all([orgPlan(cfg.db, orgId, cfg.mode), usageOf(cfg.db, orgId)]);
  const tones: OrgUsage["tones"] = {};
  for (const [k, v] of Object.entries(usage)) tones[k] = limitTone(v, plan.limits[k as keyof Limits]);
  return { org_id: orgId, plan: plan.key, plan_name: plan.plan?.name ?? null, overrides: plan.overrides, limits: plan.limits, usage, tones };
}

// ---------------------------------------------------------------- feature flags

export async function listFlags(cfg: ServerConfig) {
  const flags = await flagRows(cfg.db);
  const orgs = await cfg.db.query<{ id: string; plan: string | null }>(
    `select o.id, a.limits->>'plan' as plan from sm_orgs o left join sm_org_admin a on a.org_id = o.id where o.deleted_at is null`,
  );
  const def = (await planRows(cfg.db)).find((p) => p.is_default)?.key ?? null;
  return {
    flags: flags.map((f) => ({ ...f, orgs_enabled: orgs.filter((o) => flagState(f, { id: o.id, plan: o.plan ?? def }).on).length, orgs_total: orgs.length })),
  };
}

export interface FlagInput {
  label: string;
  description?: string | null;
  stage: FlagStage;
  percent?: number;
  plans?: string[];
  orgs_on?: string[];
  orgs_off?: string[];
  tenant_toggle?: boolean;
}

const uuids = (xs: string[] | undefined) => [...new Set((xs ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).map((x) => x.toLowerCase()))];

export async function saveFlag(cfg: ServerConfig, admin: Admin, key: string, input: FlagInput): Promise<FlagRow> {
  if (!FLAG_KEY.test(key)) throw bad("کلید قابلیت باید با حرف کوچک لاتین شروع شود و فقط حرف، رقم و _ داشته باشد");
  const on = uuids(input.orgs_on);
  const off = uuids(input.orgs_off).filter((x) => !on.includes(x));
  await cfg.db.tx(async (tx) => {
    await tx.query(
      `insert into sm_platform_flags (key, label, description, stage, percent, plans, orgs_on, orgs_off, tenant_toggle, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6::text[], $7::uuid[], $8::uuid[], $9, $10, now())
       on conflict (key) do update set label = excluded.label, description = excluded.description, stage = excluded.stage, percent = excluded.percent,
         plans = excluded.plans, orgs_on = excluded.orgs_on, orgs_off = excluded.orgs_off, tenant_toggle = excluded.tenant_toggle, updated_by = excluded.updated_by, updated_at = now()`,
      [key, input.label.trim(), input.description ?? null, input.stage, Math.max(0, Math.min(100, Math.round(input.percent ?? 100))), pgArray(input.plans ?? []), pgArray(on), pgArray(off), input.tenant_toggle !== false, admin.id],
    );
    await platformAudit(tx, cfg, admin, { action: "flag_save", entity: "flag", summary: `قابلیت «${input.label}» (${key}): ${input.stage}`, data: { key, ...input, orgs_on: on, orgs_off: off } });
  });
  return (await flagRows(cfg.db)).find((f) => f.key === key)!;
}

export async function deleteFlag(cfg: ServerConfig, admin: Admin, key: string): Promise<void> {
  await cfg.db.tx(async (tx) => {
    const r = await tx.one(`delete from sm_platform_flags where key = $1 returning key`, [key]);
    if (!r) throw notFound("قابلیت پیدا نشد");
    await platformAudit(tx, cfg, admin, { action: "flag_delete", entity: "flag", summary: `حذف کلید قابلیت ${key}`, data: { key } });
  });
}

// ---------------------------------------------------------------- announcements

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical" | "maintenance";
  audience: "all" | "orgs" | "plans";
  org_ids: string[];
  plans: string[];
  starts_at: string;
  ends_at: string | null;
  published_at: string | null;
  delivered: number;
  created_at: string;
}

export async function listAnnouncements(cfg: ServerConfig): Promise<{ announcements: AnnouncementRow[] }> {
  const rows = await cfg.db.query<AnnouncementRow>(
    `select id, title, body, severity, audience, org_ids, plans, starts_at, ends_at, published_at, delivered, created_at
     from sm_platform_announcements where deleted_at is null order by created_at desc limit 200`,
  );
  return { announcements: rows };
}

export interface AnnouncementInput {
  title: string;
  body?: string;
  severity: AnnouncementRow["severity"];
  audience: AnnouncementRow["audience"];
  org_ids?: string[];
  plans?: string[];
  starts_at?: string | null;
  ends_at?: string | null;
}

export async function saveAnnouncement(cfg: ServerConfig, admin: Admin, id: string | null, input: AnnouncementInput): Promise<AnnouncementRow> {
  if (input.audience === "orgs" && !uuids(input.org_ids).length) throw bad("سازمان‌های گیرنده را انتخاب کنید");
  if (input.audience === "plans" && !(input.plans ?? []).length) throw bad("طرح‌های گیرنده را انتخاب کنید");
  if (input.ends_at && input.starts_at && Date.parse(input.ends_at) <= Date.parse(input.starts_at)) throw bad("پایان باید پس از آغاز باشد");
  const rowId = id ?? uuidv7();
  await cfg.db.tx(async (tx) => {
    if (id) {
      const cur = await tx.one<{ published_at: string | null }>(`select published_at from sm_platform_announcements where id = $1 and deleted_at is null`, [id]);
      if (!cur) throw notFound("اطلاعیه پیدا نشد");
      if (cur.published_at) throw conflict("اطلاعیهٔ اعلام‌شده تغییر نمی‌کند؛ اطلاعیهٔ تازه بفرستید");
    }
    await tx.query(
      `insert into sm_platform_announcements (id, title, body, severity, audience, org_ids, plans, starts_at, ends_at, created_by)
       values ($1, $2, $3, $4, $5, $6::uuid[], $7::text[], coalesce($8::timestamptz, now()), $9, $10)
       on conflict (id) do update set title = excluded.title, body = excluded.body, severity = excluded.severity, audience = excluded.audience,
         org_ids = excluded.org_ids, plans = excluded.plans, starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()`,
      [rowId, input.title.trim(), input.body ?? "", input.severity, input.audience, pgArray(uuids(input.org_ids)), pgArray(input.plans ?? []), input.starts_at ?? null, input.ends_at ?? null, admin.id],
    );
    await platformAudit(tx, cfg, admin, { action: "announcement_save", entity: "announcement", entity_id: rowId, summary: `اطلاعیهٔ «${input.title}»` });
  });
  return (await listAnnouncements(cfg)).announcements.find((a) => a.id === rowId)!;
}

/** The organisations an announcement reaches. */
async function audienceOrgs(q: Queryable, a: AnnouncementRow): Promise<string[]> {
  if (a.audience === "orgs") {
    return (await q.query<{ id: string }>(`select id from sm_orgs where id = any($1::uuid[]) and deleted_at is null`, [pgArray(a.org_ids ?? [])])).map((r) => r.id);
  }
  const rows = await q.query<{ id: string; plan: string | null }>(
    `select o.id, a.limits->>'plan' as plan from sm_orgs o left join sm_org_admin a on a.org_id = o.id where o.deleted_at is null order by o.created_at`,
  );
  if (a.audience === "all") return rows.map((r) => r.id);
  const def = (await planRows(q)).find((p) => p.is_default)?.key ?? null;
  return rows.filter((r) => a.plans.includes(r.plan ?? def ?? "")).map((r) => r.id);
}

/** Publish: one job per organisation materialises the notice and tells its members (bell, and e-mail when critical). */
export async function publishAnnouncement(cfg: ServerConfig, admin: Admin, id: string): Promise<{ orgs: number }> {
  const a = (await listAnnouncements(cfg)).announcements.find((x) => x.id === id);
  if (!a) throw notFound("اطلاعیه پیدا نشد");
  if (a.published_at) throw conflict("این اطلاعیه پیش‌تر اعلام شده است");
  const orgs = await audienceOrgs(cfg.db, a);
  await cfg.db.tx(async (tx) => {
    await tx.query(`update sm_platform_announcements set published_at = now(), updated_at = now() where id = $1`, [id]);
    for (const orgId of orgs) await enqueue(tx, { kind: "admin.announce", orgId, payload: { id }, dedupeKey: `announce:${id}`, maxAttempts: 5 });
    await platformAudit(tx, cfg, admin, { action: "announcement_publish", entity: "announcement", entity_id: id, summary: `اعلام «${a.title}» به ${orgs.length.toLocaleString("fa-IR")} سازمان` });
  });
  return { orgs: orgs.length };
}

/** Withdraw: the notices it made are switched off in every organisation. */
export async function deleteAnnouncement(cfg: ServerConfig, admin: Admin, id: string): Promise<void> {
  const a = (await listAnnouncements(cfg)).announcements.find((x) => x.id === id);
  if (!a) throw notFound("اطلاعیه پیدا نشد");
  const orgs = a.published_at ? await audienceOrgs(cfg.db, a) : [];
  await cfg.db.tx(async (tx) => {
    await tx.query(`update sm_platform_announcements set deleted_at = now(), updated_at = now() where id = $1`, [id]);
    for (const orgId of orgs) await enqueue(tx, { kind: "admin.announce", orgId, payload: { id, retract: true }, maxAttempts: 5 });
    await platformAudit(tx, cfg, admin, { action: "announcement_delete", entity: "announcement", entity_id: id, summary: `برداشتن اطلاعیهٔ «${a.title}»` });
  });
}

/** The job of one organisation: create (or switch off) its notice and tell its members. */
async function announceInOrg(cfg: ServerConfig, orgId: string, id: string, retract: boolean): Promise<void> {
  const a = await cfg.db.one<AnnouncementRow>(`select * from sm_platform_announcements where id = $1`, [id]);
  if (!a) return;
  const sys = await systemCtx(cfg, orgId);
  await sys.write(async (tx) => {
    const [existing] = await liveRows(tx, sys, "system_notice", { f: "announcement_id", op: "eq", v: id }, { limit: 1 });
    if (retract) {
      if (existing) await updateIn(tx, sys, "system_notice", String(existing.id), { active: false }, { trusted: true });
      return;
    }
    if (existing) return;
    const notice = await createIn(
      tx,
      sys,
      "system_notice",
      { title: a.title, body: a.body, severity: a.severity, starts_at: a.starts_at, ends_at: a.ends_at, active: true, source: "platform", announcement_id: id, published_at: new Date().toISOString() },
      { trusted: true },
    );
    const members = await tx.query<{ user_id: string }>(
      `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id
       where m.org_id = $1 and m.deleted_at is null and m.is_active and not u.disabled and lower(u.email) not like '%@service.invalid'`,
      [orgId],
    );
    const users = members.map((m) => m.user_id);
    const critical = a.severity === "critical" || a.severity === "maintenance";
    for (let i = 0; i < users.length; i += 200) {
      await notifyPeople(tx, orgId, {
        table: "system_notice",
        id: String(notice.id),
        users: users.slice(i, i + 200),
        subject: a.title,
        body: a.body || a.title,
        short_text: a.title,
        label: "اطلاعیهٔ سامانه",
        source: "اطلاعیهٔ مدیر سامانه",
        channels: critical ? ["in_app", "email"] : ["in_app"],
        mandatory: critical,
      });
    }
    await tx.query(`update sm_platform_announcements set delivered = delivered + 1 where id = $1`, [id]);
  });
}

// ---------------------------------------------------------------- jobs

export async function jobSummary(cfg: ServerConfig, orgId: string | null = null) {
  const params: unknown[] = [];
  const scope = orgId ? (params.push(orgId), `where org_id = $${params.length}`) : "";
  const kinds = await cfg.db.query<{ kind: string; queued: number; running: number; failed: number; done: number; oldest_queued: string | null }>(
    `select kind,
       count(*) filter (where status = 'queued')::int as queued,
       count(*) filter (where status = 'running')::int as running,
       count(*) filter (where status = 'failed')::int as failed,
       count(*) filter (where status = 'done')::int as done,
       min(run_at) filter (where status = 'queued' and run_at <= now()) as oldest_queued
     from sm_jobs ${scope} group by kind order by kind`,
    params,
  );
  const totals = kinds.reduce((a, k) => ({ queued: a.queued + k.queued, running: a.running + k.running, failed: a.failed + k.failed, done: a.done + k.done }), { queued: 0, running: 0, failed: 0, done: 0 });
  const oldest = kinds.map((k) => k.oldest_queued).filter((x): x is string => !!x).sort()[0] ?? null;
  const failed24 = await cfg.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where status = 'failed' and done_at > now() - interval '24 hours' ${orgId ? "and org_id = $1" : ""}`, orgId ? [orgId] : []);
  return { kinds, totals, oldest_due_at: oldest, backlog_seconds: oldest ? Math.max(0, Math.round((Date.now() - Date.parse(oldest)) / 1000)) : 0, failed_24h: failed24?.n ?? 0 };
}

export async function listJobs(cfg: ServerConfig, f: { status?: string | null; kind?: string | null; org?: string | null; limit?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status && ["queued", "running", "done", "failed"].includes(f.status)) where.push(`j.status = $${params.push(f.status)}`);
  if (f.kind) where.push(`j.kind = $${params.push(f.kind)}`);
  if (f.org) where.push(`j.org_id = $${params.push(f.org)}`);
  const rows = await cfg.db.query(
    `select j.id, j.org_id, o.name as org_name, j.kind, j.status, j.attempts, j.max_attempts, j.run_at, j.created_at, j.done_at, j.last_error, j.dedupe_key
     from sm_jobs j left join sm_orgs o on o.id = j.org_id ${where.length ? `where ${where.join(" and ")}` : ""}
     order by j.created_at desc, j.id desc limit ${Math.min(Math.max(f.limit ?? 100, 1), 500)}`,
    params,
  );
  return { jobs: rows };
}

/** Retry a failed job now (attempts start again) — the platform owner, or an organisation's administrator for its own. */
export async function retryJob(q: Queryable, id: string, orgId: string | null): Promise<{ id: string; kind: string; org_id: string | null }> {
  const r = await q.one<{ id: string; kind: string; org_id: string | null }>(
    `update sm_jobs set status = 'queued', attempts = 0, run_at = now(), locked_until = null, locked_by = null, done_at = null, updated_at = now()
     where id = $1 and status = 'failed' ${orgId ? "and org_id = $2" : ""} returning id, kind, org_id`,
    orgId ? [id, orgId] : [id],
  );
  if (!r) throw notFound("کار ناموفقی با این شناسه پیدا نشد");
  return r;
}

/** Cancel a queued job (kept as failed with the reason). */
export async function cancelJob(q: Queryable, id: string, orgId: string | null): Promise<{ id: string; kind: string; org_id: string | null }> {
  const r = await q.one<{ id: string; kind: string; org_id: string | null }>(
    `update sm_jobs set status = 'failed', last_error = 'لغو به دست مدیر', done_at = now(), updated_at = now()
     where id = $1 and status = 'queued' ${orgId ? "and org_id = $2" : ""} returning id, kind, org_id`,
    orgId ? [id, orgId] : [id],
  );
  if (!r) throw notFound("کار در صفی با این شناسه پیدا نشد");
  return r;
}

export async function jobAction(cfg: ServerConfig, admin: Admin, id: string, action: "retry" | "cancel") {
  const r = action === "retry" ? await retryJob(cfg.db, id, null) : await cancelJob(cfg.db, id, null);
  await platformAudit(cfg.db, cfg, admin, { org_id: r.org_id, action: `job_${action}`, entity: "job", entity_id: r.id, summary: `${action === "retry" ? "اجرای دوباره" : "لغو"} کار ${r.kind}` });
  return r;
}

export async function tickNow(cfg: ServerConfig) {
  return tick(cfg, { budgetMs: 5000 });
}

// ---------------------------------------------------------------- version and upgrade status

export async function versionStatus(cfg: ServerConfig) {
  const schema = await migrationStatus(cfg.db);
  const ddl = await cfg.db.one<{ value: string | null; updated_at: string }>(`select value, updated_at from sm_meta where key = 'engine.ddl'`).catch(() => null);
  const devices = await cfg.db.query<{ app_version: string | null; n: number; last: string | null }>(
    `select app_version, count(*)::int as n, max(greatest(last_push_at, last_pull_at)) as last from sm_devices where revoked_at is null group by app_version order by app_version`,
  );
  const orgs = await cfg.db.one<{ n: number }>(`select count(*)::int as n from sm_orgs where deleted_at is null`);
  const outdated = devices.filter((d) => d.app_version && d.app_version !== APP_VERSION).reduce((a, d) => a + d.n, 0);
  return {
    app_version: APP_VERSION,
    sync_protocol: SYNC_PROTOCOL,
    mode: cfg.mode,
    node: process.version,
    schema: { applied: schema.applied.length, pending: schema.pending, current: schema.current, latest: schema.latest },
    engine_ddl: ddl ? { hash: ddl.value, updated_at: ddl.updated_at } : null,
    devices,
    devices_outdated: outdated,
    orgs: orgs?.n ?? 0,
    changelog: ADMIN_CHANGELOG,
  };
}

// ---------------------------------------------------------------- the audit log of every organisation

export async function auditAll(cfg: ServerConfig, f: { org?: string | null; actor?: string | null; q?: string | null; action?: string | null; before?: string | null; limit?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.org) where.push(`a.org_id = $${params.push(f.org)}`);
  if (f.actor && ["user", "platform", "support"].includes(f.actor)) where.push(`a.actor_kind = $${params.push(f.actor)}`);
  if (f.action) where.push(`a.action = $${params.push(f.action)}`);
  if (f.q) where.push(`(a.summary ilike $${params.push(`%${f.q}%`)} or u.full_name ilike $${params.length} or u.email ilike $${params.length})`);
  if (f.before) where.push(`a.at < $${params.push(f.before)}::timestamptz`);
  const rows = await cfg.db.query(
    `select a.id, a.at, a.org_id, o.name as org_name, a.user_id, coalesce(nullif(u.full_name, ''), u.email) as actor_name, a.actor_kind, a.action, a.entity, a.entity_id, a.summary
     from sm_audit a left join sm_users u on u.id = a.user_id left join sm_orgs o on o.id = a.org_id
     ${where.length ? `where ${where.join(" and ")}` : ""} order by a.at desc, a.id desc limit ${Math.min(Math.max(f.limit ?? 100, 1), 1000)}`,
    params,
  );
  return { rows };
}

// ---------------------------------------------------------------- jobs of this file

let installed = false;
export function installPlatformJobs(): void {
  if (installed) return;
  installed = true;
  registerJobHandler("admin.announce", async (job, jctx) => {
    if (!job.org_id) return;
    await announceInOrg(jctx.cfg as ServerConfig, job.org_id, String(job.payload.id), !!job.payload.retract);
  });
}
