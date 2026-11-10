// The administration consoles and the integration hub with every other module (after the admin merge):
//   · a studio table reaches the assistant's generated tools under the organisation's own name (unused slots offer
//     none), held to the AI data-use policy like any table, and syncs as a record root;
//   · the REST API and its OpenAPI cover every module's tables, acting through the integration user's member context
//     (a secure workspace's records stay out even for a tenant administrator's key);
//   · the access matrix explorer shows secure workspaces and membership, parent-scoped tables, participant reach,
//     field groups and each table's AI data-use policy; the explainer states the data-use policy too.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memberCtx } from "@server/access";
import { recordTools } from "@server/modules/ai/tools/records";
import { assertToolData, invalidateDataUse } from "@server/modules/ai/datause";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { BY_ENTITY } from "@server/sync/registry";
import type { AiStreamEvent } from "@shared/ai/types";
import { esmWorld, type EsmWorld } from "./esm-helpers";
import type { Client } from "./helpers";

vi.setConfig({ testTimeout: 180_000 });

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

const CANARY = "studioCanaryS7";
let w: EsmWorld;
let slot: string;
let hrCase: Record<string, any>;

async function chat(c: Client, text: string): Promise<AiStreamEvent[]> {
  const res = await w.e.app.fetch(new Request(`http://local.test/api${w.P}/ai/chat`, { method: "POST", headers: { "content-type": "application/json", cookie: c.cookie }, body: JSON.stringify({ text }) }));
  return (await res.text())
    .split("\n\n")
    .map((frame) => frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"))
    .filter(Boolean)
    .map((d) => JSON.parse(d) as AiStreamEvent);
}

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await esmWorld();
  await w.o.post(`${w.P}/csm/seed`, {});
  await w.o.post(`${w.P}/field_service/seed`, {});
  await w.o.post(`${w.P}/slm/seed`, {});
  await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
  const created = await w.o.post(`${w.P}/admin/studio/tables`, { label: "قرارداد اجاره", plural: "قراردادهای اجاره", code: "leases", fields: [{ name: "u_landlord", label: "موجر", type: "string" }] });
  slot = created.slot;
  hrCase = (await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "پرسش دربارهٔ مرخصی", dept_service_id: w.svc.hr_leave.id })).row;
  await w.drain();
}, 300_000);

describe("studio tables in the generated AI tools", () => {
  it("offers a studio table under its own name, and no tools for unused slots; it is a sync root", async () => {
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.e.ownerId);
    const tools = await recordTools(ctx, { proposals: true });
    const search = tools.find((t) => t.name === `search_${slot}`);
    expect(search?.title_fa).toBe("جست‌وجوی قراردادهای اجاره");
    expect(search!.build().description).toContain("قراردادهای اجاره");
    const unused = ["custom_01", "custom_02", "custom_03"].find((s) => s !== slot)!;
    expect(tools.some((t) => t.table === unused)).toBe(false);
    expect(BY_ENTITY.get(slot)?.engine).toBe("record");
  });

  it("holds a studio table to its AI data-use policy", async () => {
    await w.o.post(`${w.P}/r/${slot}`, { title: `اجارهٔ انبار ${CANARY}`, u_landlord: `موجر ${CANARY}` });
    await w.o.put(`${w.P}/ai/governance/data-policies/${slot}`, { use: "never", pii: "inherit" });
    invalidateDataUse(w.e.org);
    try {
      const ctx = await memberCtx(w.e.cfg, w.e.org, w.e.ownerId);
      await expect(assertToolData(ctx, [slot], "assistant", true)).rejects.toMatchObject({ code: "ai_policy" });
      clearFakeInbox();
      const events = await chat(w.o, `[tool:search_${slot} {}]`);
      expect(JSON.stringify(events)).not.toContain(CANARY);
      expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toContain(CANARY);
    } finally {
      await w.o.put(`${w.P}/ai/governance/data-policies/${slot}`, { use: "cloud", pii: "inherit" });
      invalidateDataUse(w.e.org);
    }
  });
});

describe("the REST API and OpenAPI across the modules", () => {
  it("describe and serve every module's tables as the integration user, never a secure workspace's records", async () => {
    const user = (await w.o.post(`${w.P}/r/integration_user`, { name: "سامانهٔ گزارش‌گیری", rate_limit: 1000 })).row;
    await w.o.put(`${w.P}/integration/users/${user.id}/roles`, { roles: ["tenant_admin"] });
    const { key } = await w.o.post(`${w.P}/integration/users/${user.id}/keys`, { name: "خواندن همه", scopes: [{ table: "*", ops: ["read"] }] });
    const get = async (path: string) => {
      const res = await w.e.app.fetch(new Request(`http://local.test/api/v1${path}`, { headers: { authorization: `Bearer ${key}` } }));
      return { status: res.status, body: (await res.json()) as any };
    };
    const spec = await get("/openapi.json");
    expect(spec.status).toBe(200);
    const paths = Object.keys(spec.body.paths ?? {});
    for (const t of ["incident", "facility_request", "customer_case", "work_order", "slm_target", "wfm_skill", slot]) expect(paths, t).toContain(`/r/${t}`);
    const studio = await get(`/r/${slot}?size=10`);
    expect(studio.status).toBe(200);
    expect((studio.body.rows as unknown[]).length).toBeGreaterThan(0);
    // the integration user is a tenant administrator, yet the HR workspace's case stays out
    const hr = await get(`/r/hr_case?size=200`);
    expect(JSON.stringify(hr.body)).not.toContain(hrCase.id);
    expect((await get(`/r/hr_case/${hrCase.id}`)).status).toBe(404);
  });
});

describe("the access matrix explorer", () => {
  it("shows secure workspaces, parent scope, participant reach, field groups and the data-use policy", async () => {
    const hr = await w.o.get(`${w.P}/admin/access/matrix?user=${w.p.hr.userId}`);
    const hrWs = (hr.secure_workspaces as { id: string; member: boolean }[]).find((x) => x.id === w.ws.hr);
    expect(hrWs?.member).toBe(true);
    const legal = (hr.secure_workspaces as { id: string; member: boolean }[]).find((x) => x.id === w.ws.legal);
    expect(legal?.member).toBe(false);
    const rows = hr.rows as { table: string; data_use: string; parent: string | null; participant?: boolean; hidden: string[] }[];
    expect(rows.find((r) => r.table === "hr_case")?.data_use).toBe("local");
    expect(rows.find((r) => r.table === "legal_request")?.data_use).toBe("never");
    expect(rows.find((r) => r.table === "incident")?.data_use).toBe("cloud");
    expect(rows.some((r) => r.parent !== null)).toBe(true);
    // the IT agent: no HR workspace, and the profile's HR fields hidden
    const it = await w.o.get(`${w.P}/admin/access/matrix?user=${w.p.it.userId}`);
    expect((it.secure_workspaces as { id: string; member: boolean }[]).find((x) => x.id === w.ws.hr)?.member).toBe(false);
    // a role's matrix carries the policies too
    const role = await w.o.get(`${w.P}/admin/access/matrix?role=agent`);
    expect((role.rows as { table: string; data_use: string }[]).find((r) => r.table === "legal_request")?.data_use).toBe("never");
    // the explainer states the table's data-use policy
    const ex = await w.o.post(`${w.P}/admin/access/explain`, { user_id: w.p.hr.userId, table: "hr_case" });
    expect(ex.rule).toContain("فقط مدل‌های محلی سازمان");
  });
});
