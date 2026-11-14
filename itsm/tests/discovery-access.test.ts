// Access around the discovery module (design A §14.5, §17). DA1 part 2: the guard on a connector's own CMDB data source
// (§8.1) — its kind and its deletion are refused, its priority stays above manual priority unless the connector's
// «معتبرتر از ویرایش دستی» is on, everything else stays editable — on the record API and on a Windows app's push alike;
// the module's own trusted writes pass. DA1 part 3: the connector's guard (only CMDB administrators create and change;
// an owner changes only «فعال», the schedules and the description — on the record API, the routes and an AI tool),
// re-authentication and journal lines, the routes' rights (requesters see nothing; test and run for administrators
// and owners; preview for administrators, raw JSON for tenant administrators), the soft delete, the directory
// approval, the unencrypted tick on the server edition and the Windows app's refusal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { createIn, updateIn } from "@server/engine";
import { installDiscoveryModule } from "@server/modules/discovery";
import { ADMIN_ONLY_MESSAGE, ASSET_ONLY_MESSAGE, OWNER_ONLY_MESSAGE, SOFTWARE_ONLY_MESSAGE } from "@server/modules/discovery/guard";
import { CONNECTOR_MESSAGES } from "@server/modules/discovery/kind";
import { ownedSourceMessage } from "@server/modules/discovery/precedence";
import { DIRECTORY_MESSAGE, OPERATOR_MESSAGE, READ_MESSAGE } from "@server/modules/discovery/service";
import { discoveryWorld, type DiscoveryWorld } from "./discovery-helpers";
import { engineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock } from "./mocks/discovery/rest";

describe("the guard on a connector's own data source (design A §8.1)", () => {
  let w: DiscoveryWorld;
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks({});
  }, 180_000);
  afterAll(() => unmount?.());

  const source = (id: string) => w.one(`select * from sm_cmdb_sources where id = $1`, [id]);
  const errorOf = (body: unknown) => JSON.stringify(body);

  /** A stored row in the shape a Windows app pushes it, with `patch` and a later stamp. */
  async function pushed(id: string, patch: Record<string, unknown>): Promise<{ status: string; message?: string }> {
    const r = await source(id);
    const row = { ...JSON.parse(JSON.stringify(r)), ...patch, updated_at: new Date(Date.now() + 5_000).toISOString() };
    return (await w.e.owner.post(`/sync/push`, { org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: "cmdb_data_source", id, base_rev: Number(r.rev), row }] })).results[0];
  }

  it("refuses the kind and the deletion, keeps the priority above manual priority, leaves the rest editable", async () => {
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع نگهبانی" });
    const src = await source(c.source_id);
    expect(src).toMatchObject({ kind: "connector", priority: 90 });
    const message = ownedSourceMessage("منبع نگهبانی");
    // the record API (a tenant administrator, who is a CMDB administrator too)
    expect(errorOf(await w.e.owner.patch(`${w.P}/r/cmdb_data_source/${src.id}`, { kind: "file" }, 400))).toContain(message);
    expect(errorOf(await w.e.owner.del(`${w.P}/r/cmdb_data_source/${src.id}`, 403))).toContain(message);
    expect(errorOf(await w.e.owner.patch(`${w.P}/r/cmdb_data_source/${src.id}`, { priority: 20 }, 400))).toContain("اولویت ویرایش دستی");
    expect(errorOf(await w.e.owner.patch(`${w.P}/r/cmdb_data_source/${src.id}`, { priority: 5 }, 400))).toContain("معتبرتر از ویرایش دستی");
    const edited = (await w.e.owner.patch(`${w.P}/r/cmdb_data_source/${src.id}`, { name: "Zabbix مرکز داده", description: "پایش مرکز داده", stale_after_days: 10, priority: 35 })).row;
    expect(edited).toMatchObject({ name: "Zabbix مرکز داده", stale_after_days: 10, priority: 35, kind: "connector" });
    expect(await source(src.id)).toMatchObject({ kind: "connector", deleted_at: null });
    // the connector's «معتبرتر از ویرایش دستی» lets its source outrank hand entries
    await w.update(c.id, { over_manual: true });
    expect((await w.e.owner.patch(`${w.P}/r/cmdb_data_source/${src.id}`, { priority: 10 })).row.priority).toBe(10);
    // the module's own trusted writes pass (a connector's soft delete sets its source inactive)
    await w.sys.write((tx) => updateIn(tx, w.sys, "cmdb_data_source", src.id, { active: false }, { trusted: true }));
    expect((await source(src.id)).active).toBe(false);
    // a source whose connector is gone is an ordinary source again
    await w.q(`update sm_discovery_connectors set deleted_at = now() where id = $1`, [c.id]);
    expect((await w.e.owner.patch(`${w.P}/r/cmdb_data_source/${src.id}`, { kind: "file" })).row.kind).toBe("file");
  });

  it("holds for a Windows app's push, which runs no beforeWrite", async () => {
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع همگام" });
    const message = ownedSourceMessage("منبع همگام");
    const kind = await pushed(c.source_id, { kind: "file" });
    expect(kind).toMatchObject({ status: "error" });
    expect(kind.message).toContain(message);
    const priority = await pushed(c.source_id, { priority: 15 });
    expect(priority.status).toBe("error");
    const gone = await pushed(c.source_id, { deleted_at: new Date().toISOString() });
    expect(gone.status).toBe("error");
    expect(gone.message).toContain(message);
    expect(await source(c.source_id)).toMatchObject({ kind: "connector", priority: 90, deleted_at: null });
    const renamed = await pushed(c.source_id, { name: "منبع همگام (تغییر نام)" });
    expect(renamed.status).not.toBe("error");
    expect((await source(c.source_id)).name).toBe("منبع همگام (تغییر نام)");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// DA1 part 3: the connector guard, re-authentication, the routes' rights, the Windows app (§14.5, §14.7)

type Person = { client: Client; userId: string };

/** People of an organisation with built-in roles: a configuration manager (CMDB administrator), an asset manager, an agent, a requester. */
async function staff(w: DiscoveryWorld): Promise<Record<"cm" | "am" | "agent" | "req", Person>> {
  const out = {} as Record<"cm" | "am" | "agent" | "req", Person>;
  const roles = { cm: "configuration_manager", am: "asset_manager", agent: "agent", req: "requester" } as const;
  for (const k of Object.keys(roles) as (keyof typeof roles)[]) {
    out[k] = await w.e.member("member", `${k}-${w.e.org.slice(0, 6)}@example.com`);
    await w.e.owner.put(`${w.P}/access/members/${out[k].userId}`, { roles: [roles[k]], persona: k === "req" ? "requester" : "agent" });
  }
  return out;
}

const ageSessions = (w: DiscoveryWorld, userId: string) => w.q(`update sm_sessions set reauth_at = now() - interval '3 hours', created_at = now() - interval '3 hours' where user_id = $1`, [userId]);
const freshSessions = (w: DiscoveryWorld, userId: string) => w.q(`update sm_sessions set reauth_at = now() where user_id = $1`, [userId]);
const errorOf = (r: any) => String(r?.error?.message ?? "");
const journalOf = (w: DiscoveryWorld, id: string) => w.q<{ body: string }>(`select body from sm_journal where table_key = 'discovery_connector' and record_id = $1 order by created_at`, [id]);

describe("who may do what with connectors (design A §14.5)", () => {
  let w: DiscoveryWorld;
  let p: Record<"cm" | "am" | "agent" | "req", Person>;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
    p = await staff(w);
  }, 240_000);
  afterAll(() => unmount?.());

  it("only CMDB administrators create, change and delete; an owner changes only «فعال», the schedules and the description — on the record API, the routes and an AI tool", async () => {
    const P = w.P;
    const data = { ...REST_CONNECTOR, name: "منبع مجوزها", base_url: "https://perm.mock.test/" };
    // an asset manager (who may create CMDB records), an agent and a requester may not make one
    expect(errorOf(await p.am.client.post(`${P}/r/discovery_connector`, data, 403))).toBe(ADMIN_ONLY_MESSAGE);
    expect(errorOf(await p.am.client.post(`${P}/discovery/connectors`, data, 403))).toBe(ADMIN_ONLY_MESSAGE);
    await p.agent.client.post(`${P}/r/discovery_connector`, data, 403);
    await p.req.client.post(`${P}/discovery/connectors`, data, 403);
    // a CMDB administrator does
    const made = await p.cm.client.post(`${P}/discovery/connectors`, data, 201);
    expect(made.row).toMatchObject({ name: "منبع مجوزها", kind: "rest", secret: { secret: true, hint: "…" } });
    // the asset manager owns another one
    const c = await w.connector({ ...data, name: "منبع مسئول", owner_id: p.am.userId });
    for (const patch of [{ base_url: "https://other.mock.test/" }, { hosts: ["ui.mock.test"] }, { secret: "stolen" }, { create_policy: "match_only" }, { mapping: { external_id: "$.id", name: "$.name" } }, { owner_id: p.agent.userId }]) {
      expect([Object.keys(patch)[0], errorOf(await p.am.client.patch(`${P}/r/discovery_connector/${c.id}`, patch, 403))]).toEqual([Object.keys(patch)[0], OWNER_ONLY_MESSAGE]);
    }
    expect(errorOf(await p.am.client.patch(`${P}/discovery/connectors/${c.id}`, { base_url: "https://other.mock.test/" }, 403))).toBe(OWNER_ONLY_MESSAGE);
    // an AI tool writes as the person through the engine (record-executors.ts): the same guard
    const amCtx = await w.e.ctxOf(p.am.userId);
    await expect(amCtx.write((tx) => updateIn(tx, amCtx, "discovery_connector", c.id, { secret: "stolen", base_url: "https://other.mock.test/" }))).rejects.toThrow(OWNER_ONLY_MESSAGE);
    const owned = (await p.am.client.patch(`${P}/r/discovery_connector/${c.id}`, { active: false, every_minutes: 120, status_every_minutes: 0, description: "مسئول: تیم دارایی" })).row;
    expect(owned).toMatchObject({ active: false, every_minutes: 120, description: "مسئول: تیم دارایی", base_url: data.base_url });
    // «ساخت دارایی برای دستگاه‌های تازه» is the asset manager's; software collection the software manager's
    expect((await p.am.client.patch(`${P}/r/discovery_connector/${c.id}`, { make_assets: true })).row.make_assets).toBe(true);
    expect(errorOf(await p.cm.client.patch(`${P}/r/discovery_connector/${c.id}`, { make_assets: false }, 403))).toBe(ASSET_ONLY_MESSAGE);
    expect(errorOf(await p.cm.client.patch(`${P}/r/discovery_connector/${c.id}`, { collect: ["inventory", "software"] }, 403))).toBe(SOFTWARE_ONLY_MESSAGE);
    expect((await w.e.owner.patch(`${P}/r/discovery_connector/${c.id}`, { collect: ["inventory", "software"] })).row.collect).toContain("software");
    // others change nothing, and only a CMDB administrator deletes
    await p.agent.client.patch(`${P}/r/discovery_connector/${c.id}`, { active: true }, 403);
    await p.am.client.del(`${P}/r/discovery_connector/${c.id}`, 403);
    expect((await w.one(`select deleted_at from sm_discovery_connectors where id = $1`, [c.id])).deleted_at).toBeNull();
  }, 180_000);

  it("asks for re-authentication when the credentials, where they go, over_manual, the create policy or the automatic missing mark change; journals the decisions", async () => {
    const P = w.P;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع هویت", base_url: "https://auth.mock.test/" });
    await ageSessions(w, p.cm.userId);
    for (const patch of [{ secret: "new-key" }, { secret2: "second" }, { base_url: "https://elsewhere.mock.test/" }, { hosts: ["ui.mock.test"] }, { over_manual: true }, { create_policy: "review" }, { missing_action: "auto" }]) {
      const r = await p.cm.client.patch(`${P}/r/discovery_connector/${c.id}`, patch, 401);
      expect([Object.keys(patch)[0], r.error.code]).toEqual([Object.keys(patch)[0], "reauth_required"]);
    }
    // nothing sensitive: no question asked
    expect((await p.cm.client.patch(`${P}/r/discovery_connector/${c.id}`, { description: "شرح", every_minutes: 60, base_url: "https://auth.mock.test/v2/" })).row.description).toBe("شرح");
    await freshSessions(w, p.cm.userId);
    await p.cm.client.patch(`${P}/r/discovery_connector/${c.id}`, { over_manual: true, missing_action: "auto" });
    const lines = (await journalOf(w, c.id)).map((j) => j.body).join("\n");
    expect(lines).toContain("«معتبرتر از ویرایش دستی» روشن شد");
    expect(lines).toContain("علامت «مفقود» خودکار روشن شد");
    // a refused change leaves the connector as it was
    expect(await w.one(`select over_manual, missing_action, base_url from sm_discovery_connectors where id = $1`, [c.id])).toEqual({ over_manual: true, missing_action: "auto", base_url: "https://auth.mock.test/v2/" });
  }, 120_000);

  it("CMDB readers read connectors and items (the record only with field group internal); requesters see nothing; test and run are for administrators and the owner, preview for administrators, raw JSON for tenant administrators", async () => {
    const P = w.P;
    const mock = new RestMock(makeDevices(3, { from: 9100 }));
    hosts["read.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع خواندن", base_url: "https://read.mock.test/", owner_id: p.am.userId });
    await w.pass(c.id);
    const item = await w.one<{ id: string }>(`select id from sm_discovery_items where connector_id = $1 order by external_id limit 1`, [c.id]);
    expect((await p.cm.client.get(`${P}/r/discovery_item/${item.id}`)).row.data).toMatchObject({ external_id: "9100" });
    expect((await p.agent.client.get(`${P}/r/discovery_item/${item.id}`)).row.data).toMatchObject({ external_id: "9100" });
    for (const path of [`/r/discovery_item/${item.id}`, `/r/discovery_connector/${c.id}`]) {
      const status = (await w.e.app.fetch(new Request(`http://local.test/api${P}${path}`, { headers: { cookie: p.req.client.cookie } }))).status;
      expect([path, status === 403 || status === 404]).toEqual([path, true]);
    }
    for (const path of ["/discovery/meta", "/discovery/connectors", `/discovery/connectors/${c.id}`, "/discovery/queue?tab=unmatched", `/discovery/connectors/${c.id}/items`]) {
      expect([path, errorOf(await p.req.client.get(`${P}${path}`, 403))]).toEqual([path, READ_MESSAGE]);
    }
    // agents and asset managers read the cards and run history
    const cards = (await p.agent.client.get(`${P}/discovery/connectors`)).connectors;
    expect(cards.find((x: any) => x.id === c.id)).toMatchObject({ items: { total: 3, linked: 3 }, can: { edit: false, operate: false } });
    expect((await p.am.client.get(`${P}/discovery/connectors/${c.id}/runs`)).rows.length).toBe(1);
    // test and run now: CMDB administrators and the owner
    expect(errorOf(await p.agent.client.post(`${P}/discovery/connectors/${c.id}/test`, {}, 403))).toBe(OPERATOR_MESSAGE);
    expect(errorOf(await p.agent.client.post(`${P}/discovery/connectors/${c.id}/run`, {}, 403))).toBe(OPERATOR_MESSAGE);
    expect((await p.am.client.post(`${P}/discovery/connectors/${c.id}/test`, {})).ok).toBe(true);
    expect((await p.am.client.post(`${P}/discovery/connectors/${c.id}/run`, {})).queued).toBe(true);
    // preview and reapply: CMDB administrators only, refused before the tool is called
    const before = mock.requests.length;
    expect(errorOf(await p.am.client.post(`${P}/discovery/connectors/${c.id}/preview`, {}, 403))).toBe(ADMIN_ONLY_MESSAGE);
    expect(errorOf(await p.am.client.post(`${P}/discovery/connectors/${c.id}/reapply`, {}, 403))).toBe(ADMIN_ONLY_MESSAGE);
    expect(mock.requests.length).toBe(before);
    const cmPreview = await p.cm.client.post(`${P}/discovery/connectors/${c.id}/preview`, { limit: 3 });
    expect(cmPreview.rows.length).toBe(3);
    expect(cmPreview.rows.every((r: any) => r.raw === undefined && r.values)).toBe(true);
    const ownerPreview = await w.e.owner.post(`${P}/discovery/connectors/${c.id}/preview`, { limit: 3 });
    expect(ownerPreview.rows[0].raw).toMatchObject({ id: 9100 });
  }, 180_000);

  it("a delete is soft: the source goes inactive, the items stay as gone, a running pass stops, nothing is retired", async () => {
    const P = w.P;
    const mock = new RestMock(makeDevices(2, { from: 9200 }));
    hosts["gone.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع رفتنی", base_url: "https://gone.mock.test/" });
    await w.pass(c.id);
    const cis = await w.q<{ id: string; state: string }>(`select id, state from sm_cis where discovery_source_id = $1 order by id`, [c.source_id]);
    expect(cis.length).toBe(2);
    await w.q(`insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, generation) values (gen_random_uuid(), $1, $2, 'inventory', 'manual', 'running', now(), 9)`, [w.e.org, c.id]);
    await p.cm.client.del(`${P}/discovery/connectors/${c.id}`);
    expect((await w.one(`select active from sm_cmdb_sources where id = $1`, [c.source_id])).active).toBe(false);
    expect((await w.q(`select state from sm_discovery_items where connector_id = $1`, [c.id])).map((r) => r.state)).toEqual(["gone", "gone"]);
    expect((await w.q(`select state from sm_discovery_runs where connector_id = $1 and generation = 9`, [c.id]))[0].state).toBe("canceled");
    expect(await w.q<{ id: string; state: string }>(`select id, state from sm_cis where discovery_source_id = $1 order by id`, [c.source_id])).toEqual(cis);
    await p.cm.client.get(`${P}/discovery/connectors/${c.id}`, 404);
  }, 120_000);

  it("an integrations administrator approves a connector's use of a directory source, with re-authentication; a change of the source needs it again", async () => {
    const P = w.P;
    const dir = await w.sys.write((tx) => createIn(tx, w.sys, "directory_source", { name: "AD شعبه‌ها", kind: "ldap" }, { trusted: true }));
    const other = await w.sys.write((tx) => createIn(tx, w.sys, "directory_source", { name: "AD ستاد", kind: "ldap" }, { trusted: true }));
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع فهرست", base_url: "https://dir.mock.test/", directory_source_id: dir.id });
    expect(errorOf(await p.cm.client.post(`${P}/discovery/connectors/${c.id}/approve-directory`, {}, 403))).toBe(DIRECTORY_MESSAGE);
    await ageSessions(w, w.e.ownerId);
    expect((await w.e.owner.post(`${P}/discovery/connectors/${c.id}/approve-directory`, {}, 401)).error.code).toBe("reauth_required");
    await freshSessions(w, w.e.ownerId);
    await w.e.owner.post(`${P}/discovery/connectors/${c.id}/approve-directory`, {});
    expect(await w.one(`select directory_approved_by from sm_discovery_connectors where id = $1`, [c.id])).toEqual({ directory_approved_by: w.e.ownerId });
    expect((await journalOf(w, c.id)).map((j) => j.body).join("\n")).toContain("«AD شعبه‌ها» تأیید شد");
    await p.cm.client.patch(`${P}/r/discovery_connector/${c.id}`, { directory_source_id: other.id });
    expect(await w.one(`select directory_approved_by, directory_approved_at from sm_discovery_connectors where id = $1`, [c.id])).toEqual({ directory_approved_by: null, directory_approved_at: null });
  }, 120_000);
});

describe("server edition: the unencrypted tick needs re-authentication and is journaled (design A §14.1, §14.6)", () => {
  let w: DiscoveryWorld;
  beforeAll(async () => {
    const server = { health: async () => ({}), info: () => ({ air_gapped: true, public_url: "", directory_path: "" }), allow: async () => ({ allow: [] }) };
    w = await discoveryWorld({ config: { server, network: { lan: true, airGapped: true, allow: ["zbx.bank.local"] } } });
  }, 180_000);

  it("plain http only with the tick, which a recent proof of identity allows; the card shows it", async () => {
    const P = w.P;
    const made = (await w.e.owner.post(`${P}/discovery/connectors`, { ...REST_CONNECTOR, name: "Zabbix بی‌رمز", base_url: "https://zbx.bank.local/" }, 201)).row;
    expect(errorOf(await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { base_url: "http://zbx.bank.local/" }, 400))).toBe(CONNECTOR_MESSAGES.plainHttp);
    await ageSessions(w, w.e.ownerId);
    expect((await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { base_url: "http://zbx.bank.local/", plain_http: true }, 401)).error.code).toBe("reauth_required");
    await freshSessions(w, w.e.ownerId);
    expect((await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { base_url: "http://zbx.bank.local/", plain_http: true })).row.plain_http).toBe(true);
    expect((await journalOf(w, made.id)).map((j) => j.body).join("\n")).toContain("«اتصال بدون رمزنگاری (فقط شبکهٔ داخلی)» روشن شد");
    expect((await w.e.owner.get(`${P}/discovery/connectors`)).connectors.find((x: any) => x.id === made.id)).toMatchObject({ plain_http: true });
  }, 120_000);
});

describe("the Windows app neither configures nor shows connectors (design A §14.7)", () => {
  it("refuses the module's routes and connector writes with the documented message", async () => {
    installDiscoveryModule();
    const e = await engineOrg({ mode: "desktop" });
    const P = `/o/${e.org}`;
    for (const path of ["/discovery/meta", "/discovery/connectors", "/discovery/queue"]) {
      expect([path, errorOf(await e.owner.get(`${P}${path}`, 403))]).toEqual([path, CONNECTOR_MESSAGES.desktop]);
    }
    expect(errorOf(await e.owner.post(`${P}/r/discovery_connector`, { ...REST_CONNECTOR, name: "منبع رومیزی" }, 403))).toBe(CONNECTOR_MESSAGES.desktop);
    expect(CONNECTOR_MESSAGES.desktop).toBe("منبع‌های داده و وضعیت پایش روی سرور اجرا و دیده می‌شوند");
  }, 120_000);
});
