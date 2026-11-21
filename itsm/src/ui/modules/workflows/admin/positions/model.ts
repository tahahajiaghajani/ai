// The pure logic of «نقش‌های سازمانی» (design F §3.4, §8, package F5): who may do what, the list's search and chips,
// a holder's period («جاری»، «آینده»، «پایان‌یافته»), its source chip, what a holder's form sends and refuses, the
// spreadsheet rows the import sends, its result in words, and the preview's starting rule for a position. No React, no
// requests: tested in tests/workflows-admin-positions-ui.test.ts.
import type { AccessGate } from "@shared/access";
import type { StepAction, StepAssignees } from "@shared/process";
import { HOLDER_KINDS, HOLDER_SOURCES, POSITION_KEY } from "@shared/tables/positions";
import { UNIT_KINDS } from "@shared/tables/access";
import { faDigits } from "@shared/format";
import { addDays } from "@shared/jalali";
import { matchesFa } from "../../../../lib/fa";
import { ESTIMATE_GATES } from "../../kit/api";
import { defaultScope } from "../../kit/model";
import type { HolderImportResult, HolderRow, PositionOverview } from "./api";

// ---------------------------------------------------------------------------------------------------------------
// Who may (the server stays the authority)

export interface PositionsAccess {
  /** positions and holders are readable (`org` read: every built-in role but «کارشناس پیمانکار») */
  read: boolean;
  /** positions are made and changed, holders placed, changed and ended, holders imported: `org` create and write in a
   * unit or wider (team leads' «group» scope reaches no holder) */
  manage: boolean;
  /** holders are removed: `org` delete in a unit or wider — a holder row has no group, so the «group» delete of a
   * service-desk manager or a team lead reaches none (the server refuses every removal) */
  remove: boolean;
  /** the preview of a step's people: designers or keepers of the structure */
  preview: boolean;
}

export function positionsAccess({ allows, writable }: { allows: (g: AccessGate) => boolean; writable: boolean }): PositionsAccess {
  return {
    read: allows({ area: "org" }),
    manage: writable && allows({ area: "org", op: "create" }) && allows({ area: "org", op: "write", scope: "unit" }),
    remove: writable && allows({ area: "org", op: "delete", scope: "unit" }),
    preview: ESTIMATE_GATES.some((g) => allows(g)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The list

export type PositionChip = "vacant" | "ending" | "inactive";

export const POSITION_CHIPS: { key: PositionChip; label: string }[] = [
  { key: "vacant", label: "جای خالی" },
  { key: "ending", label: "پایان نزدیک" },
  { key: "inactive", label: "غیرفعال" },
];

const hasChip = (p: PositionOverview, c: PositionChip): boolean =>
  c === "vacant" ? p.holders === 0 || (p.vacancies ?? 0) > 0 : c === "ending" ? p.ending > 0 : !p.active;

/** Positions matching the search (name or key) and any of the chips. */
export function filterPositions(rows: readonly PositionOverview[], q: string, chips: readonly PositionChip[]): PositionOverview[] {
  return rows.filter((p) => (!q.trim() || matchesFa(`${p.name} ${p.key}`, q)) && (!chips.length || chips.some((c) => hasChip(p, c))));
}

export const unitKindLabel = (k: string | null | undefined): string => (k ? (UNIT_KINDS.find((o) => o.value === k)?.label ?? k) : "");

/** «۱۲ نفر در ۱۲ شعبه» — what a row's holders cover. */
export function holdersText(p: Pick<PositionOverview, "holders" | "units" | "unit_kind">): string {
  if (!p.holders) return "بی‌دارنده";
  const where = p.unit_kind ? `${faDigits(p.units)} ${unitKindLabel(p.unit_kind)}` : `${faDigits(p.units)} واحد`;
  return p.units ? `${faDigits(p.holders)} نفر در ${where}` : `${faDigits(p.holders)} نفر`;
}

/** The sources of a position's current holders, the directory's first: «AD ۳ · دستی ۱». */
export function sourcesText(s: PositionOverview["sources"]): string {
  const parts: string[] = [];
  if (s.directory) parts.push(`AD ${faDigits(s.directory)}`);
  if (s.import) parts.push(`فایل ${faDigits(s.import)}`);
  if (s.manual) parts.push(`دستی ${faDigits(s.manual)}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------------------------
// Holders

export type HolderState = "current" | "future" | "ended";

export const HOLDER_STATE_LABELS: Record<HolderState, string> = { current: "جاری", future: "آینده", ended: "پایان‌یافته" };

/** A holder's period against today (dates inclusive, YYYY-MM-DD in the organisation's zone). */
export function holderState(h: Pick<HolderRow, "valid_from" | "valid_to">, today: string): HolderState {
  if (h.valid_to && h.valid_to < today) return "ended";
  if (h.valid_from && h.valid_from > today) return "future";
  return "current";
}

/** Ends within 30 days (the overview's «پایان نزدیک»). */
export const endingSoon = (h: Pick<HolderRow, "valid_to">, today: string): boolean => !!h.valid_to && h.valid_to >= today && h.valid_to <= addDays(today, 30);

export const holderKindLabel = (k: string): string => HOLDER_KINDS.find((o) => o.value === k)?.label ?? k;
export const holderSourceLabel = (s: string): string => HOLDER_SOURCES.find((o) => o.value === s)?.label ?? s;

/** Holders a person keeps by hand are changed freely; the directory's and an import's keep their person and unit. */
export const fixedPlace = (h: Pick<HolderRow, "source">): boolean => h.source === "directory" || h.source === "import";

/** Current and future holders first (by person), ended ones last unless asked for. */
export function sortHolders(rows: readonly HolderRow[], today: string, withEnded: boolean, name: (id: string) => string): HolderRow[] {
  const rank: Record<HolderState, number> = { current: 0, future: 1, ended: 2 };
  return rows
    .filter((h) => withEnded || holderState(h, today) !== "ended")
    .sort((a, b) => rank[holderState(a, today)] - rank[holderState(b, today)] || name(a.user_id).localeCompare(name(b.user_id), "fa"));
}

export interface HolderDraft {
  user_id: string | null;
  org_unit_id: string | null;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
}

export const emptyHolder = (): HolderDraft => ({ user_id: null, org_unit_id: null, kind: "primary", valid_from: null, valid_to: null });

/** The form as it started: a holder's own values, or an empty new holder. */
export const holderStart = (h: Pick<HolderRow, "user_id" | "org_unit_id" | "kind" | "valid_from" | "valid_to"> | null): HolderDraft =>
  h ? { user_id: h.user_id, org_unit_id: h.org_unit_id, kind: h.kind, valid_from: h.valid_from, valid_to: h.valid_to } : emptyHolder();

/** Has the holder form been changed since it opened (closing the sheet then asks first: B8)? */
export function holderFormDirty(d: HolderDraft, holder: Pick<HolderRow, "user_id" | "org_unit_id" | "kind" | "valid_from" | "valid_to"> | null): boolean {
  const s = holderStart(holder);
  return (["user_id", "org_unit_id", "kind", "valid_from", "valid_to"] as const).some((k) => (d[k] ?? null) !== (s[k] ?? null));
}

/**
 * How a position's sheet closes: with unsaved changes — the position's or a half-filled holder's — closing asks first;
 * while the holder form is open the Escape key never closes the sheet (it closes a date picker's popover, B8).
 */
export function sheetClose(o: { manage: boolean; positionDirty: boolean; holderOpen: boolean; holderDirty: boolean }): { guard: boolean; keyboard: boolean } {
  return { guard: o.manage && (o.positionDirty || o.holderDirty), keyboard: !o.holderOpen };
}

/**
 * The question before a person of the demo pack becomes a holder (FINAL-1): the organisation's own cases never reach
 * them — only cases the pack's people start do.
 */
export function demoHolderQuestion(name: string | null | undefined): { title: string; content: string } {
  return {
    title: `${name ? `«${name}»` : "این شخص"} حساب نمایشی است؛ دارندهٔ این نقش شود؟`,
    content: "مرحله‌های پرونده‌های واقعی سازمان به حساب‌های نمایشی نمی‌رسد؛ این دارنده فقط کار پرونده‌هایی را می‌گیرد که حساب‌های نمایشی آغاز کنند.",
  };
}

/** Does saving the form make a person of the demo pack a holder (a new holder, or another person on an existing one)? */
export const addsDemoHolder = (d: Pick<HolderDraft, "user_id">, holder: Pick<HolderRow, "user_id"> | null, demo: ReadonlySet<string>): boolean =>
  !!d.user_id && demo.has(d.user_id.toLowerCase()) && (!holder || holder.user_id.toLowerCase() !== d.user_id.toLowerCase());

/** What the form refuses before sending (the server checks the same, and more, in Persian). */
export function holderProblems(d: HolderDraft, position: { unit_kind: string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  if (!d.user_id) out.user_id = "دارنده را برگزینید";
  if (position.unit_kind && !d.org_unit_id) out.org_unit_id = `این نقش در ${unitKindLabel(position.unit_kind)}‌ها است؛ واحد را برگزینید`;
  if (d.valid_from && d.valid_to && d.valid_from > d.valid_to) out.valid_to = "«تا تاریخ» پیش از «از تاریخ» است";
  return out;
}

/** A position's key as typed: lower-case Latin, digits and _. */
export const keyInput = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_]/g, "");
export const validKey = (s: string): boolean => POSITION_KEY.test(s);

// ---------------------------------------------------------------------------------------------------------------
// The holder import

/** The columns of the template (the server reads these headers, in Persian or English). */
export const IMPORT_HEADERS = ["کلید نقش", "ایمیل", "کد واحد", "نوع", "از تاریخ", "تا تاریخ"];

/**
 * A spreadsheet's rows as the import sends them: the first non-empty row names the columns, the rows after it become
 * objects keyed by those names (empty rows left out). The server matches the columns by their usual headers.
 */
export function sheetRows(rows: readonly (readonly unknown[])[]): { headers: string[]; rows: Record<string, string>[] } {
  const at = rows.findIndex((r) => r.some((c) => String(c ?? "").trim()));
  if (at < 0) return { headers: [], rows: [] };
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(rows[at][i] ?? "").trim() || `ستون ${i + 1}`);
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(at + 1)) {
    if (!r.some((c) => String(c ?? "").trim())) continue;
    out.push(Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])));
  }
  return { headers, rows: out };
}

/** «۱۲ تازه، ۳ به‌روز، ۲ بی‌تغییر، ۱ برداشته»; with what was left alone and the errors. */
export function importSummary(r: HolderImportResult): string {
  const parts = [`${faDigits(r.created)} تازه`, `${faDigits(r.updated)} به‌روز`, `${faDigits(r.unchanged)} بی‌تغییر`];
  if (r.removed) parts.push(`${faDigits(r.removed)} برداشته`);
  let text = parts.join("، ");
  if (r.skipped.length) text += `؛ ${faDigits(r.skipped.length)} ردیف دست نخورد`;
  if (r.errors.length) text += `؛ ${faDigits(r.errors.length)} خطا`;
  return text;
}

// ---------------------------------------------------------------------------------------------------------------
// The preview

/** The rule a preview starts from for a position: its holder up the requester's tree in a unit of its kind; anywhere
 * for a position not tied to a kind of unit, or before a position is picked (the designer's own default scope). */
export function previewStep(p: Pick<PositionOverview, "key" | "unit_kind"> | null): StepAssignees {
  return { assignees: [{ kind: "position", position: p?.key ?? "", ...defaultScope(p?.unit_kind ?? null) }] };
}

/** The step the preview starts as: «تکمیل فرم» (on an approval the sample requester is kept out). */
export const PREVIEW_ACTION: StepAction = "fill";

/** The preview's result, in a preview's words (nothing is sent to anyone). */
export const RESOLVE_STATUS: Record<string, { label: string; tone: "in" | "warning" | "danger" }> = {
  ok: { label: "پیدا می‌شود", tone: "in" },
  managers: { label: "به مسئولان گردش‌کار می‌رسد", tone: "warning" },
  nobody: { label: "کسی پیدا نمی‌شود", tone: "danger" },
  too_many: { label: "بیش از اندازه", tone: "warning" },
};
