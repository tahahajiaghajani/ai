// Access around the discovery module (design A §14.5, §17). DA1 part 2: the guard on a connector's own CMDB data source
// (§8.1) — its kind and its deletion are refused, its priority stays above manual priority unless the connector's
// «معتبرتر از ویرایش دستی» is on, everything else stays editable — on the record API and on a Windows app's push alike;
// the module's own trusted writes pass. DA1 part 3 adds the connector's field guard, re-authentication, the routes'
// rights and the desktop refusal here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { updateIn } from "@server/engine";
import { ownedSourceMessage } from "@server/modules/discovery/precedence";
import { discoveryWorld, type DiscoveryWorld } from "./discovery-helpers";
import { mountMocks } from "./mocks/discovery/harness";
import { REST_CONNECTOR } from "./mocks/discovery/rest";

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
