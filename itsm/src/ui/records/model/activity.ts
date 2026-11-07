// The activity stream of a record: journal entries (public comments, internal work notes, system, e-mail, approval
// and AI entries) and field history merged into one time-ordered feed, newest first. Changes one person made in one
// save are one item; the values the record was created with are the «ایجاد» item. Filter chips: همه / عمومی /
// داخلی / سامانه. Pure: no React, no antd.
import type { HistoryEntry, JournalEntry } from "./types";

export type ActivityFilter = "all" | "public" | "internal" | "system";

export interface ActivityItem {
  key: string;
  /** ISO instant */
  at: string;
  actor: string | null;
  type: "journal" | "changes";
  entry?: JournalEntry;
  changes?: HistoryEntry[];
  /** the record's initial values */
  created?: boolean;
}

/** Saves closer than this are one item (one PATCH writes its history rows within the same transaction). */
const SAME_SAVE_MS = 2000;

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** Groups history rows into saves: same actor, written within SAME_SAVE_MS of the save's first row. */
export function groupChanges(history: readonly HistoryEntry[]): HistoryEntry[][] {
  const sorted = [...history].sort((a, b) => ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1));
  const out: HistoryEntry[][] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && last[0].actor === h.actor && ms(h.at) - ms(last[0].at) <= SAME_SAVE_MS && !last.some((x) => x.field === h.field)) last.push(h);
    else out.push([h]);
  }
  return out;
}

/** The merged feed, newest first. `createdAt` marks the record's first save as its creation. */
export function mergeActivity(journal: readonly JournalEntry[], history: readonly HistoryEntry[], createdAt?: string | null): ActivityItem[] {
  const items: ActivityItem[] = journal.map((e) => ({ key: `j:${e.id}`, at: e.created_at, actor: e.author, type: "journal", entry: e }));
  const created = createdAt ? ms(createdAt) : null;
  groupChanges(history).forEach((g, i) => {
    const first = g[0];
    const isCreate = i === 0 && created !== null && Math.abs(ms(first.at) - created) <= SAME_SAVE_MS && g.every((h) => h.old === null || h.old === undefined);
    items.push({ key: `h:${first.id}`, at: first.at, actor: first.actor, type: "changes", changes: g, ...(isCreate ? { created: true } : {}) });
  });
  // newest first; at the same instant a comment sits above the field changes of its save
  return items.sort((a, b) => ms(b.at) - ms(a.at) || (a.type === b.type ? (a.key < b.key ? 1 : -1) : a.type === "journal" ? -1 : 1));
}

/** Which chip an item answers to. */
export function activityClass(i: ActivityItem): Exclude<ActivityFilter, "all"> {
  if (i.type === "changes") return "system";
  const e = i.entry!;
  if (e.kind === "system" || e.kind === "approval" || e.kind === "ai") return "system";
  return e.visibility === "internal" ? "internal" : "public";
}

export const filterActivity = (items: readonly ActivityItem[], f: ActivityFilter): ActivityItem[] => (f === "all" ? [...items] : items.filter((i) => activityClass(i) === f));

/** Counts for the filter chips. */
export function activityCounts(items: readonly ActivityItem[]): Record<ActivityFilter, number> {
  const c: Record<ActivityFilter, number> = { all: items.length, public: 0, internal: 0, system: 0 };
  for (const i of items) c[activityClass(i)]++;
  return c;
}

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "public", label: "یادداشت‌های عمومی" },
  { key: "internal", label: "یادداشت‌های داخلی" },
  { key: "system", label: "سامانه" },
];

/** Persian name of a journal kind. */
export const JOURNAL_KIND_LABELS: Record<string, string> = {
  comment: "پاسخ به درخواست‌کننده",
  work_note: "یادداشت داخلی",
  system: "سامانه",
  email_in: "ایمیل دریافتی",
  email_out: "ایمیل ارسالی",
  approval: "تأیید",
  ai: "هوش مصنوعی",
};
