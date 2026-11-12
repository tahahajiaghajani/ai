// The pull runner on a real PostgreSQL (design A §7.1, §7.6, §17): several connections at once. Skipped unless
// ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/discovery-pg.test.ts
// · Lock latency and throughput: during a 5 000-item first load with the organisation's write lock switched on (the
//   strictest era: every IRE call holds it), a save every 200 ms waits at most 1.5 s at p95 and 3 s at most; the load's
//   rate is reported (it calibrates the defaults) and kept above a floor.
// · Two workers ticking one connector on their own connections: one pass, one copy of every item and CI.
// · Staging takes no organisation lock: a steady stamp of 25 000 items finishes while another transaction holds the
//   lock, within the steady pass's target (§7.6: 25 000 unchanged items in ≤ 3 min).
// DA1 part 2 adds the race (one CI per serial from two connectors) and the expression-index explain test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureWriteSerialisation, lockOrg } from "@server/context";
import { createIn, updateIn } from "@server/engine";
import { runPull } from "@server/modules/discovery/runner";
import { stagePage } from "@server/modules/discovery/stage";
import type { DiscoveredRecord } from "@shared/discovery/types";
import { realPgAvailable } from "./pg-real";
import { hold, raceDatabases } from "./race-helpers";
import { discoveryWorld, type DiscoveryWorld } from "./discovery-helpers";
import { mountMocks } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock } from "./mocks/discovery/rest";

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] ?? 0;

describe.skipIf(!realPgAvailable())("discovery on a real PostgreSQL (design A §7)", () => {
  raceDatabases("discovery");
  let w: DiscoveryWorld;
  const hosts: Record<string, (req: Request) => Response | Promise<Response>> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
  }, 300_000);
  afterAll(() => {
    unmount?.();
    configureWriteSerialisation(false);
  });

  let seq = 0;
  async function rest(n: number, from: number, options: Record<string, unknown> = {}) {
    const host = `pg${++seq}.mock.test`;
    const mock = new RestMock(makeDevices(n, { from }));
    hosts[host] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: `منبع پایگاه ${seq}`, base_url: `https://${host}/`, options: { ...REST_CONNECTOR.options, ...options } });
    return { mock, c };
  }

  it("a 5 000-item first load holds the organisation's lock ≈ 1 s per call: a concurrent save waits ≤ 1.5 s (p95), ≤ 3 s at most", async () => {
    configureWriteSerialisation(true);
    try {
      const { c } = await rest(5000, 2_000_000);
      const todo = await w.sys.write((tx) => createIn(tx, w.sys, "todo", { short_description: "کار آزمایشی" }, { trusted: true }));
      const waits: number[] = [];
      let loading = true;
      const saver = (async () => {
        for (let i = 0; loading; i++) {
          const t0 = performance.now();
          await w.sys.write((tx) => updateIn(tx, w.sys, "todo", todo.id, { short_description: `ذخیرهٔ ${i}` }, { trusted: true }));
          waits.push(performance.now() - t0);
          await new Promise((r) => setTimeout(r, 200));
        }
      })();
      const t0 = performance.now();
      let slices = 0;
      try {
        for (; slices < 10_000; slices++) {
          const r = await runPull(w.sys, c.id, { deadline: Date.now() + 20_000 }, { worker: "pg-load", trigger: "manual" });
          if (!r) break;
        }
      } finally {
        loading = false;
        await saver;
      }
      const seconds = (performance.now() - t0) / 1000;
      const run = await w.one(`select * from sm_discovery_runs where connector_id = $1`, [c.id]);
      expect(run).toMatchObject({ state: "completed", created: 5000, failed: 0 });
      const rate = 5000 / seconds;
      console.log(`discovery-pg: 5 000 items in ${seconds.toFixed(1)} s (${rate.toFixed(1)} items/s, ${slices + 1} slices); save waits p95 ${p95(waits).toFixed(0)} ms, max ${Math.max(...waits).toFixed(0)} ms over ${waits.length} saves; per-item EWMA ${JSON.stringify(run.cursor?.ewma)}`);
      expect(waits.length).toBeGreaterThan(10);
      expect(p95(waits)).toBeLessThanOrEqual(1500);
      expect(Math.max(...waits)).toBeLessThanOrEqual(3000);
      // a floor well under the design's estimate (15–30 items/s), for a shared, loaded test machine
      expect(rate).toBeGreaterThan(5);
    } finally {
      configureWriteSerialisation(false);
    }
  }, 1_800_000);

  it("two workers on their own connections tick one connector: one pass, one copy of every item and CI", async () => {
    const { c } = await rest(300, 2_100_000, { page_size: 50 });
    let busy = 0;
    const work = async (worker: string) => {
      for (let i = 0; i < 2000; i++) {
        const r = await runPull(w.sys, c.id, { deadline: Date.now() + 2500 }, { worker, trigger: "manual" });
        if (!r) return;
        if ((r as { again: number }).again === 15_000) {
          busy++;
          await new Promise((res) => setTimeout(res, 25));
        }
      }
    };
    await Promise.all([work("pg-a"), work("pg-b")]);
    const runs = await w.q(`select * from sm_discovery_runs where connector_id = $1 order by started_at`, [c.id]);
    // the worker that comes after the first pass ended may start a second one: each pass is whole, none shared
    expect(runs[0]).toMatchObject({ state: "completed", created: 300, staged: 300 });
    for (const r of runs.slice(1)) expect(r).toMatchObject({ state: "completed", created: 0, updated: 0 });
    expect(busy).toBeGreaterThan(0);
    expect(await w.one(`select count(*)::int as n, count(distinct external_id)::int as d from sm_discovery_items where connector_id = $1`, [c.id])).toEqual({ n: 300, d: 300 });
    expect((await w.one<{ n: number }>(`select count(*)::int as n from sm_cis where discovery_source_id = $1`, [c.source_id])).n).toBe(300);
  }, 600_000);

  it("staging takes no organisation lock: 25 000 unchanged items are stamped while another transaction holds it", async () => {
    configureWriteSerialisation(true);
    try {
      const c = await w.connector({ ...REST_CONNECTOR, name: "منبع مهر", base_url: "https://stamp.mock.test/" });
      const records: DiscoveredRecord[] = Array.from({ length: 25_000 }, (_, i) => ({ external_id: `st-${i}`, kind: "endpoint", name: `pc-${i}`, hostname: `pc-${i}`, serial_number: `ST${i}`, ips: [`10.50.${(i >> 8) & 255}.${(i & 255) || 1}`] }));
      const stamp = async (generation: number) => {
        let staged = 0;
        for (let i = 0; i < records.length; i += 500) {
          staged += (await w.sys.write((tx) => stagePage(tx, { orgId: w.e.org, connectorId: c.id, generation, configVersion: 1, kindVersion: 1, records: records.slice(i, i + 500), origin: "cloud" }), { internal: true })).staged;
        }
        return staged;
      };
      expect(await stamp(1)).toBe(25_000);
      // the organisation's lock held by another writer the whole time
      const holder = hold(w.e.db, (tx) => lockOrg(tx, w.e.org));
      await holder.ready;
      try {
        const t0 = performance.now();
        expect(await stamp(2)).toBe(25_000);
        const seconds = (performance.now() - t0) / 1000;
        console.log(`discovery-pg: steady stamp of 25 000 unchanged items in ${seconds.toFixed(1)} s`);
        expect(seconds).toBeLessThan(180);
      } finally {
        holder.release();
        await holder.done;
      }
      const left = await w.one<{ n: number; g: number }>(`select count(*)::int as n, min(seen_generation)::int as g from sm_discovery_items where connector_id = $1 and reconciled_at is null`, [c.id]);
      expect(left).toEqual({ n: 25_000, g: 2 });
    } finally {
      configureWriteSerialisation(false);
    }
  }, 900_000);
});
