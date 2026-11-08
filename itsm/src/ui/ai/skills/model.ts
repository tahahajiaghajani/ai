// Pure logic of the AI skills screens (tests: tests/ai-skills-ui.test.ts): which skills a surface shows, parameters
// with their defaults, a structured answer as readable Markdown, the composer's tools per tab, confidence words, the
// prompt diff of two versions and the admin list's grouping.
import { diffLines, type DiffLine, type SkillAdminItem, type SkillCard, type SkillParamDef, type SkillRunResult } from "@shared/ai/skills";

/** Skills of the record panel: record skills of the panel surface, available first, then by order. */
export function panelSkills(cards: SkillCard[]): SkillCard[] {
  return cards
    .filter((c) => c.target === "record" && c.surfaces.includes("panel"))
    .sort((a, b) => Number(b.available) - Number(a.available) || a.order - b.order || a.name.localeCompare(b.name, "fa"));
}

/** The composer's AI tools for a tab: drafts of the record for that tab, then the writing tools of the text. */
export function composerSkills(cards: SkillCard[], kind: "comment" | "work_note"): { drafts: SkillCard[]; tools: SkillCard[] } {
  const drafts = cards.filter((c) => c.target === "record" && c.surfaces.includes("composer") && (c.composer === kind || c.composer === "both"));
  const tools = cards.filter((c) => c.target === "text" && c.surfaces.includes("composer"));
  const order = (a: SkillCard, b: SkillCard) => a.order - b.order || a.name.localeCompare(b.name, "fa");
  return { drafts: drafts.sort(order), tools: tools.sort(order) };
}

/** Writing tools of a rich-text field. */
export function fieldSkills(cards: SkillCard[]): SkillCard[] {
  return cards.filter((c) => c.target === "text" && c.surfaces.includes("field")).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "fa"));
}

/** Parameter values a run starts with (the declared defaults). */
export function defaultParams(params: SkillParamDef[]): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const p of params) if (p.default !== undefined && p.default !== null) out[p.name] = p.default;
  return out;
}

/** Missing required parameters (Persian labels), or an empty list. */
export function missingParams(params: SkillParamDef[], values: Record<string, unknown>): string[] {
  return params.filter((p) => p.required && (values[p.name] === undefined || values[p.name] === null || values[p.name] === "")).map((p) => p.label);
}

const KEY_LABEL: Record<string, string> = {
  subject: "موضوع",
  body: "متن",
  title: "عنوان",
  summary: "خلاصه",
  sentiment: "حال",
  score: "امتیاز",
  signals: "نشانه‌ها",
  escalate: "نیاز به تشدید",
  advice: "توصیه",
  whys: "پنج چرا",
  question: "پرسش",
  answer: "پاسخ",
  fishbone: "استخوان ماهی",
  hypotheses: "فرضیه‌ها",
  text: "متن",
  evidence: "شاهد",
  confidence: "اطمینان",
  conclusion: "نتیجه‌گیری",
  verdict: "داوری",
  reason: "دلیل",
  merged: "متن ادغام‌شده",
  criteria: "معیارها",
  met: "برآورده",
  suggestions: "پیشنهادها",
  issues: "ایرادها",
  description: "شرح",
  value_proposition: "ارزش پیشنهادی",
  outcomes: "نتیجه‌های مورد انتظار",
  faq: "پرسش‌های رایج",
  q: "پرسش",
  a: "پاسخ",
  name: "نام",
  symptoms: "نشانه‌ها",
  workaround: "راه‌حل موقت",
  root_cause: "علت",
  short_description: "عنوان",
  side_effects: "اثرهای جانبی",
  went_well: "آنچه خوب پیش رفت",
  went_wrong: "آنچه خوب پیش نرفت",
  lessons: "درس‌ها",
  follow_up: "کارهای پیگیری",
  keywords: "واژه‌های کلیدی",
  recommendations: "پیشنهادها",
  survivor: "پیکربندی ماندنی",
};

const VALUE_LABEL: Record<string, string> = {
  positive: "مثبت",
  neutral: "خنثی",
  concerned: "نگران",
  frustrated: "کلافه",
  angry: "خشمگین",
  duplicate: "تکراری",
  overlapping: "هم‌پوشان",
  distinct: "متمایز",
  contradicting: "متناقض",
  low: "کم",
  medium: "متوسط",
  high: "زیاد",
};

const label = (k: string) => KEY_LABEL[k] ?? k;

function scalar(v: unknown): string {
  if (v === true) return "بله";
  if (v === false) return "خیر";
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return VALUE_LABEL[v] ?? v;
  return String(v);
}

/** A structured answer as Markdown: texts as paragraphs under their labels, lists as bullets, nested objects indented. */
export function jsonToMarkdown(json: unknown, depth = 0): string {
  if (json === null || json === undefined) return "";
  if (typeof json !== "object") return scalar(json);
  const pad = "  ".repeat(depth);
  if (Array.isArray(json)) {
    return json
      .map((x) => {
        if (x && typeof x === "object" && !Array.isArray(x)) {
          const entries = Object.entries(x as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "");
          const [first, ...rest] = entries;
          if (!first) return "";
          const head = `${pad}- ${typeof first[1] === "object" ? `**${label(first[0])}**` : `${scalar(first[1])}`}`;
          const tail = rest.map(([k, v]) => (typeof v === "object" ? `${pad}  - **${label(k)}**:\n${jsonToMarkdown(v, depth + 2)}` : `${pad}  - ${label(k)}: ${scalar(v)}`));
          return [head, ...tail].join("\n");
        }
        return `${pad}- ${scalar(x)}`;
      })
      .filter(Boolean)
      .join("\n");
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (depth === 0) {
      if (typeof v === "string" && v.length > 80) parts.push(`**${label(k)}**\n\n${v}`);
      else if (typeof v === "object") parts.push(`**${label(k)}**\n\n${jsonToMarkdown(v, 0)}`);
      else parts.push(`**${label(k)}**: ${scalar(v)}`);
    } else if (typeof v === "object") parts.push(`${pad}- **${label(k)}**:\n${jsonToMarkdown(v, depth + 1)}`);
    else parts.push(`${pad}- ${label(k)}: ${scalar(v)}`);
  }
  return parts.join(depth === 0 ? "\n\n" : "\n");
}

/** What the panel shows of a result: its text, or its structured answer as Markdown. */
export function resultMarkdown(r: Pick<SkillRunResult, "output" | "text" | "json" | "journal" | "record">): string {
  if (r.output === "journal") return r.journal?.body ?? r.text ?? "";
  if (r.output === "record") return jsonToMarkdown(r.record?.data ?? r.json);
  if (r.output === "json") return jsonToMarkdown(r.json);
  return r.text ?? "";
}

/** Text a structured answer would put into a composer or a field (a stakeholder update's body, a draft's text). */
export function insertableText(r: Pick<SkillRunResult, "output" | "text" | "json" | "journal">): string {
  if (r.output === "journal") return r.journal?.body ?? "";
  if (r.output === "json" && r.json && typeof r.json === "object") {
    const j = r.json as Record<string, unknown>;
    for (const k of ["body", "text", "description", "summary"]) if (typeof j[k] === "string" && j[k]) return String(j[k]);
  }
  return r.text ?? "";
}

export type ConfidenceWord = "زیاد" | "متوسط" | "کم";
export function confidenceWord(c: number | null | undefined): ConfidenceWord | null {
  if (typeof c !== "number") return null;
  return c >= 0.75 ? "زیاد" : c >= 0.45 ? "متوسط" : "کم";
}

/** The diff of two prompts (system and template together), with line counts for the summary. */
export function promptDiff(a: { system: string; template: string }, b: { system: string; template: string }): { lines: DiffLine[]; added: number; removed: number } {
  const lines = [...diffLines(a.system, b.system), { op: "same" as const, text: "────────" }, ...diffLines(a.template, b.template)];
  return { lines, added: lines.filter((l) => l.op === "add").length, removed: lines.filter((l) => l.op === "del").length };
}

export const MODULE_LABEL: Record<string, string> = {
  generic: "همهٔ رکوردها",
  incident: "رخداد",
  problem: "مشکل",
  change: "تغییر",
  request: "درخواست خدمت",
  knowledge: "دانش",
  cmdb: "پیکربندی",
  service: "سبد خدمات",
};

/** The admin list grouped by module, in a fixed order; a filter on name, key or description. */
export function groupAdmin(items: SkillAdminItem[], q = ""): { module: string; label: string; items: SkillAdminItem[] }[] {
  const needle = q.trim().toLowerCase();
  const hit = (s: SkillAdminItem) => !needle || [s.name, s.key, s.description].some((x) => x.toLowerCase().includes(needle));
  const order = Object.keys(MODULE_LABEL);
  const by = new Map<string, SkillAdminItem[]>();
  for (const s of items.filter(hit)) by.set(s.module, [...(by.get(s.module) ?? []), s]);
  return [...by.entries()]
    .sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)))
    .map(([module, list]) => ({ module, label: MODULE_LABEL[module] ?? module, items: list.sort((x, y) => x.name.localeCompare(y.name, "fa")) }));
}
