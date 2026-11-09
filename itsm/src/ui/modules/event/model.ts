// Pure logic of the event screens (tested in tests/event-ui.test.ts): labels and tones, the console's flat order for
// keyboard navigation and its key map, relative times and durations in Persian, and the on-call calendar's items.
import { ALERT_SEVERITIES, ALERT_STATES, ESCALATION_STATES, NOISE_LABELS, ESCALATION_TARGETS } from "@shared/tables/event";
import { COLOR_KEYS } from "@shared/model/types";
import type { ConsoleAlert, ConsoleGroup, ConsoleView, ShiftsView } from "@shared/event/api";

const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v ?? "");
export const severityLabel = (s: unknown) => label(ALERT_SEVERITIES, s);
export const stateLabel = (s: unknown) => label(ALERT_STATES.states, s);
export const escalationLabel = (s: unknown) => label(ESCALATION_STATES, s);
export const noiseLabelText = (s: unknown) => label(NOISE_LABELS, s);
export const targetLabel = (s: unknown) => label(ESCALATION_TARGETS, s);

/** The chip tone of a severity (status is quiet: a dot and a word). */
export function severityTone(s: unknown): "danger" | "warning" | "accent" | "neutral" {
  if (s === "critical" || s === "major") return "danger";
  if (s === "minor") return "warning";
  if (s === "warning") return "accent";
  return "neutral";
}

const OPEN = ["open", "acknowledged", "flapping", "snoozed", "maintenance"];
export const isOpenState = (s: unknown) => OPEN.includes(String(s));
export const canAck = (s: unknown) => ["open", "flapping", "snoozed", "maintenance"].includes(String(s));

/** One row of the console in its keyboard order: a group header or an alert (inside its group when expanded). */
export type ConsoleRow = { kind: "group"; id: string; group: ConsoleGroup } | { kind: "alert"; id: string; alert: ConsoleAlert; groupId: string | null };

/** The console's rows in display order: groups (worst first) with their alerts when expanded, then lone alerts. */
export function consoleRows(view: ConsoleView | undefined, expanded: ReadonlySet<string>): ConsoleRow[] {
  if (!view) return [];
  const rank = (s: string) => Math.max(0, ALERT_SEVERITIES.findIndex((o) => o.value === s));
  const groups = [...view.groups].sort((a, b) => rank(a.severity) - rank(b.severity) || String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")));
  const out: ConsoleRow[] = [];
  for (const g of groups) {
    out.push({ kind: "group", id: g.id, group: g });
    if (expanded.has(g.id)) for (const a of g.alerts) out.push({ kind: "alert", id: a.id, alert: a, groupId: g.id });
  }
  for (const a of view.alerts) out.push({ kind: "alert", id: a.id, alert: a, groupId: null });
  return out;
}

export type ConsoleKey = "next" | "prev" | "open" | "ack" | "take" | "incident" | "close" | "snooze" | "select" | "search" | "toggle";

/** The console's key map by physical key (works on the Persian layout too). */
export const CONSOLE_KEYMAP: Record<string, ConsoleKey> = {
  KeyJ: "next",
  ArrowDown: "next",
  KeyK: "prev",
  ArrowUp: "prev",
  Enter: "open",
  KeyA: "ack",
  KeyS: "take",
  KeyI: "incident",
  KeyC: "close",
  KeyZ: "snooze",
  KeyX: "select",
  Slash: "search",
  KeyG: "toggle",
};

export const KEY_HELP: [string, string][] = [
  ["J / K", "هشدار بعدی و قبلی"],
  ["Enter", "باز کردن"],
  ["A", "تأیید"],
  ["S", "برعهده گرفتن"],
  ["I", "ساخت رخداد"],
  ["C", "بستن"],
  ["Z", "تعویق یک ساعته"],
  ["X", "انتخاب"],
  ["G", "باز و بسته کردن گروه"],
  ["/", "جست‌وجو"],
];

/** The action of a key event, or null (never while typing in a field or with modifiers). */
export function keyAction(e: { code: string; key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown }): ConsoleKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(String(t.tagName ?? "").toUpperCase()))) return null;
  return CONSOLE_KEYMAP[e.code] ?? null;
}

const nf = (n: number) => n.toLocaleString("fa-IR");

/** «۵ دقیقه پیش», «۲ ساعت پیش», «۳ روز پیش». */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "همین حالا";
  const m = Math.round(s / 60);
  if (m < 60) return `${nf(m)} دقیقه پیش`;
  const h = Math.round(m / 60);
  if (h < 48) return `${nf(h)} ساعت پیش`;
  return `${nf(Math.round(h / 24))} روز پیش`;
}

/** «۲ ساعت و ۵ دقیقه» (milliseconds); empty for null. */
export function durationText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  if (ms < 60_000) return `${nf(Math.max(0, Math.round(ms / 1000)))} ثانیه`;
  const total = Math.round(ms / 60_000);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts = [d ? `${nf(d)} روز` : "", h ? `${nf(h)} ساعت` : "", m ? `${nf(m)} دقیقه` : ""].filter(Boolean);
  return parts.slice(0, 2).join(" و ");
}

/** A stable palette colour per person (the kit's named colours, never hex). */
export function personColor(userId: string | null | undefined): string {
  if (!userId) return "gray";
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const palette = COLOR_KEYS.filter((c) => c !== "gray" && c !== "red");
  return palette[h % palette.length];
}

export interface CalendarItem {
  id: string;
  start: string;
  end: string;
  label: string;
  color?: string;
  tone?: "danger" | "warning" | null;
  title?: string;
}

/** The final layer of a schedule as timeline items: one bar per shift (by person), coverage gaps in red. */
export function shiftItems(view: ShiftsView | undefined): CalendarItem[] {
  if (!view) return [];
  const name = (u: string | null) => (u ? view.display[u] || "عضو" : "");
  const out: CalendarItem[] = view.final.map((s, i) =>
    s.user_id
      ? { id: `s${i}`, start: s.start, end: s.end, label: `${name(s.user_id)}${s.override_id ? " (جایگزین)" : ""}`, color: personColor(s.user_id), title: `${name(s.user_id)}${s.override_id ? " — جایگزینی" : s.layer ? ` — لایهٔ ${nf(s.layer)}` : ""}` }
      : { id: `g${i}`, start: s.start, end: s.end, label: "خلأ پوشش", tone: "danger" as const, title: "در این بازه کسی کشیک نیست" },
  );
  return out;
}

/** The items of one rotation layer (its own turns, restriction included). */
export function layerItems(view: ShiftsView | undefined, rotationId: string): CalendarItem[] {
  const layer = view?.layers.find((l) => l.rotation_id === rotationId);
  if (!layer || !view) return [];
  return layer.shifts.map((s, i) => ({ id: `${rotationId}:${i}`, start: s.start, end: s.end, label: view.display[s.user_id ?? ""] || "عضو", color: personColor(s.user_id) }));
}

/** Who is on call at `t` in a shifts view (the final layer), or null. */
export function onCallAtView(view: ShiftsView | undefined, t: number): string | null {
  const s = view?.final.find((x) => Date.parse(x.start) <= t && t < Date.parse(x.end));
  return s?.user_id ?? null;
}

/** Hours of coverage per person over the view (for the fairness strip under the calendar). */
export function hoursPerPerson(view: ShiftsView | undefined): { user_id: string; hours: number }[] {
  const m = new Map<string, number>();
  for (const s of view?.final ?? []) if (s.user_id) m.set(s.user_id, (m.get(s.user_id) ?? 0) + (Date.parse(s.end) - Date.parse(s.start)) / 3600_000);
  return [...m].map(([user_id, hours]) => ({ user_id, hours: Math.round(hours * 10) / 10 })).sort((a, b) => b.hours - a.hours);
}

/** The alert's age line on the console: «۱۲ رویداد · نخست ۲ ساعت پیش · آخرین ۵ دقیقه پیش». */
export function seenLine(a: Pick<ConsoleAlert, "event_count" | "first_seen_at" | "last_seen_at">, now = Date.now()): string {
  const parts = [`${nf(Number(a.event_count) || 1)} رویداد`];
  if (a.first_seen_at) parts.push(`نخست ${ago(a.first_seen_at, now)}`);
  if (a.last_seen_at && a.last_seen_at !== a.first_seen_at) parts.push(`آخرین ${ago(a.last_seen_at, now)}`);
  return parts.join(" · ");
}
