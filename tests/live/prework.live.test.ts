/**
 * Live check of the default pre-work workflow's agents on real attachments:
 * analyze → brief → (helpers ‖ summary, in parallel). Writes the outputs to PREWORK_OUT.
 * Run with:
 *   LIVE=1 GEMINI_API_KEY=... PREWORK_FILES="a.html,b.html" PREWORK_PROMPT_FILE=prompt.txt \
 *   PREWORK_OUT=/tmp/out npx vitest run tests/live/prework.live.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generate, generateJson, resolveModels, type GenContext } from "@/lib/ai/gemini";
import { DEFAULT_AGENTS } from "@/lib/workflow/registry";
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

    const agent = (id: string) => DEFAULT_AGENTS.find((a) => a.id === id)!;
    const head = `${request}\n\n## دستور مدیر\n${prompt}`;
    const attached = `\n\n## فایل‌های پیوست (${refs.length} فایل)\n${refs.map((r) => `- ${r.name}`).join("\n")}\nمحتوای فایل‌ها در ادامه آمده است؛ آن‌ها را کامل و دقیق بررسی کن.`;
    const analysis = await generate({
      agent: "analyze",
      models,
      system: agent("analyze").prompt,
      userParts: [{ text: head + attached }, ...fileRefsToParts(refs)],
      thinking: "HIGH",
      maxOutputTokens: 32000,
      deadline: deadline(),
      partialKey: "analyze",
      ctx: ctx(),
    });
    const brief = await generate({
      agent: "brief",
      models,
      system: agent("brief").prompt,
      userParts: [{ text: `${head}\n\n## خروجی مراحل قبل\n### تحلیل\n${analysis.text}${attached}` }, ...fileRefsToParts(refs)],
      thinking: "HIGH",
      maxOutputTokens: 32000,
      deadline: deadline(),
      partialKey: "brief",
      ctx: ctx(),
    });
    const after = `${head}\n\n## خروجی مراحل قبل\n### دستور کار\n${brief.text}`;
    // the two steps after the brief run at the same time, like in the workflow
    const [helpers, summary] = await Promise.all([
      generateJson<{ files?: { name: string; purpose: string; content: string }[] }>({
        agent: "helpers",
        models,
        system: agent("helpers").prompt,
        userParts: [{ text: after + attached }, ...fileRefsToParts(refs)],
        jsonSchema: {
          type: "object",
          properties: { files: { type: "array", maxItems: 3, items: { type: "object", properties: { name: { type: "string" }, purpose: { type: "string" }, content: { type: "string" } }, required: ["name", "purpose", "content"] } } },
          required: ["files"],
        },
        thinking: "MEDIUM",
        maxOutputTokens: 32000,
        deadline: deadline(),
        partialKey: "helpers",
        ctx: ctx(),
      }),
      generate({ agent: "summary", models, system: agent("summary").prompt, userParts: [{ text: after }], thinking: "LOW", deadline: deadline(), partialKey: "summary", ctx: ctx() }),
    ]);
    const data = { brief: brief.text, reply: summary.text, helper_files: helpers.data.files ?? [] };
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
