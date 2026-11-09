// The consoles and the integration hub under the access model, checked with a requester, an agent of another group
// and an auditor: none of them reaches the platform owner's console, the tenant console's tools (logs, member import,
// studio, matrix, exports, branding) or the integration hub; a data export is read only by the person who asked; an
// integration user's keys and the hub's secrets never reach them (the auditor reads the configuration, never a secret); and the defaults of both modules seed once.
import { describe, it, expect, beforeAll } from "vitest";
import { world, type World } from "./incident-helpers";
import type { Client } from "./helpers";
import { seedAdminDefaults } from "@server/modules/admin";
import { seedIntegrationDefaults } from "@server/modules/integration";

/** The HTTP status a call ends with (200 when it succeeds). */
const statusOf = (p: Promise<unknown>) => p.then(() => 200, (e: Error) => Number(/→ (\d{3})/.exec(e.message)?.[1] ?? 0));

let w: World;
let people: [string, { client: Client; userId: string }][];

beforeAll(async () => {
  w = await world();
  people = [
    ["requester", w.p.req],
    ["agent of another group", w.p.other],
    ["auditor", w.p.auditor],
  ];
});

describe("administration under the access model", () => {
  it("requester, agent of another group and auditor reach none of the administration", async () => {
    for (const [who, p] of people) {
      const c = p.client;
      const calls: [string, Promise<unknown>][] = [
        ["platform plans", c.get(`/admin/plans`)],
        ["platform backups", c.get(`/admin/backups`)],
        ["platform audit", c.get(`/admin/audit-all`)],
        ["system logs", c.get(`${w.P}/admin/logs?kind=jobs`)],
        ["member import", c.post(`${w.P}/admin/members/import`, { rows: [{ email: "x@example.com", name: "نفر تازه" }], dry_run: true })],
        ["studio table", c.post(`${w.P}/admin/studio/tables`, { label: "جدول آزمایشی" })],
        ["access matrix", c.get(`${w.P}/admin/access/matrix?user=${w.p.req.userId}`)],
        ["access explanation", c.post(`${w.P}/admin/access/explain`, { user_id: w.p.req.userId, table: "incident" })],
        ["data export", c.post(`${w.P}/admin/exports`, { tables: ["incident"], format: "json" })],
        ["branding", c.put(`${w.P}/admin/branding`, { portal_title: "پرتال" })],
        ["features", c.put(`${w.P}/admin/features/custom_tables`, { enabled: false })],
        ["integration hub", c.get(`${w.P}/integration/hub`)],
        ["integration log", c.get(`${w.P}/integration/log`)],
        ["api keys", c.get(`${w.P}/integration/keys`)],
      ];
      for (const [what, call] of calls) expect(await statusOf(call), `${who}: ${what}`).toBe(403);
      // notices in force are for every member
      expect(Array.isArray((await c.get(`${w.P}/admin/notices/active`)).notices)).toBe(true);
    }
  });

  it("a data export is read only by the person who asked for it", async () => {
    const ex = (await w.o.post(`${w.P}/admin/exports`, { tables: ["incident"], format: "json" })).export;
    await w.drain();
    expect((await w.o.get(`${w.P}/r/data_export/${ex.id}`)).row.status).toBe("ready");
    for (const [who, p] of people) {
      expect([403, 404], who).toContain(await statusOf(p.client.get(`${w.P}/r/data_export/${ex.id}`)));
      const list = await p.client.get(`${w.P}/r/data_export?size=50`).catch(() => ({ rows: [] }));
      expect(list.rows.map((r: { id: string }) => r.id), who).not.toContain(ex.id);
    }
  });

  it("integration users, their keys and the hub's secrets never reach other members", async () => {
    const iu = (await w.o.post(`${w.P}/r/integration_user`, { name: "سامانهٔ پایش", description: "ارسال هشدار" })).row;
    await w.o.put(`${w.P}/integration/users/${iu.id}/roles`, { roles: ["agent"] });
    const key = await w.o.post(`${w.P}/integration/users/${iu.id}/keys`, { name: "کلید پایش", scopes: [{ table: "incident", ops: ["read", "create"] }] });
    expect(key.key).toMatch(/^sm_/);
    const hook = (await w.o.post(`${w.P}/r/webhook_subscription`, { name: "ارسال به پایش", url: "https://hooks.example.com/itsm", principal_id: iu.id, table_key: "incident", events: ["created"] })).row;
    expect(JSON.stringify(hook)).not.toMatch(/"secret":"[^"*•]{8,}/);
    for (const [who, p] of people) {
      if (p === w.p.auditor) {
        // the auditor reads every record, the hub's configuration too — never a secret or a key
        expect((await p.client.get(`${w.P}/r/integration_user/${iu.id}`)).row.name).toBe("سامانهٔ پایش");
        const seen = (await p.client.get(`${w.P}/r/webhook_subscription/${hook.id}`)).row;
        expect(JSON.stringify(seen)).not.toMatch(/"secret":"[^"*•]{8,}/);
        expect(await statusOf(p.client.post(`${w.P}/integration/secret`, { table: "webhook_subscription", id: hook.id })), `${who}: new secret`).toBe(403);
      } else {
        expect([403, 404], `${who}: integration user`).toContain(await statusOf(p.client.get(`${w.P}/r/integration_user/${iu.id}`)));
        expect([403, 404], `${who}: webhook`).toContain(await statusOf(p.client.get(`${w.P}/r/webhook_subscription/${hook.id}`)));
      }
      expect(await statusOf(p.client.get(`${w.P}/integration/keys?user=${iu.id}`)), `${who}: keys`).toBe(403);
    }
  });

  it("the defaults of both modules seed once: running them again adds nothing", async () => {
    const count = async () => {
      const q = (sql: string) => w.e.cfg.db.one<{ n: number }>(sql, [w.e.org]).then((r) => r?.n ?? 0);
      return {
        pools: await q(`select count(*)::int as n from sm_licence_pools where org_id = $1 and deleted_at is null`),
        maps: await q(`select count(*)::int as n from sm_transform_maps where org_id = $1 and deleted_at is null`),
        rules: await q(`select count(*)::int as n from sm_notification_rules where org_id = $1 and deleted_at is null`),
        flags: await q(`select count(*)::int as n from sm_platform_flags where $1::uuid is not null`),
        plans: await q(`select count(*)::int as n from sm_plans where $1::uuid is not null`),
      };
    };
    await seedAdminDefaults(w.e.cfg, w.e.org);
    await seedIntegrationDefaults(w.e.cfg, w.e.org);
    const before = await count();
    expect(before.pools).toBe(2);
    expect(before.maps).toBe(1);
    expect(before.plans).toBe(3);
    expect((await seedAdminDefaults(w.e.cfg, w.e.org)).skipped).toBe(true);
    for (let i = 0; i < 2; i++) {
      const a = await seedAdminDefaults(w.e.cfg, w.e.org, { force: true });
      expect(a.created).toEqual({});
      expect(await seedIntegrationDefaults(w.e.cfg, w.e.org)).toEqual({});
    }
    expect(await count()).toEqual(before);
    // a deleted default comes back with «افزودن پیش‌فرض‌ها», once
    const pool = (await w.o.get(`${w.P}/r/licence_pool?size=10`)).rows.find((r: { kind: string }) => r.kind === "admin");
    await w.o.del(`${w.P}/r/licence_pool/${pool.id}`);
    const again = await w.o.post(`${w.P}/admin/seed`);
    expect(again.created).toEqual({ licence_pool: 1 });
    expect(await count()).toEqual(before);
  });
});
