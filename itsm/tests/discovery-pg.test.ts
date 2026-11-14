// The pull runner on a real PostgreSQL (design A §7.1, §7.6, §17): several connections at once. Skipped unless
// ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/discovery-pg.test.ts
// · Lock latency and throughput: during a 5 000-item first load with the organisation's write lock switched on (the
//   strictest era: every IRE call holds it), a save every 200 ms waits at most 1.5 s at p95 and 3 s at most; the load's
//   rate is reported (it calibrates the defaults) and kept above a floor.
// · Two workers ticking one connector on their own connections: one pass, one copy of every item and CI.
// · Staging takes no organisation lock: a steady stamp of 25 000 items finishes while another transaction holds the
//   lock, within the steady pass's target (§7.6: 25 000 unchanged items in ≤ 3 min).
// · The race (§8.5, the D4 requirement): two connectors' first loads at once, reporting the same new serials, make one
//   CI per serial — with writes lock-free (the identity locks of createOrUpdate) and with the organisation's lock.
// · The identification indexes (§8.5, migration 0104): the reconciliation engine's own identification queries use them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureWriteSerialisation, lockOrg } from "@server/context";
import type { Queryable } from "@server/db";
import { createIn, updateIn } from "@server/engine";
import { identifyItem } from "@server/modules/cmdb/ire";
import { classTree } from "@server/modules/cmdb/common";
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

  for (const serialised of [false, true]) {
    it(`two connectors' first loads at once with the same serials make one CI per serial (${serialised ? "the organisation's lock" : "writes lock-free"})`, async () => {
      configureWriteSerialisation(serialised);
      try {
        const from = serialised ? 2_300_000 : 2_200_000;
        const a = await rest(240, from, { page_size: 40 });
        const b = await rest(240, from, { page_size: 40 });
        const load = async (c: Record<string, any>, worker: string) => {
          for (let i = 0; i < 2000; i++) {
            const r = await runPull(w.sys, String(c.id), { deadline: Date.now() + 2500 }, { worker, trigger: "manual" });
            if (!r) return;
            if ((r as { again: number }).again) await new Promise((res) => setTimeout(res, 10));
          }
        };
        await Promise.all([load(a.c, `race-a-${from}`), load(b.c, `race-b-${from}`)]);
        for (const c of [a.c, b.c]) expect(await w.one(`select state, failed from sm_discovery_runs where connector_id = $1 and lane = 'inventory'`, [c.id])).toEqual({ state: "completed", failed: 0 });
        const serials = await w.one<{ n: number; d: number }>(
          `select count(*)::int as n, count(distinct serial_number)::int as d from sm_cis where org_id = $1 and deleted_at is null and serial_number = any($2::text[])`,
          [w.e.org, `{${makeDevices(240, { from }).map((d) => d.serial).join(",")}}`],
        );
        expect(serials).toEqual({ n: 240, d: 240 });
        // both connectors' items link to the same CIs
        const linked = await w.one<{ n: number; d: number }>(`select count(*)::int as n, count(distinct ci_id)::int as d from sm_discovery_items where connector_id = any($1::uuid[]) and state = 'linked'`, [`{${a.c.id},${b.c.id}}`]);
        expect(linked).toEqual({ n: 480, d: 240 });
      } finally {
        configureWriteSerialisation(false);
      }
    }, 900_000);
  }

  it("the reconciliation engine's identification queries use the expression indexes (migration 0104)", async () => {
    await w.q(
      `insert into sm_cis (id, org_id, name, class, state, serial_number, asset_tag, bios_uuid, hostname, fqdn, mac_address)
       select gen_random_uuid(), $1, 'IDX-' || g, 'server', 'operational', 'IDXSN' || g, 'IDXTAG' || g, 'IDX-UUID-' || g, 'idx-host-' || g, 'idx-host-' || g || '.bank.local',
              '00:60:' || lpad(to_hex(g / 65536 % 256), 2, '0') || ':' || lpad(to_hex(g / 256 % 256), 2, '0') || ':' || lpad(to_hex(g % 256), 2, '0') || ':AA'
       from generate_series(1, 4000) g`,
      [w.e.org],
    );
    await w.q(`analyze sm_cis`);
    const seen: { sql: string; params: unknown[] }[] = [];
    const db = w.e.db;
    const recording: Queryable = {
      query: (sql, params) => (seen.push({ sql, params: params ?? [] }), db.query(sql, params)),
      one: (sql, params) => (seen.push({ sql, params: params ?? [] }), db.one(sql, params)),
      exec: (sql) => db.exec(sql),
    };
    const tree = await classTree(db, w.sys);
    const indexes = (plan: unknown): string[] => {
      const out: string[] = [];
      const walk = (n: unknown) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          for (const [k, v] of Object.entries(n)) {
            if (k === "Index Name" && typeof v === "string") out.push(v);
            else walk(v);
          }
        }
      };
      walk(plan);
      return out;
    };
    const cases: [string, Record<string, unknown>, string, string][] = [
      ["server", { serial_number: "idxsn 1234" }, "sm_cis_ident_serial_idx", "idx-host-1234"],
      ["server", { bios_uuid: "idx-uuid-77" }, "sm_cis_ident_bios_idx", "idx-host-77"],
      ["server", { fqdn: "IDX-HOST-12.bank.local" }, "sm_cis_ident_fqdn_idx", "idx-host-12"],
      ["server", { hostname: "IDX-HOST-99" }, "sm_cis_ident_host_idx", "idx-host-99"],
      ["server", { mac_address: "00-60-00-00-2A-AA" }, "sm_cis_ident_mac_idx", "idx-host-42"],
      ["hardware", { asset_tag: "idxtag5" }, "sm_cis_ident_tag_idx", "idx-host-5"],
      ["ci", { name: "idx-3999" }, "sm_cis_ident_name_idx", "idx-host-3999"],
    ];
    for (const [cls, values, index, host] of cases) {
      seen.length = 0;
      const idf = await identifyItem(recording, w.sys, tree, { class: cls, values, attrs: {}, relations: [] });
      expect(idf.match?.hostname, index).toBe(host);
      const q = seen.filter((x) => /from sm_cis t where/.test(x.sql)).pop()!;
      const [{ "QUERY PLAN": plan }] = await db.query<{ "QUERY PLAN": unknown }>(`explain (format json) ${q.sql}`, q.params);
      expect(indexes(plan), index).toContain(index);
    }
  }, 600_000);
});

