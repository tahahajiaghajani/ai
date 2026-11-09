// Pure logic of the self-service portal (docs/modules/portal_FA.md), shared by the server and the screens:
//   · the home page's widgets: the catalogue, a layout's normalisation, moves and problems (PTL-002)
//   · audiences of portal content as one condition the reader's context evaluates (PTL-035)
//   · requester-friendly stages and labels of a ticket (PTL-011): «ثبت شد → در حال رسیدگی → حل شد → بسته»
//   · surveys: checking answers, the metrics of a response (CSAT, NPS, CES, XLA happiness and lost time) and the
//     results' figures (PTL-038…040)
//   · messaging channels: Telegram/Bale updates and the generic webhook's JSON, one-time link codes, numbered
//     replies (a reply «۲» picks the second option) and a virtual agent's reply as plain text (PTL-019/022)
//   · the website widget's allowed origins (PTL-025)
// Imported by the UI: keep it free of server imports.
import type { Cond } from "../model/conditions";
import { normalizeSearch } from "../model/conditions";
import type { StateCategory } from "../model/types";
import type { VaCard, VaInput, VaReply } from "../ai/va";
import { cardText } from "../ai/va";

// ---------------------------------------------------------------------------------------------------------------
// Home page widgets (PTL-002)

export type WidgetType = "search" | "announcements" | "actions" | "my_items" | "popular" | "favorites" | "categories" | "topics" | "links" | "knowledge" | "status" | "assistant" | "text";

export interface WidgetDef {
  type: WidgetType;
  label: string;
  description: string;
  /** offers «تعداد» */
  limit?: { min: number; max: number; default: number };
  /** offers a Markdown text (the «متن دلخواه» section) */
  text?: boolean;
  /** may appear more than once */
  repeat?: boolean;
  /** always first and always on (the search box) */
  fixed?: boolean;
}

export const PORTAL_WIDGETS: Record<WidgetType, WidgetDef> = {
  search: { type: "search", label: "جست‌وجوی بزرگ", description: "جعبهٔ جست‌وجو در دانش، کاتالوگ، درخواست‌های من و پیوندها", fixed: true },
  announcements: { type: "announcements", label: "اطلاعیه‌ها", description: "اطلاعیه‌های قطعی، اختلال و نگهداری که برای کاربر منتشر شده است" },
  actions: { type: "actions", label: "کارهای من", description: "تأییدهای منتظر، نظرسنجی‌ها و خواندن‌های لازم" },
  my_items: { type: "my_items", label: "درخواست‌های باز من", description: "تازه‌ترین درخواست‌ها و گزارش‌های باز کاربر", limit: { min: 1, max: 10, default: 4 } },
  popular: { type: "popular", label: "خدمت‌های پرطرفدار", description: "قلم‌های برجسته و پرسفارش کاتالوگ که کاربر حق سفارش آن‌ها را دارد", limit: { min: 2, max: 12, default: 6 } },
  favorites: { type: "favorites", label: "برگزیده‌ها و سفارش‌های اخیر", description: "قلم‌هایی که کاربر برگزیده یا به‌تازگی سفارش داده است", limit: { min: 2, max: 12, default: 6 } },
  categories: { type: "categories", label: "دسته‌های کاتالوگ", description: "دسته‌های اصلی کاتالوگ خدمات", limit: { min: 2, max: 16, default: 8 } },
  topics: { type: "topics", label: "موضوع‌ها", description: "موضوع‌های درگاه (درخت موضوع‌ها)", limit: { min: 2, max: 16, default: 8 } },
  links: { type: "links", label: "پیوندهای سریع", description: "برنامه‌ها و سامانه‌های پرکاربرد", limit: { min: 2, max: 24, default: 8 } },
  knowledge: { type: "knowledge", label: "مقاله‌های پرخواننده", description: "مقاله‌های دانش که کاربر می‌تواند بخواند", limit: { min: 2, max: 10, default: 5 } },
  status: { type: "status", label: "وضعیت خدمات", description: "وضعیت امروز خدمت‌هایی که روی صفحهٔ وضعیت منتشر شده‌اند" },
  assistant: { type: "assistant", label: "نوار دستیار", description: "دعوت به گفتگو با دستیار مجازی" },
  text: { type: "text", label: "متن دلخواه", description: "بخشی با متن Markdown (راه‌های تماس، ساعت کاری…)", text: true, repeat: true },
};

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  enabled: boolean;
  /** a title instead of the widget's default */
  title?: string | null;
  limit?: number | null;
  /** «متن دلخواه»: Markdown */
  text?: string | null;
}

export const MAX_WIDGETS = 20;

/** The home page every new portal starts with. */
export const DEFAULT_LAYOUT: WidgetInstance[] = [
  { id: "search", type: "search", enabled: true },
  { id: "announcements", type: "announcements", enabled: true },
  { id: "actions", type: "actions", enabled: true },
  { id: "my_items", type: "my_items", enabled: true, limit: 4 },
  { id: "popular", type: "popular", enabled: true, limit: 6 },
  { id: "favorites", type: "favorites", enabled: true, limit: 6 },
  { id: "topics", type: "topics", enabled: true, limit: 8 },
  { id: "categories", type: "categories", enabled: true, limit: 8 },
  { id: "knowledge", type: "knowledge", enabled: true, limit: 5 },
  { id: "status", type: "status", enabled: true },
  { id: "links", type: "links", enabled: true, limit: 8 },
  { id: "assistant", type: "assistant", enabled: true },
];

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};

/**
 * A layout as stored, cleaned: known widgets only, the search box first and on, each non-repeating widget once,
 * limits within their range, titles and texts trimmed, ids unique, at most MAX_WIDGETS.
 */
export function normalizeLayout(raw: unknown): WidgetInstance[] {
  const list = Array.isArray(raw) ? raw : DEFAULT_LAYOUT;
  const out: WidgetInstance[] = [];
  const seenTypes = new Set<WidgetType>();
  const seenIds = new Set<string>();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const type = x.type as WidgetType;
    const def = PORTAL_WIDGETS[type];
    if (!def || type === "search") continue;
    if (!def.repeat && seenTypes.has(type)) continue;
    seenTypes.add(type);
    let id = typeof x.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(x.id) ? x.id : type;
    for (let i = 2; seenIds.has(id); i++) id = `${type}_${i}`;
    seenIds.add(id);
    const w: WidgetInstance = { id, type, enabled: x.enabled !== false };
    const title = typeof x.title === "string" ? x.title.trim().slice(0, 80) : "";
    if (title) w.title = title;
    if (def.limit) w.limit = clampInt(x.limit, def.limit.min, def.limit.max, def.limit.default);
    if (def.text) w.text = typeof x.text === "string" ? x.text.slice(0, 4000) : "";
    out.push(w);
    if (out.length >= MAX_WIDGETS - 1) break;
  }
  return [{ id: "search", type: "search", enabled: true }, ...out];
}

/** Move a widget (the search box stays first). */
export function moveWidget(layout: WidgetInstance[], from: number, to: number): WidgetInstance[] {
  if (from === to || from <= 0 || to <= 0 || from >= layout.length || to >= layout.length) return layout;
  const next = [...layout];
  const [w] = next.splice(from, 1);
  next.splice(to, 0, w);
  return next;
}

/** Widgets that may still be added (non-repeating ones not in the layout yet). */
export function addableWidgets(layout: WidgetInstance[]): WidgetDef[] {
  const used = new Set(layout.map((w) => w.type));
  return Object.values(PORTAL_WIDGETS).filter((d) => !d.fixed && (d.repeat || !used.has(d.type)));
}

/** A new instance of a widget type with a unique id. */
export function newWidget(layout: WidgetInstance[], type: WidgetType): WidgetInstance {
  const def = PORTAL_WIDGETS[type];
  const ids = new Set(layout.map((w) => w.id));
  let id: string = type;
  for (let i = 2; ids.has(id); i++) id = `${type}_${i}`;
  return { id, type, enabled: true, ...(def.limit ? { limit: def.limit.default } : {}), ...(def.text ? { text: "" } : {}) };
}

/** What is wrong with a layout before it is published (Persian), empty when nothing. */
export function layoutProblems(layout: WidgetInstance[]): string[] {
  const out: string[] = [];
  if (layout.length > MAX_WIDGETS) out.push(`صفحهٔ اول بیش از ${MAX_WIDGETS.toLocaleString("fa-IR")} بخش دارد`);
  if (!layout.some((w) => w.enabled && w.type !== "search")) out.push("دست‌کم یک بخش جز جست‌وجو را روشن کنید");
  for (const w of layout) if (w.type === "text" && w.enabled && !(w.text ?? "").trim()) out.push(`بخش «${w.title || PORTAL_WIDGETS.text.label}» متنی ندارد`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Audiences (PTL-035)

/**
 * Who a piece of portal content (a quick link, a topic, a campaign survey) is for, as a condition on the row's own
 * audience fields evaluated with the READER's context: nobody named = everyone; a named unit reaches its sub-units
 * (`in_my_unit_line`), a location its floors and rooms (`is_my_location`).
 */
export const AUDIENCE_COND: Cond = {
  or: [
    { and: [{ f: "aud_units", op: "empty" }, { f: "aud_groups", op: "empty" }, { f: "aud_locations", op: "empty" }, { f: "aud_users", op: "empty" }] },
    { f: "aud_units", op: "in_my_unit_line" },
    { f: "aud_groups", op: "in_my_groups" },
    { f: "aud_locations", op: "is_my_location" },
    { f: "aud_users", op: "is_me" },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Requester-friendly stages (PTL-011)

export type Stage = "received" | "working" | "waiting_you" | "waiting" | "done" | "closed" | "canceled";
export type StageTone = "neutral" | "accent" | "warning" | "ok" | "muted";

export const STAGE_LABELS: Record<Stage, string> = {
  received: "ثبت شد",
  working: "در حال رسیدگی",
  waiting_you: "منتظر پاسخ شما",
  waiting: "در انتظار",
  done: "انجام شد؛ تأیید کنید",
  closed: "بسته شد",
  canceled: "لغو شد",
};

export const STAGE_TONES: Record<Stage, StageTone> = {
  received: "neutral",
  working: "accent",
  waiting_you: "warning",
  waiting: "neutral",
  done: "ok",
  closed: "muted",
  canceled: "muted",
};

/** Hold reasons and states that wait on the requester (an incident's «منتظر درخواست‌دهنده», a request's info). */
const WAITS_ON_REQUESTER = new Set(["awaiting_caller", "awaiting_requester", "awaiting_info", "info_requested"]);

/**
 * The stage a requester sees for a record: from its state's category, and «منتظر پاسخ شما» when it waits on them
 * (a hold reason, a state or a flag that says so).
 */
export function stageOf(category: StateCategory | string | null | undefined, extra: { state?: string | null; hold_reason?: string | null; info_requested?: boolean | null } = {}): Stage {
  switch (category) {
    case "new":
      return extra.info_requested ? "waiting_you" : "received";
    case "active":
      return extra.info_requested ? "waiting_you" : "working";
    case "waiting":
      return WAITS_ON_REQUESTER.has(String(extra.hold_reason ?? "")) || WAITS_ON_REQUESTER.has(String(extra.state ?? "")) || extra.info_requested ? "waiting_you" : "waiting";
    case "resolved":
      return "done";
    case "closed":
      return "closed";
    case "canceled":
      return "canceled";
    default:
      return "received";
  }
}

export interface StageStep {
  key: "received" | "working" | "done" | "closed";
  label: string;
  status: "done" | "current" | "todo";
}

/** The four steps of the stage bar and where a stage stands on them (a canceled record shows none). */
export function stageSteps(stage: Stage): StageStep[] {
  if (stage === "canceled") return [];
  const at = stage === "received" ? 0 : stage === "working" || stage === "waiting" || stage === "waiting_you" ? 1 : stage === "done" ? 2 : 3;
  const steps: [StageStep["key"], string][] = [
    ["received", "ثبت"],
    ["working", "رسیدگی"],
    ["done", "انجام"],
    ["closed", "بسته"],
  ];
  return steps.map(([key, label], i) => ({ key, label, status: i < at || (i === at && at === 3) ? "done" : i === at ? "current" : "todo" }));
}

export const isOpenStage = (s: Stage): boolean => s !== "closed" && s !== "canceled";

// ---------------------------------------------------------------------------------------------------------------
// Surveys (PTL-038…040)

export type QuestionKind = "rating" | "faces" | "nps" | "ces" | "scale10" | "choice" | "multi" | "yes_no" | "minutes" | "text";
export type QuestionMetric = "none" | "csat" | "ces" | "nps" | "happiness" | "lost_time";

export interface SurveyQuestion {
  id: string;
  label: string;
  kind: QuestionKind;
  metric: QuestionMetric;
  required: boolean;
  options: string[];
  help: string | null;
}

/** The range of a numeric question kind. */
export const QUESTION_RANGE: Partial<Record<QuestionKind, [number, number]>> = {
  rating: [1, 5],
  faces: [1, 5],
  nps: [0, 10],
  ces: [1, 7],
  scale10: [0, 10],
  minutes: [0, 100_000],
};

const toLatinDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** An answer's value as stored, or a Persian problem. */
function answerOf(q: SurveyQuestion, raw: unknown): { value: unknown } | { problem: string } | null {
  const empty = raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);
  if (empty) return q.required ? { problem: "به این پرسش پاسخ دهید" } : null;
  const range = QUESTION_RANGE[q.kind];
  if (range) {
    const n = typeof raw === "number" ? raw : Number(toLatinDigits(String(raw)).trim());
    if (!Number.isInteger(n) || n < range[0] || n > range[1]) return { problem: `عددی از ${range[0].toLocaleString("fa-IR")} تا ${range[1].toLocaleString("fa-IR")} بدهید` };
    return { value: n };
  }
  switch (q.kind) {
    case "yes_no":
      if (typeof raw === "boolean") return { value: raw };
      if (/^(true|1|بله|آره|yes)$/i.test(String(raw).trim())) return { value: true };
      if (/^(false|0|خیر|نه|no)$/i.test(String(raw).trim())) return { value: false };
      return { problem: "«بله» یا «خیر»" };
    case "choice": {
      const v = String(raw).trim();
      return q.options.includes(v) ? { value: v } : { problem: "یکی از گزینه‌ها را برگزینید" };
    }
    case "multi": {
      const vs = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x).trim()).filter(Boolean);
      const bad = vs.find((v) => !q.options.includes(v));
      if (bad) return { problem: "یکی از گزینه‌ها را برگزینید" };
      return vs.length ? { value: [...new Set(vs)] } : q.required ? { problem: "دست‌کم یک گزینه را برگزینید" } : null;
    }
    default: {
      const text = String(raw).trim().slice(0, 4000);
      return text ? { value: text } : q.required ? { problem: "به این پرسش پاسخ دهید" } : null;
    }
  }
}

/** Check a respondent's answers: the clean values by question id and the problems by question id. */
export function checkSurveyAnswers(questions: SurveyQuestion[], raw: Record<string, unknown>): { clean: Record<string, unknown>; problems: Record<string, string> } {
  const clean: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  for (const q of questions) {
    const r = answerOf(q, raw[q.id]);
    if (!r) continue;
    if ("problem" in r) problems[q.id] = r.problem;
    else clean[q.id] = r.value;
  }
  return { clean, problems };
}

export interface ResponseMetrics {
  csat: number | null;
  satisfied: boolean;
  nps: number | null;
  ces: number | null;
  happiness: number | null;
  lost_minutes: number | null;
  /** the main metric on a 0–100 scale (CSAT, else NPS, CES or happiness) */
  score: number | null;
  /** the first text answer (the comment) */
  comment: string | null;
}

/** The metrics of one response (each metric from the first question that measures it). */
export function responseMetrics(questions: SurveyQuestion[], clean: Record<string, unknown>, satisfiedFrom = 4): ResponseMetrics {
  const first = (m: QuestionMetric): number | null => {
    for (const q of questions) if (q.metric === m && typeof clean[q.id] === "number") return clean[q.id] as number;
    return null;
  };
  // a question that measures CSAT on the five-point scale; other kinds are mapped onto it
  let csat = first("csat");
  const csatQ = questions.find((q) => q.metric === "csat");
  if (csat !== null && csatQ && (csatQ.kind === "scale10" || csatQ.kind === "nps")) csat = Math.min(5, Math.max(1, Math.round(csat / 2.5) + 1));
  const nps = first("nps");
  const ces = first("ces");
  const happiness = first("happiness");
  const lost = first("lost_time");
  const comment = questions.filter((q) => q.kind === "text").map((q) => clean[q.id]).find((v): v is string => typeof v === "string" && !!v.trim()) ?? null;
  const score = csat !== null ? Math.round(((csat - 1) / 4) * 100) : nps !== null ? nps * 10 : ces !== null ? Math.round(((ces - 1) / 6) * 100) : happiness !== null ? happiness * 10 : null;
  return { csat, satisfied: csat !== null && csat >= satisfiedFrom, nps, ces, happiness, lost_minutes: lost, score, comment };
}

/** NPS of a list of 0–10 answers: % promoters (9–10) − % detractors (0–6), rounded; null without answers. */
export function npsOf(values: number[]): number | null {
  if (!values.length) return null;
  const p = values.filter((v) => v >= 9).length;
  const d = values.filter((v) => v <= 6).length;
  return Math.round(((p - d) / values.length) * 100);
}

/** CSAT % of a list of 1–5 answers: share at or above `from`; null without answers. */
export function csatPctOf(values: number[], from = 4): number | null {
  if (!values.length) return null;
  return Math.round((values.filter((v) => v >= from).length / values.length) * 100);
}

export const avgOf = (values: number[], dp = 1): number | null => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(dp)) : null);

/** Should a record be sampled for a trigger of `pct` %? Deterministic per record (the same record never flips). */
export function sampled(recordId: string, pct: number): boolean {
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  let h = 0;
  for (const ch of recordId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 100 < pct;
}

// ---------------------------------------------------------------------------------------------------------------
// Messaging channels (PTL-019, PTL-022)

/** One message a connector received, whatever the messenger. */
export interface InboundMessage {
  /** the update / delivery id (duplicates are dropped) */
  key: string;
  /** the chat the reply goes to */
  chatId: string;
  /** the sender (the identity linked to a member) */
  fromId: string;
  fromName: string;
  /** private chat (groups get the stricter policy) */
  private: boolean;
  text: string;
}

/** A Telegram or Bale update (the Bot API's JSON), or null when it carries no text message. */
export function parseTelegramUpdate(payload: unknown): InboundMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const u = payload as Record<string, any>;
  const m = u.message ?? u.edited_message ?? null;
  const cb = u.callback_query ?? null;
  const msg = m ?? cb?.message ?? null;
  const from = (m ? m.from : cb?.from) ?? null;
  const text = m ? (typeof m.text === "string" ? m.text : typeof m.caption === "string" ? m.caption : "") : typeof cb?.data === "string" ? cb.data : "";
  if (!msg || !from || !msg.chat || msg.chat.id === undefined || from.id === undefined) return null;
  const id = u.update_id ?? cb?.id ?? `${msg.chat.id}:${msg.message_id}`;
  const name = [from.first_name, from.last_name].filter((x) => typeof x === "string" && x).join(" ") || (typeof from.username === "string" ? from.username : "");
  return { key: String(id), chatId: String(msg.chat.id), fromId: String(from.id), fromName: name.slice(0, 120), private: msg.chat.type === undefined || msg.chat.type === "private", text: String(text ?? "").slice(0, 4000) };
}

/**
 * The generic webhook's JSON (an SMS gateway, Eitaa or Rubika bridge, any system): `{ "id": "…", "from": { "id":
 * "…", "name": "…" }, "chat_id": "…" (default: from.id), "text": "…", "group": false }`.
 */
export function parseGenericMessage(payload: unknown): InboundMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, any>;
  const from = p.from && typeof p.from === "object" ? p.from : { id: p.from_id ?? p.sender, name: p.from_name ?? "" };
  if (from?.id === undefined || from.id === null || String(from.id).trim() === "" || typeof p.text !== "string") return null;
  const fromId = String(from.id).trim().slice(0, 80);
  return { key: String(p.id ?? p.message_id ?? "").slice(0, 120), chatId: String(p.chat_id ?? fromId).slice(0, 80), fromId, fromName: String(from.name ?? "").slice(0, 120), private: p.group !== true, text: p.text.slice(0, 4000) };
}

/** The alphabet of link codes: no 0/O, 1/I/L. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
/** How long a link code may be used (minutes). */
export const CODE_MINUTES = 10;

/** A code as people type it: Latin capitals, no spaces or dashes, Persian digits as Latin. */
export function normalizeCode(s: string): string {
  return toLatinDigits(String(s ?? "")).toUpperCase().replace(/[\s\-_]/g, "");
}

/** «ABCD-EFGH» for display. */
export const formatCode = (c: string): string => (c.length === CODE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c);

/** A link command and its code — `/start CODE` (the bot's deep link), `/link CODE`, «اتصال CODE» or «کد CODE». */
export function linkCommand(text: string): string | null {
  const m = /^\s*(?:\/start|\/link|اتصال|کد)\s+([A-Za-z0-9۰-۹٠-٩\- ]{8,12})\s*$/i.exec(String(text ?? ""));
  if (!m) return null;
  const code = normalizeCode(m[1]);
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch)) ? code : null;
}

/** Messenger commands of a linked person. */
export function commandOf(text: string): "start" | "help" | "new" | "unlink" | "handoff" | null {
  const t = normalizeSearch(String(text ?? "").trim()).toLowerCase();
  if (/^\/start(@\w+)?$/.test(t)) return "start";
  if (/^(\/help(@\w+)?|راهنما|کمک)$/.test(t)) return "help";
  if (/^(\/new(@\w+)?|گفتگوی تازه|گفتگوی جدید)$/.test(t)) return "new";
  if (/^(\/unlink(@\w+)?|قطع اتصال)$/.test(t)) return "unlink";
  if (/^(\/agent(@\w+)?|کارشناس|گفتگو با کارشناس)$/.test(t)) return "handoff";
  return null;
}

/** One numbered option of a reply in a channel without buttons. */
export interface ChannelOption {
  n: number;
  label: string;
  input: VaInput;
}

const stripMarkdown = (s: string): string =>
  String(s ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The options a card offers to a text channel (choices, items, a question's options, a confirmation). */
function cardOptions(c: VaCard, start: number): ChannelOption[] {
  switch (c.kind) {
    case "choices":
      return c.options.map((o, i) => ({ n: start + i, label: o.label, input: { action: "choose", value: o.value } }));
    case "items":
      return c.items.map((o, i) => ({ n: start + i, label: o.name, input: { action: "choose", value: o.id } }));
    case "question":
      return (c.options ?? []).map((o, i) => ({ n: start + i, label: o.label, input: { action: "choose", value: o.value } }));
    case "confirm":
      return [
        { n: start, label: "بله، ثبت شود", input: { action: "confirm" } },
        { n: start + 1, label: "خیر، لغو شود", input: { action: "cancel" } },
      ];
    default:
      return [];
  }
}

const faNum = (n: number) => n.toLocaleString("fa-IR");

/**
 * A virtual agent's reply for a channel without rich cards: the text, each card as text lines (numbered options
 * once), its links as absolute addresses when the app's address is known, and the numbered options a reply may pick.
 */
export function replyForText(reply: Pick<VaReply, "text" | "cards" | "suggestions">, opts: { appUrl?: string | null } = {}): { text: string; options: ChannelOption[] } {
  const parts: string[] = [];
  const text = stripMarkdown(reply.text);
  if (text) parts.push(text);
  const options: ChannelOption[] = [];
  const base = (opts.appUrl ?? "").replace(/\/+$/, "");
  for (const c of reply.cards) {
    const own = cardOptions(c, options.length + 1);
    if (own.length) {
      if (c.kind === "question") parts.push(c.label + (c.help ? `\n${c.help}` : ""));
      if (c.kind === "confirm") parts.push([c.title, ...c.rows.map((r) => `${r.label}: ${r.value}`)].join("\n"));
      parts.push(own.map((o) => `${faNum(o.n)}. ${o.label}`).join("\n"));
      options.push(...own);
      continue;
    }
    let line = cardText(c);
    if (base && (c.kind === "created" || c.kind === "handoff" || c.kind === "form_link" || c.kind === "articles")) {
      const paths = c.kind === "created" ? [c.link.path] : c.kind === "handoff" ? (c.link ? [c.link.path] : []) : c.kind === "form_link" ? [c.path] : c.items.map((a) => a.path);
      const urls = paths.filter(Boolean).map((p) => `${base}/${p.replace(/^\/+/, "")}`);
      if (urls.length) line += `\n${urls.join("\n")}`;
    }
    if (line.trim()) parts.push(line);
  }
  return { text: parts.join("\n\n").slice(0, 3900) || "…", options };
}

/** What a person's text means against the last numbered options: a pick («۲», «2», the option's label) or words. */
export function inputFromText(text: string, options: ChannelOption[]): VaInput {
  const t = String(text ?? "").trim();
  const n = Number(toLatinDigits(t).replace(/[.)\s]/g, ""));
  if (Number.isInteger(n) && n >= 1) {
    const o = options.find((x) => x.n === n);
    if (o) return o.input;
  }
  const norm = normalizeSearch(t).toLowerCase();
  const byLabel = options.find((o) => normalizeSearch(o.label).toLowerCase() === norm);
  if (byLabel) return byLabel.input;
  return { text: t.slice(0, 4000) || "…" };
}

/** Telegram's reply keyboard for the options (one button a row; tapping sends the label, matched back above). */
export function replyKeyboard(options: ChannelOption[]): Record<string, unknown> | null {
  if (!options.length) return { remove_keyboard: true };
  return { keyboard: options.slice(0, 12).map((o) => [{ text: o.label.slice(0, 60) }]), resize_keyboard: true, one_time_keyboard: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The website widget (PTL-025)

/** `https://www.example.com:8443` from anything that looks like an origin or a page address; null when it is not one. */
export function originOf(s: string | null | undefined): string | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Is a request's Origin one of the widget's allowed sites (exact scheme, host and port)? */
export function originAllowed(origin: string | null | undefined, allowed: readonly string[]): boolean {
  const o = originOf(origin);
  if (!o) return false;
  return allowed.some((a) => originOf(a) === o);
}
