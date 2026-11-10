// Configuration management with the other modules, on real rows: the CMDB is the change module's impact provider —
// a change's CIs compute its impacted services through the dependency graph, a change on a neighbouring CI is an
// indirect («پیکربندی وابسته») conflict, approval rules «مالک خدمت» / «تأییدکنندگان تغییر خدمت» ask the owners of the
// services the change reaches; what-if simulations saved for a change show on it; the affected services of an
// incident's CI (POST /service_portfolio/affected).
import { beforeAll, describe, expect, it } from "vitest";
import { at, world, type World } from "./change-helpers";
import type { Client } from "./helpers";
import { impactProvider } from "@server/modules/change";
import { CMDB_IMPACT_PROVIDER, recordOwners } from "@server/modules/cmdb";

let w: World;
let owner: { client: Client; userId: string };
let ciOwner: { client: Client; userId: string };
const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });
let approvers = "";
let svc: Record<string, any>;
let app = "";
let host = "";
let other = "";

const conflictsOf = async (id: string) =>
  (await w.o.get(`${w.P}/r/change_conflict?filter=${encodeURIComponent(JSON.stringify({ f: "change_id", op: "eq", v: id }))}&size=50`)).rows as Record<string, any>[];

beforeAll(async () => {
  w = await world();
  const { o, P, e } = w;
  await o.post(`${P}/cmdb/seed`, {});
  await o.post(`${P}/service_portfolio/seed`, {});
  owner = await e.member("member", "svc-owner@example.com");
  ciOwner = await e.member("member", "ci-owner@example.com");
  const approver = await e.member("member", "svc-approver@example.com");
  for (const m of [owner, ciOwner, approver]) await o.put(`${P}/access/members/${m.userId}`, { roles: ["agent"], persona: "agent" });
  approvers = (await o.post(`${P}/r/group`, { name: "تأییدکنندگان تغییر پرداخت", types: ["approval"] })).row.id;
  await o.post(`${P}/access/groups/${approvers}/members`, { user_ids: [approver.userId] });
  // a live service whose application runs on a server
  svc = (await o.post(`${P}/r/service`, { name: "پرداخت آنلاین", service_type: "business", description: "درگاه پرداخت", owner_id: owner.userId, change_approval_group_id: approvers })).row;
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "approved" });
  const off = (await o.post(`${P}/r/service_offering`, { name: "استاندارد", service_id: svc.id })).row;
  await o.post(`${P}/r/service_offering/${off.id}/transition`, { to: "active" });
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "live" });
  svc = (await o.get(`${P}/r/service/${svc.id}`)).row;
  app = await w.ci("نرم‌افزار درگاه پرداخت", { class: "application" });
  host = await w.ci("pay-app-01", { owned_by: ciOwner.userId });
  other = await w.ci("pay-db-01", { class: "database" });
  await o.post(`${P}/r/ci_rel`, { parent_id: svc.ci_id, type: "depends_on", child_id: app });
  await o.post(`${P}/r/ci_rel`, { parent_id: app, type: "runs_on", child_id: host });
  await o.post(`${P}/r/ci_rel`, { parent_id: app, type: "depends_on", child_id: other });
  await w.drain();
}, 240_000);

describe("the CMDB as the change module's impact provider", () => {
  it("is registered by the CMDB", () => {
    expect(impactProvider()).toBe(CMDB_IMPACT_PROVIDER);
  });

  it("a change on a server records the services its failure reaches; the impact view says the CMDB is connected", async () => {
    const c = await w.change({ ci_id: host });
    expect(c.impacted_services).toEqual([svc.id]);
    const v = await w.p.agent.client.get(`${w.P}/change/records/${c.id}/impact`);
    expect(v.provider).toBe(true);
    expect(v.impacted).toEqual([svc.id]);
    // a CI nothing depends on reaches no service
    const lone = await w.change({ ci_id: await w.ci("سرور آزمایشی") });
    expect(lone.impacted_services).toEqual([]);
  });

  it("a change on a neighbouring CI at the same time is an indirect conflict", async () => {
    // two CIs next to each other that reach no service (a shared service would be the direct conflict)
    const web = await w.ci("web-lab-01");
    const store = await w.ci("nas-lab-01", { class: "storage" });
    await w.o.post(`${w.P}/r/ci_rel`, { parent_id: web, type: "depends_on", child_id: store });
    const a = await w.change({ ci_id: web, planned_start: at(30, 8), planned_end: at(30, 10) });
    const b = await w.change({ ci_id: store, planned_start: at(30, 9), planned_end: at(30, 11) });
    await w.move(a.id, ["assess"]);
    await w.move(b.id, ["assess"]);
    await w.drain();
    const kinds = (await conflictsOf(b.id)).map((x) => x.kind);
    expect(kinds).toContain("related_ci");
    expect((await w.get(b.id)).conflict_status).toBe("conflict");
  });

  it("«مالک خدمت» and «تأییدکنندگان تغییر خدمت» ask the owners and approvers of the impacted services", async () => {
    const { P, e } = w;
    // the CI owner and the service owner, from the change's own fields
    expect((await recordOwners(e.db, w.sys, { ci_id: host, impacted_services: [svc.id] })).sort()).toEqual([owner.userId, ciOwner.userId].sort());
    // the moderate-risk rule asks the service's owners and its change approvers instead of the change manager
    const rule = (await w.o.get(`${P}/r/approval_rule?size=50`)).rows.find((r: any) => r.table_key === "change_request" && r.name.includes("ریسک متوسط"));
    await e.db.query("update sm_approval_rules set levels = $2::jsonb where id = $1", [
      rule.id,
      JSON.stringify([{ name: "مالکان خدمت", sources: [{ kind: "owner", of: "service_owner" }, { kind: "owner", of: "service_change_approvers" }], rule: "all" }]),
    ]);
    try {
      const c = await w.change({ ...manual("moderate"), ci_id: host });
      const r = await w.move(c.id, ["assess", "authorize"]);
      expect(r.state).toBe("authorize");
      const asked = (await w.approvals(c.id)).map((a) => a.approver_id).sort();
      const approver = (await w.o.get(`${P}/r/group_member?filter=${encodeURIComponent(JSON.stringify({ f: "group_id", op: "eq", v: approvers }))}`)).rows.map((m: any) => m.user_id);
      expect(asked).toEqual([owner.userId, ciOwner.userId, ...approver].sort());
    } finally {
      await e.db.query("update sm_approval_rules set levels = $2::jsonb where id = $1", [rule.id, JSON.stringify(rule.levels)]);
    }
  });

  it("a what-if simulation saved for a change shows on the change", async () => {
    const c = await w.change({ ci_id: host });
    const saved = await w.p.agent.client.post(`${w.P}/cmdb/impact/save`, { name: "اثر ارتقای سرور", ci_ids: [host], state: "down", linked_table: "change_request", linked_id: c.id });
    expect(saved.summary).toBeTruthy();
    const v = await w.p.agent.client.get(`${w.P}/change/records/${c.id}/impact`);
    expect(v.simulations.map((s: any) => [s.id, s.mine])).toEqual([[saved.id, true]]);
    // the change manager reviewing the change reads the analysis kept with it (not the author's record itself)
    const cm = await w.p.cm.client.get(`${w.P}/change/records/${c.id}/impact`);
    expect(cm.simulations).toMatchObject([{ id: saved.id, mine: false, summary: saved.summary }]);
    await w.p.cm.client.get(`${w.P}/r/ci_impact_sim/${saved.id}`, 404);
    const sim = (await w.p.agent.client.get(`${w.P}/r/ci_impact_sim/${saved.id}`)).row;
    expect(sim).toMatchObject({ linked_table: "change_request", linked_id: c.id });
  });
});

describe("incidents and problems name real CIs", () => {
  it("the affected services of an incident's CI, and the CI's side panel data", async () => {
    const { P, p } = w;
    const inc = (await p.agent.client.post(`${P}/r/incident`, { short_description: "درگاه پرداخت کند است", ci_id: host, assignment_group_id: w.g.network })).row;
    expect(inc.ci_id).toBe(host);
    const affected = await p.agent.client.post(`${P}/service_portfolio/affected`, { ci_ids: [inc.ci_id] });
    expect(affected.services.map((s: any) => s.id)).toEqual([svc.id]);
    const saved = await p.agent.client.patch(`${P}/r/incident/${inc.id}`, { affected_services: affected.services.map((s: any) => s.id), version: inc.version });
    expect(saved.row.affected_services).toEqual([svc.id]);
    // the service owner reads the incident linked to their service (roles in context)
    expect((await owner.client.get(`${P}/r/incident/${inc.id}`)).row.id).toBe(inc.id);
    // a problem on the same CI
    const prb = (await p.agent.client.post(`${P}/r/problem`, { short_description: "کندی تکراری درگاه پرداخت", ci_id: host, assignment_group_id: w.g.network })).row;
    expect(prb.ci_id).toBe(host);
  });
});
