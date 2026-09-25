import { describe, expect, it } from "vitest";
import { nextPacificMidnight, parseGeminiError } from "@/lib/ai/quota";

const inner = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota.\n* Quota exceeded for metric: x, limit: 0, model: gemini-3.1-pro\nPlease retry in 13.51778702s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "13s" },
    ],
  },
});

describe("parseGeminiError", () => {
  it("unwraps the SDK's nested error JSON and reads quota details", () => {
    const err = Object.assign(new Error(JSON.stringify({ error: { message: inner, code: 429, status: "Too Many Requests" } })), { status: 429 });
    const info = parseGeminiError(err);
    expect(info.isQuota).toBe(true);
    expect(info.isDaily).toBe(true);
    expect(info.limitZero).toBe(true);
    expect(info.retryDelayMs).toBe(13_000);
  });

  it("detects per-minute limits and overload", () => {
    const perMinute = parseGeminiError({
      status: 429,
      message: JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "slow down", details: [{ "@type": "x.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] } }),
    });
    expect(perMinute.isQuota && !perMinute.isDaily).toBe(true);
    const overloaded = parseGeminiError({ status: 503, message: '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}' });
    expect(overloaded.isOverloaded).toBe(true);
  });

  it("computes the next Pacific midnight in the future", () => {
    const now = new Date("2026-09-25T06:00:00Z");
    const next = nextPacificMidnight(now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(25 * 3600_000);
  });
});
