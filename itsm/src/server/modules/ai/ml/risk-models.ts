// The data of the probability models (docs/spec/AI.md §13.3):
//   · SLA breach (every table whose records carry SLAs): a finished SLA becomes one example at a point of its life —
//     a quarter, half or three quarters of its target time, chosen by its id — when it was still running then; the
//     features are the record's (priority, category, group, service, channel), the SLA definition, the share of time
//     elapsed, the record's age, the open work of its group at that moment, when it started (hour, weekday, off hours);
//     the outcome is whether it breached. Open SLAs are scored with the same features now.
//   · change failure (registered when the change table exists): an implemented change is an example — its outcome
//     failed or backed out, or incidents linked as caused by it — with its type, category, declared risk, priority,
//     group, model, the CIs it touches, lead time, window length, night and weekend starts, an untested backout plan,
//     conflicts and CAB; changes not yet implemented are scored.
import { addDays, weekday } from "@shared/jalali";
import { tzOffsetMs } from "@shared/model/jalali-buckets";
import type { TableDef } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { FAILED_CODES, IMPLEMENTED_CODES } from "@shared/tables/change";
import type { Ctx } from "../../../context";
import { orgSchema, orgTz } from "../../../engine";
import type { RiskExample } from "./core/risk";
import { hashSeed } from "./core/rng";
import { readRows, type Row } from "./data";
import { modelField, registerRiskModel, type RiskModelDef, type RiskRow } from "./specs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ms = (v: unknown): number | null => (typeof v === "string" && v ? Date.parse(v) : null);

/** Local hour (0–23) and Iranian weekday (Saturday = 0) of an instant in a time zone. */
export function localTime(t: number, tz: string): { hour: number; weekday: number; date: string } {
  const d = new Date(t + tzOffsetMs(t, tz));
  const date = d.toISOString().slice(0, 10);
  return { hour: d.getUTCHours(), weekday: weekday(date), date };
}

/** Open work of each group at instants: count of records created before and not resolved by then. */
class Backlog {
  private starts = new Map<string, number[]>();
  private ends = new Map<string, number[]>();
  constructor(rows: readonly Row[], group: string) {
    for (const r of rows) {
      const g = String(r[group] ?? "");
      if (!g) continue;
      const s = ms(r.created_at);
      if (s === null) continue;
      (this.starts.get(g) ?? this.starts.set(g, []).get(g)!).push(s);
      const e = ms(r.resolved_at) ?? ms(r.closed_at);
      if (e !== null) (this.ends.get(g) ?? this.ends.set(g, []).get(g)!).push(e);
    }
    for (const l of [...this.starts.values(), ...this.ends.values()]) l.sort((a, b) => a - b);
  }
  private static upto(xs: number[] | undefined, t: number): number {
    if (!xs) return 0;
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  at(group: unknown, t: number): number {
    const g = String(group ?? "");
    if (!g) return 0;
    return Math.max(0, Backlog.upto(this.starts.get(g), t) - Backlog.upto(this.ends.get(g), t));
  }
}

const SLA_CATS = ["priority", "category", "assignment_group_id", "service_id", "channel"];

function startFeatures(t: number, tz: string): Record<string, unknown> {
  const l = localTime(t, tz);
  return { start_hour: l.hour, start_weekday: String(l.weekday), off_hours: l.hour < 8 || l.hour >= 17 || l.weekday === 6 };
}

async function slaParts(sys: Ctx, def: TableDef) {
  const schema = await orgSchema(sys);
  const sla = schema.def("task_sla");
  const cats = SLA_CATS.filter((n) => modelField(def, def.fields.find((f) => f.name === n)));
  const timeCols = ["resolved_at", "closed_at"].filter((n) => def.fields.some((f) => f.name === n));
  return { sla, cats, timeCols, tz: orgTz(sys) };
}

/** Training examples of the SLA breach model of a table. */
export async function slaExamples(sys: Ctx, r: RiskModelDef): Promise<RiskExample[]> {
  const def = (await orgSchema(sys)).def(r.table);
  if (!def) return [];
  const { sla, cats, timeCols, tz } = await slaParts(sys, def);
  if (!sla) return [];
  const since = new Date(Date.now() - 365 * DAY).toISOString();
  const slas = await readRows(sys, sla, ["record_id", "definition_id", "stage", "breached", "start_at", "planned_end_at", "stop_at"], {
    where: { and: [{ f: "table_key", op: "eq", v: def.key }, { f: "stage", op: "in", v: ["achieved", "breached"] }, { f: "start_at", op: "gte", v: since }] },
    limit: 20_000,
  });
  if (!slas.length) return [];
  const group = def.scope.group && def.fields.some((f) => f.name === def.scope.group) ? def.scope.group : null;
  // the records of the period (trainable ones carry features; all of them make the backlog)
  const recs = await readRows(sys, def, [...cats, ...timeCols, ...(group && !cats.includes(group) ? [group] : [])], { sql: `t.created_at >= $1`, params: [new Date(Date.now() - 400 * DAY).toISOString()], limit: 50_000 });
  const trainable = new Set((await readRows(sys, def, [], { training: true, sql: `t.created_at >= $1`, params: [new Date(Date.now() - 400 * DAY).toISOString()], limit: 50_000 })).map((x) => x.id));
  const byId = new Map(recs.map((x) => [x.id, x]));
  const backlog = group ? new Backlog(recs, group) : null;
  const out: RiskExample[] = [];
  for (const s of slas) {
    const rec = byId.get(String(s.record_id));
    if (!rec || !trainable.has(rec.id)) continue;
    const start = ms(s.start_at);
    const due = ms(s.planned_end_at);
    const stop = ms(s.stop_at);
    if (start === null || due === null || stop === null || due <= start) continue;
    const f = [0.25, 0.5, 0.75][hashSeed(s.id) % 3];
    const at = start + f * (due - start);
    if (stop <= at) continue;
    out.push({
      x: {
        ...Object.fromEntries(cats.map((c) => [c, rec[c]])),
        sla: s.definition_id,
        elapsed: f,
        age_hours: Math.max(0, (at - (ms(rec.created_at) ?? at)) / HOUR),
        backlog: backlog && group ? backlog.at(rec[group], at) : 0,
        ...startFeatures(start, tz),
      },
      y: s.breached === true || s.stage === "breached" ? 1 : 0,
      t: stop,
    });
  }
  return out;
}

/** The running SLAs of a table, one row per record (each SLA a part), with their features now. */
export async function slaOpen(sys: Ctx, r: RiskModelDef): Promise<RiskRow[]> {
  const def = (await orgSchema(sys)).def(r.table);
  if (!def) return [];
  const { sla, cats, timeCols, tz } = await slaParts(sys, def);
  if (!sla) return [];
  const slas = await readRows(sys, sla, ["record_id", "definition_id", "name", "stage", "start_at", "planned_end_at", "percent"], {
    where: { and: [{ f: "table_key", op: "eq", v: def.key }, { f: "stage", op: "in", v: ["in_progress", "paused"] }] },
    order: "t.planned_end_at nulls last, t.id",
    limit: 5000,
  });
  if (!slas.length) return [];
  const group = def.scope.group && def.fields.some((f) => f.name === def.scope.group) ? def.scope.group : null;
  const recIds = [...new Set(slas.map((s) => String(s.record_id)))];
  const recs = await readRows(sys, def, [...cats, ...timeCols, ...(group && !cats.includes(group) ? [group] : [])], { ids: recIds, limit: recIds.length });
  const byId = new Map(recs.map((x) => [x.id, x]));
  // open work per group now
  const load = new Map<string, number>();
  if (group) {
    // open = the task's «باز» flag (kept by the engine from the state's category)
    const rows = await sys.db.query<{ g: string; n: number }>(
      `select t.${group}::text as g, count(*)::int as n from ${def.table} t where t.org_id = $1 and t.deleted_at is null and ${def.fields.some((f) => f.name === "active") ? "t.active" : "true"} and t.${group} is not null group by 1`,
      [sys.org.id],
    );
    for (const x of rows) load.set(x.g, Number(x.n));
  }
  const now = Date.now();
  const out = new Map<string, RiskRow>();
  for (const s of slas) {
    const rec = byId.get(String(s.record_id));
    if (!rec) continue;
    const start = ms(s.start_at);
    const due = ms(s.planned_end_at);
    if (start === null) continue;
    const wall = due && due > start ? (now - start) / (due - start) : 0;
    const pct = typeof s.percent === "number" ? s.percent / 100 : Number(s.percent ?? NaN) / 100;
    const elapsed = Math.min(3, Math.max(0, Number.isFinite(pct) ? pct : wall));
    const x: Record<string, unknown> = {
      ...Object.fromEntries(cats.map((c) => [c, rec[c]])),
      sla: s.definition_id,
      elapsed,
      age_hours: Math.max(0, (now - (ms(rec.created_at) ?? now)) / HOUR),
      backlog: group ? (load.get(String(rec[group] ?? "")) ?? 0) : 0,
      ...startFeatures(start, tz),
    };
    const row: RiskRow = out.get(rec.id) ?? { record_id: rec.id, x, parts: [] };
    row.parts!.push({ key: s.id, label: String(s.name ?? "توافق"), x });
    out.set(rec.id, row);
  }
  return [...out.values()];
}

// ----- change failure ------------------------------------------------------------------------------------------

const CHANGE_CATS = ["type", "category", "risk", "priority", "assignment_group_id", "model_id"];

function changeX(c: Row, tz: string): Record<string, unknown> {
  const start = ms(c.planned_start);
  const end = ms(c.planned_end);
  const l = start !== null ? localTime(start, tz) : null;
  return {
    ...Object.fromEntries(CHANGE_CATS.map((k) => [k, c[k]])),
    cis: Array.isArray(c.affected_cis) ? c.affected_cis.length : 0,
    outage_expected: c.outage_expected === true,
    backout_untested: c.backout_tested !== true,
    lead_days: typeof c.lead_days === "number" ? c.lead_days : null,
    window_hours: start !== null && end !== null && end > start ? (end - start) / HOUR : null,
    night: l ? l.hour < 7 || l.hour >= 20 : false,
    weekend: l ? l.weekday >= 5 : false,
    conflicts: typeof c.conflict_count === "number" ? c.conflict_count : 0,
    cab_required: c.cab_required === true,
  };
}

const CHANGE_COLS = [...CHANGE_CATS, "affected_cis", "outage_expected", "backout_tested", "lead_days", "planned_start", "planned_end", "conflict_count", "cab_required", "close_code", "incidents_caused", "closed_at", "state"];

async function changeDef(sys: Ctx): Promise<TableDef | null> {
  return (await orgSchema(sys)).def("change_request") ?? null;
}

const present = (def: TableDef, cols: string[]) => cols.filter((c) => def.fields.some((f) => f.name === c));

export async function changeExamples(sys: Ctx): Promise<RiskExample[]> {
  const def = await changeDef(sys);
  if (!def) return [];
  const tz = orgTz(sys);
  const rows = await readRows(sys, def, present(def, CHANGE_COLS), {
    where: { f: "close_code", op: "in", v: IMPLEMENTED_CODES },
    training: true,
    sql: `t.created_at >= $1`,
    params: [addDays(new Date().toISOString().slice(0, 10), -730)],
    limit: 20_000,
  });
  return rows.map((c) => ({
    x: changeX(c, tz),
    y: (FAILED_CODES.includes(String(c.close_code)) || Number(c.incidents_caused ?? 0) > 0 ? 1 : 0) as 0 | 1,
    t: ms(c.closed_at) ?? ms(c.created_at) ?? 0,
  }));
}

export async function changeOpen(sys: Ctx): Promise<RiskRow[]> {
  const def = await changeDef(sys);
  if (!def?.states) return [];
  const tz = orgTz(sys);
  // changes before their implementation: not closed, not cancelled, no outcome yet
  const rows = await readRows(sys, def, present(def, CHANGE_COLS), { where: { and: [{ f: "close_code", op: "empty" }, { f: "active", op: "eq", v: true }] }, limit: 5000 });
  return rows.map((c) => ({ record_id: c.id, x: changeX(c, tz) }));
}

export const CHANGE_FAILURE: RiskModelDef = {
  key: "risk:change_failure",
  name: "احتمال شکست تغییر",
  table: "change_request",
  outcome: "شکست، برگشت یا رخداد ناشی از تغییر",
  alert: 0.4,
  when: (schema) => {
    const d = schema.def("change_request");
    return !!d && d.fields.some((f) => f.name === "close_code");
  },
  features: [
    ...CHANGE_CATS.map((name) => ({ name, kind: "cat" as const })),
    { name: "cis", kind: "num" },
    { name: "outage_expected", kind: "bool" },
    { name: "backout_untested", kind: "bool" },
    { name: "lead_days", kind: "num" },
    { name: "window_hours", kind: "num" },
    { name: "night", kind: "bool" },
    { name: "weekend", kind: "bool" },
    { name: "conflicts", kind: "num" },
    { name: "cab_required", kind: "bool" },
  ],
  labels: {
    type: "نوع تغییر",
    category: "دسته",
    risk: "ریسک اعلام‌شده",
    priority: "اولویت",
    assignment_group_id: "گروه مجری",
    model_id: "مدل تغییر",
    cis: "شمار پیکربندی‌های متأثر",
    outage_expected: "قطعی پیش‌بینی‌شده",
    backout_untested: "برنامهٔ بازگشت آزموده نشده",
    lead_days: "روزهای کاری تا شروع",
    window_hours: "طول پنجرهٔ اجرا (ساعت)",
    night: "اجرا در شب",
    weekend: "اجرا در پایان هفته",
    conflicts: "تداخل‌های باز",
    cab_required: "نیاز به CAB",
  },
  examples: (sys) => changeExamples(sys),
  open: (sys) => changeOpen(sys),
};

/** The data functions of a risk model: SLA models by their key, registered models by their own. */
export function riskData(r: RiskModelDef): { examples: (sys: Ctx) => Promise<RiskExample[]>; open: (sys: Ctx) => Promise<RiskRow[]> } {
  if (r.key.startsWith("risk:sla:")) return { examples: (sys) => slaExamples(sys, r), open: (sys) => slaOpen(sys, r) };
  return { examples: (sys) => (r.examples ? r.examples(sys, r) : Promise.resolve([])), open: (sys) => (r.open ? r.open(sys, r) : Promise.resolve([])) };
}

let installed = false;

/** Register the built-in risk models that belong to modules (the change failure model while the table exists). */
export function installRiskModels(): void {
  if (installed) return;
  installed = true;
  if (tableDef("change_request")) registerRiskModel(CHANGE_FAILURE);
}
