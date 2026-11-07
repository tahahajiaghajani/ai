// Suggested questions: page-aware starters (the empty conversation and the Ctrl K palette) and the «/» menu of quick
// prompts (built-in ones plus the person's own, kept in this browser). Data only; the panel draws them.
import type { ModuleKey } from "@shared/constants";
import type { Area } from "@shared/permissions";

export type PromptIcon = "summary" | "chart" | "people" | "calendar" | "doc" | "search" | "forecast" | "draft";

export interface Suggestion {
  key: string;
  text: string;
  icon: PromptIcon;
  module?: ModuleKey;
  /** needs this area (view) to be answerable */
  area?: Area;
  /** prepares a draft: offered only to people who may (ai:edit) */
  draft?: boolean;
  /** has a blank to fill in: goes to the composer instead of being sent */
  fill?: boolean;
}

export const S = (key: string, icon: PromptIcon, text: string, extra: Partial<Suggestion> = {}): Suggestion => ({ key, icon, text, ...extra });

const GENERAL: Suggestion[] = [
  S("today", "calendar", "امروز چندم است و تا پایان این ماه چند روز مانده؟"),
  S("my-access", "people", "نقش و دسترسی من در هر بخش این سازمان چیست؟"),
  S("members", "people", "اعضای سازمان را به تفکیک نقش فهرست کن", { area: "users" }),
  S("what", "search", "با دستیار در این برنامه چه کارهایی می‌توانم انجام دهم؟"),
];

/**
 * Starters by the page's first path segments; the longest matching prefix wins. Modules add theirs
 * (`BY_PAGE.push(["service-desk/incidents", [...]])`).
 */
export const BY_PAGE: [prefix: string, list: Suggestion[]][] = [
  [
    "settings/users",
    [
      S("us-roles", "people", "اعضای سازمان را به تفکیک نقش فهرست کن", { area: "users" }),
      S("us-managers", "people", "مالکان و مدیران این سازمان چه کسانی هستند؟", { area: "users" }),
      S("us-inactive", "people", "کدام اعضا غیرفعال‌اند یا مدتی است وارد نشده‌اند؟", { area: "users" }),
    ],
  ],
  ["help", [S("hp-what", "search", "با دستیار در این برنامه چه کارهایی می‌توانم انجام دهم؟"), S("hp-access", "people", "نقش و دسترسی من در هر بخش این سازمان چیست؟")]],
];

/** Detail pages get questions about the record itself first, by record type. Modules add theirs. */
export const RECORD: Record<string, Suggestion[]> = {};

export interface SuggestionScope {
  has: (m: ModuleKey) => boolean;
  /** may prepare drafts (ai:edit) */
  canDraft: boolean;
  /** may see an area (questions that need it are left out otherwise) */
  can?: (a: Area) => boolean;
  recordType?: string | null;
}

/** Up to `limit` starters for the page `rel` (org-relative path). */
export function suggestionsFor(rel: string, scope: SuggestionScope, limit = 4): Suggestion[] {
  const path = rel.replace(/^\/+|\/+$/g, "");
  let page: Suggestion[] = [];
  let best = -1;
  for (const [prefix, list] of BY_PAGE) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > best) {
      page = list;
      best = prefix.length;
    }
  }
  const ok = (s: Suggestion) => (!s.module || scope.has(s.module)) && (!s.draft || scope.canDraft) && (!s.area || !scope.can || scope.can(s.area));
  const record = scope.recordType ? (RECORD[scope.recordType] ?? []) : [];
  const out: Suggestion[] = [];
  for (const s of [...record, ...page, ...GENERAL]) {
    if (out.length >= limit) break;
    if (ok(s) && !out.some((x) => x.key === s.key || x.text === s.text)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------- the Ctrl K palette

/** A question rather than a page name: the «بپرس» row goes first.  */
export function looksLikeQuestion(q: string): boolean {
  const s = q.trim();
  if (/[؟?]$/.test(s)) return true;
  if (/^(?:چه|چرا|چطور|چگونه|چند|چقدر|کدام|کی|کجا|آیا|کو|مقایسه|تحلیل|پیش‌بینی|پیش بینی|خلاصه|بگو|نشان بده|حساب کن|فهرست)(?:\s|$|‌)/.test(s)) return true;
  return s.split(/\s+/).length >= 5;
}

// ---------------------------------------------------------------- the «/» menu

export interface QuickPrompt {
  key: string;
  /** short name typed after «/» */
  name: string;
  text: string;
  module?: ModuleKey;
  /** saved by the person (can be removed) */
  own?: boolean;
}

/** Built-in quick prompts; modules add theirs (`QUICK_PROMPTS.push({...})`). */
export const QUICK_PROMPTS: QuickPrompt[] = [
  { key: "q-today", name: "امروز", text: "امروز را با تاریخ شمسی و میلادی بگو و بگو تا پایان این ماه چند روز مانده است." },
  { key: "q-access", name: "دسترسی من", text: "نقش و دسترسی‌های من در هر بخش این سازمان را در یک جدول بگو." },
  { key: "q-members", name: "اعضا", text: "اعضای سازمان را به تفکیک نقش فهرست کن و تعدادشان را بگو." },
  { key: "q-calc", name: "محاسبه", text: "این را دقیق حساب کن: " },
  { key: "q-summary", name: "خلاصه", text: "متن زیر را در چند بند کوتاه خلاصه کن:\n" },
];

const ownKey = (orgId: string) => `itsm.ai.prompts.${orgId}`;

/** The person's own quick prompts (this browser only). */
export function readOwnPrompts(orgId: string): QuickPrompt[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ownKey(orgId)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is { key: string; name: string; text: string } => !!p && typeof p.key === "string" && typeof p.name === "string" && typeof p.text === "string")
      .slice(0, 30)
      .map((p) => ({ key: p.key, name: p.name, text: p.text, own: true }));
  } catch {
    return [];
  }
}

export function writeOwnPrompts(orgId: string, list: QuickPrompt[]): void {
  try {
    localStorage.setItem(ownKey(orgId), JSON.stringify(list.filter((p) => p.own).map(({ key, name, text }) => ({ key, name, text }))));
  } catch {
    /* private window or blocked storage: the prompt lives until reload */
  }
}

/** A short name for a saved prompt: its first words. */
export function promptName(text: string): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ");
  const name = words.slice(0, 4).join(" ");
  return words.length > 4 ? `${name}…` : name;
}
