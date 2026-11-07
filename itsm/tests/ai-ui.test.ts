// The pure parts of the AI screens: connection status, chains, budgets and figures, the setup strip, error classes,
// confidence levels and the AI settings' feature switches.
import { describe, expect, it } from "vitest";
import type { AiConnectionPublic } from "@shared/ai/types";
import type { AiStatus } from "@shared/ai/api";
import {
  FEATURE_KEYS,
  budgetShare,
  budgetState,
  cleanChain,
  cleanKey,
  confidenceLevel,
  connectionTone,
  autoChain,
  defaultLink,
  errorKindOf,
  modelOptions,
  moveLink,
  stripOf,
  tokens,
  usd,
} from "../src/ui/ai/kit/model";
import { withDefaults } from "../src/ui/ai/settings/AiSettings";

const conn = (o: Partial<AiConnectionPublic> = {}): AiConnectionPublic => ({
  id: "c1",
  label: "Claude",
  preset: "anthropic",
  protocol: "anthropic",
  base_url: null,
  has_key: true,
  key_hint: "…a1B2",
  models: { smart: ["claude-opus-5-5"], fast: ["claude-haiku-5-5"], vision: [] },
  status: "ok",
  last_error: null,
  checked_at: null,
  paused_until: null,
  enabled: true,
  priority: 1,
  free_tier: false,
  updated_at: "2026-11-02T00:00:00Z",
  ...o,
});

const status = (o: Partial<AiStatus> = {}): AiStatus => ({
  enabled: true,
  configured: true,
  ok: true,
  kind: null,
  message_fa: null,
  remedy_fa: null,
  can_use: true,
  can_propose: true,
  can_manage: true,
  features: { assistant: true, proposals: true, files: true },
  budget: { state: "ok", month_usd: "0", month_cap_usd: null, today_usd: "0", today_cap_usd: null, alert_pct: 80 },
  model: null,
  connection: null,
  route: null,
  mode: "cloud",
  app_secret_missing: false,
  ...o,
});

describe("connections and chains", () => {
  it("names a connection's state: سالم / نیاز به توجه / بررسی نشده / متوقف / غیرفعال", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    expect(connectionTone(conn(), now)).toBe("ok");
    expect(connectionTone(conn({ status: "error" }), now)).toBe("attention");
    expect(connectionTone(conn({ key_unreadable: true }), now)).toBe("attention");
    expect(connectionTone(conn({ status: "unchecked" }), now)).toBe("unchecked");
    expect(connectionTone(conn({ paused_until: "2026-11-02T11:00:00Z" }), now)).toBe("paused");
    expect(connectionTone(conn({ paused_until: "2026-11-02T09:00:00Z" }), now)).toBe("ok");
    expect(connectionTone(conn({ enabled: false, status: "error" }), now)).toBe("off");
  });

  it("moves, cleans and defaults chains", () => {
    const a = { connection_id: "c1", model: "m1" };
    const b = { connection_id: "c2", model: "m2" };
    expect(moveLink([a, b], 1, -1)).toEqual([b, a]);
    expect(moveLink([a, b], 0, -1)).toEqual([a, b]);
    expect(cleanChain([a, a, b, { connection_id: "gone", model: "x" }, { connection_id: "c1", model: " " }], new Set(["c1", "c2"]))).toEqual([a, b]);
    const list = [conn({ id: "c2", priority: 2 }), conn({ id: "c1", priority: 1, models: { smart: ["s"], fast: [], vision: [] } })];
    expect(defaultLink("assistant", list)).toEqual({ connection_id: "c1", model: "s" });
    // no fast model: the smart one serves
    expect(defaultLink("fast", list)).toEqual({ connection_id: "c1", model: "s" });
    expect(defaultLink("assistant", [conn({ enabled: false })])).toBeNull();
    // «خودکار» runs every model of the tier in order, connection by connection (free quotas are per model)
    const free = conn({ id: "g", priority: 1, models: { smart: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.8-flash"], fast: ["gemini-3.5-flash-lite"], vision: [] } });
    const paid = conn({ id: "p", priority: 2, models: { smart: ["claude-opus-5-5"], fast: [], vision: [] } });
    expect(autoChain("assistant", [paid, free])).toEqual([
      { connection_id: "g", model: "gemini-3.8-flash" },
      { connection_id: "g", model: "gemini-3.6-flash" },
      { connection_id: "p", model: "claude-opus-5-5" },
    ]);
    expect(autoChain("vision", [free])).toEqual([
      { connection_id: "g", model: "gemini-3.8-flash" },
      { connection_id: "g", model: "gemini-3.6-flash" },
    ]);
    expect(modelOptions(conn({ available_models: ["claude-opus-5-5", "claude-sonnet-5-5"] }), "fast")).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  it("cleans pasted keys of spaces and direction marks", () => {
    expect(cleanKey(" sk-ant-‏abc‎ 123\n")).toBe("sk-ant-abc123");
  });
});

describe("budgets and figures", () => {
  it("shares and states", () => {
    expect(budgetShare("5", null)).toBeNull();
    expect(budgetShare("5", "20")).toBe(0.25);
    expect(budgetState(0.5, 80)).toBe("ok");
    expect(budgetState(0.85, 80)).toBe("alert");
    expect(budgetState(1, 80)).toBe("over");
    expect(budgetState(null, 80)).toBe("ok");
  });

  it("formats dollars and tokens in Persian", () => {
    expect(usd("12.4")).toBe("۱۲٫۴۰");
    expect(usd("0.0012")).toBe("۰٫۰۰۱۲");
    expect(usd(0)).toBe("۰");
    expect(tokens(950)).toBe("۹۵۰");
    expect(tokens(1500)).toBe("۱٫۵ هزار");
    expect(tokens(2_300_000)).toBe("۲٫۳ میلیون");
  });
});

describe("status, errors and confidence", () => {
  it("shows the AI strip only to managers, only when something needs them", () => {
    expect(stripOf(undefined)).toBeNull();
    expect(stripOf(status())).toBeNull();
    expect(stripOf(status({ configured: false, ok: false, kind: "not_configured" }))).toBe("setup");
    expect(stripOf(status({ configured: false, can_manage: false }))).toBeNull();
    // switched off on purpose: no nagging
    expect(stripOf(status({ enabled: false, configured: false }))).toBeNull();
    expect(stripOf(status({ budget: { state: "stopped", month_usd: "20", month_cap_usd: "20", today_usd: "1", today_cap_usd: null, alert_pct: 80 } }))).toBe("budget");
    expect(stripOf(status({ ok: false, kind: "auth" }))).toBe("problem");
    expect(stripOf(status({ ok: false, kind: "overloaded" }))).toBeNull();
  });

  it("finds the AI error class of a failed request", () => {
    expect(errorKindOf({ code: "not_configured" })).toBe("not_configured");
    expect(errorKindOf({ code: "bad_request", details: { kind: "budget" } })).toBe("budget");
    expect(errorKindOf({ code: "ai_quota", status: 409 })).toBe("quota");
    expect(errorKindOf({ code: "network", status: 0 })).toBeNull();
    expect(errorKindOf({ code: "forbidden" })).toBeNull();
    expect(errorKindOf(null)).toBeNull();
  });

  it("levels confidence like a review bar", () => {
    expect(confidenceLevel(0.95)).toBe("high");
    expect(confidenceLevel(0.7)).toBe("mid");
    expect(confidenceLevel(0.2)).toBe("low");
    expect(confidenceLevel(undefined)).toBe("low");
  });
});

describe("AI settings", () => {
  it("offers a switch for every feature of the shared settings, on by default", () => {
    expect(FEATURE_KEYS).toEqual(["assistant", "proposals", "files"]);
    const s = withDefaults(null);
    expect(s.features).toEqual({ assistant: true, proposals: true, files: true });
    expect(s).toMatchObject({ enabled: true, data_policy: "masked", retention_days: 90, use_cloud: false, cloud_first: [] });
    // a stored row keeps its own choices
    expect(withDefaults({ features: { assistant: true, proposals: false, files: false } } as never).features).toEqual({ assistant: true, proposals: false, files: false });
  });
});
