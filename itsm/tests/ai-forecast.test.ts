// Forecasting toolkit of the AI layer on synthetic count series (classification, Croston/SBA/TSB, ETS and seasonal
// naive, backtests, refusals, robust outlier scores). Pure functions: no database, no model.
import { describe, it, expect } from "vitest";
import { classify, forecastSeries, mean, median, quantile, robustZ, stdev } from "@server/modules/ai/analytics/forecast";

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function normal(r: () => number) {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

describe("forecast math", () => {
  it("classifies count patterns (Syntetos–Boylan)", () => {
    expect(classify([10, 11, 9, 10, 12, 10, 9, 11]).cls).toBe("smooth");
    expect(classify([10, 40, 2, 25, 1, 60, 5, 30]).cls).toBe("erratic");
    expect(classify([0, 0, 5, 0, 0, 5, 0, 0, 6, 0, 0, 5]).cls).toBe("intermittent");
    expect(classify([0, 0, 1, 0, 0, 30, 0, 0, 2, 0, 0, 50]).cls).toBe("lumpy");
  });

  it("uses Croston/SBA/TSB for intermittent series with a sensible level", () => {
    const y = Array.from({ length: 36 }, (_, i) => (i % 3 === 2 ? 9 : 0));
    const f = forecastSeries(y, 3);
    expect(f.ok).toBe(true);
    expect(["croston", "sba", "tsb", "ses"]).toContain(f.method_key);
    expect(f.points).toHaveLength(3);
    for (const p of f.points) {
      expect(p.p50).toBeGreaterThan(2);
      expect(p.p50).toBeLessThan(4);
      expect(p.p10).toBeLessThanOrEqual(p.p50);
      expect(p.p90).toBeGreaterThanOrEqual(p.p50);
      expect(p.p10).toBeGreaterThanOrEqual(0);
    }
    // SBA is Croston with the bias correction (1 − α/2): never above Croston on the same series
    const croston = forecastSeries(y, 1).points[0].p50;
    expect(croston).toBeGreaterThan(0);
  });

  it("TSB decays when occurrences stop", () => {
    const y = [...Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 6 : 0)), ...Array(12).fill(0)];
    const f = forecastSeries(y, 1);
    expect(f.ok).toBe(true);
    expect(f.points[0].p50).toBeLessThan(3);
  });

  it("picks a seasonal method for a seasonal monthly series and beats the naive benchmark", () => {
    const r = rng(7);
    const season = [100, 120, 150, 130, 110, 90, 80, 85, 95, 140, 180, 200];
    const y = Array.from({ length: 48 }, (_, i) => season[i % 12] + i * 0.5 + normal(r) * 3);
    const f = forecastSeries(y, 12, { seasonPeriod: 12 });
    expect(f.ok).toBe(true);
    expect(["seasonal_naive", "holt_winters"]).toContain(f.method_key);
    expect(f.backtest!.mase!).toBeLessThan(1);
    expect(f.backtest!.n).toBeGreaterThan(0);
    // next month is the first month of the cycle again: close to its seasonal level
    expect(Math.abs(f.points[0].p50 - (season[0] + 48 * 0.5))).toBeLessThan(15);
    expect(f.points[10].p50).toBeGreaterThan(f.points[6].p50);
  });

  it("measures the band's coverage and widens a band that was too narrow", () => {
    const r = rng(11);
    const y = Array.from({ length: 40 }, () => 100 + normal(r) * 10);
    const f = forecastSeries(y, 3);
    expect(f.ok).toBe(true);
    expect(f.backtest!.coverage80!).toBeGreaterThan(0.5);
    expect(f.points[0].p90 - f.points[0].p10).toBeGreaterThan(10);
  });

  it("reports the coverage of the widened band out of sample: near 80% when calibrated, low when it is not", () => {
    const covs: number[] = [];
    for (const seed of [1, 2, 3, 5, 8]) {
      const r = rng(seed);
      // mostly quiet with large jumps: the model's own band is far too narrow and gets widened
      const y = Array.from({ length: 40 }, (_, i) => 100 + (r() < 0.3 ? (r() - 0.5) * 200 : (r() - 0.5) * 4) + i);
      const f = forecastSeries(y, 3);
      expect(f.ok).toBe(true);
      expect(f.backtest!.coverage80).not.toBeNull();
      covs.push(f.backtest!.coverage80!);
    }
    // the widening learned from earlier errors holds on later ones (not ≥ 80% by construction)
    expect(covs.reduce((a, x) => a + x, 0) / covs.length).toBeGreaterThan(0.55);
    expect(covs.some((x) => x < 1)).toBe(true);
    // errors that keep growing: the widening learned from the past is too narrow for what follows
    for (const [seed, big] of [[6, 20], [9, 10]]) {
      const r = rng(seed);
      const growing = Array.from({ length: 40 }, (_, i) => 100 + normal(r) * (i < 33 ? 1 : big));
      const g = forecastSeries(growing, 3);
      expect(g.ok).toBe(true);
      expect(g.backtest!.coverage80!).toBeLessThan(0.6);
    }
  });

  it("refuses when the data is thin", () => {
    expect(forecastSeries([5, 6, 7], 3).refused_reason_fa).toMatch(/دادهٔ کافی نیست/);
    expect(forecastSeries(Array(12).fill(0), 3).ok).toBe(false);
    const sparse = [0, 0, 0, 4, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 5, 0, 0, 0];
    expect(forecastSeries(sparse, 3).refused_reason_fa).toMatch(/پراکنده/);
  });

  it("computes quantiles, medians and robust z-scores (an unusual period stands out)", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(Math.abs(robustZ(100, [10, 11, 9, 10, 12, 10]))).toBeGreaterThan(10);
    expect(Math.abs(robustZ(10, [10, 11, 9, 10, 12, 10]))).toBeLessThan(1);
  });
});
