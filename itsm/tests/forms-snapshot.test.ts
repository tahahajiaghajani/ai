// F2 — the forms of a process version (design F §3.2, §3.5, D10): `publishForms` writes into a version each form's
// layout and everything a replica needs about every field it uses (storage type, widget, label, help, placeholder,
// validation, options — the shared list's as they are at publish — references and their conditions, field group,
// money unit), records the publish on each form (a changed layout moves the form to its next version) and refuses a
// publish over a missing form or a retired field without writing anything. Then the test of the design's list:
// **the snapshot alone is enough** to render and validate every field kind — the organisation's `field_def`,
// `field_type`, `custom_field` and `choice` rows are deleted first.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { todayISO } from "@shared/jalali";
import { availableBuiltinTypes } from "@shared/forms/fieldtypes";
import { cleanFormLayout, effectiveRights, formView, type FormLayoutV2 } from "@shared/forms/layout";
import { listsChanged, readSnapshot, snapshotFields, type FormsSnapshot } from "@shared/forms/snapshot";
import { invalidateSchema, orgSchema } from "@server/engine";
import { SETTINGS_ENV } from "@server/modules/fields";
import { checkFormRefs, checkFormValues, loadFormsSnapshot, publishForms } from "@server/modules/forms";
import type { Ctx } from "@server/context";

let e: EngineOrg;
let P: string;
let R: string;
let ctx: Ctx;

const TZ = "Asia/Tehran";
const publish = (ids: string[]) => ctx.write((tx) => publishForms(tx, ctx, ids));
const formRow = async (id: string) => (await e.db.one<{ status: string; version_no: number; published_hash: string | null; published_at: string | null }>(`select status, version_no, published_hash, published_at from sm_forms where id = $1`, [id]))!;
const lib = (body: Record<string, unknown>) => e.owner.post(`${P}/fields/library`, body, 201).then((r) => r.row as { id: string; name: string });
const one = (items: unknown[]) => ({ tabs: [{ label: "درخواست", sections: [{ label: null, items }] }] });

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  R = `${P}/r`;
  ctx = await e.ctxOf(e.ownerId);
}, 600_000);

describe("publishForms", () => {
  it("records the publish on each form: published, a new version only when the layout changed since", async () => {
    await lib({ name: "u_ref_no", label: "شمارهٔ نامه", type: "string" });
    await lib({ name: "u_subject", label: "موضوع", type: "text" });
    const form = (await e.owner.post(`${P}/forms`, { name: "نامهٔ اداری", layout: one([{ field: "u_ref_no" }]) }, 201)).form;
    expect(await formRow(form.id)).toMatchObject({ status: "draft", version_no: 0, published_hash: null });
    const first = await publish([form.id]);
    expect(first.problems).toEqual([]);
    expect(first.snapshot.forms[form.id]).toMatchObject({ name: "نامهٔ اداری", version_no: 1, layout: { tabs: [{ label: "درخواست" }] } });
    expect(first.snapshot.fields.u_ref_no).toMatchObject({ name: "u_ref_no", label: "شمارهٔ نامه", type: "string", widget: "input", library: "u_ref_no" });
    const after = await formRow(form.id);
    expect(after).toMatchObject({ status: "published", version_no: 1 });
    expect(after.published_hash).toMatch(/^[0-9a-f]{16}$/);
    // the same layout again: the same version
    expect((await publish([form.id])).snapshot.forms[form.id].version_no).toBe(1);
    expect((await formRow(form.id)).version_no).toBe(1);
    // a changed layout: the next version, in the form and in the snapshot
    await e.owner.patch(`${P}/forms/${form.id}`, { layout: one([{ field: "u_ref_no" }, { field: "u_subject", span: 24 }]) });
    expect((await e.owner.get(`${P}/forms/${form.id}`)).form).toMatchObject({ status: "published", version_no: 1, changed: true });
    const second = await publish([form.id]);
    expect(second.snapshot.forms[form.id].version_no).toBe(2);
    expect(Object.keys(second.snapshot.fields).sort()).toEqual(["u_ref_no", "u_subject"]);
    expect((await e.owner.get(`${P}/forms/${form.id}`)).form).toMatchObject({ status: "published", version_no: 2, changed: false });
  });

  it("refuses a missing form or a retired field, and writes nothing then; a version taken earlier keeps the field", async () => {
    const field = await lib({ name: "u_old_code", label: "کد قدیمی", type: "string", validation: { pattern: "^[A-Z]{3}$", patternMessage: "سه حرف بزرگ لاتین" } });
    const form = (await e.owner.post(`${P}/forms`, { name: "فرم کد", layout: one([{ field: "u_old_code", required: true }]) }, 201)).form;
    const taken = await publish([form.id]);
    expect(taken.problems).toEqual([]);
    await e.owner.patch(`${P}/fields/library/${field.id}`, { status: "retired" });
    // a new version is never built on a retired field
    const refused = await publish([form.id, "0190f0c2-0000-7000-8000-000000000000"]);
    expect(refused.problems).toEqual([
      "فرمی که این گردش‌کار به کار می‌برد پیدا نشد؛ آن را دوباره برگزینید",
      "فیلد «کد قدیمی» فرم «فرم کد» بازنشسته است؛ آن را از فرم بردارید یا دوباره فعال کنید",
    ]);
    expect(refused.snapshot.fields.u_old_code).toBeUndefined();
    expect((await loadFormsSnapshot(e.db, ctx, [form.id])).problems).toHaveLength(1);
    // nothing was recorded on the form by the refused publish
    await e.owner.patch(`${P}/forms/${form.id}`, { name: "فرم کد (ویرایش)" });
    expect((await formRow(form.id)).version_no).toBe(1);
    // the version taken before the field retired still shows and checks it (running cases never change)
    const s = readSnapshot(JSON.parse(JSON.stringify(taken.snapshot)))!;
    const rights = effectiveRights(s.forms[form.id].layout, null, snapshotFields(s), { groups: "all" });
    expect(rights.u_old_code).toBe("required");
    expect(checkFormValues(s, form.id, { u_old_code: "abc" }, { rights, requireAll: true, tz: TZ }).problems).toEqual({ u_old_code: "«کد قدیمی»: سه حرف بزرگ لاتین" });
    expect(checkFormValues(s, form.id, { u_old_code: "ABC" }, { rights, requireAll: true, tz: TZ })).toMatchObject({ values: { u_old_code: "ABC" }, problems: {} });
  });
});

// one library field per built-in type the organisation can use, with the settings a replica must carry
const SETTINGS: Record<string, Record<string, unknown>> = {
  string: { validation: { pattern: "^\\d{6}$", patternMessage: "شش رقم", maxLength: 6 }, placeholder: "۱۲۳۴۵۶", help: "کد شش‌رقمی" },
  text: { validation: { maxLength: 200 } },
  int: { validation: { min: 1, max: 10 } },
  decimal: { validation: { decimals: 2 } },
  percent: { validation: { min: 0, max: 100 } },
  money: { validation: { max: 2_000_000_000, unit: "toman" }, field_group: "financial" },
  select: { choices: "leave.kind" },
  radio: { options: [{ value: "in_person", label: "حضوری" }, { value: "fax", label: "دورنگار", active: false }] },
  multiselect: { options: [{ value: "id_card", label: "کارت ملی" }, { value: "deed", label: "سند" }] },
  checklist: { choices: "leave.docs" },
  date: { validation: { minDate: "$today" } },
  unit: { validation: { refFilter: { f: "kind", op: "eq", v: "branch" } } },
  record: { validation: { ref: "incident" } },
  records: { validation: { ref: "problem" } },
  attachment: { validation: { max: 2, accept: ["pdf"] } },
};
const nameOf = (type: string) => `u_k_${type}`;

describe("the snapshot alone renders and validates every field kind", () => {
  let snapshot: FormsSnapshot;
  let formId: string;
  let types: string[];
  let branch: string;
  let department: string;
  let incident: string;
  let problem: string;
  let location: string;
  let group: string;

  beforeAll(async () => {
    types = availableBuiltinTypes(SETTINGS_ENV.tableExists!).map((b) => b.key);
    // shared lists of the organisation, one option switched off
    for (const [list, value, label, active] of [
      ["leave.kind", "annual", "استحقاقی", true],
      ["leave.kind", "sick", "استعلاجی", true],
      ["leave.kind", "unpaid", "بدون حقوق", false],
      ["leave.docs", "letter", "نامهٔ پزشک", true],
      ["leave.docs", "form", "فرم درخواست", true],
    ] as const) {
      await e.owner.post(`${R}/choice`, { list, value, label, active });
    }
    for (const type of types) await lib({ name: nameOf(type), label: `فیلد ${type}`, type, ...(SETTINGS[type] ?? {}) });
    // a dependent choice: its options belong to the leave kind chosen
    await lib({ name: "u_k_reason", label: "علت", type: "select", depends_on: nameOf("select"), options: [{ value: "rest", label: "استراحت", parent: "annual" }, { value: "surgery", label: "جراحی", parent: "sick" }] });
    const items = [
      ...types.map((t) => ({ field: nameOf(t), ...(t === "checkbox" ? { required: true } : {}) })),
      { field: "u_k_reason", showIf: { f: nameOf("select"), op: "nempty" } },
      { text: "همهٔ فیلدهای این فرم از نسخهٔ منتشرشده خوانده می‌شوند", tone: "info" },
    ];
    formId = (await e.owner.post(`${P}/forms`, { name: "همهٔ گونه‌ها", layout: { tabs: [{ label: "همه", sections: [{ label: "فیلدها", columns: 2, items }] }] } }, 201)).form.id;
    const out = await publish([formId]);
    expect(out.problems).toEqual([]);
    // what a version row holds, read back as an older or another runtime would: from JSON, checked
    snapshot = readSnapshot(JSON.parse(JSON.stringify(out.snapshot)))!;
    // rows the references point at (not library rows: those go next)
    branch = (await e.owner.post(`${R}/org_unit`, { name: "شعبهٔ ونک", kind: "branch" })).row.id;
    department = (await e.owner.post(`${R}/org_unit`, { name: "ادارهٔ مالی", kind: "department" })).row.id;
    location = (await e.owner.post(`${R}/location`, { name: "ساختمان مرکزی" })).row.id;
    group = (await e.owner.post(`${R}/group`, { name: "پشتیبانی شعبه‌ها" })).row.id;
    incident = (await e.owner.post(`${R}/incident`, { short_description: "چاپگر شعبه کار نمی‌کند" })).row.id;
    problem = (await e.owner.post(`${R}/problem`, { short_description: "خرابی پیاپی چاپگرها" })).row.id;
    // a shared list changed after the publish: the hub can name the processes it affects
    await e.owner.post(`${R}/choice`, { list: "leave.kind", value: "marriage", label: "ازدواج" });
    invalidateSchema(e.org);
    expect(listsChanged(snapshot, (await orgSchema(ctx)).choices)).toEqual(["leave.kind"]);
    // and now the organisation has no library, no types, no custom fields and no choice rows at all
    for (const t of ["sm_field_defs", "sm_field_types", "sm_custom_fields", "sm_choices"]) await e.db.query(`delete from ${t} where org_id = $1`, [e.org]);
    for (const t of ["sm_field_defs", "sm_field_types", "sm_custom_fields", "sm_choices"]) {
      expect((await e.db.one<{ n: number }>(`select count(*)::int as n from ${t} where org_id = $1`, [e.org]))!.n).toBe(0);
    }
    invalidateSchema(e.org);
  }, 600_000);

  it("carries each field's whole definition, with shared lists resolved as they were at publish", () => {
    expect(types.length).toBeGreaterThanOrEqual(35);
    const f = snapshot.fields;
    for (const t of types) expect(f[nameOf(t)], t).toMatchObject({ name: nameOf(t), label: `فیلد ${t}`, library: nameOf(t) });
    expect(f[nameOf("string")]).toMatchObject({ type: "string", widget: "input", pattern: "^\\d{6}$", patternMessage: "شش رقم", maxLength: 6, placeholder: "۱۲۳۴۵۶", help: "کد شش‌رقمی" });
    for (const t of ["national_id", "iban", "card", "postal_code", "mobile"]) expect(f[nameOf(t)]).toMatchObject({ type: "string", ltr: true, check: t });
    expect(f[nameOf("money")]).toMatchObject({ type: "money", widget: "money", decimals: 0, max: 2_000_000_000, unit: "toman", group: "financial" });
    expect(f[nameOf("decimal")]).toMatchObject({ type: "decimal", decimals: 2 });
    expect(f[nameOf("rating")]).toMatchObject({ type: "rating", widget: "stars", max: 5 });
    expect(f[nameOf("checkbox")]).toMatchObject({ type: "bool", widget: "checkbox" });
    expect(f[nameOf("switch")]).toMatchObject({ type: "bool", widget: "switch" });
    expect(f[nameOf("select")]).toMatchObject({
      type: "choice",
      widget: "select",
      choices: [
        { value: "annual", label: "استحقاقی" },
        { value: "sick", label: "استعلاجی" },
        { value: "unpaid", label: "بدون حقوق", active: false },
      ],
    });
    expect(f[nameOf("radio")]).toMatchObject({ type: "choice", widget: "radio", choices: [{ value: "in_person" }, { value: "fax", active: false }] });
    // (the organisation's options without an order of their own come by value)
    expect(f[nameOf("checklist")]).toMatchObject({ type: "multichoice", widget: "checklist", choices: [{ value: "form", label: "فرم درخواست" }, { value: "letter", label: "نامهٔ پزشک" }] });
    expect(f.u_k_reason).toMatchObject({ dependsOn: nameOf("select"), choices: [{ value: "rest", parent: "annual" }, { value: "surgery", parent: "sick" }] });
    expect(f[nameOf("date")]).toMatchObject({ type: "date", minDate: "$today" });
    expect(f[nameOf("unit")]).toMatchObject({ type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "branch" } });
    expect(f[nameOf("location")]).toMatchObject({ type: "ref", ref: "location" });
    expect(f[nameOf("record")]).toMatchObject({ type: "ref", widget: "record", ref: "incident" });
    expect(f[nameOf("records")]).toMatchObject({ type: "refs", ref: "problem" });
    expect(f[nameOf("attachment")]).toMatchObject({ type: "json", widget: "files", check: "attachments", max: 2, accept: ["pdf"] });
    expect(f[nameOf("color")]).toMatchObject({ type: "color", widget: "swatches" });
    expect(snapshot.lists).toEqual({ "leave.kind": { hash: expect.any(String), fields: [nameOf("select")] }, "leave.docs": { hash: expect.any(String), fields: [nameOf("checklist")] } });
    // nothing a table needs (list columns, search) and nothing secret travels
    for (const x of Object.values(f)) for (const k of ["list", "search", "filter", "custom", "index", "secret"]) expect(x).not.toHaveProperty(k);
  });

  it("renders every field from the snapshot alone", () => {
    const fields = snapshotFields(snapshot);
    const layout = snapshot.forms[formId].layout;
    const view = formView(layout, effectiveRights(layout, null, fields, { groups: "all" }), fields);
    const shown = view.tabs.flatMap((t) => t.sections.flatMap((s) => s.items)).filter((i) => i.kind === "field");
    expect(shown.map((i) => i.name).sort()).toEqual([...types.map(nameOf), "u_k_reason"].sort());
    for (const i of shown) {
      if (i.kind !== "field") continue;
      expect(i.field.widget, i.name).toBeTruthy();
      expect(i.label).toBe(i.field.label);
    }
    // someone without the group «مالی» does not see the amount
    const blind = formView(layout, effectiveRights(layout, null, fields, { groups: [] }), fields);
    expect(blind.tabs[0].sections[0].items.some((i) => i.kind === "field" && i.name === nameOf("money"))).toBe(false);
  });

  it("validates every field kind from the snapshot alone, and references against the organisation's rows", async () => {
    const fields = snapshotFields(snapshot);
    const layout: FormLayoutV2 = cleanFormLayout(snapshot.forms[formId].layout);
    const rights = effectiveRights(layout, null, fields, { groups: "all" });
    const today = todayISO(TZ);
    const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const pdf = "0190f0c2-0000-7000-8000-0000000000a1";
    const png = "0190f0c2-0000-7000-8000-0000000000a2";
    const files = new Map([[pdf, { name: "نامه.pdf" }], [png, { name: "تصویر.png" }]]);
    const good: Record<string, unknown> = {
      string: "۱۲۳۴۵۶", text: "شرح کوتاه", markdown: "**مهم**", email: "Ali@Example.com", url: "https://example.com/a", phone: "021-88776655", ip: "10.0.0.1",
      national_id: "۰۰۱۲۳۴۵۶۷۹", iban: "IR06 2960 0000 0010 0324 2000 01", card: "6037-9912-3456-7893", postal_code: "1311813311", mobile: "۰۹۱۲۱۲۳۴۵۶۷",
      int: 5, decimal: "12.34", percent: 50, rating: 4, duration: "2:30", money: "15000000", checkbox: true, switch: false,
      select: "annual", radio: "in_person", multiselect: ["id_card", "deed"], checklist: ["letter"], tags: ["فوری", "شعبه"],
      date: today, datetime: "2026-11-14T10:00:00Z", user: e.ownerId, users: [e.ownerId], group,
      unit: branch, location, record: incident, records: [problem], attachment: [pdf], color: "blue",
    };
    const input = Object.fromEntries(types.filter((t) => t in good).map((t) => [nameOf(t), good[t]]));
    expect(Object.keys(input).length).toBe(types.length);
    input.u_k_reason = "rest";
    const ok = checkFormValues(snapshot, formId, input, { rights, requireAll: true, tz: TZ, attachments: files });
    expect(ok.problems).toEqual({});
    expect(ok.dropped).toEqual([]);
    expect(ok.values).toMatchObject({
      [nameOf("national_id")]: "0012345679", [nameOf("iban")]: "IR062960000000100324200001", [nameOf("card")]: "6037991234567893", [nameOf("mobile")]: "09121234567",
      [nameOf("email")]: "ali@example.com", [nameOf("duration")]: 9000, [nameOf("money")]: "15000000", [nameOf("checkbox")]: true, [nameOf("attachment")]: [pdf],
    });
    expect(await checkFormRefs(e.db, ctx, snapshot, formId, ok.values)).toEqual({});

    const bad: Record<string, [unknown, RegExp]> = {
      string: ["۱۲۳", /«فیلد string»: شش رقم/],
      email: ["نه-ایمیل", /ایمیل معتبر نیست/],
      url: ["ftp://example.com", /http یا https/],
      ip: ["10.0.0.999", /نشانی IP معتبر نیست/],
      national_id: ["0012345678", /کد ملی/],
      iban: ["IR062960000000100324200002", /شبا/],
      card: ["6037991234567894", /کارت/],
      postal_code: ["1234567890", /کد پستی/],
      mobile: ["0912123456", /همراه/],
      int: [11, /./],
      decimal: ["1.234", /./],
      percent: [150, /./],
      rating: [6, /./],
      money: ["1500.5", /باید عدد صحیح باشد/],
      select: ["unpaid", /./],
      radio: ["fax", /./],
      multiselect: [["id_card", "passport"], /./],
      checklist: [["x"], /./],
      date: [yesterday, /نباید پیش از/],
      datetime: ["دیروز", /زمان معتبر نیست/],
      user: ["نه-شناسه", /./],
      attachment: [[pdf, png, "0190f0c2-0000-7000-8000-0000000000a3"], /حداکثر ۲ پرونده/],
      color: ["purple-ish", /رنگ معتبر نیست/],
    };
    for (const [t, [value, message]] of Object.entries(bad)) {
      if (!types.includes(t)) continue;
      const r = checkFormValues(snapshot, formId, { [nameOf(t)]: value }, { rights, tz: TZ, attachments: files });
      expect(r.problems[nameOf(t)], t).toMatch(message);
    }
    // files: only the submission's own, of an accepted kind
    const opts = { rights, tz: TZ, attachments: files };
    expect(checkFormValues(snapshot, formId, { [nameOf("attachment")]: [png] }, opts).problems[nameOf("attachment")]).toContain("فقط این نوع پرونده‌ها");
    expect(checkFormValues(snapshot, formId, { [nameOf("attachment")]: ["0190f0c2-0000-7000-8000-0000000000a9"] }, opts).problems[nameOf("attachment")]).toBe("پیوست‌های «فیلد attachment» باید از پرونده‌های همین رکورد باشند");
    // a dependent choice must belong to the chosen parent
    expect(checkFormValues(snapshot, formId, { [nameOf("select")]: "annual", u_k_reason: "surgery" }, opts).problems.u_k_reason).toBe("«جراحی» با «فیلد select» انتخاب‌شده جور نیست");
    // an option switched off is kept where it is stored already, never newly chosen
    expect(checkFormValues(snapshot, formId, { [nameOf("select")]: "unpaid" }, { ...opts, stored: { [nameOf("select")]: "unpaid" } }).problems).toEqual({});
    // required fields bind the outcomes that carry the form forward: a yes/no must be ticked
    const empty = checkFormValues(snapshot, formId, {}, { ...opts, requireAll: true });
    expect(empty.problems).toEqual({ [nameOf("checkbox")]: "«فیلد checkbox» باید تیک بخورد" });
    expect(checkFormValues(snapshot, formId, { [nameOf("checkbox")]: false }, { ...opts, requireAll: false }).problems).toEqual({});
    // a field a «نمایش وقتی…» condition hides is neither asked for nor taken
    const hidden = checkFormValues(snapshot, formId, { u_k_reason: "rest" }, opts);
    expect(hidden).toMatchObject({ dropped: ["u_k_reason"], values: {} });
    expect(hidden.rights.u_k_reason).toBe("hidden");
    // a step that gives only read: nothing is taken
    const readOnly = effectiveRights(layout, { default: "read", fields: {} }, fields, { groups: "all" });
    expect(checkFormValues(snapshot, formId, { [nameOf("int")]: 3 }, { rights: readOnly, tz: TZ }).dropped).toEqual([nameOf("int")]);
    // references: the organisation's rows, under each field's condition
    expect(await checkFormRefs(e.db, ctx, snapshot, formId, { [nameOf("unit")]: department })).toEqual({ [nameOf("unit")]: "«فیلد unit»: رکورد انتخاب‌شده مجاز نیست" });
    expect(await checkFormRefs(e.db, ctx, snapshot, formId, { [nameOf("record")]: problem })).toEqual({ [nameOf("record")]: "«فیلد record» پیدا نشد" });
    expect(await checkFormRefs(e.db, ctx, snapshot, formId, { [nameOf("users")]: ["0190f0c2-0000-7000-8000-0000000000b1"] })).toEqual({ [nameOf("users")]: "«فیلد users» پیدا نشد" });
    expect(await checkFormRefs(e.db, ctx, snapshot, formId, { [nameOf("group")]: "0190f0c2-0000-7000-8000-0000000000b2" })).toEqual({ [nameOf("group")]: "«فیلد group» پیدا نشد" });
    // a form the version does not hold
    expect(() => checkFormValues(snapshot, "0190f0c2-0000-7000-8000-0000000000c1", {}, opts)).toThrow("فرم این مرحله در نسخهٔ گردش‌کار نیست");
  });
});
