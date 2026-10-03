/**
 * Live checks of the multi-provider layer against real APIs (consume a little free-tier quota).
 * Run with:  LIVE=1 GEMINI_API_KEY=... npx vitest run tests/live
 * The OpenAI-compatible path is checked through Google's OpenAI-compatible endpoint, so one Gemini
 * key covers the Google adapter, the OpenAI adapter and the tool-calling code agent.
 */
import { describe, expect, it } from "vitest";
import { generate, generateJson, type GenContext } from "@/lib/ai/generate";
import { adapterFor } from "@/lib/ai/llm";
import { runAgent, type AgentTranscript } from "@/lib/ai/agent";
import { WorkFS, workTools } from "@/lib/projects/fs";
import { RateLimitError } from "@/lib/errors";
import type { Connection } from "@/lib/connections";

const key = process.env.GEMINI_API_KEY ?? "";
const live = !!process.env.LIVE && !!key;

function conn(provider: string, baseUrl: string | null = null): Connection {
  const now = new Date().toISOString();
  return { id: `c-${provider}`, user_id: "u1", kind: "ai", provider, label: provider, base_url: baseUrl, secret: key, secret_hint: null, config: {}, status: "ok", last_error: null, checked_at: now, created_at: now, updated_at: now };
}

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

const google = () => conn("google");
const openaiCompat = () => conn("custom", "https://generativelanguage.googleapis.com/v1beta/openai");

describe.skipIf(!live)("multi-provider LLM layer (live)", () => {
  it("lists Google models", async () => {
    const models = await adapterFor(google()).listModels();
    expect(models.some((m) => /flash/.test(m))).toBe(true);
  });

  it("Google: generates text with the auto model", async () => {
    const r = await generate({
      agent: "t",
      conn: google(),
      model: "auto",
      system: "پاسخ را فقط فارسی و در یک جمله بده.",
      user: [{ type: "text", text: "پایتخت ایران کجاست؟" }],
      deadline: Date.now() + 90_000,
      partialKey: "a",
      ctx: ctx(),
    });
    expect(r.text).toMatch(/تهران/);
  });

  it("Google: returns JSON that matches a schema", async () => {
    const schema = { type: "object", properties: { city: { type: "string" }, population_millions: { type: "number" } }, required: ["city", "population_millions"] };
    const r = await generateJson<{ city: string; population_millions: number }>({
      agent: "t",
      conn: google(),
      model: "auto",
      system: "Answer with data only.",
      user: [{ type: "text", text: "Largest city of Iran?" }],
      jsonSchema: schema,
      deadline: Date.now() + 90_000,
      partialKey: "j",
      ctx: ctx(),
    });
    expect(r.data.city.toLowerCase()).toContain("tehran");
    expect(typeof r.data.population_millions).toBe("number");
  });

  it("OpenAI-compatible: generates text", async () => {
    const r = await generate({
      agent: "t",
      conn: openaiCompat(),
      model: "gemini-flash-latest",
      system: "Reply in one short English sentence.",
      user: [{ type: "text", text: "Say hello." }],
      deadline: Date.now() + 90_000,
      partialKey: "o",
      ctx: ctx(),
    });
    expect(r.text.length).toBeGreaterThan(2);
  });

  for (const [name, make, model] of [
    ["Google", google, "auto"],
    ["OpenAI-compatible", openaiCompat, "gemini-flash-latest"],
  ] as const) {
    it(`${name}: continues a transcript whose tool calls came from another model (no signatures)`, async () => {
      const fs = new WorkFS({ "notes.md": "سلام\n" }, null, null);
      const transcript: AgentTranscript = {
        messages: [
          { role: "user", content: [{ type: "text", text: "فایل notes.md را بخوان و بعد کار را با یک خلاصه‌ی یک‌خطی تمام کن." }] },
          { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "read_file", input: { path: "notes.md" } }] },
          { role: "user", content: [{ type: "tool_result", id: "call_1", name: "read_file", content: "1\tسلام" }] },
        ],
        turns: 1,
        model: "another-model",
      };
      let res: Awaited<ReturnType<typeof runAgent>> | null = null;
      for (let attempt = 0; attempt < 6 && !res; attempt++) {
        try {
          res = await runAgent({ agent: "coder", conn: make(), model, system: "Use the tools. Finish with the finish tool.", tools: workTools(fs, { write: true }), transcript, maxTurns: 6, deadline: Date.now() + 200_000, ctx: ctx(), save: async () => undefined, finishTool: "finish" });
        } catch (err) {
          if (!(err instanceof RateLimitError)) throw err;
          await new Promise((r) => setTimeout(r, Math.min(Math.max(err.until.getTime() - Date.now(), 5_000), 70_000)));
        }
      }
      expect(res?.summary.length).toBeGreaterThan(0);
    }, 600_000);
  }

  for (const [name, make, model] of [
    ["Google", google, "auto"],
    ["OpenAI-compatible", openaiCompat, "gemini-flash-latest"],
  ] as const) {
    it(`${name}: the code agent finds the named file, fixes it and finishes`, async () => {
      const fs = new WorkFS(
        {
          "src/audit.ts": "export function total(items: number[]) {\n  let sum = 0;\n  for (let i = 1; i < items.length; i++) sum += items[i];\n  return sum;\n}\n",
          "src/other.ts": "export const x = 1;\n",
        },
        null,
        null,
      );
      const written: string[] = [];
      const transcript: AgentTranscript = {
        messages: [{ role: "user", content: [{ type: "text", text: "فایل audit.ts باگ دارد: جمع، عضو اول آرایه را حساب نمی‌کند. پیدا و با کمترین تغییر درستش کن، بعد کار را تمام کن." }] }],
        turns: 0,
      };
      // free keys allow ~5 requests a minute: wait out a limit and continue the same transcript,
      // exactly as the queue does between worker runs
      const once = () => runAgent({
        agent: "coder",
        conn: make(),
        model,
        system: "You are a careful code agent. Use the tools to read and edit files. When done call finish with a one-line Persian summary.",
        tools: workTools(fs, { write: true, onWrite: (p) => written.push(p) }),
        transcript,
        maxTurns: 12,
        deadline: Date.now() + 280_000,
        ctx: ctx(),
        save: async () => undefined,
        finishTool: "finish",
      });
      let res: Awaited<ReturnType<typeof once>> | null = null;
      for (let attempt = 0; attempt < 6 && !res; attempt++) {
        try {
          res = await once();
        } catch (err) {
          if (!(err instanceof RateLimitError)) throw err;
          await new Promise((r) => setTimeout(r, Math.min(Math.max(err.until.getTime() - Date.now(), 5_000), 70_000)));
        }
      }
      expect(res).not.toBeNull();
      expect(fs.staged["src/audit.ts"]).toMatch(/i = 0/);
      expect(fs.staged["src/other.ts"]).toBe("export const x = 1;\n");
      expect(written).toContain("src/audit.ts");
      expect(res!.summary.length).toBeGreaterThan(0);
    }, 600_000);
  }
});
