// Pure logic of the predictive AI's screens (docs/spec/AI.md §13–16): Persian percentages and confidence words, the
// order of suggestions and reasons, forecast chart rows, insight numbers and order, and the shell's entries.
import { describe, expect, it } from "vitest";
import type { ForecastView, MlPrediction } from "@shared/ai/ml";
import { confidenceBand, riskBand } from "@shared/ai/ml";
import type { InsightView } from "@shared/ai/insights";
import { backtestText, forecastRows, pctFa, reasonsOf, scoreWords, visiblePredictions } from "@ui/ai/ml/model";
import { numberText, orderInsights } from "@ui/ai/insights/model";

const pred = (p: Partial<MlPrediction>): MlPrediction => ({
  id: null,
  model: "m",
  kind: "classifier",
  name: "n",
  field: "category",
  field_label: "دسته",
  value: "network",
  value_label: "شبکه",
  current: null,
  current_label: null,
  score: 0.9,
  alternatives: [],
  why: [],
  status: "open",
  model_version: 1,
  trained_at: null,
  quality: null,
  confident: true,
  alert: null,
  can_apply: true,
  ...p,
});

describe("scores in words", () => {
  it("formats percentages and bands", () => {
    expect(pctFa(0.874)).toBe("۸۷٪");
    expect(pctFa(0.0456)).toBe("۴.۶٪");
    expect(pctFa(null)).toBe("—");
    expect(confidenceBand(0.85).key).toBe("high");
    expect(confidenceBand(0.65).label).toBe("اطمینان متوسط");
    expect(riskBand(0.7, 0.6).key).toBe("high");
    expect(riskBand(0.35, 0.6).key).toBe("medium");
    expect(scoreWords(pred({ kind: "risk", score: 0.2, alert: 0.6 })).label).toBe("خطر کم");
  });

  it("orders reasons by strength with their direction", () => {
    const r = reasonsOf(pred({ why: [{ label: "شبکه", weight: 0.2 }, { label: "قطع", weight: 0.9 }, { label: "ایمیل", weight: -0.5 }] }));
    expect(r.map((x) => x.label)).toEqual(["قطع", "ایمیل", "شبکه"]);
    expect(r[1].direction).toBe("به زیان این پیشنهاد");
    expect(reasonsOf(pred({ kind: "risk", why: [{ label: "اولویت", weight: 1 }] }))[0].direction).toBe("افزایش خطر");
  });

  it("shows confident suggestions that differ from the value, risks first", () => {
    const list = visiblePredictions([
      pred({ model: "a", score: 0.7 }),
      pred({ model: "b", value: "x", current: "x" }),
      pred({ model: "c", confident: false }),
      pred({ model: "d", kind: "risk", score: 0.3 }),
    ]);
    expect(list.map((p) => p.model)).toEqual(["d", "a"]);
    expect(visiblePredictions([pred({ model: "c", confident: false })], true)).toHaveLength(1);
  });
});

describe("forecast rows", () => {
  const f: Pick<ForecastView, "history" | "points" | "anomalies" | "grain" | "backtest" | "method_fa"> = {
    grain: "day",
    history: Array.from({ length: 50 }, (_, i) => ({ date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, count: i, holiday: i === 49 })),
    points: [{ date: "2026-11-20", p10: 1, p50: 2, p90: 3, holiday: false }],
    anomalies: [49, 3],
    backtest: { mae: 1, mase: 0.7, coverage80: 0.82, n: 20 },
    method_fa: "هولت-وینترز",
  };

  it("keeps the last six weeks, joins the lines and marks anomalies", () => {
    const rows = forecastRows(f);
    expect(rows).toHaveLength(43);
    expect(rows[41].anomaly).toBe(true);
    expect(rows[41].p50).toBe(rows[41].actual);
    expect(rows[42].band).toEqual([1, 3]);
    expect(rows.filter((r) => r.anomaly)).toHaveLength(1);
    expect(backtestText(f)).toMatch(/بهتر از/);
  });
});

describe("insights", () => {
  it("formats numbers and puts anomalies and severe cards first", () => {
    expect(numberText("change_pct", 12.34)).toBe("+۱۲.۳٪");
    expect(numberText("change_pct", -5)).toBe("−۵٪");
    expect(numberText("compliance_pct", 90)).toMatch(/٪$/);
    expect(numberText("current", null)).toBe("—");
    const card = (id: string, o: Partial<InsightView>): InsightView => ({
      id,
      period: "daily",
      period_key: "k",
      period_label: "",
      kind: "volume",
      kind_label: "",
      table: "incident",
      table_label: "",
      severity: "info",
      anomaly: false,
      score: 1,
      title: id,
      numbers: {},
      drivers: [],
      driver_field: null,
      narrative: null,
      narrative_ai: false,
      created_at: "2026-11-09",
      ...o,
    });
    const order = orderInsights([card("a", { score: 50 }), card("b", { anomaly: true }), card("c", { severity: "warning" })]).map((x) => x.id);
    expect(order).toEqual(["b", "c", "a"]);
  });
});

describe("the shell", () => {
  it("lists the AI pages and the palette's analytic question", async () => {
    const { aiUi } = await import("@ui/modules/ai/index");
    const paths = aiUi.routes.map((r) => r.path);
    for (const p of ["ai/insights", "ai/ask-report", "ai/forecast", "ai/clusters"]) expect(paths).toContain(p);
    const s = aiUi.searches!.find((x) => x.key === "ai:ask-report")!;
    const hits = await s.run({} as never, "رخدادهای باز به تفکیک گروه");
    expect(hits[0].path).toMatch(/^ai\/ask-report\?q=/);
  });
});
