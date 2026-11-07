// Pure logic of the notification screens (tests/notify-ui.test.ts): the notification center's day groups and snooze
// times, the preference matrix (opt-outs per event and channel), the rule list's recipient sentence and the template
// editor's placeholder list. No React, no antd.
import {
  COMMON_PLACEHOLDERS, NOTIFY_CHANNELS, RECIPIENT_FLAGS, localMinutes,
  type NotifyChannel, type NotifyEvent, type NotifyPrefs, type RecipientFlag, type RecipientSpec,
} from "@shared/notify";
import type { FieldDef, TableDef } from "@shared/model/types";
import type { Cond, Leaf } from "@shared/model/conditions";
import { faDigits } from "@shared/format";

// ----- the notification center ----------------------------------------------------------------------------------

export type DayGroup = "today" | "yesterday" | "week" | "older";
export const DAY_GROUP_LABELS: Record<DayGroup, string> = { today: "امروز", yesterday: "دیروز", week: "هفتهٔ گذشته", older: "پیش‌تر" };

/** The local calendar day of an instant (days since 1970-01-01 in the time zone). */
export function localDay(at: Date, tz: string): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

export function dayGroup(iso: string, now: Date, tz: string): DayGroup {
  const d = localDay(now, tz) - localDay(new Date(iso), tz);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return "week";
  return "older";
}

/** Items (newest first) in day groups, in order; empty groups left out. */
export function groupByDay<T extends { shown_at: string }>(items: T[], now: Date, tz: string): { key: DayGroup; label: string; items: T[] }[] {
  const out: { key: DayGroup; label: string; items: T[] }[] = [];
  for (const it of items) {
    const key = dayGroup(it.shown_at, now, tz);
    let g = out.find((x) => x.key === key);
    if (!g) out.push((g = { key, label: DAY_GROUP_LABELS[key], items: [] }));
    g.items.push(it);
  }
  return out;
}

export interface SnoozeOption {
  key: string;
  label: string;
  minutes: number;
}

/** «بعداً یادآوری کن»: an hour, three hours, tomorrow at 8 and Saturday (the week's first day) at 8, local time. */
export function snoozeOptions(now: Date, tz: string): SnoozeOption[] {
  const nowMin = localMinutes(now, tz);
  const toMorning = 1440 - nowMin + 8 * 60; // the next calendar day, 08:00
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const fromSaturday = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(weekday);
  const daysToSaturday = 7 - Math.max(0, fromSaturday); // Saturday itself: the next one
  return [
    { key: "1h", label: "یک ساعت دیگر", minutes: 60 },
    { key: "3h", label: "سه ساعت دیگر", minutes: 180 },
    { key: "tomorrow", label: "فردا ساعت ۸", minutes: toMorning },
    { key: "week", label: "شنبه ساعت ۸", minutes: (daysToSaturday - 1) * 1440 + toMorning },
  ];
}

/** The badge text: «۹۹+» past 99, nothing at 0. */
export const badgeText = (n: number): string => (n <= 0 ? "" : n > 99 ? `${faDigits("99")}+` : faDigits(String(n)));

// ----- preferences ----------------------------------------------------------------------------------------------

/** Rows of the preference matrix: every event, `*` («همهٔ اعلان‌ها») first. */
export type PrefRow = NotifyEvent | "*";

/** Does the person receive this event on this channel (not switched off for it, nor for every event)? */
export function receives(prefs: Pick<NotifyPrefs, "optouts">, event: PrefRow, channel: NotifyChannel): boolean {
  if (prefs.optouts.includes(`*:${channel}`)) return false;
  return event === "*" || !prefs.optouts.includes(`${event}:${channel}`);
}

/**
 * Switch one cell. Turning a channel off for every event (`*`) keeps the per-event choices underneath, so turning
 * it back on restores them; turning one event on while the whole channel is off is not possible (the cell is off
 * and disabled in the matrix).
 */
export function setReceive(prefs: NotifyPrefs, event: PrefRow, channel: NotifyChannel, on: boolean): NotifyPrefs {
  const key = `${event}:${channel}`;
  const set = new Set(prefs.optouts);
  if (on) set.delete(key);
  else set.add(key);
  return { ...prefs, optouts: [...set].sort() };
}

/** Quiet time as two "HH:MM" strings, both or neither. */
export function quietProblem(from: string | null, to: string | null): string | null {
  const ok = (s: string | null) => !s || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  if (!ok(from) || !ok(to)) return "ساعت را به شکل ۲۲:۰۰ وارد کنید";
  if (!!from !== !!to) return "آغاز و پایان سکوت هر دو لازم است";
  if (from && from === to) return "آغاز و پایان سکوت یکی است";
  return null;
}

// ----- rules ------------------------------------------------------------------------------------------------------

/** Field types a rule can take recipients from. */
export const RECIPIENT_FIELD_TYPES = new Set(["user", "users", "group"]);

export const recipientFields = (def: Pick<TableDef, "fields"> | undefined): FieldDef[] =>
  (def?.fields ?? []).filter((f) => RECIPIENT_FIELD_TYPES.has(f.type) && !f.hidden);

export interface RecipientLabels {
  field?: (name: string) => string | undefined;
  user?: (id: string) => string | undefined;
  group?: (id: string) => string | undefined;
  role?: (key: string) => string | undefined;
}

/** The parts of a rule's «گیرندگان» sentence: «کارشناس رکورد»، «فیلد مدیر تأیید»، «۳ عضو»… */
export function recipientParts(r: RecipientSpec, labels: RecipientLabels = {}): string[] {
  const out: string[] = [];
  for (const k of Object.keys(RECIPIENT_FLAGS) as RecipientFlag[]) if (r[k]) out.push(RECIPIENT_FLAGS[k]);
  for (const f of r.fields ?? []) out.push(`فیلد «${labels.field?.(f) ?? f}»`);
  const named = (ids: string[] | undefined, label: ((id: string) => string | undefined) | undefined, noun: string) => {
    const list = ids ?? [];
    if (!list.length) return;
    const names = list.map((id) => label?.(id)).filter((x): x is string => !!x);
    if (names.length === list.length && list.length <= 2) out.push(...names);
    else out.push(`${faDigits(String(list.length))} ${noun}`);
  };
  named(r.users, labels.user, "عضو");
  named(r.groups, labels.group, "گروه");
  for (const k of r.roles ?? []) out.push(`نقش «${labels.role?.(k) ?? k}»`);
  return out;
}

export const channelLabels = (channels: string[]): string[] => channels.map((c) => NOTIFY_CHANNELS[c as NotifyChannel]?.label ?? c);

/** Is the rule's table a record table a rule may watch (not virtual, not the service's own tables)? */
export const ruleTableOk = (def: Pick<TableDef, "key" | "virtual" | "module">): boolean => !def.virtual && def.module !== "notify";

// ----- templates --------------------------------------------------------------------------------------------------

export interface Placeholder {
  /** what goes between the braces */
  path: string;
  label: string;
  group: "common" | "field";
}

const DISPLAYED = new Set(["ref", "refs", "user", "users", "group", "choice", "multichoice"]);

/** Placeholders the template editor offers: the common ones, then the table's fields (`.display` for references). */
export function placeholdersFor(def: Pick<TableDef, "fields"> | undefined): Placeholder[] {
  const out: Placeholder[] = COMMON_PLACEHOLDERS.map((p) => ({ ...p, group: "common" as const }));
  for (const f of def?.fields ?? []) {
    if (f.hidden || f.type === "secret" || f.type === "json") continue;
    out.push({ path: f.name, label: f.label, group: "field" });
    if (DISPLAYED.has(f.type) && f.type !== "choice" && f.type !== "multichoice") out.push({ path: `${f.name}.display`, label: `${f.label} (نام)`, group: "field" });
  }
  return out;
}

/** The text a placeholder inserts. */
export const placeholderTag = (path: string): string => `{{${path}}}`;

/** Inserts `text` into `value` at the caret (or at the end), returning the new value and the caret after it. */
export function insertAt(value: string, text: string, caret: number | null | undefined): { value: string; caret: number } {
  const at = caret === null || caret === undefined || caret < 0 || caret > value.length ? value.length : caret;
  return { value: value.slice(0, at) + text + value.slice(at), caret: at + text.length };
}

// ----- a rule's condition: the builder's part and the «تغییر» trigger ---------------------------------------------

/** Operators that compare with the record before the change (rules only; the list filter builder leaves them out). */
export const CHANGE_OPS = ["changed", "changes_to", "changes_from"] as const;
export type ChangeOp = (typeof CHANGE_OPS)[number];
export const CHANGE_OP_LABELS: Record<ChangeOp, string> = { changed: "تغییر کرد", changes_to: "تغییر کرد به", changes_from: "تغییر کرد از" };

const isLeaf = (c: Cond): c is Leaf => !!c && typeof c === "object" && "f" in c && "op" in c;
const isChange = (c: Cond): c is Leaf => isLeaf(c) && (CHANGE_OPS as readonly string[]).includes(c.op);
const hasChange = (c: Cond): boolean =>
  isChange(c) || ("and" in c && c.and.some(hasChange)) || ("or" in c && c.or.some(hasChange)) || ("not" in c && hasChange(c.not));

/**
 * A stored condition as the editor shows it: the change trigger (one `changed`/`changes_to`/`changes_from` leaf at
 * the top, alone or in the top «و») and the rest for the builder. `complex`: change operators elsewhere (written
 * through the API) — the editor then keeps the condition as it is.
 */
export function splitChange(c: Cond | null | undefined): { base: Cond | null; change: Leaf | null; complex: boolean } {
  if (!c || (typeof c === "object" && !Object.keys(c).length)) return { base: null, change: null, complex: false };
  if (isChange(c)) return { base: null, change: c, complex: false };
  if ("and" in c) {
    const i = c.and.findIndex(isChange);
    if (i >= 0) {
      const rest = c.and.filter((_, j) => j !== i);
      if (rest.some(hasChange)) return { base: c, change: null, complex: true };
      return { base: rest.length === 0 ? null : rest.length === 1 ? rest[0] : { and: rest }, change: c.and[i] as Leaf, complex: false };
    }
  }
  return { base: c, change: null, complex: hasChange(c) };
}

/** The condition stored for a builder part and a change trigger. */
export function joinChange(base: Cond | null, change: Leaf | null): Cond | null {
  if (!change) return base;
  if (!base) return change;
  return "and" in base ? { and: [...base.and, change] } : { and: [base, change] };
}
