import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crypto", () => ({ decrypt: (v: string | undefined) => (v ? "123:SECRET" : "") }));
vi.mock("@/lib/db", () => ({ db: () => null }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { emailCustomer, notifyTeam } from "@/lib/notify";
import { allowAi } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { dueAt } from "@/lib/ticket-meta";
import type { NotifySettings } from "@/lib/settings-types";

const n: NotifySettings = { channel: "telegram", chatId: "-100", emailCustomers: true, botTokenEnc: "enc" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("notifyTeam", () => {
  it("reports a message the Bot API rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, { status: 400 })));
    expect(await notifyTeam(n, "hi")).toEqual({ ok: false, error: "Bad Request: chat not found" });
  });

  it("reports success only when the Bot API accepts the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, result: {} })));
    expect(await notifyTeam(n, "hi")).toEqual({ ok: true });
  });

  it("keeps the bot token out of a network error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect failed for https://api.telegram.org/bot123:SECRET/sendMessage");
    }));
    const r = await notifyTeam(n, "hi");
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("SECRET");
  });

  it("does nothing when no channel is configured", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await notifyTeam({ ...n, channel: "none" }, "hi")).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("emailCustomer", () => {
  it("logs an e-mail that Resend rejected", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("MAIL_FROM", "Pars <support@example.com>");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("domain is not verified", { status: 403 })));
    await emailCustomer("c@example.com", "s", "<p>x</p>");
    expect(err).toHaveBeenCalledWith("[email] rejected", 403, "domain is not verified");
    expect(err).toHaveBeenCalledWith("[notify] e-mail rejected", "HTTP 403 domain is not verified");
  });

  it("sends nothing while no Resend key or sender is configured", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await emailCustomer("c@example.com", "s", "<p>x</p>");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("shared AI budget", () => {
  it("reads AI_DAILY_LIMIT, defaulting to 1500", () => {
    expect(env.aiDailyLimit).toBe(1500);
    vi.stubEnv("AI_DAILY_LIMIT", "abc");
    expect(env.aiDailyLimit).toBe(1500);
    vi.stubEnv("AI_DAILY_LIMIT", "0");
    expect(env.aiDailyLimit).toBe(1500);
    vi.stubEnv("AI_DAILY_LIMIT", "300");
    expect(env.aiDailyLimit).toBe(300);
  });

  it("is one counter for all visitors", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "2");
    expect([await allowAi(), await allowAi(), await allowAi()]).toEqual([true, true, false]);
  });
});

describe("dueAt", () => {
  it("counts the SLA from the creation time", () => {
    expect(dueAt("2026-10-01T08:00:00.000Z", "urgent")).toBe("2026-10-01T10:00:00.000Z");
    expect(dueAt("2026-10-01T08:00:00.000Z", "low")).toBe("2026-10-04T08:00:00.000Z");
  });
});
