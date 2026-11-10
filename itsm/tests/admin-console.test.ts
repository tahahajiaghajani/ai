// The platform owner's console (plans, limits, flags, announcements, jobs, backups, version, audit of every
// organisation) and the tenant console's home: only the platform owner reaches the first, tenant administrators never
// see other organisations, and what the console decides (limits, flags) holds on the server.
import { describe, it, expect, beforeAll } from "vitest";
import { gunzipSync } from "node:zlib";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { tick } from "@server/jobs";
import type { Db } from "@server/db";

async function drain(app: { fetch: (r: Request) => Response | Promise<Response> }, db: Db) {
  const cfg = { db, log: { info() {}, warn() {}, error() {} }, mode: "cloud" as const, secret: "test-secret", origin: "cloud", platformAdmins: [], allowSignup: true, fetch: globalThis.fetch.bind(globalThis) };
  for (let i = 0; i < 20; i++) {
    const r = await tick(cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
  void app;
}

describe("platform owner console", () => {
  let app: Awaited<ReturnType<typeof makeServer>>["app"];
  let db: Db;
  let owner: Client; // the platform owner (first account) and owner of org A
  let tenant: Client; // owner of org B — a tenant administrator, not a platform admin
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    ({ app, db } = await makeServer());
    owner = new Client(app);
    orgA = await signupWithOrg(owner);
    tenant = new Client(app);
    orgB = await signupWithOrg(tenant, { email: "tenant@example.com", name: "سازمان دوم" });
    await drain(app, db);
  });

  it("is reachable only by the platform owner — never by a tenant administrator", async () => {
    for (const path of ["/admin/plans", "/admin/flags", "/admin/announcements", "/admin/jobs/summary", "/admin/backups", "/admin/version", "/admin/audit-all", "/admin/usage", "/admin/models"]) {
      await tenant.get(path, 403);
      await owner.get(path);
    }
    await tenant.put(`/admin/orgs/${orgB}/plan`, { plan: "enterprise" }, 403);
    await tenant.post("/admin/backups", { org_id: orgA }, 403);
  });

  it("a tenant administrator never sees another organisation", async () => {
    await tenant.get(`/o/${orgA}/admin/home`, 403);
    await tenant.get(`/o/${orgA}/r/custom_table`, 403);
    const home = await tenant.get(`/o/${orgB}/admin/home`);
    expect(home.plan.key).toBe("standard");
    // the audit of every organisation is the platform owner's: org B's owner reads only its own audit log
    const audit = await tenant.get(`/o/${orgB}/audit`);
    expect(JSON.stringify(audit)).not.toContain(orgA);
  });

  it("plans set limits that the server enforces, and the console shows usage", async () => {
    const { plans } = await owner.get("/admin/plans");
    expect(plans.map((p: { key: string }) => p.key)).toEqual(["free", "standard", "enterprise"]);
    expect(plans.find((p: { key: string }) => p.key === "standard").is_default).toBe(true);
    await owner.put("/admin/plans/tiny", { name: "خیلی کوچک", limits: { custom_tables: 1, custom_fields: 2 } });
    const usage = await owner.put(`/admin/orgs/${orgB}/plan`, { plan: "tiny", overrides: { custom_fields: 3 } });
    expect(usage.limits).toMatchObject({ custom_tables: 1, custom_fields: 3 });
    await tenant.post(`/o/${orgB}/admin/studio/tables`, { label: "ملاقات", fields: [{ name: "u_guest", label: "مهمان", type: "string" }] });
    const second = await tenant.req("POST", `/o/${orgB}/admin/studio/tables`, { label: "کلید" }, 403);
    expect(second.error.message).toContain("جدول‌های سفارشی");
    // fields: 1 used, 3 allowed → adding 3 more is refused on every path (the generic API too)
    await tenant.req("PUT", `/o/${orgB}/admin/studio/fields/custom_01`, { fields: [{ name: "u_a", label: "الف", type: "string" }, { name: "u_b", label: "ب", type: "string" }, { name: "u_c", label: "پ", type: "string" }] }, 403);
    await tenant.post(`/o/${orgB}/r/custom_field`, { table_key: "custom_01", name: "u_x", label: "ایکس", type: "string" });
    await tenant.post(`/o/${orgB}/r/custom_field`, { table_key: "custom_01", name: "u_y", label: "ایگرگ", type: "string" });
    await tenant.req("POST", `/o/${orgB}/r/custom_field`, { table_key: "custom_01", name: "u_z", label: "زد", type: "string" }, 403);
    const all = await owner.get("/admin/usage");
    const b = all.orgs.find((o: { org_id: string }) => o.org_id === orgB);
    expect(b.usage.custom_fields).toBe(3);
    expect(b.tones.custom_fields).toBe("danger");
    await owner.put(`/admin/orgs/${orgB}/plan`, { plan: "enterprise" });
    await owner.del("/admin/plans/tiny");
  });

  it("feature flags gate by plan, by organisation and by the tenant's own switch — with the reason", async () => {
    const { flags } = await owner.get("/admin/flags");
    expect(flags.some((f: { key: string }) => f.key === "directory_sync")).toBe(true);
    let states = (await owner.get(`/o/${orgA}/admin/features`)).features as { key: string; on: boolean; reason: string; toggle: boolean }[];
    expect(states.find((s) => s.key === "directory_sync")!.on).toBe(false); // standard plan
    expect(states.find((s) => s.key === "directory_sync")!.reason).toContain("طرح");
    await owner.put("/admin/flags/directory_sync", { label: "همگام‌سازی LDAP و Active Directory", stage: "on", plans: ["enterprise"], orgs_on: [orgA] });
    states = (await owner.get(`/o/${orgA}/admin/features`)).features;
    expect(states.find((s) => s.key === "directory_sync")!.on).toBe(true);
    // the tenant switches a tenant-switchable flag off for itself
    await owner.put(`/o/${orgA}/admin/features/issue_sync`, { enabled: false });
    states = (await owner.get(`/o/${orgA}/admin/features`)).features;
    expect(states.find((s) => s.key === "issue_sync")).toMatchObject({ on: false, gate: "tenant" });
    await owner.put(`/o/${orgA}/admin/features/issue_sync`, { enabled: true });
    // a flag the platform keeps for itself cannot be switched by a tenant
    await owner.put("/admin/flags/beta_x", { label: "آزمایشی", stage: "beta", percent: 0, tenant_toggle: false });
    await tenant.req("PUT", `/o/${orgB}/admin/features/beta_x`, { enabled: true }, 400);
    await owner.del("/admin/flags/beta_x");
  });

  it("announcements become notices in the targeted organisations and reach their members", async () => {
    const r = await owner.post("/admin/announcements", { title: "به‌روزرسانی سامانه در شب جمعه", body: "از ساعت ۲۲ تا ۲۳", severity: "maintenance", audience: "orgs", org_ids: [orgB], publish: true });
    expect(r.published.orgs).toBe(1);
    await drain(app, db);
    const { notices } = await tenant.get(`/o/${orgB}/admin/notices/active`);
    expect(notices.map((n: { title: string }) => n.title)).toContain("به‌روزرسانی سامانه در شب جمعه");
    expect(notices[0].source).toBe("platform");
    // org A was not targeted
    expect((await owner.get(`/o/${orgA}/admin/notices/active`)).notices).toHaveLength(0);
    // a tenant may switch a platform notice off, never rewrite it
    const id = notices[0].id;
    const cur = await tenant.get(`/o/${orgB}/r/system_notice/${id}`);
    await tenant.req("PATCH", `/o/${orgB}/r/system_notice/${id}`, { title: "دست‌کاری‌شده", version: cur.row.version }, 403);
    await tenant.patch(`/o/${orgB}/r/system_notice/${id}`, { active: false, version: cur.row.version });
    expect((await tenant.get(`/o/${orgB}/admin/notices/active`)).notices).toHaveLength(0);
  });

  it("monitors jobs, keeps backups that verify and restore into a new organisation", async () => {
    const summary = await owner.get("/admin/jobs/summary");
    expect(summary.totals).toBeTruthy();
    await tenant.post(`/o/${orgB}/r/custom_01`, { title: "ملاقات نخست", u_guest: "علی رضایی" });
    const { backup } = await owner.post("/admin/backups", { org_id: orgB, note: "پیش از ارتقا" });
    await drain(app, db);
    const { backups } = await owner.get(`/admin/backups?org=${orgB}`);
    expect(backups[0].error ?? null).toBeNull();
    expect(backups[0]).toMatchObject({ id: backup.id, status: "done" });
    const v = await owner.post(`/admin/backups/${backup.id}/verify`);
    expect(v).toMatchObject({ ok: true, sha256: true });
    const res = await app.fetch(new Request(`http://local.test/api/admin/backups/${backup.id}/download`, { headers: { cookie: owner.cookie } }));
    expect(res.status).toBe(200);
    const file = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    expect(file.format).toBe("itsm-backup");
    expect(file.tables.custom_01[0].title).toBe("ملاقات نخست");
    // restore: a new organisation owned by the platform owner, ids remapped
    const restored = await owner.post(`/admin/backups/${backup.id}/restore`);
    const rows = (await owner.get(`/o/${restored.org_id}/r/custom_01`)).rows;
    expect(rows.map((r: { title: string }) => r.title)).toEqual(["ملاقات نخست"]);
    expect(rows[0].id).not.toBe(file.tables.custom_01[0].id);
    // the tenant is not a member of the restored organisation
    await tenant.get(`/o/${restored.org_id}/r/custom_01`, 403);
  });

  it("reports the version and upgrade status and the audit of every organisation", async () => {
    const v = await owner.get("/admin/version");
    expect(v.schema.pending).toEqual([]);
    expect(v.changelog.length).toBeGreaterThan(0);
    const { rows } = await owner.get(`/admin/audit-all?org=${orgB}`);
    expect(rows.some((r: { action: string }) => r.action === "studio_table_create")).toBe(true);
    const csv = await app.fetch(new Request(`http://local.test/api/admin/audit-all.csv`, { headers: { cookie: owner.cookie } }));
    expect(await csv.text()).toContain("studio_table_create");
  });
});
