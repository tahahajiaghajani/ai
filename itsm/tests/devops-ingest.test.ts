// DevOps: signed webhooks (HMAC, GitLab token, idempotency, rate limit), normalisation into commits, pull requests,
// builds and deployments, automatic standard changes from the change module's catalogue that follow the deployment,
// the deployment gate with its evidence chain, DORA metrics and the access rules of the module's data.
import { createHmac } from "node:crypto";
import { describe, expect, it, beforeAll } from "vitest";
import { world, type World } from "./release-helpers";
import { resetRateLimits } from "@server/http/ratelimit";

let w: World;
let hookKey = "";
let secret = "";
let generic: { id: string; key: string; secret: string };

const sign = (s: string, raw: string) => `sha256=${createHmac("sha256", s).update(raw).digest("hex")}`;

async function send(key: string, body: unknown, headers: Record<string, string> = {}, opts: { secret?: string | null; ip?: string } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.7", ...headers };
  if (opts.secret !== null) h["x-hub-signature-256"] = sign(opts.secret ?? secret, raw);
  const res = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/hooks/${key}`, { method: "POST", headers: h, body: raw }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  w = await world();
  await w.p.rm.client.post(`${w.P}/devops/seed`, {});
  const conns = (await w.p.rm.client.get(`${w.P}/r/devops_connection?size=20`)).rows as Record<string, any>[];
  const demo = conns.find((c) => c.kind === "github")!;
  hookKey = demo.hook_key;
  secret = (await w.p.rm.client.post(`${w.P}/devops/connections/${demo.id}/secret`, {})).secret;
  const made = (await w.p.rm.client.post(`${w.P}/r/devops_connection`, { name: "خط لولهٔ داخلی", kind: "generic", auto_change: true, assignment_group_id: w.g.team })).row;
  const s = (await w.p.rm.client.post(`${w.P}/devops/connections/${made.id}/secret`, {})).secret as string;
  generic = { id: made.id, key: made.hook_key, secret: s };
}, 120_000);

describe("signed deliveries", () => {
  it("shows the secret once and never returns it again", async () => {
    expect(secret).toMatch(/^whsec_/);
    const conns = (await w.p.rm.client.get(`${w.P}/r/devops_connection?size=20`)).rows as Record<string, any>[];
    const demo = conns.find((c) => c.kind === "github")!;
    const row = await w.get("devops_connection", demo.id, w.p.rm.client);
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.secret?.secret).toBe(true);
    // only the release manager makes secrets
    await w.p.dev.client.post(`${w.P}/devops/connections/${demo.id}/secret`, {}, 403);
  });

  it("refuses a delivery without a valid signature", async () => {
    const r = await send(hookKey, { zen: "x" }, { "x-github-event": "ping", "x-github-delivery": "d-1" }, { secret: "wrong" });
    expect(r.status).toBe(401);
    const none = await send(hookKey, { zen: "x" }, { "x-github-event": "ping" }, { secret: null });
    expect(none.status).toBe(401);
    const unknown = await send("NoSuchKey123456", { zen: "x" }, { "x-github-event": "ping" });
    expect(unknown.status).toBe(404);
  });

  it("accepts a signed ping and stores each delivery once", async () => {
    const first = await send(hookKey, { zen: "Keep it logically awesome." }, { "x-github-event": "ping", "x-github-delivery": "d-2" });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("processed");
    const again = await send(hookKey, { zen: "Keep it logically awesome." }, { "x-github-event": "ping", "x-github-delivery": "d-2" });
    expect(again.body.status).toBe("duplicate");
    const events = (await w.p.rm.client.get(`${w.P}/r/dev_event?size=50`)).rows as Record<string, any>[];
    expect(events.filter((e) => e.delivery_id === "d-2").length).toBe(1);
  });

  it("verifies GitLab's token header", async () => {
    const gl = (await w.p.rm.client.post(`${w.P}/r/devops_connection`, { name: "گیت‌لب داخلی", kind: "gitlab", secret: "gl-token-123456" })).row;
    const raw = JSON.stringify({ object_kind: "push", project: { path_with_namespace: "infra/dns" }, ref: "refs/heads/main", commits: [{ id: "abc123", message: "INC-12 fix", timestamp: new Date().toISOString(), author: { name: "Ali", email: "ali@example.com" } }] });
    const ok = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/hooks/${gl.hook_key}`, { method: "POST", headers: { "content-type": "application/json", "x-gitlab-event": "Push Hook", "x-gitlab-token": "gl-token-123456", "x-gitlab-event-uuid": "gl-1" }, body: raw }));
    expect(ok.status).toBe(200);
    const bad = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/hooks/${gl.hook_key}`, { method: "POST", headers: { "content-type": "application/json", "x-gitlab-event": "Push Hook", "x-gitlab-token": "nope" }, body: raw }));
    expect(bad.status).toBe(401);
  });

  it("rate limits a flood from one client", async () => {
    resetRateLimits();
    let limited = 0;
    for (let i = 0; i < 130; i++) {
      const r = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/hooks/${hookKey}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" }, body: "{}" }));
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    resetRateLimits();
  });
});

describe("development data", () => {
  it("stores commits and pull requests with the record numbers they mention", async () => {
    const rel = await w.release({ short_description: "انتشار با کامیت‌ها" });
    const push = {
      ref: "refs/heads/feature/x", repository: { full_name: "acme/portal", html_url: "https://github.com/acme/portal" }, pusher: { name: "dev", email: "dev@example.com" },
      commits: [{ id: "f00d1", message: `${rel.number} add login page`, timestamp: new Date().toISOString(), author: { name: "Dev", email: "dev@example.com" }, url: "https://github.com/acme/portal/commit/f00d1" }],
    };
    const r = await send(hookKey, push, { "x-github-event": "push", "x-github-delivery": "push-1" });
    expect(r.body.status).toBe("processed");
    const pr = { action: "opened", repository: { full_name: "acme/portal" }, pull_request: { number: 42, title: `Login (${rel.number})`, state: "open", user: { login: "dev" }, head: { ref: "feature/x" }, base: { ref: "main" }, created_at: new Date().toISOString() } };
    expect((await send(hookKey, pr, { "x-github-event": "pull_request", "x-github-delivery": "pr-1" })).body.status).toBe("processed");
    const dev = await w.p.dev.client.get(`${w.P}/devops/records/release/${rel.id}/development`);
    expect(dev.commits.map((c: any) => c.sha)).toContain("f00d1");
    expect(dev.pull_requests[0].pr_number).toBe(42);
    // machine data is never typed in by people
    await w.p.rm.client.post(`${w.P}/r/dev_commit`, { sha: "x", repository_id: dev.commits[0].repository_id, message: "دستی" }, 403);
  });
});

describe("deployments from pipelines", () => {
  const deploy = (id: string, environment: string, status: string, extra: Record<string, unknown> = {}) => ({ type: "deployment", id, environment, status, version: "3.1.0", repository: "acme/payments", pipeline: "release", ...extra });

  it("records a test deployment without a change", async () => {
    const r = await send(generic.key, deploy("t-1", "qa", "succeeded"), { "x-delivery-id": "g-1" }, { secret: generic.secret });
    expect(r.body.status).toBe("processed");
    expect(r.body.result.environment).toBe("test");
    expect(r.body.result.change).toBeNull();
    expect(r.body.result.state).toBe("succeeded");
  });

  it("gives a production deployment an automatic standard change that follows it", async () => {
    const started = await send(generic.key, deploy("p-1", "production", "started", { commits: [{ sha: "c1", message: "fix", at: new Date(Date.now() - 6 * 3_600_000).toISOString() }] }), { "x-delivery-id": "g-2" }, { secret: generic.secret });
    expect(started.body.status).toBe("processed");
    expect(started.body.result.auto_change).toMatch(/^CHG/);
    expect(started.body.result.state).toBe("in_progress");
    const done = await send(generic.key, deploy("p-1", "production", "succeeded"), { "x-delivery-id": "g-3" }, { secret: generic.secret });
    expect(done.body.result.state).toBe("succeeded");
    await w.drain();
    const dep = await w.get("deployment", done.body.result.deployment, w.p.rm.client);
    expect(dep.is_production).toBe(true);
    expect(dep.lead_time).toBeGreaterThan(5 * 3600);
    const change = await w.get("change_request", dep.change_id, w.p.rm.client);
    expect(change.type).toBe("standard");
    expect(change.state).toBe("closed");
    expect(change.close_code).toBe("successful");
  });

  it("an unknown environment is ignored with a reason", async () => {
    const r = await send(generic.key, deploy("u-1", "moon", "started"), { "x-delivery-id": "g-4" }, { secret: generic.secret });
    expect(r.body.status).toBe("ignored");
    expect(r.body.message).toContain("moon");
  });

  it("a failed production deployment counts in DORA and is restored by the next success", async () => {
    await send(generic.key, deploy("p-2", "prod", "failed", { description: "smoke test failed" }), { "x-delivery-id": "g-5" }, { secret: generic.secret });
    await send(generic.key, deploy("p-3", "prod", "succeeded"), { "x-delivery-id": "g-6" }, { secret: generic.secret });
    await w.drain();
    const dora = await w.p.rm.client.get(`${w.P}/devops/dora?days=30`);
    expect(dora.overall.deployments).toBeGreaterThanOrEqual(3);
    expect(dora.overall.failures).toBeGreaterThanOrEqual(1);
    expect(dora.overall.change_failure_rate.pct).toBeGreaterThan(0);
    expect(dora.overall.recovery.n).toBeGreaterThanOrEqual(1);
    expect(dora.velocity.from_pipelines).toBeGreaterThanOrEqual(3);
    const pipe = await w.p.rm.client.get(`${w.P}/devops/pipeline?days=30`);
    expect(pipe.environments.length).toBe(4);
    expect(pipe.rows.length).toBeGreaterThan(0);
  });
});

describe("the deployment gate", () => {
  const gate = async (input: Record<string, unknown>, key = generic.key, s = generic.secret) => {
    const raw = JSON.stringify(input);
    const res = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/gates/${key}`, { method: "POST", headers: { "content-type": "application/json", "x-signature-256": sign(s, raw), "x-forwarded-for": "203.0.113.20" }, body: raw }));
    return { status: res.status, body: await res.json() };
  };

  it("approves open environments and production through the automatic standard change", async () => {
    const t = await gate({ environment: "test", version: "3.2.0" });
    expect(t.body.state).toBe("approved");
    const p = await gate({ environment: "prod", version: "3.2.0", run: "run-77" });
    expect(p.body.state).toBe("approved");
    expect(p.body.rule).toBe("تغییر استاندارد خودکار");
    // the pipeline polls the answer with the gate id signed
    const poll = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/gates/${generic.key}/${p.body.id}`, { headers: { "x-signature-256": sign(generic.secret, p.body.id) } }));
    expect((await poll.json()).allowed).toBe(true);
  });

  it("leaves a gate pending when the named change is not authorized, for the release manager to decide", async () => {
    const ch = (await w.p.dev.client.post(`${w.P}/r/change_request`, { short_description: "تغییر عادی ناتمام", type: "normal", assignment_group_id: w.g.team })).row;
    const p = await gate({ environment: "prod", version: "3.3.0", change: ch.number });
    expect(p.status).toBe(202);
    expect(p.body.state).toBe("pending");
    await w.p.dev.client.post(`${w.P}/devops/gates/${p.body.id}/decide`, { decision: "approved" }, 403);
    const decided = await w.p.rm.client.post(`${w.P}/devops/gates/${p.body.id}/decide`, { decision: "overridden", reason: "تغییر اضطراری شفاهی تأیید شد" });
    expect(decided.row.state).toBe("overridden");
    expect(decided.row.decided_by).toBe(w.p.rm.userId);
  });

  it("keeps the evidence in an unbroken hash chain", async () => {
    const v = await w.p.rm.client.get(`${w.P}/devops/gates/verify`);
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThanOrEqual(3);
    // tampering with stored evidence breaks the chain
    await w.e.db.query(`update sm_change_gates set evidence = jsonb_set(evidence, '{version}', '"9.9.9"') where org_id = $1 and number = (select min(number) from sm_change_gates where org_id = $1)`, [w.e.org]);
    const broken = await w.p.rm.client.get(`${w.P}/devops/gates/verify`);
    expect(broken.ok).toBe(false);
  });
});
