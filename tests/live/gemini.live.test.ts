/**
 * Live checks against the real Gemini API (consume a little free-tier quota).
 * Run with:  LIVE=1 GEMINI_API_KEY=... npx vitest run tests/live
 */
import { describe, expect, it } from "vitest";
import { generate, generateJson, type GenContext } from "@/lib/ai/gemini";
import { KNOWLEDGE_SCHEMA, DEFAULT_PROMPTS } from "@/lib/ai/prompts";

const live = !!process.env.LIVE && !!process.env.GEMINI_API_KEY;

function ctx(): GenContext & { logs: string[] } {
  let partial: { key: string; text: string; model?: string } | null = null;
  const logs: string[] = [];
  return {
    logs,
    getPartial: () => partial,
    savePartial: async (p) => {
      partial = p;
    },
    live: () => undefined,
    log: async (e) => {
      logs.push(e.title);
    },
    blockedModels: async () => ({}),
    blockModel: async () => undefined,
    addUsage: () => undefined,
  };
}

const MODELS = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest"];

describe.skipIf(!live)("Gemini live", () => {
  it("extracts knowledge as valid structured JSON", async () => {
    const c = ctx();
    const { data, model } = await generateJson<{ items: { kind: string; title: string; content: string; score: number }[] }>({
      agent: "knowledge",
      models: MODELS,
      system: DEFAULT_PROMPTS.knowledge,
      userParts: [
        {
          text: "# تسک T-0001: طراحی جدول نقش‌ها و دسترسی‌های پنل مدیریت شعب\nمدل RBAC با چهار نقش. اسکیمای PostgreSQL شامل جداول roles, permissions, role_permissions, user_roles با ستون branch_id و جدول audit_log. کوئری بررسی دسترسی با EXISTS. درس: تفکیک وظایف (SoD) بین حسابرس و رئیس شعبه باید در سطح دیتابیس با constraint اعمال شود.",
        },
      ],
      jsonSchema: KNOWLEDGE_SCHEMA,
      thinking: "LOW",
      deadline: Date.now() + 110_000,
      partialKey: "k",
      ctx: c,
    });
    console.log("model:", model, "items:", data.items.length, data.items.map((i) => `${i.kind}:${i.title}`));
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0].content.length).toBeGreaterThan(20);
  });

  it("continues a partial answer when the deadline is short", async () => {
    const c = ctx();
    const res = await generate({
      agent: "research",
      models: MODELS,
      system: "پاسخ فارسی و کوتاه.",
      userParts: [{ text: "سه مزیت صف‌بندی کارها در سیستم‌های توزیع‌شده را در سه خط بنویس." }],
      thinking: "LOW",
      deadline: Date.now() + 60_000,
      partialKey: "r",
      ctx: c,
    });
    expect(res.text.length).toBeGreaterThan(20);
  });
});
