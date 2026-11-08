// Pure logic of incident management, shared by the server (hooks, services, jobs) and the screens: lexical
// similarity of incidents and known errors (the AI layer's semantic search replaces the candidates later, the
// scoring explains them), the major-incident criteria, the update cadence, the reopen window, the timeline of a major
// incident and the draft of its post-incident review, canned-response placeholders and template parameters.
// No server or UI imports.
import { normalizeSearch } from "../model/conditions";
import type { IncidentConfig } from "../tables/incident";
import { shiftsOf, type BusinessCalendar } from "../sla/calendar";
import { addDays } from "../jalali";

// ---------------------------------------------------------------------------------------------------------------
// Words and similarity

/** Persian and English words that say nothing about a fault. */
const STOP = new Set(
  (
    "از به با در که این آن را و یا تا بر برای های ها هم نیز شد شده شود می نمی است نیست هست بود دارد ندارد کرد کرده کند " +
    "یک دو سه من ما شما او آنها ایشان لطفا لطفاً سلام ممنون مشکل خطا کار نمیشه نمی‌شود نمیشود هستم داریم باشد " +
    "the a an and or of to in on for is are was not no with my our we i it this that please error issue problem"
  ).split(" "),
);

/** Normalised words of a text (Persian typing differences folded, punctuation dropped, short and stop words out). */
export function words(text: unknown): string[] {
  const s = normalizeSearch(String(text ?? "")).toLowerCase().replace(/[‌‏‎]/g, " ");
  const out: string[] = [];
  for (const w of s.split(/[^\p{L}\p{N}_.-]+/u)) {
    const t = w.replace(/^[.\-_]+|[.\-_]+$/g, "");
    if (t.length < 2 || STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** Jaccard overlap of two word sets (0–1). */
export function overlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

export interface IncidentLike {
  id?: string;
  short_description?: string | null;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  ci_id?: string | null;
  service_id?: string | null;
  caller_id?: string | null;
  opened_at?: string | null;
}

export interface Match {
  score: number;
  /** why it matched, in Persian, strongest first */
  reasons: string[];
}

const DAY = 86_400_000;

/**
 * How similar incident `b` is to `a` (0–100): the words of the titles (and descriptions, weaker), the same
 * configuration item, service, category and subcategory, and the same caller within two weeks (a likely duplicate).
 */
export function similarity(a: IncidentLike, b: IncidentLike): Match {
  const reasons: string[] = [];
  let score = 0;
  const title = overlap(words(a.short_description), words(b.short_description));
  const text = overlap(words(`${a.short_description ?? ""} ${a.description ?? ""}`), words(`${b.short_description ?? ""} ${b.description ?? ""}`));
  const w = Math.max(title, text * 0.8);
  if (w > 0) {
    score += Math.round(w * 55);
    if (w >= 0.3) reasons.push("عنوان و شرح نزدیک");
  }
  if (a.ci_id && a.ci_id === b.ci_id) {
    score += 20;
    reasons.push("همان پیکربندی");
  }
  if (a.service_id && a.service_id === b.service_id) {
    score += 8;
    reasons.push("همان خدمت");
  }
  if (a.subcategory && a.subcategory === b.subcategory) {
    score += 10;
    reasons.push("همان زیردسته");
  } else if (a.category && a.category === b.category) {
    score += 5;
    reasons.push("همان دسته");
  }
  if (a.caller_id && a.caller_id === b.caller_id && a.opened_at && b.opened_at && Math.abs(Date.parse(a.opened_at) - Date.parse(b.opened_at)) <= 14 * DAY) {
    score += 12;
    reasons.push("همان درخواست‌دهنده در دو هفتهٔ اخیر");
  }
  return { score: Math.min(100, score), reasons };
}

export interface KnownErrorLike {
  short_description?: string | null;
  symptoms?: string | null;
  workaround?: string | null;
  category?: string | null;
  subcategory?: string | null;
  ci_id?: string | null;
  service_id?: string | null;
  affected_cis?: string[] | null;
}

/** How well a known error fits an incident (0–100): its symptoms and title against the incident's words, CI, service, category. */
export function knownErrorMatch(i: IncidentLike, ke: KnownErrorLike): Match {
  const reasons: string[] = [];
  let score = 0;
  const iw = words(`${i.short_description ?? ""} ${i.description ?? ""}`);
  const w = Math.max(overlap(iw, words(ke.short_description)), overlap(iw, words(`${ke.short_description ?? ""} ${ke.symptoms ?? ""}`)) * 1.2);
  if (w > 0) {
    score += Math.round(Math.min(1, w) * 60);
    if (w >= 0.2) reasons.push("نشانه‌های مشابه");
  }
  if (i.ci_id && (i.ci_id === ke.ci_id || (ke.affected_cis ?? []).includes(i.ci_id))) {
    score += 20;
    reasons.push("همان پیکربندی");
  }
  if (i.service_id && i.service_id === ke.service_id) {
    score += 8;
    reasons.push("همان خدمت");
  }
  if (i.subcategory && i.subcategory === ke.subcategory) {
    score += 12;
    reasons.push("همان زیردسته");
  } else if (i.category && i.category === ke.category) {
    score += 6;
    reasons.push("همان دسته");
  }
  return { score: Math.min(100, score), reasons };
}

/** Similar hits worth showing (a weak word overlap alone is noise). */
export const SIMILAR_MIN = 25;

// ---------------------------------------------------------------------------------------------------------------
// Major incidents

export interface MajorLike {
  priority?: string | null;
  affected_users?: string[] | null;
  major_state?: string | null;
  security_incident?: boolean | null;
}

/** Why an incident meets the major-incident criteria (a Persian reason), or null. Only for incidents not yet in the overlay. */
export function majorCandidate(cfg: Pick<IncidentConfig, "mi_candidate_priorities" | "mi_candidate_affected">, row: MajorLike): string | null {
  if (row.major_state) return null;
  const reasons: string[] = [];
  if (row.priority && (cfg.mi_candidate_priorities ?? []).includes(String(row.priority))) reasons.push(`اولویت ${row.priority}`);
  const affected = (row.affected_users ?? []).length;
  if (cfg.mi_candidate_affected > 0 && affected >= cfg.mi_candidate_affected) reasons.push(`${affected} کاربر متأثر`);
  return reasons.length ? `معیار رخداد عمده: ${reasons.join("، ")}` : null;
}

/** Overlay values from which each major-incident action may start. */
export const MAJOR_ACTIONS: Record<"propose" | "declare" | "reject" | "downgrade", (string | null)[]> = {
  propose: [null, "", "candidate", "rejected", "downgraded"],
  declare: [null, "", "candidate", "proposed", "rejected", "downgraded"],
  reject: ["candidate", "proposed"],
  downgrade: ["accepted"],
};

export const majorActionAllowed = (action: keyof typeof MAJOR_ACTIONS, state: string | null | undefined): boolean => MAJOR_ACTIONS[action].includes(state ?? null);

/** When the next stakeholder update is due (null: no cadence). */
export function nextUpdateAt(fromIso: string | null | undefined, cadenceMinutes: number | null | undefined): string | null {
  const m = Number(cadenceMinutes ?? 0);
  if (!fromIso || !Number.isFinite(m) || m <= 0) return null;
  const t = Date.parse(fromIso);
  return Number.isNaN(t) ? null : new Date(t + m * 60_000).toISOString();
}

// ---------------------------------------------------------------------------------------------------------------
// Reopening

/** May a resolved incident still be reopened (inside the window)? A window of 0 days has no limit. */
export function reopenAllowed(resolvedAt: string | null | undefined, windowDays: number, now = Date.now()): boolean {
  if (!windowDays || windowDays <= 0 || !resolvedAt) return true;
  const t = Date.parse(resolvedAt);
  return Number.isNaN(t) || now - t <= windowDays * DAY;
}

// ---------------------------------------------------------------------------------------------------------------
// The timeline of a major incident

export type TimelineKind = "detection" | "declaration" | "state" | "priority" | "assignment" | "communication" | "decision" | "action" | "note" | "child" | "sla" | "bridge" | "role";

export const TIMELINE_KINDS: Record<TimelineKind, { label: string; color: string }> = {
  detection: { label: "تشخیص", color: "orange" },
  declaration: { label: "اعلام", color: "red" },
  state: { label: "وضعیت", color: "teal" },
  priority: { label: "اولویت", color: "gold" },
  assignment: { label: "ارجاع", color: "blue" },
  communication: { label: "اطلاع‌رسانی", color: "purple" },
  decision: { label: "تصمیم", color: "indigo" },
  action: { label: "اقدام", color: "green" },
  note: { label: "یادداشت", color: "gray" },
  child: { label: "رخداد فرزند", color: "blue" },
  sla: { label: "توافق", color: "red" },
  bridge: { label: "جلسهٔ هماهنگی", color: "teal" },
  role: { label: "نقش‌ها", color: "indigo" },
};

/** Kinds a person adds by hand («افزودن به خط زمانی»). */
export const MANUAL_KINDS: TimelineKind[] = ["detection", "decision", "action", "communication", "note"];

/** A manual item stored in the incident's `timeline` field. */
export interface StoredEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  body?: string | null;
  by?: string | null;
  /** a journal entry promoted to the timeline */
  entry_id?: string | null;
  /** a key event (shown in the executive view and the review) */
  key?: boolean;
}

export interface TimelineItem extends StoredEvent {
  source: "manual" | "history" | "journal" | "child" | "sla" | "record";
  /** a related record (a child incident) */
  ref?: { table: string; id: string; number?: string | null } | null;
  /** can be removed (manual items) */
  removable?: boolean;
}

/** Manual items of the `timeline` field, cleaned (the field is JSON: anything else is dropped). */
export function storedEvents(raw: unknown): StoredEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredEvent[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const e = x as Record<string, unknown>;
    const at = typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) ? new Date(Date.parse(e.at)).toISOString() : null;
    const kind = typeof e.kind === "string" && e.kind in TIMELINE_KINDS ? (e.kind as TimelineKind) : "note";
    const title = typeof e.title === "string" ? e.title.trim().slice(0, 300) : "";
    if (!at || !title || typeof e.id !== "string") continue;
    out.push({
      id: e.id,
      at,
      kind,
      title,
      body: typeof e.body === "string" ? e.body.slice(0, 4000) : null,
      by: typeof e.by === "string" ? e.by : null,
      entry_id: typeof e.entry_id === "string" ? e.entry_id : null,
      key: !!e.key,
    });
  }
  return out;
}

/** Oldest first; for the same instant, the order they were given in. */
export function sortTimeline<T extends { at: string }>(items: T[]): T[] {
  return items.map((x, i) => [x, i] as const).sort((a, b) => Date.parse(a[0].at) - Date.parse(b[0].at) || a[1] - b[1]).map(([x]) => x);
}

/** Problems with a manual timeline item (Persian), or null. */
export function eventProblem(e: { at?: unknown; kind?: unknown; title?: unknown; body?: unknown }, now = Date.now()): string | null {
  if (typeof e.title !== "string" || !e.title.trim()) return "عنوان رویداد را بنویسید";
  if (e.title.trim().length > 300) return "عنوان رویداد حداکثر ۳۰۰ نویسه است";
  if (e.body !== undefined && e.body !== null && (typeof e.body !== "string" || e.body.length > 4000)) return "شرح رویداد حداکثر ۴۰۰۰ نویسه است";
  if (typeof e.kind !== "string" || !MANUAL_KINDS.includes(e.kind as TimelineKind)) return "نوع رویداد معتبر نیست";
  if (e.at !== undefined && e.at !== null) {
    const t = Date.parse(String(e.at));
    if (Number.isNaN(t)) return "زمان رویداد معتبر نیست";
    if (t > now + 5 * 60_000) return "زمان رویداد در آینده است";
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The draft of a post-incident review

export interface ReviewInput {
  number: string | null;
  title: string;
  description?: string | null;
  priority?: string | null;
  opened_at?: string | null;
  detected_at?: string | null;
  resolved_at?: string | null;
  mi_declared_at?: string | null;
  business_impact?: string | null;
  close_notes?: string | null;
  workaround?: string | null;
  cause_notes?: string | null;
  children: number;
  affected_users: number;
  affected_services: string[];
  communications: number;
  /** the timeline, oldest first, with times already formatted for people */
  timeline: { when: string; kind: TimelineKind; title: string; key?: boolean }[];
  /** «۲ ساعت و ۱۵ دقیقه» */
  duration?: string | null;
}

/** The sections of a review's first draft (Markdown), filled from the incident and its timeline. */
export function reviewDraft(i: ReviewInput): Record<"title" | "summary" | "impact" | "timeline_md" | "root_cause" | "detection" | "resolution" | "lessons", string> {
  const key = i.timeline.filter((t) => t.key);
  const lines = (key.length >= 3 ? key : i.timeline).slice(0, 80).map((t) => `- **${t.when}** — ${TIMELINE_KINDS[t.kind]?.label ?? ""}: ${t.title}`);
  const impact = [
    i.business_impact?.trim() || null,
    i.affected_users ? `- کاربران متأثر ثبت‌شده: ${i.affected_users}` : null,
    i.children ? `- رخدادهای فرزند (گزارش‌های مشابه): ${i.children}` : null,
    i.affected_services.length ? `- خدمت‌های متأثر: ${i.affected_services.join("، ")}` : null,
    i.duration ? `- مدت اختلال تا حل: ${i.duration}` : null,
    i.communications ? `- اطلاع‌رسانی‌های انجام‌شده: ${i.communications}` : null,
  ].filter(Boolean);
  return {
    title: `بازبینی ${i.number ?? ""} — ${i.title}`.trim(),
    summary: [`${i.number ?? "این رخداد"}: ${i.title}`, i.description?.trim() ? `\n${i.description.trim().slice(0, 2000)}` : ""].join(""),
    impact: impact.join("\n"),
    timeline_md: lines.join("\n"),
    root_cause: i.cause_notes?.trim() || "",
    detection: i.detected_at ? `اختلال در ${i.timeline.find((t) => t.kind === "detection")?.when ?? "زمان ثبت‌شده"} تشخیص داده شد.` : "",
    resolution: [i.workaround?.trim() ? `**راه‌حل موقت:**\n${i.workaround.trim()}` : "", i.close_notes?.trim() ? `**حل:**\n${i.close_notes.trim()}` : ""].filter(Boolean).join("\n\n"),
    lessons: "",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Canned responses and templates

/** Fill `{{caller}} {{number}} {{title}} {{assignee}} {{group}} {{me}}` (unknown placeholders stay as they are). */
export function fillPlaceholders(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m));
}

/** Fields of a template that pre-fill a new incident (URL parameters of the new-record page). */
export const TEMPLATE_FIELDS = ["short_description", "description", "category", "subcategory", "channel", "impact", "urgency", "assignment_group_id", "service_id", "ci_id"] as const;

/** The new-incident parameters of a template row (empty values left out) plus `template_id`. */
export function templateParams(t: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of TEMPLATE_FIELDS) {
    const v = t[f];
    if (v !== null && v !== undefined && v !== "") out[f] = String(v);
  }
  if (typeof t.id === "string") out.template_id = t.id;
  return out;
}

export interface TemplateTask {
  short_description: string;
  description?: string | null;
  assignment_group_id?: string | null;
  mandatory?: boolean;
}

/** The tasks of a template's `tasks` JSON (invalid items dropped, at most 30). */
export function templateTasks(raw: unknown): TemplateTask[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateTask[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const t = x as Record<string, unknown>;
    const title = typeof t.short_description === "string" ? t.short_description.trim().slice(0, 200) : "";
    if (!title) continue;
    out.push({
      short_description: title,
      description: typeof t.description === "string" ? t.description : null,
      assignment_group_id: typeof t.assignment_group_id === "string" && /^[0-9a-f-]{36}$/i.test(t.assignment_group_id) ? t.assignment_group_id : null,
      mandatory: t.mandatory !== false,
    });
    if (out.length >= 30) break;
  }
  return out;
}

/** Why a template's `tasks` JSON is invalid (Persian), or null. */
export function templateTasksProblem(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return "کارهای الگو باید فهرستی از کارها باشد";
  if (raw.length > 30) return "یک الگو حداکثر ۳۰ کار دارد";
  for (const [i, x] of raw.entries()) {
    if (!x || typeof x !== "object" || typeof (x as Record<string, unknown>).short_description !== "string" || !String((x as Record<string, unknown>).short_description).trim()) {
      return `کار ${i + 1} عنوان ندارد`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Durations for people

/** «۲ روز و ۳ ساعت» / «۴۵ دقیقه» (latin digits; the UI renders them with Persian figures). */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} دقیقه`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} ساعت و ${m} دقیقه` : `${h} ساعت`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} روز و ${hh} ساعت` : `${d} روز`;
}

// ---------------------------------------------------------------------------------------------------------------
// Working days (auto-close, follow-ups, review deadlines)


/** The local ISO date of an instant in a time zone. */
export function localDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * The instant `n` working days after `start` on a calendar: the end of the n-th later local day that has working
 * time (holidays and days off skipped). Without a calendar, n × 24 hours.
 */
export function addWorkingDays(cal: BusinessCalendar | null, start: number, n: number): number {
  if (n <= 0) return start;
  if (!cal || !cal.week.some((d) => d.length)) return start + n * 86_400_000;
  let date = localDate(start, cal.tz);
  let count = 0;
  for (let i = 0; i < 3660; i++) {
    date = addDays(date, 1);
    const shifts = shiftsOf(cal, date);
    if (!shifts.length) continue;
    count++;
    if (count >= n) return Math.max(...shifts.map(([, e]) => e));
  }
  return start + n * 86_400_000;
}

// ---------------------------------------------------------------------------------------------------------------
// Outage announcements (catalogue INC-043)

export interface AnnouncementLike {
  state?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  audience?: unknown;
  groups?: unknown;
  units?: unknown;
  locations?: unknown;
  users?: unknown;
}

/** Who reads the banner: their groups, their unit with the units above it, their location, and whether they are an agent. */
export interface AudienceMember {
  userId: string;
  agent: boolean;
  groups: readonly string[];
  /** the member's unit and every unit above it */
  units: readonly string[];
  location: string | null;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Is the announcement on air at `now` (published, started, not over)? */
export function announcementActive(a: AnnouncementLike, now = Date.now()): boolean {
  if (a.state !== "published") return false;
  const from = Date.parse(String(a.starts_at ?? ""));
  const to = Date.parse(String(a.ends_at ?? ""));
  return (Number.isNaN(from) || from <= now) && (Number.isNaN(to) || to > now);
}

/** Does the announcement reach the member: everyone, agents only, or a target they belong to (group, unit tree, location, person)? */
export function announcementReaches(a: AnnouncementLike, m: AudienceMember): boolean {
  if (a.audience === "agents") return m.agent;
  if (a.audience !== "targeted") return true;
  const groups = new Set(m.groups);
  const units = new Set(m.units);
  return (
    ids(a.users).includes(m.userId) ||
    ids(a.groups).some((g) => groups.has(g)) ||
    ids(a.units).some((u) => units.has(u)) ||
    (!!m.location && ids(a.locations).includes(m.location))
  );
}

/** Why an announcement cannot be saved as it is (Persian, per field), or null. */
export function announcementProblem(a: AnnouncementLike): Record<string, string> | null {
  const out: Record<string, string> = {};
  const from = Date.parse(String(a.starts_at ?? ""));
  const to = Date.parse(String(a.ends_at ?? ""));
  if (!Number.isNaN(from) && !Number.isNaN(to) && to <= from) out.ends_at = "پایان باید پس از آغاز باشد";
  if (a.audience === "targeted" && ![a.groups, a.units, a.locations, a.users].some((v) => ids(v).length)) {
    out.audience = "دست‌کم یک گروه، واحد، مکان یا فرد را برای مخاطبان مشخص کنید";
  }
  return Object.keys(out).length ? out : null;
}
