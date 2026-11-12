// The contact ladder (design A §10, acceptance of DA1): stale and missing run on the tools' own last contact, never on
// listing. The AD dead-machine fixture (§10.1) — an AD computer whose lastLogonTimestamp is 200 days old and a KSC host
// last visible 190 days ago, both listed on every pass — yields a missing task for the asset's manager and a stale CI;
// the AD lag keeps a recently seen machine from being flagged early; delete_policy flag / retire / none; the CMDB's
// data policies skip connector-fed CIs; ATM assets without a CI get tasks; `auto` marks the asset «مفقود»; a pass held
// by the mass-drop guard holds the ladder; the owner hears of a mass drop and of three failed passes in a row; the
// sweep queues every active connector's ladder once a day.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { DiscoveredRecord } from "@shared/discovery/types";
import { createIn, updateIn } from "@server/engine";
import { registerHooks } from "@server/engine/hooks";
import { inDemoScope } from "@server/db/scope";
import { seedItamDefaults } from "@server/modules/itam";
import { applyPolicies } from "@server/modules/cmdb";
import { createOrUpdate } from "@server/modules/cmdb/ire";
import { discoverySweep, resetDiscoveryThrottles } from "@server/modules/discovery/jobs";
import type { ConnectorKind } from "@server/modules/discovery/kind";
import { overrideKind, serverKind } from "@server/modules/discovery/registry";
import { runLadder } from "@server/modules/discovery/stale";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock } from "./mocks/discovery/rest";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** A tool of a stub kind (AD computers, KSC) that lists fixed records. */
function fixedKind(kind: string, records: () => DiscoveredRecord[]): ConnectorKind {
  return {
    ...serverKind(kind)!, ready: true, editions: ["cloud", "server", "relay"], headers: [], optionsSchema: z.object({}).passthrough(),
    test: async () => ({ ok: true, warnings: [] }),
    pages: async () => ({ records: records(), next: null, complete: true }),
  };
}

describe("the contact ladder (design A §10)", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  const restore: (() => void)[] = [];
  let unmount: () => void;
  let am: { userId: string };
  let laptop: string;
  const ad: DiscoveredRecord[] = [];
  const ksc: DiscoveredRecord[] = [];
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
    am = await w.e.member("member", "asset.manager@bank.test");
    laptop = (await w.e.owner.post(`${w.P}/r/asset_model/query`, { filter: { f: "name", op: "eq", v: "لنوو ThinkPad E14 Gen 5" }, size: 1 })).rows[0].id;
    restore.push(overrideKind(fixedKind("ad_computers", () => ad)), overrideKind(fixedKind("ksc", () => ksc)));
  }, 240_000);
  afterAll(() => {
    unmount?.();
    for (const r of restore) r();
  });

  /** A connector of a stub kind: made as a REST connector (the wizard offers only built kinds), then switched. */
  async function stubConnector(kind: string, name: string, data: Record<string, unknown> = {}): Promise<Row> {
    const c = await w.connector({ ...REST_CONNECTOR, name, owner_id: w.e.ownerId, ...data });
    await w.q(`update sm_discovery_connectors set kind = $2, mapping = '{}'::jsonb where id = $1`, [c.id, kind]);
    return c;
  }
  let seq = 0;
  async function rest(devices: unknown[], data: Record<string, unknown> = {}): Promise<{ mock: RestMock; c: Row }> {
    const host = `stale${++seq}.mock.test`;
    const mock = new RestMock(devices as never);
    hosts[host] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: `منبع کهنگی ${seq}`, base_url: `https://${host}/`, owner_id: w.e.ownerId, ...data });
    return { mock, c };
  }
  const state = (table: "ci" | "asset", id: string) => w.one(`select * from sm_discovery_states where target_table = $1 and target_id = $2`, [table, id]);
  const ciOf = (id: string) => w.one(`select id, is_stale, state from sm_cis where id = $1`, [id]);
  const tasksFor = (assetNumber: string) => w.q(`select * from sm_todos where org_id = $1 and short_description like $2 and deleted_at is null`, [w.e.org, `دارایی ${assetNumber} %`]);
  const asset = (ciId: string | null, data: Record<string, unknown> = {}) =>
    w.e.owner.post(`${w.P}/r/asset`, { model_id: laptop, state: "in_use", assigned_to: am.userId, managed_by: am.userId, ...(ciId ? { ci_id: ciId } : {}), ...data }).then((r) => r.row);

  it("the AD dead machine: listed on every pass, silent for months — a missing task for its manager and a stale CI", async () => {
    ad.push({ external_id: "ad-guid-stolen", kind: "endpoint", name: "PC-STOLEN", hostname: "pc-stolen", fqdn: "pc-stolen.bank.local", last_contact_at: ago(200) });
    ksc.push({ external_id: "ksc-stolen", kind: "endpoint", name: "PC-STOLEN", hostname: "pc-stolen", last_contact_at: ago(190) });
    const adc = await stubConnector("ad_computers", "AD رایانه‌ها");
    const kscc = await stubConnector("ksc", "کسپرسکی مرکزی");
    await w.pass(adc.id);
    await w.pass(kscc.id);
    const items = await w.q(`select connector_id, ci_id, listed_at, last_contact_at from sm_discovery_items where connector_id = any($1::uuid[])`, [`{${adc.id},${kscc.id}}`]);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.ci_id)).size).toBe(1);
    const ciId = items[0].ci_id as string;
    const made = await asset(ciId);
    // both connectors' passes queued their ladders
    await w.drain();
    const tasks = await tasksFor(made.number);
    expect(tasks).toHaveLength(1);
    // AD's lastLogonTimestamp may lag 14 days: the latest contact is 200 − 14 = 186 days ago (KSC's 190 is older)
    expect(tasks[0].short_description).toBe(`دارایی ${made.number} از ${fa(186)} روز پیش با هیچ ابزاری تماس نداشته است`);
    expect(tasks[0]).toMatchObject({ assigned_to: am.userId, ci_id: ciId, state: "new" });
    expect(tasks[0].description).toContain("«AD رایانه‌ها»");
    expect(tasks[0].description).toContain("«کسپرسکی مرکزی»");
    expect((await ciOf(ciId)).is_stale).toBe(true);
    expect((await w.one(`select state from sm_assets where id = $1`, [made.id])).state).toBe("in_use");
    const s = await state("ci", ciId);
    expect(s).toMatchObject({ ci_id: ciId, asset_id: made.id, missing_todo_id: tasks[0].id });
    expect(s.stale_since).toBeTruthy();
    expect(s.missing_since).toBeTruthy();
    // listing is not contact: listed today, last contact 186 days ago
    expect(Math.round((Date.now() - Date.parse(s.last_contact_at)) / DAY)).toBe(186);
    expect(Date.now() - Date.parse(s.last_listed_at)).toBeLessThan(DAY);
    // again: one task per silence
    await w.pass(adc.id);
    await w.drain();
    expect(await runLadder(w.sys, adc.id)).toMatchObject({ tasks: 0, stale: 0 });
    expect(await tasksFor(made.number)).toHaveLength(1);
    // contact again ends the silence and the staleness; a later silence is a new one
    ad[0] = { ...ad[0], last_contact_at: ago(1) };
    await w.pass(adc.id);
    await w.drain();
    expect((await ciOf(ciId)).is_stale).toBe(false);
    expect(await state("ci", ciId)).toMatchObject({ stale_since: null, missing_since: null, missing_todo_id: null });
  }, 300_000);

  it("AD's lag keeps a machine seen three weeks ago fresh; an unknown contact decides nothing", async () => {
    ad.push({ external_id: "ad-guid-recent", kind: "endpoint", name: "PC-RECENT", hostname: "pc-recent", last_contact_at: ago(20) });
    ad.push({ external_id: "ad-guid-unknown", kind: "endpoint", name: "PC-UNKNOWN", hostname: "pc-unknown" });
    const adc = await stubConnector("ad_computers", "AD شعبه‌ها");
    await w.pass(adc.id);
    await w.drain();
    const items = await w.q(`select external_id, ci_id from sm_discovery_items where connector_id = $1 and external_id in ('ad-guid-recent', 'ad-guid-unknown') order by external_id`, [adc.id]);
    for (const it of items) expect((await ciOf(it.ci_id)).is_stale, it.external_id).toBe(false);
    expect((await state("ci", items.find((i) => i.external_id === "ad-guid-recent")!.ci_id)).stale_since).toBeNull();
    expect((await state("ci", items.find((i) => i.external_id === "ad-guid-unknown")!.ci_id)).last_contact_at).toBeNull();
  }, 300_000);

  it("delete_policy: flag marks the CI stale, none leaves it, retire retires it unless an asset in use stands behind it", async () => {
    const run = async (policy: string, data: Record<string, unknown> = {}) => {
      const { c } = await rest(makeDevices(2, { from: 800_000 + seq * 10, seenDaysAgo: 30 }), data);
      await w.sys.write((tx) => updateIn(tx, w.sys, "cmdb_data_source", c.source_id, { delete_policy: policy }, { trusted: true }));
      await w.pass(c.id);
      const items = await w.q(`select ci_id from sm_discovery_items where connector_id = $1 order by external_id`, [c.id]);
      return { c, cis: items.map((i) => i.ci_id as string) };
    };
    const flag = await run("flag");
    await w.drain();
    for (const id of flag.cis) expect((await ciOf(id)).is_stale).toBe(true);
    const none = await run("none");
    await w.drain();
    for (const id of none.cis) {
      expect((await ciOf(id)).is_stale).toBe(false);
      expect((await state("ci", id)).stale_since).toBeTruthy();
    }
    const retire = await run("retire", { retire_days: 20 });
    await asset(retire.cis[1]);
    await w.drain();
    expect((await ciOf(retire.cis[0])).state).toBe("retired");
    expect((await ciOf(retire.cis[1])).state).not.toBe("retired");
    // retire_days 0 is off
    const off = await run("retire", { retire_days: 0 });
    await w.drain();
    expect((await ciOf(off.cis[0])).state).not.toBe("retired");
  }, 300_000);

  it("the CMDB's data policies skip connector-fed CIs (they are the ladder's)", async () => {
    const { c } = await rest(makeDevices(1, { from: 900_000 }));
    await w.pass(c.id);
    const [{ ci_id: fed }] = await w.q(`select ci_id from sm_discovery_items where connector_id = $1`, [c.id]);
    const file = await w.sys.write((tx) => createIn(tx, w.sys, "cmdb_data_source", { name: "فایل فهرست قدیمی", kind: "file", priority: 80 }, { trusted: true }));
    const [byFile] = (await createOrUpdate(w.sys, { source_id: file.id, items: [{ class: "server", values: { name: "SRV-FROM-FILE", hostname: "srv-from-file", serial_number: "SN-FILE-1" } }] })).results;
    await w.q(`update sm_cis set last_discovered_at = now() - interval '400 days', is_stale = false where id = any($1::uuid[])`, [`{${fed},${byFile.ci_id}}`]);
    await w.sys.write((tx) => createIn(tx, w.sys, "cmdb_policy", { name: "کهنه پس از یک سال", action: "flag_stale", after_days: 365, active: true, max_per_run: 5000 }, { trusted: true }));
    await applyPolicies(w.sys);
    expect((await ciOf(byFile.ci_id!)).is_stale).toBe(true);
    expect((await ciOf(fed)).is_stale).toBe(false);
  }, 300_000);

  it("an ATM asset without a CI gets a task; `auto` marks an in-use asset «مفقود» with the sources in its journal", async () => {
    const atm = await asset(null, { name: "خودپرداز شعبهٔ ونک" });
    const adc = await stubConnector("ad_computers", "سوئیچ خودپردازها");
    await w.q(
      `insert into sm_discovery_items (id, org_id, connector_id, external_id, kind, name, asset_id, state, listed_at, last_contact_at, seen_generation, mismatch_state)
       values (gen_random_uuid(), $1, $2, 'T-1001', 'atm', 'خودپرداز ۱۰۰۱', $3, 'linked', now(), now() - interval '100 days', 1, 'none')`,
      [w.e.org, adc.id, atm.id],
    );
    expect(await runLadder(w.sys, adc.id)).toMatchObject({ tasks: 1 });
    expect(await tasksFor(atm.number)).toHaveLength(1);
    expect((await state("asset", atm.id)).missing_todo_id).toBeTruthy();
    // automatic: the asset itself
    const auto = await rest(makeDevices(1, { from: 950_000, seenDaysAgo: 60 }), { missing_action: "auto" });
    await w.pass(auto.c.id);
    const [{ ci_id }] = await w.q(`select ci_id from sm_discovery_items where connector_id = $1`, [auto.c.id]);
    const gone = await asset(ci_id);
    await w.drain();
    const after = await w.one(`select state, substate, retire_reason from sm_assets where id = $1`, [gone.id]);
    expect(after).toMatchObject({ state: "missing" });
    expect(after.retire_reason).toContain("با هیچ ابزاری تماس نداشته است");
    const journal = await w.q(`select body from sm_journal where org_id = $1 and record_id = $2`, [w.e.org, gone.id]);
    expect(journal.some((j) => String(j.body).includes(auto.c.name))).toBe(true);
    expect(await tasksFor(gone.number)).toHaveLength(0);
  }, 300_000);

  it("a pass held by the mass-drop guard holds the ladder; the owner hears of the drop and of three failed passes", async () => {
    const { mock, c } = await rest(makeDevices(20, { from: 990_000, seenDaysAgo: 30 }));
    await w.pass(c.id);
    await w.drain();
    const notices = async (needle: string) =>
      (await w.q(`select payload from sm_jobs where org_id = $1 and kind = 'notify.batch' and payload -> 'ev' ->> 'id' = $2`, [w.e.org, c.id])).filter((j) => JSON.stringify(j.payload).includes(needle));
    mock.devices = mock.devices.slice(0, 5);
    const held = await w.pass(c.id);
    expect(held.run.warnings.some((x: Row) => x.code === "mass_drop")).toBe(true);
    expect(await notices("کاهش ناگهانی")).toHaveLength(1);
    expect((await notices("کاهش ناگهانی"))[0].payload.people).toEqual([{ user: w.e.ownerId, reasons: ["users"] }]);
    expect(await runLadder(w.sys, c.id)).toMatchObject({ held: true, targets: 0 });
    // three failed passes in a row: told once
    mock.token = "rotated";
    for (let i = 0; i < 4; i++) await w.pass(c.id);
    expect(await notices("پیاپی ناموفق بود")).toHaveLength(1);
  }, 300_000);

  it("one target's failed transition never stops the others: it is left as it was and taken again at the next run", async () => {
    const { c } = await rest(makeDevices(3, { from: 975_000, seenDaysAgo: 30 }));
    await w.pass(c.id);
    const cis = (await w.q(`select ci_id from sm_discovery_items where connector_id = $1 order by external_id`, [c.id])).map((r) => r.ci_id as string);
    const off = registerHooks("ci", {
      beforeWrite(x) {
        if (x.prev?.id === cis[0] && x.changed.has("is_stale")) throw new Error("refused for the test");
      },
    });
    try {
      expect(await runLadder(w.sys, c.id)).toMatchObject({ failed: 1, stale: 2 });
    } finally {
      off();
    }
    expect((await ciOf(cis[0])).is_stale).toBe(false);
    expect((await state("ci", cis[0])).stale_since).toBeNull();
    expect((await ciOf(cis[1])).is_stale).toBe(true);
    expect(await runLadder(w.sys, c.id)).toMatchObject({ failed: 0, stale: 1 });
    expect((await ciOf(cis[0])).is_stale).toBe(true);
  }, 300_000);

  it("the sweep queues every active connector's ladder once a day — a demo connector's as demo work", async () => {
    const real = await w.connector({ ...REST_CONNECTOR, name: "منبع روزانه", base_url: "https://daily.mock.test/" });
    const demo = await inDemoScope(w.e.org, () => w.connector({ name: "منبع نمایشی روزانه", kind: "demo", every_minutes: 0 }));
    await w.q(`delete from sm_jobs where org_id = $1 and kind = 'discovery.stale'`, [w.e.org]);
    resetDiscoveryThrottles();
    await discoverySweep(w.e.cfg, w.e.org);
    const jobs = await w.q(
      `select payload, exists (select 1 from sm_demo_rows d where d.org_id = j.org_id and d.row_id = j.id) as captured from sm_jobs j where org_id = $1 and kind = 'discovery.stale' and status = 'queued'`,
      [w.e.org],
    );
    const of = (id: string) => jobs.find((j) => j.payload.connector === id);
    expect(of(real.id)).toMatchObject({ captured: false });
    expect(of(demo.id)).toMatchObject({ captured: true, payload: { __demo: true } });
    // not again the same day
    await w.q(`delete from sm_jobs where org_id = $1 and kind = 'discovery.stale'`, [w.e.org]);
    await discoverySweep(w.e.cfg, w.e.org);
    expect((await w.q(`select id from sm_jobs where org_id = $1 and kind = 'discovery.stale'`, [w.e.org])).length).toBe(0);
  }, 300_000);
});
