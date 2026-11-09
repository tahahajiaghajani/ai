// Pure logic of IT asset management, shared by the server and the screens (tests: tests/itam-logic.test.ts):
//   · lifecycle — substates that fit a state, what an asset's state means for its CI, warranty status
//   · depreciation — straight line, declining balance and sum-of-years-digits, month by month on the Jalali calendar
//   · stock — status of a stock rule and the quantity to order
//   · software — normalisation of discovered names to software models, the effective licence position per metric
//     (device, user, core, concurrent, subscription, site), true-up projection
//   · labels — QR payloads, A4 sheet geometry, reading a scanned code
//   · TCO and repair-or-replace
// Every amount is an exact decimal string (Rials); never floats for stored values.
import { add, cmp, D, div, isPos, max as dmax, min as dmin, mul, round, sub, sum, type Num } from "../money";
import { addDays, diffDays, toJalali } from "../jalali";
import { ASSET_SUBSTATES, DEFAULT_SUBSTATE } from "../tables/itam";

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle

/** The substate to keep or set when an asset is in `state` (null when the state has none). */
export function substateFor(state: string, current: string | null | undefined): string | null {
  const fits = ASSET_SUBSTATES.some((o) => o.value === current && o.parent === state);
  if (fits) return current as string;
  return DEFAULT_SUBSTATE[state] ?? null;
}

/** What an asset's state and substate mean for its CI (install status, operational status, CI lifecycle state). */
export function ciStatusOf(state: string, substate: string | null | undefined): { install_status: string | null; operational_status: string | null; ci_state: string | null } {
  switch (state) {
    case "on_order":
      return { install_status: null, operational_status: null, ci_state: "on_order" };
    case "in_stock":
      return { install_status: substate === "pending_install" ? "pending_install" : "in_stock", operational_status: "ready", ci_state: null };
    case "in_transit":
      return { install_status: "in_transit", operational_status: null, ci_state: null };
    case "in_use":
      return { install_status: "installed", operational_status: "operational", ci_state: "operational" };
    case "in_repair":
      return { install_status: "pending_repair", operational_status: "repair", ci_state: null };
    case "missing":
      return { install_status: substate === "stolen" ? "stolen" : "absent", operational_status: "non_operational", ci_state: null };
    case "retired":
      return { install_status: "removed", operational_status: "non_operational", ci_state: "retired" };
    case "disposed":
      return { install_status: "removed", operational_status: "non_operational", ci_state: "disposed" };
    default:
      return { install_status: null, operational_status: null, ci_state: null };
  }
}

export type WarrantyStatus = "none" | "active" | "expiring" | "expired";

/** Warranty of an asset on `today`: expiring within `soonDays`. */
export function warrantyStatus(end: string | null | undefined, today: string, soonDays = 90): WarrantyStatus {
  if (!end) return "none";
  const left = diffDays(today, end);
  if (left < 0) return "expired";
  return left <= soonDays ? "expiring" : "active";
}

/** The next asset tag: prefix + the record number's digits (IT-0000123). */
export function assetTagFor(prefix: string | null | undefined, number: string | null | undefined): string | null {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `${prefix ?? ""}${digits}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Depreciation (ITAM-042)

export type DepMethod = "straight_line" | "declining_balance" | "sum_of_years" | "none";

export interface DepInput {
  cost: Num;
  salvage?: Num;
  lifeMonths: number;
  method: DepMethod;
  /** annual rate for declining balance (percent); default double the straight-line rate */
  ratePercent?: Num | null;
  /** the first month that carries a charge (the in-service or purchase date) */
  start: string;
  /** the date to value the asset at */
  asOf: string;
}

export interface DepMonth {
  /** 1-based month of the asset's life */
  n: number;
  /** Jalali year-month «1405-03» */
  period: string;
  charge: string;
  accumulated: string;
  book: string;
}

export interface DepResult {
  /** months charged up to `asOf` */
  months: number;
  accumulated: string;
  bookValue: string;
  /** the charge of the month of `asOf` (0 once fully depreciated or before the start) */
  monthCharge: string;
  fullyDepreciated: boolean;
}

const capAt = (a: ReturnType<typeof D>, cap: ReturnType<typeof D>) => (a.gt(cap) ? cap : a);

const monthIndex = (iso: string): number => {
  const j = toJalali(iso);
  return j.jy * 12 + (j.jm - 1);
};
const periodOfIndex = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/** The month-by-month schedule of an asset's whole life (rounded to the Rial; the last month absorbs rounding). */
export function depreciationSchedule(input: Omit<DepInput, "asOf">): DepMonth[] {
  const life = Math.max(0, Math.min(600, Math.floor(input.lifeMonths || 0)));
  const cost = D(input.cost);
  const salvage = D(dmin(input.salvage ?? 0, input.cost));
  const base = cost.minus(salvage);
  const first = monthIndex(input.start);
  const out: DepMonth[] = [];
  if (input.method === "none" || life === 0 || base.lte(0)) return out;
  let acc = D(0);
  const years = Math.ceil(life / 12);
  const syd = (years * (years + 1)) / 2;
  const rate = input.ratePercent !== null && input.ratePercent !== undefined && D(input.ratePercent).gt(0) ? D(input.ratePercent).div(100) : D(2).div(life / 12);
  for (let n = 1; n <= life; n++) {
    let target: ReturnType<typeof D>;
    if (input.method === "straight_line") {
      target = base.mul(n).div(life);
    } else if (input.method === "sum_of_years") {
      // full years before this month, then this year's share spread over its months
      const k = Math.floor((n - 1) / 12) + 1;
      let before = D(0);
      for (let y = 1; y < k; y++) before = before.plus(base.mul(years - y + 1).div(syd));
      const monthsInYear = Math.min(12, life - (k - 1) * 12);
      const inYear = n - (k - 1) * 12;
      target = before.plus(base.mul(years - k + 1).div(syd).mul(inYear).div(monthsInYear));
    } else {
      // declining balance on the book value; never below salvage; the last month writes down to salvage
      const book = cost.minus(acc);
      const charge = book.mul(rate).div(12);
      target = n === life ? base : capAt(acc.plus(charge), base);
    }
    const rounded = n === life ? base.toDecimalPlaces(0) : target.toDecimalPlaces(0);
    const charge = rounded.minus(acc.toDecimalPlaces(0));
    acc = rounded;
    out.push({ n, period: periodOfIndex(first + n - 1), charge: charge.toString(), accumulated: acc.toString(), book: cost.minus(acc).toString() });
  }
  return out;
}


/** The book value of an asset on a date. */
export function depreciation(input: DepInput): DepResult {
  const cost = D(input.cost).toString();
  if (!input.start || input.asOf < input.start) return { months: 0, accumulated: "0", bookValue: cost, monthCharge: "0", fullyDepreciated: false };
  const schedule = depreciationSchedule(input);
  if (!schedule.length) return { months: 0, accumulated: "0", bookValue: cost, monthCharge: "0", fullyDepreciated: false };
  const elapsed = monthIndex(input.asOf) - monthIndex(input.start) + 1;
  const months = Math.max(0, Math.min(schedule.length, elapsed));
  if (!months) return { months: 0, accumulated: "0", bookValue: cost, monthCharge: "0", fullyDepreciated: false };
  const row = schedule[months - 1];
  return { months, accumulated: row.accumulated, bookValue: row.book, monthCharge: elapsed <= schedule.length ? row.charge : "0", fullyDepreciated: elapsed >= schedule.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Stock (ITAM-014/015)

export type StockStatus = "ok" | "low" | "out";

export interface StockRuleLike {
  min_qty?: number | null;
  max_qty?: number | null;
  reorder_qty?: number | null;
}

/** A stock rule's status for an available quantity: out (none left while a minimum is set), low (at or under it). */
export function stockStatus(available: number, rule: StockRuleLike): StockStatus {
  const min = Math.max(0, Number(rule.min_qty ?? 0));
  if (available <= 0 && min > 0) return "out";
  return available <= min && min > 0 ? "low" : "ok";
}

/** How many to order: the rule's order quantity, else up to the target level (never negative). */
export function orderQuantity(available: number, rule: StockRuleLike): number {
  const fixed = Number(rule.reorder_qty ?? 0);
  if (fixed > 0) return fixed;
  const target = Math.max(Number(rule.max_qty ?? 0), Number(rule.min_qty ?? 0) + 1);
  return Math.max(0, target - Math.max(0, available));
}

// ---------------------------------------------------------------------------------------------------------------
// Software normalisation (ITAM-048)

export interface SoftwareModelLike {
  id: string;
  name: string;
  match_patterns?: string[] | null;
  publisher_patterns?: string[] | null;
  exclude_patterns?: string[] | null;
}

const fold = (s: string) => s.toLowerCase().replace(/[‌‏‎]/g, "").replace(/\s+/g, " ").trim();

function patternHit(pattern: string, text: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  if (p.length > 2 && p.startsWith("/") && p.endsWith("/")) {
    try {
      return new RegExp(p.slice(1, -1), "i").test(text);
    } catch {
      return false;
    }
  }
  return fold(text).includes(fold(p));
}

/**
 * The software model a discovered name (and publisher) belongs to: a model whose name patterns match (or whose name
 * appears in the raw name when it has none), whose publisher patterns match when it has them, and none of whose
 * exclusions match. The longest matching pattern wins (the most specific product), ties by model name.
 */
export function matchSoftware(raw: { name: string; publisher?: string | null }, models: SoftwareModelLike[]): { id: string; pattern: string } | null {
  const name = raw.name ?? "";
  let best: { id: string; pattern: string; score: number; label: string } | null = null;
  for (const m of models) {
    const patterns = (m.match_patterns?.length ? m.match_patterns : [m.name]).filter(Boolean);
    const hit = patterns.filter((p) => patternHit(p, name)).sort((a, b) => b.length - a.length)[0];
    if (!hit) continue;
    if (m.publisher_patterns?.length && !m.publisher_patterns.some((p) => patternHit(p, raw.publisher ?? ""))) continue;
    if ((m.exclude_patterns ?? []).some((p) => patternHit(p, name))) continue;
    const score = hit.length;
    if (!best || score > best.score || (score === best.score && m.name < best.label)) best = { id: m.id, pattern: hit, score, label: m.name };
  }
  return best ? { id: best.id, pattern: best.pattern } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Effective licence position (ITAM-053/056/058)

export type LicenseMetric = "per_device" | "per_user" | "per_core" | "concurrent" | "subscription" | "site" | "free" | "open_source";
export type PositionStatus = "compliant" | "under_licensed" | "over_licensed" | "unlicensed" | "unlimited" | "free";

export interface PosEntitlement {
  id: string;
  metric: LicenseMetric;
  quantity: number;
  min_cores?: number | null;
  unit_cost?: Num;
  total_cost?: Num;
  state: string;
  start_date?: string | null;
  end_date?: string | null;
  allocation_required?: boolean;
}

export interface PosInstall {
  id: string;
  ci_id: string;
  user_id?: string | null;
  cores?: number | null;
  last_used_at?: string | null;
  active?: boolean;
}

export interface PosAllocation {
  entitlement_id: string;
  user_id?: string | null;
  ci_id?: string | null;
  active?: boolean;
}

export interface PositionInput {
  /** the model's default metric (used when no entitlement is active) */
  metric: LicenseMetric;
  list_price?: Num;
  entitlements: PosEntitlement[];
  installs: PosInstall[];
  allocations?: PosAllocation[];
  /** today (ISO date) */
  today: string;
  /** an install not used for this many days is reclaimable (only installs with a known last use) */
  unusedDays: number;
}

export interface Position {
  metric: LicenseMetric;
  entitled: number;
  consumed: number;
  delta: number;
  installs: number;
  devices: number;
  users: number;
  unused_installs: number;
  /** licences (or cores) reclaimable from unused installs */
  reclaimable: number;
  status: PositionStatus;
  unit_price: string;
  exposure: string;
  savings: string;
  detail: { active_entitlements: string[]; notes: string[]; by_metric: Record<string, number> };
}

/** Is an entitlement in force on `today` (active, started, not ended)? */
export function entitlementInForce(e: PosEntitlement, today: string): boolean {
  if (e.state !== "active") return false;
  if (e.start_date && e.start_date > today) return false;
  if (e.end_date && e.end_date < today) return false;
  return true;
}

const UNLIMITED = new Set<LicenseMetric>(["site"]);
const FREE = new Set<LicenseMetric>(["free", "open_source"]);

/**
 * The effective licence position of one software model: what the active entitlements grant under their metric
 * against what the installations (or the named allocations, when the entitlement requires them) consume.
 *   per_device   distinct devices with an active install
 *   per_user     distinct users of those devices (a device without a user counts as one)
 *   per_core     Σ per device of max(its cores, the entitlements' core minimum)
 *   concurrent   users who used it within 30 days (all users when no usage is measured — an upper bound)
 *   subscription named allocations, else users
 * Mixed per-device and per-user entitlements count one for one (noted). Exposure = shortfall × unit price; savings =
 * (surplus + reclaimable from installs unused for `unusedDays`) × unit price.
 */
export function licensePosition(input: PositionInput): Position {
  const live = input.installs.filter((i) => i.active !== false);
  const ents = input.entitlements.filter((e) => entitlementInForce(e, input.today));
  const notes: string[] = [];
  const devices = new Set(live.map((i) => i.ci_id));
  const users = new Set(live.filter((i) => i.user_id).map((i) => String(i.user_id)));
  const userless = new Set(live.filter((i) => !i.user_id).map((i) => i.ci_id));
  const byMetric: Record<string, number> = {};
  for (const e of ents) byMetric[e.metric] = (byMetric[e.metric] ?? 0) + Math.max(0, Number(e.quantity) || 0);
  // the metric that carries most of the entitlements, else the model's
  const metric = (Object.entries(byMetric).sort((a, b) => b[1] - a[1])[0]?.[0] as LicenseMetric | undefined) ?? input.metric;
  const cutoff = addDays(input.today, -Math.max(1, input.unusedDays));
  const unused = live.filter((i) => i.last_used_at && i.last_used_at.slice(0, 10) < cutoff);
  const coresOf = (ciId: string, min: number) => Math.max(min, ...live.filter((i) => i.ci_id === ciId).map((i) => Number(i.cores ?? 0) || 1));
  const minCores = Math.max(1, ...ents.filter((e) => e.metric === "per_core").map((e) => Number(e.min_cores ?? 1) || 1));
  const allocations = (input.allocations ?? []).filter((a) => a.active !== false && ents.some((e) => e.id === a.entitlement_id));
  const needsAllocation = ents.some((e) => e.allocation_required);

  let consumed: number;
  let reclaimable = 0;
  switch (metric) {
    case "per_user":
      consumed = users.size + userless.size;
      reclaimable = new Set(unused.map((i) => i.user_id ?? `ci:${i.ci_id}`)).size;
      break;
    case "per_core":
      consumed = [...devices].reduce((n, ci) => n + coresOf(ci, minCores), 0);
      reclaimable = [...new Set(unused.map((i) => i.ci_id))].reduce((n, ci) => n + coresOf(ci, minCores), 0);
      break;
    case "concurrent": {
      const recent = addDays(input.today, -30);
      const measured = live.some((i) => i.last_used_at);
      const active = live.filter((i) => !measured || (i.last_used_at && i.last_used_at.slice(0, 10) >= recent));
      consumed = new Set(active.map((i) => i.user_id ?? `ci:${i.ci_id}`)).size;
      if (!measured) notes.push("مصرف هم‌زمان اندازه‌گیری نشده است؛ همهٔ کاربران شمرده شدند (کران بالا)");
      break;
    }
    case "subscription":
      consumed = allocations.length ? allocations.length : users.size + userless.size;
      break;
    default:
      consumed = devices.size;
      reclaimable = new Set(unused.map((i) => i.ci_id)).size;
  }
  if (needsAllocation && ["per_device", "per_user", "subscription"].includes(metric)) {
    consumed = allocations.length;
    notes.push("مصرف از تخصیص‌های نام‌دار شمرده شد");
  }
  let entitled = byMetric[metric] ?? 0;
  if (metric === "per_device" && byMetric.per_user) {
    entitled += byMetric.per_user;
    notes.push("مجوزهای کاربری یک‌به‌یک با دستگاه‌ها شمرده شدند");
  } else if (metric === "per_user" && byMetric.per_device) {
    entitled += byMetric.per_device;
    notes.push("مجوزهای دستگاهی یک‌به‌یک با کاربران شمرده شدند");
  }

  // unit price: the entitlements' weighted average, else the list price
  let qty = 0;
  let money = "0";
  for (const e of ents.filter((x) => x.metric === metric)) {
    const q = Math.max(0, Number(e.quantity) || 0);
    const unit = e.unit_cost !== null && e.unit_cost !== undefined && e.unit_cost !== "" ? D(e.unit_cost) : q > 0 && e.total_cost ? D(e.total_cost).div(q) : null;
    if (!unit || q === 0) continue;
    qty += q;
    money = add(money, unit.mul(q));
  }
  const unitPrice = qty > 0 ? round(div(money, qty), 0) : round(input.list_price ?? 0, 0);

  const unlimited = ents.some((e) => UNLIMITED.has(e.metric));
  const free = ents.length > 0 && ents.every((e) => FREE.has(e.metric));
  const delta = entitled - consumed;
  let status: PositionStatus;
  if (free || (!ents.length && FREE.has(input.metric))) status = "free";
  else if (unlimited) status = "unlimited";
  else if (entitled === 0 && consumed > 0) status = "unlicensed";
  else if (delta < 0) status = "under_licensed";
  else if (delta > 0) status = "over_licensed";
  else status = "compliant";
  const exempt = status === "free" || status === "unlimited";
  const shortfall = exempt ? 0 : Math.max(0, -delta);
  const surplus = exempt ? 0 : Math.max(0, delta);
  const reclaim = exempt ? 0 : Math.min(reclaimable, consumed);
  return {
    metric,
    entitled,
    consumed,
    delta: exempt ? 0 : delta,
    installs: live.length,
    devices: devices.size,
    users: users.size,
    unused_installs: unused.length,
    reclaimable: reclaim,
    status,
    unit_price: unitPrice,
    exposure: mul(unitPrice, shortfall),
    savings: mul(unitPrice, surplus + reclaim),
    detail: { active_entitlements: ents.map((e) => e.id), notes, by_metric: byMetric },
  };
}

/** Summary of positions for the compliance page and the reconciliation run. */
export function positionTotals(ps: Pick<Position, "status" | "exposure" | "savings">[]): { products: number; compliant: number; under_licensed: number; over_licensed: number; exposure: string; savings: string } {
  return {
    products: ps.length,
    compliant: ps.filter((p) => p.status === "compliant" || p.status === "unlimited" || p.status === "free").length,
    under_licensed: ps.filter((p) => p.status === "under_licensed" || p.status === "unlicensed").length,
    over_licensed: ps.filter((p) => p.status === "over_licensed").length,
    exposure: sum(ps, (p) => p.exposure),
    savings: sum(ps, (p) => p.savings),
  };
}

/**
 * True-up projection (ITAM-059): the consumption on `dueDate` by a least-squares line through the history
 * (`{ at, consumed }`, at least two points; otherwise the latest value), and the licences and money it would cost.
 */
export function trueUpProjection(history: { at: string; consumed: number }[], entitled: number, unitPrice: Num, dueDate: string): { projected: number; shortfall: number; cost: string; trend: number } {
  const pts = history.filter((h) => h.at && Number.isFinite(h.consumed)).sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!pts.length) return { projected: 0, shortfall: 0, cost: "0", trend: 0 };
  const last = pts[pts.length - 1];
  let projected = last.consumed;
  let trend = 0;
  if (pts.length >= 2) {
    const x0 = pts[0].at.slice(0, 10);
    const xs = pts.map((p) => diffDays(x0, p.at.slice(0, 10)));
    const ys = pts.map((p) => p.consumed);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    trend = sxx > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx : 0;
    const at = diffDays(x0, dueDate);
    projected = Math.max(0, Math.round(my + trend * (at - mx)));
  }
  const shortfall = Math.max(0, projected - entitled);
  return { projected, shortfall, cost: mul(unitPrice ?? 0, shortfall), trend: Math.round(trend * 30 * 100) / 100 };
}

// ---------------------------------------------------------------------------------------------------------------
// Labels and scanning (ITAM-028/029)

/** What a label's QR code holds: the asset page on the organisation's address, else its tag (or number). */
export function qrPayload(base: string | null | undefined, orgId: string, asset: { id: string; asset_tag?: string | null; number?: string | null }): string {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  if (b && /^https?:\/\//i.test(b)) return `${b}/${orgId}/assets/${asset.id}`;
  return String(asset.asset_tag || asset.number || asset.id);
}

export type ScanRef = { kind: "id"; value: string } | { kind: "number"; value: string } | { kind: "code"; value: string };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Read what a scanner (keyboard wedge, camera) typed: an asset link or id, an asset number, else a tag or serial. */
export function parseScan(raw: string): ScanRef | null {
  const s = String(raw ?? "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).trim();
  if (!s) return null;
  const url = /\/(?:assets|r\/asset)\/([0-9a-f-]{36})/i.exec(s);
  if (url) return { kind: "id", value: url[1].toLowerCase() };
  if (UUID_RE.test(s) && s.replace(UUID_RE, "") === "") return { kind: "id", value: s.toLowerCase() };
  if (/^AST-?\d{1,12}$/i.test(s)) return { kind: "number", value: s.toUpperCase().replace("-", "") };
  return { kind: "code", value: s.slice(0, 300) };
}

export interface LabelTemplateLike {
  cols_count?: number | null;
  rows_count?: number | null;
  label_width_mm?: Num;
  label_height_mm?: Num;
  margin_top_mm?: Num;
  margin_side_mm?: Num;
  gap_x_mm?: Num;
  gap_y_mm?: Num;
}

export const A4 = { width: 210, height: 297 } as const;

/** The geometry of one A4 sheet of labels (millimetres; RTL: the first label is at the top right). */
export function labelSheet(t: LabelTemplateLike): { perPage: number; cols: number; rows: number; width: number; height: number; cells: { x: number; y: number }[]; fits: boolean } {
  const cols = Math.max(1, Math.min(8, Number(t.cols_count ?? 3)));
  const rows = Math.max(1, Math.min(20, Number(t.rows_count ?? 8)));
  const width = Number(t.label_width_mm ?? 63.5);
  const height = Number(t.label_height_mm ?? 33.9);
  const top = Number(t.margin_top_mm ?? 13);
  const side = Number(t.margin_side_mm ?? 7);
  const gx = Number(t.gap_x_mm ?? 2.5);
  const gy = Number(t.gap_y_mm ?? 0);
  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: A4.width - side - width - c * (width + gx), y: top + r * (height + gy) });
  const fits = side * 2 + cols * width + (cols - 1) * gx <= A4.width + 0.01 && top + rows * height + (rows - 1) * gy <= A4.height + 0.01;
  return { perPage: cols * rows, cols, rows, width, height, cells, fits };
}

/** Split items into pages of `perPage`, skipping `skip` cells of the first sheet (a sheet already partly used). */
export function paginate<T>(items: T[], perPage: number, skip = 0): (T | null)[][] {
  const cells: (T | null)[] = [...Array(Math.max(0, Math.min(skip, perPage - 1))).fill(null), ...items];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += perPage) pages.push(cells.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

// ---------------------------------------------------------------------------------------------------------------
// Total cost of ownership and repair or replace (ITAM-043)

export interface TcoInput {
  purchase?: Num;
  repairs?: Num[];
  /** the asset's share of support and maintenance contracts */
  contracts?: Num;
  /** other costs posted against the asset (not its purchase or depreciation) */
  other?: Num[];
  /** months in service so far */
  months?: number;
  /** what a replacement costs now (the model's standard cost) */
  replacement?: Num;
  usefulLifeMonths?: number | null;
}

export interface TcoResult {
  acquisition: string;
  repairs: string;
  contracts: string;
  other: string;
  total: string;
  monthly: string;
  recommendation: "keep" | "watch" | "replace";
  reasons: string[];
}

/** TCO of an asset and a rule-based repair-or-replace recommendation. */
export function assetTco(i: TcoInput): TcoResult {
  const acquisition = D(i.purchase ?? 0).toString();
  const repairs = sum(i.repairs ?? [], (x) => x);
  const contracts = D(i.contracts ?? 0).toString();
  const other = sum(i.other ?? [], (x) => x);
  const total = add(acquisition, repairs, contracts, other);
  const months = Math.max(0, i.months ?? 0);
  const monthly = months > 0 ? round(div(total, months), 0) : "0";
  const reasons: string[] = [];
  let recommendation: TcoResult["recommendation"] = "keep";
  const replacement = D(i.replacement ?? 0);
  if (replacement.gt(0) && D(repairs).gte(replacement.mul(0.5))) {
    recommendation = "replace";
    reasons.push("هزینهٔ تعمیرها به نیمی از بهای جایگزینی رسیده است");
  } else if (replacement.gt(0) && D(repairs).gte(replacement.mul(0.3))) {
    recommendation = "watch";
    reasons.push("هزینهٔ تعمیرها از ۳۰٪ بهای جایگزینی گذشته است");
  }
  if (i.usefulLifeMonths && months >= i.usefulLifeMonths) {
    recommendation = recommendation === "keep" ? "watch" : recommendation;
    reasons.push("عمر مفید دارایی به پایان رسیده است");
    if ((i.repairs ?? []).length >= 2) recommendation = "replace";
  }
  return { acquisition, repairs, contracts, other, total, monthly, recommendation, reasons };
}

/** The share of one asset in a contract's annual value (prorated by covered months in the year, split per asset). */
export function contractShare(annual: Num, coveredAssets: number, months = 12): string {
  if (!isPos(annual) || coveredAssets <= 0) return "0";
  return round(div(mul(annual, Math.max(0, Math.min(12, months))), 12 * coveredAssets), 0);
}

export { cmp as compareMoney, dmax as maxMoney, sub as subMoney };
