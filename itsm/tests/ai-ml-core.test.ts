// The classical models of the AI layer on fixture data (docs/spec/AI.md §13): deterministic training and metrics of the
// text classifier and the risk model, clustering and duplicates over local embeddings, anomaly detection, and volume
// forecasts with the Iranian week and Jalali holidays on synthetic seasonal series. Pure: no database, no model.
import { describe, expect, it } from "vitest";
import { fieldToken, textTokens } from "@server/modules/ai/ml/core/features";
import { loadClassifier, predictText, trainTextClassifier, type TextExample } from "@server/modules/ai/ml/core/classify";
import { auc, binaryMetrics, classifierMetrics } from "@server/modules/ai/ml/core/metrics";
import { scoreRisk, trainRisk, type RiskExample } from "@server/modules/ai/ml/core/risk";
import { clusterVectors, nearest, similarPairs } from "@server/modules/ai/ml/core/cluster";
import { generalizedEsd, isBurst, normInv, rateShift, seasonalResiduals, seasonalZ, tInv } from "@server/modules/ai/ml/core/anomaly";
import { denseDaily, forecastDaily, forecastWeekly, staffingHints, weeklyOf } from "@server/modules/ai/ml/core/volume";
import { mulberry32, stratifiedSplit } from "@server/modules/ai/ml/core/rng";
import { localEmbed } from "@server/modules/ai/rag/local-embed";
import { addDays, weekday } from "@shared/jalali";

const PHRASES: Record<string, string[]> = {
  network: ["اینترنت قطع است", "وای‌فای وصل نمی‌شود", "شبکه خیلی کند است", "وی‌پی‌ان کار نمی‌کند", "سوییچ طبقه سوم خاموش شد", "اتصال شبکه قطع و وصل می‌شود"],
  email: ["ایمیل ارسال نمی‌شود", "صندوق نامه پر شده است", "اوت‌لوک باز نمی‌شود", "نامه‌ها به دستم نمی‌رسد", "پیوست ایمیل باز نمی‌شود", "رمز ایمیل را نمی‌پذیرد"],
  printer: ["چاپگر کاغذ گیر کرده", "پرینتر چاپ نمی‌کند", "تونر چاپگر تمام شده", "چاپ رنگی خراب است", "چاپگر شبکه پیدا نمی‌شود", "اسکنر چاپگر کار نمی‌کند"],
  hardware: ["لپ‌تاپ روشن نمی‌شود", "صفحه نمایش سیاه است", "کیبورد کار نمی‌کند", "باتری لپ‌تاپ شارژ نمی‌شود", "ماوس حرکت نمی‌کند", "رایانه صدای بوق می‌دهد"],
};
const NOISE = ["لطفا", "سریع", "بررسی", "کنید", "امروز", "از", "صبح", "همکار", "واحد", "مالی", "دوباره", "مشکل"];

function corpus(seed: number, perClass: number): TextExample[] {
  const r = mulberry32(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const out: TextExample[] = [];
  for (const [label, phrases] of Object.entries(PHRASES)) {
    for (let i = 0; i < perClass; i++) {
      const text = `${pick(phrases)} ${pick(NOISE)} ${pick(NOISE)}${r() < 0.4 ? ` ${pick(phrases)}` : ""}`;
      out.push({ tokens: [...textTokens(text), ...(r() < 0.5 ? [fieldToken("channel", pick(["portal", "email", "phone"]))!] : [])], label });
    }
  }
  return out;
}

describe("text features", () => {
  it("normalises Persian, drops stop words and identifier-like numbers, adds word pairs", () => {
    const t = textTokens("ايميل‌ها ارسال نمي‌شود و شماره 09121234567 را بگيريد");
    expect(t).toContain("ایمیل");
    expect(t.some((x) => /0912/.test(x))).toBe(false);
    expect(t).not.toContain("و");
    expect(t.some((x) => x.includes("_"))).toBe(true);
    expect(fieldToken("category", "network")).toBe("@category=network");
    expect(fieldToken("category", null)).toBeNull();
  });
});

describe("text classifier", () => {
  const data = corpus(7, 40);

  it("trains deterministically for a seed and beats the majority baseline", () => {
    const a = trainTextClassifier(data, { seed: 42 });
    const b = trainTextClassifier([...data].reverse(), { seed: 42 });
    if ("refused" in a || "refused" in b) throw new Error("refused");
    expect(a.params).toEqual(b.params);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.metrics.accuracy).toBeGreaterThan(0.85);
    expect(a.metrics.macro_f1).toBeGreaterThan(0.85);
    expect(a.baseline.accuracy).toBeLessThan(0.4);
    expect(a.beats).toBe(true);
    expect(a.metrics.per_class.map((c) => c.label)).toEqual(["email", "hardware", "network", "printer"]);
    expect(a.candidates.map((c) => c.algo).sort()).toEqual(["logreg", "nb"]);
    expect(a.test_n + a.train_n).toBe(data.length);
  });

  it("predicts with calibrated confidences and the words behind the answer", () => {
    const t = trainTextClassifier(data, { seed: 1 });
    if ("refused" in t) throw new Error(t.refused);
    const m = loadClassifier(t.params);
    const p = predictText(m, textTokens("پرینتر طبقه دوم کاغذ گیر کرده و چاپ نمی‌کند"));
    expect(p.top[0].label).toBe("printer");
    expect(p.top[0].confidence).toBeGreaterThan(0.5);
    expect(p.top.reduce((a, x) => a + x.confidence, 0)).toBeLessThanOrEqual(1.0001);
    expect(p.why.length).toBeGreaterThan(0);
    expect(p.why.some((w) => /چاپ|پرینتر|کاغذ/.test(w.feature))).toBe(true);
    expect(predictText(m, ["ناشناخته‌ای"]).top).toEqual([]);
  });

  it("refuses when fewer than two labels have enough examples and leaves rare labels out", () => {
    const few = [{ tokens: ["a"], label: "x" }, { tokens: ["b"], label: "y" }];
    const r = trainTextClassifier(few, { seed: 1 });
    expect("refused" in r && r.refused).toMatch(/دادهٔ کافی نیست/);
    const t = trainTextClassifier([...data, { tokens: ["نادر"], label: "rare" }], { seed: 1 });
    if ("refused" in t) throw new Error(t.refused);
    expect(t.dropped).toEqual(["rare"]);
    expect(t.params.labels).not.toContain("rare");
  });

  it("reports coverage and accuracy above confidence thresholds", () => {
    const m = classifierMetrics(["a", "a", "b", "b"], ["a", "b", "b", "b"], [0.9, 0.55, 0.95, 0.6], ["a", "b"], [0.5, 0.8]);
    expect(m.accuracy).toBe(0.75);
    expect(m.thresholds[0]).toEqual({ t: 0.5, coverage: 1, accuracy: 0.75 });
    expect(m.thresholds[1]).toEqual({ t: 0.8, coverage: 0.5, accuracy: 1 });
    expect(m.per_class.find((c) => c.label === "a")).toMatchObject({ precision: 1, recall: 0.5, support: 2 });
  });

  it("splits by label deterministically", () => {
    const xs = Array.from({ length: 20 }, (_, i) => ({ i, l: i % 2 ? "a" : "b" }));
    const s1 = stratifiedSplit(xs, (x) => x.l, 0.2, 9);
    const s2 = stratifiedSplit(xs, (x) => x.l, 0.2, 9);
    expect(s1).toEqual(s2);
    expect(s1.test.filter((x) => x.l === "a").length).toBe(2);
  });
});

describe("risk model", () => {
  function examples(seed: number, n: number): RiskExample[] {
    const r = mulberry32(seed);
    return Array.from({ length: n }, (_, k) => {
      const priority = String(1 + Math.floor(r() * 4));
      const backlog = Math.floor(r() * 40);
      const night = r() < 0.3;
      const z = -2.2 + (priority === "1" ? 1.6 : 0) + backlog * 0.06 + (night ? 0.9 : 0);
      const y = r() < 1 / (1 + Math.exp(-z)) ? 1 : 0;
      return { x: { priority, backlog, night }, y: y as 0 | 1, t: k };
    });
  }

  it("learns the drivers, beats the base rate and is deterministic", () => {
    const data = examples(3, 1500);
    const specs = [{ name: "priority", kind: "cat" as const }, { name: "backlog", kind: "num" as const }, { name: "night", kind: "bool" as const }];
    const a = trainRisk(data, specs, { seed: 5 });
    const b = trainRisk(data, specs, { seed: 5 });
    if ("refused" in a || "refused" in b) throw new Error("refused");
    expect(a).toEqual(b);
    expect(a.beats).toBe(true);
    expect(a.metrics.auc!).toBeGreaterThan(0.7);
    expect(a.metrics.skill).toBeGreaterThan(0);
    const hi = scoreRisk(a.params, { priority: "1", backlog: 38, night: true });
    const lo = scoreRisk(a.params, { priority: "4", backlog: 1, night: false });
    expect(hi.p).toBeGreaterThan(lo.p + 0.3);
    expect(hi.why[0].weight).toBeGreaterThan(0);
    expect(hi.why.map((w) => w.feature)).toContain("backlog");
  });

  it("refuses with too few outcomes of a kind", () => {
    const data: RiskExample[] = Array.from({ length: 50 }, (_, k) => ({ x: { a: k }, y: k < 3 ? 1 : 0 }));
    const r = trainRisk(data, [{ name: "a", kind: "num" }], { seed: 1 });
    expect("refused" in r && r.refused).toMatch(/دادهٔ کافی نیست/);
  });

  it("measures AUC, Brier and calibration", () => {
    expect(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1])).toBe(0.75);
    const m = binaryMetrics([0.9, 0.1, 0.8, 0.2], [1, 0, 1, 0]);
    expect(m.brier).toBeCloseTo(0.025, 6);
    expect(m.skill).toBeGreaterThan(0.8);
    expect(m.calibration).toHaveLength(10);
  });
});

describe("clustering and duplicates", () => {
  const texts = [
    ...["وی‌پی‌ان شرکت وصل نمی‌شود", "اتصال وی‌پی‌ان شرکت قطع شد", "وی‌پی‌ان شرکت از خانه وصل نمی‌شود", "خطای اتصال وی‌پی‌ان شرکت"],
    ...["چاپگر طبقه دوم کاغذ گیر کرده", "کاغذ در چاپگر طبقه دوم گیر کرده", "چاپگر طبقه دوم گیر کاغذ دارد"],
    "درخواست صندلی تازه برای اتاق جلسه",
    ...["حقوق ماه گذشته واریز نشده", "واریز حقوق ماه گذشته انجام نشد", "حقوق این ماه واریز نشده است"],
  ];
  const vs = texts.map((t) => localEmbed(t));

  it("groups similar texts, leaves the odd one out, and is deterministic", () => {
    const a = clusterVectors(vs, { join: 0.3, minSize: 3, cohesion: 0.4 });
    const b = clusterVectors(vs, { join: 0.3, minSize: 3, cohesion: 0.4 });
    expect(a).toEqual(b);
    expect(a.clusters.length).toBe(3);
    const groupOf = (i: number) => (i < 4 ? "vpn" : i < 7 ? "printer" : i === 7 ? "odd" : "pay");
    for (const c of a.clusters) expect(new Set(c.members.map(groupOf)).size).toBe(1);
    expect(a.noise).toContain(7);
  });

  it("finds duplicates above a threshold", () => {
    const pairs = similarPairs(vs, 0.6);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) expect((p.a < 4 && p.b < 4) || (p.a >= 4 && p.a < 7 && p.b < 7) || (p.a >= 8 && p.b >= 8)).toBe(true);
    const n = nearest(localEmbed("وی‌پی‌ان شرکت وصل نمی‌شود!"), vs, 0.8);
    expect(n[0].index).toBe(0);
  });
});

describe("anomalies", () => {
  it("quantiles of the normal and t distributions", () => {
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(tInv(0.975, 30)).toBeCloseTo(2.042, 2);
    expect(tInv(0.975, 10)).toBeCloseTo(2.228, 2);
  });

  it("flags a spike against the same weekday of earlier weeks", () => {
    const r = mulberry32(11);
    const y = Array.from({ length: 70 }, (_, t) => (t % 7 === 6 ? 3 : 40) + Math.round((r() - 0.5) * 6));
    const normal = seasonalZ(y, { period: 7 })[0];
    expect(Math.abs(normal.z)).toBeLessThan(3);
    y[69] = 100;
    const spike = seasonalZ(y, { period: 7 })[0];
    expect(spike.z).toBeGreaterThan(5);
    // a Friday's 40 is unusual, a weekday's 40 is not
    y[69] = 3;
    const fridayIdx = 69 - ((69 % 7) - 6 + 7) % 7;
    const fy = [...y.slice(0, fridayIdx), 40];
    expect(seasonalZ(fy, { period: 7 })[0].z).toBeGreaterThan(5);
  });

  it("finds the inserted outliers with the generalised ESD test", () => {
    const r = mulberry32(5);
    const y = Array.from({ length: 84 }, (_, t) => (t % 7 >= 5 ? 10 : 50) + Math.round((r() - 0.5) * 8));
    y[20] += 60;
    y[55] += 45;
    const out = generalizedEsd(seasonalResiduals(y, 7), 6);
    expect(out.sort((a, b) => a - b)).toEqual([20, 55]);
    expect(generalizedEsd([1, 2, 3], 2)).toEqual([]);
  });

  it("detects alert storms and moved rates", () => {
    const before = Array.from({ length: 48 }, (_, i) => 3 + (i % 4));
    expect(isBurst(60, before).burst).toBe(true);
    expect(isBurst(9, before).burst).toBe(false);
    expect(rateShift(30, 100, 40, 1000).flagged).toBe(true);
    expect(rateShift(5, 100, 40, 1000).flagged).toBe(false);
  });
});

describe("volume forecasts", () => {
  // 18 weeks of daily tickets: Saturday–Wednesday busy, Thursday half, Friday off; some official holidays
  const start = "2026-03-21"; // 1 Farvardin 1405
  const r = mulberry32(21);
  const level = [60, 58, 55, 54, 50, 25, 4];
  const holidays = new Set(["2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24", "2026-04-01", "2026-04-02", "2026-06-04", "2026-06-05"]);
  const days = Array.from({ length: 126 }, (_, i) => addDays(start, i));
  const series = days.map((d) => ({ date: d, count: Math.max(0, Math.round((holidays.has(d) ? 0.15 : 1) * level[weekday(d)] + (r() - 0.5) * 8)) }));

  it("forecasts the Iranian week with bands and measures the holiday effect", () => {
    const f = forecastDaily(series, 14, holidays);
    expect(f.ok).toBe(true);
    expect(f.points).toHaveLength(14);
    for (const p of f.points) expect(p.p10 <= p.p50 && p.p50 <= p.p90).toBe(true);
    const fri = f.points.find((p) => weekday(p.date) === 6)!;
    const sat = f.points.find((p) => weekday(p.date) === 0)!;
    expect(sat.p50).toBeGreaterThan(fri.p50 * 4);
    expect(f.holiday_factor).toBeLessThan(0.4);
    expect(f.weekday_profile[0]).toBeGreaterThan(f.weekday_profile[6]);
    expect(f.backtest?.mase ?? 9).toBeLessThan(1);
    expect(f.history.filter((h) => h.holiday)).toHaveLength(holidays.size);
  });

  it("scales a future holiday by the holiday effect", () => {
    const last = series[series.length - 1].date;
    const futureHoliday = addDays(last, 3);
    const plain = forecastDaily(series, 7, holidays).points.find((p) => p.date === futureHoliday)!;
    const hol = forecastDaily(series, 7, new Set([...holidays, futureHoliday])).points.find((p) => p.date === futureHoliday)!;
    expect(hol.holiday).toBe(true);
    expect(hol.p50).toBeLessThan(plain.p50 * 0.5);
  });

  it("refuses short histories, rolls days into Jalali weeks and gives staffing hints", () => {
    expect(forecastDaily(series.slice(0, 10), 7).ok).toBe(false);
    const dense = denseDaily([{ date: "2026-04-01", count: 2 }, { date: "2026-04-04", count: 1 }]);
    expect(dense.map((d) => d.count)).toEqual([2, 0, 0, 1]);
    const weeks = weeklyOf(series);
    expect(weeks.every((w) => weekday(w.date) === 0)).toBe(true);
    expect(forecastWeekly(weeks, 4).points.length).toBe(4);
    const hints = staffingHints([{ date: "x", p10: 10, p50: 24, p90: 36, holiday: false }], { handle_minutes: 30, productive_hours: 6 });
    expect(hints[0]).toEqual({ date: "x", people_p50: 2, people_p90: 3 });
  });
});
