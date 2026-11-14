// Problems a tool reports (design A §9.6, §17 «discovery-problems»): the diff against the tool's complete open set
// (new fires, gone clears, a changed severity fires again), sending through the connector's own event source in chunks
// of ≤ 100 at ≤ half the source's rate per minute — 2 000 open problems go out over passes without a 429 — and clears
// for vanished problems (none for a problem that never fired).
import { beforeAll, describe, expect, it } from "vitest";
import { clearVanished, dedupeKeyOf, PROBLEM_CHUNK, recordProblems, resetProblemPacing, sendProblems } from "@server/modules/discovery/problems";
import { loadConnector } from "@server/modules/discovery/runner";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";

describe("problems from a tool (design A §9.6)", () => {
  let w: DiscoveryWorld;
  let conn: Row;
  const problems = () => w.q<Row>(`select problem_key, severity, cleared_at is not null as cleared, sent_firing, sent_clear, sent_seq from sm_discovery_problems where connector_id = $1 order by problem_key`, [conn.id]);
  const fresh = async () => (await loadConnector(w.e.db, w.e.org, conn.id))!;
  const events = (sourceId: string) => w.q<Row>(`select dedupe_key, status, fingerprint, received_at from sm_events where source_id = $1 order by received_at, dedupe_key`, [sourceId]);

  beforeAll(async () => {
    w = await discoveryWorld();
    resetProblemPacing();
    conn = await w.connector({ name: "Zabbix شعب", kind: "push" });
  }, 240_000);

  it("diffs the complete open set: new fires, a changed severity fires again, a vanished problem clears", async () => {
    const t1 = new Date(Date.now() - 120_000);
    expect(await recordProblems(w.e.db, w.e.org, conn.id, [{ key: "a", severity: "major" }, { key: "b", severity: "minor" }], t1, "cloud")).toEqual({ opened: 2 });
    await w.q(`update sm_discovery_problems set sent_firing = true where connector_id = $1`, [conn.id]);
    const t2 = new Date(Date.now() - 60_000);
    expect(await recordProblems(w.e.db, w.e.org, conn.id, [{ key: "a", severity: "critical" }, { key: "c", severity: "high" }], t2, "cloud")).toEqual({ opened: 1 });
    expect(await clearVanished(w.e.db, w.e.org, conn.id, t2)).toBe(1);
    expect(await problems()).toEqual([
      { problem_key: "a", severity: "critical", cleared: false, sent_firing: false, sent_clear: false, sent_seq: 1 },
      { problem_key: "b", severity: "minor", cleared: true, sent_firing: true, sent_clear: false, sent_seq: 0 },
      { problem_key: "c", severity: "major", cleared: false, sent_firing: false, sent_clear: false, sent_seq: 0 },
    ]);
    // b comes back: a new firing (its sequence moves on, so event management takes it again)
    await recordProblems(w.e.db, w.e.org, conn.id, [{ key: "a", severity: "critical" }, { key: "b", severity: "minor" }, { key: "c", severity: "high" }], new Date(), "cloud");
    expect((await problems()).find((p) => p.problem_key === "b")).toMatchObject({ cleared: false, sent_firing: false, sent_seq: 1 });
    await w.q(`delete from sm_discovery_problems where connector_id = $1`, [conn.id]);
  });

  it("sends 2 000 open problems over passes in chunks of ≤ 100 at ≤ half the rate, without a 429; then the clears", { timeout: 180_000 }, async () => {
    const open = Array.from({ length: 2000 }, (_, i) => ({ key: `p${String(i).padStart(4, "0")}`, severity: i % 2 ? "major" : "minor", message: `مشکل ${i}` }));
    await recordProblems(w.e.db, w.e.org, conn.id, open, new Date(), "cloud");
    let clock = Date.now();
    let passes = 0;
    let total = 0;
    for (; passes < 20; passes++) {
      // a pass a minute (the status job comes back when its window allows)
      const r = await sendProblems(w.sys, await fresh(), { now: () => clock });
      expect(r.sent).toBeLessThanOrEqual(300);
      total += r.sent;
      if (!r.left) break;
      expect(r.again).toBeGreaterThan(0);
      clock += 60_000;
    }
    expect(total).toBe(2000);
    expect(passes).toBe(6);
    const source = (await fresh()).event_source_id as string;
    expect(source).toBeTruthy();
    expect(await w.one<Row>(`select kind, rate_limit, token_hash from sm_event_sources where id = $1`, [source])).toEqual({ kind: "generic", rate_limit: 600, token_hash: null });
    const sent = await events(source);
    expect(sent.length).toBe(2000);
    expect(new Set(sent.map((e) => e.dedupe_key)).size).toBe(2000);
    expect(sent.map((e) => e.dedupe_key)).toContain(dedupeKeyOf(conn.id, "p0000", "firing", 0));
    // one ingest call per chunk: no delivery carried more than 100
    const perCall = new Map<string, number>();
    for (const e of sent) perCall.set(String(e.received_at), (perCall.get(String(e.received_at)) ?? 0) + 1);
    expect(Math.max(...perCall.values())).toBeLessThanOrEqual(PROBLEM_CHUNK);
    expect((await problems()).every((p) => p.sent_firing)).toBe(true);
    // two vanish, one never sent appears and vanishes: two clears go out, nothing for the third
    await recordProblems(w.e.db, w.e.org, conn.id, [{ key: "late", severity: "minor" }], new Date(Date.now() - 1000), "cloud");
    await w.q(`update sm_discovery_problems set last_seen_at = now() - interval '1 hour' where connector_id = $1 and problem_key in ('p0000', 'p0001', 'late')`, [conn.id]);
    expect(await clearVanished(w.e.db, w.e.org, conn.id, new Date(Date.now() - 60_000))).toBe(3);
    const r = await sendProblems(w.sys, await fresh(), { now: () => clock + 60_000 });
    expect(r).toMatchObject({ sent: 2, left: 0 });
    const clears = (await events(source)).filter((e) => e.status === "resolved").map((e) => e.dedupe_key).sort();
    expect(clears).toEqual([dedupeKeyOf(conn.id, "p0000", "resolved", 0), dedupeKeyOf(conn.id, "p0001", "resolved", 0)]);
    // fingerprints follow the tool's problem, so event management dedups each problem into one alert
    expect(new Set((await events(source)).map((e) => e.fingerprint)).size).toBe(2000);
  });
});
