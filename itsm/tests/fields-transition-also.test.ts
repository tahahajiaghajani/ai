// Integrator patch for design F §4.2 (package F1): `Transition.also` in `canTransitionRow` (@shared/access/evaluate)
// — the organisation's narrowing of who may take a transition. It is an AND with everything the module asks (its
// write rule, its requester transitions, its `roles`): it takes a transition away from those without one of the
// roles and never gives one to anybody; the system is never narrowed.
import { describe, it, expect } from "vitest";
import { canTransitionRow, composeEffective, roleCatalog, type Subject } from "@shared/access";
import { permissionMap, type Role } from "@shared/permissions";
import { tableDef } from "@shared/tables";
import type { Transition } from "@shared/model/types";

const catalog = roleCatalog([]);

function subject(roles: string[], role: Role = "member", kind: Subject["kind"] = "user"): Subject {
  return {
    orgId: "o1", userId: "u1", kind, eff: composeEffective({ role, levels: permissionMap(role), explicit: roles, catalog }),
    groups: [], writeGroups: [], ledGroups: [], unitId: null, unitTree: [], managedTree: [], reportees: [], delegators: [],
    domainSeparation: false, domainId: null, domainTree: [], workspaces: [], secureWorkspaces: [], restrictedGroups: [],
  };
}

describe("canTransitionRow with the organisation's `also`", () => {
  const def = tableDef("incident")!;
  // assigned to the subject: an agent works it in full
  const row = { org_id: "o1", state: "new", assigned_to: "u1" };
  const start = def.states!.transitions.find((t) => t.to === "in_progress")!;

  it("narrows: one of the roles is needed besides the module's rule", () => {
    const agent = subject(["agent"]);
    expect(canTransitionRow(agent, def, row, start)).toBe(true);
    expect(canTransitionRow(agent, def, row, { ...start, also: ["incident_manager"] })).toBe(false);
    expect(canTransitionRow(subject(["incident_manager"]), def, row, { ...start, also: ["incident_manager"] })).toBe(true);
    // any one of them is enough; an empty list narrows nothing
    expect(canTransitionRow(agent, def, row, { ...start, also: ["incident_manager", "agent"] })).toBe(true);
    expect(canTransitionRow(agent, def, row, { ...start, also: [] })).toBe(true);
  });

  it("never loosens: holding an `also` role gives nothing the module refuses", () => {
    const guarded: Transition = { ...start, roles: { area: "incident", level: "full" } };
    const agent = subject(["agent"]);
    expect(canTransitionRow(agent, def, row, guarded)).toBe(false);
    expect(canTransitionRow(agent, def, row, { ...guarded, also: ["agent"] })).toBe(false);
    // a member who may not change the row at all gets nothing from `also`
    const other = { ...row, assigned_to: "u2" };
    const requester = subject(["requester"]);
    expect(canTransitionRow(requester, def, other, { ...start, also: ["requester"] })).toBe(false);
  });

  it("leaves the system alone", () => {
    expect(canTransitionRow(subject([], "member", "system"), def, row, { ...start, also: ["incident_manager"] })).toBe(true);
  });
});
