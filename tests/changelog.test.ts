import { describe, expect, it } from "vitest";
import { LATEST_RELEASE, RELEASES } from "@/lib/changelog";

describe("«تازه‌ها» (help center updates)", () => {
  it("lists releases newest first with unique ids", () => {
    const dates = RELEASES.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(RELEASES.map((r) => r.id)).size).toBe(RELEASES.length);
    expect(LATEST_RELEASE).toBe(RELEASES[0].id);
  });

  it("keeps every entry short: a title and a few one-line items", () => {
    for (const r of RELEASES) {
      expect(r.title.length).toBeLessThanOrEqual(40);
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items.length).toBeLessThanOrEqual(5);
      for (const it of r.items) expect(it.length).toBeLessThanOrEqual(60);
    }
  });
});
