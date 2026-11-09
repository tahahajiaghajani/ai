// HTTP API of workforce and agent experience under /api/o/:org/workforce (docs/modules/workforce_FA.md). Skills,
// person skills, certifications, coverage, shift patterns, rosters, time off, capacity, points and kudos are served by
// the generic engine API (/r/<table>) for those with the area's grants; these routes are the person's self-service
// (their own presence, skills, time off, coaching) and the views the engine cannot express, each checking who may see
// what (own data, the person's teams, those who oversee a team, «hr» for individual numbers of others).
//
//   GET  /meta · POST /seed · GET /home · POST /presence · POST /heartbeat · POST /prefs
//   GET  /teams/:group/board?from&days · GET /teams/:group/presence · GET /capacity?from&days&groups
//   GET  /routing/:table/:id · GET /experts?skill&level · GET /coverage?group
//   GET  /skills/mine · POST /skills/mine · POST /skills/:id/accept|decline|verify · POST /skills/infer
//   POST /absences · POST /absences/:id/cancel
//   GET  /performance?user&group&period · POST /coaching · GET /leaderboard?group · POST /kudos
import { z } from "zod";
import { grantIn } from "@shared/access";
import { router, body, query, type C } from "../http/hono";
import { forbidden, conflict, notFound } from "../http/errors";
import { prepareSubject, subjectOf } from "../access";
import { createIn, transitionIn, updateIn } from "../engine";
import {
  agentHome, capacityView, coachingFor, coverageReport, experts, groupsOfUser, heartbeat, inferSkills, leaderboard, managesWorkforce, myGroups, overseenGroups, performanceView,
  seedWorkforceDefaults, sendKudos, setPrefs, setPresence, suggestAssignees, teamBoard, teamPresence, workforceConfig, WORKFORCE_SEED_VERSION,
} from "../modules/workforce";
import { liveRow, liveRows, sysOf } from "../modules/workforce/common";
import { PRESENCE_STATES } from "@shared/tables/workforce";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");
const INSTANT = z.string().refine((s) => Number.isFinite(Date.parse(s)), "زمان معتبر نیست");

export const workforceRoutes = router();

/** People who work records (an agent's write scope in «کار», or any workforce grant): not requesters only. */
async function needAgent(c: C) {
  const ctx = c.get("ctx");
  await prepareSubject(ctx, ctx.db);
  const eff = subjectOf(ctx).eff;
  const work = grantIn(eff, "work");
  const wf = grantIn(eff, "workforce");
  if (!["group", "unit", "unit_tree", "domain", "all"].includes(work.write) && wf.read === "none") throw forbidden("این بخش برای کارشناسان است");
  return ctx;
}

workforceRoutes.get("/meta", async (c) => {
  const ctx = await needAgent(c);
  const cfg = await workforceConfig(ctx.db, sysOf(ctx));
  const over = await overseenGroups(ctx.db, ctx);
  return c.json({
    seeded: cfg.seeded >= WORKFORCE_SEED_VERSION,
    manages: await managesWorkforce(ctx.db, ctx),
    oversees: over,
    my_groups: await myGroups(ctx.db, ctx),
    config: { idle_minutes: cfg.idle_minutes, leaderboard_enabled: cfg.leaderboard_enabled, team_min_size: cfg.team_min_size, forecast_days: cfg.forecast_days },
  });
});

workforceRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  if (!(await managesWorkforce(ctx.db, ctx)) && !ctx.can("users", "full")) throw forbidden("افزودن پیش‌فرض‌های نیروی کار با مدیر نیروی کار یا مدیر سامانه است");
  return c.json(await seedWorkforceDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

workforceRoutes.get("/home", async (c) => c.json(await agentHome(await needAgent(c))));

workforceRoutes.post("/presence", async (c) => {
  const ctx = await needAgent(c);
  const input = await body(c, z.object({ state: z.enum(PRESENCE_STATES.map((o) => o.value) as [string, ...string[]]), note: z.string().trim().max(120).nullish() }));
  const row = await setPresence(ctx, input.state, input.note ?? null);
  return c.json({ presence: row.presence, since: row.presence_since, note: row.presence_note ?? null });
});

workforceRoutes.post("/heartbeat", async (c) => {
  const ctx = await needAgent(c);
  const input = await body(c, z.object({ idle_ms: z.number().int().min(0).max(30 * 86_400_000) }));
  return c.json(await heartbeat(ctx, input.idle_ms));
});

workforceRoutes.post("/prefs", async (c) => {
  const ctx = await needAgent(c);
  const input = await body(c, z.object({ leaderboard: z.boolean().optional(), wip_limit: z.number().int().min(1).max(200).nullish() }));
  const row = await setPrefs(ctx, input);
  return c.json({ leaderboard: !!row.leaderboard, wip_limit: row.wip_limit ?? null });
});

// ----- teams -----------------------------------------------------------------------------------------------------------

workforceRoutes.get("/teams/:group/board", async (c) => {
  const ctx = await needAgent(c);
  const q = query(c, z.object({ from: DATE.optional(), days: z.coerce.number().int().min(1).max(42).optional() }));
  const tz = String(ctx.org.settings?.timezone ?? "Asia/Tehran");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return c.json(await teamBoard(ctx, UUID.parse(c.req.param("group")), q.from ?? today, q.days ?? 14));
});

workforceRoutes.get("/teams/:group/presence", async (c) => {
  const ctx = await needAgent(c);
  return c.json({ people: await teamPresence(ctx, UUID.parse(c.req.param("group"))) });
});

workforceRoutes.get("/capacity", async (c) => {
  const ctx = await needAgent(c);
  const q = query(c, z.object({ from: DATE.optional(), days: z.coerce.number().int().min(7).max(90).optional(), groups: z.string().optional() }));
  const groups = q.groups ? q.groups.split(",").map((s) => UUID.parse(s.trim())) : undefined;
  return c.json(await capacityView(ctx, { from: q.from, days: q.days, groups }));
});

// ----- routing and skills ------------------------------------------------------------------------------------------------

workforceRoutes.get("/routing/:table/:id", async (c) => {
  const ctx = await needAgent(c);
  return c.json(await suggestAssignees(ctx, TABLE.parse(c.req.param("table")), UUID.parse(c.req.param("id"))));
});

workforceRoutes.get("/experts", async (c) => {
  const ctx = await needAgent(c);
  const q = query(c, z.object({ skill: UUID, level: z.coerce.number().int().min(1).max(5).optional() }));
  return c.json({ people: await experts(ctx, q.skill, q.level ?? 3) });
});

workforceRoutes.get("/coverage", async (c) => {
  const ctx = await needAgent(c);
  const q = query(c, z.object({ group: UUID.optional() }));
  return c.json({ rows: await coverageReport(ctx, { group: q.group ?? null }) });
});

// the catalogue for people without the area's grants (the generic list is for managers; single rows open to everyone)
workforceRoutes.get("/skills/catalogue", async (c) => {
  const ctx = await needAgent(c);
  const rows = await liveRows(ctx.db, sysOf(ctx), "wfm_skill", { f: "active", op: "eq", v: true }, { order: "t.category, t.name", limit: 2000 });
  return c.json({ skills: rows.map((r) => ({ id: r.id, name: r.name, category: r.category ?? null, sfia_code: r.sfia_code ?? null, description: r.description ?? null })) });
});

workforceRoutes.get("/skills/mine", async (c) => {
  const ctx = await needAgent(c);
  const rows = await liveRows(ctx.db, ctx, "wfm_person_skill", { f: "user_id", op: "eq", v: ctx.user.id }, { order: "t.created_at", limit: 500 });
  return c.json({ skills: rows.map((r) => ({ id: r.id, skill_id: r.skill_id, label: r.label, level: r.level, source: r.source, status: r.status, verified: !!r.verified, expires_at: r.expires_at ?? null, evidence: r.evidence ?? null })) });
});

workforceRoutes.post("/skills/mine", async (c) => {
  const ctx = await needAgent(c);
  const input = await body(c, z.object({ skill_id: UUID, level: z.number().int().min(1).max(5), evidence: z.string().trim().max(4000).nullish(), expires_at: DATE.nullish() }));
  const actor = sysOf(ctx, ctx.user.id);
  const skill = await liveRow(ctx.db, ctx, "wfm_skill", input.skill_id);
  if (!skill) throw notFound("مهارت پیدا نشد");
  const row = await actor.write(async (tx) => {
    const [mine] = await liveRows(tx, actor, "wfm_person_skill", { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { f: "skill_id", op: "eq", v: input.skill_id }] }, { limit: 1 });
    const values = { level: input.level, evidence: input.evidence ?? null, expires_at: input.expires_at ?? null, status: "active" };
    if (mine) return updateIn(tx, actor, "wfm_person_skill", String(mine.id), values, { trusted: true });
    return createIn(tx, actor, "wfm_person_skill", { user_id: ctx.user.id, skill_id: input.skill_id, source: "self", ...values }, { trusted: true });
  });
  return c.json({ id: row.id, level: row.level, verified: !!row.verified });
});

async function ownSuggested(c: C) {
  const ctx = await needAgent(c);
  const id = UUID.parse(c.req.param("id"));
  const row = await liveRow(ctx.db, sysOf(ctx), "wfm_person_skill", id);
  if (!row || row.user_id !== ctx.user.id) throw notFound("مهارت پیدا نشد");
  if (row.status !== "suggested") throw conflict("این مهارت پیشنهاد در انتظار نیست");
  return { ctx, id };
}

workforceRoutes.post("/skills/:id/accept", async (c) => {
  const { ctx, id } = await ownSuggested(c);
  const actor = sysOf(ctx, ctx.user.id);
  await actor.write((tx) => updateIn(tx, actor, "wfm_person_skill", id, { status: "active" }, { trusted: true }));
  return c.json({ ok: true });
});

workforceRoutes.post("/skills/:id/decline", async (c) => {
  const { ctx, id } = await ownSuggested(c);
  const actor = sysOf(ctx, ctx.user.id);
  await actor.write((tx) => updateIn(tx, actor, "wfm_person_skill", id, { status: "declined" }, { trusted: true }));
  return c.json({ ok: true });
});

workforceRoutes.post("/skills/:id/verify", async (c) => {
  const ctx = await needAgent(c);
  const id = UUID.parse(c.req.param("id"));
  const input = await body(c, z.object({ level: z.number().int().min(1).max(5).optional() }));
  const row = await liveRow(ctx.db, sysOf(ctx), "wfm_person_skill", id);
  if (!row) throw notFound("مهارت پیدا نشد");
  if (row.user_id === ctx.user.id) throw forbidden("مهارت خود را دیگری تأیید می‌کند");
  const over = await overseenGroups(ctx.db, ctx);
  const theirs = await groupsOfUser(ctx.db, sysOf(ctx), String(row.user_id));
  if (!over.all && !theirs.some((g) => over.groups.includes(g))) throw forbidden("تأیید مهارت با سرپرست تیم آن فرد یا مدیر نیروی کار است");
  const actor = sysOf(ctx, ctx.user.id);
  await actor.write((tx) => updateIn(tx, actor, "wfm_person_skill", id, {
    ...(input.level ? { level: input.level } : {}), verified: true, verified_by: ctx.user.id, verified_at: new Date().toISOString(), status: "active", ...(row.source === "self" ? { source: "manager" } : {}),
  }, { trusted: true }));
  return c.json({ ok: true });
});

workforceRoutes.post("/skills/infer", async (c) => {
  const ctx = await needAgent(c);
  return c.json(await inferSkills(ctx, ctx.user.id));
});

// ----- time off --------------------------------------------------------------------------------------------------------

workforceRoutes.post("/absences", async (c) => {
  const ctx = await needAgent(c);
  const input = await body(c, z.object({ type: z.string().min(1).max(40), start_at: INSTANT, end_at: INSTANT, delegate_id: UUID.nullish(), note: z.string().trim().max(2000).nullish(), group_id: UUID.nullish() }));
  if (input.group_id && !(await myGroups(ctx.db, ctx)).includes(input.group_id)) throw forbidden("تیم مرخصی باید یکی از تیم‌های شما باشد");
  const actor = sysOf(ctx, ctx.user.id);
  const row = await actor.write((tx) => createIn(tx, actor, "wfm_absence", { user_id: ctx.user.id, type: input.type, start_at: input.start_at, end_at: input.end_at, delegate_id: input.delegate_id ?? null, note: input.note ?? null, group_id: input.group_id ?? null }, { trusted: true }));
  return c.json({ id: row.id, number: row.number ?? null, state: row.state, approval: row.approval ?? null, days: row.days ?? null });
});

workforceRoutes.post("/absences/:id/cancel", async (c) => {
  const ctx = await needAgent(c);
  const id = UUID.parse(c.req.param("id"));
  const row = await liveRow(ctx.db, sysOf(ctx), "wfm_absence", id);
  if (!row || row.user_id !== ctx.user.id) throw notFound("مرخصی پیدا نشد");
  if (!["requested", "approved"].includes(String(row.state))) throw conflict("این مرخصی دیگر لغو نمی‌شود");
  const actor = sysOf(ctx, ctx.user.id);
  await actor.write((tx) => transitionIn(tx, actor, "wfm_absence", id, "canceled", {}, { trusted: true }));
  return c.json({ ok: true });
});

// ----- performance, coaching, gamification -----------------------------------------------------------------------------

workforceRoutes.get("/performance", async (c) => {
  const ctx = await needAgent(c);
  const q = query(c, z.object({ user: UUID.optional(), group: UUID.optional(), period: z.enum(["month", "last_month", "quarter"]).optional() }));
  return c.json(await performanceView(ctx, q));
});

workforceRoutes.post("/coaching", async (c) => c.json(await coachingFor(await needAgent(c))));

workforceRoutes.get("/leaderboard", async (c) => {
  const ctx = await needAgent(c);
  const q = query(c, z.object({ group: UUID.optional() }));
  return c.json(await leaderboard(ctx, { group: q.group ?? null }));
});

workforceRoutes.post("/kudos", async (c) => {
  const ctx = await needAgent(c);
  const input = await body(c, z.object({ to_id: UUID, message: z.string().trim().min(2).max(300), table: TABLE.nullish(), id: UUID.nullish() }));
  const row = await sendKudos(ctx, input);
  return c.json({ id: row.id });
});
