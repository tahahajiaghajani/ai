import { describe, expect, it } from "vitest";
import { rateKind, retryHint } from "@/lib/ai/llm/openai";
import { strictSchema } from "@/lib/ai/llm/anthropic";
import { validateInput } from "@/lib/ai/agent";
import { providerPreset, suggestModel } from "@/lib/ai/providers";

describe("provider errors", () => {
  it("tells a per-minute limit from an empty account", () => {
    const google =
      "You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generate_content_free_tier_requests, limit: 5, model: gemini-3.8-flash\nPlease retry in 56.77s. quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier";
    expect(rateKind(null, google)).toBe("rate");
    expect(retryHint(google)).toBe(56_770);
    expect(rateKind(null, "Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier")).toBe("quota_daily");
    expect(rateKind("insufficient_quota", "You exceeded your current quota")).toBe("quota_none");
    expect(rateKind(null, "Quota exceeded for metric: x, limit: 0, model: gemini-pro")).toBe("quota_none");
    expect(rateKind(null, "Too many requests")).toBe("rate");
  });
});

describe("structured output schema for Claude", () => {
  it("closes objects and drops unsupported constraints", () => {
    const s = strictSchema({ type: "object", properties: { a: { type: "array", maxItems: 3, items: { type: "object", properties: { b: { type: "integer", minimum: 0 } } } } } }) as Record<string, any>;
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.a.maxItems).toBeUndefined();
    expect(s.properties.a.items.additionalProperties).toBe(false);
    expect(s.properties.a.items.properties.b.minimum).toBeUndefined();
  });
});

describe("tool input validation", () => {
  const def = { name: "edit_file", description: "", parameters: { type: "object", properties: { path: { type: "string" }, line: { type: "integer" }, items: { type: "array" } }, required: ["path"] } };
  it("checks required keys and types", () => {
    expect(validateInput(def, { path: "a.ts" })).toBeNull();
    expect(validateInput(def, {})).toContain("path");
    expect(validateInput(def, { path: "a", line: 1.5 })).toContain("line");
    expect(validateInput(def, { path: "a", items: "x" })).toContain("items");
    expect(validateInput(def, { __invalid_json: true })).toContain("JSON");
  });
});

describe("providers", () => {
  it("suggests the newest preferred model", () => {
    expect(suggestModel("anthropic", ["claude-haiku-4-5", "claude-opus-5-5", "claude-sonnet-5-5"])).toBe("claude-opus-5-5");
    expect(suggestModel("openai", ["gpt-4o", "gpt-5.1", "gpt-5"])).toBe("gpt-5.1");
    expect(suggestModel("google", [])).toBe("auto");
    expect(providerPreset("unknown").id).toBe("custom");
  });
});
