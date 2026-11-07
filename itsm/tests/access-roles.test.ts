// Every built-in role against every record operation, end to end through the HTTP API: a member holding only that
// role, in the group a ticket is assigned to, tries to read it, file a new one, change it and delete one. The expected
// outcome follows the role's documented grant in the incident area (docs/spec/ACCESS.md § Default role matrix), with
// a few cases spelled out by hand so the matrix itself is pinned too.
import { describe, it, expect, beforeAll } from "vitest";
import "./fixtures/access";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { builtinRoles, combineRoles, grantIn, roleCatalog, roleClosure, scopeRank } from "@shared/access";
import { create, systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

const catalog = roleCatalog([]);
const ROLES = builtinRoles().map((r) => r.key);
const grant = (role: string) => grantIn(combineRoles(roleClosure([role], catalog).map((k) => catalog.get(k)!)), "incident");
const reachesGroup = (s: string) => scopeRank(s as never) >= scopeRank("group");

let e: EngineOrg;
let P = "";
let sys: Ctx;
let group = "";
let outsider = "";
const who: Record<string, { client: Client; userId: string }> = {};

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  group = (await e.owner.post(`${P}/r/group`, { name: "میز خدمت" })).row.id;
  outsider = (await e.member("member", "roles-outsider@example.com")).userId;
  for (const role of ROLES) who[role] = await e.member("member", `role-${role}@example.com`);
  await e.owner.post(`${P}/access/groups/${group}/members`, { user_ids: ROLES.map((r) => who[r].userId) });
  for (const role of ROLES) await e.owner.put(`${P}/access/members/${who[role].userId}`, { roles: [role] });
  sys = await systemCtx(e.cfg, e.org);
});

const ticket = async () => (await create(sys, "acc_ticket", { short_description: "تیکت گروه", caller_id: outsider, assignment_group_id: group })).row.id as string;

describe("each built-in role against each operation on a ticket of its group", () => {
  it("pins the matrix for a few roles by hand", () => {
    expect(grant("requester")).toMatchObject({ read: "own", create: true, write: "own", delete: "none" });
    expect(grant("agent")).toMatchObject({ read: "all", create: true, write: "group", delete: "none" });
    expect(grant("vendor_agent")).toMatchObject({ read: "group", create: false, write: "group", delete: "none" });
    expect(grant("auditor")).toMatchObject({ read: "all", create: false, write: "none", delete: "none" });
    expect(grant("service_desk_manager")).toMatchObject({ read: "all", create: true, write: "all", delete: "all" });
    expect(grant("tenant_admin")).toMatchObject({ read: "all", create: true, write: "all", delete: "all" });
  });

  for (const role of ROLES) {
    it(role, async () => {
      const g = grant(role);
      const c = who[role].client;
      const t = await ticket();
      // read
      await c.get(`${P}/r/acc_ticket/${t}`, reachesGroup(g.read) ? 200 : 404);
      // create (for themselves: a requester-only member files only for themselves)
      await c.post(`${P}/r/acc_ticket`, { short_description: `ثبت ${role}` }, g.create ? 200 : 403);
      // change
      if (reachesGroup(g.read)) await c.patch(`${P}/r/acc_ticket/${t}`, { description: "به‌روزرسانی" }, reachesGroup(g.write) ? 200 : 403);
      // delete
      const doomed = await ticket();
      if (reachesGroup(g.read)) await c.del(`${P}/r/acc_ticket/${doomed}`, reachesGroup(g.delete) ? 200 : 403);
      else await c.del(`${P}/r/acc_ticket/${doomed}`, 404);
    });
  }
});
