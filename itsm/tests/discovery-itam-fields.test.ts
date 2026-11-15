// Fields people and ITAM own (design A §8.3, acceptance of DA1): a connector that reports a different holder, place,
// tag and serial for a CI linked to an asset changes neither the CI's ITAM-held values nor the asset; the hints land in
// the CI's attrs.reported_* and the item opens a mismatch (the queue's «ناهمخوانی»). After `syncCi` writes an asset's
// serial (stamped with ITAM's provenance), a different tool serial does not overwrite it. «نادیده گرفتن» holds until
// the reported values change; «به‌روزرسانی دارایی با مقدار ابزار» writes the asset as the person; the daily digest
// tells of new mismatches once.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@server/context";
import { seedItamDefaults } from "@server/modules/itam";
import { applyMismatch, dismissMismatch, mismatchDigest, refreshMismatches } from "@server/modules/discovery/mismatch";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, REST_CONNECTOR, RestMock } from "./mocks/discovery/rest";

describe("fields people and ITAM own (design A §8.3)", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  let owner: Ctx;
  let a: { userId: string; email: string };
  let b: { userId: string; email: string };
  let vanak: string;
  let tajrish: string;
  let tajrishRoom: string;
  let laptop: string;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
    owner = await w.e.ctxOf(w.e.ownerId);
    const ma = await w.e.member("member", "ali.rezaei@bank.test");
    const mb = await w.e.member("member", "sara.ahmadi@bank.test");
    a = { userId: ma.userId, email: "ali.rezaei@bank.test" };
    b = { userId: mb.userId, email: "sara.ahmadi@bank.test" };
    vanak = (await w.e.owner.post(`${w.P}/r/location`, { name: "شعبهٔ ونک", code: "BR-101", kind: "site" })).row.id;
    tajrish = (await w.e.owner.post(`${w.P}/r/location`, { name: "شعبهٔ تجریش", code: "BR-102", kind: "site" })).row.id;
    tajrishRoom = (await w.e.owner.post(`${w.P}/r/location`, { name: "اتاق سرور تجریش", code: "BR-102-SRV", kind: "room", parent_id: tajrish })).row.id;
    laptop = (await w.e.owner.post(`${w.P}/r/asset_model/query`, { filter: { f: "name", op: "eq", v: "لنوو ThinkPad E14 Gen 5" }, size: 1 })).rows[0].id;
  }, 240_000);
  afterAll(() => unmount?.());

  const mapping = { ...REST_CONNECTOR.mapping, "reported.user": "$.user", "reported.location": "$.site", "reported.asset_tag": "$.tag" };
  const ci = (id: string) => w.one(`select serial_number, asset_tag, location_id, used_by, attrs, attr_meta from sm_cis where id = $1`, [id]);
  const asset = (id: string) => w.one(`select serial_number, asset_tag, location_id, assigned_to from sm_assets where id = $1`, [id]);
  const item = (connectorId: string) => w.one(`select * from sm_discovery_items where connector_id = $1`, [connectorId]);

  it("keeps the CI's ITAM values and the asset, puts the hints in attrs.reported_*, opens a mismatch; ITAM's serial is never overwritten", async () => {
    const [device] = makeDevices(1, { from: 700_000 });
    const mock = new RestMock([{ ...device, user: a.email, site: "BR-101" } as never]);
    hosts["itam.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع دارایی‌ها", base_url: "https://itam.mock.test/", mapping });
    await w.pass(c.id);
    const first = await item(c.id);
    expect(first).toMatchObject({ state: "linked", mismatch_state: "none" });
    // the asset register: A holds it at Vanak; its tag is the register's
    const made = (await w.e.owner.post(`${w.P}/r/asset`, { model_id: laptop, state: "in_use", assigned_to: a.userId, location_id: vanak, ci_id: first.ci_id })).row;
    await w.drain();
    const tag = (await asset(made.id)).asset_tag as string;
    expect(tag).toBeTruthy();
    const linkedCi = await ci(first.ci_id);
    expect(linkedCi).toMatchObject({ used_by: a.userId, location_id: vanak, asset_tag: tag });
    // ITAM's provenance on the values the asset decides
    for (const f of ["used_by", "location_id", "asset_tag"]) expect(linkedCi.attr_meta[f], f).toMatchObject({ src: "manual", by: null });
    // the tool says B holds it at Tajrish under another tag
    mock.devices[0] = { ...mock.devices[0], user: "BANK\\sara.ahmadi", site: "BR-102", tag: "TAG-TOOL-9" } as never;
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ updated: 1, failed: 0 });
    const after = await ci(first.ci_id);
    expect(after).toMatchObject({ used_by: a.userId, location_id: vanak, asset_tag: tag });
    expect(after.attrs).toMatchObject({ reported_user: "BANK\\sara.ahmadi", reported_location: "BR-102", reported_asset_tag: "TAG-TOOL-9" });
    expect(await asset(made.id)).toMatchObject({ assigned_to: a.userId, location_id: vanak, asset_tag: tag });
    const open = await item(c.id);
    expect(open.mismatch_state).toBe("open");
    const fields = Object.fromEntries((open.mismatch.entries as Row[]).map((e) => [e.field, e]));
    expect(fields.assigned_to).toMatchObject({ target: "asset", reported: "BANK\\sara.ahmadi", resolved: b.userId, held: a.userId });
    expect(fields.location_id).toMatchObject({ target: "asset", reported: "BR-102", resolved: tajrish, held: vanak });
    expect(fields.asset_tag).toMatchObject({ target: "asset", reported: "TAG-TOOL-9", held: tag });
    // the asset's serial reaches the CI with ITAM's provenance; a different tool serial does not overwrite it
    await w.e.owner.patch(`${w.P}/r/asset/${made.id}`, { serial_number: "ASSET-SN-1" });
    await w.drain();
    const synced = await ci(first.ci_id);
    expect(synced.serial_number).toBe("ASSET-SN-1");
    expect(synced.attr_meta.serial_number).toMatchObject({ src: "manual" });
    mock.devices[0] = { ...mock.devices[0], serial: "TOOL-SN-2" } as never;
    const third = await w.pass(c.id);
    expect(third.run).toMatchObject({ failed: 0 });
    expect((await ci(first.ci_id)).serial_number).toBe("ASSET-SN-1");
    expect((await asset(made.id)).serial_number).toBe("ASSET-SN-1");
    const serial = ((await item(c.id)).mismatch.entries as Row[]).find((e) => e.field === "serial_number");
    expect(serial).toMatchObject({ target: "asset", reported: "TOOL-SN-2", held: "ASSET-SN-1" });
  }, 300_000);

  it("a place in the asset's lineage is no mismatch; a CI without an asset has none", async () => {
    const devices = makeDevices(2, { from: 710_000 });
    const mock = new RestMock([{ ...devices[0], site: "BR-102" }, { ...devices[1], site: "BR-101", user: b.email }] as never);
    hosts["lineage.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع مکان‌ها", base_url: "https://lineage.mock.test/", mapping });
    await w.pass(c.id);
    const [first, second] = await w.q(`select * from sm_discovery_items where connector_id = $1 order by external_id`, [c.id]);
    // the asset sits in a room of Tajrish; the tool names the branch above it
    await w.e.owner.post(`${w.P}/r/asset`, { model_id: laptop, state: "in_use", assigned_to: a.userId, location_id: tajrishRoom, ci_id: first.ci_id });
    await w.drain();
    mock.devices[0] = { ...mock.devices[0], os: "Windows 11" } as never;
    mock.devices[1] = { ...mock.devices[1], os: "Windows 11" } as never;
    await w.pass(c.id);
    const items = await w.q(`select external_id, mismatch_state, mismatch from sm_discovery_items where connector_id = $1 order by external_id`, [c.id]);
    expect(items.map((i) => i.mismatch_state)).toEqual(["none", "none"]);
    void second;
  }, 300_000);

  it("«نادیده گرفتن» holds until the reported values change; «به‌روزرسانی دارایی با مقدار ابزار» writes the asset as the person; the digest tells once", async () => {
    const [device] = makeDevices(1, { from: 720_000 });
    const mock = new RestMock([{ ...device, user: a.email, site: "BR-101" } as never]);
    hosts["settle.mock.test"] = mock.handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع رسیدگی", base_url: "https://settle.mock.test/", mapping, owner_id: w.e.ownerId });
    await w.pass(c.id);
    const linked = await item(c.id);
    const made = (await w.e.owner.post(`${w.P}/r/asset`, { model_id: laptop, state: "in_use", assigned_to: a.userId, location_id: vanak, ci_id: linked.ci_id, managed_by: b.userId })).row;
    await w.drain();
    mock.devices[0] = { ...mock.devices[0], site: "BR-102" } as never;
    await w.pass(c.id);
    expect((await item(c.id)).mismatch_state).toBe("open");
    // the digest: once, whatever the number of runs
    await w.q(`delete from sm_jobs where org_id = $1 and kind = 'notify.batch'`, [w.e.org]);
    expect(await mismatchDigest(w.e.db, w.e.org)).toBeGreaterThanOrEqual(1);
    const batches = await w.q(`select payload from sm_jobs where org_id = $1 and kind = 'notify.batch' and payload -> 'ev' ->> 'id' = $2`, [w.e.org, c.id]);
    expect(batches.length).toBe(1);
    expect(JSON.stringify(batches[0].payload)).toContain("ناهمخوانی تازه میان ابزارها و دفتر اموال");
    // the connector's owner and the asset's manager
    expect((batches[0].payload.people as Row[]).map((p) => p.user).sort()).toEqual([w.e.ownerId, b.userId].sort());
    expect(await mismatchDigest(w.e.db, w.e.org)).toBe(0);
    // dismissed: an unrelated change keeps it dismissed, a new reported value opens it again
    expect(await dismissMismatch(owner, linked.id)).toEqual({ state: "dismissed" });
    mock.devices[0] = { ...mock.devices[0], os: "Ubuntu 24.04" } as never;
    await w.pass(c.id);
    expect((await item(c.id)).mismatch_state).toBe("dismissed");
    mock.devices[0] = { ...mock.devices[0], site: "BR-102-SRV" } as never;
    await w.pass(c.id);
    expect((await item(c.id)).mismatch_state).toBe("open");
    // a person without rights on the asset cannot settle it
    const outsider = await w.e.member("member", "outsider@bank.test");
    await expect(applyMismatch(await w.e.ctxOf(outsider.userId), linked.id, "location_id")).rejects.toThrow(/مدیر دارایی/);
    // the asset takes the tool's place, as a write of the person (the CI follows through ITAM's sync)
    expect(await applyMismatch(owner, linked.id, "location_id")).toMatchObject({ applied: "location_id", asset_id: made.id });
    await w.drain();
    expect((await asset(made.id)).location_id).toBe(tajrishRoom);
    expect((await ci(linked.ci_id)).location_id).toBe(tajrishRoom);
    expect(await item(c.id)).toMatchObject({ mismatch_state: "none", mismatch: null });
    // a difference settled by hand elsewhere is cleared by the daily look
    mock.devices[0] = { ...mock.devices[0], tag: "TAG-SETTLE" } as never;
    await w.pass(c.id);
    expect((await item(c.id)).mismatch_state).toBe("open");
    // (the asset's own write; the connector's ladder, queued by the pass, would look again as well)
    await w.e.owner.patch(`${w.P}/r/asset/${made.id}`, { asset_tag: "TAG-SETTLE" });
    expect(await refreshMismatches(w.e.db, w.e.org, c.id)).toBe(1);
    expect((await item(c.id)).mismatch_state).toBe("none");
  }, 300_000);
});
