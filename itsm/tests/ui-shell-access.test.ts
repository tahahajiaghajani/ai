// Navigation gated by the ITSM access model (docs/spec/UI_RECORDS.md § Shell): nav items, spaces and palette searches
// name an area, an operation and the least scope; the shell offers only what the member's effective grants (from
// GET /api/o/:org `access`) pass — a requester no longer sees the change space, the fulfilment queues or the
// catalogue's and knowledge's definitions (and the server still refuses them).
import { describe, it, expect } from "vitest";
import { composeEffective, gateAllows, isArea, roleCatalog, type FullGrant, type RoleDef } from "@shared/access";
import { NAV, SPACES } from "../src/ui/modules/registry";
import { SEARCHES } from "../src/ui/modules/registry";
import { engineOrg } from "./engine-helpers";

const grantsOf = (...roles: string[]): Record<string, FullGrant> =>
  composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog: roleCatalog([]) }).grants;

/** What the shell would offer: items, spaces with an item, palette searches. */
function shell(grants: Record<string, FullGrant>) {
  // an item may name several gates: the shell needs all of them
  const items = NAV.flatMap((g) => g.items.filter((i) => !i.access || [i.access].flat().every((a) => gateAllows(grants, a))).map((i) => ({ ...i, space: g.space })));
  const spaces = SPACES.filter((s) => (!s.access || gateAllows(grants, s.access)) && items.some((i) => i.space === s.key && !i.common)).map((s) => s.key);
  const searches = SEARCHES.filter((x) => !x.access || gateAllows(grants, x.access)).map((x) => x.key);
  return { keys: new Set(items.map((i) => i.key)), spaces, searches };
}

/** The bank roles the ITAM module seeds as organisation rows (src/server/modules/itam/seed.ts BANK_ROLES). */
const bankRole = (key: string, asset: Record<string, unknown>): RoleDef => ({ key, name: key, persona: "agent", grants: { asset } as never, field_groups: [], contains: [], workspaces: "member", domains: "own" });
const BANK = [
  bankRole("branch_asset_officer", { read: "unit", create: true, write: "unit", delete: "none", approve: false, admin: false }),
  bankRole("regional_asset_manager", { read: "unit_tree", create: true, write: "unit_tree", delete: "none", approve: true, admin: false }),
  bankRole("branch_manager", { read: "unit", create: false, write: "own", delete: "none", approve: false, admin: false }),
];
const bankGrantsOf = (...roles: string[]): Record<string, FullGrant> =>
  composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog: roleCatalog(BANK) }).grants;

describe("bank ITAM and the demo console in the shell", () => {
  it("a requester sees no ITAM pages but their own assets; a branch officer the branch inventory, not the register", () => {
    const req = shell(grantsOf("requester"));
    expect([...req.keys].filter((k) => k.startsWith("itam:") && k !== "itam:my-assets")).toEqual([]);
    const officer = shell(bankGrantsOf("branch_asset_officer"));
    for (const k of ["itam:branches", "itam:fleet", "itam:asset_transfer", "itam:branch_attestation", "itam:inventory_audit"]) expect(officer.keys.has(k)).toBe(true);
    expect(officer.keys.has("itam:register")).toBe(false);
    expect(officer.keys.has("itam:maintenance_sla")).toBe(false);
    const manager = shell(bankGrantsOf("branch_manager"));
    expect(manager.keys.has("itam:branches")).toBe(true);
    expect(manager.keys.has("itam:register")).toBe(false);
    const region = shell(bankGrantsOf("regional_asset_manager"));
    expect(region.keys.has("itam:register")).toBe(true);
    expect(shell(grantsOf("asset_manager")).keys.has("itam:register")).toBe(true);
  });

  it("the demo console is the tenant administrators' only", () => {
    expect(shell(grantsOf("tenant_admin")).keys.has("admin:demo")).toBe(true);
    for (const r of ["requester", "agent", "asset_manager", "service_desk_manager"]) expect(shell(grantsOf(r)).keys.has("admin:demo")).toBe(false);
    expect(shell(bankGrantsOf("branch_asset_officer")).keys.has("admin:demo")).toBe(false);
  });
});

describe("gates", () => {
  it("pass on the operation and the least scope; without grants (an older server) everything passes", () => {
    const requester = grantsOf("requester");
    expect(gateAllows(requester, { area: "request" })).toBe(true);
    expect(gateAllows(requester, { area: "request", scope: "group" })).toBe(false);
    expect(gateAllows(requester, { area: "change" })).toBe(false);
    expect(gateAllows(requester, { area: "catalog", op: "create" })).toBe(false);
    expect(gateAllows(requester, { area: "knowledge" })).toBe(true);
    expect(gateAllows(requester, { area: "knowledge", op: "create" })).toBe(false);
    const agent = grantsOf("agent");
    expect(gateAllows(agent, { area: "change" })).toBe(true);
    expect(gateAllows(agent, { area: "change", op: "approve" })).toBe(false);
    expect(gateAllows(grantsOf("change_manager"), { area: "change", op: "approve" })).toBe(true);
    expect(gateAllows(null, { area: "change", op: "admin" })).toBe(true);
  });

  it("name registered areas only", () => {
    for (const g of NAV) for (const i of g.items) for (const a of i.access ? [i.access].flat() : []) expect(isArea(a.area), i.key).toBe(true);
    for (const s of SPACES) if (s.access) expect(isArea(s.access.area), s.key).toBe(true);
  });
});

describe("what the shell offers", () => {
  it("a requester: ordering and reading knowledge; no change space, fulfilment queues or definitions", () => {
    const s = shell(grantsOf("requester"));
    expect(s.spaces).not.toContain("change");
    expect([...s.keys].some((k) => k.startsWith("change:"))).toBe(false);
    expect(s.keys.has("request:catalog")).toBe(true);
    expect(s.keys.has("request:cart")).toBe(true);
    expect(s.keys.has("request:request")).toBe(true);
    expect([...s.keys].some((k) => k.startsWith("request:q:"))).toBe(false);
    expect(s.keys.has("request:catalog_item")).toBe(false);
    expect(s.keys.has("request:settings")).toBe(false);
    expect(s.keys.has("kb:home")).toBe(true);
    expect(s.keys.has("kb:drafts")).toBe(false);
    expect(s.keys.has("knowledge:kb_base")).toBe(false);
    expect(s.searches).not.toContain("records:change_request");
  });

  it("an agent: the change and fulfilment work, not the managers' definitions", () => {
    const s = shell(grantsOf("agent"));
    expect(s.spaces).toContain("change");
    expect(s.keys.has("change:q:mine")).toBe(true);
    expect(s.keys.has("change:change_model")).toBe(false);
    expect([...s.keys].some((k) => k.startsWith("request:q:"))).toBe(true);
    expect(s.keys.has("request:catalog_item")).toBe(false);
    expect(s.keys.has("kb:drafts")).toBe(true);
    expect(s.keys.has("knowledge:kb_base")).toBe(false);
    expect(s.keys.has("kb:workspace")).toBe(false);
  });

  it("managers get their definitions", () => {
    expect(shell(grantsOf("change_manager")).keys.has("change:change_model")).toBe(true);
    expect(shell(grantsOf("service_desk_manager")).keys.has("request:catalog_item")).toBe(true);
    const kb = shell(grantsOf("knowledge_manager"));
    expect(kb.keys.has("knowledge:kb_base")).toBe(true);
    expect(kb.keys.has("kb:workspace")).toBe(true);
  });
});

describe("the organisation bootstrap carries the member's ITSM access", () => {
  it("grants per area, roles and persona (GET /api/o/:org)", async () => {
    const e = await engineOrg();
    const P = `/o/${e.org}`;
    const m = await e.member("member", "shell-requester@example.com");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles: ["requester"], persona: "requester" });
    const mine = await m.client.get(P);
    expect(mine.access.persona).toBe("requester");
    expect(mine.access.grants.change.read).toBe("none");
    expect(mine.access.grants.request.read).toBe("own");
    expect(gateAllows(mine.access.grants, { area: "change" })).toBe(false);
    const owner = await e.owner.get(P);
    expect(owner.access.persona).toBe("admin");
    expect(gateAllows(owner.access.grants, { area: "change", op: "approve" })).toBe(true);
  });
});
