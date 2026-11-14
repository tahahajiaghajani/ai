// The discovery module's HTTP API end to end (design A §4, §7.5, §8.4, §10.4, §15): a REST tool created, tested,
// previewed (a draft mapping tried without saving, nothing staged) and run through the routes, the console's card,
// runs and items; the reconciliation queue's «ساخت پیکربندی», «پیوند به…» and «نادیده گرفتن»; «پذیرش اندازهٔ
// تازه» after a sudden drop; «لغو» of a running pass; «اعمال دوباره روی همه».
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REFUSED_FIELD_MESSAGE } from "@shared/discovery/mapping";
import { HINT_ENTRY } from "@server/modules/cmdb/ire";
import { CONNECTOR_MESSAGES } from "@server/modules/discovery/kind";
import { runPull } from "@server/modules/discovery/runner";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, REST_TOKEN, RestMock } from "./mocks/discovery/rest";

describe("the discovery API end to end (design A §4, §8.4, §15)", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
  }, 180_000);
  afterAll(() => unmount?.());
  const item = (id: string) => w.one(`select * from sm_discovery_items where id = $1`, [id]);

  it("a REST tool through the routes: create, test, preview with a draft (nothing staged), run now, the card, runs and items", async () => {
    const P = w.P;
    const mock = new RestMock(makeDevices(4, { from: 3000 }));
    hosts["api.mock.test"] = mock.handler;
    const made = (await w.e.owner.post(`${P}/discovery/connectors`, { ...REST_CONNECTOR, name: "NetBox آزمایشی", base_url: "https://api.mock.test/" }, 201)).row;
    expect(made).toMatchObject({ kind: "rest", active: true, secret: { secret: true, hint: "…" } });
    const meta = await w.e.owner.get(`${P}/discovery/meta`);
    expect(meta).toMatchObject({ edition: "cloud", can: { admin: true, tenantAdmin: true }, min_every_minutes: 15 });
    expect(meta.kinds.map((k: Row) => k.kind)).toContain("rest");
    expect(meta.kinds.map((k: Row) => k.kind)).not.toContain("demo");
    // «آزمودن اتصال»
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/test`)).toMatchObject({ ok: true, warnings: [] });
    mock.token = "another-key";
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/test`)).toMatchObject({ ok: false, message: CONNECTOR_MESSAGES.auth });
    mock.token = REST_TOKEN;
    // «پیش‌نمایش»: mapped fields and the engine's dry run; a draft mapping is tried without being saved
    const preview = await w.e.owner.post(`${P}/discovery/connectors/${made.id}/preview`, { limit: 2 });
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({ external_id: "3000", action: "created", values: { hostname: "srv-3000", serial_number: "SN003000" }, raw: { id: 3000 } });
    const draft = await w.e.owner.post(`${P}/discovery/connectors/${made.id}/preview`, { limit: 1, draft: { mapping: { ...REST_CONNECTOR.mapping, "attrs.rack": "$.vendor" } } });
    expect(draft.rows[0].attrs).toMatchObject({ rack: "HPE" });
    expect((await w.one(`select mapping from sm_discovery_connectors where id = $1`, [made.id])).mapping["attrs.rack"]).toBe("$.rack");
    const refused = await w.e.owner.post(`${P}/discovery/connectors/${made.id}/preview`, { draft: { mapping: { ...REST_CONNECTOR.mapping, location_id: "$.site" } } }, 400);
    expect(refused.error.message).toContain(REFUSED_FIELD_MESSAGE);
    expect((await w.q(`select id from sm_discovery_items where connector_id = $1`, [made.id])).length).toBe(0);
    // «اجرای اکنون»
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/run`)).toMatchObject({ queued: true, running: null, reapply: false });
    await w.drain();
    const card = (await w.e.owner.get(`${P}/discovery/connectors`)).connectors.find((x: Row) => x.id === made.id);
    expect(card).toMatchObject({ kind: "rest", label: "REST/JSON عمومی", items: { total: 4, linked: 4, mismatch: 0 }, running: null, held: null, failures: 0, needs_key: false, can: { edit: true, operate: true } });
    expect(card.last_run).toMatchObject({ state: "completed", created: 4, trigger: "manual" });
    const page = await w.e.owner.get(`${P}/discovery/connectors/${made.id}`);
    expect(page).toMatchObject({ row: { id: made.id }, card: { id: made.id }, can: { edit: true, preview: true, raw: true } });
    expect((await w.e.owner.get(`${P}/discovery/connectors/${made.id}/runs?lane=inventory`)).rows).toHaveLength(1);
    // two previews were recorded (the refused draft never reached the tool)
    expect((await w.e.owner.get(`${P}/discovery/connectors/${made.id}/runs?lane=preview`)).rows.length).toBe(2);
    const items = await w.e.owner.get(`${P}/discovery/connectors/${made.id}/items?state=linked`);
    expect(items.rows).toHaveLength(4);
    expect(items.rows.every((r: Row) => r.ci_id)).toBe(true);
    // no secret is readable through any API: the module's routes, the record API, its list, history and journal
    await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { secret: "rotated-secret-value" });
    for (const path of [`/discovery/connectors/${made.id}`, "/discovery/connectors", `/r/discovery_connector/${made.id}`, "/r/discovery_connector", `/r/discovery_connector/${made.id}/history`, `/r/discovery_connector/${made.id}/journal`, `/discovery/connectors/${made.id}/runs`, `/discovery/connectors/${made.id}/items`]) {
      const text = JSON.stringify(await w.e.owner.get(`${P}${path}`));
      expect([path, text.includes(REST_TOKEN) || text.includes("rotated-secret-value")]).toEqual([path, false]);
    }
  }, 180_000);

  it("the reconciliation queue: «ساخت پیکربندی», «پیوند به…» through the identity hint, «نادیده گرفتن»", async () => {
    const P = w.P;
    const mock = new RestMock(makeDevices(3, { from: 3100 }));
    hosts["queue.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع صف", base_url: "https://queue.mock.test/", create_policy: "match_only" });
    await w.pass(c.id);
    const q = await w.e.owner.get(`${P}/discovery/queue?tab=unmatched&connector=${c.id}`);
    expect(q.rows).toHaveLength(3);
    expect(q.counts.unmatched).toBeGreaterThanOrEqual(3);
    const [a, b, d] = [...q.rows].sort((x: Row, y: Row) => String(x.external_id).localeCompare(String(y.external_id)));
    // «ساخت پیکربندی»: the engine again, allowed to create, as the connector's source
    const made = await w.e.owner.post(`${P}/discovery/items/${a.id}/create`);
    expect(made).toMatchObject({ action: "created", ci_id: expect.any(String) });
    expect(await item(a.id)).toMatchObject({ state: "linked", ci_id: made.ci_id, retry_at: null });
    expect((await w.one(`select discovery_source_id from sm_cis where id = $1`, [made.ci_id])).discovery_source_id).toBe(c.source_id);
    // «پیوند به…»: a CI made by hand; the next pass reconciles through it
    const ci = (await w.e.owner.post(`${P}/r/ci`, { name: "srv-hand-3101", class: "server", state: "operational" })).row;
    expect(await w.e.owner.post(`${P}/discovery/items/${b.id}/link`, { ci_id: ci.id })).toEqual({ linked: ci.id });
    expect(await item(b.id)).toMatchObject({ state: null, ci_id: ci.id, reconciled_at: null });
    await w.drain();
    expect(await item(b.id)).toMatchObject({ state: "linked", ci_id: ci.id, matched_by: HINT_ENTRY });
    // «نادیده گرفتن»
    expect(await w.e.owner.post(`${P}/discovery/items/${d.id}/ignore`)).toEqual({ state: "ignored" });
    expect((await w.e.owner.get(`${P}/discovery/queue?tab=unmatched&connector=${c.id}`)).rows).toHaveLength(0);
    // a linked item is not in the queue; a mismatch action needs an open mismatch
    await w.e.owner.post(`${P}/discovery/items/${a.id}/ignore`, {}, 400);
    await w.e.owner.post(`${P}/discovery/items/${a.id}/create`, {}, 400);
    expect((await w.e.owner.post(`${P}/discovery/items/${a.id}/mismatch/dismiss`, {}, 400)).error.message).toBe("این مورد ناهمخوانی بازی ندارد");
  }, 180_000);

  it("«پذیرش اندازهٔ تازه» after a sudden drop; «لغو» of a running pass; «اعمال دوباره روی همه»", async () => {
    const P = w.P;
    const mock = new RestMock(makeDevices(10, { from: 3200 }));
    hosts["drop.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع کاهش", base_url: "https://drop.mock.test/" });
    await w.pass(c.id);
    mock.devices = mock.devices.slice(0, 2);
    const held = await w.pass(c.id);
    expect(held.run.warnings).toContainEqual(expect.objectContaining({ code: "mass_drop" }));
    const card = (await w.e.owner.get(`${P}/discovery/connectors`)).connectors.find((x: Row) => x.id === c.id);
    expect(card.held).toMatchObject({ run_id: held.run.id, listed: 2 });
    expect(await w.e.owner.post(`${P}/discovery/runs/${held.run.id}/accept`)).toEqual({ gone: 8 });
    await w.e.owner.post(`${P}/discovery/runs/${held.run.id}/accept`, {}, 409);
    expect((await w.q(`select id from sm_discovery_items where connector_id = $1 and state = 'gone'`, [c.id])).length).toBe(8);
    expect((await w.e.owner.get(`${P}/discovery/connectors`)).connectors.find((x: Row) => x.id === c.id).held).toBeNull();
    // a pass longer than one slice, then «لغو»
    mock.devices = makeDevices(1500, { from: 40_000 });
    const slice = await runPull(w.sys, c.id, { deadline: Date.now() + 1500 }, { worker: "api-test", trigger: "manual" });
    expect(slice).toEqual({ again: 0 });
    expect((await w.e.owner.get(`${P}/discovery/connectors`)).connectors.find((x: Row) => x.id === c.id).running).toMatchObject({ phase: expect.any(String) });
    const canceled = await w.e.owner.post(`${P}/discovery/connectors/${c.id}/cancel`);
    expect(canceled).toMatchObject({ canceled: true });
    expect((await w.one(`select state from sm_discovery_runs where id = $1`, [canceled.run_id])).state).toBe("canceled");
    await w.e.owner.post(`${P}/discovery/connectors/${c.id}/cancel`, {}, 409);
    // «اعمال دوباره روی همه»: the queued pull carries it
    expect(await w.e.owner.post(`${P}/discovery/connectors/${c.id}/reapply`)).toMatchObject({ queued: true, reapply: true });
    const job = await w.one(`select payload from sm_jobs where org_id = $1 and kind = 'discovery.pull' and payload->>'connector' = $2 and status = 'queued'`, [w.e.org, c.id]);
    expect(job.payload).toMatchObject({ connector: c.id, trigger: "manual", reapply: true });
  }, 240_000);
});
