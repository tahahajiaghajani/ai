// Bank ITAM on a Windows app linked to the web version (src/server/modules/itam/bank.ts «the ledgers on a Windows
// app's push»): what the app records of an asset — moved from one branch to another and back (A→B→A), an ATM's status
// changed and changed back — reaches the server through the real sync client and is taken there as a whole: the custody
// links chained in event order, numbered, dated and signed with the server's key (the app's own signatures never stand);
// the status periods dated within the push's bounds, the device's status change time decided by the server. After the
// next pull the app holds exactly the server's chain.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge, ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { seedItamDefaults } from "@server/modules/itam";
import { CONTACT_SLACK_MS } from "@server/modules/itam/bank";

const EMAIL = "itam-desk@example.com";
const PASSWORD = "itam-desk-pass-1405";

describe("custody and device status recorded on a Windows app", () => {
  let cloudDb: Db;
  let deskDb: Db;
  let web: Client;
  let local: Client;
  let client: SyncClient;
  let org = "";
  let P = "";
  const unit: Record<string, string> = {};
  let laptop = "";
  let atmModel = "";

  const custody = (db: Db, asset: string) => db.query<Record<string, any>>(`select id, seq, event, branch_id, from_branch_id, actor_id, prev_hash, hash from sm_asset_custody where asset_id = $1 and deleted_at is null order by seq`, [asset]);
  const idOf = async (c: Client, table: string, field: string, v: string) => (await c.post(`${P}/r/${table}/query`, { filter: { f: field, op: "eq", v }, size: 1 })).rows[0].id as string;

  beforeAll(async () => {
    const cloudSrv = await makeServer({ mode: "cloud" });
    cloudDb = cloudSrv.db;
    const cloudCfg: ServerConfig = { mode: "cloud", db: cloudDb, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    const bridge = { notifyLocalWrite() {}, fetchBlob: (o: string, a: string) => client.fetchBlob(o, a), syncStatus: async () => ({ linked: true }) } as unknown as DesktopBridge;
    const deskSrv = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
    deskDb = deskSrv.db;
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => cloudSrv.app.fetch(new Request(String(u), init))) as typeof fetch;
    web = new Client(cloudSrv.app, "http://cloud.test");
    await web.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مدیر اموال" });
    org = (await web.post<{ id: string }>("/orgs", { name: "بانک آزمون هم‌گامی", timezone: "Asia/Tehran" })).id;
    P = `/o/${org}`;
    await seedItamDefaults(cloudCfg, org);
    const mk = async (name: string, parent: string | null, extra: Record<string, unknown> = {}) => (await web.post(`${P}/r/org_unit`, { name, parent_id: parent, ...extra })).row.id as string;
    unit.bank = await mk("بانک آزمون", null, { kind: "company" });
    unit.a = await mk("شعبهٔ الف", unit.bank, { kind: "branch", code: "3001" });
    unit.b = await mk("شعبهٔ ب", unit.bank, { kind: "branch", code: "3002" });
    laptop = await idOf(web, "asset_model", "name", "لنوو ThinkPad E14 Gen 5");
    atmModel = await idOf(web, "asset_model", "name", "ان‌سی‌آر SelfServ 22e (خودپرداز)");
    client = new SyncClient({ db: deskDb, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
    await client.link({ url: "http://cloud.test", email: EMAIL, password: PASSWORD, orgId: org, direction: "download" });
    local = new Client(deskSrv.app, "http://desk.test");
    await local.post("/auth/login", { email: EMAIL, password: PASSWORD });
  }, 600_000);

  it("takes an asset moved A→B→A on the app as one chain, in event order, signed by the server", async () => {
    const asset = (await web.post(`${P}/r/asset`, { model_id: laptop, state: "in_use", branch_id: unit.a, department_id: unit.a, serial_number: "DESK-ABA" })).row;
    await client.syncNow();
    const seen = await custody(cloudDb, asset.id);
    expect(seen.map((r) => r.event)).toEqual(["registered"]);
    // on the Windows app: the register moved to branch B, then back to A
    const v1 = (await local.get(`${P}/r/asset/${asset.id}`)).row.version;
    await local.patch(`${P}/r/asset/${asset.id}`, { branch_id: unit.b, version: v1 });
    const v2 = (await local.get(`${P}/r/asset/${asset.id}`)).row.version;
    await local.patch(`${P}/r/asset/${asset.id}`, { branch_id: unit.a, version: v2 });
    const onApp = await custody(deskDb, asset.id);
    expect(onApp.map((r) => [r.event, r.from_branch_id, r.branch_id])).toEqual([["registered", null, unit.a], ["branch_changed", unit.a, unit.b], ["branch_changed", unit.b, unit.a]]);
    await client.syncNow();
    await client.refreshPending();
    expect(client.state.failed).toEqual([]);
    const chain = await web.get(`${P}/itam/assets/${asset.id}/custody`);
    expect(chain.verified).toEqual({ rows: 3, ok: true, broken_at: null });
    expect(chain.rows.map((r: any) => [r.seq, r.event, r.from_branch_id, r.branch_id])).toEqual([[1, "registered", null, unit.a], [2, "branch_changed", unit.a, unit.b], [3, "branch_changed", unit.b, unit.a]]);
    expect(chain.rows.map((r: any) => r.id)).toEqual(onApp.map((r) => r.id));
    const [, r2, r3] = chain.rows;
    expect([r2.prev_hash, r3.prev_hash]).toEqual([chain.rows[0].hash, r2.hash]);
    for (const r of [r2, r3]) expect(r.hash).toMatch(/^k1:[0-9a-f]{64}$/);
    expect(Date.parse(r2.at)).toBeLessThanOrEqual(Date.parse(r3.at));
    // the app's own signatures never stand: the server signed the rows with its key
    expect(r2.hash).not.toBe(onApp[1].hash);
    // the next pull gives the app the server's chain, exactly
    await client.syncNow();
    expect((await custody(deskDb, asset.id)).map((r) => [r.id, r.seq, r.prev_hash, r.hash])).toEqual(chain.rows.map((r: any) => [r.id, Number(r.seq), r.prev_hash ?? null, r.hash]));
  });

  it("dates an ATM's status changed and changed back on the app within the push's bounds", async () => {
    const atm = (await web.post(`${P}/r/asset`, { model_id: atmModel, state: "in_use", branch_id: unit.a, department_id: unit.a, serial_number: "DESK-ATM", terminal_id: "30010001" })).row;
    await client.syncNow();
    const t0 = Date.now();
    await local.post(`${P}/itam/fleet/${atm.id}/status`, { status: "out_of_cash" });
    await local.post(`${P}/itam/fleet/${atm.id}/status`, { status: "in_service" });
    const appAt = Date.parse((await deskDb.one<{ device_status_at: string }>(`select device_status_at from sm_assets where id = $1`, [atm.id]))!.device_status_at);
    await client.syncNow();
    await client.refreshPending();
    expect(client.state.failed).toEqual([]);
    const periods = (await web.post(`${P}/r/device_status_event/query`, { filter: { f: "asset_id", op: "eq", v: atm.id }, sort: "from_at", size: 10 })).rows;
    expect(periods.map((x: any) => x.status)).toEqual(["in_service", "out_of_cash", "in_service"]);
    // contiguous, the last one open, from the device's change time as the server took it — the app's own, within bounds
    expect(periods[0].to_at).toBe(periods[1].from_at);
    expect(periods[1].to_at).toBe(periods[2].from_at);
    expect(periods[2].to_at).toBeNull();
    const at = Date.parse((await web.get(`${P}/r/asset/${atm.id}`)).row.device_status_at);
    expect(Date.parse(periods[2].from_at)).toBe(at);
    expect(at).toBeGreaterThanOrEqual(t0 - CONTACT_SLACK_MS);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(Math.abs(at - appAt)).toBeLessThan(1000);
  });

  // review R-a-1: the outbox is pushed in pages of 200 rows by the time each row changed; an ATM's change and back
  // shares that time with its asset row, so a full page can cut them apart — the asset row first, or the periods first
  for (const order of ["the asset row", "the periods"] as const) {
    it(`keeps an outage recorded offline when a full outbox page sends ${order} a request ahead`, async () => {
      const iso = (ms: number) => new Date(ms).toISOString();
      const tag = order === "the asset row" ? "1" : "2";
      const atm = (await web.post(`${P}/r/asset`, { model_id: atmModel, state: "in_use", branch_id: unit.a, department_id: unit.a, serial_number: `DESK-PAGE-${tag}`, terminal_id: `3001000${tag}0` })).row;
      // registered long ago, in service for two hours
      const T0 = Date.now() - 2 * 3_600_000;
      await cloudDb.query(`update sm_device_status_events set from_at = $2 where asset_id = $1`, [atm.id, iso(T0)]);
      await cloudDb.query(`update sm_assets set device_status_at = $2, created_at = $3 where id = $1`, [atm.id, iso(T0), iso(T0 - 86_400_000)]);
      await client.syncNow();
      // the app's last contact an hour ago; offline since, it recorded «بدون وجه نقد» 30 minutes ago and «در سرویس»
      // again 10 minutes ago
      await cloudDb.query(`update sm_devices set last_pull_at = $2 where org_id = $1`, [org, iso(Date.now() - 3_600_000)]);
      await local.post(`${P}/itam/fleet/${atm.id}/status`, { status: "out_of_cash" });
      await local.post(`${P}/itam/fleet/${atm.id}/status`, { status: "in_service" });
      const out = Date.now() - 30 * 60_000;
      const back = Date.now() - 10 * 60_000;
      const [O, P1, P2] = await deskDb.query<{ id: string }>(`select id from sm_device_status_events where asset_id = $1 order by from_at, created_at`, [atm.id]);
      await deskDb.query(`update sm_device_status_events set to_at = $2, minutes = 90 where id = $1`, [O.id, iso(out)]);
      await deskDb.query(`update sm_device_status_events set from_at = $2, to_at = $3, minutes = 20 where id = $1`, [P1.id, iso(out), iso(back)]);
      await deskDb.query(`update sm_device_status_events set from_at = $2 where id = $1`, [P2.id, iso(back)]);
      await deskDb.query(`update sm_assets set device_status_at = $2 where id = $1`, [atm.id, iso(back)]);
      // the page: whatever else waits goes first, then rows of rows already gone (counted, never sent) up to the cut
      const ids = (xs: string[]) => `{${xs.join(",")}}`;
      const mine = [O.id, P1.id, P2.id, atm.id];
      const first = order === "the asset row" ? [O.id, atm.id] : [O.id, P1.id, P2.id];
      await deskDb.query(`update sm_outbox set changed_at = now() - interval '2 days' where not (id = any($1::uuid[]))`, [ids(mine)]);
      await deskDb.query(`update sm_outbox set changed_at = now() - interval '2 minutes' where id = any($1::uuid[])`, [ids(first)]);
      await deskDb.query(`update sm_outbox set changed_at = now() - interval '1 minute' where id = any($1::uuid[]) and not (id = any($2::uuid[]))`, [ids(mine), ids(first)]);
      const others = (await deskDb.one<{ n: number }>(`select count(*)::int as n from sm_outbox where not (id = any($1::uuid[]))`, [ids(mine)]))!.n;
      await deskDb.query(`insert into sm_outbox (entity, id, changed_at) select 'asset', gen_random_uuid(), now() - interval '1 day' from generate_series(1, $1::int)`, [200 - others - first.length]);
      await client.syncNow();
      await client.refreshPending();
      expect(client.state.failed).toEqual([]);
      expect(client.state.pending).toBe(0);
      // the server's history: in service until the outage began, 20 minutes without cash, in service again since
      expect(Date.parse((await web.get(`${P}/r/asset/${atm.id}`)).row.device_status_at)).toBe(back);
      const periods = (await web.post(`${P}/r/device_status_event/query`, { filter: { f: "asset_id", op: "eq", v: atm.id }, sort: "from_at", size: 10 })).rows;
      expect(periods.map((x: any) => [x.id, x.status, Date.parse(x.from_at), x.to_at ? Date.parse(x.to_at) : null, x.minutes ?? null])).toEqual([
        [O.id, "in_service", T0, out, 90], [P1.id, "out_of_cash", out, back, 20], [P2.id, "in_service", back, null, null],
      ]);
    });
  }
});
