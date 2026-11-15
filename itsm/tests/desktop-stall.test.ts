// The Windows app's local server reports a held thread (src/desktop/stall.ts, docs/PERFORMANCE_FA.md §17): a timer that
// fires late by a second or more names the hold in app.log; a timer on time says nothing.
import { describe, it, expect, vi, afterEach } from "vitest";
import { startStallWatch } from "@local/stall";
import { stallPath } from "@local/server";

afterEach(() => vi.useRealTimers());

describe("the local server's stall watch", () => {
  it("reports how long the thread was held, and nothing while the timer is on time or after it stops", () => {
    vi.useFakeTimers();
    let t = 0;
    const held: number[] = [];
    const stop = startStallWatch({ everyMs: 100, thresholdMs: 1000, now: () => t, onStall: (ms) => held.push(ms) });
    for (let i = 0; i < 20; i++) {
      t += 100;
      vi.advanceTimersByTime(100);
    }
    // late, but under the threshold: an ordinary busy moment
    t += 900;
    vi.advanceTimersByTime(100);
    expect(held).toEqual([]);
    // the thread held 2.6 s: the next tick comes 2.7 s after the one before
    t += 2700;
    vi.advanceTimersByTime(100);
    expect(held).toEqual([2600]);
    stop();
    t += 5000;
    vi.advanceTimersByTime(1000);
    expect(held).toEqual([2600]);
  });

  it("tells a sleep of the computer apart: a gap of a minute or more is no hold", () => {
    vi.useFakeTimers();
    let t = 0;
    const held: number[] = [];
    const gaps: number[] = [];
    const stop = startStallWatch({ everyMs: 100, thresholdMs: 1000, now: () => t, onStall: (ms) => held.push(ms), onGap: (ms) => gaps.push(ms) });
    // Windows' clock counts on while the lid is closed: the first tick after the wake-up comes 14 hours late
    t += 14 * 3_600_000;
    vi.advanceTimersByTime(100);
    expect(held).toEqual([]);
    expect(gaps).toEqual([14 * 3_600_000 - 100]);
    // a hold just under the ceiling is still a hold
    t += 59_000;
    vi.advanceTimersByTime(100);
    expect(held).toEqual([58_900]);
    stop();
  });

  it("names the requests that waited without the keys or one-time tokens of their paths", () => {
    expect(stallPath("/api/o/0b8d2c1e-1111-4a2b-9c3d-123456789abc/r/incident/0b8d2c1e-1111-4a2b-9c3d-123456789abd")).toBe("/api/o/:id/r/incident/:id");
    expect(stallPath("/api/public/survey/AbCdEf0123456789xyz")).toBe("/api/public/survey/:x");
    expect(stallPath("/api/hooks/inbound/tok_9f8e7d6c5b4a3210")).toBe("/api/hooks/inbound/:x");
    // names of the API stay readable
    expect(stallPath("/api/o/acme/cmdb/health_summary_by_class")).toBe("/api/o/acme/cmdb/health_summary_by_class");
  });

  it("catches a real hold of the thread", async () => {
    const held: number[] = [];
    const stop = startStallWatch({ everyMs: 20, thresholdMs: 300, onStall: (ms) => held.push(ms) });
    try {
      await new Promise((r) => setTimeout(r, 60));
      // what PGlite does on a held file: synchronous work, nothing else runs
      const until = performance.now() + 900;
      while (performance.now() < until) {
        /* the thread is held */
      }
      await new Promise((r) => setTimeout(r, 100));
      expect(held.length).toBeGreaterThanOrEqual(1);
      expect(Math.max(...held)).toBeGreaterThanOrEqual(600);
    } finally {
      stop();
    }
  });
});
