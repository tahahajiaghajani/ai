// Integrations: inbound webhooks (signed JSON events stored once per sender event id, handed to the module that
// registered their topic, retried from the app) and API keys for other programs (/api/v1). The topic handler and the
// API endpoint below stand in for a later module's (they write the fixture module's records).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { z } from "zod";
import "./fixtures/module";
import { makeServer, Client, signupWithOrg } from "./helpers";
import type { Db } from "@server/db";
import { registerTopicHandler } from "@server/modules/integrations/service";
import { apiCtx, publicApiRoutes } from "@server/routes/integrations";
import { create as crudCreate } from "@server/modules/data/crud";

// a module that understands «device.alert»: one fixture item per alert; «device.fail» always fails
let failNext = false;
const removeAlert = registerTopicHandler("device.alert", async (ctx, ev) => {
  if (failNext) throw new Error("پردازش ناموفق بود");
  const p = z.object({ host: z.string(), severity: z.string() }).parse(ev.payload);
  const row = await crudCreate(ctx, "test_item", { name: `هشدار ${p.host}`, notes: p.severity });
  return { item_id: row.id };
});
const removeFail = registerTopicHandler(/^device\.fail/, async () => {
  throw new Error("این رویداد پذیرفته نمی‌شود");
});
// a module's own public endpoint
publicApiRoutes.get("/test-items", async (c) => {
  const ctx = await apiCtx(c, "read");
  const rows = await ctx.db.query<{ name: string }>(`select name from sm_test_items where org_id = $1 and deleted_at is null order by code`, [ctx.org.id]);
  return c.json({ items: rows });
});
afterAll(() => {
  removeAlert();
  removeFail();
});

describe("webhooks and the public API", () => {
  let c: Client;
  let db: Db;
  let org: string;
  let app: { fetch: (r: Request) => Response | Promise<Response> };
  let hook: { id: string; secret: string; webhook_path: string };
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    app = s.app;
    c = new Client(s.app);
    org = await signupWithOrg(c);
    const r = await c.post(`/o/${org}/integrations`, { name: "سامانهٔ پایش", description: "هشدارهای شبکه" });
    hook = r.integration;
    expect(hook.webhook_path).toBe(`/api/hooks/${hook.id}`);
    expect(hook.secret.length).toBeGreaterThanOrEqual(16);
  });

  const send = (payload: unknown, opts: { secret?: string; topic?: string; id?: string; plain?: boolean } = {}) => {
    const raw = JSON.stringify(payload);
    const secret = opts.secret ?? hook.secret;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.plain) headers["x-webhook-secret"] = secret;
    else headers["x-signature"] = `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
    if (opts.topic) headers["x-topic"] = opts.topic;
    if (opts.id) headers["x-event-id"] = opts.id;
    return app.fetch(new Request(`http://hooks.test${hook.webhook_path}`, { method: "POST", headers, body: raw }));
  };

  it("hands a signed event to the module of its topic and stores the outcome", async () => {
    const res = await send({ host: "sw-02", severity: "high" }, { topic: "device.alert", id: "evt-1" });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, status: "processed" });
    const item = await db.one<{ name: string; notes: string }>(`select name, notes from sm_test_items where id = $1`, [out.result.item_id]);
    expect(item).toEqual({ name: "هشدار sw-02", notes: "high" });
    const events = (await c.get(`/o/${org}/integrations/events`)).events;
    expect(events[0]).toMatchObject({ topic: "device.alert", external_id: "evt-1", status: "processed", integration_name: "سامانهٔ پایش" });
  });

  it("stores the same event once, refuses a wrong signature, and keeps events no module understands", async () => {
    const again = await (await send({ host: "sw-02", severity: "high" }, { topic: "device.alert", id: "evt-1" })).json();
    expect(again).toEqual({ ok: true, duplicate: true });
    expect((await send({ host: "x", severity: "low" }, { topic: "device.alert", secret: "wrong-secret-0123456789" })).status).toBe(401);
    // the secret itself (senders that cannot sign)
    const plain = await (await send({ type: "form.submitted", id: "f-9", fields: { a: 1 } }, { plain: true })).json();
    expect(plain).toMatchObject({ ok: true, status: "received" });
    const ev = (await c.get(`/o/${org}/integrations/events`)).events.find((e: { external_id: string }) => e.external_id === "f-9");
    expect(ev).toMatchObject({ topic: "form.submitted", status: "received" });
    const full = await c.get(`/o/${org}/integrations/events/${ev.id}`);
    expect(full.event.payload).toEqual({ type: "form.submitted", id: "f-9", fields: { a: 1 } });
    // «تلاش دوباره» needs a module that understands the topic
    await c.post(`/o/${org}/integrations/events/${ev.id}/retry`, {}, 400);
    const n = await db.one<{ n: number }>(`select count(*)::int as n from sm_integration_events where org_id = $1`, [org]);
    expect(n!.n).toBe(2);
  });

  it("marks a failed event and processes it again on «تلاش دوباره»", async () => {
    failNext = true;
    const out = await (await send({ host: "fw-1", severity: "critical" }, { topic: "device.alert", id: "evt-2" })).json();
    expect(out).toMatchObject({ ok: false, status: "failed", message: "پردازش ناموفق بود" });
    failNext = false;
    const ev = (await c.get(`/o/${org}/integrations/events`)).events.find((e: { external_id: string }) => e.external_id === "evt-2");
    expect(ev.status).toBe("failed");
    const retried = await c.post(`/o/${org}/integrations/events/${ev.id}/retry`);
    expect(retried.result.item_id).toBeTruthy();
    expect((await c.get(`/o/${org}/integrations/events/${ev.id}`)).event.status).toBe("processed");
    const failing = await (await send({}, { topic: "device.failure", id: "evt-3" })).json();
    expect(failing).toMatchObject({ ok: false, status: "failed" });
  });

  it("closes a deactivated webhook and refuses a body that is not JSON or too large", async () => {
    const raw = "not json";
    const sig = createHmac("sha256", hook.secret).update(raw, "utf8").digest("hex");
    const bad = await app.fetch(new Request(`http://hooks.test${hook.webhook_path}`, { method: "POST", headers: { "x-signature": sig }, body: raw }));
    expect(bad.status).toBe(400);
    const big = await app.fetch(new Request(`http://hooks.test${hook.webhook_path}`, { method: "POST", headers: { "content-length": String(2_000_000) }, body: "{}" }));
    expect(big.status).toBe(413);
    await c.patch(`/o/${org}/integrations/${hook.id}`, { is_active: false });
    expect((await send({ host: "a", severity: "b" }, { topic: "device.alert" })).status).toBe(410);
    await c.patch(`/o/${org}/integrations/${hook.id}`, { is_active: true, description: "هشدارهای شبکه و برق" });
    const list = (await c.get(`/o/${org}/integrations`)).integrations;
    expect(list[0]).toMatchObject({ name: "سامانهٔ پایش", is_active: true, config: { description: "هشدارهای شبکه و برق" } });
    expect(list[0].events).toBeGreaterThanOrEqual(4);
    expect(list[0].secret).toBeUndefined();
  });

  it("lets another program read with an API key of the right scope; a revoked key stops working", async () => {
    const { key, prefix } = await c.post(`/o/${org}/integrations/api-keys`, { name: "داشبورد بیرونی", scopes: ["read"] });
    expect(key).toMatch(new RegExp(`^sm_${prefix}_`));
    const api = (path: string, k = key) => app.fetch(new Request(`http://api.test/api/v1${path}`, { headers: { authorization: `Bearer ${k}` } }));
    expect(await (await api("/ping")).json()).toEqual({ ok: true, org: { id: org, name: "سازمان آزمایشی" } });
    const items = await (await api("/test-items")).json();
    expect(items.items.map((i: { name: string }) => i.name)).toContain("هشدار sw-02");
    // X-API-Key works too
    expect((await app.fetch(new Request("http://api.test/api/v1/ping", { headers: { "x-api-key": key } }))).status).toBe(200);
    expect((await api("/ping", "sm_bad_key")).status).toBe(401);
    const keys = (await c.get(`/o/${org}/integrations/api-keys`)).keys;
    expect(keys[0]).toMatchObject({ name: "داشبورد بیرونی", prefix, scopes: ["read"], revoked_at: null });
    expect(JSON.stringify(keys)).not.toContain(key);
    await c.del(`/o/${org}/integrations/api-keys/${keys[0].id}`);
    expect((await api("/ping")).status).toBe(401);
  });
});
