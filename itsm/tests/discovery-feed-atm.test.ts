// An ATM switch export read by the feed reaches the bank's device_status through the status upkeep (design A §6.6,
// §9.5): the seam between the feed kind and the ATM device path — matched by terminal id, two passes, the hold, the
// period named after the source.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIn } from "@server/engine";
import { seedItamDefaults } from "@server/modules/itam";
import { applyDevice } from "@server/modules/discovery/device";
import { ensureDropFolder, installDropRoot } from "@server/modules/discovery/drop";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { ATM_COLUMNS, atmRows, dropFile, toCsv } from "./mocks/discovery/feed";

describe("an ATM switch export through the feed (design A §6.6, §9.5)", () => {
  let w: DiscoveryWorld;
  let base: string;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "kariz-feed-atm-"));
    installDropRoot(join(base, "drop"));
    const server = { health: async () => ({}), info: () => ({ air_gapped: true, public_url: "", directory_path: "" }), allow: async () => ({ allow: [] }) };
    w = await discoveryWorld({ config: { server, network: { lan: true, airGapped: true, allow: [] } } });
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
  }, 240_000);
  afterAll(async () => {
    installDropRoot(null);
    await rm(base, { recursive: true, force: true });
  });

  it("matches the ATM by its terminal id and applies the switch's word after two passes and the hold", async () => {
    const model = (await w.e.owner.post(`${w.P}/r/asset_model/query`, { filter: { f: "category", op: "eq", v: "atm" }, size: 1 })).rows[0].id;
    const atm = await w.sys.write((tx) => createIn(tx, w.sys, "asset", { model_id: model, state: "in_use", terminal_id: "T00001" }, { trusted: true }));
    const c = await w.connector({
      kind: "feed", name: "سوئیچ خودپردازها", device_hold_minutes: 10, device_status_map: { CASH_OUT: "out_of_cash", IN_SERVICE: "in_service" },
      options: { source: "folder", item_kind: "atm", columns: ATM_COLUMNS },
    });
    const { dir } = await ensureDropFolder(c.id);
    const asset = () => w.one<Row>(`select device_status from sm_assets where id = $1`, [atm.id]);
    for (const name of ["t1.csv", "t2.csv"]) {
      await dropFile(dir, name, toCsv(atmRows(1, { state: "CASH_OUT" })));
      expect((await w.pass(c.id)).run).toMatchObject({ state: "completed", complete: true });
      // the pass queued discovery.status: the ATM is matched to its asset and the value observed
      await w.drain();
      expect((await asset()).device_status).toBe("in_service");
    }
    expect(await w.one<Row>(`select matched_by, asset_id from sm_discovery_items where connector_id = $1 and external_id = 'T00001'`, [c.id])).toEqual({ matched_by: "terminal_id", asset_id: atm.id });
    expect(await w.one<Row>(`select device_pending, device_pending_polls from sm_discovery_states where asset_id = $1`, [atm.id])).toEqual({ device_pending: "out_of_cash", device_pending_polls: 2 });
    await applyDevice(w.sys, atm.id, c.id, { now: Date.now() + 11 * 60_000 });
    expect((await asset()).device_status).toBe("out_of_cash");
    const p = await w.q<Row>(`select status, reason from sm_device_status_events where asset_id = $1 and deleted_at is null order by from_at`, [atm.id]);
    expect(p.map((x) => x.status)).toEqual(["in_service", "out_of_cash"]);
    expect(p[1].reason).toContain("سوئیچ خودپردازها");
  }, 240_000);
});
