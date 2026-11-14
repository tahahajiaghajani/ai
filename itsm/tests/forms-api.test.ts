// F2 — the API of forms (design F §3.2, §6.1, §8.2): GET /forms lists every form of the system — each table's default
// form (100 % of the tables people open on a form; the studio's under the organisation's names), the process forms,
// and the four linked kinds (catalogue forms, the portals' «گزارش مشکل», surveys, the change risk questionnaire), each
// with its editor's link; who may read and write them; the form's hooks on every path (fields that exist and can be
// used, a retired field refused in a new form and kept in an existing one, valid «نمایش وقتی…» conditions, system
// fields, Windows pushes, a form a process uses never deleted); usage reported to the field library; and the preview,
// by step and viewpoint, through the one shared `effectiveRights`.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { physicalTables } from "@shared/tables";
import { isNever } from "@shared/model/conditions";
import { isCustomSlot } from "@shared/admin/studio";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { effectiveRights, tableFormFields, type StepRights } from "@shared/forms/layout";
import { snapshotFields } from "@shared/forms/snapshot";
import { seedRequestDefaults } from "@server/modules/request";
import { seedPortalDefaults } from "@server/modules/portal";
import { seedChangeDefaults } from "@server/modules/change";
import { loadFormsSnapshot, registerFormUsage, registerStepRights } from "@server/modules/forms";
import { fieldUsage, libraryUsage } from "@server/modules/fields/usage";
import type { Queryable } from "@server/db";

type Msg = { error: { message: string; details?: { problems?: string[] } | null } };
type Entry = { key: string; kind: string; name: string; table: string | null; group: string; id: string | null; fields: number; overrides?: number; arranged?: boolean; status?: string; version?: number; used_in: string[]; note?: string; updated_at: string | null; link: string; editable: boolean };
type List = { kinds: { key: string; label: string; count: number; available: boolean }[]; forms: Entry[] };

let e: EngineOrg;
let P: string;
let R: string;
let member: { client: Client; userId: string };
let viewer: { client: Client; userId: string };
let editor: { client: Client; userId: string };
let designer: { client: Client; userId: string };
const unregister: (() => void)[] = [];

const msg = (r: unknown) => (r as Msg).error.message;
const one = (items: unknown[]) => ({ tabs: [{ label: "درخواست", sections: [{ label: null, items }] }] });
const list = (c: Client, q = "") => c.get(`${P}/forms${q}`) as Promise<List>;

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  R = `${P}/r`;
  await seedRequestDefaults(e.cfg, e.org);
  await seedPortalDefaults(e.cfg, e.org);
  await seedChangeDefaults(e.cfg, e.org);
  member = await e.member("member");
  viewer = await e.member("viewer");
  editor = await e.member("member");
  const mid = (await e.db.one<{ id: string }>(`select id from sm_org_members where org_id = $1 and user_id = $2`, [e.org, editor.userId]))!.id;
  await e.owner.patch(`${P}/members/${mid}`, { overrides: { settings: "edit" } });
  // «طراح فرم»: the access model's grant in «طراحی فرم و گردش‌کار» and nothing else
  await e.owner.put(`${P}/access/roles/form_designer`, { name: "طراح فرم", persona: "agent", grants: { process_design: { read: "all", create: true, write: "all" } }, field_groups: [], contains: [], workspaces: "member", domains: "own" });
  designer = await e.member("member");
  await e.owner.put(`${P}/access/members/${designer.userId}`, { roles: ["form_designer"], persona: "agent" });
  for (const [name, label, type, more] of [
    ["u_letter_no", "شمارهٔ نامه", "string", {}],
    ["u_amount", "مبلغ درخواستی", "money", { field_group: "financial" }],
    ["u_national", "کد ملی", "national_id", { field_group: "personal" }],
    ["u_reason", "علت", "text", {}],
    ["u_pay", "شیوهٔ پرداخت", "radio", { options: [{ value: "cash", label: "نقد" }, { value: "card", label: "کارت" }] }],
    ["u_agree", "تعهد", "checkbox", {}],
  ] as const) {
    await e.owner.post(`${P}/fields/library`, { name, label, type, ...more }, 201);
  }
}, 900_000);

afterAll(() => {
  for (const u of unregister) u();
});

describe("GET /forms: every form of the system", () => {
  let studioSlot: string;
  let tenderForm: string;

  beforeAll(async () => {
    studioSlot = (await e.owner.post(`${P}/admin/studio/tables`, { label: "بازدید شعبه", plural: "بازدیدهای شعبه", code: "branch_visits" })).slot;
    tenderForm = (await e.owner.post(`${P}/forms`, { name: "فرم مناقصه", layout: one([{ field: "u_letter_no" }, { field: "u_amount", required: true }, { text: "برگه‌ها را پیوست کنید" }]) }, 201)).form.id;
    await e.owner.post(`${P}/forms`, { name: "فرم تنخواه", layout: one([{ field: "u_amount" }]) }, 201);
    unregister.push(registerFormUsage(async (_q, _org, forms) => Object.fromEntries(forms.filter((f) => f.id === tenderForm).map((f) => [f.id, ["خرید کالا", "تنخواه شعبه"]]))));
  }, 600_000);

  it("lists 100 % of the tables with a form, the process forms and the four linked kinds, each with its editor's link", async () => {
    const all = await list(e.owner);
    expect(all.kinds.map((k) => k.key)).toEqual(["system", "process", "catalog", "portal_report", "survey", "risk"]);
    expect(all.kinds.every((k) => k.available && k.count > 0)).toBe(true);
    for (const k of all.kinds) expect(all.forms.filter((f) => f.kind === k.key).length).toBe(k.count);
    expect(new Set(all.forms.map((f) => f.key)).size).toBe(all.forms.length);

    // system forms: every table the record page opens on a form — the custom-field manager's tables, less the ones the
    // record API never serves, the case table (its forms are process forms) and the studio's unused slots
    const system = new Map(all.forms.filter((f) => f.kind === "system").map((f) => [f.table!, f]));
    const managerOffers = physicalTables().filter((t) => !["custom_field", "choice", "view"].includes(t.key));
    const expected = managerOffers.filter((t) => !isNever(t.rowAccess?.read ?? null) && t.key !== "process_case" && (!isCustomSlot(t.key) || t.key === studioSlot));
    expect([...system.keys()].sort()).toEqual(expected.map((t) => t.key).sort());
    expect(system.size).toBeGreaterThan(400);
    expect(managerOffers.filter((t) => !system.has(t.key) && !isCustomSlot(t.key)).map((t) => t.key).sort()).toEqual(["ai_agent_run", "portal_link_code", "process_case"]);
    for (const [key, f] of system) {
      expect(f).toMatchObject({ key: `system:${key}`, link: `settings/forms/t/${key}`, editable: true, id: null });
      expect(f.fields).toBe(tableFormFields(physicalTables().find((t) => t.key === key)!).length);
    }
    expect(system.get("incident")).toMatchObject({ name: "رخدادها", group: "رخدادها", overrides: 0, arranged: false });
    expect(system.get(studioSlot)).toMatchObject({ name: "بازدیدهای شعبه", group: "جدول‌های سفارشی" });

    // process forms: status, version, the processes that use them
    const process = all.forms.filter((f) => f.kind === "process");
    expect(process.map((f) => f.name)).toEqual(["فرم تنخواه", "فرم مناقصه"]);
    expect(process.find((f) => f.id === tenderForm)).toMatchObject({ table: null, group: "گردش‌کارها", fields: 2, status: "draft", version: 0, used_in: ["تنخواه شعبه", "خرید کالا"], link: `settings/forms/${tenderForm}`, editable: true });

    // catalogue forms: items and record producers (not content links), with their questions and sets
    const catalog = all.forms.filter((f) => f.kind === "catalog");
    const items = await e.db.query<{ id: string; type: string; target_table: string | null }>(`select id, type, target_table from sm_catalog_items where org_id = $1 and deleted_at is null and type <> 'content'`, [e.org]);
    expect(catalog.map((f) => f.id).sort()).toEqual(items.map((i) => String(i.id)).sort());
    for (const f of catalog) {
      expect(f.link).toBe(`catalog-items/${f.id}/builder`);
      const item = items.find((i) => String(i.id) === f.id)!;
      expect(f.table).toBe(item.type === "record_producer" && item.target_table ? item.target_table : "request_item");
    }
    expect(catalog.some((f) => f.fields > 0)).toBe(true);

    // the portals' «گزارش مشکل»: the built-in form (incident) unless a catalogue form is chosen
    const portals = await e.db.query<{ id: string; name: string }>(`select id, name from sm_portals where org_id = $1 and deleted_at is null and active`, [e.org]);
    const reports = all.forms.filter((f) => f.kind === "portal_report");
    expect(reports.map((f) => f.id).sort()).toEqual(portals.map((p) => String(p.id)).sort());
    expect(reports[0]).toMatchObject({ table: "incident", note: "فرم پیش‌فرض درگاه (رخداد)", fields: 3, link: `portal-admin/portals/${reports[0].id}` });
    expect(system.get("incident")!.used_in).toEqual(portals.map((p) => `${p.name}: گزارش مشکل`));

    // surveys and the change risk questionnaire
    const surveys = await e.db.query<{ id: string; n: number }>(
      `select s.id, (select count(*)::int from sm_survey_questions q where q.survey_id = s.id and q.deleted_at is null) as n from sm_surveys s where s.org_id = $1 and s.deleted_at is null`,
      [e.org],
    );
    const shown = all.forms.filter((f) => f.kind === "survey");
    expect(shown.map((f) => [f.id, f.fields]).sort()).toEqual(surveys.map((s) => [String(s.id), Number(s.n)]).sort());
    for (const f of shown) expect(f.link).toBe(`portal-admin/surveys/${f.id}`);
    const risk = all.forms.filter((f) => f.kind === "risk");
    const questions = (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_change_risk_questions where org_id = $1 and deleted_at is null and active`, [e.org]))!.n;
    expect(risk).toEqual([expect.objectContaining({ key: "risk", table: "change_request", fields: questions, status: "فعال", used_in: ["تغییرها"], link: "changes/risk-questions" })]);
    expect(questions).toBeGreaterThan(0);

    // the linked kinds open pages the app has (the module's routes: a list path and its record page `<path>/:id`)
    const ui = (file: string) => readFileSync(new URL(`../src/ui/modules/${file}`, import.meta.url), "utf8");
    expect(ui("request/index.tsx")).toContain(`path: "catalog-items/:id/builder"`);
    expect(ui("portal/index.tsx")).toContain(`table: "portal", path: "portal-admin/portals"`);
    expect(ui("portal/index.tsx")).toContain(`table: "survey", path: "portal-admin/surveys"`);
    expect(ui("change/index.tsx")).toContain(`table: "change_risk_question", path: "changes/risk-questions"`);

    // one kind at a time
    const only = await list(e.owner, "?kind=survey");
    expect(only.forms.every((f) => f.kind === "survey")).toBe(true);
    expect(only.forms.length).toBe(shown.length);
    expect(msg(await e.owner.get(`${P}/forms?kind=files`, 400))).toBeTruthy();
  });

  it("follows the organisation's changes: overrides, the arrangement, and the portal's choice of form", async () => {
    await e.owner.put(`${P}/forms/system/incident/overrides`, { fields: { description: { help: "شرح کامل مشکل" } } });
    await e.owner.put(`${P}/forms/system/incident/overrides`, { arrangement: { tabs: [{ label: "جزئیات", sections: [{ label: null, fields: ["short_description", "description"] }] }] } });
    let incident = (await list(e.owner, "?kind=system")).forms.find((f) => f.table === "incident")!;
    expect(incident).toMatchObject({ overrides: 1, arranged: true });
    expect(incident.updated_at).toBeTruthy();
    // a portal that reports through a catalogue form: named on its row and on the item's, gone from the incident form's
    const producer = (await e.db.one<{ id: string; name: string }>(`select id, name from sm_catalog_items where org_id = $1 and deleted_at is null and type = 'record_producer' and target_table = 'incident' limit 1`, [e.org]))
      ?? (await e.owner.post(`${R}/catalog_item`, { name: "گزارش خرابی", type: "record_producer", target_table: "incident", catalog_id: (await e.db.one<{ id: string }>(`select id from sm_catalogs where org_id = $1 and deleted_at is null limit 1`, [e.org]))!.id })).row;
    const portal = (await e.db.one<{ id: string; name: string }>(`select id, name from sm_portals where org_id = $1 and deleted_at is null and active limit 1`, [e.org]))!;
    await e.owner.patch(`${R}/portal/${portal.id}`, { report_item_id: producer.id });
    const after = await list(e.owner);
    expect(after.forms.find((f) => f.key === `portal_report:${portal.id}`)!.note).toBe(`فرم کاتالوگ «${producer.name}»`);
    expect(after.forms.find((f) => f.key === `catalog:${producer.id}`)!.used_in).toEqual([`${portal.name}: گزارش مشکل`]);
    incident = after.forms.find((f) => f.key === "system:incident")!;
    expect(incident.used_in).not.toContain(`${portal.name}: گزارش مشکل`);
    await e.owner.patch(`${R}/portal/${portal.id}`, { report_item_id: null });
  });

  it("is read by designers, readers and settings editors; others are refused", async () => {
    expect(msg(await member.client.get(`${P}/forms`, 403))).toBe("به «فرم‌ها» دسترسی ندارید");
    // a settings editor changes the tables' default forms and designs process forms
    const asEditor = await list(editor.client);
    expect(asEditor.forms.find((f) => f.key === "system:incident")!.editable).toBe(true);
    expect(asEditor.forms.find((f) => f.kind === "process")!.editable).toBe(true);
    // a reader (the auditor's read everywhere) changes nothing
    const asViewer = await list(viewer.client);
    expect(asViewer.forms.filter((f) => f.kind === "system" || f.kind === "process").every((f) => !f.editable)).toBe(true);
    // a designer with the grant in «طراحی فرم و گردش‌کار» only: process forms are theirs, system forms are not, and a
    // linked kind is listed only for those who read its own records
    const asDesigner = await list(designer.client);
    expect(asDesigner.forms.find((f) => f.kind === "process")!.editable).toBe(true);
    expect(asDesigner.forms.find((f) => f.key === "system:incident")!.editable).toBe(false);
    expect(Object.fromEntries(asDesigner.kinds.map((k) => [k.key, k.available]))).toEqual({ system: true, process: true, catalog: false, portal_report: false, survey: false, risk: false });
    expect(asDesigner.forms.some((f) => !["system", "process"].includes(f.kind))).toBe(false);
  });
});

describe("process forms: writes and their hooks", () => {
  it("creates, reads and changes a form for designers and settings editors only", async () => {
    const made = (await designer.client.post(`${P}/forms`, { name: "فرم مرخصی", description: "درخواست مرخصی کارکنان", layout: one([{ field: "u_reason", span: 24, label: "علت مرخصی" }]) }, 201)).form;
    expect(made).toMatchObject({ name: "فرم مرخصی", status: "draft", version_no: 0, fields: ["u_reason"], changed: false });
    const got = await editor.client.get(`${P}/forms/${made.id}`);
    expect(got).toMatchObject({ form: { id: made.id, layout: { tabs: [{ sections: [{ items: [{ field: "u_reason", span: 24, label: "علت مرخصی" }] }] }] } }, fields: { u_reason: { label: "علت", type: "text", type_label: "متن چندخطی", retired: false, def: { type: "text" } } }, usage: { processes: [] }, editable: true });
    expect((await editor.client.patch(`${P}/forms/${made.id}`, { name: "فرم مرخصی کارکنان" })).form.name).toBe("فرم مرخصی کارکنان");
    expect((await viewer.client.get(`${P}/forms/${made.id}`)).editable).toBe(false);
    expect(msg(await viewer.client.patch(`${P}/forms/${made.id}`, { name: "x" }, 403))).toBe("ساخت و ویرایش فرم‌ها دسترسی «طراحی فرم و گردش‌کار» یا «تنظیمات سازمان» می‌خواهد");
    expect(msg(await member.client.get(`${P}/forms/${made.id}`, 403))).toBe("به «فرم‌ها» دسترسی ندارید");
    await member.client.post(`${P}/forms`, { name: "x" }, 403);
    await e.owner.get(`${P}/forms/0190f0c2-0000-7000-8000-000000000000`, 404);
    await e.owner.get(`${P}/forms/not-an-id`, 404);
    // the history names the person, not the system
    const by = await e.db.one<{ created_by: string; updated_by: string }>(`select created_by, updated_by from sm_forms where id = $1`, [made.id]);
    expect(by).toEqual({ created_by: designer.userId, updated_by: editor.userId });
  });

  it("refuses fields that are not in the library, repeated ones and conditions that are not valid — on every path", async () => {
    const problems = (r: unknown) => (r as Msg).error.details?.problems;
    const bad = await e.owner.post(`${P}/forms`, { name: "نادرست", layout: one([{ field: "u_nope" }, { field: "u_reason" }, { field: "u_reason" }]) }, 400);
    expect(problems(bad)).toEqual(["فیلد «u_nope» در کتابخانه نیست", "«علت» دو بار در فرم آمده است"]);
    const cond = await e.owner.post(`${P}/forms`, { name: "شرط", layout: one([{ field: "u_pay" }, { field: "u_amount", showIf: { f: "u_pay", op: "eq", v: "cash" } }, { field: "u_reason", showIf: { f: "short_description", op: "nempty" } }]) }, 400);
    expect(msg(cond)).toBe("شرط نمایش «علت» فیلد «short_description» را می‌سنجد که در این فرم نیست");
    await e.owner.post(`${P}/forms`, { name: "شرط درست", layout: one([{ field: "u_pay" }, { field: "u_amount", showIf: { f: "u_pay", op: "eq", v: "cash" } }]) }, 201);
    // the generic record API holds the same rules, and people never set what the publish records
    expect(msg(await e.owner.post(`${R}/form`, { name: "از راه API", layout: one([{ field: "u_nope" }]) }, 400))).toBe("فیلد «u_nope» در کتابخانه نیست");
    const viaApi = (await e.owner.post(`${R}/form`, { name: "از راه API", layout: JSON.stringify(one([{ field: "u_reason" }, { field: "u_reason" }, { field: "short_description" }])), status: "published", version_no: 7, fields: ["u_x"] }, 400));
    expect(msg(viaApi)).toBe("«علت» دو بار در فرم آمده است");
    const ok = (await e.owner.post(`${R}/form`, { name: "از راه API", layout: one([{ field: "u_reason", readonly: true, required: false }]), status: "published", version_no: 7, fields: ["u_x"] })).row;
    expect(ok).toMatchObject({ status: "draft", version_no: 0, fields: ["u_reason"] });
  });

  it("refuses a retired field in a new form, and keeps it in a form that holds it", async () => {
    const field = (await e.owner.post(`${P}/fields/library`, { name: "u_fax", label: "شمارهٔ دورنگار", type: "phone" }, 201)).row;
    const holder = (await e.owner.post(`${P}/forms`, { name: "فرم دورنگار", layout: one([{ field: "u_fax" }, { field: "u_reason" }]) }, 201)).form;
    const other = (await e.owner.post(`${P}/forms`, { name: "فرم بی‌دورنگار", layout: one([{ field: "u_reason" }]) }, 201)).form;
    await e.owner.patch(`${P}/fields/library/${field.id}`, { status: "retired" });
    const refusal = "فیلد «شمارهٔ دورنگار» بازنشسته است و به فرم افزوده نمی‌شود";
    expect(msg(await e.owner.post(`${P}/forms`, { name: "فرم تازه", layout: one([{ field: "u_fax" }]) }, 400))).toBe(refusal);
    expect(msg(await e.owner.patch(`${P}/forms/${other.id}`, { layout: one([{ field: "u_reason" }, { field: "u_fax" }]) }, 400))).toBe(refusal);
    // the form that holds it keeps it: renamed, rearranged, its other fields changed
    await e.owner.patch(`${P}/forms/${holder.id}`, { name: "فرم دورنگار (قدیمی)" });
    const moved = await e.owner.patch(`${P}/forms/${holder.id}`, { layout: { tabs: [{ label: "تماس", sections: [{ label: "دورنگار", items: [{ field: "u_reason" }, { field: "u_fax", label: "دورنگار" }, { field: "u_letter_no" }] }] }] } });
    expect(moved.form.fields).toEqual(["u_reason", "u_fax", "u_letter_no"]);
    expect((await e.owner.get(`${P}/forms/${holder.id}`)).fields.u_fax).toMatchObject({ retired: true, label: "شمارهٔ دورنگار" });
    // once taken out, it does not come back
    await e.owner.patch(`${P}/forms/${holder.id}`, { layout: one([{ field: "u_reason" }]) });
    expect(msg(await e.owner.patch(`${P}/forms/${holder.id}`, { layout: one([{ field: "u_reason" }, { field: "u_fax" }]) }, 400))).toBe(refusal);
  });

  it("tells the field library where its fields are used, and the library keeps a used field's name", async () => {
    const used = (await e.owner.post(`${P}/forms`, { name: "فرم تعهدنامه", layout: one([{ field: "u_agree", required: true }]) }, 201)).form;
    const lib = await e.owner.get(`${P}/fields/library`);
    expect(lib.fields.find((f: { name: string }) => f.name === "u_agree").usage.forms).toEqual(["فرم تعهدنامه"]);
    const agree = lib.fields.find((f: { name: string }) => f.name === "u_agree");
    expect(msg(await e.owner.patch(`${P}/fields/library/${agree.id}`, { name: "u_agreed" }, 400))).toBe("نام فنی «u_agree» عوض نمی‌شود: این فیلد در فرم‌های «فرم تعهدنامه» به کار رفته است");
    expect(msg(await e.owner.del(`${R}/field_def/${agree.id}`, 400))).toContain("در فرم‌های «فرم تعهدنامه» به کار رفته است");
    // a deleted form no longer counts
    await e.owner.del(`${P}/forms/${used.id}`);
    expect((await e.owner.get(`${P}/fields/library`)).fields.find((f: { name: string }) => f.name === "u_agree").usage.forms).toEqual([]);
  });

  it("answers the library's list with one query of the forms, whatever the number of fields", async () => {
    await e.owner.post(`${P}/forms`, { name: "فرم پرداخت", layout: one([{ field: "u_pay" }, { field: "u_amount" }]) }, 201);
    await e.owner.post(`${P}/forms`, { name: "فرم بازپرداخت", layout: one([{ field: "u_pay" }]) }, 201);
    const lib = ((await e.owner.get(`${P}/fields/library`)).fields as { id: string; name: string }[]).map((f) => ({ id: f.id, name: f.name }));
    expect(lib.length).toBeGreaterThan(3);
    let reads = 0;
    const counted: Queryable = {
      query<T>(text: string, params?: unknown[]) {
        if (/\bsm_forms\b/.test(text)) reads++;
        return e.db.query<T>(text, params);
      },
      one<T>(text: string, params?: unknown[]) {
        return e.db.one<T>(text, params);
      },
      exec: (text) => e.db.exec(text),
    };
    const usage = await libraryUsage(counted, e.org, lib);
    expect(reads).toBe(1);
    // the same answer as field by field
    for (const f of lib) expect(usage.get(f.id)!.forms).toEqual((await fieldUsage(e.db, e.org, f)).forms);
    expect(usage.get(lib.find((f) => f.name === "u_pay")!.id)!.forms).toEqual(expect.arrayContaining(["فرم بازپرداخت", "فرم پرداخت"]));
  });

  it("never deletes a form a process uses, and refuses a Windows app's push", async () => {
    const form = (await e.owner.post(`${P}/forms`, { name: "فرم خرید", layout: one([{ field: "u_amount" }]) }, 201)).form;
    unregister.push(registerFormUsage(async (_q, _org, forms) => Object.fromEntries(forms.filter((f) => f.id === form.id).map((f) => [f.id, ["خرید کالا"]]))));
    expect((await e.owner.get(`${P}/forms/${form.id}/usage`)).usage.processes).toEqual(["خرید کالا"]);
    expect(msg(await e.owner.del(`${P}/forms/${form.id}`, 400))).toBe("فرم «فرم خرید» در گردش‌کارهای «خرید کالا» به کار رفته است و حذف نمی‌شود؛ نخست آن را از مرحله‌هایشان بردارید");
    expect(msg(await e.owner.del(`${R}/form/${form.id}`, 400))).toContain("حذف نمی‌شود");
    // forms change on the web version or the server edition
    const stored = (await e.db.one<Record<string, unknown>>(`select * from sm_forms where id = $1`, [form.id]))!;
    const row = { ...JSON.parse(JSON.stringify(stored)), name: "فرم خرید (رایانه)", updated_at: new Date(Date.now() + 5_000).toISOString() };
    const pushed = await e.owner.post(`/sync/push`, { org_id: e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: "form", id: form.id, base_rev: Number(stored.rev), row }] });
    expect(pushed.results[0]).toMatchObject({ status: "error", message: "«فرم» فقط در نسخهٔ وب تغییر می‌کند" });
    expect((await e.owner.get(`${P}/forms/${form.id}`)).form.name).toBe("فرم خرید");
  });
});

describe("the preview: one effectiveRights for every step and viewpoint", () => {
  let formId: string;
  const approve: StepRights = { default: "read", fields: { u_amount: "required", u_national: "edit", u_reason: "hidden" } };

  beforeAll(async () => {
    formId = (await e.owner.post(`${P}/forms`, {
      name: "فرم تنخواه شعبه",
      layout: one([
        { field: "u_letter_no", readonly: true },
        { field: "u_amount", required: true },
        { field: "u_national" },
        { field: "u_pay" },
        { field: "u_reason", showIf: { f: "u_pay", op: "eq", v: "cash" } },
        { field: "u_agree", required: true },
      ]),
    }, 201)).form.id;
    // the steps F4 resolves from a reference: «تأیید رئیس شعبه» of a process that uses the form
    unregister.push(registerStepRights(async (_q, _ctx, form, ref) => (form === formId && ref === "p1:approve" ? { label: "تأیید رئیس شعبه", rights: approve, action: "approve" } : null)));
  }, 600_000);

  it("gives the same rights as effectiveRights over the snapshot a publish would take, for every step and viewpoint", async () => {
    const ctx = await e.ctxOf(e.ownerId);
    const { snapshot } = await loadFormsSnapshot(e.db, ctx, [formId]);
    const layout = snapshot.forms[formId].layout;
    const fields = snapshotFields(snapshot);
    const steps: [string, StepRights | null][] = [["", null], ["&step=p1:approve", approve], [`&rights=${encodeURIComponent(JSON.stringify({ default: "edit", fields: { u_amount: "hidden" } }))}`, { default: "edit", fields: { u_amount: "hidden" } }]];
    const seen = new Set<string>();
    for (const as of ["", "requester", "agent", e.ownerId]) {
      for (const [q, step] of steps) {
        const p = await e.owner.get(`${P}/forms/${formId}/preview?as=${as}${q}`);
        expect(p.rights).toEqual(effectiveRights(layout, step, fields, { groups: p.as.groups }));
        seen.add(JSON.stringify(p.rights));
      }
    }
    // the viewpoints differ: the requester holds no field group, the agent «اطلاعات شخصی», the owner every group
    const pick = async (as: string) => (await e.owner.get(`${P}/forms/${formId}/preview?as=${as}&step=p1:approve`)).rights;
    expect(await pick("requester")).toMatchObject({ u_amount: "hidden", u_national: "hidden", u_letter_no: "read", u_pay: "read", u_reason: "hidden" });
    expect(await pick("agent")).toMatchObject({ u_amount: "hidden", u_national: "edit" });
    expect(await pick("me")).toMatchObject({ u_amount: "required", u_national: "edit" });
    expect(seen.size).toBeGreaterThan(5);
    const p = await e.owner.get(`${P}/forms/${formId}/preview?as=agent&step=p1:approve`);
    expect(p).toMatchObject({ step: { ref: "p1:approve", label: "تأیید رئیس شعبه", rights: approve }, as: { kind: "persona", id: "agent", label: "کارشناس", groups: ["internal", "personal"], scope: ["all", "agents"] }, publish_problems: [] });
    expect(p.view.tabs[0].sections[0].items.map((i: { name?: string }) => i.name)).toEqual(["u_letter_no", "u_national", "u_pay", "u_agree"]);
    expect(Object.keys(p.fields).sort()).toEqual(["u_agree", "u_amount", "u_letter_no", "u_national", "u_pay", "u_reason"]);
    expect(msg(await e.owner.get(`${P}/forms/${formId}/preview?step=p9:nothing`, 404))).toBe("مرحله‌ای با این فرم پیدا نشد");
  });

  it("applies «نمایش وقتی…» to sample values and checks them as a submission would be", async () => {
    const values = { u_pay: "card", u_reason: "سفر", u_amount: "۱۲۰۰۰۰۰", u_national: "0012345678" };
    const p = await e.owner.post(`${P}/forms/${formId}/preview`, { rights: { default: "edit", fields: {} }, values });
    expect(p.rights.u_reason).toBe("edit");
    expect(p.shown.u_reason).toBe("hidden");
    expect(p.check).toMatchObject({ values: { u_pay: "card", u_amount: "1200000" }, dropped: ["u_reason"], problems: { u_national: expect.stringContaining("کد ملی"), u_agree: "«تعهد» باید تیک بخورد" } });
    const cash = await e.owner.post(`${P}/forms/${formId}/preview`, { rights: { default: "edit", fields: {} }, values: { ...values, u_pay: "cash", u_national: "0012345679", u_agree: true } });
    expect(cash.shown.u_reason).toBe("edit");
    expect(cash.check.problems).toEqual({});
    // the same values as a query string
    const viaGet = await e.owner.get(`${P}/forms/${formId}/preview?rights=${encodeURIComponent('{"default":"edit"}')}&values=${encodeURIComponent(JSON.stringify(values))}`);
    expect(viaGet.check.dropped).toEqual(["u_reason"]);
    expect(msg(await e.owner.get(`${P}/forms/${formId}/preview?values=${encodeURIComponent("{نه")}`, 400))).toBe("مقدارهای نمونه باید JSON معتبر باشد");
  });

  it("shows a member's view only to those who see members' access", async () => {
    const asMember = await e.owner.get(`${P}/forms/${formId}/preview?as=${designer.userId}`);
    expect(asMember.as).toMatchObject({ kind: "member", id: designer.userId, groups: [] });
    expect(asMember.rights).toMatchObject({ u_amount: "hidden", u_national: "hidden", u_letter_no: "read" });
    // a designer whose role reads no members' access does not see another member's view
    expect(msg(await designer.client.get(`${P}/forms/${formId}/preview?as=${editor.userId}`, 403))).toBe("دیدن دسترسی‌های اعضا با مدیر سامانه است");
    expect((await editor.client.get(`${P}/forms/${formId}/preview?as=${designer.userId}`)).as.id).toBe(designer.userId);
    // their own view, and the personas, need nothing more
    expect((await designer.client.get(`${P}/forms/${formId}/preview?as=${designer.userId}`)).as.kind).toBe("member");
    expect((await designer.client.get(`${P}/forms/${formId}/preview?as=requester`)).as.kind).toBe("persona");
    expect(msg(await e.owner.get(`${P}/forms/${formId}/preview?as=someone`, 400))).toBe("دیدگاه پیش‌نمایش باید «درخواست‌دهنده»، «کارشناس» یا یکی از اعضای سازمان باشد");
    await member.client.get(`${P}/forms/${formId}/preview`, 403);
  });

  it("previews a table's default form for «درخواست‌دهنده» and «کارشناس»: hidden on forms, and requirements for those they bind", async () => {
    await e.owner.post(`${P}/fields/attach`, { table: "incident", field: "u_letter_no", required: true, required_for: "agents" }, 201);
    await e.owner.put(`${P}/forms/system/incident/overrides`, { fields: { impact: { form_hidden: true } } });
    const agent = await e.owner.get(`${P}/forms/system/incident/preview?as=agent`);
    const requester = await e.owner.get(`${P}/forms/system/incident/preview?as=requester`);
    const by = (p: { fields: { name: string; right: string; required_by: string | null }[] }, name: string) => p.fields.find((f) => f.name === name);
    expect(by(agent, "u_letter_no")).toMatchObject({ right: "required", required_by: "organisation" });
    expect(by(requester, "u_letter_no")).toMatchObject({ right: "edit", required_by: null });
    expect(by(agent, "short_description")).toMatchObject({ right: "required", required_by: "module" });
    for (const p of [agent, requester]) expect(by(p, "impact")!.right).toBe("hidden");
    expect(agent.fields.map((f: { name: string }) => f.name)).not.toContain("number");
    await e.owner.get(`${P}/forms/system/nope/preview`, 404);
  });
});
