// The seeded on-call rotation of «کشیک پشتیبانی شبکه» starts at the last Saturday 08:00 (local) that has already passed.
// Run 43551428433 (Saturday 06:58 Tehran time) seeded it at that same day's 08:00, still ahead: nobody was on call, and
// tests/event-oncall.test.ts and tests/integration-event-continuity.test.ts failed until 08:00.
import { describe, expect, it } from "vitest";
import { lastSaturday } from "../src/server/modules/event/seed";

const TZ = "Asia/Tehran"; // UTC+03:30 all year
const at = (iso: string) => Date.parse(iso);

describe("the seeded weekly on-call rotation", () => {
  it("starts a week earlier on a Saturday before 08:00, so someone is on call now", () => {
    const now = at("2026-11-14T03:28:00Z"); // Saturday 06:58 in Tehran
    const start = lastSaturday(TZ, now);
    expect(start).toBe("2026-11-07T04:30:00.000Z"); // Saturday 7 Nov, 08:00 in Tehran
    expect(Date.parse(start)).toBeLessThanOrEqual(now);
  });

  it("starts that same morning from Saturday 08:00 on", () => {
    expect(lastSaturday(TZ, at("2026-11-14T04:30:00Z"))).toBe("2026-11-14T04:30:00.000Z");
    expect(lastSaturday(TZ, at("2026-11-14T05:00:00Z"))).toBe("2026-11-14T04:30:00.000Z");
  });

  it("starts at the past Saturday on any other day of the week", () => {
    expect(lastSaturday(TZ, at("2026-11-11T10:00:00Z"))).toBe("2026-11-07T04:30:00.000Z"); // Wednesday
    expect(lastSaturday(TZ, at("2026-11-13T20:00:00Z"))).toBe("2026-11-07T04:30:00.000Z"); // Friday 23:30 in Tehran
  });

  it("never starts in the future, at any hour of the week", () => {
    const base = at("2026-11-07T00:00:00Z");
    for (let h = 0; h < 24 * 7; h += 1) {
      const now = base + h * 3_600_000;
      expect(Date.parse(lastSaturday(TZ, now))).toBeLessThanOrEqual(now);
      expect(now - Date.parse(lastSaturday(TZ, now))).toBeLessThan(7 * 86_400_000);
    }
  });
});
