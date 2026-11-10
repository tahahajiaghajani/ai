// Light gamification (WFM-035/036): points are earned from what work already records — a record resolved by its
// assignee (more when within its agreement's timers or without reassignment), a satisfied requester, a published
// knowledge article, a colleague's kudos — once per person, reason and record (the ledger is append-only and written
// by the system). Levels and badges are computed, never stored. The leaderboard lists only people who opted in;
// team totals are the default view (no «hero» culture).
import { tableDef } from "@shared/tables";
import { periodOf } from "@shared/slm/logic";
import { badgesOf, levelOf } from "@shared/workforce/logic";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { createIn, onRecordEvent, systemCtx, type RecordEvent } from "../../engine";
import type { JobContext } from "../../jobs";
import { forbidden, notFound } from "../../http/errors";
import { actsHere } from "../notify";
import { countRows, isUuid, liveRow, liveRows, membersOf, myGroups, namesOf, overseesGroup, sysOf, todayOf, workforceConfig, type Row } from "./common";

export interface Award {
  user_id: string;
  reason: string;
  points: number;
  record_id: string;
  table_key: string | null;
  record_number: string | null;
}

/** Add points once per person, reason and record (inside `tx`, as the system). */
export async function awardIn(tx: Tx, ctx: Ctx, a: Award): Promise<boolean> {
  if (!isUuid(a.user_id) || a.points <= 0) return false;
  const sys = sysOf(ctx);
  const [exists] = await liveRows(tx, sys, "wfm_points", { and: [{ f: "user_id", op: "eq", v: a.user_id }, { f: "reason", op: "eq", v: a.reason }, { f: "record_id", op: "eq", v: a.record_id }] }, { limit: 1 });
  if (exists) return false;
  await createIn(tx, sys, "wfm_points", { ...a, period: periodOf(todayOf(sys), "month").key, at: new Date().toISOString() }, { trusted: true });
  return true;
}

/** Points for a resolved record (its assignee): resolved, within its timers, first contact. */
export async function awardResolution(q: Tx, ctx: Ctx, table: string, rec: Row): Promise<number> {
  const sys = sysOf(ctx);
  const cfg = await workforceConfig(q, sys);
  const user = rec.assigned_to;
  if (!isUuid(user)) return 0;
  const base = { user_id: String(user), record_id: String(rec.id), table_key: table, record_number: rec.number ?? null };
  let n = 0;
  if (await awardIn(q, sys, { ...base, reason: "resolved", points: cfg.points_resolved })) n++;
  const timers = await liveRows(q, sys, "task_sla", { and: [{ f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: rec.id }] }, { limit: 50 });
  if (timers.length && !timers.some((t) => t.breached) && (await awardIn(q, sys, { ...base, reason: "within_sla", points: cfg.points_within_sla }))) n++;
  if (Number(rec.reassignment_count ?? 0) === 0 && Number(rec.reopen_count ?? 0) === 0 && (await awardIn(q, sys, { ...base, reason: "first_contact", points: cfg.points_first_contact }))) n++;
  return n;
}

const isTaskTable = (table: string) => {
  const def = tableDef(table);
  return !!def && def.extends === "task" && def.fields.some((f) => f.name === "assigned_to") && !table.startsWith("slm_");
};

async function onEvent(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!e.org_id || !actsHere(jctx.cfg) || e.via === "sync") return;
  const resolved = e.kind === "record.state_changed" && e.to_category === "resolved" && isTaskTable(e.table);
  const published = e.table === "kb_article" && e.kind === "record.state_changed" && e.to === "published";
  const surveyed = e.table === "survey_response" && e.kind === "record.created";
  if (!resolved && !published && !surveyed) return; // most events earn nothing: no context needed
  const sys = await systemCtx(jctx.cfg, e.org_id);
  if (resolved) {
    const rec = await liveRow(jctx.db, sys, e.table, e.id);
    if (rec) await sys.write((tx) => awardResolution(tx, sys, e.table, rec));
    return;
  }
  if (published) {
    const art = await liveRow(jctx.db, sys, "kb_article", e.id);
    const author = art?.author_id ?? art?.created_by;
    if (art && isUuid(author)) {
      const cfg = await workforceConfig(jctx.db, sys);
      await sys.write((tx) => awardIn(tx, sys, { user_id: String(author), reason: "knowledge", points: cfg.points_knowledge, record_id: String(art.id), table_key: "kb_article", record_number: art.number ?? null }));
    }
    return;
  }
  if (surveyed) {
    const r = await liveRow(jctx.db, sys, "survey_response", e.id);
    if (!r || Number(r.csat ?? 0) < 4 || !r.table_key || !isUuid(r.record_id) || !tableDef(String(r.table_key))) return;
    const rec = await liveRow(jctx.db, sys, String(r.table_key), r.record_id);
    if (!rec || !isUuid(rec.assigned_to)) return;
    const cfg = await workforceConfig(jctx.db, sys);
    await sys.write((tx) => awardIn(tx, sys, { user_id: String(rec.assigned_to), reason: "csat", points: cfg.points_csat, record_id: String(rec.id), table_key: String(r.table_key), record_number: rec.number ?? null }));
  }
}

let installed = false;
export function installGamification(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return [onRecordEvent("workforce.points", onEvent, { kinds: ["record.state_changed", "record.created"] })];
}

// ---------------------------------------------------------------------------------------------------------------
// Views

export interface PointsSummary {
  month: number;
  total: number;
  level: ReturnType<typeof levelOf>;
  badges: { key: string; label: string }[];
  recent: { reason: string; points: number; record_number: string | null; at: string | null }[];
}

export async function pointsOf(q: Queryable, ctx: Ctx, userId: string): Promise<PointsSummary> {
  const sys = sysOf(ctx);
  const month = periodOf(todayOf(sys), "month").key;
  const rows = await liveRows(q, sys, "wfm_points", { f: "user_id", op: "eq", v: userId }, { order: "t.at desc nulls last", limit: 5000 });
  const total = rows.reduce((a, r) => a + Number(r.points ?? 0), 0);
  const mrows = rows.filter((r) => r.period === month);
  const count = (reason: string) => mrows.filter((r) => r.reason === reason).length;
  const resolved = count("resolved");
  return {
    month: mrows.reduce((a, r) => a + Number(r.points ?? 0), 0),
    total,
    level: levelOf(total),
    badges: badgesOf({ resolved_month: resolved, within_sla_pct: resolved ? Math.round((count("within_sla") / resolved) * 100) : null, first_contact: count("first_contact"), knowledge: count("knowledge"), kudos: count("kudos"), csat_pct: null }),
    recent: rows.slice(0, 8).map((r) => ({ reason: String(r.reason), points: Number(r.points ?? 0), record_number: r.record_number ?? null, at: r.at ?? null })),
  };
}

export interface Leaderboard {
  enabled: boolean;
  period: string;
  teams: { group_id: string; name: string; points: number; members: number }[];
  people: { user_id: string; name: string; points: number; me: boolean }[];
}

/** The leaderboard of a period: team totals of the caller's groups, and the people who opted in. */
export async function leaderboard(ctx: Ctx, opts: { group?: string | null } = {}): Promise<Leaderboard> {
  const sys = sysOf(ctx);
  const cfg = await workforceConfig(ctx.db, sys);
  const period = periodOf(todayOf(sys), "month");
  if (!cfg.leaderboard_enabled) return { enabled: false, period: period.label, teams: [], people: [] };
  const mine = await myGroups(ctx.db, ctx);
  if (opts.group && !mine.includes(opts.group) && !(await overseesGroup(ctx.db, ctx, opts.group))) throw forbidden("این تیم در دسترس شما نیست");
  const groups = opts.group ? [opts.group] : mine;
  const members = await membersOf(ctx.db, sys, groups);
  const everyone = [...new Set([...members.values()].flat())];
  const pts = everyone.length ? await liveRows(ctx.db, sys, "wfm_points", { and: [{ f: "user_id", op: "in", v: everyone }, { f: "period", op: "eq", v: period.key }] }, { limit: 50_000 }) : [];
  const per = new Map<string, number>();
  for (const p of pts) per.set(String(p.user_id), (per.get(String(p.user_id)) ?? 0) + Number(p.points ?? 0));
  const groupRows = groups.length ? await liveRows(ctx.db, sys, "group", { f: "id", op: "in", v: groups }) : [];
  const teams = groupRows.map((g) => {
    const ms = members.get(String(g.id)) ?? [];
    return { group_id: String(g.id), name: String(g.name ?? ""), points: ms.reduce((a, u) => a + (per.get(u) ?? 0), 0), members: ms.length };
  }).sort((a, b) => b.points - a.points);
  const agents = everyone.length ? await liveRows(ctx.db, sys, "wfm_agent", { and: [{ f: "user_id", op: "in", v: everyone }, { f: "leaderboard", op: "eq", v: true }] }) : [];
  const optedIn = agents.map((a) => String(a.user_id));
  const names = await namesOf(ctx.db, ctx.org.id, optedIn);
  const people = optedIn.map((u) => ({ user_id: u, name: names.get(u) ?? "", points: per.get(u) ?? 0, me: u === ctx.user.id })).sort((a, b) => b.points - a.points).slice(0, 20);
  return { enabled: true, period: period.label, teams, people };
}

/** A kudos from the caller (a record it refers to must be readable by the caller). */
export async function sendKudos(ctx: Ctx, input: { to_id: string; message: string; table?: string | null; id?: string | null }): Promise<Row> {
  let number: string | null = null;
  if (input.table && input.id) {
    const rec = await liveRow(ctx.db, ctx, input.table, input.id);
    if (!rec) throw notFound("رکورد پیدا نشد");
    number = rec.number ?? null;
  }
  const actor = sysOf(ctx, ctx.user.id);
  return actor.write((tx) => createIn(tx, actor, "wfm_kudos", { from_id: ctx.user.id, to_id: input.to_id, message: input.message, table_key: input.table ?? null, record_id: input.id ?? null, record_number: number }, { trusted: true }));
}

export const kudosCount = (q: Queryable, ctx: Ctx, userId: string) => countRows(q, sysOf(ctx), "wfm_kudos", { f: "to_id", op: "eq", v: userId });
