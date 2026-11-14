// The pure logic of «گردش‌کارها» (design F §4, §8.3, package F6): who is offered the hub and its actions, the kind an
// address asks for, the rows a view shows (a kind, a search; in «همه» the lifecycles still on their module's default
// folded into one line), each row's words (kind, table or category, status, what may change there) and the editor it
// opens, the names to look up, a new process's key, what the publish dialog allows and says, the retire line, whether
// this runtime publishes at all (a Windows app linked to the web version does not), and the «قاعده‌ها» links the person
// can open. No React, no requests: tested in tests/workflows-hub-ui.test.ts.
import type { AccessGate } from "@shared/access";
import type { FlowProblem } from "@shared/flows/types";
import type { Option } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import { faDigits } from "@shared/format";
import { SEP, matchesFa } from "../../../../lib/fa";
import type { ChipTone } from "../../../../components/display";
import { optionLabel } from "../../../../records/model/schema";
import { fieldsAccess, type AccessProbe } from "../fields/model";
import type { DiffPreview, HubKind, HubRow, NewProcessBody, PublishResult } from "./api";

const fa = (n: number) => faDigits(n);

// ---------------------------------------------------------------------------------------------------------------
// Addresses

export const HUB_PATH = "settings/workflows";
/** The process designer (F6's second part) — the hub's process rows open it, as F4c's `editor` says. */
export const designerPath = (id: string) => `settings/workflows/p/${id}`;
export const lifecyclePath = (table: string) => `settings/workflows/states/${table}`;

// ---------------------------------------------------------------------------------------------------------------
// Who may use what (the server stays the authority; these only decide what is offered)

export interface HubAccess {
  /** the hub opens: `process_design` read or `settings` edit (F4c's rule) */
  read: boolean;
  /** «افزودن حق» on a role: `users` admin */
  grantWork: boolean;
}

export function hubAccess(p: AccessProbe): HubAccess {
  return { read: fieldsAccess(p).designRead, grantWork: p.writable && p.allows({ area: "users", op: "admin" }) };
}

/** Who sees the menu row: the people of «طراحی فرم و گردش‌کار» (like «فرم‌ها»; `settings` editors reach it by link). */
export const HUB_GATE: AccessGate = { area: PROCESS_DESIGN_AREA };

/** What a Windows app knows of its link (GET /meta → desktop.cloud), or nothing on the web and the server edition. */
export interface RuntimeMeta {
  mode?: "cloud" | "desktop";
  desktop?: { cloud?: { linked?: boolean; org_id?: string | null } | null } | null;
}

/**
 * Does this runtime publish, retire and advance this organisation's workflows? The web version, the server edition
 * and a standalone Windows app do; a Windows app linked to the web version for this organisation does not (F4c
 * refuses there with «این کار به اتصال نیاز دارد», so the hub does not offer it).
 */
export function authorityHere(meta: RuntimeMeta | null | undefined, orgId: string): boolean {
  if (meta?.mode !== "desktop") return true;
  const cloud = meta.desktop?.cloud;
  return !(cloud?.linked && cloud.org_id === orgId);
}

// ---------------------------------------------------------------------------------------------------------------
// Kinds and rows

export const KIND_ORDER: HubKind[] = ["process", "lifecycle", "change_model", "approval_rule", "flow", "catalog_flow", "catalog_tasks", "journey", "playbook"];

/** The «نوع» column's short words (the chips carry the kinds' full names). */
export const KIND_SHORT: Record<HubKind, string> = {
  process: "سازمانی",
  lifecycle: "چرخهٔ عمر",
  change_model: "مدل تغییر",
  approval_rule: "قاعدهٔ تأیید",
  flow: "جریان خودکار",
  catalog_flow: "تأمین کاتالوگ",
  catalog_tasks: "برنامهٔ انجام",
  journey: "سفر کارکنان",
  playbook: "پاسخ امنیتی",
};

/** The kind chip an address asks for (`?kind=`). */
export function kindOf(params: URLSearchParams): HubKind | null {
  const k = params.get("kind") as HubKind | null;
  return k && KIND_ORDER.includes(k) ? k : null;
}

/** A lifecycle the organisation has not changed (F4c's word for it). */
export const DEFAULT_LIFECYCLE = "پیش‌فرض";

const searchText = (r: HubRow) => `${r.name} ${r.table_label ?? ""} ${r.table ?? ""} ${r.category ?? ""} ${r.module} ${r.status}`;

/** A lifecycle still on its module's default sorts after the ones the organisation changed. */
const defaulted = (r: HubRow) => (r.kind === "lifecycle" && r.status === DEFAULT_LIFECYCLE ? 1 : 0);

/**
 * The rows of a kind (all without one) that match the search, in the kinds' order — the lifecycles the organisation
 * changed before the others — and the server's order within each.
 */
export function filterRows(rows: readonly HubRow[], f: { kind: HubKind | null; q: string }): HubRow[] {
  const q = f.q.trim();
  const out = rows.filter((r) => (!f.kind || r.kind === f.kind) && (!q || matchesFa(searchText(r), q)));
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => KIND_ORDER.indexOf(a.r.kind) - KIND_ORDER.indexOf(b.r.kind) || defaulted(a.r) - defaulted(b.r) || a.i - b.i)
    .map((x) => x.r);
}

export type ListRow = { type: "row"; key: string; row: HubRow } | { type: "more"; key: string; count: number };

/**
 * The table's rows. Every table with states has a lifecycle (about 150), so «همه» without a search lists the ones the
 * organisation changed and folds the others into one line that opens the «چرخهٔ عمر رکوردها» chip.
 */
export function listRows(rows: readonly HubRow[], f: { kind: HubKind | null; q: string }): ListRow[] {
  const shown = filterRows(rows, f);
  const fold = !f.kind && !f.q.trim();
  const out: ListRow[] = [];
  let folded = 0;
  for (const r of shown) {
    if (fold && r.kind === "lifecycle" && r.status === DEFAULT_LIFECYCLE) {
      if (!folded) out.push({ type: "more", key: "more:lifecycle", count: 0 });
      folded++;
      continue;
    }
    out.push({ type: "row", key: `${r.kind}:${r.id}`, row: r });
  }
  return out.map((x) => (x.type === "more" ? { ...x, count: folded } : x));
}

/** The folded line's words. */
export const moreText = (n: number) => `${fa(n)} چرخهٔ عمر دیگر با تنظیم پیش‌فرض ماژول`;

/** How the status reads: a chip only where it asks for attention (a draft, an organisation's change), quiet when off. */
export function statusView(r: Pick<HubRow, "status" | "active">): { text: string; chip: ChipTone | null; quiet: boolean } {
  const text = r.status;
  if (text.startsWith("پیش‌نویس")) return { text, chip: "neutral", quiet: false };
  if (text === "سفارشی‌شده") return { text, chip: "info", quiet: false };
  return { text, chip: null, quiet: !r.active || text === DEFAULT_LIFECYCLE };
}

/** What may change there, when it is less than everything. */
export function editableText(r: Pick<HubRow, "editable">): string {
  return r.editable === "labels" ? "فقط برچسب و رنگ" : r.editable === "safe" ? "تغییرهای امن" : "";
}

/** The field each kind's category comes from (its options name it in Persian). */
const CATEGORY_FIELD: Partial<Record<HubKind, [string, string]>> = {
  change_model: ["change_model", "type"],
  flow: ["flow", "trigger"],
  journey: ["journey_template", "type"],
  playbook: ["sec_playbook", "category"],
};

/** A row's category in words (a process's own, a flow's trigger, a change model's type…). */
export function categoryText(r: Pick<HubRow, "kind" | "category">, choices: Record<string, Option[]> = {}): string {
  if (!r.category) return "";
  // a catalogue flow's trigger is its kind
  if (r.kind === "catalog_flow") return "";
  const src = CATEGORY_FIELD[r.kind];
  const f = src ? tableDef(src[0])?.fields.find((x) => x.name === src[1]) : undefined;
  return f ? optionLabel(f, choices, r.category) : r.category;
}

/** «جدول یا دسته»: the table it works on and its category (a lifecycle's table is in its name: its key is shown). */
export function whereText(r: Pick<HubRow, "kind" | "category" | "table_label">, choices: Record<string, Option[]> = {}): string {
  return [r.kind === "lifecycle" ? "" : (r.table_label ?? ""), categoryText(r, choices)].filter(Boolean).join(SEP);
}

/** Kinds whose rows are records of a list page: the row opens its own record there (`editor/:id`). */
const RECORD_EDITORS: ReadonlySet<HubKind> = new Set(["change_model", "approval_rule", "journey", "playbook"]);

/** The route a row opens: its editor, or its record in the editor's list when the app has that route. */
export function rowLink(r: Pick<HubRow, "kind" | "id" | "editor">, hasRoute: (path: string) => boolean): string {
  if (RECORD_EDITORS.has(r.kind)) {
    const own = `${r.editor}/${r.id}`;
    if (hasRoute(own)) return own;
  }
  return r.editor;
}

/** Does a route pattern list (`settings/forms/:id`…) hold this org-relative path? */
export function routeMatches(patterns: readonly string[], path: string): boolean {
  const parts = path.split("?")[0].split("/");
  return patterns.some((p) => {
    const segs = p.split("/");
    return segs.length === parts.length && segs.every((s, i) => s.startsWith(":") || s === parts[i]);
  });
}

/** The members to name in «آخرین تغییر». */
export const ownerIds = (rows: readonly HubRow[]): string[] => [...new Set(rows.map((r) => r.owner).filter((x): x is string => !!x))].sort();

/** The categories processes already use (the new process's suggestions). */
export const processCategories = (rows: readonly HubRow[]): string[] =>
  [...new Set(rows.filter((r) => r.kind === "process" && r.category).map((r) => r.category!))].sort((a, b) => a.localeCompare(b, "fa"));

/** «قاعده‌ها»: the links the person can open. */
export function visibleRules<T extends { link: string }>(rules: readonly T[], opens: (path: string) => boolean): T[] {
  return rules.filter((r) => opens(r.link));
}

// ---------------------------------------------------------------------------------------------------------------
// A new process

export const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Why a key cannot be used (F4c's own rule), or "". */
export function keyProblem(key: string): string {
  const k = key.trim();
  if (!k) return "کلید را بنویسید";
  if (!KEY_RE.test(k)) return "کلید با حرف لاتین کوچک شروع می‌شود و فقط حرف، رقم و _ دارد";
  return "";
}

const LATIN: Record<string, string> = {
  ا: "a", آ: "a", أ: "a", إ: "e", ب: "b", پ: "p", ت: "t", ث: "s", ج: "j", چ: "ch", ح: "h", خ: "kh", د: "d", ذ: "z", ر: "r", ز: "z", ژ: "zh", س: "s", ش: "sh",
  ص: "s", ض: "z", ط: "t", ظ: "z", ع: "", غ: "gh", ف: "f", ق: "gh", ک: "k", ك: "k", گ: "g", ل: "l", م: "m", ن: "n", و: "v", ؤ: "v", ه: "h", ة: "h", ی: "y", ي: "y",
  ئ: "y", ء: "",
};

/** A key from the process's name: Latin letters kept, Persian ones spelt in Latin, the rest a «_» («درخواست تنخواه» → darkhast_…). */
export function suggestKey(name: string): string {
  const spelt = [...name.normalize("NFKC").toLowerCase()]
    .map((c) => {
      if (/[a-z0-9]/.test(c)) return c;
      if (/[۰-۹]/.test(c)) return String("۰۱۲۳۴۵۶۷۸۹".indexOf(c));
      if (/[٠-٩]/.test(c)) return String("٠١٢٣٤٥٦٧٨٩".indexOf(c));
      return c in LATIN ? LATIN[c] : "_";
    })
    .join("")
    .replace(/_+/g, "_")
    .replace(/^[_0-9]+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return KEY_RE.test(spelt) ? spelt : "";
}

export interface NewProcessForm {
  name: string;
  key: string;
  category: string;
  description: string;
}

/** Why the new process cannot be made yet: per field. */
export function newProcessProblems(f: NewProcessForm): Partial<Record<keyof NewProcessForm, string>> {
  const out: Partial<Record<keyof NewProcessForm, string>> = {};
  if (!f.name.trim()) out.name = "نام را بنویسید";
  const k = keyProblem(f.key);
  if (k) out.key = k;
  return out;
}

/** What POST /process/defs takes. */
export function newProcessBody(f: NewProcessForm): NewProcessBody {
  return { name: f.name.trim(), key: f.key.trim(), category: f.category.trim() || null, description: f.description.trim() || null };
}

/** A refusal's message on the field it names (409 duplicate: `details.fields`), else on none. */
export function fieldErrors(details: unknown): Partial<Record<keyof NewProcessForm, string>> {
  const fields = (details as { fields?: Record<string, unknown> } | null | undefined)?.fields;
  if (!fields || typeof fields !== "object") return {};
  const out: Partial<Record<keyof NewProcessForm, string>> = {};
  for (const k of ["name", "key", "category", "description"] as const) if (typeof fields[k] === "string") out[k] = fields[k] as string;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Publish and retire

/** F4c's refusal to a designer without approve. */
export const PUBLISH_REFUSAL = "انتشار با مسئول انتشار است";
/** F4c's refusal on a Windows app linked to the web version. */
export const CONNECTION_NEEDED = "این کار به اتصال نیاز دارد";
/** F4c's line of a version that changes nothing. */
export const NO_CHANGE = "تغییری نسبت به نسخهٔ پیشین ندارد";

/** F4c's word for a retired process. */
export const RETIRED = "بازنشسته";

/** What the publish and retire dialogs need of a process row. */
export function processTarget(r: Pick<HubRow, "id" | "name" | "status" | "open_cases">): { id: string; name: string; retired: boolean; open_cases: number } {
  return { id: r.id, name: r.name, retired: r.status === RETIRED, open_cases: r.open_cases ?? 0 };
}

/** A process row's actions in the hub. */
export function processActions(r: Pick<HubRow, "kind" | "status" | "active">, o: { canPublish: boolean; authority: boolean; writable: boolean }): ("publish" | "retire")[] {
  if (r.kind !== "process" || !o.canPublish || !o.authority || !o.writable) return [];
  return r.active ? ["publish", "retire"] : ["publish"];
}

export interface PublishVerdict {
  ok: boolean;
  /** why it cannot be published now */
  reason: string | null;
  errors: FlowProblem[];
  warnings: FlowProblem[];
  /** the draft changes nothing of the published version */
  unchanged: boolean;
}

/**
 * What the publish dialog allows. A retired process may be published again unchanged (it takes new cases again);
 * otherwise a draft that changes nothing is not published twice.
 */
export function publishVerdict(p: DiffPreview, o: { canPublish: boolean; authority: boolean; retired: boolean }): PublishVerdict {
  const errors = p.problems.filter((x) => x.level === "error");
  const warnings = p.problems.filter((x) => x.level !== "error");
  const unchanged = !p.diff.first && !p.diff.access.length && p.diff.changes.every((c) => c === NO_CHANGE);
  let reason: string | null = null;
  if (!o.authority) reason = CONNECTION_NEEDED;
  else if (!o.canPublish) reason = PUBLISH_REFUSAL;
  else if (errors.length) reason = `پیش از انتشار ${fa(errors.length)} ایراد را برطرف کنید`;
  else if (unchanged && !o.retired) reason = "پیش‌نویس با نسخهٔ منتشرشده یکی است؛ چیزی برای انتشار نیست";
  else if (!p.can_publish) reason = PUBLISH_REFUSAL;
  return { ok: !reason, reason, errors, warnings, unchanged };
}

/** The dialog's title line: «نسخهٔ ۳ از «…»». */
export const publishTitle = (name: string, next: number) => `انتشار نسخهٔ ${fa(next)} از «${name}»؟`;

/** What the published toast says: F4c's message, and how many cases took the new access settings. */
export function publishedText(r: Pick<PublishResult, "message" | "propagated">): { title: string; detail: string | null } {
  return { title: r.message, detail: r.propagated ? `تنظیمات دسترسی به ${fa(r.propagated)} پروندهٔ این گردش‌کار رسید` : null };
}

/** The retire dialog's line. */
export function retireText(openCases: number): string {
  return openCases > 0
    ? `پروندهٔ تازه با آن آغاز نمی‌شود؛ ${fa(openCases)} پروندهٔ باز با نسخهٔ خود به پایان می‌رسد.`
    : "پروندهٔ تازه با آن آغاز نمی‌شود؛ پرونده‌ای باز نیست.";
}

/** A role of the «حق ثبت در کارها» notice: its name and how many hold it. */
export const roleLine = (r: { name: string; holders: number }) => (r.holders ? `${r.name} (${fa(r.holders)} عضو)` : r.name);
