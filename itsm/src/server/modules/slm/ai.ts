// The AI skills of service level management (docs/spec/AI.md §11; catalogue SLM-039/043/046/055), each over facts code
// computed — a model never computes a number here — and each with a rule-based fallback, so every button answers
// without a model too:
//   · slm.review_narrative — the narrative of a service review from its pack (fallback: `packNarrative`)
//   · slm.csi_suggest      — improvement suggestions from a review's pack (fallback: `csiSuggestions`)
//   · slm.agreement_document — the wording of an agreement's Persian document over the generated draft (fallback: the
//                            generated document itself)
//   · slm.xla_explain      — why an experience score is what it is, from its drivers (fallback: `xlaExplanation`)
// Module routes call `runSkillOrRules`: the skill as the person (their access, their role, the organisation's
// switches and budgets) and the deterministic answer whenever AI cannot answer.
import { z } from "zod";
import { csiSuggestions, packNarrative, xlaExplanation, type CsiSuggestion, type ReviewPack, type XlaResult } from "@shared/slm/logic";
import type { Ctx } from "../../context";
import { AppError } from "../../http/errors";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import { isAiUnavailable, runSkill } from "../ai/skills/runtime";
import type { SkillDef } from "../ai/skills/types";
import { liveRow, sysOf } from "./common";
import { documentOf } from "./agreements";
import { packOf } from "./review";

async function reviewPack(ctx: Ctx, id: string | null): Promise<ReviewPack | null> {
  if (!id) return null;
  const review = await liveRow(ctx.db, ctx, "slm_review", id);
  return review ? packOf(ctx.db, sysOf(ctx), review) : null;
}

const SUGGESTIONS = z.object({
  items: z.array(z.object({ title: z.string().max(200), description: z.string().max(1500), value: z.number().int().min(1).max(5), effort: z.number().int().min(1).max(5) })).max(8),
});

export const slmSkills: SkillDef[] = [
  defineSkill({
    key: "slm.review_narrative",
    name: "روایت بازبینی خدمت",
    description: "روایت کوتاه بازبینی خدمت برای مشتری و مدیران از عددهای بستهٔ بازبینی: وضعیت کلی، اهداف برآورده‌نشده، نقض‌ها، تجربه و پیشنهاد",
    module: "slm",
    catalog: ["SLM-046", "SLM-043"],
    target: "record",
    tables: ["slm_review"],
    output: "text",
    tier: "standard",
    inputs: { fields: ["number", "title", "kind", "period_from", "period_to"], journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["panel", "module"],
    order: 10,
    system:
      "کار تو: روایت رسمی و کوتاه (حداکثر شش بند) یک بازبینی خدمت. فقط عددهای بلوک pack را به کار ببر و هیچ عددی نساز. بندها: «وضعیت کلی»، «اهداف»، «نقض‌ها و علت‌های پرتکرار»، «تجربهٔ کاربران» (اگر داده هست؛ اگر توافق سبز و تجربه پایین است صریح بگو)، «بهبود» و «پیشنهاد برای دورهٔ بعد». اگر داده کم است همین را بگو.",
    template: "بازبینی:\n{{record}}\n\nبستهٔ عددها:\n{{pack}}",
    factKeys: ["pack"],
    facts: async (ctx, input) => ({ pack: await reviewPack(ctx, input.id) }),
    fallback: async (ctx, input) => {
      const pack = await reviewPack(ctx, input.id);
      return { text: pack ? packNarrative(pack) : "بستهٔ بازبینی هنوز ساخته نشده است." };
    },
  }),
  defineSkill({
    key: "slm.csi_suggest",
    name: "پیشنهاد بهبود خدمت",
    description: "اقدام‌های بهبود (CSI) با ارزش و تلاش تخمینی، از عددهای بستهٔ بازبینی؛ پیشنهادها پس از تأیید یک نفر ثبت می‌شوند",
    module: "slm",
    catalog: ["SLM-046"],
    target: "record",
    tables: ["slm_review"],
    output: "json",
    schema: SUGGESTIONS,
    tier: "standard",
    inputs: { fields: ["number", "title", "kind"], journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["module"],
    order: 11,
    system:
      "کار تو: حداکثر شش اقدام بهبود مشخص و سنجش‌پذیر برای دورهٔ بعد، فقط بر پایهٔ بلوک pack (اهداف برآورده‌نشده، نقض‌های پرتکرار، تجربهٔ پایین، اقدام‌های عقب‌افتاده). برای هر اقدام عنوان کوتاه، شرح یک یا دو جمله‌ای، ارزش (۱ تا ۵) و تلاش (۱ تا ۵). عدد تازه نساز.",
    template: "بستهٔ عددها:\n{{pack}}",
    factKeys: ["pack"],
    facts: async (ctx, input) => ({ pack: await reviewPack(ctx, input.id) }),
    fallback: async (ctx, input) => {
      const pack = await reviewPack(ctx, input.id);
      return { json: { items: pack ? csiSuggestions(pack).map(({ title, description, value, effort }) => ({ title, description, value, effort })) : [] } };
    },
  }),
  defineSkill({
    key: "slm.agreement_document",
    name: "نگارش سند توافق",
    description: "متن رسمی فارسی سند توافق از پیش‌نویس ساخته‌شده از رکورد (طرف‌ها، ساعات، اهداف، مسئولیت‌ها، تشدید، بازبینی)",
    module: "slm",
    catalog: ["SLM-055"],
    target: "record",
    tables: ["service_agreement"],
    output: "text",
    tier: "standard",
    inputs: { fields: ["number", "name", "kind"], journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["module"],
    order: 12,
    system:
      "کار تو: بازنویسی پیش‌نویس سند توافق به فارسی رسمی و روان، با همان ساختار و همان بندها. هیچ عدد، تاریخ، هدف یا تعهدی را تغییر نده، نیفزا و حذف نکن؛ فقط نگارش را روشن‌تر کن. جدول اهداف را دست‌نخورده نگه دار.",
    template: "پیش‌نویس سند:\n{{draft}}",
    factKeys: ["draft"],
    facts: async (ctx, input) => ({ draft: input.id ? (await documentOf(ctx, input.id)).markdown : "" }),
    fallback: async (ctx, input) => ({ text: input.id ? (await documentOf(ctx, input.id)).markdown : "" }),
  }),
  defineSkill({
    key: "slm.xla_explain",
    name: "توضیح امتیاز تجربه",
    description: "اینکه امتیاز تجربهٔ یک رکورد چرا چنین است و کدام قاعده‌ها از آن کاستند، از عوامل محاسبه‌شده",
    module: "slm",
    catalog: ["SLM-039"],
    target: "record",
    tables: ["slm_xla_score"],
    output: "text",
    tier: "fast",
    inputs: { fields: ["record_number", "score", "band", "reliability", "quality", "effort", "survey"], journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["panel"],
    order: 13,
    system: "کار تو: در دو یا سه جملهٔ ساده بگو امتیاز تجربهٔ این رکورد چرا چنین است و چه کاری بیشترین اثر را بر بهبود آن دارد. فقط از بلوک drivers و فیلدهای رکورد استفاده کن.",
    template: "امتیاز:\n{{record}}\n\nعوامل:\n{{drivers}}",
    factKeys: ["drivers"],
    facts: async (ctx, input) => ({ drivers: input.id ? ((await liveRow(ctx.db, ctx, "slm_xla_score", input.id))?.drivers ?? []) : [] }),
    fallback: async (ctx, input) => {
      const row = input.id ? await liveRow(ctx.db, ctx, "slm_xla_score", input.id) : null;
      if (!row) return { text: "امتیازی پیدا نشد." };
      const r: XlaResult = { score: Number(row.score ?? 0), band: row.band, reliability: Number(row.reliability ?? 0), quality: Number(row.quality ?? 0), effort: Number(row.effort ?? 0), survey: !!row.survey, drivers: Array.isArray(row.drivers) ? row.drivers : [] };
      return { text: xlaExplanation(r) };
    },
  }),
];

/** Is this an error after which the deterministic answer stands (no model, switched off, no right to the skill)? */
export const answersWithoutAi = (e: unknown): boolean => isAiUnavailable(e) || (e instanceof AppError && [403, 429, 503].includes(e.status));

/** Run a skill as the person; whenever AI cannot answer, the module's own deterministic answer. */
export async function runSkillOrRules<T>(ctx: Ctx, key: string, req: { table: string; id: string }, pick: (r: { text: string | null; json: unknown; fallback: boolean }) => T | null, rules: () => Promise<T> | T): Promise<{ value: T; ai: boolean }> {
  try {
    const r = await runSkill(ctx, key, { table: req.table, id: req.id, propose: false });
    const v = pick(r);
    if (v !== null) return { value: v, ai: !r.fallback };
  } catch (e) {
    if (!answersWithoutAi(e)) throw e;
  }
  return { value: await rules(), ai: false };
}

export type { CsiSuggestion };

let installed = false;
export function installSlmSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return slmSkills.map((s) => registerSkill(s));
}
