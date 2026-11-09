// The agent home (WFM-027/022, SLM-025/050): one page of everything a person works on, read with their own access —
// their open work across every task table (most urgent first), their teams' unassigned queue, the SLA timers at risk
// with the probability of a breach and why, what they touched recently, their shift today and time off ahead,
// presence, points, level and badges, kudos, certificates about to expire — and the «next best action»: a rule-based
// suggestion today, the place where an AI recommendation plugs in later (`registerNextBestAction`).
import type { AtRiskItem } from "@shared/slm/api";
import { tableDef } from "@shared/tables";
import { addDays, diffDays } from "@shared/jalali";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { list } from "../../engine";
import { atRisk } from "../slm/risk";
import { readsSlm } from "../slm/common";
import { isUuid, liveRows, msOf, myGroups, sysOf, todayOf, type Row } from "./common";
import { workTables } from "./capacity";
import { pointsOf, type PointsSummary } from "./gamification";
import { myAgentRow } from "./presence";
import { shiftNow } from "./schedule";

export interface HomeItem {
  table: string;
  table_label: string;
  id: string;
  number: string | null;
  title: string;
  priority: string | null;
  state: string | null;
  state_label: string | null;
  sla_due: string | null;
  updated_at: string | null;
  stale_days: number | null;
}

export interface NextAction {
  kind: "at_risk" | "unassigned" | "stale" | "none";
  title: string;
  reason: string;
  table: string | null;
  id: string | null;
  source: "rules" | "ai";
}

export interface AgentHome {
  presence: { state: string; since: string | null; note: string | null; leaderboard: boolean; wip_limit: number | null };
  shift: { on: boolean | null; left_minutes: number | null; pattern: string | null; today: { start: string; end: string }[] };
  work: { items: HomeItem[]; total: number; by_table: { table: string; label: string; count: number }[] };
  queue: HomeItem[];
  at_risk: AtRiskItem[];
  recent: { table: string; table_label: string; id: string; number: string | null; title: string; at: string }[];
  next: NextAction;
  points: PointsSummary;
  kudos: { from: string | null; message: string; at: string | null }[];
  absences: { id: string; number: string | null; label: string; state: string; start_at: string | null; end_at: string | null }[];
  certifications: { id: string; name: string; expires_at: string | null; days: number | null }[];
}

type NextActionFn = (ctx: Ctx, home: Omit<AgentHome, "next">) => Promise<NextAction | null>;
let nextActionHook: NextActionFn | null = null;

/** The AI layer's «next best action» (replaces the rule-based one when it answers). */
export function registerNextBestAction(fn: NextActionFn | null): void {
  nextActionHook = fn;
}

const PRIORITY_RANK = (p: unknown) => (p === null || p === undefined || p === "" ? 9 : Number(p) || 9);

function itemOf(table: string, r: Row, today: string): HomeItem {
  const def = tableDef(table)!;
  const state = def.states?.states.find((s) => s.value === r.state);
  const updated = typeof r.updated_at === "string" ? r.updated_at : null;
  return {
    table, table_label: def.label, id: String(r.id), number: r.number ?? null, title: String(r[def.display] ?? r.number ?? ""), priority: r.priority ?? null,
    state: r.state ?? null, state_label: state?.label ?? null, sla_due: r.sla_due ?? null, updated_at: updated, stale_days: updated ? diffDays(today, updated.slice(0, 10)) : null,
  };
}

/** The rule-based next best action: an item at risk, else the oldest urgent unassigned item, else the stalest item. */
export function ruleNextAction(h: Pick<AgentHome, "at_risk" | "queue" | "work">): NextAction {
  const risk = h.at_risk.find((x) => x.level === "critical") ?? h.at_risk.find((x) => x.level === "high");
  if (risk) return { kind: "at_risk", title: `${risk.number ?? ""} ${risk.title ?? ""}`.trim(), reason: `${risk.name}: ${risk.reason}`, table: risk.table, id: risk.record_id, source: "rules" };
  const urgent = [...h.queue].sort((a, b) => PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority) || String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? "")))[0];
  if (urgent && PRIORITY_RANK(urgent.priority) <= 2) return { kind: "unassigned", title: `${urgent.number ?? ""} ${urgent.title}`.trim(), reason: "کار فوری تیم بی‌کارشناس مانده است؛ آن را بردارید", table: urgent.table, id: urgent.id, source: "rules" };
  const stale = h.work.items.filter((i) => (i.stale_days ?? 0) >= 3).sort((a, b) => (b.stale_days ?? 0) - (a.stale_days ?? 0))[0];
  if (stale) return { kind: "stale", title: `${stale.number ?? ""} ${stale.title}`.trim(), reason: `${stale.stale_days} روز است که به‌روز نشده؛ وضعیت را برای درخواست‌کننده بنویسید`, table: stale.table, id: stale.id, source: "rules" };
  if (urgent) return { kind: "unassigned", title: `${urgent.number ?? ""} ${urgent.title}`.trim(), reason: "کاری در صف تیم منتظر کارشناس است", table: urgent.table, id: urgent.id, source: "rules" };
  return { kind: "none", title: "کار فوری‌ای نمانده است", reason: "صف شما و تیم آرام است", table: null, id: null, source: "rules" };
}

export async function agentHome(ctx: Ctx): Promise<AgentHome> {
  const sys = sysOf(ctx);
  const me = ctx.user.id;
  const today = todayOf(ctx);
  const groups = await myGroups(ctx.db, ctx);
  const items: HomeItem[] = [];
  const queue: HomeItem[] = [];
  const byTable: AgentHome["work"]["by_table"] = [];
  for (const def of workTables()) {
    const fields = ["number", def.display, "priority", "state", "sla_due", "updated_at", "assigned_to", "assignment_group_id"].filter((f, i, a) => def.fields.some((x) => x.name === f) && a.indexOf(f) === i);
    try {
      const mine = await list(ctx, def.key, { filter: { and: [{ f: "assigned_to", op: "is_me" }, { f: "active", op: "eq", v: true }] }, fields, sort: "sla_due,-priority", size: 25, total: true });
      if (mine.total) byTable.push({ table: def.key, label: def.plural, count: Number(mine.total) });
      for (const r of mine.rows) items.push(itemOf(def.key, r, today));
      if (groups.length) {
        const q = await list(ctx, def.key, { filter: { and: [{ f: "assigned_to", op: "empty" }, { f: "assignment_group_id", op: "in", v: groups }, { f: "active", op: "eq", v: true }] }, fields, sort: "priority,created_at", size: 10, total: false });
        for (const r of q.rows) queue.push(itemOf(def.key, r, today));
      }
    } catch {
      // a table the person may not read: nothing from it
    }
  }
  items.sort((a, b) => (msOf(a.sla_due) ?? Infinity) - (msOf(b.sla_due) ?? Infinity) || PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority));
  queue.sort((a, b) => PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority));
  const risk = (await readsSlm(ctx)) ? await atRisk(ctx, { scope: "mine", limit: 15 }).catch(() => [] as AtRiskItem[]) : [];
  // what the person touched in the last week (their own history entries), readable records only
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const touched = await ctx.db.query<{ table_key: string; record_id: string; at: string }>(
    `select table_key, record_id::text as record_id, max(at) as at from sm_history where org_id = $1 and actor = $2::uuid and at >= $3::timestamptz group by 1, 2 order by max(at) desc limit 40`,
    [ctx.org.id, me, since],
  ).catch(() => [] as { table_key: string; record_id: string; at: string }[]);
  const recent: AgentHome["recent"] = [];
  const touchedByTable = new Map<string, { id: string; at: string }[]>();
  for (const t of touched) if (tableDef(t.table_key) && !t.table_key.startsWith("wfm_")) touchedByTable.set(t.table_key, [...(touchedByTable.get(t.table_key) ?? []), { id: t.record_id, at: t.at }]);
  for (const [table, xs] of touchedByTable) {
    const def = tableDef(table)!;
    try {
      const rows = (await list(ctx, table, { ids: xs.map((x) => x.id), fields: ["number", def.display].filter((f) => def.fields.some((x) => x.name === f)), size: 40, total: false })).rows;
      for (const r of rows) recent.push({ table, table_label: def.label, id: String(r.id), number: r.number ?? null, title: String(r[def.display] ?? r.number ?? ""), at: String(xs.find((x) => x.id === r.id)?.at ?? "") });
    } catch {
      // unreadable now
    }
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));
  const agent = await myAgentRow(ctx);
  const shift = await shiftNow(ctx.db, sys, me);
  const points = await pointsOf(ctx.db, sys, me);
  const kudosRows = await liveRows(ctx.db, sys, "wfm_kudos", { f: "to_id", op: "eq", v: me }, { order: "t.created_at desc", limit: 3 });
  const senders = kudosRows.map((k) => String(k.from_id)).filter(isUuid);
  const names = senders.length ? await ctx.db.query<{ user_id: string; name: string }>(`select m.user_id, coalesce(nullif(u.full_name, ''), u.email) as name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.user_id = any($2::uuid[])`, [ctx.org.id, pgArray(senders)]).catch(() => []) : [];
  const absences = await liveRows(ctx.db, sys, "wfm_absence", { and: [{ f: "user_id", op: "eq", v: me }, { f: "state", op: "in", v: ["requested", "approved"] }, { f: "end_at", op: "gte", v: new Date().toISOString() }] }, { order: "t.start_at", limit: 5 });
  const certs = await liveRows(ctx.db, sys, "wfm_certification", { and: [{ f: "user_id", op: "eq", v: me }, { f: "expires_at", op: "lte", v: addDays(today, 60) }] }, { order: "t.expires_at", limit: 5 });
  const base: Omit<AgentHome, "next"> = {
    presence: { state: String(agent?.presence ?? "offline"), since: agent?.presence_since ?? null, note: agent?.presence_note ?? null, leaderboard: !!agent?.leaderboard, wip_limit: agent?.wip_limit ?? null },
    shift: { on: shift.on, left_minutes: shift.left, pattern: shift.pattern, today: shift.today.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() })) },
    work: { items: items.slice(0, 40), total: byTable.reduce((a, b) => a + b.count, 0), by_table: byTable },
    queue: queue.slice(0, 15),
    at_risk: risk,
    recent: recent.slice(0, 10),
    points,
    kudos: kudosRows.map((k) => ({ from: names.find((n) => n.user_id === k.from_id)?.name ?? null, message: String(k.message ?? ""), at: k.created_at ?? null })),
    absences: absences.map((a) => ({ id: String(a.id), number: a.number ?? null, label: String(a.label ?? ""), state: String(a.state), start_at: a.start_at ?? null, end_at: a.end_at ?? null })),
    certifications: certs.map((c) => ({ id: String(c.id), name: String(c.name), expires_at: c.expires_at ?? null, days: c.expires_at ? diffDays(String(c.expires_at), today) : null })),
  };
  let next = ruleNextAction(base);
  if (nextActionHook) next = (await nextActionHook(ctx, base).catch(() => null)) ?? next;
  return { ...base, next };
}
