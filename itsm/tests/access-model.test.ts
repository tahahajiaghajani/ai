// The access model's pure parts (@shared/access): scopes and grants, role containment and cycles, how a member's
// roles become their effective access (legacy mode, explicit roles, support sessions), the built-in catalogue and
// its documented default matrix, persona presets, diffs and the privilege-escalation check.
import { describe, it, expect } from "vitest";
import {
  areas, builtinRoles, combineRoles, composeEffective, containmentCycle, diffRole, exceeds, fullGrant, grantIn, isArea,
  maxScope, mergeGrants, PERSONA_PRESETS, roleCatalog, roleClosure, roleProblem, SCOPES, scopeRank, registerArea,
  MEMBERSHIP_AREAS, type RoleDef,
} from "@shared/access";
import { permissionMap } from "@shared/permissions";
import { FIELD_GROUPS } from "@shared/model/types";

const catalog = roleCatalog([]);
const eff = (keys: string[], role: "owner" | "admin" | "member" | "viewer" = "member") =>
  composeEffective({ role, levels: permissionMap(role), explicit: keys, catalog });

describe("scopes and grants", () => {
  it("orders the scope ladder and takes the wider of two", () => {
    expect(SCOPES).toEqual(["none", "own", "group", "unit", "unit_tree", "domain", "all"]);
    expect(maxScope("group", "unit_tree")).toBe("unit_tree");
    expect(maxScope("all", "own")).toBe("all");
    expect(scopeRank(undefined)).toBe(0);
  });

  it("makes grants coherent: write/delete imply read, create implies reading one's own", () => {
    expect(fullGrant({ write: "group" })).toMatchObject({ read: "group", write: "group" });
    expect(fullGrant({ read: "own", delete: "all" }).read).toBe("all");
    expect(fullGrant({ create: true }).read).toBe("own");
    expect(fullGrant(undefined)).toEqual({ read: "none", create: false, write: "none", delete: "none", approve: false, admin: false });
  });

  it("merges operation by operation (the most permissive wins)", () => {
    const g = mergeGrants(fullGrant({ read: "own", create: true }), fullGrant({ read: "group", write: "group", approve: true }));
    expect(g).toEqual({ read: "group", create: true, write: "group", delete: "none", approve: true, admin: false });
  });
});

describe("roles", () => {
  it("resolves containment transitively and survives cycles", () => {
    expect(roleClosure(["team_lead"], catalog)).toEqual(["agent", "requester", "team_lead"]);
    const loop = new Map<string, RoleDef>([
      ["a", { ...builtinRoles()[0], key: "a", contains: ["b"] }],
      ["b", { ...builtinRoles()[0], key: "b", contains: ["a"] }],
    ]);
    expect(roleClosure(["a"], loop)).toEqual(["a", "b"]);
  });

  it("refuses containment that would close a loop, and unknown roles", () => {
    expect(containmentCycle("requester", ["team_lead"], catalog)).toEqual(["requester", "team_lead", "agent", "requester"]);
    expect(containmentCycle("custom", ["team_lead"], catalog)).toBeNull();
    const base = catalog.get("agent")!;
    expect(roleProblem({ ...base, key: "requester", contains: ["agent"] }, catalog)).toMatch(/دور/);
    expect(roleProblem({ ...base, key: "x1", contains: ["ghost"] }, catalog)).toMatch(/وجود ندارد/);
    expect(roleProblem({ ...base, key: "x1", grants: { nowhere: { read: "all" } } }, catalog)).toMatch(/شناخته نیست/);
    expect(roleProblem({ ...base, key: "x1", grants: { incident: { read: "everything" as never } } }, catalog)).toMatch(/معتبر نیست/);
    expect(roleProblem({ ...base, key: "Bad-Key" }, catalog)).toMatch(/کلید/);
    expect(roleProblem({ ...base, key: "x1" }, catalog)).toBeNull();
  });

  it("ships a valid built-in catalogue: known areas, valid groups, resolvable and cycle-free containment", () => {
    const keys = builtinRoles().map((r) => r.key);
    expect(keys).toEqual([
      "requester", "agent", "team_lead", "service_desk_manager", "incident_manager", "problem_manager", "change_manager", "cab_member",
      "release_manager", "asset_manager", "configuration_manager", "knowledge_manager", "service_owner", "security_analyst", "hr_agent",
      "facilities_agent", "vendor_agent", "auditor", "tenant_admin",
    ]);
    for (const preset of ["open", "need_to_know"] as const) {
      const cat = roleCatalog([], preset);
      for (const r of builtinRoles(preset)) {
        const without = new Map([...cat].filter(([k]) => k !== r.key));
        expect(roleProblem(r, without), r.key).toBeNull();
        for (const g of r.field_groups) expect(g in FIELD_GROUPS, `${r.key}: ${g}`).toBe(true);
      }
    }
    for (const p of PERSONA_PRESETS) for (const k of p.roles) expect(catalog.has(k), p.key).toBe(true);
  });

  it("documents the default matrix (spot checks of docs/spec/ACCESS.md)", () => {
    const g = (role: string, area: string) => grantIn(combineRoles(roleClosure([role], catalog).map((k) => catalog.get(k)!)), area);
    expect(g("requester", "incident")).toEqual({ read: "own", create: true, write: "own", delete: "none", approve: false, admin: false });
    expect(g("requester", "knowledge").read).toBe("all");
    expect(g("requester", "cmdb").read).toBe("none");
    expect(g("agent", "incident")).toMatchObject({ read: "all", create: true, write: "group", delete: "none" });
    expect(g("team_lead", "incident")).toMatchObject({ write: "group", approve: true });
    expect(g("service_desk_manager", "incident")).toMatchObject({ read: "all", write: "all", delete: "all", approve: true });
    expect(g("change_manager", "change")).toMatchObject({ read: "all", write: "all", approve: true });
    expect(g("cab_member", "change")).toMatchObject({ read: "all", write: "none", approve: true });
    expect(g("vendor_agent", "incident")).toEqual({ read: "group", create: false, write: "group", delete: "none", approve: false, admin: false });
    expect(g("auditor", "incident")).toMatchObject({ read: "all", write: "none", create: false });
    expect(g("auditor", "audit").read).toBe("all");
    expect(g("tenant_admin", "settings")).toMatchObject({ read: "all", write: "all", delete: "all", admin: true });
    expect(g("hr_agent", "hr")).toMatchObject({ read: "group", write: "group" });
    expect(catalog.get("auditor")!.field_groups).not.toContain("hr");
    expect(catalog.get("tenant_admin")!.field_groups).not.toContain("security");
    // the need-to-know preset narrows what agents read
    const ntk = roleCatalog([], "need_to_know");
    expect(grantIn(combineRoles([ntk.get("agent")!]), "incident").read).toBe("group");
  });

  it("lets modules add areas that wildcard grants cover", () => {
    registerArea({ key: "fieldwork", label: "خدمات میدانی", group: "service" });
    expect(isArea("fieldwork")).toBe(true);
    expect(areas().some((a) => a.key === "fieldwork")).toBe(true);
    expect(grantIn(combineRoles([catalog.get("tenant_admin")!]), "fieldwork").admin).toBe(true);
    expect(grantIn(combineRoles([catalog.get("agent")!]), "fieldwork").read).toBe("none");
  });

  it("diffs a role against its default, area by area", () => {
    const base = catalog.get("agent")!;
    const edited: RoleDef = { ...base, grants: { ...base.grants, incident: { read: "group", create: true, write: "group" } }, field_groups: ["internal"] };
    const d = diffRole(base, edited);
    expect(d).toContainEqual({ what: "grant", area: "incident", op: "read", from: "all", to: "group" });
    expect(d).toContainEqual({ what: "field_groups", from: ["internal", "personal"], to: ["internal"] });
    expect(diffRole(base, base)).toEqual([]);
  });
});

describe("effective access", () => {
  it("unions explicit roles; owners and the membership role «مدیر» also hold tenant_admin", () => {
    const e = eff(["agent", "cab_member"]);
    expect(e.legacy).toBe(false);
    expect(e.roles).toEqual(["agent", "cab_member", "requester"]);
    expect(grantIn(e, "change")).toMatchObject({ read: "all", write: "group", approve: true });
    expect(e.workspacesAll).toBe(false);
    expect(eff(["requester"], "admin").roles).toContain("tenant_admin");
  });

  it("legacy mode: a member without ITSM roles keeps the membership role's levels in its areas", () => {
    const member = eff([], "member");
    expect(member.legacy).toBe(true);
    expect(grantIn(member, "work")).toMatchObject({ read: "all", create: true, write: "all", delete: "none" });
    expect(grantIn(member, "settings")).toMatchObject({ read: "all", write: "none" });
    expect(grantIn(member, "incident")).toMatchObject({ read: "all", write: "group" }); // works as an agent elsewhere
    expect(member.fieldGroups).toEqual(["internal", "personal"]);
    const viewer = eff([], "viewer");
    expect(grantIn(viewer, "work")).toMatchObject({ read: "all", write: "none" });
    expect(grantIn(viewer, "incident")).toMatchObject({ read: "all", write: "none" });
    expect(viewer.fieldGroups).toEqual([]);
    const overridden = composeEffective({ role: "member", levels: permissionMap("member", { work: "none" }), explicit: [], catalog });
    expect(grantIn(overridden, "work").read).toBe("none");
    for (const a of MEMBERSHIP_AREAS) expect(grantIn(eff([], "owner"), a).admin, a).toBe(true);
  });

  it("support sessions: view reads everything, edit works like tenant_admin, both keep the session's membership levels", () => {
    const view = composeEffective({ role: null, levels: { users: "view", settings: "view", work: "view", ai: "none", reports: "view", integrations: "view" }, explicit: [], catalog, support: "view" });
    expect(grantIn(view, "incident")).toMatchObject({ read: "all", write: "none" });
    expect(grantIn(view, "ai").read).toBe("none");
    expect(view.fieldGroups).not.toContain("hr");
    const edit = composeEffective({ role: null, levels: { users: "view", settings: "full", work: "full", ai: "edit", reports: "full", integrations: "view" }, explicit: [], catalog, support: "edit" });
    expect(grantIn(edit, "incident")).toMatchObject({ write: "all", delete: "all" });
    expect(grantIn(edit, "users")).toMatchObject({ read: "all", write: "none" });
  });

  it("finds where one access goes beyond another (nobody grants above their own)", () => {
    const agent = eff(["agent"]);
    const admin = eff(["tenant_admin"]);
    expect(exceeds(agent, admin)).toEqual([]);
    const extra = exceeds(admin, agent);
    expect(extra).toContain("incident.delete");
    expect(extra).toContain("field:financial");
    expect(extra).toContain("workspaces:all");
  });
});
