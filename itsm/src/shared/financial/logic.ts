// Pure logic of IT financial management, shared by the server and the screens (tests: tests/financial-logic.test.ts):
// the Jalali fiscal year (1 Farvardin – the end of Esfand) and its periods, money in Rials with an optional Toman
// display and Persian digit grouping, exact allocation by weights (largest remainder: the parts always add up),
// monthly accruals of annual amounts, budget against actual by cost centre, cost type and month, and the variance
// drivers the AI narrative reads. Every amount is an exact decimal string.
import { add, D, div, isZero, mul, round, sub, sum, type Num } from "../money";
import { fromJalali, JALALI_MONTHS, jalaliYearRange, monthLength, toJalali } from "../jalali";
import { faDigits, formatMoney } from "../format";

// ---------------------------------------------------------------------------------------------------------------
// The fiscal calendar (FIN-001)

export interface FiscalPeriodSpec {
  month: number;
  key: string;
  name: string;
  start_date: string;
  end_date: string;
}

/** The fiscal year containing a date (the Jalali year: it starts on 1 Farvardin). */
export const fiscalYearOf = (iso: string): number => toJalali(iso).jy;

/** First and last day of fiscal year `jy`. */
export const fiscalYearRange = (jy: number): { start: string; end: string } => jalaliYearRange(jy);

/** The twelve posting periods of fiscal year `jy`. */
export function fiscalPeriods(jy: number): FiscalPeriodSpec[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return { month: m, key: periodKey(jy, m), name: `${JALALI_MONTHS[i]} ${faDigits(jy)}`, start_date: fromJalali(jy, m, 1), end_date: fromJalali(jy, m, monthLength(jy, m)) };
  });
}

export const periodKey = (jy: number, jm: number): string => `${jy}-${String(jm).padStart(2, "0")}`;

/** The period key of a date («1405-08»). */
export function periodKeyOf(iso: string): string {
  const j = toJalali(iso);
  return periodKey(j.jy, j.jm);
}

/** The period keys from `from` to `to` (inclusive, in order). */
export function periodRange(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let i = fy * 12 + fm - 1; i <= ty * 12 + tm - 1 && out.length < 240; i++) out.push(periodKey(Math.floor(i / 12), (i % 12) + 1));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Money display (FIN-002)

export type MoneyUnit = "rial" | "toman";

/** An amount in Rials for people: Persian digits grouped, in Rials or Tomans (÷ 10). */
export function formatRial(v: Num, unit: MoneyUnit = "rial", opts: { suffix?: boolean; compact?: boolean } = {}): string {
  const amount = unit === "toman" ? div(v ?? 0, 10, 1) : D(v ?? 0).toString();
  const name = unit === "toman" ? "تومان" : "ریال";
  // compact (tiles, chart axes): «۱۰٫۸ میلیارد ریال» — one decimal under a hundred, whole numbers above
  if (opts.compact) {
    const n = D(amount);
    for (const [step, word] of [[1e12, "هزار میلیارد"], [1e9, "میلیارد"], [1e6, "میلیون"]] as const) {
      if (n.abs().lt(step)) continue;
      const x = n.div(step);
      const text = `${faDigits(x.toDecimalPlaces(x.abs().lt(100) ? 1 : 0).toString()).replace(".", "٫")} ${word}`;
      return opts.suffix === false ? text : `${text} ${name}`;
    }
  }
  const text = formatMoney(round(amount, 0));
  return opts.suffix === false ? text : `${text} ${name}`;
}

/** A foreign amount at a rate → Rials (rounded to the Rial). */
export const toRial = (amount: Num, rate: Num): string => round(mul(amount ?? 0, rate ?? 0), 0);

// ---------------------------------------------------------------------------------------------------------------
// Exact allocation (FIN-015)

/**
 * Split `total` Rials by `weights` exactly (largest remainder): every part is a whole Rial and the parts add up to the
 * total. Zero or negative weights get nothing; with no positive weight nothing is allocated.
 */
export function allocate<K extends string>(total: Num, weights: { key: K; weight: Num }[]): { key: K; amount: string }[] {
  if (D(total).lt(0)) return allocate(D(total).neg().toString(), weights).map((p) => ({ key: p.key, amount: D(p.amount).neg().toString() }));
  const whole = D(total).toDecimalPlaces(0, 1);
  const pos = weights.filter((w) => D(w.weight).gt(0));
  const W = pos.reduce((a, w) => a.plus(D(w.weight)), D(0));
  if (W.lte(0) || whole.isZero()) return weights.map((w) => ({ key: w.key, amount: "0" }));
  const raw = pos.map((w) => {
    const exact = whole.mul(D(w.weight)).div(W);
    const floor = exact.toDecimalPlaces(0, 1);
    return { key: w.key, floor, frac: exact.minus(floor) };
  });
  let left = whole.minus(raw.reduce((a, r) => a.plus(r.floor), D(0)));
  const order = [...raw].sort((a, b) => b.frac.comparedTo(a.frac) || (a.key < b.key ? -1 : 1));
  const extra = new Map<string, number>();
  for (const r of order) {
    if (left.lte(0)) break;
    extra.set(r.key, (extra.get(r.key) ?? 0) + 1);
    left = left.minus(1);
  }
  const amounts = new Map(raw.map((r) => [r.key, r.floor.plus(extra.get(r.key) ?? 0).toString()]));
  return weights.map((w) => ({ key: w.key, amount: amounts.get(w.key) ?? "0" }));
}

/** The share of an annual amount in month `m` (1–12) so that twelve months add up exactly to the amount. */
export function monthlyShare(annual: Num, m: number): string {
  const a = D(annual ?? 0);
  const upTo = (k: number) => a.mul(k).div(12).toDecimalPlaces(0);
  return upTo(m).minus(upTo(m - 1)).toString();
}

/** The cost a payment schedule puts in one month of a year of `annual` (monthly accrual whatever the schedule). */
export const accrual = (annual: Num, month: number): string => monthlyShare(annual, Math.max(1, Math.min(12, month)));

// ---------------------------------------------------------------------------------------------------------------
// Budget against actual (FIN-010/012/039)

export interface BudgetLineIn {
  cost_center_id: string;
  cost_type_id: string;
  /** null: the whole year, spread evenly over its months */
  period_key: string | null;
  amount: Num;
}

export interface ActualIn {
  cost_center_id: string;
  cost_type_id: string;
  period_key: string;
  amount: Num;
}

export interface BvaCell {
  budget: string;
  actual: string;
  variance: string;
  /** actual as a percent of budget (null without a budget) */
  used_pct: number | null;
  status: "under" | "near" | "over" | "unbudgeted";
}

export interface BvaRow extends BvaCell {
  cost_center_id: string;
  by_type: (BvaCell & { cost_type_id: string })[];
  by_month: (BvaCell & { period_key: string })[];
}

export function bvaCell(budget: Num, actual: Num, nearPct = 90): BvaCell {
  const b = D(budget ?? 0);
  const a = D(actual ?? 0);
  const used = b.gt(0) ? Number(a.div(b).mul(100).toDecimalPlaces(1)) : null;
  const status: BvaCell["status"] = b.lte(0) ? (a.gt(0) ? "unbudgeted" : "under") : used! > 100 ? "over" : used! >= nearPct ? "near" : "under";
  return { budget: b.toString(), actual: a.toString(), variance: b.minus(a).toString(), used_pct: used, status };
}

/**
 * Budget against actual for the given periods: per cost centre, with the split by cost type and by month. Annual lines
 * (no period) are spread over the twelve months of the year exactly (`monthlyShare`), and only the months asked
 * for count. `nearPct` marks a cell as «نزدیک سقف».
 */
export function budgetVsActual(lines: BudgetLineIn[], actuals: ActualIn[], periods: string[], nearPct = 90): { rows: BvaRow[]; total: BvaCell } {
  const wanted = new Set(periods);
  const budget = new Map<string, string>(); // cc|type|period → amount
  const put = (m: Map<string, string>, k: string, v: Num) => m.set(k, add(m.get(k) ?? "0", v));
  for (const l of lines) {
    if (l.period_key) {
      if (wanted.has(l.period_key)) put(budget, `${l.cost_center_id}|${l.cost_type_id}|${l.period_key}`, l.amount);
      continue;
    }
    for (const p of periods) {
      const month = Number(p.split("-")[1]);
      put(budget, `${l.cost_center_id}|${l.cost_type_id}|${p}`, monthlyShare(l.amount, month));
    }
  }
  const actual = new Map<string, string>();
  for (const a of actuals) if (wanted.has(a.period_key)) put(actual, `${a.cost_center_id}|${a.cost_type_id}|${a.period_key}`, a.amount);
  const centres = new Set<string>();
  for (const k of [...budget.keys(), ...actual.keys()]) centres.add(k.split("|")[0]);
  const rows: BvaRow[] = [];
  let tb = "0";
  let ta = "0";
  for (const cc of [...centres].sort()) {
    const types = new Set<string>();
    const keyOf = (k: string) => k.split("|");
    for (const k of [...budget.keys(), ...actual.keys()]) if (keyOf(k)[0] === cc) types.add(keyOf(k)[1]);
    const sumWhere = (m: Map<string, string>, f: (type: string, period: string) => boolean) =>
      sum([...m.entries()].filter(([k]) => keyOf(k)[0] === cc && f(keyOf(k)[1], keyOf(k)[2])), ([, v]) => v);
    const b = sumWhere(budget, () => true);
    const a = sumWhere(actual, () => true);
    tb = add(tb, b);
    ta = add(ta, a);
    rows.push({
      cost_center_id: cc,
      ...bvaCell(b, a, nearPct),
      by_type: [...types].sort().map((t) => ({ cost_type_id: t, ...bvaCell(sumWhere(budget, (x) => x === t), sumWhere(actual, (x) => x === t), nearPct) })),
      by_month: periods.map((p) => ({ period_key: p, ...bvaCell(sumWhere(budget, (_t, x) => x === p), sumWhere(actual, (_t, x) => x === p), nearPct) })),
    });
  }
  rows.sort((x, y) => D(y.actual).comparedTo(D(x.actual)));
  return { rows, total: bvaCell(tb, ta, nearPct) };
}

/**
 * The biggest variances by a dimension (cost type, supplier, source…), largest absolute first — the facts the
 * variance narrative is written from (FIN-013); the model never computes a number.
 */
export function varianceDrivers(items: { key: string; label: string; budget: Num; actual: Num }[], limit = 5): { key: string; label: string; budget: string; actual: string; variance: string; share_pct: number }[] {
  const total = items.reduce((a, i) => a.plus(D(i.actual).minus(D(i.budget)).abs()), D(0));
  return items
    .map((i) => {
      const v = sub(i.budget, i.actual);
      return { key: i.key, label: i.label, budget: D(i.budget).toString(), actual: D(i.actual).toString(), variance: v, share_pct: total.gt(0) ? Number(D(v).abs().div(total).mul(100).toDecimalPlaces(1)) : 0 };
    })
    .filter((i) => !isZero(i.variance))
    .sort((a, b) => D(b.variance).abs().comparedTo(D(a.variance).abs()))
    .slice(0, limit);
}

/** A rule-based narrative of a budget comparison (the AI skill's fallback and the screen's summary line). */
export function varianceSentence(label: string, cell: BvaCell, unit: MoneyUnit = "rial"): string {
  if (cell.status === "unbudgeted") return `${label}: ${formatRial(cell.actual, unit)} هزینه بدون بودجه ثبت شده است.`;
  const pct = cell.used_pct === null ? "—" : `${faDigits(cell.used_pct)}٪`;
  if (cell.status === "over") return `${label}: ${pct} بودجه مصرف شده و ${formatRial(D(cell.variance).abs().toString(), unit)} از آن بیشتر است.`;
  if (cell.status === "near") return `${label}: ${pct} بودجه مصرف شده و به سقف نزدیک است؛ ${formatRial(cell.variance, unit)} باقی مانده است.`;
  return `${label}: ${pct} بودجه مصرف شده و ${formatRial(cell.variance, unit)} باقی مانده است.`;
}

/** A short fingerprint of a run's inputs (rule versions, amounts): equal inputs give equal hashes (FNV-1a, hex). */
export function inputHash(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
