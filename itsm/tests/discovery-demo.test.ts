// Demo data and discovery (design A §14.4, §17 «discovery-demo»): the demo connector's work is demo work — its jobs are
// queued inside the demo scope with `__demo` (DEMO_JOB_SQL makes them demo jobs) and every row it writes (items, runs,
// CIs) is a demo row the purge removes without a trace — while a real connector's work is real and stays; the
// identification boundary holds both ways (a real connector never matches the pack's CIs, the demo connector never
// touches a real CI); an ATM a real tool reports never reaches a demo asset; real connectors keep running while a pack
// is loaded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIn } from "@server/engine";
import { inDemoScope, isDemoRow } from "@server/db/scope";
import { purgeStep } from "@server/modules/demo";
import { seedItamDefaults } from "@server/modules/itam";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock } from "./mocks/discovery/rest";

describe("demo data and discovery (design A §14.4)", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
    // a pack as the loader leaves it (loaded, saved before), without the bank
    await w.q(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
      [w.e.org, w.e.ownerId],
    );
  }, 240_000);
  afterAll(() => unmount?.());

  const demoRow = (id: string | null | undefined) => isDemoRow(w.e.db, w.e.org, id ?? null);
  const ci = (data: Record<string, unknown>) => w.sys.write((tx) => createIn(tx, w.sys, "ci", { class: "server", state: "operational", ...data }, { trusted: true }));
  const capturedJob = (connectorId: string) =>
    w.one<{ payload: Row; captured: boolean }>(
      `select payload, exists (select 1 from sm_demo_rows d where d.org_id = j.org_id and d.row_id = j.id) as captured from sm_jobs j
       where org_id = $1 and kind = 'discovery.pull' and payload->>'connector' = $2 and status = 'queued'`,
      [w.e.org, connectorId],
    );
  let demoConnector: Row;
  let real: { c: Row; mock: RestMock };

  it("the identification boundary holds both ways, and an ATM a real tool reports never reaches a demo asset", async () => {
    const P = w.P;
    // the pack's CI and ATM asset; a real CI with the serial the demo connector reports
    const demoCi = await inDemoScope(w.e.org, () => ci({ name: "srv-demo-bound", serial_number: "BOUND-0001" }));
    const realCi = await ci({ name: "srv-real-core", serial_number: "DEMO-SRV-0001" });
    expect([await demoRow(demoCi.id), await demoRow(realCi.id)]).toEqual([true, false]);
    const model = (await w.e.owner.post(`${P}/r/asset_model/query`, { filter: { f: "name", op: "eq", v: "لنوو ThinkPad E14 Gen 5" }, size: 1 })).rows[0].id;
    const demoAtm = await inDemoScope(w.e.org, () => w.sys.write((tx) => createIn(tx, w.sys, "asset", { model_id: model, state: "in_stock", terminal_id: "1021" }, { trusted: true })));
    // what a source writes (the CMDB's own health pass may restamp a CI; it is not a source)
    const cisOf = () => w.q(`select id, version, name, serial_number, discovery_source_id, last_discovered_at, attr_meta from sm_cis where id = any($1::uuid[]) order by id`, [`{${demoCi.id},${realCi.id}}`]);
    const before = await cisOf();
    // a real tool reports the pack's serial and an ATM with the pack's terminal id
    const mock = new RestMock([...makeDevices(2, { from: 6000 }), { id: 6100, name: "srv-bound", serial: "BOUND-0001", vendor: "HPE", os: "Linux" }, { id: 6200, name: "ATM-1021", kind: "atm", terminal: "1021" } as never]);
    hosts["real.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع واقعی", base_url: "https://real.mock.test/", mapping: { ...REST_CONNECTOR.mapping, terminal_id: "$.terminal" } });
    real = { c, mock };
    await w.e.owner.post(`${P}/discovery/connectors/${c.id}/run`);
    expect(await capturedJob(c.id)).toMatchObject({ captured: false, payload: { trigger: "manual" } });
    expect((await capturedJob(c.id)).payload.__demo).toBeUndefined();
    // the demo connector (only the pack makes one), run now by a real person: its job is demo work
    demoConnector = await inDemoScope(w.e.org, () => w.connector({ name: "منبع نمایشی", kind: "demo", every_minutes: 0 }));
    expect(await demoRow(demoConnector.id)).toBe(true);
    await w.e.owner.post(`${P}/discovery/connectors/${demoConnector.id}/run`);
    expect(await capturedJob(demoConnector.id)).toMatchObject({ captured: true, payload: { __demo: true, trigger: "manual" } });
    await w.drain();
    // the real pass: its own CI for the pack's serial, the ATM unmatched and linked to nothing
    const realItems = await w.q<Row>(`select external_id, state, ci_id, asset_id from sm_discovery_items where connector_id = $1 order by external_id`, [c.id]);
    expect(realItems.map((i) => i.state)).toEqual(["linked", "linked", "linked", "unmatched"]);
    const bound = realItems.find((i) => i.external_id === "6100")!;
    expect(bound.ci_id).not.toBe(demoCi.id);
    expect(await demoRow(bound.ci_id)).toBe(false);
    expect(realItems.find((i) => i.external_id === "6200")).toMatchObject({ ci_id: null, asset_id: null });
    // the demo pass: a demo CI of its own for the real CI's serial, nothing written to real rows
    const demoItems = await w.q<Row>(`select id, external_id, kind, state, ci_id from sm_discovery_items where connector_id = $1 order by external_id`, [demoConnector.id]);
    expect(demoItems.length).toBe(7);
    const srv = demoItems.find((i) => i.external_id === "demo-srv-01")!;
    expect(srv.state).toBe("linked");
    expect(srv.ci_id).not.toBe(realCi.id);
    expect(await demoRow(srv.ci_id)).toBe(true);
    expect(await cisOf()).toEqual(before);
    expect(before.every((x) => x.discovery_source_id === null && x.version === 1)).toBe(true);
    expect((await w.one(`select terminal_id, state from sm_assets where id = $1`, [demoAtm.id]))).toEqual({ terminal_id: "1021", state: "in_stock" });
    // real connectors keep running while the pack is loaded
    expect((await w.one(`select state, created from sm_discovery_runs where connector_id = $1 and lane = 'inventory'`, [c.id]))).toEqual({ state: "completed", created: 3 });
  }, 240_000);

  it("every row of the demo connector's work is a demo row the purge removes; the real connector's work stays", async () => {
    const demoItems = await w.q<Row>(`select id, ci_id from sm_discovery_items where connector_id = $1`, [demoConnector.id]);
    const demoRuns = await w.q<Row>(`select id from sm_discovery_runs where connector_id = $1`, [demoConnector.id]);
    const demoCis = demoItems.map((i) => i.ci_id).filter(Boolean) as string[];
    expect(demoCis.length).toBeGreaterThanOrEqual(4);
    for (const id of [...demoItems.map((i) => i.id), ...demoRuns.map((r) => r.id), ...demoCis, demoConnector.source_id]) expect([id, await demoRow(id)]).toEqual([id, true]);
    const realItems = await w.q<Row>(`select id, ci_id from sm_discovery_items where connector_id = $1`, [real.c.id]);
    for (const id of [...realItems.map((i) => i.id), real.c.id, real.c.source_id]) expect([id, await demoRow(id)]).toEqual([id, false]);
    // «حذف کامل داده‌های نمایشی»
    await w.e.owner.post(`${w.P}/demo/purge`, { confirm: "حذف کامل" });
    for (let i = 0; i < 12; i++) await purgeStep(w.e.cfg, w.e.org);
    expect((await w.e.owner.get(`${w.P}/demo`)).state).toBe("none");
    expect(await w.q(`select id from sm_discovery_connectors where id = $1`, [demoConnector.id])).toEqual([]);
    expect(await w.q(`select id from sm_discovery_items where connector_id = $1`, [demoConnector.id])).toEqual([]);
    expect(await w.q(`select id from sm_discovery_runs where connector_id = $1`, [demoConnector.id])).toEqual([]);
    expect(await w.q(`select id from sm_cis where id = any($1::uuid[])`, [`{${demoCis.join(",")}}`])).toEqual([]);
    expect(await w.q(`select id from sm_cmdb_sources where id = $1`, [demoConnector.source_id])).toEqual([]);
    // the real connector, its items and CIs are untouched
    expect((await w.q(`select id from sm_discovery_items where connector_id = $1`, [real.c.id])).length).toBe(realItems.length);
    expect((await w.q(`select id from sm_cis where id = any($1::uuid[]) and deleted_at is null`, [`{${realItems.map((i) => i.ci_id).filter(Boolean).join(",")}}`])).length).toBe(3);
    expect((await w.one(`select deleted_at from sm_discovery_connectors where id = $1`, [real.c.id])).deleted_at).toBeNull();
  }, 240_000);
});
