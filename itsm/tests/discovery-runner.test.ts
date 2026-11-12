// The pull runner on PGlite (design A §7, acceptance of DA1 part 1): a REST tool with offset paging loads into CIs;
// unchanged linked items make no engine call; the rolling refresh renews only items with contact, within its daily
// share; unmatched, duplicate and error items are retried (a closed de-duplication task re-queues its items);
// match-only sources create nothing; a mapping change re-reconciles; a changed serial updates through the identity
// hint while manual and locked values stay; parents on later pages become runs_on; a pass killed at every phase
// resumes; slices keep to their budget; only passes with changes make an import run; the mass-drop guard holds; the
// documented errors; the connector's configuration rules; the sweep and the run retention.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transitionIn } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { acceptNewSize, previewConnector, runnerFaults, runPull } from "@server/modules/discovery/runner";
import { HINT_ENTRY } from "@server/modules/cmdb/ire";
import { dailyUpkeep, discoverySweep, resetDiscoveryThrottles } from "@server/modules/discovery/jobs";
import { REFUSED_FIELD_MESSAGE } from "@shared/discovery/mapping";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock, type RestDevice } from "./mocks/discovery/rest";

const DAY = 86_400_000;

describe("discovery pull runner (design A §7)", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  let seq = 0;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
  }, 180_000);
  afterAll(() => unmount?.());

  /** A REST mock behind its own host and a connector reading it. */
  async function rest(devices: RestDevice[], data: Record<string, unknown> = {}): Promise<{ mock: RestMock; c: Row }> {
    const host = `rest${++seq}.mock.test`;
    const mock = new RestMock(devices);
    hosts[host] = mock.handler;
    const { options, ...rest } = data as { options?: Record<string, unknown> };
    const c = await w.connector({ ...REST_CONNECTOR, name: `منبع آزمایشی ${seq}`, base_url: `https://${host}/`, ...rest, options: { ...REST_CONNECTOR.options, ...(options ?? {}) } });
    return { mock, c };
  }
  const items = (connectorId: string) => w.q(`select * from sm_discovery_items where connector_id = $1 order by external_id`, [connectorId]);
  const lastRunAt = async (sourceId: string) => (await w.one<{ t: string | null }>(`select last_run_at as t from sm_cmdb_sources where id = $1`, [sourceId])).t;
  const age = (connectorId: string, field: "reconciled_at" | "retry_at", days: number) =>
    w.q(`update sm_discovery_items set ${field} = now() - make_interval(days => $2) where connector_id = $1 and ${field} is not null`, [connectorId, days]);

  it("loads 5 000 records with offset paging into CIs, then makes no engine call for unchanged linked items", async () => {
    const { c } = await rest(makeDevices(5000, { from: 100_000 }));
    const first = await w.pass(c.id);
    expect(first.run).toMatchObject({ state: "completed", complete: true, pages: 10, staged: 5000, created: 5000, failed: 0, items_total: 5000 });
    expect(first.run.import_run_id).toBeTruthy();
    const cis = await w.one<{ n: number; d: number }>(`select count(*)::int as n, count(distinct id)::int as d from sm_cis where discovery_source_id = $1 and deleted_at is null`, [c.source_id]);
    expect(cis).toEqual({ n: 5000, d: 5000 });
    const linked = await w.one<{ n: number; d: number }>(`select count(*) filter (where state = 'linked')::int as n, count(distinct ci_id)::int as d from sm_discovery_items where connector_id = $1`, [c.id]);
    expect(linked).toEqual({ n: 5000, d: 5000 });
    const imp = await w.one(`select * from sm_cmdb_import_runs where id = $1`, [first.run.import_run_id]);
    expect(imp).toMatchObject({ state: "completed", created: 5000, source_id: c.source_id });
    // the second pass: every item listed, none sent to the engine (the source's stamp of an engine call stays)
    const stamp = await lastRunAt(c.source_id);
    const started = new Date().toISOString();
    const second = await w.pass(c.id);
    expect(second.run).toMatchObject({ state: "completed", complete: true, staged: 5000, skipped_unchanged: 5000, created: 0, updated: 0, refreshed: 0, retried: 0, failed: 0 });
    expect(second.run.import_run_id).toBeNull();
    expect(await lastRunAt(c.source_id)).toBe(stamp);
    expect((await w.one<{ n: number }>(`select count(*)::int as n from sm_cis where discovery_source_id = $1 and updated_at > $2`, [c.source_id, started])).n).toBe(0);
  }, 1_200_000);

  it("refreshes only linked items whose source still has contact, at most 1/refresh_days of them a day", async () => {
    const devices = [...makeDevices(10, { from: 200_000, seenDaysAgo: 1 }), ...makeDevices(10, { from: 200_100, seenDaysAgo: 30 })];
    const { c } = await rest(devices, { refresh_days: 1, stale_days: 14 });
    await w.pass(c.id);
    await age(c.id, "reconciled_at", 2);
    const before = new Date().toISOString();
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ refreshed: 10, created: 0, updated: 0 });
    const rows = await items(c.id);
    const fresh = rows.filter((r) => Number(r.external_id) < 200_100);
    const silent = rows.filter((r) => Number(r.external_id) >= 200_100);
    expect(fresh.every((r) => r.reconciled_at >= before)).toBe(true);
    expect(silent.every((r) => r.reconciled_at < before)).toBe(true);
    // the refresh keeps the source's provenance and the CI's last discovery fresh
    const renewed = await w.one<{ n: number }>(`select count(*)::int as n from sm_cis where id = any($1::uuid[]) and last_discovered_at >= $2`, [`{${fresh.map((r) => r.ci_id).join(",")}}`, before]);
    expect(renewed.n).toBe(10);

    // the daily share: 30 linked items refreshed every 3 days → at most 10 a day
    const capped = await rest(makeDevices(30, { from: 210_000, seenDaysAgo: 1 }), { refresh_days: 3 });
    await w.pass(capped.c.id);
    await age(capped.c.id, "reconciled_at", 5);
    expect((await w.pass(capped.c.id)).run.refreshed).toBe(10);
    expect((await w.pass(capped.c.id)).run.refreshed).toBe(0);
  }, 300_000);

  it("retries unmatched, duplicate and error items after retry_hours; a closed de-duplication task re-queues its items", async () => {
    const devices: RestDevice[] = [...makeDevices(2, { from: 300_000 }), { id: 300_010, name: "bad-class-1", class: "no_such_class" }, { id: 300_011, name: "dup-host-1" }];
    // two CIs by hand with the host name the tool reports: the item is a duplicate
    for (const n of [1, 2]) await w.e.owner.post(`${w.P}/r/ci`, { name: `dup-host-1 (${n})`, class: "server", hostname: "dup-host-1", state: "operational" });
    const { c } = await rest(devices);
    const first = await w.pass(c.id);
    expect(first.run).toMatchObject({ created: 2, duplicates: 1, failed: 1 });
    const byId = async () => new Map((await items(c.id)).map((r) => [r.external_id, r]));
    let rows = await byId();
    expect(rows.get("300010")).toMatchObject({ state: "error", ci_id: null });
    expect(rows.get("300010")!.message).toContain("no_such_class");
    expect(rows.get("300011")).toMatchObject({ state: "duplicate" });
    expect(rows.get("300011")!.dedup_task_id).toBeTruthy();
    expect(Date.parse(rows.get("300010")!.retry_at)).toBeGreaterThan(Date.now() + 23 * 3600_000);
    // not yet due: nothing retried
    expect((await w.pass(c.id)).run.retried).toBe(0);
    // due: retried (still in error)
    await age(c.id, "retry_at", 1);
    expect((await w.pass(c.id)).run.retried).toBe(2);
    // the de-duplication task is closed («تکراری نیست»): its item is due again and a pass is queued and run
    const task = rows.get("300011")!.dedup_task_id as string;
    // the earlier loads' backlog (thousands of record events) is not this test's: the queue starts empty
    await w.q(`update sm_jobs set status = 'done', done_at = now() where org_id = $1 and status = 'queued'`, [w.e.org]);
    await w.sys.write((tx) => transitionIn(tx, w.sys, "cmdb_dedup_task", task, "canceled", { close_notes: "دو دستگاه جدا" }, { trusted: true }));
    resetDiscoveryThrottles();
    await w.drain();
    const runs = await w.q(`select * from sm_discovery_runs where connector_id = $1 order by started_at`, [c.id]);
    expect(runs.at(-1)).toMatchObject({ state: "completed", trigger: "schedule", retried: 1 });
    rows = await byId();
    expect(Date.parse(rows.get("300011")!.retry_at)).toBeGreaterThan(Date.now() + 23 * 3600_000);
  }, 300_000);

  it("a match-only source creates nothing; an item finds a CI made by hand at its next retry", async () => {
    const { c } = await rest(makeDevices(3, { from: 400_000 }), { create_policy: "match_only" });
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ created: 0, unmatched: 3 });
    expect((await w.one<{ n: number }>(`select count(*)::int as n from sm_cis where discovery_source_id = $1`, [c.source_id])).n).toBe(0);
    expect((await items(c.id)).map((r) => r.state)).toEqual(["unmatched", "unmatched", "unmatched"]);
    const made = (await w.e.owner.post(`${w.P}/r/ci`, { name: "srv-400000", class: "server", hostname: "srv-400000", state: "operational" })).row;
    await age(c.id, "retry_at", 1);
    const again = await w.pass(c.id);
    expect(again.run).toMatchObject({ retried: 3, created: 0, unmatched: 2 });
    const linked = (await items(c.id)).find((r) => r.external_id === "400000")!;
    expect(linked).toMatchObject({ state: "linked", ci_id: made.id });
  }, 300_000);

  it("a mapping change moves config_version and re-reconciles every item; a change elsewhere does not", async () => {
    const devices = makeDevices(5, { from: 500_000 }).map((d) => ({ ...d, rack: `R${d.id % 3}` }));
    const { c } = await rest(devices);
    await w.pass(c.id);
    const hashes = (await items(c.id)).map((r) => r.hash);
    expect((await w.update(c.id, { description: "منبع آزمایشی" })).config_version).toBe(1);
    const changed = await w.update(c.id, { mapping: { ...REST_CONNECTOR.mapping, "attrs.rack": "$.os" } });
    expect(changed.config_version).toBe(2);
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ updated: 5, created: 0 });
    expect(run.import_run_id).toBeTruthy();
    const after = await items(c.id);
    expect(after.every((r, i) => r.hash !== hashes[i] && r.state === "linked")).toBe(true);
    const ci = await w.one(`select attrs from sm_cis where id = $1`, [after[0].ci_id]);
    expect(ci.attrs.rack).toBe("Linux");
  }, 300_000);

  it("a changed serial updates the CI through the identity hint; locked and hand-set values stay", async () => {
    const devices = makeDevices(2, { from: 600_000 });
    const { mock, c } = await rest(devices);
    await w.pass(c.id);
    const [item] = await items(c.id);
    // a person locks the OS and sets the maker by hand (manual priority beats the source's)
    await w.e.owner.patch(`${w.P}/r/ci/${item.ci_id}`, { manufacturer: "Dell", locked_attrs: ["os"] });
    mock.devices[0] = { ...mock.devices[0], serial: "SN-CHANGED-1", os: "Windows Server 2022", vendor: "Lenovo", name: "srv-600000-renamed" };
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ updated: 1, created: 0 });
    const after = (await items(c.id)).find((r) => r.external_id === item.external_id)!;
    expect(after).toMatchObject({ state: "linked", ci_id: item.ci_id, matched_by: "پیوند پیشین منبع داده" });
    const ci = await w.one(`select serial_number, os, manufacturer, name from sm_cis where id = $1`, [item.ci_id]);
    expect(ci).toMatchObject({ serial_number: "SN-CHANGED-1", os: "Linux", manufacturer: "Dell", name: "srv-600000-renamed" });
  }, 300_000);

  it("links VMs to hosts reported on a later page through the parents pass", async () => {
    // page 1: VMs whose hosts come on page 2
    const vms: RestDevice[] = [1, 2, 3].map((i) => ({ id: 700_000 + i, name: `vm-${700_000 + i}`, kind: "vm", class: "virtual_machine", host_id: 700_100 + i }));
    const hostsOnly: RestDevice[] = [1, 2, 3].map((i) => ({ id: 700_100 + i, name: `esx-${700_100 + i}`, serial: `ESX${i}`, vendor: "Dell", kind: "host" }));
    const { c } = await rest([...vms, ...hostsOnly], { options: { page_size: 3 } });
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ state: "completed", created: 6, failed: 0 });
    const rels = await w.q(
      `select vm.external_id from sm_discovery_items vm join sm_discovery_items h on h.connector_id = vm.connector_id and h.external_id = vm.data->>'parent_external_id'
       join sm_ci_rels r on r.parent_id = vm.ci_id and r.child_id = h.ci_id and r.type = 'runs_on' and r.deleted_at is null
       where vm.connector_id = $1 order by 1`,
      [c.id],
    );
    expect(rels.map((r) => r.external_id)).toEqual(["700001", "700002", "700003"]);
  }, 300_000);

  it("a pass killed at every phase resumes where it was, with no duplicate and no lost item", async () => {
    const vms: RestDevice[] = [1, 2].map((i) => ({ id: 800_000 + i, name: `vm-${800_000 + i}`, kind: "vm", class: "virtual_machine", host_id: 800_100 + i, last_seen: new Date().toISOString() }));
    const devices: RestDevice[] = [...vms, ...makeDevices(6, { from: 800_100 }).map((d) => ({ ...d, kind: "host" })), { id: 800_200, name: "broken-1", class: "no_such_class" }];
    const { c } = await rest(devices, { options: { page_size: 3 }, refresh_days: 1 });
    const first = await w.pass(c.id, { crashes: ["fetch", "stage", "ire:new", "ire:new", "ire:parents", "finalise"] });
    expect(first.crashes).toBe(6);
    expect(first.run).toMatchObject({ state: "completed", complete: true, created: 8, failed: 1, items_total: 9 });
    expect((await w.q(`select id from sm_cmdb_import_runs where source_id = $1`, [c.source_id])).length).toBe(1);
    const check = async () => {
      const rows = await items(c.id);
      expect(rows.length).toBe(9);
      expect(rows.filter((r) => r.state === "linked").length).toBe(8);
      expect((await w.one<{ n: number }>(`select count(*)::int as n from sm_cis where discovery_source_id = $1 and deleted_at is null`, [c.source_id])).n).toBe(8);
      expect((await w.one<{ n: number }>(`select count(*)::int as n from sm_ci_rels r join sm_discovery_items i on i.ci_id = r.parent_id where i.connector_id = $1 and r.type = 'runs_on' and r.deleted_at is null`, [c.id])).n).toBe(2);
    };
    await check();
    // the second pass: a refresh and a retry are due, and it is killed in those phases and at its end
    await age(c.id, "reconciled_at", 2);
    await age(c.id, "retry_at", 1);
    const second = await w.pass(c.id, { crashes: ["ire:refresh", "ire:retry", "finalise"] });
    expect(second.crashes).toBe(3);
    expect(second.run).toMatchObject({ state: "completed", refreshed: 8, retried: 1, created: 0 });
    await check();
    expect((await w.q(`select id from sm_discovery_runs where connector_id = $1`, [c.id])).length).toBe(2);
  }, 300_000);

  it("keeps each slice within its budget and finishes the pass across slices", async () => {
    const { c } = await rest(makeDevices(120, { from: 900_000 }), { options: { page_size: 40 } });
    const returned: unknown[] = [];
    // a 2.2 s tick: each slice ends 1 s before its deadline
    const { run, slices } = await w.pass(c.id, { tickMs: 2200, onSlice: (r) => void returned.push(r) });
    expect(run).toMatchObject({ state: "completed", created: 120 });
    expect(slices).toBeGreaterThan(1);
    expect(returned.slice(0, -1).every((r) => JSON.stringify(r) === JSON.stringify({ again: 0 }))).toBe(true);
    expect(run.cursor.ewma.new).toBeGreaterThan(0);
  }, 300_000);

  it("moves a pass whose items look slow in short ticks: a slice's first engine call always starts", async () => {
    const { c } = await rest(makeDevices(20, { from: 950_000 }), { options: { page_size: 20 } });
    // the first slice stages the page and dies in its first engine call; then the estimate says 10 s an item, so by
    // the 1.5× rule no call would ever fit a slice
    runnerFaults.at = "ire:new";
    await expect(runPull(w.sys, c.id, { deadline: Date.now() + 60_000 }, { worker: "test-worker", trigger: "manual" })).rejects.toMatchObject({ code: "40001" });
    const staged = await w.q(`update sm_discovery_runs set cursor = jsonb_set(cursor, '{ewma}', '{"new": 10000}'::jsonb) where connector_id = $1 and state = 'running' returning staged`, [c.id]);
    expect(staged).toEqual([{ staged: 20 }]);
    const { run, slices } = await w.pass(c.id, { tickMs: 2500 });
    expect(run).toMatchObject({ state: "completed", created: 20, failed: 0 });
    expect(slices).toBeGreaterThan(1);
  }, 300_000);

  it("holds a sudden drop (mass-drop guard) until the new size is accepted; a normal drop marks items gone", async () => {
    const { mock, c } = await rest(makeDevices(20, { from: 1_000_000 }));
    await w.pass(c.id);
    // a broken tool lists half: nothing goes, the pass says why, the ladder is not queued
    await w.q(`delete from sm_jobs where org_id = $1 and dedupe_key = $2`, [w.e.org, `discovery.stale:${c.id}`]);
    mock.devices = mock.devices.slice(0, 10);
    const held = await w.pass(c.id);
    expect(held.run.warnings.some((x: Row) => x.code === "mass_drop")).toBe(true);
    expect((await items(c.id)).filter((r) => r.state === "gone").length).toBe(0);
    expect((await w.q(`select id from sm_jobs where org_id = $1 and dedupe_key = $2 and status = 'queued'`, [w.e.org, `discovery.stale:${c.id}`])).length).toBe(0);
    // «پذیرش اندازهٔ تازه»
    expect(await acceptNewSize(w.sys, held.run.id)).toEqual({ gone: 10 });
    expect((await items(c.id)).filter((r) => r.state === "gone").length).toBe(10);
    expect((await w.q(`select id from sm_jobs where org_id = $1 and dedupe_key = $2 and status = 'queued'`, [w.e.org, `discovery.stale:${c.id}`])).length).toBe(1);
    // the accepted size is the new baseline: dropping 1 of 10 is ordinary
    mock.devices = mock.devices.slice(0, 9);
    const normal = await w.pass(c.id);
    expect(normal.run.warnings.some((x: Row) => x.code === "mass_drop")).toBe(false);
    expect((await items(c.id)).filter((r) => r.state === "gone").length).toBe(11);
    // listed again: reconciled again
    mock.devices = makeDevices(20, { from: 1_000_000 });
    const back = await w.pass(c.id);
    expect(back.run.updated + back.run.created).toBe(0);
    expect((await items(c.id)).every((r) => r.state === "linked")).toBe(true);
  }, 300_000);

  it("answers the documented errors: retries, «… پاسخ نداد», a refused key, a malformed record, a redirect", async () => {
    // a 503 on the second page: retried, the pass completes
    const retry = await rest(makeDevices(6, { from: 1_100_000 }), { options: { page_size: 3 } });
    retry.mock.failOnce.set(3, 503);
    const results: unknown[] = [];
    const ok = await w.pass(retry.c.id, { onSlice: (r) => void results.push(r) });
    expect(ok.run).toMatchObject({ state: "completed", created: 6 });
    expect(results[0]).toEqual({ again: 15_000 });
    expect(ok.run.warnings.some((x: Row) => x.code === "retry")).toBe(true);
    // a 429 with Retry-After: the job comes back when the tool says
    const limited = await rest(makeDevices(3, { from: 1_100_100 }));
    limited.mock.failOnce.set(0, 429);
    const lr: unknown[] = [];
    await w.pass(limited.c.id, { onSlice: (r) => void lr.push(r) });
    expect(lr[0]).toEqual({ again: 2000 });
    // a tool that keeps failing: four attempts, then the pass fails
    const down = await rest(makeDevices(3, { from: 1_100_200 }));
    down.mock.failAlways.set(0, 503);
    const failed = await w.pass(down.c.id);
    expect(failed.run).toMatchObject({ state: "failed", error: `«${down.c.name}» پاسخ نداد` });
    expect(failed.slices).toBe(4);
    // a refused key fails at once
    const key = await rest(makeDevices(3, { from: 1_100_300 }));
    key.mock.token = "another";
    const refused = await w.pass(key.c.id);
    expect(refused.run).toMatchObject({ state: "failed", error: "نام کاربری یا کلید پذیرفته نشد" });
    expect(refused.slices).toBe(1);
    // a malformed record is one failure; the pass goes on
    const bad = await rest(makeDevices(4, { from: 1_100_400 }));
    bad.mock.malformed.add(1_100_401);
    const partly = await w.pass(bad.c.id);
    expect(partly.run).toMatchObject({ state: "completed", created: 3, failed: 1 });
    expect(partly.run.warnings.some((x: Row) => x.code === "record")).toBe(true);
    // a redirect to another host is never followed
    const moved = await rest(makeDevices(2, { from: 1_100_500 }));
    moved.mock.redirectTo = "https://elsewhere.mock.test/api/devices/";
    expect((await w.pass(moved.c.id)).run).toMatchObject({ state: "failed", error: "پاسخ به نشانی دیگری هدایت شد؛ نشانی منبع را اصلاح کنید" });
  }, 300_000);

  it("keeps two workers on one connector to one pass: the second waits on the pass's lease", async () => {
    const { c } = await rest(makeDevices(60, { from: 1_200_000 }), { options: { page_size: 20 } });
    let busy = 0;
    for (let round = 0; round < 200; round++) {
      const deadline = Date.now() + 3000;
      const [a, b] = await Promise.all(["worker-a", "worker-b"].map((worker) => runPull(w.sys, c.id, { deadline }, { worker, trigger: "manual" })));
      busy += [a, b].filter((r) => JSON.stringify(r) === JSON.stringify({ again: 15_000 })).length;
      if (!a || !b) break;
    }
    expect(busy).toBeGreaterThan(0);
    const runs = await w.q(`select * from sm_discovery_runs where connector_id = $1`, [c.id]);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ state: "completed", created: 60, staged: 60, pages: 3 });
    expect(await w.one(`select count(*)::int as n, count(distinct external_id)::int as d from sm_discovery_items where connector_id = $1`, [c.id])).toEqual({ n: 60, d: 60 });
    expect((await w.one<{ n: number }>(`select count(*)::int as n from sm_cis where discovery_source_id = $1`, [c.source_id])).n).toBe(60);
  }, 300_000);

  it("previews the first page as a dry run: the CI values, the engine's verdict and the raw element with secrets masked; nothing kept", async () => {
    const devices = makeDevices(30, { from: 1_300_000 });
    Object.assign(devices[0], { admin_password: "hunter2", rack: "R-12" });
    // the tool's second device is a server made by hand: the engine would match it by its host name
    const hand = (await w.e.owner.post(`${w.P}/r/ci`, { name: "srv-1300001", class: "server", hostname: "srv-1300001", state: "operational" })).row;
    const { c } = await rest(devices, { options: { page_size: 10 } });
    const count = async () => w.one(`select (select count(*)::int from sm_cis where deleted_at is null) as cis, (select count(*)::int from sm_discovery_items where connector_id = $1) as items,
      (select count(*)::int from sm_cmdb_import_runs where source_id = $2) as imports`, [c.id, c.source_id]);
    const before = await count();
    const stamp = await lastRunAt(c.source_id);
    const out = await previewConnector(w.sys, c.id, {}, 5);
    expect(out).toMatchObject({ total: 30, complete: false });
    expect(out.rows).toHaveLength(5);
    expect(out.rows[0]).toMatchObject({
      external_id: "1300000", name: "srv-1300000", class: "server", action: "created",
      values: { name: "srv-1300000", hostname: "srv-1300000", serial_number: "SN1300000", manufacturer: "HPE", os: "Linux" }, attrs: { rack: "R-12" },
    });
    // the raw element as the tool sent it, its secrets masked
    expect(out.rows[0].raw).toMatchObject({ id: 1_300_000, name: "srv-1300000", admin_password: "***" });
    expect(JSON.stringify(out.rows)).not.toContain("hunter2");
    expect(out.rows[1]).toMatchObject({ external_id: "1300001", action: "updated" });
    expect(out.rows[1].matched_by).toBeTruthy();
    // nothing kept: no item, no CI, no import run, the source's stamp of an engine call unchanged; one preview run
    expect(await count()).toEqual(before);
    expect(await lastRunAt(c.source_id)).toBe(stamp);
    expect(await w.one(`select ci.hostname, ci.serial_number from sm_cis ci where ci.id = $1`, [hand.id])).toEqual({ hostname: "srv-1300001", serial_number: null });
    const runs = await w.q(`select lane, trigger, state, pages, fetched, complete, items_total from sm_discovery_runs where connector_id = $1`, [c.id]);
    expect(runs).toEqual([{ lane: "preview", trigger: "preview", state: "completed", pages: 1, fetched: 10, complete: false, items_total: 30 }]);
    // a draft mapping is previewed before it is saved: the connector keeps its own
    const draft = await previewConnector(w.sys, c.id, { mapping: { ...REST_CONNECTOR.mapping, name: "$.serial" } }, 2);
    expect(draft.rows.map((r) => r.name)).toEqual(["SN1300000", "SN1300001"]);
    expect((await w.one(`select mapping from sm_discovery_connectors where id = $1`, [c.id])).mapping.name).toBe("$.name");
    // … held to the allow-list like a saved one
    await expect(previewConnector(w.sys, c.id, { mapping: { ...REST_CONNECTOR.mapping, owned_by: "$.name" } })).rejects.toThrow(REFUSED_FIELD_MESSAGE);
    // after a pass the linked items go through their CI, as a pass sends them: nothing would change
    await w.pass(c.id);
    const linked = await previewConnector(w.sys, c.id, {}, 3);
    expect(linked.rows.map((r) => r.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(linked.rows[0].matched_by).toBe(HINT_ENTRY);
    // a tool that refuses the key: the preview says so and its run is failed
    const key = await rest(makeDevices(3, { from: 1_300_100 }));
    key.mock.token = "another";
    await expect(previewConnector(w.sys, key.c.id)).rejects.toThrow("نام کاربری یا کلید پذیرفته نشد");
    expect(await w.one(`select lane, state, error from sm_discovery_runs where connector_id = $1`, [key.c.id])).toEqual({ lane: "preview", state: "failed", error: "نام کاربری یا کلید پذیرفته نشد" });
  }, 300_000);
});

describe("the connector's configuration and the sweep (design A §5.1, §7.2)", () => {
  let w: DiscoveryWorld;
  beforeAll(async () => {
    w = await discoveryWorld();
  }, 180_000);

  const base = { ...REST_CONNECTOR, base_url: "https://cfg.mock.test/" };

  it("gives a connector its data source, keeps its kind, moves config_version and keeps the mapping to the allow-list", async () => {
    const c = await w.connector({ ...base, name: "منبع پیکربندی" });
    expect(c.config_version).toBe(1);
    const src = await w.one(`select * from sm_cmdb_sources where id = $1`, [c.source_id]);
    expect(src).toMatchObject({ kind: "connector", priority: 90, stale_after_days: 30, active: true, name: "منبع پیکربندی" });
    // a second connector of the same name cannot exist; its data source never clashes with another source's name
    await w.e.owner.post(`${w.P}/r/cmdb_data_source`, { name: "منبع دوم", kind: "file", priority: 100 });
    const second = await w.connector({ ...base, name: "منبع دوم" });
    expect((await w.one(`select name from sm_cmdb_sources where id = $1`, [second.source_id])).name).toBe("منبع دوم (۲)");
    // AD computers and KSC review first; a push connector fed by a relay takes its tool's priority
    await expect(w.update(c.id, { kind: "demo" })).rejects.toThrow(/تغییر نمی‌کند/);
    for (const f of ["options", "create_policy", "default_class"] as const) {
      const value = f === "options" ? { ...base.options, page_size: 100 } : f === "create_policy" ? "review" : "computer";
      const before = Number((await w.one(`select config_version from sm_discovery_connectors where id = $1`, [c.id])).config_version);
      expect((await w.update(c.id, { [f]: value })).config_version).toBe(before + 1);
    }
    // through the record API, as a person
    const P = w.P;
    const refused = await w.e.owner.req("PATCH", `${P}/r/discovery_connector/${c.id}`, { mapping: { ...base.mapping, owned_by: "$.owner" } }, 400);
    expect(refused.error.message).toContain(REFUSED_FIELD_MESSAGE);
    const stub = await w.e.owner.req("POST", `${P}/r/discovery_connector`, { ...base, name: "زبیکس", kind: "zabbix" }, 400);
    expect(stub.error.message).toContain("هنوز ساخته نشده");
    const demo = await w.e.owner.req("POST", `${P}/r/discovery_connector`, { name: "نمایشی", kind: "demo" }, 400);
    expect(demo.error.message).toContain("بستهٔ داده‌های نمایشی");
    const fast = await w.e.owner.req("POST", `${P}/r/discovery_connector`, { ...base, name: "تند", every_minutes: 3 }, 400);
    expect(fast.error.message).toContain("۱۵ دقیقه");
    const noPath = await w.e.owner.req("POST", `${P}/r/discovery_connector`, { ...base, name: "بی‌مسیر", options: {} }, 400);
    expect(noPath.error.message).toContain("path");
    const made = await w.e.owner.post(`${P}/r/discovery_connector`, { ...base, name: "منبع کاربر", secret: "k1" });
    expect(made.row).toMatchObject({ kind: "rest", config_version: 1, create_policy: "create" });
    expect(made.row.secret).toEqual({ secret: true, hint: "…" });
    expect(made.row.source_id).toBeTruthy();
  }, 120_000);

  it("the bookkeeping tables are the module's: nobody writes them through the record API", async () => {
    const c = await w.connector({ ...base, name: "منبع دفتر" });
    const id = (await w.one<{ id: string }>(`insert into sm_discovery_items (id, org_id, connector_id, external_id, kind, name, origin) values (gen_random_uuid(), $1, $2, 'x-1', 'other', 'x-1', 'cloud') returning id`, [w.e.org, c.id])).id;
    const call = async (method: string, path: string, body?: unknown) =>
      (await w.e.app.fetch(new Request(`http://local.test/api${path}`, { method, headers: { "content-type": "application/json", cookie: w.e.owner.cookie }, body: body === undefined ? undefined : JSON.stringify(body) }))).status;
    // the owner reads the item through its connector
    expect((await w.e.owner.get(`${w.P}/r/discovery_item/${id}`)).row ?? null).not.toBeNull();
    expect(await call("POST", `${w.P}/r/discovery_item`, { connector_id: c.id, external_id: "x-2", name: "x-2" })).toBeGreaterThanOrEqual(400);
    expect(await call("POST", `${w.P}/r/discovery_run`, { connector_id: c.id, lane: "inventory" })).toBeGreaterThanOrEqual(400);
    await call("PATCH", `${w.P}/r/discovery_item/${id}`, { name: "changed", state: "linked" });
    expect(await call("DELETE", `${w.P}/r/discovery_item/${id}`)).toBeGreaterThanOrEqual(400);
    expect(await w.one(`select name, state, deleted_at from sm_discovery_items where id = $1`, [id])).toEqual({ name: "x-1", state: null, deleted_at: null });
    expect((await w.q(`select id from sm_discovery_items where connector_id = $1`, [c.id])).length).toBe(1);
  }, 120_000);

  it("the sweep queues due pulls — a demo connector's as demo work — and the daily upkeep keeps runs and batches", async () => {
    const due = await w.connector({ ...base, name: "منبع زمان‌بندی", every_minutes: 15 });
    const manual = await w.connector({ ...base, name: "منبع دستی", every_minutes: 0 });
    const demo = await inDemoScope(w.e.org, () => w.connector({ name: "منبع نمایشی آزمایشی", kind: "demo", every_minutes: 15 }));
    resetDiscoveryThrottles();
    const r = await discoverySweep(w.e.cfg, w.e.org);
    expect(r.again).toBe(15 * 60_000);
    const jobs = await w.q(
      `select payload, exists (select 1 from sm_demo_rows d where d.org_id = j.org_id and d.row_id = j.id) as captured from sm_jobs j where org_id = $1 and kind = 'discovery.pull' and status = 'queued'`,
      [w.e.org],
    );
    const of = (id: string) => jobs.find((j) => j.payload.connector === id);
    expect(of(due.id)).toMatchObject({ captured: false });
    expect(of(due.id)!.payload.__demo).toBeUndefined();
    expect(of(demo.id)).toMatchObject({ captured: true, payload: { __demo: true } });
    expect(of(manual.id)).toBeUndefined();
    // retention: runs older than 90 days go, except the last 20 of a lane and the last complete inventory pass
    const old = (days: number, complete = false) =>
      w.q(
        `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, complete, generation) values (gen_random_uuid(), $1, $2, 'inventory', 'schedule', 'completed', now() - make_interval(days => $3), $4, 1)`,
        [w.e.org, manual.id, days, complete],
      );
    await old(400, true);
    for (let i = 0; i < 25; i++) await old(100 + i);
    await w.q(`insert into sm_discovery_batches (id, org_id, connector_id, batch_id, received_at, state) values (gen_random_uuid(), $1, $2, 'b-old', now() - interval '40 days', 'done'), (gen_random_uuid(), $1, $2, 'b-new', now(), 'done')`, [w.e.org, manual.id]);
    const kept = await dailyUpkeep(w.e.db, w.e.org);
    expect(kept).toMatchObject({ runs: 5, batches: 1 });
    const left = await w.q(`select complete from sm_discovery_runs where connector_id = $1`, [manual.id]);
    expect(left.length).toBe(21);
    expect(left.filter((x) => x.complete).length).toBe(1);
  }, 120_000);
});
