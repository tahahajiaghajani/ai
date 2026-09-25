import { describe, expect, it } from "vitest";
import { detectClaudeLimit } from "@/lib/claude/limits";

describe("detectClaudeLimit", () => {
  const now = new Date("2026-09-25T10:00:00Z");

  it("ignores normal output", () => {
    expect(detectClaudeLimit("All done. Tests pass.", now).limited).toBe(false);
  });

  it("parses epoch reset times", () => {
    const r = detectClaudeLimit("Claude AI usage limit reached|1790000000", now);
    expect(r.limited).toBe(true);
    expect(r.resetAt!.getTime()).toBe(1790000000 * 1000 + 60_000);
  });

  it("parses 'resets 5pm (Asia/Tehran)'", () => {
    const r = detectClaudeLimit("You've hit your session limit · resets 5pm (Asia/Tehran)", now);
    expect(r.limited).toBe(true);
    expect(r.kind).toBe("session");
    // 5pm Tehran (UTC+3:30) = 13:30 UTC, +1 minute buffer
    expect(r.resetAt!.toISOString()).toBe("2026-09-25T13:31:00.000Z");
  });

  it("parses weekly limits with weekday", () => {
    const r = detectClaudeLimit("You've hit your weekly limit · resets Mon 9am (UTC)", now);
    expect(r.kind).toBe("weekly");
    expect(r.resetAt!.getUTCDay()).toBe(1);
    expect(r.resetAt!.getUTCHours()).toBe(9);
  });

  it("falls back to a default wait", () => {
    const r = detectClaudeLimit("Request rejected (429)", now);
    expect(r.limited).toBe(true);
    expect(r.resetAt!.getTime()).toBeGreaterThan(now.getTime());
  });
});
