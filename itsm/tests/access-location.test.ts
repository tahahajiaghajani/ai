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

  it("names the member's unit and those above it (`in_my_unit_line`): a collection shared with a unit and its sub-units", async () => {
    const unit = async (name: string, parent: string | null = null) => (await e.owner.post(`${P}/r/org_unit`, { name, ...(parent ? { parent_id: parent } : {}) })).row.id as string;
    const top = await unit("معاونت فنی");
    const it = await unit("فناوری اطلاعات", top);
    const net = await unit("شبکه", it);
    const hr = await unit("منابع انسانی", top);
    const m = await e.member("member", "unit-line@example.com");
    await e.owner.put(`${P}/access/members/${m.userId}`, { org_unit_id: net, roles: ["requester"], persona: "requester" });
    expect((await condEnv(await e.ctxOf(m.userId))).unitLine).toEqual([top, it, net].sort());
    // a document collection shared with «فناوری اطلاعات» and its sub-units reaches the network team; with the unit
    // alone, or with another branch, it does not
    const mk = async (name: string, sharing: string, units: string[]) => (await e.owner.post(`${P}/r/doc_collection`, { name, sharing, share_units: units })).row.id as string;
    const tree = await mk("اسناد فناوری", "unit_trees", [it]);
    const only = await mk("اسناد خود واحد", "units", [it]);
    const other = await mk("اسناد منابع انسانی", "unit_trees", [hr]);
    const seen = ((await m.client.get(`${P}/r/doc_collection?size=50`)).rows as { id: string }[]).map((r) => r.id);
    expect(seen).toContain(tree);
    expect(seen).not.toContain(only);
    expect(seen).not.toContain(other);
  });
});
