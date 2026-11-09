// Pure logic of project management, shared by the server and the screens (no I/O):
//   · working-day arithmetic on ISO dates (weekend days and holidays given; the Iranian default: Friday off)
//   · critical-path scheduling (PRJ-019): finish-to-start dependencies with lag, «start no earlier than», phases
//     scheduled from their children, a forward and a backward pass in working days, float and the critical path,
//     cycles reported with their tasks
//   · WBS numbers, %-complete roll-ups, project health and schedule status (PRJ-031), demand scores (PRJ-003: WSJF,
//     RICE, weighted), the resource heat map (PRJ-038)
export type Row = Record<string, any>;

const DAY = 86_400_000;

export interface WorkCalendar {
  /** UTC weekdays that are not worked (0 = Sunday … 5 = Friday, 6 = Saturday); default [5] */
  weekend?: number[];
  /** ISO dates that are not worked (official holidays) */
  holidays?: ReadonlySet<string> | string[];
}

const toMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function addDaysIso(d: string, n: number): string {
  return toIso(toMs(d) + n * DAY);
}

function calOf(cal: WorkCalendar = {}): { weekend: Set<number>; holidays: ReadonlySet<string> } {
  const h = cal.holidays;
  return { weekend: new Set(cal.weekend ?? [5]), holidays: h instanceof Set ? h : new Set(Array.isArray(h) ? h : []) };
}

export function isWorkday(d: string, cal: WorkCalendar = {}): boolean {
  const c = calOf(cal);
  return !c.weekend.has(new Date(toMs(d)).getUTCDay()) && !c.holidays.has(d.slice(0, 10));
}

/** The first working day on or after `d`. */
export function rollForward(d: string, cal: WorkCalendar = {}): string {
  let x = d.slice(0, 10);
  for (let i = 0; i < 400 && !isWorkday(x, cal); i++) x = addDaysIso(x, 1);
  return x;
}

/** `n` working days after the working day on or after `d` (n ≥ 0; n = 0 is that day). */
export function addWorkdays(d: string, n: number, cal: WorkCalendar = {}): string {
  let x = rollForward(d, cal);
  for (let k = 0, guard = 0; k < n && guard < 20_000; guard++) {
    x = addDaysIso(x, 1);
    if (isWorkday(x, cal)) k++;
  }
  return x;
}

/** Working days in [a, b] (0 when b is before a). */
export function workdaysBetween(a: string, b: string, cal: WorkCalendar = {}): number {
  if (b < a) return 0;
  let n = 0;
  for (let x = a.slice(0, 10), guard = 0; x <= b && guard < 20_000; x = addDaysIso(x, 1), guard++) if (isWorkday(x, cal)) n++;
  return n;
}

/** Calendar days from a to b (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY);
}

// ---------------------------------------------------------------------------------------------------------------
// Scheduling

export interface SchedTask {
  id: string;
  parent_id?: string | null;
  kind?: string | null;
  /** working days (milestones 0; empty: 1 for tasks) */
  duration?: number | null;
  depends_on?: string[] | null;
  lag?: number | null;
  not_before?: string | null;
  sort_order?: number | null;
  /** current dates, kept for tasks without a duration */
  start?: string | null;
  end?: string | null;
}

export interface SchedOut {
  start: string;
  end: string;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  float: number;
  critical: boolean;
  summary: boolean;
}

export interface ScheduleResult {
  ok: boolean;
  /** tasks in a dependency cycle (nothing scheduled) */
  cycle: string[];
  tasks: Map<string, SchedOut>;
  start: string;
  end: string;
  /** leaf tasks on the critical path, in order */
  critical: string[];
}

/** Ids of the descendants of every task (its subtree, itself excluded). */
function childrenOf(tasks: readonly SchedTask[]): Map<string, string[]> {
  const ids = new Set(tasks.map((t) => t.id));
  const m = new Map<string, string[]>();
  for (const t of tasks) if (t.parent_id && ids.has(t.parent_id) && t.parent_id !== t.id) m.set(t.parent_id, [...(m.get(t.parent_id) ?? []), t.id]);
  return m;
}

/** Critical-path schedule of a project's tasks from `start` (PRJ-019). */
export function schedule(tasks: readonly SchedTask[], opts: { start: string; cal?: WorkCalendar }): ScheduleResult {
  const cal = opts.cal ?? {};
  const start = rollForward(opts.start, cal);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = childrenOf(tasks);
  const summary = (id: string) => (kids.get(id)?.length ?? 0) > 0 || byId.get(id)?.kind === "phase";
  const leavesUnder = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const ks = kids.get(id) ?? [];
    if (!ks.length) return summary(id) ? [] : [id];
    return ks.flatMap((k) => leavesUnder(k, seen));
  };
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    let p = byId.get(id)?.parent_id ?? null;
    for (let g = 0; p && byId.has(p) && g < 50; g++) {
      out.push(p);
      p = byId.get(p)?.parent_id ?? null;
    }
    return out;
  };
  const leaves = tasks.filter((t) => !summary(t.id)).map((t) => t.id);
  // predecessors of a leaf: its own and its ancestors' dependencies, a summary dependency meaning all its leaves
  const preds = new Map<string, { id: string; lag: number }[]>();
  for (const id of leaves) {
    const list: { id: string; lag: number }[] = [];
    for (const owner of [id, ...ancestors(id)]) {
      const o = byId.get(owner)!;
      for (const d of o.depends_on ?? []) {
        if (!byId.has(d) || d === owner) continue;
        for (const leaf of summary(d) ? leavesUnder(d) : [d]) if (leaf !== id) list.push({ id: leaf, lag: Number(o.lag ?? 0) || 0 });
      }
    }
    preds.set(id, list);
  }
  // Kahn's order over the leaves
  const indeg = new Map(leaves.map((id) => [id, 0]));
  const succ = new Map<string, { id: string; lag: number }[]>();
  for (const [id, ps] of preds) for (const p of ps) {
    indeg.set(id, (indeg.get(id) ?? 0) + 1);
    succ.set(p.id, [...(succ.get(p.id) ?? []), { id, lag: p.lag }]);
  }
  const order: string[] = [];
  const queue = leaves.filter((id) => indeg.get(id) === 0).sort((a, b) => Number(byId.get(a)!.sort_order ?? 0) - Number(byId.get(b)!.sort_order ?? 0));
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succ.get(id) ?? []) {
      indeg.set(s.id, indeg.get(s.id)! - 1);
      if (indeg.get(s.id) === 0) queue.push(s.id);
    }
  }
  if (order.length < leaves.length) {
    const cycle = leaves.filter((id) => !order.includes(id));
    return { ok: false, cycle, tasks: new Map(), start, end: start, critical: [] };
  }
  const dur = (id: string) => {
    const t = byId.get(id)!;
    if (t.kind === "milestone") return 0;
    const d = Number(t.duration);
    if (Number.isFinite(d) && d >= 0) return Math.round(d);
    if (t.start && t.end) return Math.max(1, workdaysBetween(t.start, t.end, cal));
    return 1;
  };
  const idx = (d: string) => (d <= start ? 0 : workdaysBetween(start, d, cal) - (isWorkday(d, cal) ? 1 : 0));
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const t = byId.get(id)!;
    let s = 0;
    const nb = [t.not_before, ...ancestors(id).map((a) => byId.get(a)!.not_before)].filter((x): x is string => !!x);
    for (const d of nb) s = Math.max(s, idx(rollForward(d, cal)));
    // time points in working days: a task occupies [es, ef); a successor starts at the predecessor's ef + lag
    for (const p of preds.get(id) ?? []) s = Math.max(s, ef.get(p.id)! + p.lag);
    s = Math.max(0, s);
    es.set(id, s);
    ef.set(id, s + dur(id));
  }
  const endIdx = Math.max(0, ...order.map((id) => ef.get(id)!));
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    let f = endIdx;
    for (const s of succ.get(id) ?? []) f = Math.min(f, ls.get(s.id)! - s.lag);
    lf.set(id, f);
    ls.set(id, f - dur(id));
  }
  const dateOf = (i: number) => addWorkdays(start, Math.max(0, i), cal);
  /** the last working day a task occupies (a milestone: its day) */
  const lastDay = (s: number, e: number) => Math.max(s, e - 1);
  const out = new Map<string, SchedOut>();
  for (const id of order) {
    const s = es.get(id)!;
    const float = ls.get(id)! - s;
    // a milestone sits on the day its predecessors finish (or on its own start day)
    const day = dur(id) === 0 && s > 0 && (preds.get(id)?.length ?? 0) > 0 ? s - 1 : s;
    out.set(id, { start: dateOf(day), end: dateOf(dur(id) === 0 ? day : lastDay(s, ef.get(id)!)), es: s, ef: ef.get(id)!, ls: ls.get(id)!, lf: lf.get(id)!, float, critical: float <= 0, summary: false });
  }
  // summaries span their children (bottom-up)
  const span = (id: string, seen = new Set<string>()): SchedOut | null => {
    if (out.has(id)) return out.get(id)!;
    if (seen.has(id)) return null;
    seen.add(id);
    const parts = (kids.get(id) ?? []).map((k) => span(k, seen)).filter((x): x is SchedOut => !!x);
    if (!parts.length) return null;
    const s = Math.min(...parts.map((p) => p.es));
    const e = Math.max(...parts.map((p) => p.ef));
    const float = Math.min(...parts.map((p) => p.float));
    const r: SchedOut = { start: dateOf(s), end: dateOf(lastDay(s, e)), es: s, ef: e, ls: s + float, lf: e + float, float, critical: parts.some((p) => p.critical), summary: true };
    out.set(id, r);
    return r;
  };
  for (const t of tasks) if (summary(t.id)) span(t.id);
  const critical = order.filter((id) => out.get(id)!.critical);
  return { ok: true, cycle: [], tasks: out, start, end: dateOf(Math.max(0, endIdx - 1)), critical };
}

/** Does adding `from` → depends on `to` create a cycle? (an edit's check before saving) */
export function wouldCycle(tasks: readonly SchedTask[], id: string, dependsOn: readonly string[]): boolean {
  const next = tasks.map((t) => (t.id === id ? { ...t, depends_on: [...dependsOn] } : t));
  if (!next.some((t) => t.id === id)) next.push({ id, depends_on: [...dependsOn] });
  return !schedule(next, { start: "2000-01-01" }).ok;
}

/** WBS numbers (1, 1.2, 1.2.3) from the parent tree and the sort order. */
export function wbsNumbers(tasks: readonly { id: string; parent_id?: string | null; sort_order?: number | null; number?: string | null }[]): Map<string, string> {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string | null, typeof tasks[number][]>();
  for (const t of tasks) {
    const p = t.parent_id && ids.has(t.parent_id) && t.parent_id !== t.id ? t.parent_id : null;
    kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  const out = new Map<string, string>();
  const walk = (parent: string | null, prefix: string, depth: number) => {
    if (depth > 20) return;
    const list = [...(kids.get(parent) ?? [])].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || String(a.number ?? a.id).localeCompare(String(b.number ?? b.id)));
    list.forEach((t, i) => {
      if (out.has(t.id)) return;
      const n = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      out.set(t.id, n);
      walk(t.id, n, depth + 1);
    });
  };
  walk(null, "", 0);
  return out;
}

/** %-complete of a set of leaf tasks, weighted by duration (done = 100, canceled left out). */
export function rollupPct(tasks: readonly { state?: string | null; pct_complete?: unknown; duration_days?: unknown; kind?: string | null }[]): number {
  let w = 0;
  let sum = 0;
  for (const t of tasks) {
    if (t.state === "canceled" || t.kind === "phase") continue;
    const weight = Math.max(1, Number(t.duration_days) || (t.kind === "milestone" ? 0 : 1)) || 1;
    const p = t.state === "done" ? 100 : Math.min(100, Math.max(0, Number(t.pct_complete) || 0));
    w += weight;
    sum += weight * p;
  }
  return w ? Math.round(sum / w) : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Health

export interface HealthInput {
  state: string;
  today: string;
  planned_start?: string | null;
  planned_end?: string | null;
  projected_end?: string | null;
  pct: number;
  tasks_overdue: number;
  milestones_overdue: number;
  open_risks: number;
  last_status_at?: string | null;
  budget?: unknown;
  actual_cost?: unknown;
}

export interface HealthReason {
  key: string;
  level: "amber" | "red";
  label: string;
}

export interface HealthResult {
  health: "green" | "amber" | "red" | "unknown";
  reasons: HealthReason[];
  schedule_status: "not_started" | "on_track" | "ahead" | "delayed";
  variance_days: number | null;
}

const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** Deterministic RAG health of a project (PRJ-031). */
export function projectHealth(i: HealthInput, cfg: { amber_variance_days: number; red_variance_days: number; status_report_days: number }): HealthResult {
  const reasons: HealthReason[] = [];
  const running = ["planning", "executing", "closing"].includes(i.state);
  const variance = i.planned_end && i.projected_end ? daysBetween(i.planned_end, i.projected_end) : null;
  if (variance !== null && variance >= cfg.red_variance_days) reasons.push({ key: "variance", level: "red", label: `پایان پیش‌بینی‌شده ${fa(variance)} روز دیرتر از برنامه است` });
  else if (variance !== null && variance >= cfg.amber_variance_days) reasons.push({ key: "variance", level: "amber", label: `پایان پیش‌بینی‌شده ${fa(variance)} روز دیرتر از برنامه است` });
  if (running && i.planned_start && i.planned_end && i.planned_end > i.planned_start) {
    const total = daysBetween(i.planned_start, i.planned_end);
    const elapsed = Math.min(1, Math.max(0, daysBetween(i.planned_start, i.today) / total));
    const gap = elapsed - i.pct / 100;
    if (gap > 0.5) reasons.push({ key: "progress", level: "red", label: `${fa(Math.round(elapsed * 100))}٪ زمان گذشته و پیشرفت ${fa(i.pct)}٪ است` });
    else if (gap > 0.25) reasons.push({ key: "progress", level: "amber", label: `${fa(Math.round(elapsed * 100))}٪ زمان گذشته و پیشرفت ${fa(i.pct)}٪ است` });
  }
  if (i.milestones_overdue >= 2) reasons.push({ key: "milestones", level: "red", label: `${fa(i.milestones_overdue)} نقطهٔ عطف از موعد گذشته است` });
  else if (i.milestones_overdue === 1) reasons.push({ key: "milestones", level: "amber", label: "یک نقطهٔ عطف از موعد گذشته است" });
  if (i.open_risks >= 3) reasons.push({ key: "risks", level: "red", label: `${fa(i.open_risks)} ریسک مهم باز است` });
  else if (i.open_risks >= 1) reasons.push({ key: "risks", level: "amber", label: `${fa(i.open_risks)} ریسک مهم باز است` });
  const budget = Number(i.budget);
  const cost = Number(i.actual_cost);
  if (Number.isFinite(budget) && budget > 0 && Number.isFinite(cost)) {
    if (cost > budget) reasons.push({ key: "cost", level: "red", label: "هزینهٔ واقعی از بودجه گذشته است" });
    else if (cost > 0.9 * budget && i.pct < 80) reasons.push({ key: "cost", level: "amber", label: "بیش از ۹۰٪ بودجه خرج شده و پیشرفت کمتر از ۸۰٪ است" });
  }
  if (i.tasks_overdue >= 5) reasons.push({ key: "tasks", level: "amber", label: `${fa(i.tasks_overdue)} کار از موعد گذشته است` });
  if (i.state === "executing") {
    const last = i.last_status_at ? i.last_status_at.slice(0, 10) : null;
    if (!last || daysBetween(last, i.today) > cfg.status_report_days) reasons.push({ key: "status_report", level: "amber", label: "گزارش وضعیت به‌موقع منتشر نشده است" });
  }
  const health = !running && !reasons.length ? "unknown" : reasons.some((r) => r.level === "red") ? "red" : reasons.length ? "amber" : "green";
  const started = i.pct > 0 || (!!i.planned_start && i.today >= i.planned_start);
  const schedule_status = !started ? "not_started" : variance !== null && variance >= 1 ? "delayed" : variance !== null && variance <= -1 ? "ahead" : "on_track";
  return { health, reasons, schedule_status, variance_days: variance };
}

// ---------------------------------------------------------------------------------------------------------------
// Demand scoring

const n = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/** WSJF, RICE and the weighted score of a demand, and the score of its model (PRJ-003). */
export function demandScores(d: Row, model?: string | null): { wsjf: number | null; rice: number | null; weighted: number | null; score: number | null } {
  const bv = n(d.business_value);
  const tc = n(d.time_criticality);
  const rr = n(d.risk_reduction);
  const js = n(d.job_size);
  const al = n(d.alignment);
  const wsjf = bv !== null && tc !== null && rr !== null && js ? r2((bv + tc + rr) / js) : null;
  const reach = n(d.reach);
  const impact = n(d.impact_level);
  const conf = n(d.confidence);
  const effort = n(d.effort_months);
  const rice = reach !== null && impact !== null && conf !== null && effort ? r2((reach * impact * (conf / 100)) / effort) : null;
  const parts: [number | null, number][] = [[bv, 3], [al, 2], [tc, 2], [rr, 1], [js === null ? null : 11 - js, 2]];
  const known = parts.filter(([v]) => v !== null) as [number, number][];
  const weighted = known.length >= 3 ? r2(known.reduce((s, [v, w]) => s + v * w, 0) / known.reduce((s, [, w]) => s + w, 0)) : null;
  const m = model ?? d.scoring_model ?? "wsjf";
  const score = m === "rice" ? rice : m === "weighted" ? weighted : wsjf;
  return { wsjf, rice, weighted, score };
}

// ---------------------------------------------------------------------------------------------------------------
// Resource heat map

export interface AllocLike {
  user_id: string;
  start_date: string;
  end_date: string;
  hours_per_week: unknown;
  state?: string | null;
  project_id?: string | null;
}

/** Saturdays of the `count` weeks from the week of `from`. */
export function weeksFrom(from: string, count: number): string[] {
  const t = toMs(from);
  const day = Math.floor(t / DAY);
  const sat = day - (((day - 2) % 7) + 7) % 7;
  return Array.from({ length: Math.max(0, Math.min(104, count)) }, (_, i) => toIso((sat + 7 * i) * DAY));
}

/** Allocated hours per person and week, with the load against the weekly capacity. */
export function heatMap(allocs: readonly AllocLike[], weeks: readonly string[], capacity: number): { user_id: string; weeks: { week: string; hours: number; load: number; over: boolean }[]; peak: number }[] {
  const people = new Map<string, number[]>();
  for (const a of allocs) {
    const h = Number(a.hours_per_week);
    if (!Number.isFinite(h) || h <= 0 || !a.start_date || !a.end_date) continue;
    const row = people.get(a.user_id) ?? weeks.map(() => 0);
    weeks.forEach((w, i) => {
      const end = addDaysIso(w, 6);
      if (a.start_date <= end && a.end_date >= w) row[i] += h;
    });
    people.set(a.user_id, row);
  }
  const cap = capacity > 0 ? capacity : 44;
  return [...people.entries()].map(([user_id, hours]) => {
    const ws = weeks.map((week, i) => ({ week, hours: r2(hours[i]), load: Math.round((hours[i] / cap) * 100), over: hours[i] > cap }));
    return { user_id, weeks: ws, peak: Math.max(0, ...ws.map((w) => w.load)) };
  }).sort((a, b) => b.peak - a.peak);
}

// ---------------------------------------------------------------------------------------------------------------
// Earned value (PRJ-041)

export interface EarnedValue {
  /** budget at completion */
  bac: number;
  /** planned value: the budget of the work planned to be done by today */
  pv: number;
  /** earned value: the budget of the work done (progress × budget) */
  ev: number;
  /** actual cost */
  ac: number;
  /** schedule and cost performance indices (null without a base) */
  spi: number | null;
  cpi: number | null;
  /** estimate at completion (BAC ÷ CPI) */
  eac: number | null;
}

/** Earned value of a project from its budget, progress, planned dates and actual cost (null without a budget). */
export function earnedValue(i: { budget: unknown; actual_cost: unknown; pct: unknown; planned_start?: string | null; planned_end?: string | null; today: string }): EarnedValue | null {
  const bac = Number(i.budget);
  if (!Number.isFinite(bac) || bac <= 0) return null;
  const ac = Number.isFinite(Number(i.actual_cost)) ? Number(i.actual_cost) : 0;
  const pct = Math.min(100, Math.max(0, Number(i.pct) || 0));
  let planned = 0;
  if (i.planned_start && i.planned_end && i.planned_end > i.planned_start) {
    const total = daysBetween(i.planned_start, i.planned_end);
    planned = Math.min(1, Math.max(0, daysBetween(i.planned_start, i.today) / total));
  }
  const pv = Math.round(bac * planned);
  const ev = Math.round((bac * pct) / 100);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const cpi = ac > 0 ? r3(ev / ac) : null;
  return { bac, pv, ev, ac, spi: pv > 0 ? r3(ev / pv) : null, cpi, eac: cpi && cpi > 0 ? Math.round(bac / cpi) : null };
}
