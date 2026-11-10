// Import sets and transform maps (catalogue ADM-003, PLT-065, INT-011): which column of a spreadsheet becomes which
// field, with what transformation. Pure — the import page previews with it, the server runs it, and the AI skill
// «پیشنهاد نگاشت ستون‌ها» falls back to `suggestMapping` when no model answers.
// Imported by the UI: keep it free of server imports.
import { normalizeSearch } from "../model/conditions";

export type TransformKind = "copy" | "trim" | "upper" | "lower" | "map" | "constant" | "default" | "join" | "first_word" | "digits";

export const TRANSFORMS: Record<TransformKind, string> = {
  copy: "همان مقدار",
  trim: "حذف فاصله‌های اضافه",
  upper: "حروف بزرگ (لاتین)",
  lower: "حروف کوچک (لاتین)",
  map: "جایگزینی مقدارها",
  constant: "مقدار ثابت",
  default: "مقدار پیش‌فرض اگر خالی بود",
  join: "چسباندن چند ستون",
  first_word: "نخستین کلمه",
  digits: "فقط رقم‌ها",
};

export interface MapRule {
  /** the source column (header); constant rules have none */
  source?: string | null;
  /** the target field name */
  target: string;
  transform?: TransformKind;
  /** «map»: source value → target value (matched after Persian normalisation, case-insensitively) */
  map?: Record<string, string>;
  /** «constant» / «default»: the value */
  value?: string | null;
  /** «join»: more columns, joined with `sep` (default a space) */
  sources?: string[];
  sep?: string;
}

export interface TransformSpec {
  rules: MapRule[];
  /** a field that identifies existing records (they are updated, not created again) */
  key_field?: string | null;
}

const norm = (s: unknown) =>
  normalizeSearch(String(s ?? ""))
    .toLowerCase()
    .replace(/[\s_\-.:/\\()[\]{}«»"'،,؛;]+/g, "")
    .trim();

const text = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v));

/** One rule applied to a source row (null = leave the field out). */
export function applyRule(row: Record<string, unknown>, r: MapRule): string | null {
  const raw = r.source ? text(row[r.source]) : "";
  switch (r.transform ?? "copy") {
    case "copy":
      return raw === "" ? null : raw;
    case "trim":
      return raw.replace(/\s+/g, " ").trim() || null;
    case "upper":
      return raw.toUpperCase() || null;
    case "lower":
      return raw.toLowerCase() || null;
    case "map": {
      const key = norm(raw);
      for (const [from, to] of Object.entries(r.map ?? {})) if (norm(from) === key) return to;
      return raw === "" ? null : raw;
    }
    case "constant":
      return r.value ?? null;
    case "default":
      return raw.trim() === "" ? (r.value ?? null) : raw;
    case "join": {
      const parts = [r.source, ...(r.sources ?? [])].filter((s): s is string => !!s).map((s) => text(row[s]).trim()).filter(Boolean);
      return parts.length ? parts.join(r.sep ?? " ") : null;
    }
    case "first_word":
      return raw.trim().split(/\s+/)[0] || null;
    case "digits": {
      const d = normalizeSearch(raw).replace(/\D+/g, "");
      return d || null;
    }
    default:
      return raw || null;
  }
}

/** A source row → field values (rules on the same target: the last non-empty value wins). */
export function applySpec(row: Record<string, unknown>, spec: TransformSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of spec.rules) {
    if (!r.target) continue;
    const v = applyRule(row, r);
    if (v !== null) out[r.target] = v;
  }
  return out;
}

/** Why a transform spec cannot run (Persian), or null. `fields` = the target table's writable field names. */
export function specProblem(spec: TransformSpec, fields: Set<string>, headers?: string[]): string | null {
  if (!Array.isArray(spec.rules) || !spec.rules.length) return "هیچ ستونی به فیلدی نگاشت نشده است";
  for (const r of spec.rules) {
    if (!fields.has(r.target)) return `فیلد «${r.target}» در جدول مقصد نیست یا قابل ورود نیست`;
    const kind = r.transform ?? "copy";
    if (!(kind in TRANSFORMS)) return `تبدیل «${kind}» شناخته نیست`;
    if (kind !== "constant" && !r.source) return `برای «${r.target}» ستون مبدأ انتخاب نشده است`;
    if (headers && r.source && !headers.includes(r.source)) return `ستون «${r.source}» در فایل نیست`;
    if (headers) for (const s of r.sources ?? []) if (!headers.includes(s)) return `ستون «${s}» در فایل نیست`;
  }
  if (spec.key_field && !fields.has(spec.key_field) && spec.key_field !== "number") return `فیلد کلید «${spec.key_field}» در جدول نیست`;
  return null;
}

// ---------------------------------------------------------------- suggestions

/** Words people use for common fields, by field name (headers of old systems, Persian and English). */
const SYNONYMS: Record<string, string[]> = {
  email: ["ایمیل", "پست الکترونیک", "mail", "e-mail", "رایانامه"],
  full_name: ["نام", "نام و نام خانوادگی", "نام کامل", "name", "fullname", "display name", "displayname"],
  name: ["نام", "عنوان", "name", "title"],
  title: ["سمت", "عنوان شغلی", "job title", "position", "title"],
  phone: ["تلفن", "شماره تماس", "موبایل", "همراه", "phone", "mobile", "tel"],
  short_description: ["عنوان", "موضوع", "شرح کوتاه", "subject", "summary", "title"],
  description: ["شرح", "توضیحات", "توضیح", "متن", "body", "details", "description"],
  priority: ["اولویت", "priority"],
  state: ["وضعیت", "status", "state"],
  assigned_to: ["کارشناس", "مسئول", "assignee", "assigned to", "owner"],
  assignment_group_id: ["گروه", "گروه پشتیبانی", "team", "group", "assignment group"],
  caller_id: ["درخواست کننده", "درخواستکننده", "گزارش دهنده", "requester", "caller", "reporter"],
  requested_for: ["برای", "درخواست برای", "requested for"],
  category: ["دسته", "دسته بندی", "category", "type"],
  subcategory: ["زیردسته", "subcategory"],
  impact: ["اثر", "impact"],
  urgency: ["فوریت", "urgency"],
  opened_at: ["تاریخ ثبت", "تاریخ ایجاد", "created", "opened", "created at", "open date"],
  due_at: ["مهلت", "سررسید", "due", "due date", "deadline"],
  close_notes: ["یادداشت حل", "راه حل", "resolution", "close notes"],
  number: ["شماره", "شماره تیکت", "number", "ticket", "id", "key"],
  location_id: ["مکان", "محل", "location", "site"],
  manager_email: ["مدیر", "ایمیل مدیر", "manager", "manager email"],
  unit: ["واحد", "اداره", "دپارتمان", "department", "unit"],
  groups: ["گروه ها", "groups", "گروه‌ها"],
};

export interface FieldHint {
  name: string;
  label: string;
  type?: string;
}

export interface Suggestion {
  header: string;
  field: string | null;
  /** 0–1 */
  confidence: number;
  /** why, in Persian */
  reason: string;
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Dice similarity of two normalised strings (0–1). */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      hits++;
      counts.set(g, n - 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/**
 * The field each header most likely means: the field's own name or label, then the synonyms of common fields, then the
 * closest label (≥ 0.55). Every field is used once (the most confident header wins it).
 */
export function suggestMapping(headers: string[], fields: FieldHint[]): Suggestion[] {
  const scored: { header: string; field: string; confidence: number; reason: string }[] = [];
  for (const h of headers) {
    const nh = norm(h);
    if (!nh) continue;
    for (const f of fields) {
      if (nh === norm(f.name)) scored.push({ header: h, field: f.name, confidence: 1, reason: "نام ستون با نام فنی فیلد یکی است" });
      else if (nh === norm(f.label)) scored.push({ header: h, field: f.name, confidence: 0.98, reason: "نام ستون با برچسب فیلد یکی است" });
      else if ((SYNONYMS[f.name] ?? []).some((s) => norm(s) === nh)) scored.push({ header: h, field: f.name, confidence: 0.9, reason: `«${h}» نام رایج «${f.label}» است` });
      else {
        const sim = Math.max(similarity(h, f.label), similarity(h, f.name));
        if (sim >= 0.55) scored.push({ header: h, field: f.name, confidence: Math.round(sim * 80) / 100, reason: `به برچسب «${f.label}» شبیه است` });
      }
    }
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  const usedHeaders = new Set<string>();
  const usedFields = new Set<string>();
  const byHeader = new Map<string, Suggestion>();
  for (const s of scored) {
    if (usedHeaders.has(s.header) || usedFields.has(s.field)) continue;
    usedHeaders.add(s.header);
    usedFields.add(s.field);
    byHeader.set(s.header, s);
  }
  return headers.map((h) => byHeader.get(h) ?? { header: h, field: null, confidence: 0, reason: "فیلد مشابهی پیدا نشد" });
}

/** A transform spec from accepted suggestions (copy rules, trimmed text). */
export function specFromSuggestions(s: Suggestion[], keyField?: string | null): TransformSpec {
  return { rules: s.filter((x) => x.field).map((x) => ({ source: x.header, target: x.field!, transform: "trim" as const })), key_field: keyField ?? null };
}
