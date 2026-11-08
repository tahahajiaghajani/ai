// Contracts of the AI skills framework (docs/spec/AI.md §11), shared by the server (src/server/modules/ai/skills, the
// routes in src/server/routes/ai-skills.ts) and the UI (the «هوش مصنوعی» record panel, the composer and field assists,
// the admin «مهارت‌ها»). Client-safe: no server imports. Paths are relative to /api/o/:org/ai:
//
//   GET  /skills/for/:table/:id          → { skills: SkillCard[], proposals: AiProposal[] }  skills of a record (reads it)
//   GET  /skills/for/:table              → { skills: SkillCard[] }                           text and table skills
//   POST /skills/:key/run                SkillRunRequest → SkillRunResult                    (runs as the caller)
//   POST /skills/:key/run/stream         SkillRunRequest → text/event-stream of SkillStreamEvent
//   POST /skills/runs/:id/feedback       { rating: 1 | -1 | null, comment? } → { ok }        (its author)
//   GET  /skills/runs?table&id&mine      → { runs: SkillRunView[] }                           own runs (admins: all)
//   GET  /skills/admin                   → SkillAdminView                                     (ai:full)
//   PATCH /skills/admin/:key             SkillConfigPatch → { skill }                         (ai:full)
//   POST /skills/admin/:key/versions     { system, template, output_schema?, temperature?, max_tokens?, note } → { version }
//   POST /skills/admin/:key/publish      { version_id | null } → { skill }   publish / roll back (null = the built-in default)
//   POST /skills/admin/:key/copy         { key, name } → { skill }
//   POST /skills/admin/:key/test         { version_id?, table?, id?, text?, params? } → SkillRunResult (the admin's own access)
//   POST /skills/admin/:key/evals/run    { eval_id? } → { evals: SkillEvalView[] }
//   GET  /skills/admin/usage             ?from&to → { rows: SkillUsageRow[] }
//   POST /skills/admin/principal         { roles } → { principal }  the «دستیار هوش مصنوعی» service member and its roles
//
// The promise: a skill reads a record only through the caller's access (or, when an event or a schedule triggers it,
// through the service member's), every record text reaches a model only inside a data block, every write is a proposal
// a person applies, and a run is private to the member who started it.
import type { AiJob, AiProposal } from "./types";

// ---------------------------------------------------------------- vocabulary

/** What a skill produces. */
export type SkillOutputKind = "text" | "json" | "fields" | "journal" | "record";
/** The model tier: fast → the «fast» job, standard → «assistant», reasoning → «analysis» (each job has its chain). */
export type SkillTier = "fast" | "standard" | "reasoning";
/** Where a grounded skill looks for sources (always with the caller's access). */
export type SkillGrounding = "none" | "similar" | "knowledge" | "documents";
/** What a skill works on: a record, a piece of text (with an optional record for context) or only its parameters. */
export type SkillTarget = "record" | "text" | "none";
export type SkillTrigger = "manual" | "event" | "schedule";
/** Record events an event-triggered skill reacts to. */
export type SkillEventKind = "created" | "updated" | "assigned" | "state_changed" | "commented";
/** Where the UI offers a skill. */
export type SkillSurface = "panel" | "composer" | "field" | "module";

export const SKILL_OUTPUTS: Record<SkillOutputKind, string> = {
  text: "متن",
  json: "دادهٔ ساختاریافته",
  fields: "پیشنهاد مقدار فیلدها",
  journal: "پیش‌نویس یادداشت",
  record: "پیش‌نویس رکورد تازه",
};

export const SKILL_TIERS: Record<SkillTier, { label: string; job: AiJob }> = {
  fast: { label: "سریع", job: "fast" },
  standard: { label: "استاندارد", job: "assistant" },
  reasoning: { label: "استدلالی", job: "analysis" },
};

export const tierJob = (t: SkillTier): AiJob => SKILL_TIERS[t]?.job ?? "assistant";

export const SKILL_GROUNDINGS: Record<SkillGrounding, string> = {
  none: "بدون منبع",
  similar: "رکوردهای مشابه همین جدول",
  knowledge: "پایگاه دانش",
  documents: "اسناد هوشمند",
};

export const SKILL_TRIGGERS: Record<SkillTrigger, string> = {
  manual: "به درخواست کاربر",
  event: "با رویداد رکورد",
  schedule: "زمان‌بندی‌شده",
};

export const SKILL_EVENTS: Record<SkillEventKind, string> = {
  created: "ثبت رکورد",
  updated: "تغییر رکورد",
  assigned: "واگذاری",
  state_changed: "تغییر وضعیت",
  commented: "یادداشت تازه",
};

export const SKILL_TARGETS: Record<SkillTarget, string> = {
  record: "یک رکورد",
  text: "یک متن",
  none: "ورودی‌های مهارت",
};

/** The label every AI output carries (catalogue AI-164). */
export const SKILL_AI_LABEL = "ساخته‌شده با هوش مصنوعی — پیش از استفاده بازبینی کنید";
/** The label of an output a skill's rule-based fallback made because no model could answer. */
export const SKILL_FALLBACK_LABEL = "بدون مدل هوش مصنوعی و با قاعده ساخته شد — پیش از استفاده بازبینی کنید";
/** Why a skill without a fallback is off when no model is configured. */
export const SKILL_NO_MODEL = "برای این مهارت مدل هوش مصنوعی لازم است؛ در تنظیمات هوش مصنوعی یک اتصال بسازید.";
/** The in-app path of the AI settings (the «no model» link). */
export const AI_SETTINGS_PATH = "settings/ai";
export const SKILLS_ADMIN_PATH = "settings/ai?tab=skills";

/** Field groups a skill may be allowed to read (never `ai_private`, which never reaches a model). */
export const SKILL_FIELD_GROUPS = ["internal", "financial", "personal", "security", "hr", "admin"] as const;

/** A token of an auto-apply list that stands for an internal note (never a public reply). */
export const AUTO_WORK_NOTE = "work_note";

// ---------------------------------------------------------------- shapes

export interface SkillParamDef {
  name: string;
  label: string;
  type: "string" | "text" | "choice" | "number" | "bool";
  choices?: { value: string; label: string }[];
  required?: boolean;
  max?: number;
  default?: string | number | boolean | null;
  help?: string;
}

/** A skill as the record panel, the composer and the field assists see it. */
export interface SkillCard {
  key: string;
  name: string;
  description: string;
  module: string;
  output: SkillOutputKind;
  target: SkillTarget;
  tier: SkillTier;
  grounding: SkillGrounding;
  params: SkillParamDef[];
  surfaces: SkillSurface[];
  /** the composer tab it drafts for («پاسخ» is public, «یادداشت» internal) */
  composer?: "comment" | "work_note" | "both" | null;
  /** usable now (enabled, the caller's roles, a model or a fallback) */
  available: boolean;
  /** why not (Persian) */
  reason: string | null;
  /** no model answers: the skill will use its rule-based fallback */
  fallback: boolean;
  /** the reason is a missing model: link to the AI settings */
  needs_settings: boolean;
  order: number;
  icon?: string | null;
}

/** A source a grounded skill cited (always a record the caller may read). */
export interface SkillCitation {
  n: number;
  table: string;
  table_label: string;
  id: string;
  number: string | null;
  title: string;
  path: string;
  field_label: string | null;
}

/** One suggested field value (output kind «fields»), shown as a diff against the current value. */
export interface SkillFieldSuggestion {
  field: string;
  label: string;
  value: unknown;
  display: string;
  current: unknown;
  current_display: string;
  confidence: number | null;
  reason: string | null;
}

export interface SkillRunRequest {
  table?: string | null;
  id?: string | null;
  /** the text of a text skill (the composer's draft, a field's value) */
  text?: string | null;
  params?: Record<string, unknown>;
  /** store the output's writes as a proposal on the record (default true; the composer inserts drafts instead) */
  propose?: boolean;
}

export interface SkillRunResult {
  run_id: string | null;
  skill: string;
  name: string;
  output: SkillOutputKind;
  /** text, journal and record outputs (Markdown) */
  text: string | null;
  /** json outputs */
  json: unknown;
  suggestions: SkillFieldSuggestion[];
  journal: { kind: "comment" | "work_note"; body: string } | null;
  record: { table: string; data: Record<string, unknown> } | null;
  citations: SkillCitation[];
  model: string | null;
  connection: string | null;
  fallback: boolean;
  /** the AI label to show next to the output */
  label: string;
  /** writes the output proposes (applied by a person) */
  proposal: AiProposal | null;
  usage: { input: number; output: number; cost_usd: string | null; ms: number };
}

export type SkillStreamEvent =
  | { type: "meta"; skill: string; name: string }
  | { type: "text"; delta: string }
  | { type: "done"; result: SkillRunResult }
  | { type: "error"; kind: string; message_fa: string; needs_settings?: boolean };

export type SkillRunStatus = "ok" | "fallback" | "error";

/** A stored run as its author (or an AI governance admin) sees it. */
export interface SkillRunView {
  id: string;
  skill: string;
  name: string;
  table: string | null;
  record_id: string | null;
  number: string | null;
  status: SkillRunStatus;
  output: SkillOutputKind;
  text: string | null;
  json: unknown;
  citations: SkillCitation[];
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: string | null;
  latency_ms: number;
  error: string | null;
  principal: "person" | "service";
  invoker: { id: string; name: string | null };
  feedback: 1 | -1 | null;
  feedback_comment: string | null;
  created_at: string;
}

/** Configuration of a skill (the organisation's row merged over the built-in default). */
export interface SkillConfig {
  key: string;
  name: string;
  description: string;
  module: string;
  base_key: string;
  builtin: boolean;
  enabled: boolean;
  target: SkillTarget;
  output: SkillOutputKind;
  tables: string[];
  tier: SkillTier;
  grounding: SkillGrounding;
  grounding_k: number;
  collections: string[];
  triggers: SkillTrigger[];
  events: SkillEventKind[];
  condition: unknown;
  schedule_minutes: number | null;
  schedule_filter: unknown;
  roles: string[];
  field_groups: string[];
  auto_apply: string[];
  daily_limit: number | null;
  user_daily_limit: number | null;
  active_version_id: string | null;
  /** has a rule-based fallback */
  has_fallback: boolean;
  /** catalogue references (AI-023, INC-067 …) */
  catalog: string[];
  surfaces: SkillSurface[];
  /** fields a «fields» skill may suggest */
  output_fields: string[];
}

export interface SkillVersionView {
  id: string | null;
  version: number;
  state: "draft" | "published" | "retired" | "default";
  system: string;
  template: string;
  output_schema: unknown;
  temperature: number | null;
  max_tokens: number | null;
  note: string | null;
  created_at: string | null;
  created_by: string | null;
  published_at: string | null;
}

export interface SkillEvalCase {
  name: string;
  table?: string | null;
  id?: string | null;
  text?: string | null;
  params?: Record<string, unknown>;
  expect: SkillExpectation;
}

/** Properties an eval case expects of an output (each one a check). */
export interface SkillExpectation {
  contains?: string[];
  not_contains?: string[];
  min_chars?: number;
  max_chars?: number;
  json_keys?: string[];
  language?: "fa" | "en";
  cites?: boolean;
}

export interface SkillEvalView {
  id: string;
  name: string;
  skill: string;
  cases: SkillEvalCase[];
  last_score: number | null;
  last_run_at: string | null;
  last_model: string | null;
  last_results: { case: string; score: number; checks: SkillCheck[]; error?: string | null }[];
}

export interface SkillCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SkillUsageRow {
  skill: string;
  name: string;
  runs: number;
  errors: number;
  fallbacks: number;
  up: number;
  down: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: string;
  avg_ms: number;
}

export interface SkillAdminItem extends SkillConfig {
  versions: SkillVersionView[];
  evals: SkillEvalView[];
  usage: { runs: number; up: number; down: number; cost_usd: string } | null;
}

export interface SkillAdminView {
  skills: SkillAdminItem[];
  principal: { user_id: string | null; name: string | null; roles: string[]; active: boolean };
  roles: { key: string; name: string }[];
  model: { ok: boolean; message_fa: string | null };
}

export type SkillConfigPatch = Partial<
  Pick<
    SkillConfig,
    | "name" | "description" | "enabled" | "tables" | "tier" | "grounding" | "grounding_k" | "collections" | "triggers" | "events" | "condition"
    | "schedule_minutes" | "schedule_filter" | "roles" | "field_groups" | "auto_apply" | "daily_limit" | "user_daily_limit"
  >
>;

// ---------------------------------------------------------------- templates

/**
 * Placeholders of a prompt template: `{{record}}`, `{{record.<field>}}`, `{{journal}}`, `{{related}}`, `{{links}}`,
 * `{{passages}}`, `{{text}}`, `{{params}}`, `{{params.<name>}}`, `{{facts}}`, `{{<fact>}}` (values a skill computes in
 * code), and the two plain values `{{language}}` and `{{today}}`. Every placeholder except the plain values becomes a
 * `<data name="…">` block: record and document text never reaches a model outside one.
 */
export const PLACEHOLDER_RE = /\{\{\s*([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\s*\}\}/gi;
export const DATA_PLACEHOLDERS = ["record", "journal", "related", "links", "passages", "text", "params", "facts"] as const;
export const PLAIN_PLACEHOLDERS = ["language", "today"] as const;

export const PLACEHOLDER_LABELS: Record<string, string> = {
  record: "فیلدهای رکورد که کاربر می‌بیند",
  journal: "یادداشت‌های رکورد (داخلی فقط برای کسی که می‌بیند)",
  related: "رکوردهای وابسته",
  links: "رکوردهای پیوندشده",
  passages: "منابع یافته (شماره‌دار برای ارجاع)",
  text: "متن ورودی",
  params: "پارامترها",
  facts: "داده‌های محاسبه‌شدهٔ مهارت",
  language: "زبان پاسخ",
  today: "تاریخ امروز",
};

/** The placeholders a template names (in order of first use, each once). */
export function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  for (const m of String(template ?? "").matchAll(PLACEHOLDER_RE)) {
    const name = m[1].toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Why a template is not acceptable (Persian), or null: unknown placeholders, fields the target table does not have,
 * or a template with no data at all for a skill that has a record or a text.
 */
export function templateProblem(template: string, opts: { fields?: Iterable<string>; facts?: Iterable<string>; params?: Iterable<string>; target?: SkillTarget } = {}): string | null {
  const t = String(template ?? "");
  if (!t.trim()) return "متن درخواست خالی است";
  if (t.length > 20_000) return "متن درخواست حداکثر ۲۰٬۰۰۰ نویسه است";
  const fields = new Set(opts.fields ?? []);
  const facts = new Set(opts.facts ?? []);
  const params = new Set(opts.params ?? []);
  const names = placeholdersOf(t);
  for (const n of names) {
    const [head, tail] = n.split(".");
    if (tail) {
      if (head === "record") {
        if (fields.size && !fields.has(tail)) return `فیلد «${tail}» در این جدول نیست`;
      } else if (head === "params") {
        if (params.size && !params.has(tail)) return `پارامتر «${tail}» تعریف نشده است`;
      } else return `جای‌نگهدار «{{${n}}}» شناخته نیست`;
      continue;
    }
    if ((DATA_PLACEHOLDERS as readonly string[]).includes(head) || (PLAIN_PLACEHOLDERS as readonly string[]).includes(head) || facts.has(head)) continue;
    return `جای‌نگهدار «{{${n}}}» شناخته نیست`;
  }
  const data = names.filter((n) => !(PLAIN_PLACEHOLDERS as readonly string[]).includes(n));
  if (opts.target === "record" && !data.length) return "درخواست هیچ دادهٔ رکورد را به کار نمی‌برد؛ مثلاً {{record}} را بیفزایید";
  if (opts.target === "text" && !names.includes("text")) return "درخواست متن ورودی را به کار نمی‌برد؛ {{text}} را بیفزایید";
  return null;
}

/** Tag-like text inside data that could pose as a prompt section is neutralised (‹data›); everything else stays. */
export function neutralizeTags(s: string): string {
  return s.replace(/<(\/?)(data|question|context|instructions|system|sources|user|assistant)\b/gi, "‹$1$2").replace(/(‹\/?(?:data|question|context|instructions|system|sources|user|assistant)[^>\n]*)>/gi, "$1›");
}

function neutralDeep(v: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof v === "string") return neutralizeTags(v);
  if (Array.isArray(v)) return v.map((x) => neutralDeep(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, neutralDeep(x, depth + 1)]));
  return v;
}

/**
 * Data handed to a model inside a prompt: one JSON line in a `<data name="…">` block (the format the server's data
 * policy redacts), tag-like text neutralised. JSON keeps every value on one line, so a value can never close the block.
 */
export function skillDataBlock(name: string, value: unknown): string {
  return `<data name="${String(name).replace(/["\n<>]/g, "")}">\n${JSON.stringify(neutralDeep(value ?? null))}\n</data>`;
}

/** What a placeholder resolves to: data (a block) or a plain trusted value (language, today); null = empty. */
export type PlaceholderValue = { data: unknown } | { plain: string } | null;

/**
 * Render a template: each placeholder is replaced by its data block (or plain value); unknown or empty ones by an
 * empty data block so the model sees that the data is missing rather than the raw placeholder.
 */
export function renderTemplate(template: string, resolve: (name: string) => PlaceholderValue): string {
  return String(template ?? "").replace(PLACEHOLDER_RE, (_whole, raw: string) => {
    const name = raw.toLowerCase();
    const v = resolve(name);
    if (v && "plain" in v) return v.plain;
    return skillDataBlock(name, v && "data" in v ? v.data : null);
  });
}

// ---------------------------------------------------------------- versions: a line diff

export interface DiffLine {
  op: "same" | "add" | "del";
  text: string;
}

/** Line diff of two prompts (LCS; prompts are short). */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = String(a ?? "").split("\n");
  const y = String(b ?? "").split("\n");
  if (x.length * y.length > 400_000) {
    return [...x.map((text) => ({ op: "del" as const, text })), ...y.map((text) => ({ op: "add" as const, text }))];
  }
  const n = x.length;
  const m = y.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: "same", text: x[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "del", text: x[i++] });
    else out.push({ op: "add", text: y[j++] });
  }
  while (i < n) out.push({ op: "del", text: x[i++] });
  while (j < m) out.push({ op: "add", text: y[j++] });
  return out;
}

// ---------------------------------------------------------------- outputs

/** Share of Persian/Arabic-script letters among the letters of a text (0…1; 0 for no letters). */
export function persianShare(text: string): number {
  const letters = String(text ?? "").match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  const fa = letters.filter((ch) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u.test(ch)).length;
  return fa / letters.length;
}

/** The language an answer should be written in: Persian unless the input is clearly written in another language. */
export function answerLanguage(sample: string | null | undefined, preferred?: string | null): "fa" | "en" {
  if (preferred === "en") return "en";
  if (preferred === "fa") return "fa";
  const s = String(sample ?? "").trim();
  if (s.length >= 12 && persianShare(s) < 0.2) return "en";
  return "fa";
}

export const LANGUAGE_NAME: Record<"fa" | "en", string> = { fa: "فارسی", en: "English" };

/** Source numbers an answer cites ([n]), in order of first use. */
export function citedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text ?? "").matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Text of an output for checks and previews: the text, or the JSON's string values joined. */
export function outputText(text: string | null | undefined, json: unknown): string {
  if (text) return text;
  const parts: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
  };
  walk(json, 0);
  return parts.join("\n");
}

/** Score an output against an eval case's expectations: one check per property, score = share of checks passed. */
export function scoreOutput(expect: SkillExpectation, out: { text: string | null; json: unknown; citations?: number }): { score: number; checks: SkillCheck[] } {
  const text = outputText(out.text, out.json);
  const norm = (s: string) => s.replace(/[‌‏‎]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک").toLowerCase();
  const t = norm(text);
  const checks: SkillCheck[] = [];
  for (const c of expect.contains ?? []) checks.push({ name: `شامل «${c}»`, ok: t.includes(norm(c)) });
  for (const c of expect.not_contains ?? []) checks.push({ name: `بدون «${c}»`, ok: !t.includes(norm(c)) });
  if (typeof expect.min_chars === "number") checks.push({ name: `دست‌کم ${expect.min_chars} نویسه`, ok: text.length >= expect.min_chars, detail: String(text.length) });
  if (typeof expect.max_chars === "number") checks.push({ name: `حداکثر ${expect.max_chars} نویسه`, ok: text.length <= expect.max_chars, detail: String(text.length) });
  for (const k of expect.json_keys ?? []) {
    const has = !!out.json && typeof out.json === "object" && k in (out.json as Record<string, unknown>) && (out.json as Record<string, unknown>)[k] !== null && (out.json as Record<string, unknown>)[k] !== "";
    checks.push({ name: `کلید «${k}»`, ok: has });
  }
  if (expect.language) {
    const share = persianShare(text);
    checks.push({ name: expect.language === "fa" ? "به فارسی" : "به انگلیسی", ok: expect.language === "fa" ? share >= 0.5 : share < 0.2 });
  }
  if (expect.cites) checks.push({ name: "با ارجاع به منبع", ok: (out.citations ?? 0) > 0 });
  if (!checks.length) checks.push({ name: "پاسخ خالی نیست", ok: text.trim().length > 0 });
  const score = checks.filter((c) => c.ok).length / checks.length;
  return { score: Math.round(score * 1000) / 1000, checks };
}

// ---------------------------------------------------------------- JSON outputs

/** Problems of a JSON value against the subset of JSON Schema skills use (type, properties, required, items, enum). */
export function schemaProblems(schema: unknown, value: unknown, path = "", depth = 0): string[] {
  const s = (schema ?? {}) as Record<string, unknown>;
  if (depth > 8 || !schema || typeof schema !== "object") return [];
  const at = path || "(ریشه)";
  const anyOf = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(anyOf) && anyOf.length) {
    const ok = anyOf.some((x) => !schemaProblems(x, value, path, depth + 1).length);
    return ok ? [] : [`${at}: با هیچ‌یک از گونه‌ها جور نیست`];
  }
  if (Array.isArray(s.enum) && s.enum.length && !s.enum.some((e) => e === value)) return [`${at}: مقدار مجاز نیست`];
  const types = Array.isArray(s.type) ? (s.type as string[]) : s.type ? [String(s.type)] : [];
  if (value === null || value === undefined) return types.length && !types.includes("null") ? [`${at}: خالی است`] : [];
  if (types.length) {
    const kind = Array.isArray(value) ? "array" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
    const fits = types.some((t) => t === kind || (t === "number" && kind === "integer"));
    if (!fits) return [`${at}: باید ${types.join(" یا ")} باشد`];
  }
  const out: string[] = [];
  if (Array.isArray(value)) {
    if (typeof s.maxItems === "number" && value.length > s.maxItems) out.push(`${at}: بیش از ${s.maxItems} مورد`);
    if (s.items) value.slice(0, 200).forEach((x, i) => out.push(...schemaProblems(s.items, x, `${path}[${i}]`, depth + 1)));
  } else if (typeof value === "object") {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    for (const k of (s.required as string[] | undefined) ?? []) if (!(k in (value as Record<string, unknown>))) out.push(`${path ? `${path}.` : ""}${k}: لازم است`);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (props[k]) out.push(...schemaProblems(props[k], v, path ? `${path}.${k}` : k, depth + 1));
  } else if (typeof value === "string") {
    if (typeof s.maxLength === "number" && value.length > s.maxLength) out.push(`${at}: بلندتر از ${s.maxLength} نویسه`);
  } else if (typeof value === "number") {
    if (typeof s.minimum === "number" && value < s.minimum) out.push(`${at}: کمتر از ${s.minimum}`);
    if (typeof s.maximum === "number" && value > s.maximum) out.push(`${at}: بیشتر از ${s.maximum}`);
  }
  return out;
}

/** Is a value a JSON Schema the runtime can enforce (an object with a type)? */
export function schemaShapeProblem(schema: unknown): string | null {
  if (schema === null || schema === undefined) return null;
  if (typeof schema !== "object" || Array.isArray(schema)) return "طرح خروجی باید یک شیء JSON Schema باشد";
  const t = (schema as Record<string, unknown>).type;
  if (t !== "object") return "طرح خروجی باید از نوع object باشد";
  if (JSON.stringify(schema).length > 20_000) return "طرح خروجی بیش از اندازه بزرگ است";
  return null;
}

// ---------------------------------------------------------------- the panel

/** Skills of a surface, in display order, the unavailable ones last. */
export function skillsFor(cards: SkillCard[], surface: SkillSurface): SkillCard[] {
  return cards
    .filter((c) => c.surfaces.includes(surface))
    .sort((a, b) => Number(b.available) - Number(a.available) || a.order - b.order || a.name.localeCompare(b.name, "fa"));
}

/** The line under an output: the AI label (or the fallback's), the model and how long it took. */
export function outputCaption(r: Pick<SkillRunResult, "fallback" | "model">): string {
  return r.fallback ? SKILL_FALLBACK_LABEL : `${SKILL_AI_LABEL}${r.model ? ` · مدل ${r.model}` : ""}`;
}
