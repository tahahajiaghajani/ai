// Who may do what in configuration management: a requester sees only their own devices, an asset manager writes the
// CIs of their group and only reads the others, a group-scoped reader never sees another group's CIs (not even in the
// health summary or a map), an auditor reads everything and changes nothing, and only CMDB administrators run the
// organisation-wide work (defaults, health pass, rule runs, URL sources) or change the class tree.
import { beforeAll, describe, expect, it } from "vitest";
import { cmdbWorld, type CmdbWorld } from "./cmdb-helpers";

let w: CmdbWorld;
let infraCi: Record<string, any>;
let netCi: Record<string, any>;
const R = (t: string, id?: string) => `${w.P}/r/${t}${id ? `/${id}` : ""}`;
const C = (p: string) => `${w.P}/cmdb${p}`;

beforeAll(async () => {
  w = await cmdbWorld();
  infraCi = await w.ci({ name: "app-srv-01", class: "server", serial_number: "ACC-1", support_group_id: w.g.infra, owned_by: w.p.am.userId });
  netCi = await w.ci({ name: "core-sw-01", class: "network_device", serial_number: "ACC-2", support_group_id: w.g.network, owned_by: w.p.am2.userId });
  await w.ci({ name: "laptop-req", class: "laptop", serial_number: "ACC-3", used_by: w.p.req.userId });
  await w.drain();
}, 120_000);

describe("a requester", () => {
  it("finds only their own devices in the picker and cannot open the CMDB", async () => {
    const hits = (await w.p.req.client.get(C("/picker"))).hits;
    expect(hits.map((h: any) => h.name)).toEqual(["laptop-req"]);
    await w.p.req.client.get(C("/meta"), 403);
    await w.p.req.client.post(C("/map"), { roots: [infraCi.id] }, 404);
    await w.p.req.client.post(R("ci"), { name: "x", class: "server" }, 403);
  });
});

describe("an agent of another group", () => {
  it("reads the other group's CI but may not change it, and relates only through a CI of their own", async () => {
    expect((await w.p.am2.client.get(R("ci", infraCi.id))).row.name).toBe("app-srv-01");
    await w.p.am2.client.patch(R("ci", infraCi.id), { description: "تغییر" }, 403);
    const other = await w.ci({ name: "db-srv-01", class: "server", serial_number: "ACC-4", support_group_id: w.g.infra });
    await w.p.am2.client.post(R("ci_rel"), { parent_id: infraCi.id, type: "depends_on", child_id: other.id }, 403);
    // one end of their own is enough (their switch serves the other group's server); the relationship keeps the parent's anchors
    const rel = (await w.p.am2.client.post(R("ci_rel"), { parent_id: infraCi.id, type: "depends_on", child_id: netCi.id })).row;
    expect(rel.support_group_id).toBe(w.g.infra);
    expect((await w.p.am.client.patch(R("ci", infraCi.id), { description: "به‌روز شد" })).row.description).toBe("به‌روز شد");
  });

  it("with a group-scoped role, never sees another group's CIs", async () => {
    await w.p.grp.client.get(R("ci", netCi.id), 404);
    const list = (await w.p.grp.client.post(`${R("ci")}/query`, { size: 100, fields: ["name"] })).rows.map((r: any) => r.name);
    expect(list).toContain("app-srv-01");
    expect(list).not.toContain("core-sw-01");
    const picker = (await w.p.grp.client.get(C("/picker?q=core"))).hits;
    expect(picker).toHaveLength(0);
  });
});

describe("an auditor", () => {
  it("reads everything and changes nothing", async () => {
    expect((await w.p.auditor.client.get(R("ci", netCi.id))).row.name).toBe("core-sw-01");
    expect((await w.p.auditor.client.get(C("/health"))).total).toBeGreaterThan(0);
    await w.p.auditor.client.patch(R("ci", netCi.id), { description: "x" }, 403);
    await w.p.auditor.client.post(R("ci"), { name: "audit-new", class: "server" }, 403);
    await w.p.auditor.client.post(C("/seed"), {}, 403);
    await w.p.auditor.client.post(C("/health/run"), {}, 403);
    await w.p.auditor.client.post(C("/rel-rules/run"), {}, 403);
    const meta = await w.p.auditor.client.get(C("/meta"));
    expect(meta).toMatchObject({ can_admin: false, can_write: false });
  });
});

describe("administrators", () => {
  it("are configuration managers and tenant administrators", async () => {
    expect((await w.p.cm.client.get(C("/meta"))).can_admin).toBe(true);
    expect((await w.p.am.client.get(C("/meta"))).can_admin).toBe(false);
    await w.p.am.client.post(C("/suggestions/run"), {}, 403);
    expect((await w.p.cm.client.post(C("/suggestions/run"), {})).proposed).toBeGreaterThanOrEqual(0);
  });
});
