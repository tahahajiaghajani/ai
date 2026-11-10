// Regressions of the release / DevOps review: a deployment binds only a change or release its author may work (and a
// pipeline only what it names, for its service and group); people's new records start in their first state; an
// approval is never reused for another environment, version or change; a closed failure is not a success; failures an
// incident caused are restored; gates are idempotent per run and resolve named changes like the webhooks; DORA reads
// every production deployment; window capacity is per occurrence; a replayed signed body is a duplicate however late.
import { createHmac } from "node:crypto";
import { describe, expect, it, beforeAll } from "vitest";
import { world, at, type World } from "./release-helpers";
import { doraMetrics, deploymentOutcome } from "@shared/devops/logic";
import { occurrences } from "@shared/change/logic";
import { windowLike } from "@server/modules/release/checks";

let w: World;
let generic: { id: string; key: string; secret: string };
let otherConn: { id: string; key: string; secret: string };

const sign = (s: string, raw: string) => `sha256=${createHmac("sha256", s).update(raw).digest("hex")}`;

async function send(conn: { key: string; secret: string }, body: unknown, headers: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  const res = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/hooks/${conn.key}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.70", "x-hub-signature-256": sign(conn.secret, raw), ...headers }, body: raw }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function gate(conn: { key: string; secret: string }, input: Record<string, unknown>) {
  const raw = JSON.stringify(input);
  const res = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/gates/${conn.key}`, { method: "POST", headers: { "content-type": "application/json", "x-signature-256": sign(conn.secret, raw), "x-forwarded-for": "203.0.113.71" }, body: raw }));
  return { status: res.status, body: await res.json() };
}

const approvalsOf = async (table: string, id: string) => (await w.o.get(`${w.P}/approvals/record/${table}/${id}`)).approvals as Record<string, any>[];

async function standardChange(group = w.g.team, who = w.p.dev.client): Promise<Record<string, any>> {
  const cat = await who.get(`${w.P}/change/catalog`);
  const t = (cat.items as Record<string, any>[]).find((x) => x.name.includes("خط لوله"))!;
  return (await who.post(`${w.P}/change/catalog/${t.id}/order`, { assignment_group_id: group, planned_start: at(0, 1), planned_end: at(0, 2), submit: true })).change;
}

async function connection(name: string, group: string) {
  const made = (await w.p.rm.client.post(`${w.P}/r/devops_connection`, { name, kind: "generic", auto_change: true, assignment_group_id: group })).row;
  const secret = (await w.p.rm.client.post(`${w.P}/devops/connections/${made.id}/secret`, {})).secret as string;
  return { id: made.id as string, key: made.hook_key as string, secret };
}

beforeAll(async () => {
  w = await world();
  await w.p.rm.client.post(`${w.P}/devops/seed`, {});
  generic = await connection("خط لولهٔ تیم پرتال", w.g.team);
  otherConn = await connection("خط لولهٔ تیم شبکه", w.g.others);
}, 120_000);

const deploy = (id: string, environment: string, status: string, extra: Record<string, unknown> = {}) => ({ type: "deployment", id, environment, status, version: "5.0.0", repository: "acme/net", pipeline: "net", ...extra });

describe("a deployment binds only what its author may work (release-deploy-change-hijack)", () => {
  it("a person cannot drive another group's change or release through a deployment", async () => {
    const change = await standardChange();
    expect(change.state).toBe("scheduled");
    // the other group's engineer may not transition the change himself …
    await w.p.other.client.post(`${w.P}/r/change_request/${change.id}/transition`, { to: "implement", version: change.version }, 403);
    // … nor bind it to a deployment of his own group
    await w.p.other.client.post(`${w.P}/r/deployment`, { environment_id: w.env.test, artifact_version: "1.0.0", assignment_group_id: w.g.others, change_id: change.id }, 403);
    const own = (await w.p.other.client.post(`${w.P}/r/deployment`, { environment_id: w.env.test, artifact_version: "1.0.0", assignment_group_id: w.g.others })).row;
    await w.p.other.client.patch(`${w.P}/r/deployment/${own.id}`, { change_id: change.id, version: own.version }, 403);
    const rel = await w.release({ short_description: "انتشار تیم پرتال برای پیوند" });
    await w.p.other.client.patch(`${w.P}/r/deployment/${own.id}`, { release_id: rel.id, version: own.version }, 403);
    await w.drain();
    expect((await w.get("change_request", change.id)).state).toBe("scheduled");
  });

  it("a pipeline never binds a change or release a commit message only mentions", async () => {
    const change = await standardChange();
    const rel = await w.release({ short_description: "انتشار تیم پرتال (اشاره در کامیت)" });
    const r = await send(otherConn, deploy("hj-1", "prod", "succeeded", { commits: [{ sha: "c-hj", message: `see ${change.number.replace(/^CHG0*/, "CHG-")} and ${rel.number}`, at: new Date().toISOString() }] }), { "x-delivery-id": "hj-1" });
    expect(r.body.status).toBe("processed");
    expect(r.body.result.change).not.toBe(change.id);
    expect(r.body.result.auto_change).toMatch(/^CHG/);
    await w.drain();
    expect((await w.get("change_request", change.id)).state).toBe("scheduled");
    const relAfter = await w.get("release", rel.id);
    expect(relAfter.deployed_at ?? null).toBeNull();
    expect((await w.get("deployment", r.body.result.deployment)).release_id ?? null).toBeNull();
  });

  it("a pipeline that names another group's change is refused it, and gets no automatic change instead", async () => {
    const change = await standardChange();
    const r = await send(otherConn, deploy("hj-2", "prod", "succeeded", { change: change.number }), { "x-delivery-id": "hj-2" });
    expect(r.body.status).toBe("processed");
    expect(r.body.result.change).toBeNull();
    expect(r.body.result.auto_change).toBeNull();
    expect(String(r.body.result.refused)).toContain("گروه دیگری");
    await w.drain();
    expect((await w.get("change_request", change.id)).state).toBe("scheduled");
  });

  it("a change the pipeline names for its own group follows it to review, and only a change made for it is closed", async () => {
    const change = await standardChange();
    const r = await send(generic, deploy("own-1", "prod", "succeeded", { change: change.number.replace(/^CHG0*/, "chg-"), repository: "acme/portal", pipeline: "portal" }), { "x-delivery-id": "own-1" });
    expect(r.body.result.change).toBe(change.id);
    await w.drain();
    const after = await w.get("change_request", change.id);
    expect(after.state).toBe("review");
    expect(after.close_code).toBe("successful");
  });
});

describe("people's records start in the first state (release-create-skips-gates)", () => {
  it("a release, a deployment, a defect and a booking cannot be created in a later state", async () => {
    const r = await w.p.dev.client.post(`${w.P}/r/release`, { short_description: "انتشار پرشی", version_name: "9.0", type: "minor", assignment_group_id: w.g.team, planned_start: at(1), planned_end: at(10, 18), state: "deploying" }, 403);
    expect(JSON.stringify(r)).toContain("پیش‌نویس");
    await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.prod, artifact_version: "9.9.9", assignment_group_id: w.g.team, state: "in_progress" }, 403);
    await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.test, artifact_version: "9.9.9", assignment_group_id: w.g.team, state: "succeeded" }, 403);
    await w.p.dev.client.post(`${w.P}/r/defect`, { short_description: "نقص بسته", severity: "low", state: "verified" }, 403);
    // the first state is fine
    const ok = (await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.test, artifact_version: "9.9.9", assignment_group_id: w.g.team, state: "planned" })).row;
    expect(ok.state).toBe("planned");
  });
});

describe("an approval is for what was approved (release-deploy-approval-reused)", () => {
  it("environment, version and change stay as approved", async () => {
    let dep = (await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.staging, artifact_version: "1.0.0", assignment_group_id: w.g.team })).row;
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "pending_approval", version: dep.version })).row;
    await w.drain();
    const mine = (await approvalsOf("deployment", dep.id)).find((a) => a.approver_id === w.p.rm.userId && a.state === "requested");
    await w.p.rm.client.post(`${w.P}/approvals/${mine!.id}/decide`, { decision: "approved" });
    await w.drain();
    dep = await w.get("deployment", dep.id, w.p.dev.client);
    expect(dep.approval).toBe("approved");
    // while waiting or approved, and after going back to «planned», nothing that was approved changes
    await w.p.dev.client.patch(`${w.P}/r/deployment/${dep.id}`, { environment_id: w.env.prod, version: dep.version }, 409);
    await w.p.dev.client.patch(`${w.P}/r/deployment/${dep.id}`, { artifact_version: "7.7.7", version: dep.version }, 409);
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "planned", version: dep.version })).row;
    await w.p.dev.client.patch(`${w.P}/r/deployment/${dep.id}`, { environment_id: w.env.prod, version: dep.version }, 409);
    expect((await w.get("deployment", dep.id)).environment_id).toBe(w.env.staging);
  });

  it("a running deployment in an open environment is not moved to production", async () => {
    let dep = (await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.test, artifact_version: "1.0.1", assignment_group_id: w.g.team })).row;
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "in_progress", version: dep.version })).row;
    await w.p.dev.client.patch(`${w.P}/r/deployment/${dep.id}`, { environment_id: w.env.prod, version: dep.version }, 409);
    await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "succeeded", version: dep.version, data: { environment_id: w.env.prod } }, 409);
  });
});

describe("a closed failure is not a success (release-closed-counted-success)", () => {
  it("the outcome of a closed deployment is its close code", () => {
    expect(deploymentOutcome({ state: "closed", close_code: "failed" })).toBe("failed");
    expect(deploymentOutcome({ state: "closed", close_code: "successful" })).toBe("ok");
    expect(deploymentOutcome({ state: "closed", close_code: null })).toBeNull();
    const now = Date.now();
    const m = doraMetrics([
      { id: "a", at: now - 60_000, state: "failed", change_failure: true },
      { id: "b", at: now - 30_000, state: "closed", close_code: "failed", change_failure: true },
    ], { from: now - 86_400_000, to: now });
    expect(m.successful).toBe(0);
    expect(m.failures).toBe(2);
    expect(m.frequency.band).toBe("none");
  });

  it("a failed test deployment that is closed does not pass the readiness check", async () => {
    const rel = await w.release({ short_description: "انتشار با آزمون ناموفق" });
    let dep = (await w.p.dev.client.post(`${w.P}/r/deployment`, { environment_id: w.env.test, release_id: rel.id, artifact_version: "2.4.0", assignment_group_id: w.g.team })).row;
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "in_progress", version: dep.version })).row;
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "failed", version: dep.version, data: { result_notes: "آزمون دود رد شد" } })).row;
    dep = (await w.p.dev.client.post(`${w.P}/r/deployment/${dep.id}/transition`, { to: "closed", version: dep.version })).row;
    expect(dep.close_code).toBe("failed");
    await w.drain();
    const run = await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/checks/run`, {});
    const check = (run.checks as Record<string, any>[]).find((c) => c.rule === "test_deploy_ok");
    expect(check).toBeTruthy();
    expect(check!.status).toBe("fail");
  });

  it("closing a failed production deployment restores nothing", async () => {
    const a = await send(generic, deploy("cf-1", "prod", "failed", { pipeline: "closing", description: "x" }), { "x-delivery-id": "cf-1" });
    const b = await send(generic, deploy("cf-2", "prod", "failed", { pipeline: "closing", description: "y" }), { "x-delivery-id": "cf-2" });
    await w.drain();
    let second = await w.get("deployment", b.body.result.deployment, w.p.rm.client);
    second = (await w.p.rm.client.post(`${w.P}/r/deployment/${second.id}/transition`, { to: "closed", version: second.version })).row;
    await w.drain();
    expect((await w.get("deployment", a.body.result.deployment)).restored_at ?? null).toBeNull();
  });
});

describe("failures an incident caused are restored (release-dora-incident-failures)", () => {
  it("the next success in the environment restores a deployment an incident was caused by", async () => {
    const first = await send(generic, deploy("ic-1", "prod", "succeeded", { pipeline: "incidents" }), { "x-delivery-id": "ic-1" });
    await w.drain();
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "خطای پس از استقرار", impact: "2", urgency: "2" })).row;
    await w.o.post(`${w.P}/r/incident/${inc.id}/links`, { kind: "caused_by", table: "deployment", id: first.body.result.deployment });
    await w.drain();
    expect((await w.get("deployment", first.body.result.deployment)).change_failure).toBe(true);
    const next = await send(generic, deploy("ic-2", "prod", "succeeded", { pipeline: "incidents" }), { "x-delivery-id": "ic-2" });
    await w.drain();
    const restored = await w.get("deployment", first.body.result.deployment);
    expect(restored.restored_at).toBe((await w.get("deployment", next.body.result.deployment)).actual_end);
  });

  it("a deployment found to have caused an incident after the next success is restored by that success", async () => {
    const first = await send(generic, deploy("il-1", "prod", "succeeded", { pipeline: "late" }), { "x-delivery-id": "il-1" });
    const next = await send(generic, deploy("il-2", "prod", "succeeded", { pipeline: "late" }), { "x-delivery-id": "il-2" });
    await w.drain();
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "خطای دیرهنگام", impact: "2", urgency: "2" })).row;
    await w.o.post(`${w.P}/r/incident/${inc.id}/links`, { kind: "caused_by", table: "deployment", id: first.body.result.deployment });
    await w.drain();
    const restored = await w.get("deployment", first.body.result.deployment);
    expect(restored.change_failure).toBe(true);
    expect(restored.restored_at).toBe((await w.get("deployment", next.body.result.deployment)).actual_end);
  });
});

describe("the gate per run (release-gate-standard-change-dup)", () => {
  it("a retried run is the same gate with one change, which its deployment takes and closes", async () => {
    const one = await gate(generic, { environment: "prod", version: "6.0.0", run: "run-88" });
    const two = await gate(generic, { environment: "prod", version: "6.0.0", run: "run-88" });
    expect(one.body.state).toBe("approved");
    expect(two.body.id).toBe(one.body.id);
    expect(one.body.change).toMatch(/^CHG/);
    const changes = (await w.p.rm.client.get(`${w.P}/r/change_request?size=200`)).rows as Record<string, any>[];
    expect(changes.filter((c) => c.external_ref === "deploy:gate:run-88").length).toBe(1);
    const dep = await send(generic, deploy("g-88", "prod", "succeeded", { run: "run-88", repository: "acme/portal", pipeline: "portal" }), { "x-delivery-id": "g-88" });
    expect(dep.body.result.auto_change).toBeNull();
    await w.drain();
    const change = (await w.p.rm.client.get(`${w.P}/r/change_request?size=200`)).rows.find((c: any) => c.number === one.body.change);
    expect(dep.body.result.change).toBe(change.id);
    expect((await w.get("change_request", change.id)).state).toBe("closed");
  });

  it("a named change is found in any form and never replaced by an automatic one", async () => {
    const change = await standardChange();
    const moved = (await w.p.dev.client.post(`${w.P}/r/change_request/${change.id}/transition`, { to: "implement", version: change.version })).row;
    const reviewed = (await w.p.dev.client.post(`${w.P}/r/change_request/${change.id}/transition`, { to: "review", version: moved.version, data: { close_code: "successful" } })).row;
    expect(reviewed.state).toBe("review");
    const dashed = change.number.replace(/^CHG0*/, "CHG-");
    const p = await gate(generic, { environment: "prod", version: "6.1.0", change: dashed, run: "run-89" });
    expect(p.status).toBe(202);
    expect(p.body.state).toBe("pending");
    const unknown = await gate(generic, { environment: "prod", version: "6.1.0", change: "CHG-999999", run: "run-90" });
    expect(unknown.body.state).toBe("pending");
    const changes = (await w.p.rm.client.get(`${w.P}/r/change_request?size=200`)).rows as Record<string, any>[];
    expect(changes.some((c) => ["deploy:gate:run-89", "deploy:gate:run-90"].includes(c.external_ref))).toBe(false);
  });
});

describe("DORA reads every production deployment (release-dora-500-cap)", () => {
  it("counts more than one page of deployments", async () => {
    const base = await send(generic, deploy("many-0", "prod", "succeeded", { pipeline: "bulk" }), { "x-delivery-id": "many-0" });
    const id = base.body.result.deployment as string;
    const cols = (await w.e.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'sm_deployments' and is_generated = 'NEVER' order by ordinal_position`)).map((c) => c.column_name);
    const pick = (c: string) => (c === "id" ? "gen_random_uuid()" : c === "no" ? "t.no + g" : c === "external_id" ? "t.external_id || '-' || g" : c === "actual_end" ? "t.actual_end - (g || ' minutes')::interval" : `t.${c}`);
    await w.e.db.query(`insert into sm_deployments (${cols.join(", ")}) select ${cols.map(pick).join(", ")} from sm_deployments t cross join generate_series(1, 620) g where t.id = $1`, [id]);
    const dora = await w.p.rm.client.get(`${w.P}/devops/dora?days=30`);
    expect(dora.overall.deployments).toBeGreaterThan(620);
    expect(dora.truncated).toBe(false);
    const pipe = await w.p.rm.client.get(`${w.P}/devops/pipeline?days=30`);
    expect(pipe.truncated).toBe(false);
  });
});

describe("a window's capacity is per occurrence (release-window-capacity-total)", () => {
  it("the weekly train holds three releases each Tuesday", async () => {
    const wins = (await w.o.get(`${w.P}/r/release_window?size=50`)).rows as Record<string, any>[];
    const train = wins.find((x) => x.recurrence === "weekly" && Number(x.capacity) === 3)!;
    expect(train).toBeTruthy();
    const slots = occurrences(windowLike(train), Date.now() + 8 * 86_400_000, Date.now() + 60 * 86_400_000, "Asia/Tehran").slice(0, 4);
    expect(slots.length).toBe(4);
    const on = (o: { start: number }, n: number) => w.release({ short_description: `قطار ${n}`, window_id: train.id, planned_start: new Date(o.start - 86_400_000).toISOString(), planned_end: new Date(o.start + 3_600_000).toISOString() });
    for (let i = 0; i < 4; i++) await on(slots[i], i);
    // two more on the first Tuesday fill it; the next one is refused
    await on(slots[0], 10);
    await on(slots[0], 11);
    await w.p.dev.client.post(`${w.P}/r/release`, { short_description: "قطار پر", version_name: "2.5", type: "minor", assignment_group_id: w.g.team, window_id: train.id, planned_start: new Date(slots[0].start - 86_400_000).toISOString(), planned_end: new Date(slots[0].start + 3_600_000).toISOString() }, 409);
  });
});

describe("replays (release-webhook-replay)", () => {
  it("a signed body sent again later under a fresh delivery header is a duplicate", async () => {
    const body = { type: "flag", key: "checkout-v2", state: "on" };
    const first = await send(generic, body, { "idempotency-key": "flag-1" });
    expect(first.body.status).toBe("processed");
    await w.e.db.query(`update sm_dev_events set received_at = received_at - interval '3 days', created_at = created_at - interval '3 days' where org_id = $1 and delivery_id = 'flag-1'`, [w.e.org]);
    const replay = await send(generic, body, { "idempotency-key": "flag-2" });
    expect(replay.body.status).toBe("duplicate");
    // the id inside the signed body wins over the headers
    const withId = { type: "flag", key: "checkout-v3", state: "on", delivery_id: "body-1" };
    expect((await send(generic, withId, { "idempotency-key": "h-1" })).body.status).toBe("processed");
    const events = (await w.p.rm.client.get(`${w.P}/r/dev_event?size=100`)).rows as Record<string, any>[];
    expect(events.some((e) => e.delivery_id === "body-1")).toBe(true);
  });
});
