import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  aiEnabled: true,
  blocked: [] as string[],
  aiAllowed: true,
  sent: null as { role: string; content: string }[] | null,
}));

vi.mock("@/lib/settings", () => ({
  getSettings: async () => ({ ai: { enabled: h.aiEnabled }, chat: { perTenMinutes: 20, perDay: 120, logChats: false } }),
}));
vi.mock("@/lib/rate-limit", () => ({
  allow: vi.fn(async (key: string) => !h.blocked.some((b) => key.startsWith(b))),
  allowAi: vi.fn(async () => h.aiAllowed),
}));
vi.mock("@/lib/knowledge", () => ({ getKnowledge: async () => ({ entries: [] }) }));
vi.mock("@/lib/chat-log", () => ({ logChat: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/ai/runtime", () => ({
  chatSystemPrompt: () => "system",
  runtimeFrom: () => ({ provider: "google", apiKey: "k", baseUrl: "", models: ["m"], temperature: 0.4, maxTokens: 900, instructions: "" }),
  openStream: vi.fn(async (_rt: unknown, _system: string, messages: { role: string; content: string }[]) => {
    h.sent = messages;
    return {
      model: "m",
      chunks: (async function* () {
        yield "hello";
      })(),
    };
  }),
}));

import { POST } from "@/app/api/chat/route";
import { allow, allowAi } from "@/lib/rate-limit";
import { openStream } from "@/lib/ai/runtime";

const ask = (messages: { role: string; content: string }[]) =>
  POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ messages, lang: "en" }), headers: { "x-forwarded-for": "1.2.3.4" } }));

const q = [{ role: "user", content: "What does Pars do?" }];

beforeEach(() => {
  h.aiEnabled = true;
  h.blocked = [];
  h.aiAllowed = true;
  h.sent = null;
  vi.mocked(allow).mockClear();
  vi.mocked(allowAi).mockClear();
  vi.mocked(openStream).mockClear();
});

describe("chat route limits", () => {
  it("streams an answer when every limit passes", async () => {
    const res = await ask(q);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(allowAi).toHaveBeenCalledTimes(1);
  });

  it("checks the shared budget only after the per-visitor limits pass", async () => {
    h.blocked = ["chat:day:"];
    const res = await ask(q);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate" });
    expect(allowAi).not.toHaveBeenCalled();
  });

  it("answers busy without calling the model once the shared daily budget is used up", async () => {
    h.aiAllowed = false;
    const res = await ask(q);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "busy" });
    expect(openStream).not.toHaveBeenCalled();
  });

  it("does not spend the budget while the assistant is switched off", async () => {
    h.aiEnabled = false;
    const res = await ask(q);
    expect(await res.text()).toMatch(/not available/);
    expect(allowAi).not.toHaveBeenCalled();
  });
});

describe("chat route history", () => {
  it("drops the oldest turns beyond the size budget, then any leading assistant turn", async () => {
    const big = (c: string, n: number) => c.repeat(n);
    await ask([
      { role: "user", content: big("a", 4000) },
      { role: "assistant", content: big("b", 4000) },
      { role: "user", content: big("c", 4000) },
      { role: "assistant", content: big("d", 3000) },
      { role: "user", content: "and the price?" },
    ]);
    expect(h.sent?.map((m) => [m.role, m.content[0], m.content.length])).toEqual([
      ["user", "c", 4000],
      ["assistant", "d", 3000],
      ["user", "a", 14],
    ]);
  });

  it("keeps a short conversation as it is", async () => {
    const convo = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "demos?" },
    ];
    await ask(convo);
    expect(h.sent).toEqual(convo);
  });
});
