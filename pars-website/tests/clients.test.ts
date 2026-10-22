import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KEY_CLIENTS, engagements } from "@/content/clients";
import { CONSULTING, SOFTWARE, TRAINING } from "@/content/records";

const recordNames = new Set([...SOFTWARE.map((r) => r.org.fa), ...[...CONSULTING, ...TRAINING].flatMap((g) => g.items.map((r) => r.org.fa))]);

describe("key clients", () => {
  it("match organizations that exist in the track record", () => {
    for (const c of KEY_CLIENTS) for (const m of c.match) expect(recordNames.has(m), `${c.key}: ${m}`).toBe(true);
  });
  it("each show at least one engagement from the profile", () => {
    for (const c of KEY_CLIENTS) {
      const e = engagements(c);
      expect(e.software.length + e.consulting.length + e.training.length, c.key).toBeGreaterThan(0);
    }
  });
  it("sums the courses per standard", () => {
    const mellat = engagements(KEY_CLIENTS.find((c) => c.key === "mellat")!);
    expect(mellat.training.map((x) => [x.label.en, x.count])).toEqual([["PMBOK", 6], ["MSP", 6]]);
    expect(mellat.consulting).toHaveLength(2);
  });
  it("ship a logo file for every client", () => {
    for (const c of KEY_CLIENTS) expect(existsSync(path.join(process.cwd(), "public", c.logo)), c.logo).toBe(true);
  });
});
