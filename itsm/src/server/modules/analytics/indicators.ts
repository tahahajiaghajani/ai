// Performance indicators (catalogue ANA-001/003/004/005/012/046): a formula over aggregates of engine tables, scored
// per Jalali period. Live values — the scorecard, a dashboard tile, the KPI hub — are computed with the VIEWER's
// access (the same report engine), so an agent sees their group's MTTR and a manager the organisation's. Stored
// snapshots are collected daily by the system for the whole organisation (incrementally: the current and the previous
// period, plus a backfill the first time a formula version is collected) with up to three breakdowns, and are
// readable only by the people, groups and role holders the indicator's `score_shares` names (copied onto each score).
// A score crossing into red notifies the indicator's owner and alert list — those of them who may read the score.
import type { Cond } from "@shared/model/conditions";
import type { DateUnit } from "@shared/model/jalali-buckets";
import { addDays } from "@shared/jalali";
import { evalFormula, parseFormula, type FormulaNode } from "@shared/analytics/formula";
import { bucketable, deltaPct, formatValue, hasPeriod, kpiStatus, partFilter, periodInstants, periodOf, periodsBack, STATUS_LABELS } from "@shared/analytics/kpi";
import { MEASURES } from "@shared/analytics/model";
import type { IndicatorDef, IndicatorPart, IndicatorValue, KpiStatus, PeriodInfo, ReportSpec, ScorecardItem, ScorePoint } from "@shared/analytics/types";
import type { Breakdown } from "@shared/analytics/api";
import type { Ctx } from "../../context";
import { forbidden, notFound } from "../../http/errors";
import { condEnv, createIn, list, orgTz, removeIn, updateIn } from "../../engine";
import { readersOf } from "../../access";
import { notifyPeople } from "../notify";
import { liveRow, liveRows, num, sysOf, type Row } from "./common";
import { isRestricted, runReport } from "./query";
import { personalBreakdowns, personalReaders } from "./sharing";

/** An indicator row as the definition the evaluator needs. */
export function indicatorOf(row: Row): IndicatorDef & { id: string; formula_version: number; certified: boolean } {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    practice: row.practice ?? "other",
    unit: row.unit ?? "count",
    direction: row.direction ?? "up",
    formula: row.formula,
    parts: Array.isArray(row.parts) ? row.parts : [],
    grain: (row.grain ?? "month") as DateUnit,
    target: num(row.target),
    warn: num(row.warn),
    crit: num(row.crit),
    breakdowns: Array.isArray(row.breakdowns) ? row.breakdowns : [],
    decimals: num(row.decimals),
    formula_version: Number(row.formula_version ?? 1),
    certified: !!row.certified,
  };
}

const additive = (p: IndicatorPart) => MEASURES[p.fn]?.additive && !p.from;

/** A text column that may be empty: the engine stores "" as null, so the organisation-wide row is the empty one. */
const textIs = (f: string, v: string): Cond => (v ? { f, op: "eq", v } : { f, op: "empty" });

function partSpec(p: IndicatorPart, filter: Cond | null, extra: Partial<ReportSpec> = {}): ReportSpec {
  return { v: 1, table: p.table, filter, measures: [{ fn: p.fn, field: p.field ?? null, from: p.from ?? null }], dims: [], viz: "score", ...extra };
}

/** The formula of an indicator, parsed once. */
const formulas = new Map<string, FormulaNode>();
function formulaOf(src: string): FormulaNode | null {
  let f = formulas.get(src);
  if (!f) {
    try {
      f = parseFormula(src);
    } catch {
      return null;
    }
    formulas.set(src, f);
  }
  return f;
}

const compute = (ind: IndicatorDef, parts: Record<string, number | null>) => {
  const f = formulaOf(ind.formula);
  return f ? evalFormula(f, parts) : null;
};

export type { Breakdown };

/** The value of an indicator for one period as `ctx` (optionally broken down by a field: top `limit` elements). */
export async function evaluatePeriod(ctx: Ctx, ind: IndicatorDef, period: PeriodInfo, opts: { tz: string; now?: number; breakdown?: string; limit?: number } = { tz: "Asia/Tehran" }): Promise<{ total: IndicatorValue; breakdown: Breakdown | null }> {
  const bounds = periodInstants(period, opts.tz);
  const parts: Record<string, number | null> = {};
  let n = 0;
  const perElement = new Map<string, { label: string; parts: Record<string, number | null>; n: number }>();
  let label = opts.breakdown ?? "";
  for (const [i, p] of ind.parts.entries()) {
    const filter = partFilter(p, bounds);
    if (!opts.breakdown) {
      const r = await runReport(ctx, partSpec(p, filter), { noCompare: true, now: opts.now, k: 0 });
      parts[p.name] = r.totals.m0 ?? (additive(p) ? 0 : null);
      if (i === 0) n = r.total_n;
      continue;
    }
    const r = await runReport(ctx, partSpec(p, filter, { dims: [{ field: opts.breakdown }], viz: "table", limit: i === 0 ? (opts.limit ?? 10) : 500, sort: { by: "value", dir: "desc" } }), { noCompare: true, now: opts.now });
    label = r.dims[0]?.label ?? label;
    parts[p.name] = r.totals.m0 ?? (additive(p) ? 0 : null);
    if (i === 0) n = r.total_n;
    for (const row of r.rows) {
      if (row.suppressed) continue;
      const key = String(row.keys[0] ?? "");
      if (i > 0 && !perElement.has(key)) continue; // elements come from the first part's top N
      const e = perElement.get(key) ?? { label: row.labels[0] ?? key, parts: {}, n: 0 };
      e.parts[p.name] = row.values.m0 ?? (additive(p) ? 0 : null);
      if (i === 0) e.n = row.n;
      perElement.set(key, e);
    }
  }
  const total: IndicatorValue = { value: compute(ind, parts), parts, n };
  if (!opts.breakdown) return { total, breakdown: null };
  const elements = [...perElement.entries()].map(([key, e]) => {
    for (const p of ind.parts) if (!(p.name in e.parts)) e.parts[p.name] = additive(p) ? 0 : null;
    return { key, label: e.label, value: compute(ind, e.parts), parts: e.parts, n: e.n };
  });
  return { total, breakdown: { field: opts.breakdown, label, elements } };
}

/** Live values of the last `n` periods in one query per part (parts whose period is a date field). */
async function liveTrend(ctx: Ctx, ind: IndicatorDef, periods: PeriodInfo[], now: number): Promise<ScorePoint[]> {
  const byPart: Record<string, Map<string, number | null>> = {};
  for (const p of ind.parts) {
    const spec = partSpec(p, p.filter ?? null, {
      time: { field: p.date_field!, from: periods[0].start, to: addDays(periods[periods.length - 1].end, -1) },
      dims: [{ field: p.date_field!, bucket: ind.grain }],
      viz: "line",
    });
    const r = await runReport(ctx, spec, { noCompare: true, now, k: 0 });
    byPart[p.name] = new Map(r.rows.map((row) => [String(row.keys[0]), row.values.m0 ?? null]));
  }
  return periods.map((per) => {
    const parts = Object.fromEntries(ind.parts.map((p) => [p.name, byPart[p.name].get(per.key) ?? (additive(p) ? 0 : null)]));
    return { key: per.key, label: per.label, value: compute(ind, parts) };
  });
}

/** Stored total scores the caller may read (newest last), or null when they may read none. */
async function storedSeries(ctx: Ctx, ind: { id: string; formula_version: number }, limit = 24, breakdown = ""): Promise<{ points: ScorePoint[]; rows: Row[] } | null> {
  const rows = await liveRows(ctx.db, ctx, "analytics_score", { and: [{ f: "indicator_id", op: "eq", v: ind.id }, { f: "formula_version", op: "eq", v: ind.formula_version }, textIs("breakdown", breakdown)] }, { order: "t.period_key desc, t.element", limit: breakdown ? 500 : limit }).catch(() => []);
  if (!rows.length) {
    // readable but not collected yet vs not readable: ask for any one score of the indicator
    return null;
  }
  const out = rows.reverse();
  return { points: breakdown ? [] : out.map((r) => ({ key: r.period_key, label: r.period_label, value: num(r.value) })), rows: out };
}

/** May `ctx` read the stored scores of an indicator? (the indicator's score readers; the system always) */
export function readsScores(ctx: Ctx, row: Row, groups: string[]): boolean {
  if (ctx.actor === "system") return true;
  const me = ctx.user.id;
  return !!row.s_all || (Array.isArray(row.s_users) && row.s_users.includes(me)) || (Array.isArray(row.s_groups) && row.s_groups.some((g: string) => groups.includes(g)));
}

/** One scorecard entry as the viewer may see it. */
export async function scoreItem(ctx: Ctx, row: Row, opts: { now?: number; trend?: number; parts?: boolean } = {}): Promise<ScorecardItem> {
  const ind = indicatorOf(row);
  const tz = orgTz(ctx);
  const now = opts.now ?? Date.now();
  const n = Math.max(2, Math.min(24, opts.trend ?? 12));
  const periods = periodsBack(ind.grain, now, tz, n);
  const current = periods[periods.length - 1];
  const previous = periods[periods.length - 2];
  const base: ScorecardItem = {
    id: ind.id,
    key: ind.key,
    name: ind.name,
    practice: ind.practice,
    unit: ind.unit,
    direction: ind.direction,
    decimals: ind.decimals ?? null,
    target: ind.target ?? null,
    warn: ind.warn ?? null,
    crit: ind.crit ?? null,
    current: { ...current, value: null, parts: {}, n: 0 },
    previous: { ...previous, value: null, parts: {}, n: 0 },
    status: "none",
    delta: null,
    trend: [],
    stored: null,
    restricted: null,
    certified: ind.certified,
  };
  const env = await condEnv(ctx);
  // what the delta compares when the previous period comes from stored (organisation-wide) scores
  let comparable: { current: number | null; previous: number | null } | null = null;
  const stored = readsScores(ctx, row, (env.groups ?? []) as string[]) ? await storedSeries(ctx, ind, n) : null;
  base.stored = stored?.points ?? (readsScores(ctx, row, (env.groups ?? []) as string[]) ? [] : null);
  try {
    if (ind.parts.every(bucketable)) {
      // one query per part gives every period, the current and the previous included
      base.trend = await liveTrend(ctx, ind, periods, now);
      base.current = { ...current, value: base.trend[base.trend.length - 1]?.value ?? null, parts: {}, n: 0 };
      base.previous = { ...previous, value: base.trend[base.trend.length - 2]?.value ?? null, parts: {}, n: 0 };
      if (opts.parts) base.current = { ...current, ...(await evaluatePeriod(ctx, ind, current, { tz, now })).total };
    } else {
      const cur = await evaluatePeriod(ctx, ind, current, { tz, now });
      base.current = { ...current, ...cur.total };
      if (ind.parts.some((p) => hasPeriod(p.filter))) {
        const prev = await evaluatePeriod(ctx, ind, previous, { tz, now });
        base.previous = { ...previous, ...prev.total };
      } else {
        // point-in-time parts: the past only comes from stored snapshots — the organisation's numbers, comparable only
        // with the stored number of the current period, never with the viewer's live value (their own scope)
        const prevStored = stored?.rows.find((r) => r.period_key === previous.key);
        const curStored = stored?.rows.find((r) => r.period_key === current.key);
        base.previous = { ...previous, value: prevStored ? num(prevStored.value) : null, parts: {}, n: 0 };
        comparable = { current: curStored ? num(curStored.value) : null, previous: base.previous.value };
      }
      base.trend = [];
    }
  } catch (e) {
    if (!isRestricted(e)) throw e;
    base.restricted = "این شاخص به جدول یا فیلدی تکیه دارد که در دسترس شما نیست";
    return base;
  }
  base.status = kpiStatus(base.current.value, ind);
  base.delta = comparable ? deltaPct(comparable.current, comparable.previous) : deltaPct(base.current.value, base.previous.value);
  return base;
}

/** The scorecard: active indicators (optionally of a practice or by ids), each with the viewer's numbers. */
export async function scorecard(ctx: Ctx, opts: { ids?: string[]; keys?: string[]; practice?: string; now?: number; trend?: number } = {}): Promise<{ items: ScorecardItem[] }> {
  const conds: Cond[] = [{ f: "active", op: "eq", v: true }];
  if (opts.ids?.length) conds.push({ f: "id", op: "in", v: opts.ids.slice(0, 50) });
  if (opts.keys?.length) conds.push({ f: "key", op: "in", v: opts.keys.slice(0, 50) });
  if (opts.practice) conds.push({ f: "practice", op: "eq", v: opts.practice });
  const rows = await liveRows(ctx.db, ctx, "analytics_indicator", { and: conds }, { order: "t.practice, t.name", limit: 60 });
  const order = opts.ids?.length ? opts.ids : opts.keys;
  if (order?.length) rows.sort((a, b) => order.indexOf(opts.ids?.length ? a.id : a.key) - order.indexOf(opts.ids?.length ? b.id : b.key));
  const items: ScorecardItem[] = [];
  for (const r of rows) items.push(await scoreItem(ctx, r, opts));
  return { items };
}

export interface IndicatorHub {
  item: ScorecardItem;
  definition: IndicatorDef & { id: string; formula_version: number; certified: boolean };
  breakdowns: Breakdown[];
  /** the full stored series (when readable) */
  history: ScorePoint[] | null;
  /** the stored breakdown of the last closed period (when readable) */
  stored_breakdowns: { field: string; period: string; elements: { key: string; label: string; value: number | null }[] }[];
  /** per part: the records behind the current period (as conditions on the part's table, for «نمایش رکوردها») */
  records: { name: string; table: string; filter: Cond | null }[];
  can_collect: boolean;
}

/** «این عدد را توضیح بده»: the indicator's score, trend, breakdowns and the records behind it, as the viewer. */
export async function indicatorHub(ctx: Ctx, id: string, opts: { now?: number; canCollect?: boolean } = {}): Promise<IndicatorHub> {
  const row = await liveRow(ctx.db, ctx, "analytics_indicator", id);
  if (!row) throw notFound("شاخص پیدا نشد");
  const item = await scoreItem(ctx, row, { now: opts.now, trend: 12, parts: true });
  const ind = indicatorOf(row);
  const tz = orgTz(ctx);
  const breakdowns: Breakdown[] = [];
  if (!item.restricted) {
    for (const b of ind.breakdowns ?? []) {
      try {
        const r = await evaluatePeriod(ctx, ind, item.current, { tz, now: opts.now, breakdown: b, limit: 12 });
        if (r.breakdown) breakdowns.push(r.breakdown);
      } catch (e) {
        if (!isRestricted(e)) throw e;
      }
    }
  }
  let history: ScorePoint[] | null = null;
  const stored_breakdowns: IndicatorHub["stored_breakdowns"] = [];
  if (item.stored !== null) {
    history = (await storedSeries(ctx, ind, 60))?.points ?? [];
    const lastFinal = item.previous.key;
    for (const b of ind.breakdowns ?? []) {
      const s = await storedSeries(ctx, ind, 500, b);
      const rows = (s?.rows ?? []).filter((r) => r.period_key === lastFinal);
      if (rows.length) stored_breakdowns.push({ field: b, period: rows[0].period_label, elements: rows.map((r) => ({ key: r.element, label: r.element_label, value: num(r.value) })) });
    }
  }
  const bounds = periodInstants(item.current, tz);
  const records = ind.parts.map((p) => ({ name: p.name, table: p.table, filter: partFilter(p, bounds) }));
  return { item, definition: ind, breakdowns, history, stored_breakdowns, records, can_collect: !!opts.canCollect };
}

// ----- collection (the system, the whole organisation) ------------------------------------------------------------

export interface CollectResult {
  indicators: number;
  scores: number;
  alerts: number;
  skipped: string[];
}

/**
 * Upsert one score row (system). Returns its id and whether its status turned red. The row is looked up inside the
 * write, under a transaction lock on its key: two collectors at once (the daily job and «عکس اکنون») update one row —
 * the unique index cannot bind the organisation-wide total, whose breakdown and element are stored empty (NULL).
 */
async function upsertScore(sys: Ctx, ind: Row, def: IndicatorDef, period: PeriodInfo, final: boolean, breakdown: string, element: { key: string; label: string; value: number | null; parts: Record<string, number | null>; n: number }, ids: string[] | null): Promise<{ id: string; worsened: boolean }> {
  const status: KpiStatus = kpiStatus(element.value, def);
  const key = { indicator_id: ind.id, formula_version: Number(ind.formula_version ?? 1), period_key: period.key, breakdown, element: element.key };
  const lookup = { and: Object.entries(key).map(([f, v]) => (typeof v === "string" ? textIs(f, v) : ({ f, op: "eq", v } as Cond))) };
  const data: Row = {
    ...key,
    indicator_key: ind.key,
    grain: def.grain,
    period_label: period.label,
    period_start: period.start,
    period_end: period.end,
    element_label: element.label.slice(0, 200),
    value: element.value === null ? null : String(Math.round(element.value * 1e6) / 1e6),
    status,
    n: element.n,
    parts: element.parts,
    final,
    collected_at: new Date().toISOString(),
    s_users: ind.s_users ?? [],
    s_groups: ind.s_groups ?? [],
    s_all: !!ind.s_all,
    ...(ids ? { ids } : {}),
  };
  // a breakdown by person: that person's figures, read only by them and their managers
  if (breakdown && personalBreakdowns(ind.parts, ind.breakdowns).includes(breakdown)) Object.assign(data, { s_users: await personalReaders(sys.db, sys.org.id, element.key), s_groups: [], s_all: false });
  return sys.write(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`analytics_score:${sys.org.id}:${key.indicator_id}:${key.formula_version}:${key.period_key}:${breakdown}:${element.key}`]);
    const [found] = await liveRows(tx, sys, "analytics_score", lookup, { limit: 1 });
    if (found) {
      await updateIn(tx, sys, "analytics_score", found.id, data, { trusted: true });
      return { id: found.id as string, worsened: !breakdown && status === "bad" && found.status !== "bad" };
    }
    const row = await createIn(tx, sys, "analytics_score", data, { trusted: true });
    return { id: row.id as string, worsened: !breakdown && status === "bad" };
  });
}

/** Collect one indicator (current and previous period, backfill on a new formula version, breakdowns). */
export async function collectIndicator(sys: Ctx, row: Row, opts: { now?: number; backfill?: number } = {}): Promise<{ scores: number; alerts: number }> {
  const def = indicatorOf(row);
  const tz = orgTz(sys);
  const now = opts.now ?? Date.now();
  const timed = def.parts.some((p) => !!p.date_field || hasPeriod(p.filter));
  const existing = await liveRows(sys.db, sys, "analytics_score", { and: [{ f: "indicator_id", op: "eq", v: row.id }, { f: "formula_version", op: "eq", v: def.formula_version }, textIs("breakdown", "")] }, { limit: 1 });
  const back = timed ? (existing.length ? 1 : Math.max(1, opts.backfill ?? 6)) : 0;
  let scores = 0;
  let alerts = 0;
  for (let shift = -back; shift <= 0; shift++) {
    const period = periodOf(def.grain, now, tz, shift);
    const final = shift < 0;
    const { total } = await evaluatePeriod(sys, def, period, { tz, now });
    const ids = final || shift === 0 ? await contributing(sys, def, period, tz) : null;
    const up = await upsertScore(sys, row, def, period, final, "", { key: "", label: "کل سازمان", ...total }, ids);
    scores++;
    if (shift === 0 && up.worsened) alerts += await alert(sys, row, def, up.id, total.value, period);
    if (shift < -1) continue; // breakdowns for the current and the previous period only
    for (const b of (def.breakdowns ?? []).slice(0, 3)) {
      const r = await evaluatePeriod(sys, def, period, { tz, now, breakdown: b, limit: 10 });
      for (const e of r.breakdown?.elements ?? []) {
        await upsertScore(sys, row, def, period, final, b, e, null);
        scores++;
      }
    }
  }
  await sys.write((tx) => updateIn(tx, sys, "analytics_indicator", row.id, { collected_at: new Date(now).toISOString() }, { trusted: true, keepVersion: true }));
  return { scores, alerts };
}

/** Ids of the records behind the first part of a period (at most 500), for «which records made this number». */
async function contributing(sys: Ctx, def: IndicatorDef, period: PeriodInfo, tz: string): Promise<string[] | null> {
  const p = def.parts[0];
  if (!p || (p.fn !== "count" && p.fn !== "ratio")) return null;
  const filter = partFilter(p, periodInstants(period, tz));
  const r = await list(sys, p.table, { filter, size: 500, fields: ["created_at"], total: false }).catch(() => null);
  return r ? r.rows.map((x) => String(x.id)) : null;
}

/** A score that turned red: tell the owner and the alert list (only those who may read the score). */
async function alert(sys: Ctx, row: Row, def: IndicatorDef, scoreId: string, value: number | null, period: PeriodInfo): Promise<number> {
  const users = [...new Set([row.owner_id, ...(Array.isArray(row.alert_users) ? row.alert_users : [])].filter((u): u is string => typeof u === "string" && !!u))];
  if (!users.length) return 0;
  const readers = await readersOf(sys.cfg, sys.org.id, "analytics_score", scoreId, users);
  if (!readers.length) return 0;
  await sys.write((tx) =>
    notifyPeople(tx, sys.org.id, {
      table: "analytics_score",
      id: scoreId,
      users: readers,
      label: "عبور شاخص از آستانه",
      subject: `شاخص «${def.name}» ${STATUS_LABELS.bad} است`,
      body: `مقدار «${def.name}» در ${period.label}: **${formatValue(value, def.unit, def.decimals)}**${def.crit !== null && def.crit !== undefined ? ` (آستانهٔ بحران: ${formatValue(def.crit, def.unit, def.decimals)})` : ""}.`,
      channels: ["in_app", "email"],
      source: "شاخص‌ها",
    }),
  );
  return readers.length;
}

/** Collect every active indicator with daily snapshots (the daily sweep). */
export async function collectAll(sys: Ctx, opts: { now?: number; backfill?: number; deadline?: number } = {}): Promise<CollectResult> {
  const rows = await liveRows(sys.db, sys, "analytics_indicator", { and: [{ f: "active", op: "eq", v: true }, { f: "collect", op: "eq", v: true }] }, { order: "t.collected_at nulls first, t.id", limit: 200 });
  const out: CollectResult = { indicators: 0, scores: 0, alerts: 0, skipped: [] };
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      const x = await collectIndicator(sys, r, opts);
      out.indicators++;
      out.scores += x.scores;
      out.alerts += x.alerts;
    } catch (e) {
      // a broken definition (a table removed, a field renamed) must not stop the others
      out.skipped.push(`${r.key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/** Remove stored scores older than the retention (system; a batch per run). */
export async function pruneScores(sys: Ctx, keepDays: number, now = Date.now()): Promise<number> {
  const before = new Date(now - keepDays * 86_400_000).toISOString().slice(0, 10);
  const old = await liveRows(sys.db, sys, "analytics_score", { f: "period_end", op: "lt", v: before }, { limit: 500 });
  if (!old.length) return 0;
  await sys.write(async (tx) => {
    for (const r of old) await removeIn(tx, sys, "analytics_score", r.id);
  });
  return old.length;
}

/** Collect one indicator now (reports administrators). */
export async function collectNow(ctx: Ctx, id: string, canAdmin: boolean): Promise<{ scores: number; alerts: number }> {
  if (!canAdmin) throw forbidden("عکس‌برداری دستی با مدیر گزارش‌هاست");
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, "analytics_indicator", id);
  if (!row) throw notFound("شاخص پیدا نشد");
  return collectIndicator(sys, row);
}
