// The tenant console's studio and tools: custom tables in the registry's slots with fields of the organisation (records,
// validation, filters, history, sync roots, generated AI tools), versions and restore, packages exported from one
// organisation and imported into another, drafts from a Persian description without a model, the access matrix with
// its explanations, member import, import sets with transform maps, data exports, seats and logs.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, upload, type EngineOrg } from "./engine-helpers";
import { Client, signupWithOrg } from "./helpers";
import { tick } from "@server/jobs";
import { BY_ENTITY } from "@server/sync/registry";
import { recordTools } from "@server/modules/ai/tools/records";
import { draftFromText, fieldNameFor, packageProblem } from "@shared/admin/studio";
import { suggestMapping, applySpec } from "@shared/admin/mapping";

async function drain(e: EngineOrg) {
  for (let i = 0; i < 20; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
}

describe("studio: custom tables and fields on the engine", () => {
  let e: EngineOrg;
  let P: string;
  let agent: { client: Client; userId: string };
  let slot: string;

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    agent = await e.member("member", "agent@example.com");
    await e.owner.put(`${P}/access/members/${agent.userId}`, { roles: ["agent"], persona: "agent" });
    await drain(e);
  });

  it("drafts a table from a Persian description without a model", async () => {
    const d = draftFromText("جدول ثبت ملاقات‌ها با فیلدهای نام مهمان (الزامی)، تاریخ ملاقات، میزبان، شماره تماس و وضعیت");
    expect(d.label).toBe("ثبت ملاقات‌ها");
    expect(d.fields.map((f) => f.type)).toEqual(["string", "date", "user", "phone", "choice"]);
    expect(d.fields[0].required).toBe(true);
    expect(d.fields[4].options!.map((o) => o.label)).toEqual(["باز", "در جریان", "انجام شده"]);
    expect(fieldNameFor("تاریخ ملاقات", [])).toMatch(/^u_[a-z0-9_]+$/);
    const r = await e.owner.post(`${P}/admin/studio/draft`, { description: "جدول کلیدهای انبار شامل کد کلید، تحویل‌گیرنده، تاریخ تحویل" });
    expect(r.ai).toBe(false);
    expect(r.draft.fields.map((f: { type: string }) => f.type)).toEqual(["string", "user", "date"]);
  });

  it("creates a custom table in a slot; its records validate, filter and keep history like any table", async () => {
    const { draft } = await e.owner.post(`${P}/admin/studio/draft`, { description: "ملاقات‌ها با فیلدهای نام مهمان (الزامی)، تاریخ ملاقات، میزبان و وضعیت" });
    const created = await e.owner.post(`${P}/admin/studio/tables`, { label: draft.label, plural: draft.plural, fields: draft.fields, code: "visits" });
    slot = created.slot;
    expect(slot).toBe("custom_01");
    const { slots } = await e.owner.get(`${P}/admin/studio`);
    expect(slots[0]).toMatchObject({ slot: "custom_01", fields: 4 });
    expect(slots[0].table.code).toBe("visits");
    const meta = await e.owner.get(`${P}/meta/tables/${slot}`);
    const names = meta.table.fields.map((f: { name: string }) => f.name);
    const guest = draft.fields[0].name as string;
    const status = draft.fields[3].name as string;
    expect(names).toContain(guest);
    // required custom field
    await e.owner.req("POST", `${P}/r/${slot}`, { title: "بی‌مهمان" }, 400);
    const open = draft.fields[3].options[0].value as string;
    const rec = (await e.owner.post(`${P}/r/${slot}`, { title: "ملاقات با تأمین‌کننده", [guest]: "علی رضایی", [status]: open })).row;
    expect(rec.number).toMatch(/^CT01/);
    await e.owner.req("POST", `${P}/r/${slot}`, { title: "گزینهٔ نادرست", [guest]: "x", [status]: "zzz" }, 400);
    const filtered = await e.owner.get(`${P}/r/${slot}?filter=${encodeURIComponent(JSON.stringify({ f: guest, op: "eq", v: "علی رضایی" }))}`);
    expect(filtered.rows).toHaveLength(1);
    await e.owner.patch(`${P}/r/${slot}/${rec.id}`, { [guest]: "مریم کاظمی", version: rec.version });
    const hist = await e.owner.get(`${P}/r/${slot}/${rec.id}/history`);
    expect(hist.entries.some((h: { field: string }) => h.field === guest)).toBe(true);
  });

  it("is a sync root and appears in the generated AI tools with the organisation's field labels", async () => {
    expect(BY_ENTITY.get(slot)?.engine).toBe("record");
    const ctx = await e.ctxOf(e.ownerId);
    const tools = await recordTools(ctx, { proposals: true });
    const search = tools.find((t) => t.table === slot && t.op === "search");
    expect(search).toBeTruthy();
    expect(search!.terms).toContain("نام مهمان");
    // an agent has no grant in «جدول‌های سفارشی» until a role gives it: no tools, no rows
    const agentCtx = await e.ctxOf(agent.userId);
    expect((await recordTools(agentCtx, { proposals: true })).some((t) => t.table === slot)).toBe(false);
    await agent.client.get(`${P}/r/${slot}`, 403);
  });

  it("publishes versions and restores one", async () => {
    await e.owner.post(`${P}/admin/studio/tables/${slot}/publish`, { note: "نخستین نسخه" });
    const fields = (await e.owner.get(`${P}/admin/studio/fields/${slot}`)).fields as { name: string; label: string; type: string }[];
    const guest = fields.find((f) => f.label === "نام مهمان")!;
    await e.owner.put(`${P}/admin/studio/fields/${slot}`, { fields: [{ ...guest, label: "نام بازدیدکننده" }, { name: "u_extra", label: "یادداشت", type: "text" }] });
    let meta = await e.owner.get(`${P}/meta/tables/${slot}`);
    expect(meta.table.fields.find((f: { name: string }) => f.name === guest.name).label).toBe("نام بازدیدکننده");
    const versions = (await e.owner.get(`${P}/r/studio_version?filter=${encodeURIComponent(JSON.stringify({ f: "table_code", op: "eq", v: "visits" }))}`)).rows;
    expect(versions[0].revision).toBe(1);
    await e.owner.post(`${P}/admin/studio/versions/${versions[0].id}/restore`);
    meta = await e.owner.get(`${P}/meta/tables/${slot}`);
    expect(meta.table.fields.find((f: { name: string }) => f.name === guest.name).label).toBe("نام مهمان");
    expect(meta.table.fields.some((f: { name: string }) => f.name === "u_extra")).toBe(false);
  });

  it("exports a package and imports it into another organisation (preview first)", async () => {
    await e.owner.put(`${P}/admin/studio/fields/incident`, { fields: [{ name: "u_building", label: "ساختمان", type: "string" }] }).catch(() => undefined);
    const pkg = await e.owner.get(`${P}/admin/studio/export`);
    expect(packageProblem(pkg)).toBeNull();
    expect(pkg.tables[0].code).toBe("visits");
    // another organisation on the same server (its own owner)
    const other = new Client(e.app);
    const orgB = await signupWithOrg(other, { email: "b-owner@example.com", name: "سازمان ب" });
    await other.post(`/o/${orgB}/admin/studio/tables`, { label: "انبار", code: "store" });
    const preview = await other.post(`/o/${orgB}/admin/studio/import`, { package: pkg, dry_run: true });
    expect(preview.applied).toBe(false);
    expect(preview.tables[0]).toMatchObject({ code: "visits", action: "create", slot: "custom_02" });
    expect((await other.get(`/o/${orgB}/admin/studio`)).slots[1].table).toBeNull();
    const applied = await other.post(`/o/${orgB}/admin/studio/import`, { package: pkg, dry_run: false });
    expect(applied.applied).toBe(true);
    const metaB = await other.get(`/o/${orgB}/meta/tables/custom_02`);
    expect(metaB.table.fields.some((f: { label: string }) => f.label === "نام مهمان")).toBe(true);
    // organisation A's meaning of its slot is not organisation B's
    const metaA = await e.owner.get(`${P}/meta/tables/custom_02`);
    expect(metaA.table.fields.some((f: { label: string }) => f.label === "نام مهمان")).toBe(false);
    await other.get(`${P}/admin/studio`, 403);
  });
});

describe("access matrix, member import, imports, exports, seats, logs", () => {
  let e: EngineOrg;
  let P: string;
  let agent: { client: Client; userId: string };
  let req: { client: Client; userId: string };

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    agent = await e.member("member", "agent2@example.com");
    req = await e.member("member", "req2@example.com");
    await e.owner.put(`${P}/access/members/${agent.userId}`, { roles: ["agent"], persona: "agent" });
    await e.owner.put(`${P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
    await drain(e);
  });

  it("shows who can see what, and explains it in plain Persian", async () => {
    const m = await e.owner.get(`${P}/admin/access/matrix?user=${req.userId}`);
    const todo = m.rows.find((r: { table: string }) => r.table === "todo");
    expect(todo).toMatchObject({ read: "own", create: true, write: "own" });
    expect(m.rows.some((r: { table: string }) => r.table === "custom_03")).toBe(false); // unused slots are not shown
    const role = await e.owner.get(`${P}/admin/access/matrix?role=agent`);
    expect(role.rows.find((r: { table: string }) => r.table === "todo").read).toBe("all");
    const t = (await agent.client.post(`${P}/r/todo`, { short_description: "کار کارشناس" })).row;
    const who = await e.owner.get(`${P}/admin/access/who?table=todo&id=${t.id}`);
    const names = who.readers.map((r: { user_id: string }) => r.user_id);
    expect(names).toContain(agent.userId);
    expect(names).not.toContain(req.userId);
    const x = await e.owner.post(`${P}/admin/access/explain`, { user_id: req.userId, table: "todo", record_id: t.id });
    expect(x.check.record.explanation.read).toBe(false);
    expect(x.ai).toBe(false);
    expect(x.text).toContain("نمی‌بیند");
    // only access administrators use it
    await agent.client.req("GET", `${P}/admin/access/matrix?user=${req.userId}`, undefined, 403);
  });

  it("imports members with a preview, never granting a role nobody named", async () => {
    const rows = [
      { email: "new.one@example.com", name: "عضو تازه یک", title: "کارمند", unit: "مالی" },
      { email: "new.two@example.com", name: "عضو تازه دو", manager: "new.one@example.com" },
      { email: "bad", name: "نشانی بد" },
      { email: "svc@service.invalid", name: "حساب خدمت" },
      { email: "new.one@example.com", name: "تکراری" },
    ];
    const dry = await e.owner.post(`${P}/admin/members/import`, { rows, dry_run: true, create_units: true });
    expect(dry).toMatchObject({ created: 2, skipped: 3, units: ["مالی"] });
    expect((await e.owner.get(`${P}/members`)).members.some((m: { email: string }) => m.email === "new.one@example.com")).toBe(false);
    const done = await e.owner.post(`${P}/admin/members/import`, { rows, dry_run: false, create_units: true, role: "requester" });
    expect(done.created).toBe(2);
    const list = (await e.owner.get(`${P}/access/members`)).members as { user_id: string; email: string; roles: string[] }[];
    const one = list.find((m) => m.email === "new.one@example.com")!;
    expect(one.roles).toEqual(["requester"]);
    const detail = await e.owner.get(`${P}/access/members/${list.find((m) => m.email === "new.two@example.com")!.user_id}`);
    expect(detail.profile.manager_id).toBe(one.user_id);
    // without a named role: no ITSM role at all (and the membership is «ناظر»)
    await e.owner.post(`${P}/admin/members/import`, { rows: [{ email: "plain@example.com", name: "بدون نقش" }], dry_run: false });
    const plain = ((await e.owner.get(`${P}/members`)).members as { email: string; role: string }[]).find((m) => m.email === "plain@example.com")!;
    expect(plain.role).toBe("viewer");
    await agent.client.req("POST", `${P}/admin/members/import`, { rows, dry_run: true }, 403);
  });

  it("runs import sets through a transform map (dry run first, key field updates)", async () => {
    const map = (
      await e.owner.post(`${P}/r/transform_map`, {
        name: "کارها از اکسل",
        target_table: "todo",
        key_field: "number",
        rules: [
          { source: "عنوان", target: "short_description", transform: "trim" },
          { source: "اولویت", target: "priority", transform: "map", map: { "فوری": "1", "عادی": "4" } },
        ],
      })
    ).row;
    const set = (await e.owner.post(`${P}/r/import_set`, { name: "ورود کارها", target_table: "todo", transform_map_id: map.id })).row;
    const csv = "عنوان,اولویت\n  کار اول  ,فوری\nکار دوم,عادی\n";
    const res = await upload(e.app, e.owner, `${P}/r/import_set/${set.id}/attachments`, "kar.csv", new TextEncoder().encode(csv), "text/csv");
    expect(res.status).toBe(200);
    const analyzed = await e.owner.post(`${P}/admin/imports/${set.id}/analyze`);
    expect(analyzed.headers).toEqual(["عنوان", "اولویت"]);
    expect(analyzed.total).toBe(2);
    const sug = await e.owner.post(`${P}/admin/imports/suggest`, { table: "todo", headers: ["عنوان", "اولویت", "ستون ناشناخته"], sample: [] });
    expect(sug.mapping.map((m: { field: string | null }) => m.field)).toEqual(["short_description", "priority", null]);
    const dry = await e.owner.post(`${P}/admin/imports/${set.id}/run`, { dry_run: true });
    expect(dry).toMatchObject({ created: 2, errors: [] });
    expect((await e.owner.get(`${P}/r/todo?q=${encodeURIComponent("کار اول")}`)).rows).toHaveLength(0);
    const run = await e.owner.post(`${P}/admin/imports/${set.id}/run`, { dry_run: false });
    expect(run.created).toBe(2);
    const first = (await e.owner.get(`${P}/r/todo?q=${encodeURIComponent("کار اول")}`)).rows[0];
    expect(String(first.priority)).toBe("1");
    expect((await e.owner.get(`${P}/r/import_set/${set.id}`)).row.status).toBe("done");
    // pure parts: suggestions and transforms
    expect(suggestMapping(["Email", "نام و نام خانوادگی"], [{ name: "email", label: "ایمیل" }, { name: "full_name", label: "نام" }]).map((s) => s.field)).toEqual(["email", "full_name"]);
    expect(applySpec({ a: "x", b: "y" }, { rules: [{ source: "a", target: "t", transform: "join", sources: ["b"], sep: "-" }] })).toEqual({ t: "x-y" });
  });

  it("exports data with the requester's access, readable only by them", async () => {
    await req.client.post(`${P}/r/todo`, { short_description: "کار درخواست‌دهنده" });
    const { export: row } = await e.owner.post(`${P}/admin/exports`, { tables: ["todo", "incident_not_a_table"].slice(0, 1), format: "csv" });
    await drain(e);
    const done = (await e.owner.get(`${P}/r/data_export/${row.id}`)).row;
    expect(done.status).toBe("ready");
    const files = await e.owner.get(`${P}/r/data_export/${row.id}/attachments`);
    expect(files.attachments[0].name).toMatch(/todo\.csv$/);
    // another administrator does not read someone else's export
    const admin2 = await e.member("admin", "admin2@example.com");
    await admin2.client.get(`${P}/r/data_export/${row.id}`, 404);
    await e.owner.req("POST", `${P}/admin/exports`, { tables: [], format: "csv" }, 400);
  });

  it("counts seats from roles and shows system logs", async () => {
    await e.owner.post(`${P}/admin/seed`);
    const lic = await e.owner.get(`${P}/admin/licences`);
    const agents = lic.summary.find((s: { kind: string }) => s.kind === "agent");
    expect(agents.quantity).toBe(25);
    expect(agents.used).toBeGreaterThanOrEqual(1);
    expect(lic.people.some((p: { user_id: string }) => p.user_id === req.userId)).toBe(false); // requesters take no seat
    for (const kind of ["jobs", "notifications", "flows", "integrations", "security"]) {
      const r = await e.owner.get(`${P}/admin/logs?kind=${kind}`);
      expect(Array.isArray(r.rows)).toBe(true);
    }
    await agent.client.get(`${P}/admin/logs?kind=jobs`, 403);
    const home = await e.owner.get(`${P}/admin/home`);
    expect(home.onboarding.find((s: { key: string }) => s.key === "people").done).toBe(true);
  });
});
