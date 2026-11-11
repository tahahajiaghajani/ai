// F1 — the field library's tables on the server (design F §3.1, §6.1, §7): field_type and field_def live in the area
// «طراحی فرم و گردش‌کار» (the tenant admin writes, the auditor reads, an agent reaches nothing); their integrity holds
// on the generic API for everyone (u_ keys and names, a built-in base, settings the built-in type allows, a reference
// with a table, known default tokens; once used, a field keeps its name, its storage and its row — it is retired
// instead; a retired type is offered for no new field); custom_field carries the library columns; and sync: the rows
// reach Windows apps with every column, and a Windows app's push of them is refused, as for custom fields.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { tableDef } from "@shared/tables";
import { areaInfo } from "@shared/access/areas";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";

type Msg = { error: { message: string } };

describe("the field library's tables", () => {
  it("live in the new area «طراحی فرم و گردش‌کار», on the platform group", () => {
    expect(areaInfo("process_design")).toMatchObject({ label: "طراحی فرم و گردش‌کار", group: "platform", platform: true });
    expect(tableDef("field_type")).toMatchObject({ table: "sm_field_types", area: "process_design", label: "نوع فیلد" });
    expect(tableDef("field_def")).toMatchObject({ table: "sm_field_defs", area: "process_design", label: "فیلد" });
    expect(tableDef("field_def")!.features).toMatchObject({ history: true, sync: true });
    expect(tableDef("field_type")!.unique).toEqual([["key"]]);
    expect(tableDef("field_def")!.unique).toEqual([["name"]]);
  });

  it("give custom_field the library columns: library_id, placeholder, form_hidden and required_for", () => {
    const f = (n: string) => tableDef("custom_field")!.fields.find((x) => x.name === n);
    expect(f("library_id")).toMatchObject({ type: "ref", ref: "field_def" });
    expect(f("placeholder")).toMatchObject({ type: "string", maxLength: 120 });
    expect(f("form_hidden")).toMatchObject({ type: "bool", default: false });
    expect(f("required_for")?.choices).toEqual([{ value: "all", label: "همه" }, { value: "agents", label: "فقط کارشناسان" }]);
    // a tenant requirement no longer needs a new meaning of `required`: the column is the same
    expect(f("required")).toMatchObject({ type: "bool" });
  });
});

describe("the field library on the server", () => {
  let e: EngineOrg;
  let P: string;
  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}/r`;
  });

  it("is written by the tenant admin, read by the auditor and closed to an agent", async () => {
    const t = (await e.owner.post(`${P}/field_type`, { key: "u_personnel_code", name: "کد پرسنلی", base: "string", validation: { pattern: "^\\d{6}$", patternMessage: "کد پرسنلی شش رقم است" }, display: { ltr: true } })).row;
    expect(t).toMatchObject({ key: "u_personnel_code", base: "string", status: "active" });
    const f = (await e.owner.post(`${P}/field_def`, { name: "u_personnel", label: "کد پرسنلی", type: "u_personnel_code", field_group: "personal", list: true })).row;
    expect(f).toMatchObject({ name: "u_personnel", type: "u_personnel_code", status: "active", list: true, search: false });
    const auditor = await e.member("viewer");
    expect((await auditor.client.get(`${P}/field_def`)).rows.map((r: { name: string }) => r.name)).toContain("u_personnel");
    await auditor.client.post(`${P}/field_def`, { name: "u_x", label: "x", type: "string" }, 403);
    const agent = await e.member("member");
    await agent.client.post(`${P}/field_def`, { name: "u_x", label: "x", type: "string" }, 403);
    await agent.client.post(`${P}/field_type`, { key: "u_x", name: "x", base: "string" }, 403);
  });

  it("refuses bad keys, names, bases, widgets, settings and references with Persian reasons", async () => {
    const no = async (table: string, body: Record<string, unknown>) => ((await e.owner.post(`${P}/${table}`, body, 400)) as Msg).error.message;
    expect(await no("field_type", { key: "personnel", name: "x", base: "string" })).toContain("با u_ شروع شود");
    expect(await no("field_type", { key: "u_t1", name: "x", base: "radio", widget: "checkbox" })).toBe("نمایش «checkbox» برای نوع «گزینه‌های تکی» نیست");
    expect(await no("field_type", { key: "u_t2", name: "x", base: "national_id", validation: { pattern: "^\\d+$" } })).toBe("«الگو» برای نوع «کد ملی» تنظیم نمی‌شود");
    expect(await no("field_type", { key: "u_t3", name: "x", base: "string", validation: { pattern: "(a+)+" } })).toContain("تکرار");
    expect(await no("field_type", { key: "u_t4", name: "x", base: "money", validation: { unit: "toman" } })).toBe("«واحد مبلغ» در تنظیمات نمایش می‌آید");
    expect(await no("field_type", { key: "u_t5", name: "شعبه", base: "unit", validation: { refFilter: { f: "no_such_field", op: "eq", v: "branch" } } })).toContain("شرط رکوردهای قابل انتخاب");
    expect(await no("field_def", { name: "personnel", label: "x", type: "string" })).toContain("با u_ شروع شود");
    expect(await no("field_def", { name: "u_f1", label: "x", type: "no_such_type" })).toBe("نوع فیلد «no_such_type» وجود ندارد");
    expect(await no("field_def", { name: "u_f2", label: "قرارداد", type: "record" })).toBe("جدول مقصد «قرارداد» را برگزینید");
    expect(await no("field_def", { name: "u_f3", label: "x", type: "record", validation: { ref: "no_such_table" } })).toBe("جدول «no_such_table» وجود ندارد");
    expect(await no("field_def", { name: "u_f4", label: "x", type: "date", default_value: "$tomorrow" })).toContain("شناخته نیست");
    expect(await no("field_def", { name: "u_f5", label: "x", type: "date", default_value: "$me" })).toBe("مقدار پیش‌فرض «$me» به نوع «تاریخ» نمی‌خورد");
    expect(await no("field_def", { name: "u_f6", label: "x", type: "string", depends_on: "u_other" })).toBe("فقط فیلد گزینه‌ای به فیلد دیگری وابسته می‌شود");
    // what is well formed goes through
    const branch = (await e.owner.post(`${P}/field_type`, { key: "u_branch", name: "شعبه", base: "unit", validation: { refFilter: { f: "kind", op: "eq", v: "branch" } } })).row;
    expect(branch.validation).toEqual({ refFilter: { f: "kind", op: "eq", v: "branch" } });
    await e.owner.post(`${P}/field_def`, { name: "u_contract", label: "قرارداد", type: "record", validation: { ref: "contract" } });
    await e.owner.post(`${P}/field_def`, { name: "u_start", label: "تاریخ شروع", type: "date", default_value: "$today", validation: { minDate: "$today" } });
  });

  it("keeps a used field's name, storage and row: it is retired instead", async () => {
    const f = (await e.owner.post(`${P}/field_def`, { name: "u_leave_kind", label: "نوع مرخصی", type: "select", options: [{ value: "annual", label: "استحقاقی" }, { value: "sick", label: "استعلاجی" }] })).row;
    // unused: renaming and moving to another storage type are still free
    await e.owner.patch(`${P}/field_def/${f.id}`, { name: "u_leave_type" });
    await e.owner.patch(`${P}/field_def/${f.id}`, { type: "multiselect" });
    await e.owner.patch(`${P}/field_def/${f.id}`, { type: "select" });
    // attached to «کار» by an ordinary custom_field row naming it
    const cf = (await e.owner.post(`${P}/custom_field`, { table_key: "todo", name: "u_leave_type", label: "نوع مرخصی", type: "choice", library_id: f.id })).row;
    expect(cf).toMatchObject({ library_id: f.id, form_hidden: false, required_for: null, placeholder: null });
    expect(((await e.owner.patch(`${P}/field_def/${f.id}`, { name: "u_leave_other" }, 400)) as Msg).error.message).toBe("نام فنی «u_leave_type» عوض نمی‌شود: این فیلد در جدول‌های «کارها» به کار رفته است");
    expect(((await e.owner.patch(`${P}/field_def/${f.id}`, { type: "checklist" }, 400)) as Msg).error.message).toContain("نوع ذخیرهٔ «نوع مرخصی» عوض نمی‌شود");
    // within the storage type: select ↔ radio, and the label, freely
    expect((await e.owner.patch(`${P}/field_def/${f.id}`, { type: "radio", label: "گونهٔ مرخصی" })).row).toMatchObject({ type: "radio", label: "گونهٔ مرخصی" });
    expect(((await e.owner.del(`${P}/field_def/${f.id}`, 400)) as Msg).error.message).toBe("فیلد «گونهٔ مرخصی» در جدول‌های «کارها» به کار رفته است؛ به‌جای حذف، آن را بازنشسته کنید");
    expect((await e.owner.patch(`${P}/field_def/${f.id}`, { status: "retired" })).row.status).toBe("retired");
    // a deactivated attachment still holds values: the field stays in use
    await e.owner.patch(`${P}/custom_field/${cf.id}`, { active: false });
    await e.owner.del(`${P}/field_def/${f.id}`, 400);
    // an unused field is deleted
    const spare = (await e.owner.post(`${P}/field_def`, { name: "u_spare", label: "یدکی", type: "string" })).row;
    await e.owner.del(`${P}/field_def/${spare.id}`);
  });

  it("keeps a used type's storage and row, and offers a retired type for no new field", async () => {
    const t = (await e.owner.post(`${P}/field_type`, { key: "u_leave", name: "نوع مرخصی", base: "select", options: [{ value: "a", label: "الف" }] })).row;
    const f = (await e.owner.post(`${P}/field_def`, { name: "u_leave2", label: "مرخصی", type: "u_leave" })).row;
    await e.owner.patch(`${P}/field_type/${t.id}`, { base: "radio" });
    expect(((await e.owner.patch(`${P}/field_type/${t.id}`, { base: "multiselect" }, 400)) as Msg).error.message).toContain("فیلدهای «مرخصی» از آن استفاده می‌کنند");
    expect(((await e.owner.patch(`${P}/field_type/${t.id}`, { key: "u_leave_x" }, 400)) as Msg).error.message).toBe("کلید نوع فیلد پس از ساخت تغییر نمی‌کند");
    expect(((await e.owner.del(`${P}/field_type/${t.id}`, 400)) as Msg).error.message).toContain("به‌جای حذف، آن را بازنشسته کنید");
    await e.owner.patch(`${P}/field_type/${t.id}`, { status: "retired" });
    expect(((await e.owner.post(`${P}/field_def`, { name: "u_leave3", label: "x", type: "u_leave" }, 400)) as Msg).error.message).toBe("نوع «نوع مرخصی» بازنشسته است و برای فیلد تازه به کار نمی‌رود");
    // the field of the retired type keeps working
    expect((await e.owner.patch(`${P}/field_def/${f.id}`, { label: "مرخصی سالانه" })).row.label).toBe("مرخصی سالانه");
  });

  it("sends the rows to Windows apps with every column, and refuses a Windows app's push of them", async () => {
    const pull = await e.owner.get(`/sync/pull?org_id=${e.org}&protocol=${SYNC_PROTOCOL}`);
    const find = (entity: string, pred: (row: Record<string, unknown>) => boolean) => pull.aggregates.find((a: { entity: string; row: Record<string, unknown> }) => a.entity === entity && pred(a.row));
    const def = find("field_def", (r) => r.name === "u_personnel");
    expect(def.row).toMatchObject({ label: "کد پرسنلی", type: "u_personnel_code", field_group: "personal", status: "active" });
    expect(find("field_type", (r) => r.key === "u_personnel_code").row).toMatchObject({ base: "string", validation: { pattern: "^\\d{6}$", patternMessage: "کد پرسنلی شش رقم است" }, display: { ltr: true } });
    const cf = find("custom_field", (r) => r.name === "u_leave_type");
    expect(cf.row).toHaveProperty("library_id");
    expect(cf.row).toMatchObject({ form_hidden: false, required_for: null, placeholder: null });
    // the stored row as a Windows app pushes it back (JSON round trip), newer than the server's copy
    const stored = (await e.db.one<Record<string, unknown>>(`select * from sm_field_defs where id = $1`, [def.id]))!;
    const later = new Date(Date.now() + 5_000).toISOString();
    const results = (await e.owner.post(`/sync/push`, {
      org_id: e.org,
      device_id: uuidv7(),
      protocol: SYNC_PROTOCOL,
      aggregates: [
        { entity: "field_def", id: def.id, base_rev: Number(stored.rev), row: { ...JSON.parse(JSON.stringify(stored)), label: "تغییر از ویندوز", updated_at: later } },
        { entity: "field_type", id: uuidv7(), base_rev: 0, row: { key: "u_from_windows", name: "از ویندوز", base: "string", updated_at: later } },
      ],
    })).results as { status: string; message?: string }[];
    expect(results.map((r) => r.status)).toEqual(["error", "error"]);
    expect(results[0].message).toBe("«فیلد» فقط در نسخهٔ وب تغییر می‌کند");
    expect(results[1].message).toBe("«نوع فیلد» فقط در نسخهٔ وب تغییر می‌کند");
    expect((await e.owner.get(`${P}/field_def/${def.id}`)).row.label).toBe("کد پرسنلی");
  });
});
