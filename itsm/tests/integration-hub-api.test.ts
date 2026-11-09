// The record API for other programs: integration users act through a member context with their own roles (never the
// system, never the owner), keys are hashed, scoped (tables × operations), rate limited, logged and revocable, and the
// OpenAPI document shows exactly what a key may do.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client } from "./helpers";
import { tick } from "@server/jobs";
import { requestScope, scopeAllows, ipAllowed, cleanScopes } from "@shared/integration/scopes";
import { sha256 } from "@server/auth/password";

async function drain(e: EngineOrg) {
  for (let i = 0; i < 20; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
}

describe("integration users and the record API", () => {
  let e: EngineOrg;
  let P: string;
  let user: { id: string; user_id: string };
  let api: Client;
  let key: string;
  let ownerTodo: string;

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    await drain(e);
    ownerTodo = (await e.owner.post(`${P}/r/todo`, { short_description: "کار مالک" })).row.id;
    user = (await e.owner.post(`${P}/r/integration_user`, { name: "سامانهٔ پایش", rate_limit: 100 })).row;
    api = new Client(e.app);
  });

  it("creates a service account that cannot sign in, and refuses keys until roles are chosen", async () => {
    expect(user.user_id).toBeTruthy();
    const u = await e.db.one<{ email: string; password_hash: string | null }>(`select email, password_hash from sm_users where id = $1`, [user.user_id]);
    expect(u!.email).toMatch(/^integration\+[0-9a-f-]{36}@service\.invalid$/);
    expect(u!.password_hash).toBeNull();
    const k = await e.owner.post(`${P}/integration/users/${user.id}/keys`, { name: "کلید پایش", scopes: [{ table: "todo", ops: ["read", "create"] }] });
    key = k.key;
    expect(key).toMatch(/^sm_[A-Za-z0-9]{8}_/);
    // only the hash is stored
    const stored = await e.db.one<{ key_hash: string }>(`select key_hash from sm_api_keys where id = $1`, [k.id]);
    expect(stored!.key_hash).toBe(sha256(key));
    expect(JSON.stringify(await e.owner.get(`${P}/integration/keys`))).not.toContain(key);
    api.token = key;
    const r = await api.req("GET", "/v1/r/todo", undefined, 403);
    expect(r.error.message).toContain("نقشی تعیین نشده");
  });

  it("acts with the integration user's own roles, within the key's scopes", async () => {
    await e.owner.put(`${P}/integration/users/${user.id}/roles`, { roles: ["requester"] });
    // a requester reads only its own records: the owner's task is invisible
    const mine = (await api.post("/v1/r/todo", { short_description: "کار از سامانهٔ پایش" })).row;
    const list = await api.get("/v1/r/todo");
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    await api.get(`/v1/r/todo/${ownerTodo}`, 404);
    // scopes: no update in this key; incident is outside it
    await api.req("PATCH", `/v1/r/todo/${mine.id}`, { short_description: "تغییر", version: mine.version }, 403);
    await api.req("GET", "/v1/r/incident", undefined, 403);
    await api.req("POST", `/v1/r/todo/${mine.id}/journal`, { kind: "comment", body: "یادداشت" }, 403);
    // a wider role still cannot pass the key's scopes
    await e.owner.put(`${P}/integration/users/${user.id}/roles`, { roles: ["agent"] });
    expect((await api.get("/v1/r/todo")).rows.length).toBe(2);
    await api.req("PATCH", `/v1/r/todo/${mine.id}`, { short_description: "تغییر", version: mine.version }, 403);
    // the created record names the integration user as its author (audited like any member's write)
    expect(mine.created_by).toBe(user.user_id);
  });

  it("describes exactly what the key may do in its OpenAPI document and meta", async () => {
    const doc = await api.get("/v1/openapi.json");
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/r/todo");
    expect(doc.paths["/r/todo"].post).toBeTruthy();
    expect(doc.paths["/r/todo/{id}"].patch).toBeUndefined();
    expect(Object.keys(doc.paths).some((p) => p.startsWith("/r/incident"))).toBe(false);
    const meta = await api.get("/v1/meta/tables");
    expect(meta.tables.map((t: { key: string }) => t.key)).toEqual(["todo"]);
    // the hub's preview: every operation the integration user's roles allow
    const preview = await e.owner.get(`${P}/integration/openapi?user=${user.id}`);
    expect(Object.keys(preview.paths)).toContain("/r/incident");
  });

  it("rate limits per key and logs every call", async () => {
    const cur = await e.owner.get(`${P}/r/integration_user/${user.id}`);
    await e.owner.patch(`${P}/r/integration_user/${user.id}`, { rate_limit: 5, version: cur.row.version });
    await e.db.query(`delete from sm_api_usage`);
    for (let i = 0; i < 5; i++) await api.get("/v1/r/todo");
    const over = await e.app.fetch(new Request("http://local.test/api/v1/r/todo", { headers: { authorization: `Bearer ${key}` } }));
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    const log = await e.owner.get(`${P}/integration/log?kind=api`);
    expect(log.rows.some((r: { status: number }) => r.status === 429)).toBe(true);
    expect(log.rows.some((r: { status: number; target: string }) => r.status === 200 && r.target.includes("/v1/r/todo"))).toBe(true);
    const { keys } = await e.owner.get(`${P}/integration/keys`);
    expect(keys[0].calls).toBeGreaterThan(5);
    await e.db.query(`delete from sm_api_usage`);
    const back = await e.owner.get(`${P}/r/integration_user/${user.id}`);
    await e.owner.patch(`${P}/r/integration_user/${user.id}`, { rate_limit: 100, version: back.row.version });
  });

  it("holds the IP allow-list, revocation, expiry and the organisation's switches", async () => {
    const cur = await e.owner.get(`${P}/r/integration_user/${user.id}`);
    await e.owner.patch(`${P}/r/integration_user/${user.id}`, { ip_allowlist: "10.0.0.0/8", version: cur.row.version });
    await api.get("/v1/r/todo", 403);
    const ok = await e.app.fetch(new Request("http://local.test/api/v1/r/todo", { headers: { authorization: `Bearer ${key}`, "x-forwarded-for": "10.1.2.3" } }));
    expect(ok.status).toBe(200);
    const again = await e.owner.get(`${P}/r/integration_user/${user.id}`);
    await e.owner.patch(`${P}/r/integration_user/${user.id}`, { ip_allowlist: "", version: again.row.version });
    // the platform switches the API off for this organisation: refused with the reason
    await e.owner.put("/admin/flags/public_api", { label: "API رکوردها", stage: "on", plans: ["standard", "enterprise"], orgs_off: [e.org] });
    expect((await api.req("GET", "/v1/r/todo", undefined, 403)).error.message).toContain("روشن نیست");
    await e.owner.put("/admin/flags/public_api", { label: "API رکوردها", stage: "on", plans: ["standard", "enterprise"], orgs_off: [] });
    // an expired key and a revoked key
    const k2 = await e.owner.post(`${P}/integration/users/${user.id}/keys`, { name: "کوتاه", scopes: [{ table: "*", ops: ["read"] }], expires_at: new Date(Date.now() + 60_000).toISOString() });
    await e.db.query(`update sm_api_keys set expires_at = now() - interval '1 minute' where id = $1`, [k2.id]);
    const exp = new Client(e.app);
    exp.token = k2.key;
    await exp.get("/v1/r/todo", 401);
    const { keys } = await e.owner.get(`${P}/integration/keys`);
    await e.owner.del(`${P}/integration/keys/${keys.find((k: { name: string }) => k.name === "کلید پایش").id}`);
    await api.get("/v1/r/todo", 401);
    // a switched-off integration user: its keys are revoked with it
    const k3 = await e.owner.post(`${P}/integration/users/${user.id}/keys`, { name: "سوم", scopes: [{ table: "*", ops: ["read"] }] });
    const third = new Client(e.app);
    third.token = k3.key;
    await third.get("/v1/r/todo");
    const u2 = await e.owner.get(`${P}/r/integration_user/${user.id}`);
    await e.owner.patch(`${P}/r/integration_user/${user.id}`, { active: false, version: u2.row.version });
    await third.get("/v1/r/todo", 401);
  });

  it("refuses the earlier owner-level keys on the record API, and members without the right on the hub", async () => {
    const legacy = await e.owner.post(`${P}/integrations/api-keys`, { name: "کلید قدیمی", scopes: ["read"] });
    const old = new Client(e.app);
    old.token = legacy.key;
    expect((await old.req("GET", "/v1/r/todo", undefined, 403)).error.message).toContain("کاربر یکپارچه‌سازی");
    const m = await e.member("member", "plain-member@example.com");
    await m.client.get(`${P}/integration/hub`, 403);
    await m.client.req("POST", `${P}/integration/users/${user.id}/keys`, { name: "کلید عضو", scopes: [{ table: "*", ops: ["read"] }] }, 403);
  });

  it("maps requests to scopes (pure)", () => {
    expect(requestScope("GET", "/r/incident")).toEqual({ table: "incident", op: "read" });
    expect(requestScope("POST", "/r/incident/query")).toEqual({ table: "incident", op: "read" });
    expect(requestScope("POST", "/r/incident")).toEqual({ table: "incident", op: "create" });
    expect(requestScope("PATCH", "/r/incident/0190")).toEqual({ table: "incident", op: "update" });
    expect(requestScope("POST", "/r/incident/0190/transition")).toEqual({ table: "incident", op: "update" });
    expect(requestScope("DELETE", "/r/incident/0190")).toEqual({ table: "incident", op: "delete" });
    expect(requestScope("POST", "/r/incident/bulk", { delete: true })).toEqual({ table: "incident", op: "delete" });
    expect(requestScope("GET", "/meta/tables")).toBeNull();
    const s = cleanScopes([{ table: "*", ops: ["read"] }, { table: "incident", ops: ["read", "create", "bogus"] }]);
    expect(scopeAllows(s, "problem", "read")).toBe(true);
    expect(scopeAllows(s, "problem", "create")).toBe(false);
    expect(scopeAllows(s, "incident", "create")).toBe(true);
    expect(ipAllowed("10.2.3.4", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("11.2.3.4", ["10.0.0.0/8", "11.2.3.5"])).toBe(false);
  });
});
