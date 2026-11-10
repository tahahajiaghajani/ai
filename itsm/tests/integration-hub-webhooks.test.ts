// Outbound webhooks (signed, projected through the subscriber's integration user, retried, dead-lettered, replayed,
// paused after repeated failures), inbound endpoints (token / HMAC, idempotent, create or update by correlation id, as
// the endpoint's integration user) and Jira/GitHub issue sync (an issue from a record, its webhooks back as notes and a
// state change, comments to the issue).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import { tick } from "@server/jobs";
import { aiNet } from "@server/modules/ai/net";
import type { Db } from "@server/db";
import type { ServerConfig } from "@server/context";
import { hookEventOf, jsonPath, mapInbound } from "@shared/integration/webhooks";
import { githubEvent, jiraEvent, adfToText, adfDoc } from "@shared/integration/issues";

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

const sent: Sent[] = [];
let answer = (req: Sent): Response => new Response("ok", { status: 200 });
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
  const req = { url, method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : "" };
  sent.push(req);
  return answer(req);
}) as typeof fetch;

describe("webhooks, inbound endpoints and issue sync", () => {
  let app: Awaited<ReturnType<typeof makeServer>>["app"];
  let db: Db;
  let cfg: ServerConfig;
  let owner: Client;
  let org: string;
  let P: string;
  let iu: { id: string; user_id: string };
  const lookup = aiNet.lookup;

  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const r = await tick(cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  /** make every queued job due now (retries wait with backoff) */
  const due = () => db.query(`update sm_jobs set run_at = now() where status = 'queued'`);

  beforeAll(async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    ({ app, db } = await makeServer({ config: { fetch: fakeFetch } }));
    cfg = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: fakeFetch };
    owner = new Client(app);
    org = await signupWithOrg(owner);
    P = `/o/${org}`;
    iu = (await owner.post(`${P}/r/integration_user`, { name: "مقصد بیرونی" })).row;
    await owner.put(`${P}/integration/users/${iu.id}/roles`, { roles: ["agent"] });
    await drain();
  });
  afterAll(() => {
    aiNet.lookup = lookup;
  });

  it("delivers record events signed and projected through the integration user", async () => {
    const sub = (await owner.post(`${P}/r/webhook_subscription`, { name: "کارها به سامانهٔ گزارش", url: "https://hooks.example.com/in", principal_id: iu.id, table_key: "todo", events: ["created", "updated"], fields: ["short_description", "priority"] })).row;
    const { secret } = await owner.post(`${P}/integration/secret`, { table: "webhook_subscription", id: sub.id });
    expect(secret).toBeTruthy();
    sent.length = 0;
    const todo = (await owner.post(`${P}/r/todo`, { short_description: "کار برای وب‌هوک", description: "متنی که در پیام نمی‌آید" })).row;
    await drain();
    const hook = sent.find((s) => s.url === "https://hooks.example.com/in")!;
    expect(hook).toBeTruthy();
    expect(hook.headers["x-signature"]).toBe(`sha256=${createHmac("sha256", secret).update(hook.body, "utf8").digest("hex")}`);
    const payload = JSON.parse(hook.body);
    expect(payload).toMatchObject({ event: "created", table: "todo", record_id: todo.id });
    expect(payload.data.short_description).toBe("کار برای وب‌هوک");
    expect(payload.data.description).toBeUndefined();
    const { deliveries } = await owner.get(`${P}/integration/webhooks/deliveries?subscription=${sub.id}`);
    expect(deliveries[0]).toMatchObject({ status: "delivered", response_code: 200 });
  });

  it("skips what the integration user may not read", async () => {
    const reqUser = (await owner.post(`${P}/r/integration_user`, { name: "درخواست‌دهندهٔ بیرونی" })).row;
    await owner.put(`${P}/integration/users/${reqUser.id}/roles`, { roles: ["requester"] });
    const sub = (await owner.post(`${P}/r/webhook_subscription`, { name: "فقط کارهای خودش", url: "https://hooks.example.com/req", principal_id: reqUser.id, table_key: "todo", events: ["created"] })).row;
    sent.length = 0;
    await owner.post(`${P}/r/todo`, { short_description: "کار مالک که درخواست‌دهنده نمی‌بیند" });
    await drain();
    expect(sent.some((s) => s.url === "https://hooks.example.com/req")).toBe(false);
    const { deliveries } = await owner.get(`${P}/integration/webhooks/deliveries?subscription=${sub.id}`);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toContain("نمی‌بیند");
    const cur = await owner.get(`${P}/r/webhook_subscription/${sub.id}`);
    await owner.patch(`${P}/r/webhook_subscription/${sub.id}`, { active: false, version: cur.row.version });
  });

  it("retries failures, dead-letters, replays, and pauses after repeated failures", async () => {
    const sub = (await owner.post(`${P}/r/webhook_subscription`, { name: "مقصد ناپایدار", url: "https://flaky.example.com/hook", principal_id: iu.id, table_key: "todo", events: ["created"] })).row;
    answer = (r) => (r.url.startsWith("https://flaky") ? new Response("down", { status: 503 }) : new Response("ok"));
    await owner.post(`${P}/r/todo`, { short_description: "کار شکست‌خورده" });
    await drain();
    let d = (await owner.get(`${P}/integration/webhooks/deliveries?subscription=${sub.id}`)).deliveries[0];
    expect(d.status).toBe("failed");
    for (let i = 0; i < 6; i++) {
      await due();
      await drain();
    }
    d = (await owner.get(`${P}/integration/webhooks/deliveries?subscription=${sub.id}`)).deliveries[0];
    expect(d.status).toBe("dead");
    // the receiver is fixed: replay from the dead-letter list
    answer = () => new Response("ok");
    await owner.post(`${P}/integration/webhooks/deliveries/${d.id}/replay`);
    await drain();
    d = (await owner.get(`${P}/integration/webhooks/deliveries?subscription=${sub.id}`)).deliveries[0];
    expect(d.status).toBe("delivered");
    // ten failures in a row pause the subscription
    answer = (r) => (r.url.startsWith("https://flaky") ? new Response("down", { status: 500 }) : new Response("ok"));
    for (let i = 0; i < 10; i++) await owner.post(`${P}/r/todo`, { short_description: `کار ${i}` });
    await drain();
    const s = (await owner.get(`${P}/r/webhook_subscription/${sub.id}`)).row;
    expect(s.paused).toBe(true);
    expect(s.health).toBe("paused");
    // a person resumes it; the test send uses a real record
    answer = () => new Response("ok");
    await owner.post(`${P}/integration/webhooks/${sub.id}/resume`);
    const t = await owner.post(`${P}/integration/webhooks/${sub.id}/test`, {});
    expect(t.ok).toBe(true);
    expect((await owner.get(`${P}/r/webhook_subscription/${sub.id}`)).row.paused).toBe(false);
  }, 180_000); // seventeen deliveries through the job queue: room for a fully loaded machine

  it("accepts inbound deliveries with the endpoint's token, once, and creates or updates as its integration user", async () => {
    const ep = (
      await owner.post(`${P}/r/inbound_endpoint`, {
        name: "هشدارهای پایش",
        principal_id: iu.id,
        target_table: "todo",
        action: "upsert",
        match_field: "short_description",
        match_path: "$.alert.title",
        mapping: [{ path: "$.alert.title", field: "short_description" }, { path: "$.alert.details", field: "description" }],
        defaults: { priority: "2" },
      })
    ).row;
    const { secret, path } = await owner.post(`${P}/integration/secret`, { table: "inbound_endpoint", id: ep.id });
    expect(path).toBe(`/api/v1/in/${ep.id}`);
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      app.fetch(new Request(`http://local.test${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, ...headers }, body: JSON.stringify(body) }));
    const r1 = await (await post({ alert: { title: "دیسک سرور پر شد", details: "۹۸٪" } }, { "idempotency-key": "evt-1" })).json();
    expect(r1).toMatchObject({ ok: true, action: "created" });
    expect((await (await post({ alert: { title: "دیسک سرور پر شد" } }, { "idempotency-key": "evt-1" })).json()).duplicate).toBe(true);
    const r2 = await (await post({ alert: { title: "دیسک سرور پر شد", details: "۹۹٪" } }, { "idempotency-key": "evt-2" })).json();
    expect(r2).toMatchObject({ ok: true, action: "updated", id: r1.id });
    const rec = (await owner.get(`${P}/r/todo/${r1.id}`)).row;
    expect(rec.description).toBe("۹۹٪");
    expect(String(rec.priority)).toBe("2");
    const bad = await app.fetch(new Request(`http://local.test${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body: "{}" }));
    expect(bad.status).toBe(401);
    const { events } = await owner.get(`${P}/integration/inbound/events?endpoint=${ep.id}`);
    expect(events).toHaveLength(2);
  });

  it("makes a GitHub issue from a record, takes its webhooks back as notes and a state change, and posts comments", async () => {
    // the connection's integration user works every task (it closes the record when the issue closes)
    await owner.put(`${P}/integration/users/${iu.id}/roles`, { roles: ["service_desk_manager"] });
    const conn = (await owner.post(`${P}/r/issue_connection`, { name: "مخزن برنامه", kind: "github", repo: "acme/app", principal_id: iu.id, tables: ["todo"], sync_comments: "public", state_on_close: "resolved" })).row;
    const { secret: hookSecret } = await owner.post(`${P}/integration/secret`, { table: "issue_connection", id: conn.id });
    const cur = await owner.get(`${P}/r/issue_connection/${conn.id}`);
    await owner.patch(`${P}/r/issue_connection/${conn.id}`, { token: "ghp_test_token", version: cur.row.version });
    answer = (r) =>
      r.url === "https://api.github.com/repos/acme/app/issues" && r.method === "POST"
        ? Response.json({ number: 12, id: 9001, html_url: "https://github.com/acme/app/issues/12", state: "open" })
        : r.url.endsWith("/issues/12/comments")
          ? Response.json({ id: 1 })
          : new Response("ok");
    const todo = (await owner.post(`${P}/r/todo`, { short_description: "خطا در صفحهٔ ورود", description: "پس از به‌روزرسانی رخ داد" })).row;
    sent.length = 0;
    const { ref } = await owner.post(`${P}/integration/issues/link`, { connection_id: conn.id, table: "todo", record_id: todo.id });
    expect(ref).toMatchObject({ remote_key: "#12", remote_state: "open" });
    const created = sent.find((s) => s.url === "https://api.github.com/repos/acme/app/issues")!;
    expect(created.headers.authorization).toBe("Bearer ghp_test_token");
    expect(JSON.parse(created.body).title).toContain("خطا در صفحهٔ ورود");
    const refs = await owner.get(`${P}/integration/issues/refs?table=todo&id=${todo.id}`);
    expect(refs.refs).toHaveLength(1);
    // a public reply goes to the issue (as the integration user reads it)
    await owner.post(`${P}/r/todo/${todo.id}/journal`, { kind: "comment", body: "در حال بررسی هستیم" });
    sent.length = 0;
    await drain();
    expect(sent.some((s) => s.url.endsWith("/issues/12/comments") && JSON.parse(s.body).body.includes("در حال بررسی هستیم"))).toBe(true);
    // the issue closes on GitHub: a note on the record and the configured state
    const body = JSON.stringify({ action: "closed", issue: { number: 12, id: 9001, state: "closed", html_url: "https://github.com/acme/app/issues/12" }, repository: { full_name: "acme/app" }, sender: { login: "dev" } });
    const sig = `sha256=${createHmac("sha256", hookSecret).update(body).digest("hex")}`;
    const res = await app.fetch(new Request(`http://local.test/api/v1/issues/${conn.id}/hook`, { method: "POST", headers: { "content-type": "application/json", "x-github-event": "issues", "x-hub-signature-256": sig }, body }));
    expect(await res.json()).toMatchObject({ ok: true, action: "closed" });
    const after = (await owner.get(`${P}/r/todo/${todo.id}`)).row;
    expect(after.state).toBe("resolved");
    const journal = await owner.get(`${P}/r/todo/${todo.id}/journal`);
    expect(journal.entries.some((x: { body: string }) => x.body.includes("#12") && x.body.includes("بسته شد"))).toBe(true);
    const forged = await app.fetch(new Request(`http://local.test/api/v1/issues/${conn.id}/hook`, { method: "POST", headers: { "x-github-event": "issues", "x-hub-signature-256": "sha256=00" }, body }));
    expect(forged.status).toBe(401);
  });

  it("parses the tools' payloads (pure)", () => {
    expect(hookEventOf("record.state_changed")).toBe("transitioned");
    expect(jsonPath({ a: { b: [{ c: 5 }] } }, "$.a.b[0].c")).toBe(5);
    expect(mapInbound({ x: { y: "z" } }, [{ path: "$.x.y", field: "short_description" }], { priority: "3" })).toEqual({ priority: "3", short_description: "z" });
    expect(githubEvent("issue_comment", { action: "created", issue: { number: 3 }, comment: { id: 1, body: "سلام", user: { login: "a" } } })).toMatchObject({ action: "commented", remote_key: "#3" });
    expect(jiraEvent({ webhookEvent: "jira:issue_updated", issue: { key: "OPS-7", fields: { status: { name: "Done", statusCategory: { key: "done" } } } }, changelog: { items: [{ field: "status" }] } })).toMatchObject({ action: "closed", remote_key: "OPS-7" });
    expect(adfToText(adfDoc("یک\n\nدو"))).toBe("یک\nدو");
  });
});
