// Pure logic of knowledge management, shared by the server, the screens and the tests: Markdown structure (headings,
// table of contents, template sections, blocks, images, links), the sensitive-data and unsafe-command scans that guard
// publication, the rule-based quality checks, line diffs of versions, text similarity for duplicates, version numbers,
// the article health score and next action, the AQI score, and the KCS draft of a resolved record.
// Imported by the UI: keep it free of server imports.
import { normalizeFa, queryTerms, searchForm, stem } from "../ai/text";
import { isCardNumber, isIban, isNationalId } from "../validate";

// ---------------------------------------------------------------------------------------------------------------
// Markdown structure

/** Lines of a Markdown text outside fenced code blocks (with their index). */
function proseLines(md: string): { line: string; i: number }[] {
  const out: { line: string; i: number }[] = [];
  let fence: string | null = null;
  const lines = String(md ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = /^\s{0,3}(```+|~~~+)/.exec(l);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      continue;
    }
    if (!fence) out.push({ line: l, i });
  }
  return out;
}

/** An anchor for a heading: letters and digits of the normal form joined by dashes (Persian kept). */
export function slugify(text: string): string {
  const s = normalizeFa(String(text ?? "").replace(/[`*_~[\]()#>]/g, " "))
    .toLowerCase()
    .replace(/‌/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "section";
}

export interface Heading {
  level: number;
  text: string;
  slug: string;
}

/** Headings (levels 1–4) outside code, each with a unique anchor — the table of contents of an article. */
export function headings(md: string): Heading[] {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  for (const { line } of proseLines(md)) {
    const m = /^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").trim();
    let slug = slugify(text);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n) slug = `${slug}-${n + 1}`;
    out.push({ level: m[1].length, text, slug });
  }
  return out;
}

export interface Section {
  /** the `##` heading (empty for the text before the first one) */
  title: string;
  text: string;
}

/** The text split at its level-2 headings. */
export function sectionsOf(md: string): Section[] {
  const lines = String(md ?? "").split(/\r?\n/);
  const prose = new Set(proseLines(md).map((p) => p.i));
  const out: Section[] = [{ title: "", text: "" }];
  for (let i = 0; i < lines.length; i++) {
    const m = prose.has(i) ? /^\s{0,3}##\s+(.+?)\s*#*\s*$/.exec(lines[i]) : null;
    if (m) out.push({ title: m[1].trim(), text: "" });
    else out[out.length - 1].text += (out[out.length - 1].text ? "\n" : "") + lines[i];
  }
  for (const s of out) s.text = s.text.trim();
  return out.filter((s, i) => i > 0 || s.text);
}

/** A section a template defines. */
export interface TemplateSection {
  key: string;
  label: string;
  guidance?: string;
  required?: boolean;
  /** goes into the internal part (agents only) */
  internal?: boolean;
}

/** Template sections as stored (malformed entries dropped). */
export function cleanSections(raw: unknown): TemplateSection[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateSection[] = [];
  const keys = new Set<string>();
  for (const r of raw.slice(0, 30)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const label = String(o.label ?? "").trim().slice(0, 120);
    if (!label) continue;
    let key = String(o.key ?? "").trim().slice(0, 40) || slugify(label);
    while (keys.has(key)) key = `${key}_`;
    keys.add(key);
    out.push({ key, label, guidance: o.guidance ? String(o.guidance).slice(0, 500) : undefined, required: o.required === true, internal: o.internal === true });
  }
  return out;
}

/** Problems of a template's sections JSON (Persian), or null. */
export function sectionsProblem(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return "بخش‌ها باید فهرستی از بخش‌ها باشد";
  if (raw.length > 30) return "قالب حداکثر ۳۰ بخش دارد";
  for (const [i, r] of raw.entries()) {
    if (!r || typeof r !== "object" || !String((r as Record<string, unknown>).label ?? "").trim()) return `بخش ${i + 1} عنوان ندارد`;
  }
  return null;
}

/** The skeleton of a new article: one `##` heading per section (public ones in the body, internal ones apart). */
export function templateSkeleton(sections: TemplateSection[]): { body: string; internal: string } {
  const pub = sections.filter((s) => !s.internal).map((s) => `## ${s.label}\n\n`);
  const int = sections.filter((s) => s.internal).map((s) => `## ${s.label}\n\n`);
  return { body: pub.join("\n").trim() ? `${pub.join("\n").trimEnd()}\n` : "", internal: int.join("\n").trim() ? `${int.join("\n").trimEnd()}\n` : "" };
}

/** Required template sections that are empty (or missing) in the body / internal part. */
export function missingSections(sections: TemplateSection[], body: string, internal: string): TemplateSection[] {
  const have = new Map<string, string>();
  for (const s of [...sectionsOf(body), ...sectionsOf(internal)]) have.set(searchForm(s.title), (have.get(searchForm(s.title)) ?? "") + s.text);
  return sections.filter((s) => s.required && !(have.get(searchForm(s.label)) ?? "").replace(/<!--[\s\S]*?-->/g, "").trim());
}

/** Plain text of Markdown (for counts, excerpts and similarity). */
export function plainText(md: string): string {
  return String(md ?? "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, " "))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\{\{block:[^}]+\}\}/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s{0,3}>\s?\[!\w+\]/gm, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~|]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Words of a text (Persian half-spaces keep a word whole). */
export function wordCount(md: string): number {
  const t = plainText(md);
  return t ? t.split(/[\s]+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

/** `{{block:KBB000012}}` placeholders → block numbers, in order. */
export function blockRefs(md: string): string[] {
  return [...new Set([...String(md ?? "").matchAll(/\{\{\s*block\s*:\s*([A-Za-z]{1,6}-?\d{1,12})\s*\}\}/g)].map((m) => m[1].toUpperCase().replace("-", "")))];
}

/** Images of a text: `![alt](attachment:<id>)` and any other source (external images are not shown). */
export function imageRefs(md: string): { alt: string; src: string; attachment: string | null }[] {
  return [...String(md ?? "").matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => ({ alt: m[1].trim(), src: m[2], attachment: /^attachment:([0-9a-f-]{36})$/i.exec(m[2])?.[1]?.toLowerCase() ?? null }));
}

/** Links of a text: other articles by number (KB000123 or kb-123) and http(s) addresses. */
export function linkRefs(md: string): { articles: string[]; urls: string[] } {
  const text = String(md ?? "");
  const articles = [...new Set([...text.matchAll(/\bKB-?(\d{1,9})\b/gi)].map((m) => `KB${m[1].padStart(6, "0")}`))];
  const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s)<>"']+/gi)].map((m) => m[0].replace(/[.,;:!?]+$/, "")))];
  return { articles, urls };
}

/** The article's internal flag for the access model: «فقط کارشناسان» chosen, a KCS article not yet validated, a runbook. */
export function isInternalArticle(a: { visibility?: unknown; kcs_confidence?: unknown; article_type?: unknown }): boolean {
  return a.visibility === "internal" || a.kcs_confidence === "wip" || a.kcs_confidence === "not_validated" || a.article_type === "procedure";
}

// ---------------------------------------------------------------------------------------------------------------
// Sensitive data and unsafe commands (KB-079, KB-071)

export type SensitiveKind = "national_id" | "mobile" | "email" | "card" | "iban" | "ip" | "hostname" | "secret";

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  national_id: "کد ملی",
  mobile: "شمارهٔ همراه",
  email: "نشانی ایمیل",
  card: "شمارهٔ کارت",
  iban: "شمارهٔ شبا",
  ip: "نشانی IP",
  hostname: "نام رایانهٔ داخلی",
  secret: "گذرواژه یا کلید",
};

export interface Finding {
  kind: SensitiveKind;
  label: string;
  start: number;
  end: number;
  text: string;
}

const D = "[0-9۰-۹٠-٩]";
const latin = (s: string) => s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));

const PATTERNS: { kind: SensitiveKind; re: RegExp; check?: (m: string) => boolean }[] = [
  { kind: "secret", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: "secret", re: /\b(?:password|passwd|pwd|secret|api[_-]?key|token|گذرواژه|رمز عبور|رمز)\s*[:=]\s*\S{4,}/giu },
  { kind: "secret", re: /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,})\b/g },
  { kind: "iban", re: new RegExp(`\\bIR[\\s-]?(?:${D}[\\s-]?){23}${D}`, "gi"), check: (m) => isIban(latin(m).replace(/[\s-]/g, "")) },
  { kind: "card", re: new RegExp(`(?<!${D})${D}{4}[\\s-]?${D}{4}[\\s-]?${D}{4}[\\s-]?${D}{4}(?!${D})`, "g"), check: (m) => isCardNumber(latin(m).replace(/[\s-]/g, "")) },
  { kind: "mobile", re: new RegExp(`(?<!${D})(?:\\+?98|0098|[0۰])?[9۹]${D}{9}(?!${D})`, "g") },
  { kind: "national_id", re: new RegExp(`(?<!${D})${D}{3}-?${D}{6}-?${D}(?!${D})`, "g"), check: (m) => isNationalId(latin(m).replace(/-/g, "")) },
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "ip", re: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, check: (m) => !/^(?:0\.0\.0\.0|127\.0\.0\.1|255\.255\.255\.\d+)$/.test(m) },
  { kind: "hostname", re: /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:local|lan|corp|internal|intra|ad|domain)\b/gi },
];

/** Personal data, credentials and internal addresses in a text, in order of appearance (overlaps dropped). */
export function scanSensitive(text: string, opts: { kinds?: SensitiveKind[] } = {}): Finding[] {
  const s = String(text ?? "");
  const found: Finding[] = [];
  for (const p of PATTERNS) {
    if (opts.kinds && !opts.kinds.includes(p.kind)) continue;
    p.re.lastIndex = 0;
    for (const m of s.matchAll(p.re)) {
      const t = m[0];
      if (p.check && !p.check(t)) continue;
      const start = m.index ?? 0;
      found.push({ kind: p.kind, label: SENSITIVE_LABELS[p.kind], start, end: start + t.length, text: t });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Finding[] = [];
  for (const f of found) if (!out.length || f.start >= out[out.length - 1].end) out.push(f);
  return out.slice(0, 200);
}

/** The text with every finding masked («***1234», secrets wholly). */
export function redactSensitive(text: string, findings = scanSensitive(text)): string {
  let s = String(text ?? "");
  for (const f of [...findings].sort((a, b) => b.start - a.start)) {
    const keep = f.kind === "secret" || f.kind === "hostname" || f.kind === "email" ? "" : latin(f.text).replace(/[\s-]/g, "").slice(-4);
    const mask = f.kind === "email" ? "[ایمیل حذف شد]" : f.kind === "secret" ? "[محرمانه حذف شد]" : f.kind === "hostname" ? "[نام رایانه حذف شد]" : `***${keep}`;
    s = s.slice(0, f.start) + mask + s.slice(f.end);
  }
  return s;
}

const UNSAFE: { re: RegExp; label: string }[] = [
  { re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(?:\/|~|\*|--no-preserve-root)/gi, label: "حذف بازگشتی پوشه‌ها (rm -rf)" },
  { re: /\bmkfs(?:\.\w+)?\s+\/dev\//gi, label: "قالب‌بندی دیسک (mkfs)" },
  { re: /\bdd\s+if=\S+\s+of=\/dev\//gi, label: "بازنویسی دیسک (dd)" },
  { re: /\bformat\s+[a-z]:/gi, label: "قالب‌بندی درایو (format)" },
  { re: /\bdel\s+\/[sfq]\b[^\n]*\/[sfq]\b/gi, label: "حذف گروهی فایل‌ها (del /s /q)" },
  { re: /\brd\s+\/s\s+\/q\b/gi, label: "حذف بازگشتی پوشه (rd /s /q)" },
  { re: /\breg\s+delete\b/gi, label: "حذف کلید رجیستری (reg delete)" },
  { re: /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/gi, label: "حذف بازگشتی در PowerShell" },
  { re: /\bdrop\s+(?:table|database|schema)\b/gi, label: "حذف جدول یا پایگاه داده (DROP)" },
  { re: /\btruncate\s+table\b/gi, label: "خالی کردن جدول (TRUNCATE)" },
  { re: /\b(?:shutdown|reboot)\s+(?:-[a-z]+\s*)*(?:now|\/s|\/r)\b/gi, label: "خاموش یا راه‌اندازی دوباره" },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/g, label: "بمب فرایند (fork bomb)" },
  { re: /\bchmod\s+-R\s+777\s+\//gi, label: "باز کردن همهٔ دسترسی‌ها (chmod 777 /)" },
];

/** Destructive commands a reader could run by copying (the validation of drafts warns about them). */
export function unsafeCommands(text: string): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const u of UNSAFE) {
    u.re.lastIndex = 0;
    const m = u.re.exec(String(text ?? ""));
    if (m) out.push({ label: u.label, text: m[0].slice(0, 120) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Quality checks (KB-074, rule-based; the AI layer may add its own rubric)

export interface QualityInput {
  title: string;
  summary?: string | null;
  body?: string | null;
  internal_body?: string | null;
  article_type?: string | null;
  keywords?: string[] | null;
  sections?: TemplateSection[];
  /** the article reaches requesters (its internal part does not count) */
  external?: boolean;
}

export interface QualityItem {
  key: string;
  label: string;
  ok: boolean;
  /** what to do when it is not ok */
  hint?: string;
  /** blocks submission (sensitive data, missing required sections) */
  blocking?: boolean;
  weight: number;
}

export interface QualityReport {
  items: QualityItem[];
  score: number;
  blocking: QualityItem[];
  findings: Finding[];
  unsafe: { label: string; text: string }[];
  words: number;
  readability: number;
}

/** Words per sentence → 0 (hard) … 100 (easy). */
export function readability(md: string): number {
  const t = plainText(md);
  if (!t) return 100;
  const sentences = t.split(/[.!?؟؛\n]+/).map((s) => s.trim()).filter(Boolean);
  const words = t.split(/\s+/).filter(Boolean).length;
  const avg = words / Math.max(1, sentences.length);
  return Math.max(0, Math.min(100, Math.round(100 - (avg - 12) * 4)));
}

export function qualityChecks(a: QualityInput): QualityReport {
  const body = String(a.body ?? "");
  const internal = String(a.internal_body ?? "");
  const words = wordCount(body) + wordCount(internal);
  const title = String(a.title ?? "").trim();
  const heads = headings(body);
  const imgs = imageRefs(body + "\n" + internal);
  const findings = a.external ? scanSensitive(`${title}\n${a.summary ?? ""}\n${body}`) : [];
  const unsafe = unsafeCommands(`${body}\n${internal}`);
  const missing = a.sections ? missingSections(a.sections, body, internal) : [];
  const stepsWanted = ["how_to", "troubleshooting", "kcs", "procedure"].includes(String(a.article_type ?? ""));
  let headingJump = false;
  for (let i = 1; i < heads.length; i++) if (heads[i].level > heads[i - 1].level + 1) headingJump = true;
  const read = readability(body);
  const items: QualityItem[] = [
    { key: "title", label: "عنوان، مسئله را روشن می‌گوید", ok: title.length >= 10 && title.length <= 140, hint: "عنوانی بین ۱۰ تا ۱۴۰ نویسه که نشانهٔ مسئله را با واژه‌های کاربر بگوید", weight: 15 },
    { key: "summary", label: "خلاصه دارد", ok: String(a.summary ?? "").trim().length >= 20, hint: "یک یا دو جمله خلاصه برای کارت مقاله و نتیجهٔ جست‌وجو", weight: 10 },
    { key: "length", label: "اندازهٔ مناسب", ok: words >= 30 && words <= 3000, hint: words < 30 ? "متن کوتاه است؛ گام‌ها یا توضیح بیشتری بنویسید" : "متن بلند است؛ آن را به چند مقاله بشکنید", weight: 10 },
    { key: "steps", label: "گام‌های شماره‌دار", ok: !stepsWanted || /^\s{0,3}\d+[.)]\s+\S/m.test(body + "\n" + internal), hint: "راه‌حل را با گام‌های شماره‌دار و قابل بررسی بنویسید", weight: 15 },
    { key: "sections", label: "بخش‌های الزامی قالب پر شده است", ok: !missing.length, hint: missing.length ? `این بخش‌ها خالی‌اند: ${missing.map((m) => m.label).join("، ")}` : undefined, blocking: missing.length > 0, weight: 15 },
    { key: "keywords", label: "کلیدواژه دارد", ok: (a.keywords ?? []).length > 0, hint: "چند کلیدواژه (هم‌معنی‌ها، نام خطا، نام نرم‌افزار) بیفزایید", weight: 5 },
    { key: "headings", label: "ترتیب سرفصل‌ها", ok: !headingJump, hint: "سطح سرفصل‌ها را پشت‌سرهم نگه دارید (پس از ## از ### استفاده کنید، نه ####)", weight: 5 },
    { key: "alt", label: "تصویرها توضیح دارند", ok: imgs.every((i) => i.alt.length > 0), hint: "برای هر تصویر متن جایگزین بنویسید", weight: 5 },
    { key: "readability", label: "خوانایی", ok: read >= 40, hint: "جمله‌ها را کوتاه‌تر کنید", weight: 5 },
    { key: "unsafe", label: "بدون فرمان خطرناک بی‌هشدار", ok: !unsafe.length, hint: unsafe.length ? `پیش از ${unsafe.map((u) => u.label).join("، ")} هشدار بگذارید یا آن را به بخش داخلی ببرید` : undefined, weight: 5 },
    { key: "sensitive", label: "بدون داده شخصی و گذرواژه در بخش بیرونی", ok: !findings.length, hint: findings.length ? `این‌ها را حذف یا پنهان کنید: ${[...new Set(findings.map((f) => f.label))].join("، ")}` : undefined, blocking: findings.length > 0, weight: 10 },
  ];
  const score = Math.max(0, 100 - items.filter((i) => !i.ok).reduce((s, i) => s + i.weight, 0));
  return { items, score, blocking: items.filter((i) => !i.ok && i.blocking), findings, unsafe, words, readability: read };
}

// ---------------------------------------------------------------------------------------------------------------
// Line diff of two versions (KB-015)

export interface DiffLine {
  op: "same" | "add" | "del";
  text: string;
}

/** Line-by-line diff (longest common subsequence; very long texts fall back to replacing what differs). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = String(before ?? "").split(/\r?\n/);
  const b = String(after ?? "").split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ op: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ op: "same", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  let mid: DiffLine[];
  if (x.length * y.length > 4_000_000) {
    mid = [...x.map((text) => ({ op: "del" as const, text })), ...y.map((text) => ({ op: "add" as const, text }))];
  } else {
    const n = x.length;
    const m = y.length;
    const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        mid.push({ op: "same", text: x[i] });
        i++;
        j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) mid.push({ op: "del", text: x[i++] });
      else mid.push({ op: "add", text: y[j++] });
    }
    while (i < n) mid.push({ op: "del", text: x[i++] });
    while (j < m) mid.push({ op: "add", text: y[j++] });
  }
  return [...head, ...mid, ...tail];
}

/** Counts of a diff. */
export const diffStats = (d: DiffLine[]) => ({ added: d.filter((l) => l.op === "add").length, removed: d.filter((l) => l.op === "del").length });

// ---------------------------------------------------------------------------------------------------------------
// Similarity (KB-073)

/** Hashed word shingles of the search form (k words each). */
export function shingles(text: string, k = 3): Set<number> {
  const w = searchForm(plainText(text)).split(" ").filter((x) => x.length > 1).map(stem);
  const out = new Set<number>();
  if (w.length < k) {
    if (w.length) out.add(hash(w.join(" ")));
    return out;
  }
  for (let i = 0; i + k <= w.length; i++) out.add(hash(w.slice(i, i + k).join(" ")));
  return out;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Jaccard similarity of two shingle sets, 0…1. */
export function jaccard(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Similarity of two articles in percent: the containment of the smaller text in the larger, blended with the titles. */
export function similarity(a: { title: string; body: string }, b: { title: string; body: string }): number {
  const sa = shingles(`${a.title}\n${a.body}`);
  const sb = shingles(`${b.title}\n${b.body}`);
  let inter = 0;
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  for (const x of small) if (big.has(x)) inter++;
  const containment = small.size ? inter / small.size : 0;
  const ta = new Set(queryTerms(a.title).map(stem));
  const tb = new Set(queryTerms(b.title).map(stem));
  const tInter = [...ta].filter((t) => tb.has(t)).length;
  const titleSim = ta.size + tb.size ? (2 * tInter) / (ta.size + tb.size) : 0;
  return Math.round(100 * (0.75 * Math.max(containment, jaccard(sa, sb)) + 0.25 * titleSim));
}

// ---------------------------------------------------------------------------------------------------------------
// Versions

export const versionLabel = (major: number, minor: number) => `${major}.${minor}`;

/** The number of the next version after (major, minor): a minor edit or a new major version. */
export function nextVersion(major: number, minor: number, kind: "minor" | "major", published: boolean): { major: number; minor: number; label: string } {
  if (!published) return { major: Math.max(1, major), minor: major ? minor : 0, label: versionLabel(Math.max(1, major), major ? minor : 0) };
  const next = kind === "major" ? { major: major + 1, minor: 0 } : { major: Math.max(1, major), minor: minor + 1 };
  return { ...next, label: versionLabel(next.major, next.minor) };
}

/** A content hash of a version (what readers would see), FNV-1a over the fields. */
export function contentHash(v: { title?: unknown; summary?: unknown; body?: unknown; internal_body?: unknown; keywords?: unknown; tags?: unknown }): string {
  const s = JSON.stringify([v.title ?? "", v.summary ?? "", v.body ?? "", v.internal_body ?? "", v.keywords ?? [], v.tags ?? []]);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Health score and next action (KB-057, KB-075)

export interface HealthInput {
  /** days until valid-to (negative: expired), null = no end */
  daysToExpiry: number | null;
  /** days past the review date (negative: before it), null = no review date */
  daysPastReview: number | null;
  helpfulYes: number;
  helpfulNo: number;
  views90: number;
  reuse90: number;
  openFlags: number;
  duplicate: boolean;
  aqi: number | null;
  quality: number | null;
  translationStale: boolean;
  daysSinceUse: number | null;
}

export interface HealthResult {
  score: number;
  next_action: "none" | "review" | "update" | "merge" | "retire" | "translate";
  parts: Record<string, number>;
}

export function healthScore(h: HealthInput, staleDays = 365): HealthResult {
  const parts: Record<string, number> = {};
  // freshness 30
  parts.freshness = h.daysPastReview === null ? 22 : h.daysPastReview > 0 ? Math.max(0, 30 - Math.min(30, Math.round(h.daysPastReview / 6))) : 30;
  if (h.daysToExpiry !== null && h.daysToExpiry < 0) parts.freshness = 0;
  // feedback 25
  const votes = h.helpfulYes + h.helpfulNo;
  parts.feedback = votes < 3 ? 18 : Math.round(25 * (h.helpfulYes / votes));
  // usage 20
  parts.usage = Math.min(20, Math.round(4 * Math.log2(1 + h.views90 + 5 * h.reuse90)));
  // quality 15
  const q = h.aqi ?? h.quality;
  parts.quality = q === null ? 10 : Math.round(15 * Math.max(0, Math.min(100, q)) / 100);
  // flags and duplicates 10
  parts.integrity = Math.max(0, 10 - 4 * h.openFlags - (h.duplicate ? 6 : 0));
  const score = Math.max(0, Math.min(100, Object.values(parts).reduce((s, v) => s + v, 0)));
  let next: HealthResult["next_action"] = "none";
  if (h.duplicate) next = "merge";
  else if (h.daysToExpiry !== null && h.daysToExpiry < 0) next = "retire";
  else if (h.openFlags > 0 || (votes >= 5 && h.helpfulNo / votes > 0.4)) next = "update";
  else if (h.daysPastReview !== null && h.daysPastReview > 0) next = "review";
  else if (h.daysSinceUse !== null && h.daysSinceUse > staleDays && h.views90 === 0) next = "retire";
  else if (h.translationStale) next = "translate";
  return { score, next_action: next, parts };
}

/** Article Quality Index of one review: 100 − the weights of the items judged not met. */
export function aqiScore(results: Record<string, unknown>, items: { key: string; weight: number }[]): number {
  const failed = items.filter((i) => results[i.key] === false).reduce((s, i) => s + i.weight, 0);
  return Math.max(0, 100 - failed);
}

// ---------------------------------------------------------------------------------------------------------------
// KCS capture from a resolved record (KB-013): issue in the requester's words, environment, cause, resolution

export interface CaptureSource {
  table: string;
  number?: string | null;
  title?: string | null;
  description?: string | null;
  resolution?: string | null;
  cause?: string | null;
  workaround?: string | null;
  symptoms?: string | null;
  environment?: string[];
  keywords?: string[];
}

/** Remove people's names, contacts and identifiers from a captured text. */
export function scrubPeople(text: string, names: (string | null | undefined)[]): string {
  let s = redactSensitive(String(text ?? ""), scanSensitive(String(text ?? ""), { kinds: ["national_id", "mobile", "email", "card", "iban", "secret"] }));
  for (const n of names) {
    const name = String(n ?? "").trim();
    if (name.length < 3) continue;
    s = s.split(name).join("[کاربر]");
  }
  return s;
}

/** The KCS draft of a record (Markdown sections; requester data scrubbed by the caller with `scrubPeople`). */
export function captureDraft(src: CaptureSource): { title: string; summary: string; body: string; internal_body: string; keywords: string[] } {
  const title = String(src.title ?? "").trim().slice(0, 250) || "مقالهٔ تازه";
  const section = (label: string, text: string | null | undefined) => `## ${label}\n\n${String(text ?? "").trim()}\n`;
  const env = (src.environment ?? []).filter(Boolean);
  const body = [
    section("مسئله", [src.symptoms, src.description].filter((x) => x && String(x).trim()).join("\n\n") || title),
    section("محیط", env.length ? env.map((e) => `- ${e}`).join("\n") : ""),
    section("راه‌حل", src.resolution ?? src.workaround ?? ""),
    section("علت", src.cause ?? ""),
  ].join("\n");
  const internal = src.workaround && src.resolution ? section("راه‌حل موقت", src.workaround) : "";
  const keywords = [...new Set([...(src.keywords ?? []), ...queryTerms(title).slice(0, 5)])].slice(0, 12);
  return { title, summary: String(src.description ?? "").trim().split(/\n/)[0].slice(0, 300), body: body.trim() + "\n", internal_body: internal.trim() ? `${internal.trim()}\n` : "", keywords };
}

// ---------------------------------------------------------------------------------------------------------------
// Search helpers

/** Query terms (stop words out, light stems) and quoted phrases, both in the search form. */
export function parseQuery(q: string): { terms: string[]; phrases: string[] } {
  const raw = String(q ?? "").slice(0, 300);
  const phrases = [...raw.matchAll(/["«]([^"»]{2,80})["»]/g)].map((m) => searchForm(m[1])).filter(Boolean);
  const rest = raw.replace(/["«][^"»]*["»]/g, " ");
  return { terms: queryTerms(rest).map(stem).filter((t) => t.length >= 2 || /\d/.test(t)), phrases };
}

/** Ranges of `text` matching any term (search-form comparison), merged, for highlighting. */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  const s = String(text ?? "");
  if (!terms.length || !s) return [];
  const out: [number, number][] = [];
  const re = /[\p{L}\p{N}‌]+/gu;
  for (const m of s.matchAll(re)) {
    const w = searchForm(m[0]);
    if (terms.some((t) => t && (w.startsWith(t) || (t.length >= 4 && w.includes(t))))) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  return out;
}

/** An excerpt of about `max` characters around the first match of the terms (plain text). */
export function excerpt(md: string, terms: string[], max = 220): string {
  const t = plainText(md).replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const ranges = highlightRanges(t, terms);
  const at = ranges.length ? ranges[0][0] : 0;
  let from = Math.max(0, at - Math.floor(max / 3));
  const sp = t.lastIndexOf(" ", from);
  if (sp > 0 && at - sp < max / 2) from = sp + 1;
  const piece = t.slice(from, from + max);
  return `${from > 0 ? "… " : ""}${piece.trim()}${from + max < t.length ? " …" : ""}`;
}
