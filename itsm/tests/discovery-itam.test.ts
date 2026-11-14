// ITAM feeds (design A §11.1, package DA7; software staging and the SAM feed are release 1.2's): «ساخت دارایی برای
// دستگاه‌های تازه» — switched on only by an asset manager and only after ITAM's own confirmation; assets «تأییدنشده»
// with no holder or place from the tool (what people set on the CI is kept); never for ATMs, CRSs or kiosks, also when a
// monitoring tool reports them as plain devices; the daily cap in slices within the lock budget, one transaction per
// asset, the rest the next day; ITAM's refusals count against the cap and wait for the next day; 5 000 a day; the job
// after every completed pass and daily; the queue's «بی‌دارایی» tab with the roll-up per connector.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIn } from "@server/engine";
import type { JobResult } from "@server/jobs";
import { seedItamDefaults } from "@server/modules/itam";
import { LOCK_BUDGET_SERIALISED_MS, SLICE_MS } from "@server/modules/discovery/budget";
import { ASSET_ONLY_MESSAGE } from "@server/modules/discovery/guard";
import { DAY_MS, itamFeed, NOT_CONFIRMED_MESSAGE } from "@server/modules/discovery/itamfeed";
import { discoverySweep, resetDiscoveryThrottles } from "@server/modules/discovery/jobs";
import { READ_MESSAGE } from "@server/modules/discovery/service";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import type { Client } from "./helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock } from "./mocks/discovery/rest";
import { realPgAvailable } from "./pg-real";
import { raceDatabases } from "./race-helpers";

type Person = { client: Client; userId: string };
const errorOf = (r: any) => String(r?.error?.message ?? "");

/** The tests' tools over one organisation. */
function feedKit(world: () => DiscoveryWorld) {
  /** ITAM's own confirmation of its discovered-hardware step (an asset manager's first batch), on or off. */
  const confirm = (on: boolean) => world().q(`update sm_itam_configs set auto_assets_confirmed_at = ${on ? "now()" : "null"} where org_id = $1`, [world().e.org]);
  /** n hardware CIs, each linked to an item of the connector (oldest first, in the tool's id order), with the tool's reported holder and site. */
  async function devices(connectorId: string, n: number, o: { cls?: string; kind?: string; model?: string; attrs?: Row } = {}): Promise<string[]> {
    const w = world();
    const prefix = `D${Math.random().toString(36).slice(2, 8)}`;
    await w.q(
      `with c as (
         insert into sm_cis (id, org_id, name, class, state, model_name, attrs, created_at)
         select gen_random_uuid(), $1, $3 || '-' || lpad(g::text, 6, '0'), $4, 'operational', $6, $8::jsonb, now() - interval '1 day' + g * interval '1 millisecond'
         from generate_series(1, $5::int) g returning id, name, created_at)
       insert into sm_discovery_items (id, org_id, connector_id, external_id, kind, name, state, ci_id, origin, data)
       select gen_random_uuid(), $1, $2, c.name, $7, c.name, 'linked', c.id, 'cloud',
              jsonb_build_object('external_id', c.name, 'kind', $7::text, 'name', c.name, 'reported', jsonb_build_object('user', 'BANK\\' || c.name, 'site', 'BR-101'))
       from c`,
      [w.e.org, connectorId, prefix, o.cls ?? "desktop", n, o.model ?? null, o.kind ?? "endpoint", JSON.stringify(o.attrs ?? {})],
    );
    return (await w.q<{ id: string }>(`select id from sm_cis where org_id = $1 and name like $2 order by created_at`, [w.e.org, `${prefix}-%`])).map((r) => r.id);
  }
  const assetsOf = (cis: string[]) => world().q(`select a.*, a.xmin::text as tx from sm_assets a where a.ci_id = any($1::uuid[]) and a.deleted_at is null order by a.created_at`, [`{${cis.join(",")}}`]);
  const feedRuns = (connectorId: string) => world().q(`select * from sm_discovery_runs where connector_id = $1 and lane = 'itam' order by started_at`, [connectorId]);
  const itamJobs = async (connectorId: string) => Number((await world().one<{ n: number }>(`select count(*)::int as n from sm_jobs where kind = 'discovery.itam' and dedupe_key = $1 and status = 'queued'`, [`discovery.itam:${connectorId}`])).n);
  /** Slices of a connector's feed until it is done or waits (each slice gets `tickMs` of tick budget). */
  async function feed(connectorId: string, tickMs = 60_000): Promise<{ last: JobResult; slices: number[] }> {
    const slices: number[] = [];
    let last: JobResult = undefined;
    for (let i = 0; i < 20_000; i++) {
      const t0 = Date.now();
      last = await itamFeed(world().sys, connectorId, { deadline: Date.now() + tickMs }, { worker: "test-feed" });
      slices.push(Date.now() - t0);
      if (!last || last.again !== 0) break;
    }
    return { last, slices };
  }
  return { confirm, devices, assetsOf, feedRuns, itamJobs, feed };
}

describe("assets for new devices (design A §11.1)", () => {
  let w: DiscoveryWorld;
  let p: Record<"cm" | "am" | "req", Person>;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  let vanak: string;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
    p = {} as typeof p;
    const roles = { cm: "configuration_manager", am: "asset_manager", req: "requester" } as const;
    for (const k of Object.keys(roles) as (keyof typeof roles)[]) {
      p[k] = await w.e.member("member", `${k}-${w.e.org.slice(0, 6)}@example.com`);
      await w.e.owner.put(`${w.P}/access/members/${p[k].userId}`, { roles: [roles[k]], persona: k === "req" ? "requester" : "agent" });
    }
    vanak = (await w.e.owner.post(`${w.P}/r/location`, { name: "شعبهٔ ونک", code: "BR-101", kind: "site" })).row.id;
  }, 240_000);
  afterAll(() => unmount?.());

  const { confirm, devices, assetsOf, feedRuns, itamJobs, feed } = feedKit(() => w);

  it("is switched on only by an asset manager and only after ITAM's confirmation; until then nothing is made", async () => {
    await confirm(false);
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع کلید", base_url: "https://switch.mock.test/" });
    const cis = await devices(c.id, 3);
    const url = `${w.P}/r/discovery_connector/${c.id}`;
    const feedUrl = `${w.P}/discovery/connectors/${c.id}/asset-feed`;
    // a CMDB administrator who is not an asset manager may not, on the record API or the route; a requester sees nothing
    expect(errorOf(await p.cm.client.patch(url, { make_assets: true }, 403))).toBe(ASSET_ONLY_MESSAGE);
    expect(errorOf(await p.cm.client.post(feedUrl, { make_assets: true }, 403))).toBe(ASSET_ONLY_MESSAGE);
    await p.req.client.post(feedUrl, { make_assets: true }, 404);
    // an asset manager may — once ITAM has confirmed its discovered-hardware step (the route, and the record API of a connector they own)
    expect(errorOf(await p.am.client.post(feedUrl, { make_assets: true }, 400))).toBe(NOT_CONFIRMED_MESSAGE);
    const own = await w.connector({ ...REST_CONNECTOR, name: "منبع مدیر دارایی", base_url: "https://own.mock.test/", owner_id: p.am.userId });
    expect(errorOf(await p.am.client.patch(`${w.P}/r/discovery_connector/${own.id}`, { make_assets: true }, 400))).toBe(NOT_CONFIRMED_MESSAGE);
    // a connector the system switched on still makes nothing before ITAM's confirmation
    await w.update(c.id, { make_assets: true });
    expect((await feed(c.id)).last).toBeUndefined();
    expect(await assetsOf(cis)).toHaveLength(0);
    expect(await feedRuns(c.id)).toHaveLength(0);
    // after it, the asset manager switches it on and the feed makes them
    await confirm(true);
    await w.update(c.id, { make_assets: false });
    expect(await p.am.client.post(feedUrl, { make_assets: true, make_assets_daily: 100 })).toEqual({ id: c.id, make_assets: true, make_assets_daily: 100 });
    expect((await p.am.client.patch(`${w.P}/r/discovery_connector/${own.id}`, { make_assets: true })).row.make_assets).toBe(true);
    expect((await w.one(`select count(*)::int as n from sm_history where record_id = $1 and actor = $2 and field = 'make_assets'`, [c.id, p.am.userId])).n).toBeGreaterThan(0);
    expect((await feed(c.id)).last).toBeUndefined();
    expect(await assetsOf(cis)).toHaveLength(3);
    expect(await feedRuns(c.id)).toMatchObject([{ state: "completed", created: 3, failed: 0 }]);
    // switched off: nothing more is made for new devices
    expect((await p.am.client.post(feedUrl, { make_assets: false })).make_assets).toBe(false);
    const later = await devices(c.id, 2);
    expect((await feed(c.id)).last).toBeUndefined();
    expect(await assetsOf(later)).toHaveLength(0);
  }, 180_000);

  it("makes «تأییدنشده» assets with no holder or place from the tool, keeps what people set on the CI, and none for ATMs, CRSs, kiosks or devices that have one", async () => {
    await confirm(true);
    const [a, b] = makeDevices(2, { from: 810_001, prefix: "pc" });
    const mock = new RestMock([{ ...a, class: "laptop", user: "BANK\\ali", site: "BR-102" }, { ...b, class: "desktop", user: "BANK\\sara", site: "BR-103" }] as never);
    hosts["values.mock.test"] = mock.handler;
    const mapping = { ...REST_CONNECTOR.mapping, "reported.user": "$.user", "reported.site": "$.site" };
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع رایانه‌ها", base_url: "https://values.mock.test/", mapping, make_assets: true });
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ state: "completed", created: 2 });
    const [ia, ib] = await w.q(`select ci_id from sm_discovery_items where connector_id = $1 and state = 'linked' order by external_id`, [c.id]);
    // the tool's holder and site are hints on the CI, never its values
    const ciA = await w.one(`select used_by, location_id, attrs from sm_cis where id = $1`, [ia.ci_id]);
    expect(ciA).toMatchObject({ used_by: null, location_id: null });
    expect(ciA.attrs).toMatchObject({ reported_user: "BANK\\ali", reported_site: "BR-102" });
    // a person sets the second one's holder and place on the CI
    await w.e.owner.patch(`${w.P}/r/ci/${ib.ci_id}`, { used_by: p.req.userId, location_id: vanak });
    // devices that never get an asset this way: an ATM's, a bank-fleet model's, a VM, one that has an asset, a demo CI
    const [atm] = await devices(c.id, 1, { kind: "atm", cls: "computer" });
    await w.sys.write((tx) => createIn(tx, w.sys, "asset_model", { name: "NCR SelfServ 84", category: "atm" }, { trusted: true }));
    const [fleet] = await devices(c.id, 1, { cls: "computer", model: "NCR SelfServ 84" });
    const [vm] = await devices(c.id, 1, { cls: "virtual_machine" });
    const [held] = await devices(c.id, 1);
    await w.sys.write(async (tx) => {
      const model = await createIn(tx, w.sys, "asset_model", { name: "رایانهٔ رومیزی آزمون", category: "desktop" }, { trusted: true });
      await createIn(tx, w.sys, "asset", { model_id: model.id, name: "دارایی پیشین", state: "in_stock", ci_id: held }, { trusted: true });
    });
    const [demo] = await devices(c.id, 1);
    await w.q(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_cis')`, [w.e.org, demo]);
    expect((await feed(c.id)).last).toBeUndefined();
    const made = await assetsOf([ia.ci_id, ib.ci_id]);
    expect(made).toHaveLength(2);
    const byCi = Object.fromEntries(made.map((r: Row) => [r.ci_id, r]));
    expect(byCi[ia.ci_id]).toMatchObject({ state: "in_use", substate: "unverified", assigned_to: null, location_id: null });
    expect(byCi[ib.ci_id]).toMatchObject({ state: "in_use", substate: "unverified", assigned_to: p.req.userId, location_id: vanak });
    expect(await assetsOf([atm, fleet, vm, demo])).toHaveLength(0);
    expect(await assetsOf([held])).toHaveLength(1);
    expect(await feedRuns(c.id)).toMatchObject([{ state: "completed", created: 2, failed: 0 }]);
    // the ATM, the fleet model and the VM are not «بی‌دارایی» either; the demo CI is not this real connector's
    const tab = await p.am.client.get(`${w.P}/discovery/queue?tab=no_asset&connector=${c.id}`);
    expect(tab.rows).toHaveLength(1);
    expect(tab.rows[0].ci_id).toBe(demo);
  }, 240_000);

  it("keeps to the daily cap in slices within the lock budget, one transaction per asset; «بی‌دارایی» rolls up what waits; the rest comes the next day", async () => {
    await confirm(true);
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع سقف", base_url: "https://cap.mock.test/", make_assets: true, make_assets_daily: 30 });
    const cis = await devices(c.id, 45);
    // a tick of 1.5 s: slices of half a second
    const { last, slices } = await feed(c.id, 1_500);
    const made = await assetsOf(cis);
    expect(made).toHaveLength(30);
    // the oldest devices first, each asset its own transaction
    expect(made.map((r: Row) => r.ci_id).sort()).toEqual(cis.slice(0, 30).sort());
    // ≥ 5 000 a day (§7.6): at the measured time an asset, 5 000 take well under an hour of slices
    expect(new Set(made.map((r: Row) => r.tx)).size).toBe(30);
    for (const r of made) expect(r).toMatchObject({ state: "in_use", substate: "unverified" });
    const [run] = await feedRuns(c.id);
    expect(run).toMatchObject({ state: "completed", created: 30, failed: 0 });
    expect(run.warnings.map((x: Row) => x.code)).toContain("cap");
    expect(run.cursor.max_ms).toBeGreaterThan(0);
    expect(run.cursor.max_ms).toBeLessThan(LOCK_BUDGET_SERIALISED_MS);
    console.info(`feed: ${slices.length} slices, ${run.cursor.ewma.new?.toFixed(1)} ms an asset (EWMA), longest ${run.cursor.max_ms} ms`);
    expect(5_000 * run.cursor.ewma.new).toBeLessThan(3_600_000);
    expect(slices.length).toBeGreaterThan(1);
    for (const ms of slices) expect(ms).toBeLessThan(500 + run.cursor.max_ms + 1_000);
    // the job comes back the next (UTC) day
    const again = (last as { again: number }).again;
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThanOrEqual(DAY_MS - (Date.now() % DAY_MS) + 300_000 + 1_000);
    // the same day: nothing more
    expect(((await feed(c.id)).last as { again: number }).again).toBeGreaterThan(0);
    expect(await assetsOf(cis)).toHaveLength(30);
    // «بی‌دارایی»: what waits, with the tool's reported holder and site, and the roll-up per connector
    const tab = await p.am.client.get(`${w.P}/discovery/queue?tab=no_asset&connector=${c.id}&size=10`);
    expect(tab).toMatchObject({ total: 15, counts: { no_asset: 15 } });
    expect(tab.rows).toHaveLength(10);
    expect(tab.rows[0]).toMatchObject({ ci_id: cis[30], state: "linked", reported: { user: expect.stringMatching(/^BANK\\D/), site: "BR-101", location: null } });
    expect(tab.rollup).toEqual([{ connector_id: c.id, name: "منبع سقف", waiting: 15, make_assets: true, make_assets_daily: 30, made_today: 30, refused_today: 0 }]);
    const all = await p.am.client.get(`${w.P}/discovery/queue?tab=no_asset&size=500`);
    expect(all.rollup.find((r: Row) => r.connector_id === c.id)).toMatchObject({ waiting: 15 });
    expect(all.counts.no_asset).toBe(all.total);
    expect(errorOf(await p.req.client.get(`${w.P}/discovery/queue?tab=no_asset`, 403))).toBe(READ_MESSAGE);
    // the next day the rest
    await w.q(`update sm_discovery_runs set started_at = started_at - interval '1 day' where connector_id = $1 and lane = 'itam'`, [c.id]);
    expect((await feed(c.id)).last).toBeUndefined();
    expect(await assetsOf(cis)).toHaveLength(45);
    expect((await feedRuns(c.id)).map((r: Row) => [r.state, r.created])).toEqual([["completed", 30], ["completed", 15]]);
    expect((await p.am.client.get(`${w.P}/discovery/queue?tab=no_asset&connector=${c.id}`)).total).toBe(0);
  }, 240_000);

  it("none for an ATM, CRS or kiosk a monitoring tool reports as a plain device: by the fleet model's number or Latin model in any spelling, or by its terminal id", async () => {
    await confirm(true);
    // Zabbix and PRTG report every host as kind «device»; the seeded fleet has «ان‌سی‌آر SelfServ 22e (خودپرداز)» (6622e),
    // «هیوسونگ MX8800 (CRS)» (MX8800) and «کیوسک خدمات بانکی ۲۱ اینچ» (K21)
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع پایش شعبه‌ها", base_url: "https://fleet.mock.test/", make_assets: true });
    const as = (model: string | undefined, attrs?: Row) => devices(c.id, 1, { kind: "device", cls: "computer", model, attrs }).then(([id]) => id);
    const fleet = [await as("6622E"), await as("SelfServ 22e"), await as("mx-8800"), await as("K21"), await as(undefined, { terminal_id: "10021" })];
    // a PC still gets its asset
    const pc = await as("OptiPlex 7010");
    expect((await feed(c.id)).last).toBeUndefined();
    expect(await assetsOf(fleet)).toHaveLength(0);
    expect(await assetsOf([pc])).toHaveLength(1);
    // nor are they «بی‌دارایی»
    expect((await p.am.client.get(`${w.P}/discovery/queue?tab=no_asset&connector=${c.id}`)).total).toBe(0);
  }, 240_000);

  it("counts the devices ITAM refuses against the daily cap and passes them over until the next (UTC) day", async () => {
    await confirm(true);
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع برچسب تکراری", base_url: "https://dup.mock.test/", make_assets: true, make_assets_daily: 5 });
    const cis = await devices(c.id, 7);
    // the first three carry the tags of live assets of the register (both were imported with the same tags): ITAM refuses them
    const tags = [0, 1, 2].map((i) => `DUP-${c.id.slice(0, 8)}-${i}`);
    const held: string[] = [];
    await w.sys.write(async (tx) => {
      const model = await createIn(tx, w.sys, "asset_model", { name: `رایانهٔ برچسب تکراری ${c.id.slice(0, 8)}`, category: "desktop" }, { trusted: true });
      for (const tag of tags) held.push(String((await createIn(tx, w.sys, "asset", { model_id: model.id, name: tag, asset_tag: tag, state: "in_stock" }, { trusted: true })).id));
    });
    for (const [i, tag] of tags.entries()) await w.q(`update sm_cis set asset_tag = $2 where id = $1`, [cis[i], tag]);
    // three refused and two made: the cap of five tries is reached
    expect(((await feed(c.id)).last as { again: number }).again).toBeGreaterThan(0);
    expect(await assetsOf(cis)).toHaveLength(2);
    const [first] = await feedRuns(c.id);
    expect(first).toMatchObject({ state: "completed", created: 2, failed: 3 });
    expect(first.warnings.map((x: Row) => x.code)).toEqual(["refused", "refused", "refused", "cap"]);
    expect(first.cursor.refused).toEqual(cis.slice(0, 3));
    // a larger cap the same day: the next walk makes the other two and passes the refused three over
    await w.update(c.id, { make_assets_daily: 100 });
    expect((await feed(c.id)).last).toBeUndefined();
    expect((await assetsOf(cis)).map((r: Row) => r.ci_id)).toEqual(cis.slice(3));
    expect((await feedRuns(c.id)).map((r: Row) => [r.created, r.failed])).toEqual([[2, 3], [2, 0]]);
    // the day's later walks try nothing and leave no run behind
    expect((await feed(c.id)).last).toBeUndefined();
    expect(await feedRuns(c.id)).toHaveLength(2);
    // they still wait in «بی‌دارایی»; the roll-up tells what ITAM refused today
    const tab = await p.am.client.get(`${w.P}/discovery/queue?tab=no_asset&connector=${c.id}`);
    expect(tab.rows.map((r: Row) => r.ci_id)).toEqual(cis.slice(0, 3));
    expect(tab.rollup).toEqual([{ connector_id: c.id, name: "منبع برچسب تکراری", waiting: 3, make_assets: true, make_assets_daily: 100, made_today: 4, refused_today: 3 }]);
    // the next day they are tried again, once: the one whose clash a person cleared gets its asset
    await w.q(`update sm_assets set asset_tag = null where id = $1`, [held[0]]);
    await w.q(`update sm_discovery_runs set started_at = started_at - interval '1 day' where connector_id = $1 and lane = 'itam'`, [c.id]);
    expect((await feed(c.id)).last).toBeUndefined();
    expect((await assetsOf(cis.slice(0, 3))).map((r: Row) => r.ci_id)).toEqual([cis[0]]);
    expect((await feedRuns(c.id)).map((r: Row) => [r.created, r.failed])).toEqual([[2, 3], [2, 0], [1, 2]]);
  }, 240_000);

  it("is queued after every completed pass and daily while it is on; the job makes the assets", async () => {
    await confirm(true);
    hosts["jobs.mock.test"] = new RestMock(makeDevices(2, { from: 820_001, prefix: "ws" }).map((d) => ({ ...d, class: "desktop" })) as never).handler;
    const off = await w.connector({ ...REST_CONNECTOR, name: "منبع بی‌خوراک", base_url: "https://jobs.mock.test/" });
    await w.pass(off.id);
    expect(await itamJobs(off.id)).toBe(0);
    const on = await w.connector({ ...REST_CONNECTOR, name: "منبع با خوراک", base_url: "https://jobs.mock.test/", make_assets: true });
    await w.pass(on.id);
    expect(await itamJobs(on.id)).toBe(1);
    const cis = (await w.q<{ ci_id: string }>(`select ci_id from sm_discovery_items where connector_id = $1 and state = 'linked'`, [on.id])).map((r) => r.ci_id);
    expect(cis).toHaveLength(2);
    await w.drain();
    expect(await assetsOf(cis)).toHaveLength(2);
    expect(await feedRuns(on.id)).toMatchObject([{ state: "completed", created: 2 }]);
    // the sweep's daily round queues it for connectors whose feed is on
    resetDiscoveryThrottles();
    await discoverySweep(w.e.cfg, w.e.org);
    expect(await itamJobs(on.id)).toBe(1);
    expect(await itamJobs(off.id)).toBe(0);
  }, 240_000);
});

// The throughput target on a real PostgreSQL (§7.6): skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts).
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/discovery-itam.test.ts -t "5 000"
describe.skipIf(!realPgAvailable())("assets for new devices on a real PostgreSQL (design A §11.1, §7.6)", () => {
  raceDatabases("discovery_itam");
  let w: DiscoveryWorld;
  const { confirm, devices, feedRuns, feed } = feedKit(() => w);
  beforeAll(async () => {
    w = await discoveryWorld();
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
    await confirm(true);
  }, 300_000);

  it("makes 5 000 assets a day within the lock budget (the default cap: the 5 001st waits for the next day)", async () => {
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع بانک", base_url: "https://bank.mock.test/", make_assets: true });
    const cis = await devices(c.id, 5_001);
    const t0 = Date.now();
    // the server edition's ticks: 20 s of budget, slices of 5 s
    const { last, slices } = await feed(c.id, 20_000);
    const took = Date.now() - t0;
    const [run] = await feedRuns(c.id);
    expect(run).toMatchObject({ state: "completed", created: 5_000, failed: 0 });
    expect(run.cursor.max_ms).toBeLessThan(LOCK_BUDGET_SERIALISED_MS);
    expect((last as { again: number }).again).toBeGreaterThan(0);
    for (const ms of slices) expect(ms).toBeLessThan(SLICE_MS + run.cursor.max_ms + 1_000);
    const n = Number((await w.one<{ n: number }>(`select count(*)::int as n from sm_assets where ci_id = any($1::uuid[]) and deleted_at is null`, [`{${cis.join(",")}}`])).n);
    expect(n).toBe(5_000);
    console.info(`5 000 assets: ${(took / 1000).toFixed(1)} s in ${slices.length} slices, ${(5_000 / (took / 1000)).toFixed(1)}/s, longest asset ${run.cursor.max_ms} ms`);
  }, 1_800_000);
});
