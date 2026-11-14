// Validators of field values (design F §3.1): the named checks of field types — Iranian national code, IBAN, card,
// postal code and mobile number, and the attachments of a «پیوست» field — plus patterns, decimal places and date
// limits. One implementation for every runtime: the engine's writes (src/server/engine/values.ts), the process apply
// on the authority, the forms and the Windows apps all give the same answer. Persian and Arabic digits are accepted
// everywhere; a checked identifier is stored in one canonical form (Latin digits, no separators).
// Empty values always pass: whether a value is required is decided elsewhere (the engine, the step rights).
// Imported by the UI: keep it free of server imports.
import type { FieldCheck, FieldDef } from "../model/types";
import { normalizeDigits } from "../money";
import { faDigits } from "../format";
import { formatJalali } from "../jalali";
import { isCardNumber, isIban, isMobile, isNationalId, normalizeMobile } from "../validate";
import { validPostalCode } from "../security/pii";

export interface CheckInfo {
  label: string;
  /** what the message asks the person to look at */
  hint: string;
  /** shown left to right */
  ltr: boolean;
  /** digit groups for reading (the stored value has no separators) */
  groups?: number[];
}

/** The named checks of field types. */
export const FIELD_CHECKS: Record<FieldCheck, CheckInfo> = {
  national_id: { label: "کد ملی", hint: "۱۰ رقم آن را بررسی کنید", ltr: true, groups: [3, 6, 1] },
  iban: { label: "شمارهٔ شبا", hint: "IR و ۲۴ رقم آن را بررسی کنید", ltr: true, groups: [4, 4, 4, 4, 4, 4, 2] },
  card: { label: "شمارهٔ کارت", hint: "۱۶ رقم آن را بررسی کنید", ltr: true, groups: [4, 4, 4, 4] },
  postal_code: { label: "کد پستی", hint: "۱۰ رقم آن را بررسی کنید", ltr: true, groups: [5, 5] },
  mobile: { label: "شمارهٔ همراه", hint: "مانند ۰۹۱۲۱۲۳۴۵۶۷ وارد کنید", ltr: true, groups: [4, 3, 4] },
  attachments: { label: "پیوست", hint: "پرونده‌ها را دوباره بیفزایید", ltr: false },
};

export const isFieldCheck = (v: unknown): v is FieldCheck => typeof v === "string" && v in FIELD_CHECKS;

const SEPARATORS = /[\s\-_.‌]/g;

/**
 * The stored form of a checked value: Latin digits without separators; an IBAN in capitals with «IR» (24 bare digits
 * get it); a mobile number as 09…. A value that is not valid keeps its digits, so the check can report it.
 */
export function normalizeChecked(check: FieldCheck, raw: unknown): string {
  const s = normalizeDigits(String(raw ?? "")).trim();
  switch (check) {
    case "iban": {
      const t = s.replace(SEPARATORS, "").toUpperCase();
      return /^\d{24}$/.test(t) ? `IR${t}` : t;
    }
    case "mobile":
      return normalizeMobile(s.replace(SEPARATORS, ""));
    case "national_id":
    case "card":
    case "postal_code":
      return s.replace(SEPARATORS, "");
    default:
      return s;
  }
}

/** Is the (normalised) value valid for the check? `attachments` is judged by `attachmentsProblem`. */
export function validChecked(check: FieldCheck, value: string): boolean {
  const v = normalizeChecked(check, value);
  switch (check) {
    case "national_id":
      return /^\d{10}$/.test(v) && isNationalId(v);
    case "iban":
      return isIban(v);
    case "card":
      return isCardNumber(v) && !/^(\d)\1{15}$/.test(v);
    case "postal_code":
      return /^\d{10}$/.test(v) && validPostalCode(v);
    case "mobile":
      return /^09\d{9}$/.test(v) && isMobile(v);
    case "attachments":
      return true;
  }
}

/** The message for a value that fails its check, naming the field. */
export function checkMessage(label: string, check: FieldCheck): string {
  const c = FIELD_CHECKS[check];
  return `«${label}» ${c.label} معتبر نیست؛ ${c.hint}`;
}

/** A checked value grouped for reading («IR12 3456 …», «6037 9911 …»), in Latin digits; other values unchanged. */
export function groupChecked(check: FieldCheck, value: unknown): string {
  const groups = FIELD_CHECKS[check].groups;
  const v = normalizeChecked(check, value);
  if (!groups || !v) return v;
  const sep = check === "national_id" || check === "postal_code" ? "-" : " ";
  if (v.length !== groups.reduce((a, b) => a + b, 0)) return v;
  const out: string[] = [];
  let at = 0;
  for (const g of groups) {
    out.push(v.slice(at, at + g));
    at += g;
  }
  return out.join(sep);
}

// ---------------------------------------------------------------------------------------------------------------
// Patterns

/** Longest pattern an organisation may give a field type. */
export const PATTERN_MAX = 300;
/** Longest value a pattern judges: a «متن کوتاه» value (its storage limit); a longer value never matches. */
export const PATTERN_VALUE_MAX = 500;

// Speed. JavaScript tries a pattern by backtracking, so a pattern whose parts can share the same characters in many
// ways — «(a|aa)+», «(\d|\d)+», «(.*a){12}», «.*a.*a.*a.*b», a long run of «(a|aa)» — can take seconds to hours on a
// value of a few dozen characters, and the server runs it inside the write. A pattern is refused unless the ways it can
// match a value of PATTERN_VALUE_MAX characters stay within PATTERN_BUDGET (`patternWays`). Parts in a row multiply,
// alternatives add, a repeat of a part that matches one way counts its possible repeat counts, a repeat of a part with
// more ways than one multiplies them for every count (an open repeat of one is refused outright), and a pattern that
// does not start with «^» is tried from every position of the value.

/** Repeat counts an open repeat («*», «+», «{n,}») can choose on a value, and the positions an unanchored pattern starts from. */
const OPEN_WAYS = PATTERN_VALUE_MAX + 1;
/** Ways a pattern may match: just above 501², so «^…» allows two open repeats in a row, a pattern without «^» one. */
const PATTERN_BUDGET = 260_000;

export interface PatternWays {
  /** an upper bound of the ways the pattern matches a value, from every position it may start at */
  ways: number;
  /** a repeat of a part with more than one way to match (nested repeats, alternatives under a repeat) */
  nested: boolean;
  /** every top-level alternative starts with «^» */
  anchored: boolean;
  /** the pattern names an earlier group (\1, \k<name>) */
  backref: boolean;
}

/** Ways a valid ("u") pattern can match (see above). Escapes and character classes are single characters. */
export function patternWays(src: string): PatternWays {
  let i = 0;
  let nested = false;
  let backref = false;
  let anchored = true;
  const escape = () => {
    const c = src[i + 1];
    if ((c === "p" || c === "P" || c === "u") && src[i + 2] === "{") i = src.indexOf("}", i) + 1;
    else if (c === "k" && src[i + 2] === "<") {
      backref = true;
      i = src.indexOf(">", i) + 1;
    } else if (c === "u") i += 6;
    else if (c === "x") i += 4;
    else if (c === "c") i += 3;
    else {
      if (c >= "1" && c <= "9") backref = true;
      i += 2;
    }
  };
  const klass = () => {
    i++;
    while (i < src.length && src[i] !== "]") {
      if (src[i] === "\\") escape();
      else i++;
    }
    i++;
  };
  const repeat = (part: number): number => {
    let min: number;
    let max: number;
    const c = src[i];
    if (c === "*" || c === "+" || c === "?") {
      [min, max] = c === "*" ? [0, Infinity] : c === "+" ? [1, Infinity] : [0, 1];
      i++;
    } else if (c === "{") {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (!m) return part;
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
      i += m[0].length;
    } else return part;
    if (src[i] === "?") i++; // lazy: the same ways in another order
    if (part <= 1) return Math.max(1, Math.min(max, PATTERN_VALUE_MAX) - Math.min(min, PATTERN_VALUE_MAX) + 1);
    if (max > 1) nested = true;
    if (max === Infinity) return Infinity;
    let ways = 0;
    for (let k = min; k <= max && ways < 1e15; k++) ways += part ** k;
    return ways;
  };
  const sequence = (): number => {
    let ways = 1;
    while (i < src.length && src[i] !== "|" && src[i] !== ")") {
      let part = 1;
      const c = src[i];
      if (c === "(") {
        i++;
        // (?: (?= (?! (?<= (?<! (?<name>
        if (src[i] === "?") i = src[i + 1] === "<" && src[i + 2] !== "=" && src[i + 2] !== "!" ? src.indexOf(">", i) + 1 : i + (src[i + 1] === "<" ? 3 : 2);
        part = alternatives(false);
        i++;
      } else if (c === "[") klass();
      else if (c === "\\") escape();
      else i++;
      ways *= repeat(part);
    }
    return ways;
  };
  const alternatives = (top: boolean): number => {
    let ways = 0;
    for (;;) {
      const fromStart = src[i] === "^";
      const branch = sequence();
      if (top && !fromStart) anchored = false;
      ways += top && !fromStart ? branch * OPEN_WAYS : branch;
      if (src[i] !== "|") return ways;
      i++;
    }
  };
  const ways = alternatives(true);
  return { ways, nested, anchored, backref };
}

const checked = new Map<string, { re: RegExp | null; problem: string | null }>();

/** The compiled pattern, or why it cannot be used (cached). */
function usable(pattern: string): { re: RegExp | null; problem: string | null } {
  const hit = checked.get(pattern);
  if (hit) return hit;
  let re: RegExp | null = null;
  let problem: string | null = null;
  try {
    re = new RegExp(pattern, "u");
  } catch {
    problem = "الگو عبارت باقاعدهٔ درستی نیست";
  }
  if (re) {
    const w = patternWays(pattern);
    if (w.backref) problem = "الگو نباید به گروه‌های پیشین ارجاع دهد";
    else if (!(w.ways <= PATTERN_BUDGET)) {
      problem = w.nested
        ? "الگو تکرارِ درونِ تکرار یا گروهِ گزینه‌دارِ تکرارشونده دارد و ممکن است بسیار کند شود؛ آن را ساده کنید، مثلاً [ab]+ به‌جای (a|b)+"
        : !w.anchored && w.ways / OPEN_WAYS <= PATTERN_BUDGET
          ? "الگو در هر جای متن از نو آزموده می‌شود و با این تکرارها ممکن است بسیار کند شود؛ آن را با ^ آغاز کنید یا ساده‌تر کنید"
          : "الگو تکرارهای باز یا گزینه‌های پشت‌سرهمِ زیادی دارد و ممکن است بسیار کند شود؛ آن را ساده کنید";
    }
  }
  if (checked.size > 500) checked.clear();
  const out = { re: problem ? null : re, problem };
  checked.set(pattern, out);
  return out;
}

/** Why a pattern cannot be used (null when it can): empty, too long, not a valid expression, a back-reference, or slow. */
export function patternProblem(pattern: unknown): string | null {
  if (typeof pattern !== "string" || !pattern.trim()) return "الگو خالی است";
  if (pattern.length > PATTERN_MAX) return `الگو حداکثر ${faDigits(PATTERN_MAX)} نویسه است`;
  return usable(pattern).problem;
}

/**
 * Does the value match the pattern (as typed, or with Latin digits)? A pattern that cannot be used matches nothing,
 * and neither does a value longer than PATTERN_VALUE_MAX (no field that takes a pattern stores one).
 */
export function matchesPattern(pattern: string, value: string): boolean {
  if (patternProblem(pattern) || value.length > PATTERN_VALUE_MAX) return false;
  const re = usable(pattern).re!;
  const latin = normalizeDigits(value);
  return re.test(value) || (latin !== value && re.test(latin));
}

export function patternFailure(f: Pick<FieldDef, "label" | "patternMessage">): string {
  return f.patternMessage ? `«${f.label}»: ${f.patternMessage}` : `«${f.label}» با قالب خواسته‌شده جور نیست`;
}

// ---------------------------------------------------------------------------------------------------------------
// Decimal places

/** Latin digits, no grouping separators, Persian decimal separator → "." (as the engine reads numbers). */
export function numericText(raw: unknown): string {
  return normalizeDigits(String(raw ?? "")).replace(/[,٬'\s‌]/g, "").replace(/[٫/]/g, ".");
}

/** Decimal places of a number as written (trailing zeros do not count). */
export function decimalPlaces(raw: unknown): number {
  const frac = numericText(raw).split(".")[1] ?? "";
  return frac.replace(/0+$/, "").length;
}

export function decimalsProblem(f: Pick<FieldDef, "label" | "decimals">, raw: unknown): string | null {
  if (f.decimals === undefined || f.decimals === null || raw === null || raw === undefined || raw === "") return null;
  if (decimalPlaces(raw) <= f.decimals) return null;
  return f.decimals === 0 ? `«${f.label}» باید عدد صحیح باشد` : `«${f.label}» حداکثر ${faDigits(f.decimals)} رقم اعشار دارد`;
}

// ---------------------------------------------------------------------------------------------------------------
// Date limits: an ISO date, or a token counted from today in the organisation's time zone

const DATE_TOKEN = /^\$today(?:([+-])(\d{1,5})d)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === s;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Why a date limit cannot be used (null when it can). */
export function dateLimitProblem(limit: unknown): string | null {
  if (typeof limit !== "string") return "محدودهٔ تاریخ معتبر نیست";
  const s = normalizeDigits(limit).trim();
  if (DATE_TOKEN.test(s) || validIsoDate(s)) return null;
  return "محدودهٔ تاریخ باید تاریخی مانند 2026-03-21 یا «$today»، «$today+30d» و «$today-7d» باشد";
}

/** A limit as an ISO date: a fixed date, or a token from `today` (YYYY-MM-DD, local). Null when it is not a limit. */
export function resolveDateLimit(limit: string | undefined | null, today: string): string | null {
  if (!limit) return null;
  const s = normalizeDigits(limit).trim();
  const m = DATE_TOKEN.exec(s);
  if (m) return m[1] ? addDaysIso(today, (m[1] === "-" ? -1 : 1) * Number(m[2])) : today;
  return validIsoDate(s) ? s : null;
}

/** The value's local day (YYYY-MM-DD) against the field's limits (inclusive). */
export function dateRangeProblem(f: Pick<FieldDef, "label" | "minDate" | "maxDate">, day: string, today: string): string | null {
  const min = resolveDateLimit(f.minDate, today);
  if (min && day < min) return `«${f.label}» نباید پیش از ${formatJalali(min)} باشد`;
  const max = resolveDateLimit(f.maxDate, today);
  if (max && day > max) return `«${f.label}» نباید پس از ${formatJalali(max)} باشد`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Attachments: a «پیوست» field is json storage holding ids of the same record's attachments

/** Files a «پیوست» field holds when its type says nothing, and at most. */
export const ATTACHMENTS_DEFAULT_MAX = 5;
export const ATTACHMENTS_MAX = 50;

/** Kinds of file an attachments field may accept (or plain extensions). */
export const FILE_KINDS: Record<string, { label: string; ext: string[] }> = {
  image: { label: "تصویر", ext: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic"] },
  pdf: { label: "PDF", ext: ["pdf"] },
  office: { label: "سند اداری (Word، Excel، PowerPoint)", ext: ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "csv"] },
  text: { label: "متن", ext: ["txt", "csv", "md", "log"] },
  archive: { label: "پروندهٔ فشرده", ext: ["zip", "rar", "7z", "tar", "gz"] },
};

const EXTENSION = /^[a-z0-9]{1,10}$/;

/** Why an accept list cannot be used (null when it can). */
export function acceptProblem(accept: unknown): string | null {
  if (!Array.isArray(accept)) return "نوع‌های پذیرفته باید فهرست باشند";
  if (accept.length > 40) return "حداکثر ۴۰ نوع پرونده";
  for (const a of accept) {
    const k = typeof a === "string" ? a.trim().toLowerCase().replace(/^\./, "") : "";
    if (!(k in FILE_KINDS) && !EXTENSION.test(k)) return `«${String(a)}» نوع پرونده یا پسوند معتبری نیست`;
  }
  return null;
}

/** The extensions an accept list allows (kinds expanded, lower case, without the dot); empty = any file. */
export function acceptedExtensions(accept?: readonly string[] | null): Set<string> {
  const out = new Set<string>();
  for (const a of accept ?? []) {
    const k = String(a).trim().toLowerCase().replace(/^\./, "");
    if (k in FILE_KINDS) for (const e of FILE_KINDS[k].ext) out.add(e);
    else if (EXTENSION.test(k)) out.add(k);
  }
  return out;
}

export const extensionOf = (name: string): string => {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name ?? "").trim());
  return m ? m[1].toLowerCase() : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The ids a «پیوست» value holds (an array of attachment ids, or `{ id }` objects), or the problem with its shape. */
export function attachmentIds(f: Pick<FieldDef, "label" | "max">, raw: unknown): { ids: string[]; problem: null } | { ids: null; problem: string } {
  if (raw === null || raw === undefined || raw === "") return { ids: [], problem: null };
  if (!Array.isArray(raw)) return { ids: null, problem: `«${f.label}» باید فهرستی از پیوست‌ها باشد` };
  const ids: string[] = [];
  for (const x of raw) {
    const v = x && typeof x === "object" && "id" in (x as object) ? (x as { id: unknown }).id : x;
    const s = String(v ?? "").trim().toLowerCase();
    if (!UUID.test(s)) return { ids: null, problem: `«${f.label}» پیوست نامعتبری دارد` };
    if (!ids.includes(s)) ids.push(s);
  }
  const max = Math.min(f.max ?? ATTACHMENTS_DEFAULT_MAX, ATTACHMENTS_MAX);
  if (ids.length > max) return { ids: null, problem: `«${f.label}» حداکثر ${faDigits(max)} پرونده می‌پذیرد` };
  return { ids, problem: null };
}

/**
 * Every id must be one of `available` — the attachments of the same record, or the uploads the same write attaches —
 * and of an accepted kind. An attachment of another record is refused like an unknown id, so nothing about it shows.
 */
export function attachmentsProblem(
  f: Pick<FieldDef, "label" | "accept">,
  ids: readonly string[],
  available: ReadonlyMap<string, { name: string }>,
): string | null {
  const allowed = acceptedExtensions(f.accept);
  for (const id of ids) {
    const a = available.get(id);
    if (!a) return `پیوست‌های «${f.label}» باید از پرونده‌های همین رکورد باشند`;
    if (allowed.size && !allowed.has(extensionOf(a.name))) {
      const kinds = (f.accept ?? []).map((k) => FILE_KINDS[k]?.label ?? k).join("، ");
      return `«${f.label}» فقط این نوع پرونده‌ها را می‌پذیرد: ${kinds}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// One value under its field's validation

export interface ValueEnv {
  /** today in the organisation's time zone (YYYY-MM-DD) */
  today: string;
  /** the local day (YYYY-MM-DD) of an instant, for datetime fields (default: its UTC day) */
  dayOf?: (iso: string) => string;
  /** the attachments a «پیوست» value may name (the record's own and this write's uploads); absent = its shape only */
  attachments?: ReadonlyMap<string, { name: string }>;
}

const isEmptyValue = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** The stored form of a value of a field with a named check (identifiers canonical); other values unchanged. */
export function normalizeFieldValue(f: Pick<FieldDef, "check">, value: unknown): unknown {
  if (!f.check || f.check === "attachments" || typeof value !== "string" || !value.trim()) return value;
  return normalizeChecked(f.check, value);
}

/**
 * What is wrong with a value (already coerced to its storage type) under the field type's validation — the named
 * check, the pattern, the decimal places and the date limits — or null. Empty values pass.
 */
export function fieldValueProblem(f: FieldDef, value: unknown, env: ValueEnv): string | null {
  if (f.check === "attachments") {
    const r = attachmentIds(f, value);
    if (r.ids === null) return r.problem;
    return env.attachments && r.ids.length ? attachmentsProblem(f, r.ids, env.attachments) : null;
  }
  if (isEmptyValue(value)) return null;
  if (f.check && typeof value === "string" && !validChecked(f.check, value)) return checkMessage(f.label, f.check);
  if (f.pattern && typeof value === "string" && !matchesPattern(f.pattern, value)) return patternFailure(f);
  if (f.decimals !== undefined && (typeof value === "string" || typeof value === "number")) {
    const p = decimalsProblem(f, value);
    if (p) return p;
  }
  if ((f.minDate || f.maxDate) && typeof value === "string") {
    const day = f.type === "datetime" ? (env.dayOf ? env.dayOf(value) : value.slice(0, 10)) : value.slice(0, 10);
    return dateRangeProblem(f, day, env.today);
  }
  return null;
}
