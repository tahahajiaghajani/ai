// Release management with the modules around it: a deployment to a protected environment needs the release
// managers' approval and (in production) an authorized change, which then follows the deployment; incidents after a
// production deployment are tagged as suspects and, once confirmed «ناشی از», count as a failed change; early life
// support tags incidents; release notes and the briefing answer without AI; and access (a requester, an engineer of
// another group, an auditor).
import { describe, expect, it, beforeAll } from "vitest";
import { world, at, type World } from "./release-helpers";

let w: World;
let service = "";

const approvalsOf = async (table: string, id: string) => (await w.o.get(`${w.P}/approvals/record/${table}/${id}`)).approvals as Record<string, any>[];

beforeAll(async () => {
  w = await world();
  service = (await w.o.post(`${w.P}/r/service`, { name: "پرتال کارکنان", service_type: "business", description: "پرتال خدمات کارکنان", owner_id: w.e.ownerId })).row.id;
  // the pipeline's standard change (no tasks) comes with the DevOps defaults
  await w.p.rm.client.post(`${w.P}/devops/seed`, {});
}, 120_000);

async function standardChange(): Promise<Record<string, any>> {
  const cat = await w.p.dev.client.get(`${w.P}/change/catalog`);
  const t = (cat.items as Record<string, any>[]).find((x) => x.name.includes("خط لوله"))!;
  const r = await w.p.dev.client.post(`${w.P}/change/catalog/${t.id}/order`, { assignment_group_id: w.g.team, planned_start: at(0, 1), planned_end: at(0, 2), submit: true });
  return r.change;
}

describe("deployments to protected environments", () => {
  it("staging needs the release managers' approval before it starts", async () => {
    let dep = (await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.staging, artifact_version: "1.0.0", assignment_group_id: w.g.team, ...(service ? { service_id: service } : {}) })).row;
    expect(dep.is_production).toBe(false);
    await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "in_progress", version: dep.version }, 409);
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "pending_approval", version: dep.version })).row;
    await w.drain();
    const approvals = await approvalsOf("deployment", dep.id);
    const mine = approvals.find((a) => a.approver_id === w.p.rm.userId && a.state === "requested");
    expect(mine).toBeTruthy();
    // the engineer who carries it out is never asked
    expect(approvals.some((a) => a.approver_id === w.p.dev.userId)).toBe(false);
    await w.p.rm.client.post(`${w.P}/approvals/${mine!.id}/decide`, { decision: "approved", comment: "مجاز" });
    await w.drain();
    dep = await w.get("deployment", dep.id, w.p.dev.client);
    expect(dep.approval).toBe("approved");
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "in_progress", version: dep.version })).row;
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "succeeded", version: dep.version })).row;
    expect(dep.duration).toBeGreaterThanOrEqual(0);
  });

  it("production needs an authorized change, which then follows the deployment", async () => {
    let dep = (await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.prod, artifact_version: "1.0.0", assignment_group_id: w.g.team, rollback_plan: "بازگرداندن نسخهٔ پیشین" })).row;
    expect(dep.is_production).toBe(true);
    expect(dep.policy_note).toContain("بدون تغییر مجاز");
    const change = await standardChange();
    expect(change.state).toBe("scheduled");
    dep = (await w.p.dev.client.patch(`${w.P}/r/deployment/${dep.id}`, { change_id: change.id, version: dep.version })).row;
    expect(dep.policy_note ?? null).toBeNull();
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "pending_approval", version: dep.version })).row;
    await w.drain();
    const mine = (await approvalsOf("deployment", dep.id)).find((a) => a.approver_id === w.p.rm.userId && a.state === "requested");
    await w.p.rm.client.post(`${w.P}/approvals/${mine!.id}/decide`, { decision: "approved" });
    await w.drain();
    dep = await w.get("deployment", dep.id, w.p.dev.client);
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "in_progress", version: dep.version })).row;
    await w.drain();
    expect((await w.get("change_request", change.id)).state).toBe("implement");
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "succeeded", version: dep.version })).row;
    await w.drain();
    const after = await w.get("change_request", change.id);
    expect(after.state).toBe("review");
    expect(after.close_code).toBe("successful");
  });
});

describe("incidents after deployments", () => {
  it("tags early life support and suspects, and counts a confirmed cause as a failed change", async () => {
    // an emergency release goes straight to its decision; the release manager waives what blocks and decides Go
    const rel = await w.release({ type: "emergency", short_description: "رفع فوری پرتال", service_id: service, planned_start: at(0), planned_end: at(1) });
    await w.drain();
    let r = await w.get("release", rel.id, w.p.dev.client);
    r = (await w.p.dev.client.post(`${w.P}/r/release/${rel.id}/transition`, { to: "readiness", version: r.version })).row;
    await w.drain();
    const run = await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/checks/run`, {});
    for (const c of run.checks as Record<string, any>[]) {
      if (c.blocking !== false && !["pass", "waived", "na"].includes(c.status)) await w.p.rm.client.post(`${w.P}/release/records/${rel.id}/checks/${c.id}/waive`, { reason: "رویهٔ اضطراری" });
    }
    await w.p.rm.client.post(`${w.P}/release/records/${rel.id}/decide`, { decision: "go", rationale: "رفع فوری لازم است" });
    r = await w.get("release", rel.id, w.p.dev.client);
    r = (await w.p.dev.client.post(`${w.P}/r/release/${rel.id}/transition`, { to: "deploying", version: r.version })).row;
    // the engineer deploys to production with the pipeline's standard change; a release manager approves
    const change = await standardChange();
    let dep = (await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.prod, release_id: rel.id, change_id: change.id, artifact_version: "2.0.1", assignment_group_id: w.g.team })).row;
    expect(dep.service_id).toBe(service);
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "pending_approval", version: dep.version })).row;
    await w.drain();
    const mine = (await approvalsOf("deployment", dep.id)).find((a) => a.approver_id === w.p.rm.userId && a.state === "requested");
    await w.p.rm.client.post(`${w.P}/approvals/${mine!.id}/decide`, { decision: "approved" });
    await w.drain();
    dep = await w.get("deployment", dep.id, w.p.dev.client);
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "in_progress", version: dep.version })).row;
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "succeeded", version: dep.version })).row;
    await w.drain();
    r = await w.get("release", rel.id);
    expect(r.state).toBe("els");
    expect(r.deployed_at).toBeTruthy();
    expect(r.released_at).toBeTruthy();
    expect(r.els_end_at).toBeTruthy();
    // a new incident on the service: early life support and a suspect deployment
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "پرتال کند است", service_id: service, impact: "2", urgency: "2" })).row;
    await w.drain();
    const links = (await w.o.get(`${w.P}/r/incident/${inc.id}/links`)).links as Record<string, any>[];
    expect(links.some((l) => l.kind === "after_deployment" && l.other.id === dep.id)).toBe(true);
    expect(links.some((l) => l.kind === "els_incident" && l.other.id === rel.id)).toBe(true);
    expect((await w.get("release", rel.id)).els_incidents).toBe(1);
    // a person confirms the cause: the deployment counts as a failed change
    await w.o.post(`${w.P}/r/incident/${inc.id}/links`, { kind: "caused_by", table: "deployment", id: dep.id });
    await w.drain();
    const failed = await w.get("deployment", dep.id);
    expect(failed.incidents_caused).toBeGreaterThanOrEqual(1);
    expect(failed.change_failure).toBe(true);
  });
});

describe("notes and briefing without AI", () => {
  it("drafts release notes from the scope and saves them as a draft note", async () => {
    const rel = await w.release({ short_description: "انتشار با یادداشت" });
    const change = (await w.p.dev.client.post(`${w.P}/r/change_request`, { short_description: "افزودن ورود دومرحله‌ای", type: "normal", assignment_group_id: w.g.team })).row;
    const scope = await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/scope`, { table: "change_request", ids: [change.id] });
    expect(scope.added).toEqual([change.id]);
    await w.drain();
    expect((await w.get("release", rel.id)).changes_total).toBe(1);
    const draft = await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/notes/draft`, { audience: "operations" });
    expect(draft.ai).toBe(false);
    expect(draft.body).toContain("ورود دومرحله‌ای");
    expect(draft.body).toContain(change.number);
    const users = await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/notes/draft`, { audience: "end_users", save: true });
    expect(users.body).not.toContain(change.number);
    expect(users.note.state).toBe("draft");
    expect(users.note.sources.length).toBe(1);
    const brief = await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/briefing`, {});
    expect(brief.ai).toBe(false);
    expect(brief.text).toContain(rel.number);
  });
});

describe("a change for a release", () => {
  it("creates a normal change with the release's plans, linked «شامل»", async () => {
    const rel = await w.release({ short_description: "انتشار با تغییر", deployment_plan: "استقرار در دو موج", test_plan: "آزمون دود" });
    const ch = await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/change`, {});
    expect(ch.type).toBe("normal");
    expect(ch.implementation_plan).toBe("استقرار در دو موج");
    expect(ch.backout_plan).toContain("بازگرداندن");
    await w.drain();
    expect((await w.get("release", rel.id)).changes_total).toBe(1);
    await w.p.other.client.post(`${w.P}/release/records/${rel.id}/change`, {}, 403);
  });
});

describe("access", () => {
  it("keeps releases from requesters, lets other engineers read but not change, auditors read only", async () => {
    const rel = await w.release({ short_description: "انتشار تیم پرتال" });
    await w.p.req.client.get(`${w.P}/r/release?size=5`, 403);
    await w.p.req.client.get(`${w.P}/release/roadmap?from=${encodeURIComponent(at(-10))}&to=${encodeURIComponent(at(30))}`, 403);
    const seen = await w.p.other.client.get(`${w.P}/r/release/${rel.id}`);
    expect(seen.row.id).toBe(rel.id);
    await w.p.other.client.patch(`${w.P}/r/release/${rel.id}`, { description: "تغییر", version: rel.version }, 403);
    await w.p.other.client.post(`${w.P}/release/records/${rel.id}/checks/run`, {}, 403);
    const roadmap = await w.p.auditor.client.get(`${w.P}/release/roadmap?from=${encodeURIComponent(at(-10))}&to=${encodeURIComponent(at(30))}`);
    expect(roadmap.releases.some((r: any) => r.id === rel.id)).toBe(true);
    await w.p.auditor.client.post(`${w.P}/r/release`, { short_description: "ممیز", type: "minor" }, 403);
    await w.p.auditor.client.post(`${w.P}/release/records/${rel.id}/decide`, { decision: "go", rationale: "ممیز" }, 403);
    // DevOps connections (secrets) are the release manager's
    await w.p.dev.client.post(`${w.P}/r/devops_connection`, { name: "اتصال من", kind: "generic" }, 403);
  });
});

describe("roadmap («نقشهٔ راه انتشار»)", () => {
  it("counts the open releases that have no planned release date — they have no bar on it (click-through QA)", async () => {
    const q = `from=${encodeURIComponent(at(-10))}&to=${encodeURIComponent(at(30))}`;
    const before = (await w.o.get(`${w.P}/release/roadmap?${q}`)).unscheduled as number;
    const rel = await w.release({ short_description: "انتشار بی‌تاریخ", planned_start: null, planned_end: null });
    const after = await w.o.get(`${w.P}/release/roadmap?${q}`);
    expect(after.unscheduled).toBe(before + 1);
    expect(after.releases.some((r: any) => r.id === rel.id)).toBe(false);
    // the type filter applies to the count too
    expect((await w.o.get(`${w.P}/release/roadmap?${q}&type=major`)).unscheduled).toBe(0);
  });
});
