/**
 * Live check of the pre-work agents (analyze → plan) on real attachments; prints the brief.
 * Run with:
 *   LIVE=1 GEMINI_API_KEY=... PREWORK_FILES="a.html,b.html" PREWORK_PROMPT_FILE=prompt.txt \
 *   PREWORK_OUT=/tmp/out npx vitest run tests/live/prework.live.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generate, generateJson, resolveModels, type GenContext } from "@/lib/ai/gemini";
import { DEFAULT_PROMPTS, PLAN_SCHEMA } from "@/lib/ai/prompts";
import { fileRefsToParts, type FileRef } from "@/lib/ai/files";

const files = (process.env.PREWORK_FILES ?? "").split(",").filter(Boolean);
const live = !!process.env.LIVE && !!process.env.GEMINI_API_KEY && files.length > 0;

function ctx(): GenContext {
  let partial: { key: string; text: string; model?: string } | null = null;
  const blocked: Record<string, { blocked_until?: string; reason?: string }> = {};
  return {
    getPartial: () => partial,
    savePartial: async (p) => {
      partial = p;
    },
    live: () => undefined,
    log: async (e) => console.log(`[log] ${e.title}`),
    blockedModels: async () => blocked,
    blockModel: async (m, until, reason) => {
      blocked[m] = { blocked_until: until.toISOString(), reason };
    },
    addUsage: () => undefined,
  };
}

describe.skipIf(!live)("pre-work agents (live)", () => {
  it("writes a grounded, compact brief", async () => {
    const prompt = process.env.PREWORK_PROMPT_FILE ? fs.readFileSync(process.env.PREWORK_PROMPT_FILE, "utf-8") : "یک دستور کار آماده کن.";
    const refs: FileRef[] = files.map((f, i) => ({ id: String(i), name: path.basename(f), mime: "text/html", text: fs.readFileSync(f, "utf-8") }));
    const request = `# تسک: گزارش آزمایشی (T-0001)\n\n## شرح تسک\n${prompt}`;
    const models = await resolveModels(["auto"]);
    console.log("models:", models.join(" → "));
    const deadline = () => Date.now() + 10 * 60_000;

    const analysis = await generate({
      agent: "analyze",
      models,
      system: DEFAULT_PROMPTS.analyze,
      userParts: [
        { text: `${request}\n\n## دستور مدیر\n${prompt}\n\n## فایل‌های پیوست (${refs.length} فایل)\n${refs.map((r) => `- ${r.name}`).join("\n")}\nمحتوای فایل‌ها در ادامه آمده است؛ آن‌ها را کامل و دقیق بررسی کن.` },
        ...fileRefsToParts(refs),
      ],
      thinking: "HIGH",
      maxOutputTokens: 32000,
      deadline: deadline(),
      partialKey: "analyze",
      ctx: ctx(),
    });
    const { data } = await generateJson<{ reply?: string; brief?: string; helper_files?: { path: string; purpose: string; instructions: string }[] }>({
      agent: "plan",
      models,
      system: DEFAULT_PROMPTS.plan,
      userParts: [{ text: `${request}\n\n## دستور مدیر\n${prompt}\n\n## تحلیل (ایجنت ۱)\n${analysis.text}` }, ...fileRefsToParts(refs)],
      jsonSchema: PLAN_SCHEMA,
      thinking: "HIGH",
      maxOutputTokens: 32000,
      deadline: deadline(),
      partialKey: "plan",
      ctx: ctx(),
    });
    const out = process.env.PREWORK_OUT;
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, "analysis.md"), analysis.text);
      fs.writeFileSync(path.join(out, "brief.md"), data.brief ?? "");
      fs.writeFileSync(path.join(out, "reply.md"), data.reply ?? "");
      fs.writeFileSync(path.join(out, "helpers.json"), JSON.stringify(data.helper_files ?? [], null, 2));
    }
    console.log(`analysis ${analysis.text.length} chars (${analysis.model}); brief ${data.brief?.length} chars; helpers ${data.helper_files?.length ?? 0}`);
    expect(data.brief?.length ?? 0).toBeGreaterThan(500);
    expect(data.reply?.length ?? 0).toBeGreaterThan(20);
  }, 20 * 60_000);
});
