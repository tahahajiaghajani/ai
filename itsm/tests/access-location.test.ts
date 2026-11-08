// «مکان من» (`is_my_location`, docs/spec/ENGINE.md § Conditions): a member's condition environment names their
// profile's location and every location above it, kept fresh when the profile or the location tree changes (the
// access version moves, migration 0050_access_locations) — so a location subscription or a rule «مکان: مکان من است»
// reaches the people at that location, a building's outage its floors.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { condEnv } from "@server/engine";
import { evaluate } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";

describe("my location in the condition environment", () => {
  let e: EngineOrg;
  let P = "";
  const loc = async (name: string, parent: string | null = null) => (await e.owner.post(`${P}/r/location`, { name, kind: "site", ...(parent ? { parent_id: parent } : {}) })).row.id as string;

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
  });

  it("names the member's location and those above it, and follows changes", async () => {
    const site = await loc("سایت مرکزی");
    const building = await loc("ساختمان الف", site);
    const floor = await loc("طبقهٔ سوم", building);
    const other = await loc("ساختمان ب", site);
    const m = await e.member("member", "located@example.com");
    expect((await condEnv(await e.ctxOf(m.userId))).locations ?? []).toEqual([]);
    await e.owner.put(`${P}/access/members/${m.userId}`, { location_id: floor });
    expect((await condEnv(await e.ctxOf(m.userId))).locations).toEqual([site, building, floor].sort());
    // an announcement for the building reaches the floor; one for the other building does not
    const def = tableDef("announcement");
    if (def) {
      const env = await condEnv(await e.ctxOf(m.userId));
      expect(evaluate({ f: "locations", op: "is_my_location" }, { locations: [building] }, env, def)).toBe(true);
      expect(evaluate({ f: "locations", op: "is_my_location" }, { locations: [other] }, env, def)).toBe(false);
    }
    // the floor moves to the other building: the environment follows (the access version moved)
    await e.owner.patch(`${P}/r/location/${floor}`, { parent_id: other });
    expect((await condEnv(await e.ctxOf(m.userId))).locations).toEqual([site, other, floor].sort());
  });
});
