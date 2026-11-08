// Configuration management: the class pack and its validation, relationships (no loops, no duplicates, who may edit
// them), the permission-aware dependency map (placeholders keep paths, hidden leaves vanish, no names leak), impact
// analysis with redundancy groups and weights, what-if saved on a record, the CI picker and queries.
import { beforeAll, describe, expect, it } from "vitest";
import { cmdbWorld, type CmdbWorld } from "./cmdb-helpers";

let w: CmdbWorld;
let ids: Record<string, string>;

beforeAll(async () => {
  w = await cmdbWorld();
  const { ci, rel, g, p } = w;
  // business service → app service → app → db / vm → host ; storage behind the db; a cluster of two web nodes
  const svc = await ci({ name: "سامانهٔ حقوق", class: "business_service", owned_by: p.cm.userId, support_group_id: g.infra, criticality: "1" });
  const appsvc = await ci({ name: "حقوق — تولید", class: "application_service", owned_by: p.cm.userId, support_group_id: g.infra, criticality: "1" });
  const app = await ci({ name: "نرم‌افزار حقوق", class: "application", owned_by: p.am.userId, support_group_id: g.infra });
  const db = await ci({ name: "پایگاه دادهٔ حقوق", class: "database", owned_by: p.am.userId, support_group_id: g.infra, environment: "production" });
  const vm = await ci({ name: "vm-payroll-01", class: "virtual_machine", owned_by: p.am.userId, support_group_id: g.infra, attrs: { host_uuid: "AAA-111" } });
  const host = await ci({ name: "esx-01", class: "server", owned_by: p.am2.userId, support_group_id: g.network, serial_number: "SN-1", manufacturer: "HPE", bios_uuid: "AAA-111" });
  const san = await ci({ name: "san-01", class: "storage", owned_by: p.am2.userId, support_group_id: g.network, serial_number: "SAN-9" });
  const cluster = await ci({ name: "خوشهٔ وب", class: "cluster", owned_by: p.am.userId, support_group_id: g.infra });
  const web1 = await ci({ name: "web-01", class: "server", owned_by: p.am.userId, support_group_id: g.infra, serial_number: "W1" });
  const web2 = await ci({ name: "web-02", class: "server", owned_by: p.am.userId, support_group_id: g.infra, serial_number: "W2" });
  ids = { svc: svc.id, appsvc: appsvc.id, app: app.id, db: db.id, vm: vm.id, host: host.id, san: san.id, cluster: cluster.id, web1: web1.id, web2: web2.id };
  await rel(svc.id, "depends_on", appsvc.id);
  await rel(appsvc.id, "depends_on", app.id);
  await rel(appsvc.id, "depends_on", cluster.id);
  await rel(app.id, "depends_on", db.id);
  await rel(app.id, "runs_on", vm.id);
  await rel(db.id, "runs_on", vm.id);
  await rel(vm.id, "runs_on", host.id);
  await rel(db.id, "depends_on", san.id, { impact_weight: 50 });
  await rel(web1.id, "member_of", cluster.id);
  await rel(web2.id, "member_of", cluster.id);
  await w.o.post(`${w.P}/r/ci_group`, { name: "افزونگی وب", kind: "redundancy", ci_id: cluster.id, min_up: 1 });
  await w.drain();
}, 120_000);

describe("classes and CIs", () => {
  it("seeds the class pack, relationship types and their choice lists once", async () => {
    const classes = await w.o.get(`${w.P}/cmdb/classes`);
    expect(classes.classes.find((c: any) => c.key === "server")).toMatchObject({ label: "سرور", parent: "computer" });
    expect(classes.classes.find((c: any) => c.key === "server").all_attrs.map((a: any) => a.name)).toEqual(expect.arrayContaining(["cpu_model", "server_role"]));
    expect(classes.types.find((t: any) => t.key === "runs_on")).toMatchObject({ impact: "child_to_parent", propagates: true });
    const again = await w.o.post(`${w.P}/cmdb/seed`, {});
    expect(Object.values(again.created ?? {}).reduce((s: number, n: any) => s + Number(n), 0)).toBe(0);
  });

  it("refuses abstract classes, coerces class attributes and requires required ones", async () => {
    await w.o.post(`${w.P}/r/ci`, { name: "x", class: "hardware" }, 400);
    const r = await w.o.post(`${w.P}/r/ci`, { name: "srv-attr", class: "server", attrs: { rack_u: "۱۲", power_watts: "450" } });
    expect(r.row.attrs).toMatchObject({ rack_u: 12, power_watts: 450 });
    const bad = await w.o.post(`${w.P}/r/ci`, { name: "srv-bad", class: "server", attrs: { rack_u: "abc" } }, 400);
    expect(bad.error.code).toBe("validation");
    const cert = await w.o.post(`${w.P}/r/ci`, { name: "cert", class: "certificate", attrs: {} }, 400);
    expect(cert.error.message).toContain("موضوع");
  });

  it("normalises MAC addresses and guards «عملیاتی» with the class's requirements", async () => {
    const r = await w.o.post(`${w.P}/r/ci`, { name: "pc-1", class: "desktop", mac_address: "AA-BB-CC-DD-EE-01", state: "planned" });
    expect(r.row.mac_address).toBe("aa:bb:cc:dd:ee:01");
    const t = await w.o.post(`${w.P}/r/ci/${r.row.id}/transition`, { to: "operational" }, 409);
    expect(t.error.message).toContain("مالک");
  });

  it("lets only CMDB administrators change classes", async () => {
    await w.p.am.client.post(`${w.P}/r/ci_class`, { key: "kiosk", label: "کیوسک", parent_key: "hardware", family: "hardware" }, 403);
    const k = await w.p.cm.client.post(`${w.P}/r/ci_class`, { key: "kiosk", label: "کیوسک", parent_key: "hardware", family: "hardware", attrs: [{ name: "screen_inch", label: "اندازهٔ صفحه", type: "int" }] });
    expect(k.row.key).toBe("kiosk");
    await w.p.cm.client.patch(`${w.P}/r/ci_class/${k.row.id}`, { key: "kiosk2" }, 400);
    await w.p.cm.client.patch(`${w.P}/r/ci_class/${k.row.id}`, { parent_key: "kiosk" }, 400);
    // a removed attribute comes back archived (CIs keep their values)
    const patched = await w.p.cm.client.patch(`${w.P}/r/ci_class/${k.row.id}`, { attrs: [] });
    expect(patched.row.attrs).toEqual([expect.objectContaining({ name: "screen_inch", archived: true })]);
    const choices = await w.o.get(`${w.P}/meta/tables/ci`);
    expect((choices.choices["ci.class"] ?? []).some((o: any) => o.value === "kiosk")).toBe(true);
  });
});

describe("relationships", () => {
  it("refuses self-loops and duplicates and labels the relationship", async () => {
    await w.o.post(`${w.P}/r/ci_rel`, { parent_id: ids.app, type: "depends_on", child_id: ids.app }, 400);
    await w.o.post(`${w.P}/r/ci_rel`, { parent_id: ids.app, type: "depends_on", child_id: ids.db }, 409);
    const list = await w.o.get(`${w.P}/r/ci_rel?filter=${encodeURIComponent(JSON.stringify({ f: "parent_id", op: "eq", v: ids.app }))}`);
    expect(list.rows.map((r: any) => r.label)).toEqual(expect.arrayContaining(["نرم‌افزار حقوق وابسته به پایگاه دادهٔ حقوق"]));
  });

  it("lets a group's asset manager relate their own CIs but not another group's", async () => {
    const mine = await w.ci({ name: "app-am", class: "application", owned_by: w.p.am.userId, support_group_id: w.g.infra });
    await w.p.am.client.post(`${w.P}/r/ci_rel`, { parent_id: mine.id, type: "runs_on", child_id: ids.vm });
    await w.p.am.client.post(`${w.P}/r/ci_rel`, { parent_id: ids.host, type: "contains", child_id: ids.san }, 403);
    await w.p.agent.client.post(`${w.P}/r/ci_rel`, { parent_id: ids.app, type: "connects_to", child_id: ids.san }, 403);
  });

  it("reads a relationship only where both CIs are readable", async () => {
    const r = await w.p.grp.client.get(`${w.P}/r/ci_rel?size=200`);
    for (const row of r.rows) {
      expect([row.parent_id, row.child_id].every((x: string) => ![ids.host, ids.san].includes(x))).toBe(true);
    }
  });
});

describe("the dependency map", () => {
  it("walks dependencies of a service layer by layer with overlays", async () => {
    const m = await w.o.post(`${w.P}/cmdb/map`, { roots: [ids.svc], depth: 6, direction: "dependencies" });
    const names = m.nodes.map((n: any) => n.name);
    expect(names).toEqual(expect.arrayContaining(["سامانهٔ حقوق", "نرم‌افزار حقوق", "پایگاه دادهٔ حقوق", "vm-payroll-01", "esx-01", "san-01"]));
    expect(m.nodes.find((n: any) => n.id === ids.svc).root).toBe(true);
    const e = m.edges.find((x: any) => x.source === ids.vm && x.target === ids.host);
    expect(e).toMatchObject({ type: "runs_on", dependent: "source", propagates: true });
  });

  it("walks dependents (what breaks when the host fails)", async () => {
    const m = await w.o.post(`${w.P}/cmdb/map`, { roots: [ids.host], depth: 6, direction: "dependents" });
    const names = m.nodes.map((n: any) => n.name);
    expect(names).toEqual(expect.arrayContaining(["vm-payroll-01", "نرم‌افزار حقوق", "سامانهٔ حقوق"]));
    expect(names).not.toContain("san-01");
  });

  it("shows hidden CIs only as anonymous placeholders that keep a path, never their names", async () => {
    // a readable monitoring agent behind the hidden host: the host stays as a placeholder; the hidden SAN (a leaf) goes
    const mon = await w.ci({ name: "agent-mon", class: "application", owned_by: w.p.am.userId, support_group_id: w.g.infra });
    await w.rel(mon.id, "runs_on", ids.host);
    const m = await w.p.grp.client.post(`${w.P}/cmdb/map`, { roots: [ids.app], depth: 3, direction: "both" });
    expect(m.nodes.map((n: any) => n.name)).toContain("agent-mon");
    const restricted = m.nodes.filter((n: any) => n.restricted);
    expect(restricted.length).toBeGreaterThan(0);
    const text = JSON.stringify(m);
    expect(text).not.toContain("esx-01");
    expect(text).not.toContain("san-01");
    expect(text).not.toContain(ids.host);
    expect(text).not.toContain(ids.san);
    for (const n of restricted) expect(Object.keys(n).sort()).toEqual(expect.arrayContaining(["depth", "id", "restricted"]));
    expect(m.restricted).toBeGreaterThan(0);
  });

  it("answers 404 for a root the caller may not read", async () => {
    await w.p.grp.client.post(`${w.P}/cmdb/map`, { roots: [ids.host] }, 404);
    await w.p.req.client.post(`${w.P}/cmdb/map`, { roots: [ids.svc] }, 404);
  });

  it("finds the path between two CIs", async () => {
    const p = await w.o.get(`${w.P}/cmdb/path?from=${ids.svc}&to=${ids.host}`);
    expect(p.found).toBe(true);
    expect(p.edges.length).toBe(4);
  });
});

describe("impact analysis", () => {
  it("reaches the service from a failed host with paths and severities", async () => {
    const r = await w.o.post(`${w.P}/cmdb/impact`, { ci_ids: [ids.host] });
    const byName = new Map(r.cis.map((c: any) => [c.name, c]));
    expect(byName.get("vm-payroll-01")).toMatchObject({ severity: 1, depth: 1 });
    expect(byName.get("سامانهٔ حقوق")).toMatchObject({ severity: 1 });
    expect((byName.get("سامانهٔ حقوق") as any).path.map((s: any) => s.name)[0]).toBe("esx-01");
    expect(r.counts.critical).toBeGreaterThan(0);
  });

  it("weights partial dependencies (storage behind the database at 50 %)", async () => {
    const r = await w.o.post(`${w.P}/cmdb/impact`, { ci_ids: [ids.san] });
    const db = r.cis.find((c: any) => c.name === "پایگاه دادهٔ حقوق");
    expect(db.severity).toBe(0.5);
  });

  it("lets a redundancy group absorb one node's failure but not both", async () => {
    const one = await w.o.post(`${w.P}/cmdb/impact`, { ci_ids: [ids.web1] });
    const cl1 = one.cis.find((c: any) => c.name === "خوشهٔ وب");
    expect(cl1.severity).toBeLessThan(1);
    expect(cl1.absorbed).toBe(true);
    const both = await w.o.post(`${w.P}/cmdb/impact`, { ci_ids: [ids.web1, ids.web2] });
    expect(both.cis.find((c: any) => c.name === "خوشهٔ وب").severity).toBe(1);
  });

  it("counts what the caller may not read and never names it", async () => {
    const r = await w.p.grp.client.post(`${w.P}/cmdb/impact`, { ci_ids: [ids.app] });
    expect(JSON.stringify(r)).not.toContain("esx-01");
    const asOwner = await w.o.post(`${w.P}/cmdb/impact`, { ci_ids: [ids.app] });
    expect(r.counts.cis).toBe(asOwner.counts.cis);
  });

  it("saves a what-if simulation for its author only", async () => {
    const s = await w.p.agent.client.post(`${w.P}/cmdb/impact/save`, { name: "اگر میزبان بیفتد", ci_ids: [ids.host], state: "maintenance" });
    expect(s.summary).toContain("پیکربندی");
    await w.p.agent.client.get(`${w.P}/r/ci_impact_sim/${s.id}`);
    await w.p.cm.client.get(`${w.P}/r/ci_impact_sim/${s.id}`, 404);
  });
});

describe("picker and queries", () => {
  it("offers readable CIs by words, and a requester only their own devices", async () => {
    const pc = await w.ci({ name: "laptop-req", class: "laptop", used_by: w.p.req.userId, serial_number: "LP-1" });
    const a = await w.p.agent.client.get(`${w.P}/cmdb/picker?q=${encodeURIComponent("حقوق")}`);
    expect(a.hits.map((h: any) => h.name)).toEqual(expect.arrayContaining(["نرم‌افزار حقوق"]));
    const r = await w.p.req.client.get(`${w.P}/cmdb/picker`);
    expect(r.hits.map((h: any) => h.id)).toEqual([pc.id]);
  });

  it("runs a class query with relationship steps", async () => {
    const r = await w.o.post(`${w.P}/cmdb/query`, { class: "software", steps: [{ type: "runs_on", direction: "out", class: "virtual_machine" }, { type: "runs_on", direction: "out", class: "server" }] });
    expect(r.rows.map((x: any) => x.name)).toEqual(["esx-01"]);
    expect(r.steps.length).toBe(3);
  });
});
