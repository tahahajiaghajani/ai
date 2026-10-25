/**
 * How a request lives in the data repository (pure, no server imports, unit-tested): one issue per request.
 * The issue body is a readable summary for GitHub followed by a hidden, base64url-encoded JSON block that is the
 * source of truth; messages are comments that carry their author and exact text the same way. Comments without a
 * marker (written on GitHub itself) are private notes and never reach the visitor.
 */
import { isKind, isPriority, isStatus, PRIORITY_LABEL, type RequestKind, type RequestPriority, type RequestStatus } from "@/lib/request-meta";

/** What the model returns for a new request. */
export interface Triage {
  kind?: string;
  priority?: string;
  summary_visitor?: string;
  summary_owner?: string;
  questions?: string[];
  tags?: string[];
  fit?: string;
  model?: string;
  at?: string;
}

export interface RequestData {
  code: string;
  name: string;
  email: string;
  phone: string;
  telegram: string;
  organization: string;
  kind: RequestKind;
  budget: string;
  timeline: string;
  subject: string;
  body: string;
  lang: "fa" | "en";
  status: RequestStatus;
  priority: RequestPriority;
  source: string;
  visitor: string;
  ai_triage: Triage | null;
  ai_summary: string | null;
  ai_reply: string | null;
  created_at: string;
  updated_at: string;
  last_owner_at: string | null;
  last_visitor_at: string;
}

export interface RequestRow extends RequestData {
  /** the issue number: the request's real id */
  number: number;
  url: string;
}

export interface Message {
  id: number;
  author: "visitor" | "owner" | "note";
  body: string;
  created_at: string;
}

export const REQUEST_LABEL = "request";
const MARK = "portfolio-request:v1";
const MSG = "portfolio-msg";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

const KIND_FA: Record<RequestKind, string> = { project: "پروژه", consulting: "مشاوره", demo: "دمو", collaboration: "همکاری", design: "طراحی", other: "دیگر" };
const STATUS_FA: Record<RequestStatus, string> = { new: "تازه", reviewing: "در حال بررسی", answered: "پاسخ داده شد", scheduled: "جلسه هماهنگ شد", closed: "بسته" };

const cell = (s: string) => (s || "—").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").slice(0, 300);

/** A code fence longer than any run of backticks in the text, so the visitor's text can never close it. */
function fenced(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

export function issueTitle(d: Pick<RequestData, "code" | "subject">): string {
  return `${d.code} · ${d.subject.replace(/\s+/g, " ").slice(0, 120)}`;
}

/** The readable summary plus the hidden data block (always last, so text above it can never forge it). */
export function issueBody(d: RequestData): string {
  const rows: [string, string][] = [
    ["نام", d.name],
    ["سازمان", d.organization],
    ["ایمیل", d.email],
    ["تلفن", d.phone],
    ["تلگرام", d.telegram],
    ["نوع", KIND_FA[d.kind]],
    ["بودجه", d.budget],
    ["زمان‌بندی", d.timeline],
    ["زبان", d.lang === "en" ? "انگلیسی" : "فارسی"],
    ["وضعیت", STATUS_FA[d.status]],
    ["اولویت", PRIORITY_LABEL[d.priority].fa],
  ];
  const t = d.ai_triage;
  return [
    `درخواست از سایت پورتفولیو · \`${d.code}\` · پاسخ و تغییر وضعیت از صندوق \`/admin\` سایت؛ دیدگاه‌هایی که اینجا می‌نویسید یادداشت خصوصی‌اند و به بازدیدکننده نشان داده نمی‌شوند.`,
    "",
    "| | |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`),
    "",
    "#### متن درخواست",
    fenced(d.body),
    ...(t?.summary_owner ? ["", "#### تحلیل هوش مصنوعی", cell(t.summary_owner), ...(t.tags?.length ? ["", t.tags.map((x) => `\`${x.replace(/`/g, "")}\``).join(" ")] : [])] : []),
    "",
    `<!-- ${MARK} ${b64(JSON.stringify(d))} -->`,
  ].join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/** Reads the hidden block of an issue body; null when the issue is not a request. */
export function parseIssueBody(body: string | null | undefined): RequestData | null {
  if (!body) return null;
  const at = body.lastIndexOf(`<!-- ${MARK} `);
  if (at < 0) return null;
  const end = body.indexOf(" -->", at);
  if (end < 0) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(unb64(body.slice(at + MARK.length + 6, end)));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || typeof raw.code !== "string") return null;
  const now = new Date(0).toISOString();
  return {
    code: str(raw.code, 20),
    name: str(raw.name, 120),
    email: str(raw.email, 160),
    phone: str(raw.phone, 60),
    telegram: str(raw.telegram, 60),
    organization: str(raw.organization, 160),
    kind: isKind(raw.kind) ? raw.kind : "other",
    budget: str(raw.budget, 80),
    timeline: str(raw.timeline, 80),
    subject: str(raw.subject, 200),
    body: str(raw.body, 6000),
    lang: raw.lang === "en" ? "en" : "fa",
    status: isStatus(raw.status) ? raw.status : "new",
    priority: isPriority(raw.priority) ? raw.priority : "normal",
    source: str(raw.source, 40),
    visitor: str(raw.visitor, 40),
    ai_triage: raw.ai_triage && typeof raw.ai_triage === "object" ? (raw.ai_triage as Triage) : null,
    ai_summary: strOrNull(raw.ai_summary, 900),
    ai_reply: strOrNull(raw.ai_reply, 3000),
    created_at: str(raw.created_at, 40) || now,
    updated_at: str(raw.updated_at, 40) || now,
    last_owner_at: strOrNull(raw.last_owner_at, 40),
    last_visitor_at: str(raw.last_visitor_at, 40) || now,
  };
}

/** The issue's labels: the site's own (request, status, kind, priority) plus any label added on GitHub. */
export function requestLabels(d: Pick<RequestData, "status" | "kind" | "priority">, existing: string[] = []): string[] {
  const own = /^(request|status:|kind:|priority:)/;
  return [...new Set([REQUEST_LABEL, `status:${d.status}`, `kind:${d.kind}`, `priority:${d.priority}`, ...existing.filter((l) => !own.test(l))])];
}

/** Every label the site may set, for the one-time repository setup. */
export const SITE_LABELS = [
  { name: REQUEST_LABEL, color: "111111", description: "A request from the portfolio site" },
  { name: "assistant-unanswered", color: "555555", description: "Questions the site assistant could not answer" },
  ...(["new", "reviewing", "answered", "scheduled", "closed"] as const).map((s) => ({ name: `status:${s}`, color: s === "new" ? "000000" : "dddddd", description: STATUS_FA[s] })),
  ...(["project", "consulting", "demo", "collaboration", "design", "other"] as const).map((k) => ({ name: `kind:${k}`, color: "eeeeee", description: KIND_FA[k] })),
  ...(["low", "normal", "high", "urgent"] as const).map((p) => ({ name: `priority:${p}`, color: p === "urgent" || p === "high" ? "333333" : "f5f5f5", description: PRIORITY_LABEL[p].fa })),
];

/* -------------------------------------------------------------- messages */

/** A message written from the site: who wrote it (hidden) and its exact text, shown readably on GitHub. */
export function messageComment(author: "visitor" | "owner", text: string): string {
  const head = author === "owner" ? "**پاسخ طاها** — در صفحه‌ی پیگیری بازدیدکننده دیده می‌شود" : "**پیام بازدیدکننده** از صفحه‌ی پیگیری";
  return `<!-- ${MSG}:${author}:${b64(text)} -->\n${head}\n\n${fenced(text)}`;
}

export function parseComment(c: { id: number; body: string | null; created_at: string }): Message {
  const m = /^<!-- portfolio-msg:(visitor|owner):([A-Za-z0-9_-]*) -->/.exec(c.body ?? "");
  if (m) {
    try {
      return { id: c.id, author: m[1] as "visitor" | "owner", body: unb64(m[2]), created_at: c.created_at };
    } catch {
      // fall through: an unreadable block is shown as a note
    }
  }
  return { id: c.id, author: "note", body: c.body ?? "", created_at: c.created_at };
}

/* ------------------------------------------------------- tracking links */

/** The private part of a tracking link: the issue number and a signature over it and the code. */
export function trackingKey(number: number, code: string, sign: (payload: string) => string): string {
  return `${number}.${sign(`req:${number}:${code}`).slice(0, 32)}`;
}

/** The issue number a tracking key points to (the signature is checked against the issue's code afterwards). */
export function keyNumber(key: string | null | undefined): number | null {
  const m = /^(\d{1,9})\.[A-Za-z0-9_-]{32}$/.exec(key ?? "");
  return m ? Number(m[1]) : null;
}
