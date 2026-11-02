// The pure parts of the AI screens (stream E2): connection status, chains, budgets, confidence, the tolerant readers
// of the features' responses (explain, capture, forecasts, plans) and the capture file checks.
import { describe, expect, it } from "vitest";
import type { AiConnectionPublic, AiInsight } from "@shared/ai/types";
import type { AiStatus } from "@shared/ai/api";
import { fromJalali } from "@shared/jalali";
import {
  amountOf,
  budgetShare,
  budgetState,
  captureRows,
  cleanChain,
  cleanKey,
  confidenceLevel,
  connectionTone,
  dayOf,
  defaultLink,
  errorKindOf,
  explainOf,
  feedOf,
  lineConfidence,
  modelOptions,
  moveLink,
  stripOf,
  tokens,
  usd,
} from "../src/ui/ai/kit/model";
import type { AiCashWeek } from "@shared/ai/api";
import type { AiForecastSeries } from "@shared/ai/types";
import { adviceOf, cashOf, cashSummary, coverageRatio, fanRows, plansOf, rangePos, ratesOf, seriesOf } from "../src/ui/ai/forecast/data";
import { captureOf, fileProblem, shrinkSize } from "../src/ui/ai/capture/file";
import { lineNumbers } from "../src/ui/ai/capture/apply";

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
  features: { assistant: true, proposals: true, insights: true, explain: true, capture: true, forecast: true },
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

describe("dashboard", () => {
  const ins = (id: string, severity: AiInsight["severity"], st: AiInsight["status"], at: string): AiInsight => ({
    id,
    kind: "x",
    module: "core",
    severity,
    title_fa: id,
    body_fa: "",
    why_fa: "",
    facts: [],
    refs: [],
    status: st,
    created_at: at,
  });

  it("orders the insights feed by severity then date and drops dismissed, done and snoozed ones", () => {
    const feed = feedOf([
      ins("a", "info", "new", "2026-11-02"),
      ins("b", "critical", "seen", "2026-11-01"),
      ins("c", "warning", "dismissed", "2026-11-02"),
      ins("d", "warning", "new", "2026-11-02"),
      ins("e", "critical", "new", "2026-11-02"),
      ins("f", "notice", "snoozed", "2026-11-02"),
    ]);
    expect(feed.map((i) => i.id)).toEqual(["e", "b", "d", "a"]);
  });

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
});

describe("explain", () => {
  it("reads the narrative under any of the server's names", () => {
    const x = explainOf({ explanation: { markdown: "**سود** بیشتر شد", key_points: ["فروش ۱۲٪ بیشتر"], follow_ups: [{ text: "چرا؟" }], model: "m" } });
    expect(x).toMatchObject({ narrative: "**سود** بیشتر شد", points: ["فروش ۱۲٪ بیشتر"], questions: ["چرا؟"], source: "ai", model: "m" });
    expect(explainOf({ narrative: "متن", points: [], questions: [], source: "template" }).source).toBe("template");
    expect(explainOf(null)).toMatchObject({ narrative: "", points: [], questions: [] });
  });

  it("finds the AI error class of a failed request", () => {
    expect(errorKindOf({ code: "not_configured" })).toBe("not_configured");
    expect(errorKindOf({ code: "bad_request", details: { kind: "budget" } })).toBe("budget");
    expect(errorKindOf({ code: "ai_quota", status: 409 })).toBe("quota");
    expect(errorKindOf({ code: "network", status: 0 })).toBeNull();
    expect(errorKindOf({ code: "forbidden" })).toBeNull();
    expect(errorKindOf(null)).toBeNull();
  });
});

describe("capture", () => {
  it("levels confidence like a review bar", () => {
    expect(confidenceLevel(0.95)).toBe("high");
    expect(confidenceLevel(0.7)).toBe("mid");
    expect(confidenceLevel(0.2)).toBe("low");
    expect(confidenceLevel(undefined)).toBe("low");
  });

  it("normalises a capture result: percentages, bare values and wrappers", () => {
    const r = captureOf(
      { capture: { id: "k", fields: { national_id: { value: "0012345678", confidence: 92 }, first_name: "علی", empty: null }, lines: [{ description: { value: "پیچ", confidence: 0.9 }, qty: { value: "۱۰", confidence: 0.6 } }], warnings: ["کد ملی معتبر نیست"], model: "gemini-4-argon" } },
      "id_card",
    );
    expect(r.kind).toBe("id_card");
    expect(r.fields.national_id).toEqual({ value: "0012345678", confidence: 0.92 });
    expect(r.fields.first_name.value).toBe("علی");
    expect(r.fields.empty).toBeUndefined();
    expect(r.lines?.[0].qty.confidence).toBe(0.6);
    expect(lineConfidence(r.lines![0])).toBe(0.6);
    expect(r.warnings).toEqual(["کد ملی معتبر نیست"]);
    // the kind's fields in order, labelled; helper keys hidden; the server's party match last
    const rows = captureRows("id_card", { extra: { value: "x", confidence: 1 }, birth_date_iso: { value: "1990-01-01", confidence: 1 }, national_id: { value: "1", confidence: 1 }, first_name: { value: "علی", confidence: 0.5 }, last_name: { value: "", confidence: 1 }, party_id: { value: "p1", confidence: 1, note_fa: "«علی» (کد 12)" } });
    expect(rows.map((x) => x.label)).toEqual(["نام", "کد ملی", "شخص در سیراف"]);
    expect(rows[2].value).toBe("«علی» (کد 12)");
  });

  it("reads dates and amounts written in Persian", () => {
    expect(dayOf("۱۴۰۵/۰۸/۱۱", fromJalali)).toBe(fromJalali(1405, 8, 11));
    expect(dayOf("2026-11-02", fromJalali)).toBe("2026-11-02");
    expect(dayOf("1405-13-01", fromJalali)).toBeNull();
    expect(dayOf("فردا", fromJalali)).toBeNull();
    expect(amountOf("۱٬۲۵۰٬۰۰۰ ریال")).toBe("1250000");
    expect(amountOf("12,500.75")).toBe("12500.75");
    expect(amountOf("—")).toBeNull();
    expect(lineNumbers({ qty: { value: "4" }, total: { value: "1000" } })).toMatchObject({ qty: "4", price: "250", total: "1000" });
  });

  it("checks files before sending and shrinks large photos", () => {
    expect(fileProblem({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(fileProblem({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(fileProblem({ type: "image/gif", size: 1000 })).toMatch(/فقط/);
    expect(fileProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toMatch(/حداکثر/);
    expect(shrinkSize(1600, 1200)).toBeNull();
    expect(shrinkSize(4000, 3000)).toEqual({ w: 2000, h: 1500 });
    expect(shrinkSize(3000, 6000)).toEqual({ w: 1000, h: 2000 });
  });
});

describe("forecasts", () => {
  const week = (i: number, o: Partial<AiCashWeek>): AiCashWeek => ({
    week_start: `2026-11-${String(2 + i * 7).padStart(2, "0")}`, week_end: `2026-11-${String(8 + i * 7).padStart(2, "0")}`, label: `هفتهٔ ${i + 1}`, opening: "0",
    cheques_in: "0", cheques_out: "0", invoices_in: "0", invoices_out: "0", recurring_out: "0", inflow: "0", outflow: "0", net: "0",
    closing_p50: "0", closing_p10: "0", closing_p90: "0", shortfall: false, risk: false, items: [], ...o,
  });
  const series = (o: Partial<AiForecastSeries> = {}): AiForecastSeries => ({ key: "k", title_fa: "t", unit: "ریال", history: [], forecast: [], method: "m", backtest: null, refused_reason_fa: null, ...o });

  it("reads the cash forecast of GET /forecast/cashflow and summarises it", () => {
    const f = cashOf({
      series: series({ key: "cashflow", method: "چک‌ها و فاکتورها" }),
      refs: [],
      details: {
        opening: { cash: "400", bank: "600", total: "1000" }, weekly_recurring_costs: "0", shortfall_weeks: [], risk_weeks: [], assumptions_fa: ["فرض"],
        weeks: [
          week(0, { opening: "1000", inflow: "200", outflow: "500", closing_p50: "700", closing_p10: "650", closing_p90: "720" }),
          week(1, { opening: "700", inflow: "100", outflow: "900", closing_p50: "-100", closing_p10: "-400", closing_p90: "50", shortfall: true, items: [{ kind: "cheque_out", label: "چک ۱۲", amount: "-900", ref: { type: "cheque", id: "x", label: "چک", path: "treasury/cheques/x" } }] }),
        ],
      },
    });
    expect(f.opening).toBe("1000");
    expect(f.method).toBe("چک‌ها و فاکتورها");
    expect(f.weeks[1]).toMatchObject({ start: "2026-11-09", end: "2026-11-15", inflow: "100", outflow: "900", closing: "-100", p10: "-400", p90: "50", shortfall: true });
    expect(f.weeks[1].items?.[0].ref?.path).toBe("treasury/cheques/x");
    const s = cashSummary(f);
    expect(s).toMatchObject({ inflow: 300, outflow: 1400, short: [1], first: 1, low: { value: -100, week: 1 } });
    expect(cashOf(null).weeks).toEqual([]);
  });

  it("builds a fan that opens from the last actual value", () => {
    const s = seriesOf({ series: series({ key: "sales", history: [{ period: "1405-06", value: "10" }, { period: "1405-07", value: "12" }], forecast: [{ period: "1405-08", p10: "9", p50: "13", p90: "16" }], method: "ETS", backtest: { mase: "0.8", coverage80: "0.78", n: 12 } }), details: {}, refs: [] })!;
    const rows = fanRows(s);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ period: "1405-07", actual: 12, p50: 12, band: [12, 12] });
    expect(rows[2]).toEqual({ period: "1405-08", actual: null, p50: 13, band: [9, 16] });
    expect(s.backtest).toEqual({ mase: "0.8", coverage80: "0.78", n: 12 });
    expect(coverageRatio("78")).toBe(0.78);
    expect(coverageRatio("0.8")).toBe(0.8);
    expect(coverageRatio(null)).toBeNull();
    expect(fanRows({ history: [], forecast: [] })).toEqual([]);
    expect(seriesOf(null)).toBeNull();
  });

  it("reads stock advice, rate ranges and plans", () => {
    const item = { item_id: "i1", code: "1", name: "پیچ", unit: "عدد", stock: "3", suggested_qty: "40", days_cover: 2, last_sale: null, value: "300", reason_fa: "r" };
    expect(adviceOf({ items: [item] })).toEqual([item]);
    expect(adviceOf(null)).toEqual([]);
    const rate = { key: "fx:USD", title_fa: "دلار", unit: "ریال", last: "1000", at: null, stale: true, horizons: [{ days: 7, p10: "950", p50: "1000", p90: "1080" }], coverage80: "0.81", n: 200, observations: 200, thin: false, history: [] };
    expect(ratesOf({ rates: [rate] })).toEqual([rate]);
    expect(rangePos(5, 0, 10)).toBe(0.5);
    expect(rangePos(-1, 0, 10)).toBe(0);
    expect(rangePos(3, 3, 3)).toBe(0.5);
    const summary = { id: "a", title: "برنامه", horizon: "month" as const, focus: null, source: "template" as const, created_at: "2026-11-02T10:00:00Z" };
    expect(plansOf({ plans: [summary] })).toEqual([summary]);
    expect(plansOf(undefined)).toEqual([]);
  });
});
