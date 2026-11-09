// Pure logic of field service, shared by the server and the screens (no I/O):
//   · distances and travel time (great-circle distance × a road factor at an average speed)
//   · skills with levels and expiry, certifications, and the gap between what a task needs and a technician holds
//   · candidate scoring for immediate auto-assignment (FSM-006): feasibility (skills, territory, availability,
//     capacity, the time slot) and a score from travel, load and skill surplus, with Persian reasons
//   · conflicts of a technician's day, the order of a day's route (nearest neighbour) and navigation links
//   · appointment slots from working time minus booked tasks and travel buffers (FSM-014), without names or places
//   · maintenance plans: the next due date (Jalali months and years) and the occurrences to generate now
//   · checklists that must be complete before work is done; the field KPIs
// Imported by the UI: keep it free of server imports.
import { addDays, fromJalali, monthLength, toJalali } from "../jalali";
import { normalizeSearch } from "../model/conditions";
import { MINUTE } from "../sla/calendar";

export interface Point {
  lat: number;
  lng: number;
}

export const toPoint = (lat: unknown, lng: unknown): Point | null => {
  const a = Number(lat);
  const b = Number(lng);
  if (lat === null || lat === undefined || lng === null || lng === undefined || lat === "" || lng === "") return null;
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lng: b } : null;
};

/** Great-circle distance in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes to drive `km` of straight line at `speed` km/h with the road factor. */
export const travelMinutes = (km: number, speed = 35, roadFactor = 1.3): number => Math.max(0, Math.round(((km * roadFactor) / Math.max(5, speed)) * 60));

// ----- skills -----------------------------------------------------------------------------------------------------------

export interface Skill {
  skill: string;
  level: number;
  expires_on?: string | null;
}

export interface Certification {
  name: string;
  expires_on?: string | null;
}

const key = (s: unknown) => normalizeSearch(String(s ?? "")).trim().toLowerCase();

/** A technician's skills from their profile's JSON (bad entries left out; level 1–5, default 1). */
export function parseSkills(raw: unknown): Skill[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).skill === "string" && !!String((x as Record<string, unknown>).skill).trim())
    .map((x) => ({ skill: String(x.skill).trim(), level: Math.min(5, Math.max(1, Math.round(Number(x.level ?? 1)) || 1)), expires_on: typeof x.expires_on === "string" ? x.expires_on.slice(0, 10) : null }));
}

export function parseCertifications(raw: unknown): Certification[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).name === "string")
    .map((x) => ({ name: String(x.name).trim(), expires_on: typeof x.expires_on === "string" ? x.expires_on.slice(0, 10) : null }));
}

/** The skills still valid on `today` (the tags dispatchers filter by). */
export const validSkillTags = (skills: readonly Skill[], today: string): string[] => [...new Set(skills.filter((s) => !s.expires_on || s.expires_on >= today).map((s) => s.skill))];

/** A requirement «برق» or «برق:3» (a minimum level). */
export function parseRequirement(r: string): { skill: string; level: number } {
  const m = /^(.*?)(?::\s*([1-5]))?$/.exec(String(r).trim());
  return { skill: (m?.[1] ?? String(r)).trim(), level: m?.[2] ? Number(m[2]) : 1 };
}

/** What a technician lacks for a task: skills missing or below the level, and skills held but expired. */
export function skillGap(required: readonly string[], skills: readonly Skill[], today: string): { missing: string[]; expired: string[]; surplus: number } {
  const missing: string[] = [];
  const expired: string[] = [];
  let surplus = 0;
  for (const r of required.map(parseRequirement).filter((x) => x.skill)) {
    const held = skills.filter((s) => key(s.skill) === key(r.skill));
    const valid = held.filter((s) => !s.expires_on || s.expires_on >= today);
    const best = Math.max(0, ...valid.map((s) => s.level));
    if (!valid.length && held.length) expired.push(r.skill);
    else if (best < r.level) missing.push(r.level > 1 ? `${r.skill} (سطح ${r.level})` : r.skill);
    else surplus += best - r.level;
  }
  return { missing, expired, surplus };
}

/** Certifications that expire within `days` (or already have). */
export function expiringCertifications(certs: readonly Certification[], today: string, days = 30): Certification[] {
  const limit = addDays(today, days);
  return certs.filter((c) => !!c.expires_on && c.expires_on <= limit);
}

// ----- candidates (FSM-006) ------------------------------------------------------------------------------------------

export interface Span {
  start: number;
  end: number;
}

export interface TechFacts {
  user_id: string;
  name?: string;
  territories: string[];
  skills: Skill[];
  available: boolean;
  active: boolean;
  contractor?: boolean;
  max_tasks_per_day: number;
  /** tasks already scheduled on the day of the proposed slot */
  day_tasks: number;
  /** spans already booked that day */
  busy: Span[];
  /** where the technician is or starts from */
  origin: Point | null;
  /** the proposed slot falls inside the technician's working time (null: unknown, no calendar) */
  on_shift?: boolean | null;
}

export interface TaskFacts {
  required_skills: string[];
  territory_id?: string | null;
  site: Point | null;
  /** the proposed slot (null: as soon as possible — no time check) */
  slot: Span | null;
}

export interface CandidateScore {
  user_id: string;
  feasible: boolean;
  score: number;
  blockers: string[];
  reasons: string[];
  distance_km: number | null;
  travel_minutes: number | null;
}

/**
 * How well a technician fits a task: blockers make them infeasible (a missing or expired skill, another territory,
 * unavailable, a full day, a clash with a booked task, off shift); among the feasible, a shorter drive, a lighter day
 * and spare skill level score higher (an employee slightly before a contractor).
 */
export function scoreCandidate(task: TaskFacts, t: TechFacts, opts: { today: string; speed?: number; roadFactor?: number }): CandidateScore {
  const blockers: string[] = [];
  const reasons: string[] = [];
  if (!t.active) blockers.push("غیرفعال");
  if (!t.available) blockers.push("در دسترس نیست");
  const gap = skillGap(task.required_skills, t.skills, opts.today);
  if (gap.missing.length) blockers.push(`مهارت ندارد: ${gap.missing.join("، ")}`);
  if (gap.expired.length) blockers.push(`مهارت منقضی: ${gap.expired.join("، ")}`);
  if (task.territory_id && t.territories.length && !t.territories.includes(task.territory_id)) blockers.push("در قلمرو دیگری کار می‌کند");
  if (t.day_tasks >= t.max_tasks_per_day) blockers.push(`کارهای روز پر است (${t.day_tasks} از ${t.max_tasks_per_day})`);
  if (task.slot && t.busy.some((b) => b.start < task.slot!.end && task.slot!.start < b.end)) blockers.push("در این زمان کار دیگری دارد");
  if (task.slot && t.on_shift === false) blockers.push("بیرون از شیفت");
  const distance = task.site && t.origin ? haversineKm(t.origin, task.site) : null;
  const travel = distance === null ? null : travelMinutes(distance, opts.speed, opts.roadFactor);
  let score = 100;
  if (travel !== null) {
    score -= travel * 0.5;
    reasons.push(`حدود ${Math.round(distance!)} کیلومتر (${travel} دقیقه)`);
  }
  score -= t.day_tasks * 5;
  if (t.day_tasks) reasons.push(`${t.day_tasks} کار دیگر در آن روز`);
  score += gap.surplus * 2;
  if (gap.surplus) reasons.push("سطح مهارت بیشتر از نیاز");
  if (t.contractor) score -= 3;
  return { user_id: t.user_id, feasible: blockers.length === 0, score: Math.round(score * 10) / 10, blockers, reasons, distance_km: distance === null ? null : Math.round(distance * 10) / 10, travel_minutes: travel };
}

/** Candidates best first: the feasible by score, then the infeasible by how few blockers they have. */
export function rankCandidates(task: TaskFacts, techs: readonly TechFacts[], opts: { today: string; speed?: number; roadFactor?: number }): CandidateScore[] {
  return techs
    .map((t) => scoreCandidate(task, t, opts))
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || (a.feasible ? b.score - a.score : a.blockers.length - b.blockers.length || b.score - a.score));
}

/** Pairs of a technician's tasks whose scheduled spans overlap (ids). */
export function clashes(items: readonly { id: string; start: number | null; end: number | null }[]): [string, string][] {
  const xs = items.filter((x) => x.start !== null && x.end !== null).sort((a, b) => a.start! - b.start!);
  const out: [string, string][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length && xs[j].start! < xs[i].end!; j++) out.push([xs[i].id, xs[j].id]);
  return out;
}

// ----- routes (FSM-008) -------------------------------------------------------------------------------------------------

export interface Stop {
  id: string;
  point: Point | null;
}

/**
 * The order of a day's visits by nearest neighbour from the origin (stops without coordinates keep their place at the
 * end), with the leg distances and drive times.
 */
export function routeOrder(origin: Point | null, stops: readonly Stop[], opts: { speed?: number; roadFactor?: number } = {}): { order: string[]; legs: { id: string; km: number | null; minutes: number | null }[]; total_km: number; total_minutes: number } {
  const located = stops.filter((s) => s.point);
  const rest = stops.filter((s) => !s.point);
  const order: Stop[] = [];
  let here = origin ?? located[0]?.point ?? null;
  const left = [...located];
  while (left.length) {
    let best = 0;
    if (here) {
      let bestKm = Infinity;
      left.forEach((s, i) => {
        const km = haversineKm(here!, s.point!);
        if (km < bestKm) {
          bestKm = km;
          best = i;
        }
      });
    }
    const [next] = left.splice(best, 1);
    order.push(next);
    here = next.point;
  }
  order.push(...rest);
  let prev = origin;
  let totalKm = 0;
  let totalMin = 0;
  const legs = order.map((s) => {
    const km = prev && s.point ? haversineKm(prev, s.point) : null;
    const minutes = km === null ? null : travelMinutes(km, opts.speed, opts.roadFactor);
    if (km !== null) totalKm += km;
    if (minutes !== null) totalMin += minutes;
    if (s.point) prev = s.point;
    return { id: s.id, km: km === null ? null : Math.round(km * 10) / 10, minutes };
  });
  return { order: order.map((s) => s.id), legs, total_km: Math.round(totalKm * 10) / 10, total_minutes: totalMin };
}

/** A navigation link for a destination in the chosen app (Iranian map services first). */
export function mapLink(provider: string, p: Point): string {
  const lat = p.lat.toFixed(6);
  const lng = p.lng.toFixed(6);
  switch (provider) {
    case "balad":
      return `https://balad.ir/location?latitude=${lat}&longitude=${lng}&zoom=16`;
    case "google":
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    case "osm":
      return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    default:
      return `https://neshan.org/maps/@${lat},${lng},16z,0p`;
  }
}

// ----- appointment slots (FSM-014) ------------------------------------------------------------------------------------

export interface Slot extends Span {
  /** how many technicians could take it (never who) */
  capacity: number;
}

/**
 * Free slots of `duration` minutes on a `step`-minute grid: a slot is offered when at least one technician has working
 * time covering it (with `buffer` minutes before it for travel) and no booked task overlapping it or its buffer.
 * The answer carries capacity only — never a technician's name or location.
 */
export function freeSlots(people: readonly { working: Span[]; busy: Span[] }[], opts: { from: number; to: number; duration: number; buffer?: number; step?: number; max?: number }): Slot[] {
  const step = Math.max(15, opts.step ?? 30) * MINUTE;
  const dur = Math.max(15, opts.duration) * MINUTE;
  const buf = Math.max(0, opts.buffer ?? 30) * MINUTE;
  const out: Slot[] = [];
  const first = Math.ceil(opts.from / step) * step;
  for (let s = first; s + dur <= opts.to && out.length < (opts.max ?? 40); s += step) {
    const span = { start: s, end: s + dur };
    const need = { start: s - buf, end: s + dur };
    const capacity = people.filter((p) => p.working.some((w) => w.start <= span.start && span.end <= w.end) && !p.busy.some((b) => b.start < need.end && need.start < b.end + buf)).length;
    if (capacity) out.push({ ...span, capacity });
  }
  return out;
}

// ----- maintenance plans (FSM-026, ESM-031) ---------------------------------------------------------------------------

/** The due date after `date` for a plan repeating every `n` units (months and years on the Jalali calendar). */
export function nextDue(date: string, n: number, unit: string): string {
  const k = Math.max(1, Math.trunc(n || 1));
  if (unit === "day") return addDays(date, k);
  if (unit === "week") return addDays(date, 7 * k);
  const j = toJalali(date);
  const months = unit === "year" ? 12 * k : k;
  const total = j.jy * 12 + (j.jm - 1) + months;
  const jy = Math.floor(total / 12);
  const jm = (total % 12) + 1;
  return fromJalali(jy, jm, Math.min(j.jd, monthLength(jy, jm)));
}

/**
 * The occurrences of a plan to generate on `today`: from its next due date, those whose lead time has begun, at most
 * `horizon` of them (editing a plan changes only occurrences not generated yet).
 */
export function dueOccurrences(plan: { next_due: string; every_n: number; interval_unit: string; lead_days: number; horizon: number }, today: string): string[] {
  const out: string[] = [];
  let due = plan.next_due;
  for (let i = 0; i < Math.max(1, plan.horizon) && i < 24; i++) {
    if (addDays(due, -Math.max(0, plan.lead_days)) > today) break;
    out.push(due);
    due = nextDue(due, plan.every_n, plan.interval_unit);
  }
  return out;
}

// ----- checklists (FSM-021) ---------------------------------------------------------------------------------------------

export interface ChecklistItem {
  key: string;
  label: string;
  type: "bool" | "text" | "number" | "choice";
  required?: boolean;
  options?: string[];
}

export function parseChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).label === "string")
    .map((x, i) => ({
      key: typeof x.key === "string" && x.key ? x.key : `q${i + 1}`,
      label: String(x.label),
      type: (["bool", "text", "number", "choice"].includes(String(x.type)) ? x.type : "bool") as ChecklistItem["type"],
      required: x.required !== false,
      options: Array.isArray(x.options) ? x.options.map(String) : undefined,
    }));
}

/** The required checklist items still unanswered (a yes/no item must be ticked). */
export function checklistMissing(items: readonly ChecklistItem[], answers: Record<string, unknown> | null | undefined): ChecklistItem[] {
  const a = answers ?? {};
  return items.filter((it) => {
    if (!it.required) return false;
    const v = a[it.key];
    if (it.type === "bool") return v !== true;
    return v === null || v === undefined || String(v).trim() === "";
  });
}

// ----- KPIs (FSM-030) -------------------------------------------------------------------------------------------------

export interface TaskFact {
  work_order_id: string;
  state: string;
  visit_no?: number | null;
  created_at?: string | null;
  dispatched_at?: string | null;
  arrived_at?: string | null;
  sla_due?: string | null;
  travel_minutes?: number | null;
  work_minutes?: number | null;
  window_start?: string | null;
  window_end?: string | null;
}

const ms = (v: unknown) => (typeof v === "string" && v ? Date.parse(v) : NaN);

/** First-time fix, on-time arrival, schedule adherence, mean time to dispatch, travel ratio. */
export function fieldKpis(tasks: readonly TaskFact[]): { completed: number; first_time_fix: number | null; on_time_arrival: number | null; schedule_adherence: number | null; mean_dispatch_minutes: number | null; travel_ratio: number | null } {
  const done = tasks.filter((t) => t.state === "work_complete" || t.state === "closed");
  const byWo = new Map<string, TaskFact[]>();
  for (const t of done) byWo.set(t.work_order_id, [...(byWo.get(t.work_order_id) ?? []), t]);
  const wos = [...byWo.values()];
  const ftf = wos.length ? wos.filter((xs) => xs.length === 1 && Number(xs[0].visit_no ?? 1) <= 1).length / wos.length : null;
  const arrived = tasks.filter((t) => t.arrived_at);
  const withTarget = arrived.filter((t) => t.sla_due);
  const onTime = withTarget.length ? withTarget.filter((t) => ms(t.arrived_at) <= ms(t.sla_due)).length / withTarget.length : null;
  const windowed = arrived.filter((t) => t.window_start && t.window_end);
  const adherence = windowed.length ? windowed.filter((t) => ms(t.arrived_at) >= ms(t.window_start) && ms(t.arrived_at) <= ms(t.window_end)).length / windowed.length : null;
  const dispatched = tasks.filter((t) => t.dispatched_at && t.created_at);
  const meanDispatch = dispatched.length ? dispatched.reduce((s, t) => s + (ms(t.dispatched_at) - ms(t.created_at)) / MINUTE, 0) / dispatched.length : null;
  const travel = done.reduce((s, t) => s + Number(t.travel_minutes ?? 0), 0);
  const work = done.reduce((s, t) => s + Number(t.work_minutes ?? 0), 0);
  const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
  return {
    completed: done.length,
    first_time_fix: pct(ftf),
    on_time_arrival: pct(onTime),
    schedule_adherence: pct(adherence),
    mean_dispatch_minutes: meanDispatch === null ? null : Math.round(meanDispatch),
    travel_ratio: travel + work > 0 ? pct(travel / (travel + work)) : null,
  };
}
