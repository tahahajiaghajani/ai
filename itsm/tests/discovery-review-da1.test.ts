// Regression tests of DA1's review fixes (design A §7.1, §7.2, §8.1, §10, §14.5): of the discovery jobs one tick claims
// together, the first two work (DA1-1); «لغو» between two slices ends the pass's job instead of starting a new pass, and a
// new ask after it starts one (DA1-2); connector jobs and connector saves bring back a lost sweep (DA1-3); «پیوند به…»
// needs the right to change the CI (DA1-4); «معتبرتر از ویرایش دستی» goes off only once the source ranks below hand
// edits (DA1-5); offset and page paging follow the tool's total past a page it caps (DA1-6); retention keeps the
// mass-drop guard's baseline (DA1-7); a deleted connector's CIs are judged by the data policies and by health (DA1-8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@shared/id";
import { createIn, removeIn, updateIn } from "@server/engine";
import { enqueue, tick } from "@server/jobs";
import { cmdbConfig } from "@server/modules/cmdb/common";
import { computeHealth } from "@server/modules/cmdb/health";
import { applyPolicies } from "@server/modules/cmdb/jobs";
import { BUSY_AGAIN_MS, busyAgainMs } from "@server/modules/discovery/budget";
import { overManualOffMessage } from "@server/modules/discovery/guard";
import { busyDiscoveryJobs, dailyUpkeep, resetDiscoveryThrottles } from "@server/modules/discovery/jobs";
import { LINK_WRITE_MESSAGE } from "@server/modules/discovery/service";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock } from "./mocks/discovery/rest";

describe("DA1 review fixes (design A §7, §8.1, §10, §14.5)", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
  }, 180_000);
  afterAll(() => unmount?.());

  const sweeps = () => w.q(`select id from sm_jobs where org_id = $1 and kind = 'discovery.sweep' and status = 'queued'`, [w.e.org]);
  const loseSweep = async () => {
    await w.q(`delete from sm_jobs where org_id = $1 and kind = 'discovery.sweep'`, [w.e.org]);
    resetDiscoveryThrottles();
  };
  const passes = (connectorId: string) => w.q(`select id, state from sm_discovery_runs where connector_id = $1 and lane = 'inventory' order by started_at, id`, [connectorId]);
  /** A tick of 1.5 s: one slice of work for a pull (later claims within it find no time left), the jobs due before it too. */
  const slice = () => tick(w.e.cfg, { budgetMs: 1500, max: 50 });

  it("DA1-1: of the discovery jobs one tick claimed together, the first two work and the rest come back apart", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const connector = uuidv7();
      ids.push(await enqueue(w.e.db, { kind: "discovery.pull", orgId: w.e.org, payload: { connector }, dedupeKey: `discovery.pull:${connector}`, delayMs: 3_600_000 }));
    }
    const list = `{${ids.join(",")}}`;
    try {
      // one claim statement (tick() with concurrency): the same lock end for the whole batch
      await w.q(`update sm_jobs set status = 'running', locked_until = now() + interval '5 minutes' where id = any($1::uuid[])`, [list]);
      const order = (await w.q<{ id: string }>(`select id from sm_jobs where id = any($1::uuid[]) order by locked_until, id`, [list])).map((r) => r.id);
      const busy: number[] = [];
      for (const id of order) busy.push(await busyDiscoveryJobs(w.e.db, w.e.org, id));
      expect(busy).toEqual([0, 1, 2, 3]);
    } finally {
      await w.q(`update sm_jobs set status = 'done', done_at = now(), locked_until = null where id = any($1::uuid[])`, [list]);
    }
    const back = Array.from({ length: 40 }, () => busyAgainMs());
    expect(Math.min(...back)).toBeGreaterThanOrEqual(BUSY_AGAIN_MS);
    expect(Math.max(...back)).toBeLessThanOrEqual(BUSY_AGAIN_MS * 1.2);
    expect(new Set(back).size).toBeGreaterThan(1);
  }, 60_000);

  it("DA1-2, DA1-3: «لغو» between two slices ends the pass's job, a new ask starts a pass again; a connector job brings back a lost sweep", async () => {
    const P = w.P;
    const mock = new RestMock(makeDevices(1500, { from: 50_000 }));
    hosts["cancel.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع لغو", base_url: "https://cancel.mock.test/" });
    await w.drain();
    await loseSweep();
    // «اجرای اکنون», one slice: the job is queued again and remembers its pass
    const job = (await w.e.owner.post(`${P}/discovery/connectors/${c.id}/run`)).job_id;
    await slice();
    const [first] = await passes(c.id);
    expect(first.state).toBe("running");
    expect(await w.one(`select status, payload from sm_jobs where id = $1`, [job])).toMatchObject({ status: "queued", payload: { connector: c.id, run: first.id } });
    expect(await sweeps()).toHaveLength(1);
    // «لغو» between two slices: the next slice ends the job, no new pass starts
    await w.e.owner.post(`${P}/discovery/connectors/${c.id}/cancel`);
    await slice();
    expect((await w.one(`select status from sm_jobs where id = $1`, [job])).status).toBe("done");
    expect(await passes(c.id)).toEqual([{ id: first.id, state: "canceled" }]);
    // a new ask starts a pass; asked again after a «لغو» while its job waits, the waiting job starts a new pass too
    const again = (await w.e.owner.post(`${P}/discovery/connectors/${c.id}/run`)).job_id;
    await slice();
    const second = (await passes(c.id))[1];
    expect(second.state).toBe("running");
    await w.e.owner.post(`${P}/discovery/connectors/${c.id}/cancel`);
    expect((await w.e.owner.post(`${P}/discovery/connectors/${c.id}/run`)).job_id).toBe(again);
    await slice();
    const all = await passes(c.id);
    expect(all.map((r: Row) => r.state)).toEqual(["canceled", "canceled", "running"]);
    // put it away
    await w.e.owner.post(`${P}/discovery/connectors/${c.id}/cancel`);
    await slice();
    expect((await w.one(`select status from sm_jobs where id = $1`, [again])).status).toBe("done");
    expect((await passes(c.id)).map((r: Row) => r.state)).toEqual(["canceled", "canceled", "canceled"]);
  }, 180_000);

  it("DA1-3: any save of an active connector brings back a lost sweep (a key entered again after a backup restore)", async () => {
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع بازگردانده", base_url: "https://restored.mock.test/" });
    await loseSweep();
    await w.update(c.id, { secret: "rest-secret-token-2" });
    expect(await sweeps()).toHaveLength(1);
    await loseSweep();
    await w.update(c.id, { active: false });
    await w.update(c.id, { description: "خاموش" });
    expect(await sweeps()).toHaveLength(0);
  }, 60_000);

  it("DA1-4: «پیوند به…» needs the right to change the CI, unless the caller is a CMDB administrator", async () => {
    const P = w.P;
    const am = await w.e.member("member", `am-${w.e.org.slice(0, 6)}@example.com`);
    await w.e.owner.put(`${P}/access/members/${am.userId}`, { roles: ["asset_manager"], persona: "agent" });
    const mock = new RestMock(makeDevices(2, { from: 61_000 }));
    hosts["link.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع پیوند", base_url: "https://link.mock.test/", owner_id: am.userId });
    await w.pass(c.id);
    const items = await w.q(`select id, ci_id from sm_discovery_items where connector_id = $1 order by external_id`, [c.id]);
    expect(items).toHaveLength(2);
    // a CI outside the asset manager's group (they read every CI and change only their group's)
    const refused = await am.client.post(`${P}/discovery/items/${items[0].id}/link`, { ci_id: items[1].ci_id }, 403);
    expect(String(refused?.error?.message ?? "")).toBe(LINK_WRITE_MESSAGE);
    expect((await w.one(`select ci_id from sm_discovery_items where id = $1`, [items[0].id])).ci_id).toBe(items[0].ci_id);
    expect(await w.e.owner.post(`${P}/discovery/items/${items[0].id}/link`, { ci_id: items[1].ci_id })).toEqual({ linked: items[1].ci_id });
  }, 120_000);

  it("DA1-5: «معتبرتر از ویرایش دستی» goes off only once the source ranks below hand edits", async () => {
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع معتبر", base_url: "https://manual.mock.test/", active: false });
    await w.update(c.id, { over_manual: true });
    const manual = Number((await cmdbConfig(w.e.db, w.sys)).manual_priority);
    const priority = (p: number) => w.sys.write((tx) => updateIn(tx, w.sys, "cmdb_data_source", c.source_id, { priority: p }, { trusted: true }));
    await priority(manual);
    await expect(w.update(c.id, { over_manual: false })).rejects.toThrow(overManualOffMessage(manual, manual));
    expect((await w.one(`select over_manual from sm_discovery_connectors where id = $1`, [c.id])).over_manual).toBe(true);
    await priority(manual + 10);
    expect((await w.update(c.id, { over_manual: false })).over_manual).toBe(false);
  }, 60_000);

  it("DA1-6: offset and page paging follow the tool's total past a page it caps", async () => {
    for (const paging of ["offset", "page"] as const) {
      const mock = new RestMock(makeDevices(120, { from: paging === "offset" ? 70_000 : 71_000 }));
      mock.maxLimit = 50;
      hosts[`cap-${paging}.mock.test`] = mock.handler;
      const c = await w.connector({ ...REST_CONNECTOR, name: `منبع سقف ${paging}`, base_url: `https://cap-${paging}.mock.test/`, options: { ...REST_CONNECTOR.options, paging } });
      const { run } = await w.pass(c.id);
      expect(run).toMatchObject({ state: "completed", complete: true, items_total: 120 });
      expect(mock.requests).toHaveLength(3);
    }
  }, 180_000);

  it("DA1-7: retention keeps the mass-drop guard's baseline while every later pass is held", async () => {
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع نگه‌داشت", base_url: "https://keep.mock.test/", active: false });
    const run = async (daysAgo: number, generation: number, held: boolean) =>
      (
        await w.one(
          `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, finished_at, generation, complete, items_total, warnings)
           values (gen_random_uuid(), $1, $2, 'inventory', 'schedule', 'completed', now() - make_interval(days => $3::int), now() - make_interval(days => $3::int), $4, true, $5, $6::jsonb)
           returning id`,
          [w.e.org, c.id, daysAgo, generation, held ? 10 : 5000, JSON.stringify(held ? [{ code: "mass_drop", message: "کاهش ناگهانی" }] : [])],
        )
      ).id as string;
    const baseline = await run(130, 1, false);
    for (let i = 0; i < 21; i++) await run(120 - i, 2 + i, true);
    await dailyUpkeep(w.e.db, w.e.org);
    expect(await w.q(`select id from sm_discovery_runs where id = $1`, [baseline])).toHaveLength(1);
    // the oldest held pass outside the last twenty goes, as before
    expect((await w.one(`select count(*)::int as n from sm_discovery_runs where connector_id = $1`, [c.id])).n).toBe(21);
  }, 60_000);

  it("DA1-8: a deleted connector's CIs are judged by the data policies and by health again", async () => {
    const mock = new RestMock(makeDevices(2, { from: 80_000 }));
    hosts["deleted.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع حذف‌شده", base_url: "https://deleted.mock.test/" });
    await w.pass(c.id);
    const ids = (await w.q<{ id: string }>(`select id from sm_cis where discovery_source_id = $1 order by id`, [c.source_id])).map((r) => r.id);
    expect(ids).toHaveLength(2);
    // the ladder's contact, as its job keeps it; nothing heard of the machines for 400 days
    await w.q(
      `insert into sm_discovery_states (id, org_id, target_table, target_id, ci_id, last_contact_at, origin)
       select gen_random_uuid(), org_id, 'ci', id::text, id, now() - interval '400 days', 'cloud' from sm_cis where discovery_source_id = $1`,
      [c.source_id],
    );
    const old = () => w.q(`update sm_cis set last_discovered_at = now() - interval '400 days', is_stale = false where discovery_source_id = $1`, [c.source_id]);
    const stale = async () => (await w.q<{ is_stale: boolean }>(`select is_stale from sm_cis where discovery_source_id = $1 order by id`, [c.source_id])).map((r) => !!r.is_stale);
    await w.sys.write((tx) => createIn(tx, w.sys, "cmdb_policy", { name: "کهنه پس از یک ماه", action: "flag_stale", after_days: 30, active: true, max_per_run: 100 }, { trusted: true }));
    // while the connector lives, its ladder judges them: health keeps is_stale as stored, the policies leave them
    await old();
    await w.sys.write((tx) => computeHealth(tx, w.sys, { ids }));
    await applyPolicies(w.sys);
    expect(await stale()).toEqual([false, false]);
    // deleted: its ladder never runs again, and its source is an ordinary one
    await w.sys.write((tx) => removeIn(tx, w.sys, "discovery_connector", c.id));
    await old();
    await w.sys.write((tx) => computeHealth(tx, w.sys, { ids }));
    expect(await stale()).toEqual([true, true]);
    await old();
    await applyPolicies(w.sys);
    expect(await stale()).toEqual([true, true]);
  }, 120_000);
});
