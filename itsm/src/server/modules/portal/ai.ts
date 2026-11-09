// AI skills of the portal (docs/spec/AI.md §11; catalogue PTL-007, AI-026 for requesters), each with a rule-based
// fallback so the portal answers without a model too («بدون مدل هوش مصنوعی و با قاعده ساخته شد»):
//   portal.search_answer   a short answer card above the search results, grounded only in the knowledge the person
//                          may read (`retrieve` with their context), with numbered citations and abstention when the
//                          sources say nothing; the fallback quotes the best passage
//   portal.reply_suggest   two or three short replies a requester might send on their own ticket (the public
//                          conversation only, never internal notes); nothing is posted — the person picks and edits
// Both run as the person (`runSkill`): what reaches a model is what they may read, and the runs are theirs.
import { z } from "zod";
import type { PortalAnswer } from "@shared/portal/api";
import type { Ctx } from "../../context";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import { isAiUnavailable, runSkill } from "../ai/skills/runtime";
import type { SkillDef, SkillRuntimeInput } from "../ai/skills/types";
import { AppError } from "../../http/errors";

const NO_ANSWER = "پاسخ روشنی در منابعی که به آن‌ها دسترسی دارید پیدا نشد. می‌توانید با «ثبت مشکل» یا «گفتگو با دستیار» ادامه دهید.";

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The rule-based answer: the best passage quoted with its citation (or the abstention). */
export function ruleAnswer(input: Pick<SkillRuntimeInput, "passages">): string {
  const best = input.passages[0];
  if (!best) return NO_ANSWER;
  const more = input.passages.slice(1, 3).map((p) => `- ${p.citation.title} [${p.n}]`);
  return [`طبق «${best.citation.title}» [${best.n}]:`, "", `> ${clip(best.text, 420)}`, ...(more.length ? ["", "منابع مرتبط دیگر:", ...more] : [])].join("\n");
}

/** Reply suggestions by the record's stage when no model answers. */
export function ruleReplies(input: Pick<SkillRuntimeInput, "record" | "journal">): string[] {
  const state = String(input.record?.row?.state ?? "");
  const lastStaff = [...input.journal].reverse().find((j) => j.visibility === "public");
  const asked = !!lastStaff && /[؟?]/.test(lastStaff.body);
  if (["resolved", "delivered", "responded"].includes(state)) return ["مشکل حل شد، سپاسگزارم.", "هنوز مشکل دارم؛ جزئیات را می‌فرستم.", "بخشی حل شده است؛ این مورد باقی مانده:"];
  if (asked) return ["پاسخ پرسش شما را در ادامه می‌نویسم:", "اطلاعات خواسته‌شده را پیوست کردم.", "زمان مناسب برای تماس:"];
  return ["وضعیت این مورد چیست؟", "اطلاعات تازه‌ای دارم:", "این مورد برایم فوری شده است، چون"];
}

const ANSWER_SYSTEM =
  "کار تو: پاسخ کوتاه، روشن و مؤدبانه به فارسی ساده به پرسش یک کاربر در درگاه خدمات، فقط از روی بلوک منابع. هر جمله‌ای که از منبعی می‌آید با شمارهٔ همان منبع مثل [1] پایان یابد. اگر منابع پاسخ را ندارند، فقط بگو پاسخی پیدا نشد و پیشنهاد کن مشکل را ثبت کند؛ چیزی نساز. اصطلاح فنی را ساده کن. حداکثر شش جمله یا یک فهرست کوتاه از گام‌ها.";

const REPLY_SYSTEM =
  "کار تو: پیشنهاد دو یا سه پاسخ بسیار کوتاه (هرکدام حداکثر بیست واژه) که درخواست‌کننده ممکن است در پاسخ به آخرین پیام کارشناس بفرستد. از زبان خود درخواست‌کننده، مؤدبانه و ساده. اطلاعاتی نساز: جاهایی که کاربر باید چیزی بیفزاید با «…» تمام شود. فقط JSON به شکل {\"suggestions\": [\"…\"]}.";

export const PORTAL_SKILLS: SkillDef[] = [
  defineSkill({
    key: "portal.search_answer",
    name: "پاسخ هوشمند جست‌وجوی درگاه",
    description: "پاسخ کوتاه با شمارهٔ منبع بالای نتیجه‌های جست‌وجو، فقط از دانشی که کاربر می‌تواند بخواند",
    module: "portal",
    catalog: ["PTL-007", "AI-012"],
    target: "text",
    tables: ["kb_article"],
    output: "text",
    tier: "fast",
    grounding: { kind: "knowledge", k: 4 },
    roles: [],
    surfaces: ["module"],
    order: 10,
    system: ANSWER_SYSTEM,
    template: "پرسش کاربر:\n{{text}}\n\nمنابع:\n{{passages}}",
    fallback: async (_ctx, input) => ({ text: ruleAnswer(input) }),
  }),
  defineSkill({
    key: "portal.reply_suggest",
    name: "پیشنهاد پاسخ برای درخواست‌کننده",
    description: "دو یا سه پاسخ کوتاه که درخواست‌کننده می‌تواند در گفتگوی درخواستش بفرستد (فقط گفتگوی عمومی)",
    module: "portal",
    catalog: ["PTL-011", "AI-026"],
    target: "record",
    tables: ["incident", "request_item", "portal_feedback"],
    output: "json",
    schema: z.object({ suggestions: z.array(z.string().max(200)).max(3) }),
    tier: "fast",
    inputs: { fields: ["number", "short_description", "state"], journal: "public", journalLimit: 10, links: false },
    roles: [],
    surfaces: ["module"],
    order: 20,
    system: REPLY_SYSTEM,
    template: "مورد:\n{{record}}\n\nگفتگوی عمومی (قدیمی به تازه):\n{{journal}}",
    fallback: async (_ctx, input) => ({ json: { suggestions: ruleReplies(input) } }),
  }),
];

let installed = false;
export function installPortalSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return PORTAL_SKILLS.map((s) => registerSkill(s));
}

/** «No AI» for a portal surface: no model, a provider failure, the skill switched off or not for this person. */
export const noAi = (e: unknown): boolean => isAiUnavailable(e) || (e instanceof AppError && (e.status === 403 || e.status === 404));

/** The answer card above the results, or null when no skill may answer for this person. */
export async function searchAnswer(ctx: Ctx, q: string): Promise<PortalAnswer | null> {
  const text = q.trim().slice(0, 500);
  if (text.length < 3) return null;
  try {
    const r = await runSkill(ctx, "portal.search_answer", { text, propose: false });
    const citations = r.citations.map((c) => ({ n: c.n, title: c.title, path: c.table === "kb_article" ? `portal/kb/${c.id}` : c.path }));
    return { text: r.text ?? "", citations, model: r.model, fallback: r.fallback, abstained: !citations.length, label: r.label };
  } catch (e) {
    if (noAi(e)) return null;
    throw e;
  }
}

/** Reply suggestions for a ticket the person reads (an empty list when no skill may answer). */
export async function replySuggestions(ctx: Ctx, table: string, id: string): Promise<{ suggestions: string[]; model: string | null; fallback: boolean }> {
  try {
    const r = await runSkill(ctx, "portal.reply_suggest", { table, id, propose: false });
    const json = (r.json ?? {}) as { suggestions?: unknown };
    const list = Array.isArray(json.suggestions) ? json.suggestions.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim().slice(0, 200)).slice(0, 3) : [];
    return { suggestions: list, model: r.model, fallback: r.fallback };
  } catch (e) {
    if (noAi(e)) return { suggestions: [], model: null, fallback: true };
    throw e;
  }
}
