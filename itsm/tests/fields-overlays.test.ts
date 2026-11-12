// F1 — the table overlays on the server (design F §3.1, §3.3, §4.2): library fields attached to tables (a changed
// label reaches every table; the schema stamp follows the library), the validation of field types in the engine
// (named checks, patterns, decimals, date limits, attachments of the same record), placeholders and «پنهان در فرم»,
// the organisation's requirements on people's writes only, the refused combinations, the lifecycle overlay `_states`
// (labels, colours, primary; `off` only on optional transitions and never the only way out; `also` narrows and never
// loosens; `when` and the organisation's `requires` bind people on the API and the push path, never the system or
// trusted code), locked options, and the access of F1's routes.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { engineOrg, upload, PNG, type EngineOrg } from "./engine-helpers";
import { Client, signupWithOrg } from "./helpers";
import { CHOICE_LISTS, tableDef } from "@shared/tables";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { todayISO } from "@shared/jalali";
import { systemCtx, transitionIn, updateIn } from "@server/engine";
import { transitionBlocked, transitionKey, mergeLifecycle, strandedStates, cleanLifecycle } from "@shared/model/lifecycle";
import type { FieldDef, TableDef, Transition } from "@shared/model/types";

type Msg = { error: { message: string; details?: { fields?: Record<string, string> } } };
type Result = { status: string; message?: string };

let e: EngineOrg;
let P: string;
let R: string;
let member: { client: Client; userId: string };
let requester: { client: Client; userId: string };
let viewer: { client: Client; userId: string };

const meta = async (c: Client, table = "todo") => (await c.get(`${P}/meta/tables/${table}`)).table as TableDef;
const fieldOf = (def: TableDef, name: string) => def.fields.find((f) => f.name === name) as FieldDef;
const msg = (r: unknown) => (r as Msg).error.message;

async function push(c: Client, table: string, id: string, patch: Record<string, unknown>): Promise<Result> {
  const stored = (await e.db.one<Record<string, unknown>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
  const row = { ...JSON.parse(JSON.stringify(stored)), ...patch, updated_at: new Date(Date.now() + 5_000).toISOString() };
  const out = await c.post(`/sync/push`, { org_id: e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: table, id, base_rev: Number(stored.rev), row }] });
  return out.results[0] as Result;
}

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  R = `${P}/r`;
  member = await e.member("member");
  requester = await e.member("member");
  await e.owner.put(`${P}/access/members/${requester.userId}`, { roles: ["requester"], persona: "requester" });
  viewer = await e.member("viewer");
}, 600_000);

describe("library fields on tables", () => {
  it("bring their type, validation and label to every table, and follow the library", async () => {
    const lib = (await e.owner.post(`${P}/fields/library`, { name: "u_personnel", label: "کد پرسنلی", type: "string", validation: { pattern: "^\\d{6}$", patternMessage: "شش رقم" } }, 201)).row;
    await e.owner.post(`${P}/fields/attach`, { table: "todo", field: lib.id }, 201);
    await e.owner.post(`${P}/fields/attach`, { table: "problem", field: "u_personnel" }, 201);
    expect(fieldOf(await meta(e.owner), "u_personnel")).toMatchObject({ label: "کد پرسنلی", pattern: "^\\d{6}$", library: "u_personnel", custom: true });
    await e.owner.patch(`${P}/fields/library/${lib.id}`, { label: "شمارهٔ پرسنلی" });
    expect(fieldOf(await meta(e.owner), "u_personnel").label).toBe("شمارهٔ پرسنلی");
    expect(fieldOf(await meta(e.owner, "problem"), "u_personnel").label).toBe("شمارهٔ پرسنلی");
    // a change made on another instance (no in-process invalidation): the stamp covers the library
    await e.db.query(`update sm_field_defs set label = 'کد کارمندی', updated_at = now() + interval '1 second' where id = $1`, [lib.id]);
    expect(fieldOf(await meta(e.owner), "u_personnel").label).toBe("کد کارمندی");
    // the pattern, with Persian digits; a value sent back unchanged is not judged again after the type tightens
    expect((await e.owner.post(R + "/todo", { short_description: "الگو", u_personnel: "۱۲۳" }, 400) as Msg).error.details?.fields?.u_personnel).toBe("«کد کارمندی»: شش رقم");
    const t = (await e.owner.post(R + "/todo", { short_description: "الگو", u_personnel: "۱۲۳۴۵۶" })).row;
    expect(t.u_personnel).toBe("۱۲۳۴۵۶");
    await e.owner.patch(`${P}/fields/library/${lib.id}`, { validation: { pattern: "^9\\d{5}$" } });
    await e.owner.patch(`${R}/todo/${t.id}`, { short_description: "الگوی تازه", u_personnel: "۱۲۳۴۵۶" });
    await e.owner.patch(`${R}/todo/${t.id}`, { u_personnel: "123457" }, 400);
  });

  it("check money decimals, date limits and a «پیوست» field holding only the record's own files", async () => {
    await e.owner.post(`${P}/fields/library`, { name: "u_amount", label: "مبلغ", type: "money" }, 201);
    await e.owner.post(`${P}/fields/library`, { name: "u_start", label: "تاریخ شروع", type: "date", validation: { minDate: "$today" } }, 201);
    await e.owner.post(`${P}/fields/library`, { name: "u_files", label: "مدارک", type: "attachment", validation: { max: 2, accept: ["pdf"] } }, 201);
    for (const f of ["u_amount", "u_start", "u_files"]) await e.owner.post(`${P}/fields/attach`, { table: "todo", field: f }, 201);
    const def = await meta(e.owner);
    expect(fieldOf(def, "u_files")).toMatchObject({ type: "json", widget: "files", check: "attachments", max: 2, accept: ["pdf"] });
    expect(fieldOf(def, "u_amount")).toMatchObject({ type: "money", decimals: 0 });
    // whole Rials
    expect(((await e.owner.post(R + "/todo", { short_description: "مبلغ", u_amount: "۱۵۰۰٫۵" }, 400)) as Msg).error.details?.fields?.u_amount).toBe("«مبلغ» باید عدد صحیح باشد");
    // from today on, in the organisation's time zone
    const yesterday = new Date(Date.parse(`${todayISO("Asia/Tehran")}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect(((await e.owner.post(R + "/todo", { short_description: "تاریخ", u_start: yesterday }, 400)) as Msg).error.details?.fields?.u_start).toMatch(/نباید پیش از/);
    const a = (await e.owner.post(R + "/todo", { short_description: "پیوست الف", u_amount: "1500", u_start: todayISO("Asia/Tehran") })).row;
    const b = (await e.owner.post(R + "/todo", { short_description: "پیوست ب" })).row;
    const pdf = new TextEncoder().encode("%PDF-1.4\n%demo\n");
    const upA = async (name: string, data: Uint8Array, type: string) => (await (await upload(e.app, e.owner, `${R}/todo/${a.id}/attachments`, name, data, type)).json()).attachment.id as string;
    const mine = await upA("form.pdf", pdf, "application/pdf");
    const png = await upA("shot.png", PNG, "image/png");
    const theirs = (await (await upload(e.app, e.owner, `${R}/todo/${b.id}/attachments`, "other.pdf", pdf, "application/pdf")).json()).attachment.id as string;
    expect(((await e.owner.patch(`${R}/todo/${a.id}`, { u_files: [theirs] }, 400)) as Msg).error.details?.fields?.u_files).toBe("پیوست‌های «مدارک» باید از پرونده‌های همین رکورد باشند");
    expect(((await e.owner.patch(`${R}/todo/${a.id}`, { u_files: [png] }, 400)) as Msg).error.details?.fields?.u_files).toContain("فقط این نوع پرونده‌ها");
    expect(((await e.owner.patch(`${R}/todo/${a.id}`, { u_files: [mine, png, theirs] }, 400)) as Msg).error.details?.fields?.u_files).toBe("«مدارک» حداکثر ۲ پرونده می‌پذیرد");
    expect((await e.owner.patch(`${R}/todo/${a.id}`, { u_files: [mine.toUpperCase()] })).row.u_files).toEqual([mine]);
  });

  it("keep their definition on the table's row, for Windows apps that do not receive the library", async () => {
    const lib = (await e.owner.post(`${P}/fields/library`, { name: "u_contract_no", label: "شمارهٔ قرارداد", type: "string", validation: { maxLength: 20 } }, 201)).row;
    await e.owner.post(`${P}/fields/attach`, { table: "todo", field: lib.id }, 201);
    const stored = async () => (await e.db.one<{ options: { field: Record<string, unknown> } }>(`select options from sm_custom_fields where org_id = $1 and table_key = 'todo' and name = 'u_contract_no' and deleted_at is null`, [e.org]))!.options;
    expect((await stored()).field).toMatchObject({ label: "شمارهٔ قرارداد", type: "string", maxLength: 20, library: "u_contract_no" });
    await e.owner.patch(`${P}/fields/library/${lib.id}`, { label: "شمارهٔ پیمان" });
    expect((await stored()).field.label).toBe("شمارهٔ پیمان");
    // a change of the field's type reaches the rows too
    const type = (await e.owner.post(`${P}/fields/types`, { key: "u_contract_code", name: "کد قرارداد", base: "string", validation: { maxLength: 30 } }, 201)).row;
    await e.owner.patch(`${P}/fields/library/${lib.id}`, { type: "u_contract_code", validation: null });
    expect((await stored()).field.maxLength).toBe(30);
    await e.owner.patch(`${P}/fields/types/${type.id}`, { validation: { maxLength: 20 } });
    expect((await stored()).field.maxLength).toBe(20);
    // a runtime without the library's rows (an account that does not read «طراحی فرم و گردش‌کار») builds it from the row
    await e.db.query(`update sm_field_defs set deleted_at = now(), updated_at = now() + interval '2 seconds' where id = $1`, [lib.id]);
    expect(fieldOf(await meta(e.owner), "u_contract_no")).toMatchObject({ label: "شمارهٔ پیمان", type: "string", maxLength: 20, library: "u_contract_no", custom: true });
    await e.owner.post(R + "/todo", { short_description: "قرارداد", u_contract_no: "x".repeat(21) }, 400);
  });

  it("are refused when retired, already attached, or under another name", async () => {
    const lib = (await e.owner.post(`${P}/fields/library`, { name: "u_old", label: "قدیمی", type: "string" }, 201)).row;
    await e.owner.patch(`${P}/fields/library/${lib.id}`, { status: "retired" });
    expect(msg(await e.owner.post(`${P}/fields/attach`, { table: "todo", field: "u_old" }, 400))).toBe("فیلد «قدیمی» بازنشسته است و به جدول تازه‌ای افزوده نمی‌شود");
    expect(msg(await e.owner.post(`${P}/fields/attach`, { table: "todo", field: "u_amount" }, 409))).toBe("«مبلغ» پیش‌تر به «کارها» افزوده شده است");
    const other = (await e.owner.get(`${R}/field_def?q=${encodeURIComponent("مبلغ")}`)).rows[0];
    expect(msg(await e.owner.post(`${R}/custom_field`, { table_key: "incident", name: "u_other", label: "x", library_id: other.id }, 400))).toBe("نام فیلد در جدول همان نام فنی فیلد کتابخانه است: «u_amount»");
    await e.owner.post(`${P}/fields/attach`, { table: "nowhere", field: "u_amount" }, 404);
  });
});

describe("overrides of a table's default form", () => {
  it("set a placeholder and «پنهان در فرم» without touching `hidden`; a field back at its defaults loses its row", async () => {
    const out = await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { description: { placeholder: "چه باید انجام شود؟" }, impact: { form_hidden: true } } });
    expect(out.fields.find((f: { name: string }) => f.name === "impact")).toMatchObject({ form_hidden: true, overridden: true });
    const def = await meta(e.owner);
    expect(fieldOf(def, "description").placeholder).toBe("چه باید انجام شود؟");
    expect(fieldOf(def, "impact")).toMatchObject({ formHidden: true });
    expect(fieldOf(def, "impact").hidden).toBeUndefined();
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { impact: { form_hidden: false } } });
    expect(fieldOf(await meta(e.owner), "impact").formHidden).toBeUndefined();
    expect(await e.db.one(`select 1 from sm_custom_fields where org_id = $1 and table_key = 'todo' and name = 'impact' and deleted_at is null`, [e.org])).toBeNull();
  });

  it("refuse hiding or requiring a locked field, with its reasons", async () => {
    expect(msg(await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { short_description: { form_hidden: true } } }, 400))).toBe(
      "«عنوان» را نمی‌توانید از فرم پنهان کنید؛ این فیلد قفل است: شناسهٔ رکورد، الزامی در ماژول، پایهٔ جست‌وجوی هوشمند",
    );
    expect(msg(await e.owner.post(`${R}/custom_field`, { table_key: "todo", name: "assigned_to", label: "کارشناس", required: true }, 400))).toContain("قفل است: پایهٔ دسترسی");
    // relabelling a locked field is free
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { short_description: { label: "موضوع", help: "یک جمله" } } });
    expect(fieldOf(await meta(e.owner), "short_description")).toMatchObject({ label: "موضوع", help: "یک جمله" });
  });

  it("refuse the combinations: hide a required field, require a hidden one, a UI policy's mandatory on a hidden field", async () => {
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { urgency: { required: true } } });
    expect(msg(await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { urgency: { form_hidden: true } } }, 400))).toBe("«فوریت» الزامی است و از فرم پنهان نمی‌شود؛ نخست الزام را بردارید");
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { channel: { form_hidden: true } } });
    expect(msg(await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { channel: { required: true } } }, 400))).toBe("«مجرای دریافت» در فرم پنهان است و الزامی نمی‌شود؛ نخست آن را در فرم نشان دهید");
    const refused = (await e.owner.post(`${R}/ui_policy`, { name: "مجرا لازم", table_key: "todo", actions: [{ field: "channel", mandatory: true }] }, 400)) as Msg;
    expect(refused.error.details?.fields?.actions).toBe("«مجرای دریافت» در فرم پنهان است و سیاست فرم آن را الزامی نمی‌کند؛ نخست آن را در فرم نشان دهید");
    const policy = (await e.owner.post(`${R}/ui_policy`, { name: "دسته لازم", table_key: "todo", actions: [{ field: "category", mandatory: true }] })).row;
    expect(msg(await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { category: { form_hidden: true } } }, 400))).toBe("«دسته» در سیاست فرم «دسته لازم» الزامی است و از فرم پنهان نمی‌شود");
    // clean up for the requirement tests below
    await e.owner.patch(`${R}/ui_policy/${policy.id}`, { active: false });
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { urgency: { required: false }, channel: { form_hidden: false } } });
  });
});

describe("the organisation's requirements bind people's writes only", () => {
  it("binds people's API writes and pushes, never the system or trusted code; «فقط کارشناسان» spares requesters", async () => {
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { location_id: { required: true, required_for: "agents" }, escalation: { required: true } } });
    const def = await meta(member.client);
    expect(fieldOf(def, "location_id")).toMatchObject({ formRequired: "agents", required: true });
    expect(fieldOf(await meta(requester.client), "location_id").required).toBeUndefined();
    // the member (an agent by the membership's fallback roles) is held to both
    const loc = (await e.owner.post(`${R}/location`, { name: "ساختمان مرکزی" })).row.id;
    expect(((await member.client.post(`${R}/todo`, { short_description: "الزام" }, 400)) as Msg).error.details?.fields).toEqual({ location_id: "«مکان» را وارد کنید" });
    // escalation is an int with a default (0): filled
    const row = (await member.client.post(`${R}/todo`, { short_description: "الزام", location_id: loc, assigned_to: member.userId })).row;
    // a requester is held to «همه» only
    await requester.client.post(`${R}/todo`, { short_description: "درخواست من" });
    // the system and trusted code are never held
    const sys = await systemCtx(e.cfg, e.org);
    await sys.write((tx) => updateIn(tx, sys, "todo", row.id, { location_id: null }));
    const mctx = await e.ctxOf(member.userId);
    await mctx.write((tx) => updateIn(tx, mctx, "todo", row.id, { location_id: loc }));
    await mctx.write((tx) => updateIn(tx, mctx, "todo", row.id, { location_id: null }, { trusted: true }));
    // the member's API write and push emptying it are refused
    await member.client.patch(`${R}/todo/${row.id}`, { location_id: loc });
    await member.client.patch(`${R}/todo/${row.id}`, { location_id: null }, 400);
    expect(await push(member.client, "todo", row.id, { location_id: null })).toMatchObject({ status: "error", message: "«مکان» را وارد کنید" });
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { location_id: { required: false }, escalation: { required: false } } });
  });
});

describe("the lifecycle overlay `_states`", () => {
  const def = tableDef("todo")!;
  const key = (to: string, from?: string) => transitionKey(def.states!.transitions.find((t) => t.to === to && (!from || (t.from !== "*" && t.from.includes(from))))!);
  const hold = def.states!.transitions.find((t) => t.to === "on_hold")!;
  const close = def.states!.transitions.find((t) => t.to === "closed")!;
  const reopen = def.states!.transitions.find((t) => t.to === "in_progress" && t.from !== "*" && t.from.includes("resolved"))!;
  beforeAll(() => {
    // a module marks these optional (none does yet in the registry): the test marks them on its own copy of the process
    hold.optional = true;
    close.optional = true;
    reopen.optional = true;
  });
  afterAll(() => {
    delete hold.optional;
    delete close.optional;
    delete reopen.optional;
  });

  it("relabels and recolours states and transitions, and marks one primary — on every path", async () => {
    const out = await e.owner.put(`${P}/lifecycles/todo`, {
      states: { in_progress: { label: "در دست کار", color: "purple" } },
      transitions: [{ key: key("in_progress", "new"), label: "آغاز", primary: true }],
    });
    expect(out.states.find((s: { value: string }) => s.value === "in_progress")).toMatchObject({ label: "در دست کار", color: "purple", default_label: "در حال انجام" });
    expect(out.transitions.find((t: { key: string }) => t.key === key("in_progress", "new"))).toMatchObject({ label: "آغاز", primary: true, default_label: "شروع کار" });
    const m = await meta(e.owner);
    expect(m.states!.states.find((s) => s.value === "in_progress")).toMatchObject({ label: "در دست کار", color: "purple", category: "active" });
    const t = (await e.owner.post(`${R}/todo`, { short_description: "چرخه" })).row;
    const rec = await e.owner.get(`${R}/todo/${t.id}`);
    expect(rec.meta.transitions.find((x: { to: string }) => x.to === "in_progress").label).toBe("آغاز");
    // states and transitions are the module's: unknown ones are refused
    expect(msg(await e.owner.put(`${P}/lifecycles/todo`, { states: { archived: { label: "بایگانی" } } }, 400))).toBe("وضعیت «archived» در «کارها» نیست؛ وضعیت‌ها را ماژول تعیین می‌کند");
    expect(msg(await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: "new>closed", label: "x" }] }, 400))).toContain("انتقال‌ها را ماژول تعیین می‌کند");
    expect(msg(await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: key("in_progress", "new"), primary: true }, { key: key("canceled"), primary: true }] }, 400))).toBe("فقط یک انتقال اصلی ممکن است");
  });

  it("switches off only optional transitions, never the only way out, and the API and the push path lose them", async () => {
    expect(msg(await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: key("canceled"), off: true }] }, 400))).toBe("«لغو» را ماژول به کار می‌برد و خاموش نمی‌شود");
    expect(msg(await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: transitionKey(close), off: true }, { key: transitionKey(reopen), off: true }] }, 400))).toBe("با خاموش شدن این انتقال‌ها، از «حل‌شده» راهی به بیرون نمی‌ماند");
    await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: transitionKey(hold), off: true }] });
    expect((await meta(e.owner)).states!.transitions.some((t) => t.to === "on_hold")).toBe(false);
    const t = (await member.client.post(`${R}/todo`, { short_description: "خاموش", assigned_to: member.userId })).row;
    expect((await member.client.get(`${R}/todo/${t.id}`)).meta.transitions.map((x: { to: string }) => x.to)).not.toContain("on_hold");
    expect(msg(await member.client.post(`${R}/todo/${t.id}/transition`, { to: "on_hold" }, 409))).toBe("انتقال از «جدید» به «در انتظار» مجاز نیست");
    expect(await push(member.client, "todo", t.id, { state: "on_hold" })).toMatchObject({ status: "error", message: "«کار» از «جدید» به «در انتظار» نمی‌رود" });
  });

  it("narrows with `also` (one of the roles as well) and never loosens; trusted code is not narrowed", async () => {
    await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: key("in_progress", "new"), also: ["tenant_admin"] }] });
    expect(msg(await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: key("in_progress", "new"), also: ["no_such_role"] }] }, 400))).toBe("نقش «no_such_role» برای «شروع کار» وجود ندارد");
    const t = (await member.client.post(`${R}/todo`, { short_description: "نقش", assigned_to: member.userId })).row;
    expect((await member.client.get(`${R}/todo/${t.id}`)).meta.transitions.map((x: { to: string }) => x.to)).not.toContain("in_progress");
    expect(msg(await member.client.post(`${R}/todo/${t.id}/transition`, { to: "in_progress" }, 403))).toBe("اجازهٔ «شروع کار» را ندارید");
    expect(await push(member.client, "todo", t.id, { state: "in_progress" })).toMatchObject({ status: "error", message: "اجازهٔ «شروع کار» را ندارید" });
    // trusted server code acting for the member is held to the module's rule only
    const mctx = await e.ctxOf(member.userId);
    expect((await mctx.write((tx) => transitionIn(tx, mctx, "todo", t.id, "in_progress", {}, { trusted: true }))).state).toBe("in_progress");
    // the owner holds the role
    const u = (await e.owner.post(`${R}/todo`, { short_description: "نقش ۲" })).row;
    await e.owner.post(`${R}/todo/${u.id}/transition`, { to: "in_progress" });
  });

  it("holds people to `when` and the organisation's `requires` on the API and the push path, never the system", async () => {
    await e.owner.put(`${P}/lifecycles/todo`, {
      transitions: [
        { key: key("canceled"), when: { f: "priority", op: "ne", v: "1" }, message: "کار بحرانی لغو نمی‌شود" },
        { key: key("in_progress", "new"), requires: ["due_at"] },
      ],
    });
    const m = await meta(e.owner);
    const cancel = m.states!.transitions.find((t) => t.to === "canceled")!;
    expect(transitionBlocked(cancel, { priority: "1" })).toBe("کار بحرانی لغو نمی‌شود");
    expect(transitionBlocked(cancel, { priority: "3" })).toBeNull();
    const t = (await member.client.post(`${R}/todo`, { short_description: "بحرانی", priority: "1", assigned_to: member.userId })).row;
    expect(msg(await member.client.post(`${R}/todo/${t.id}/transition`, { to: "canceled", data: { close_notes: "لغو" } }, 409))).toBe("کار بحرانی لغو نمی‌شود");
    expect(await push(member.client, "todo", t.id, { state: "canceled", close_notes: "لغو" })).toMatchObject({ status: "error", message: "کار بحرانی لغو نمی‌شود" });
    expect(msg(await member.client.post(`${R}/todo/${t.id}/transition`, { to: "in_progress" }, 409))).toBe("برای «شروع کار»، «موعد» را وارد کنید");
    expect(await push(member.client, "todo", t.id, { state: "in_progress" })).toMatchObject({ status: "error", message: "برای «شروع کار»، «موعد» را وارد کنید" });
    await member.client.post(`${R}/todo/${t.id}/transition`, { to: "in_progress", data: { due_at: new Date(Date.now() + 86_400_000).toISOString() } });
    // the system is never held to them
    const sys = await systemCtx(e.cfg, e.org);
    const v = (await e.owner.post(`${R}/todo`, { short_description: "سامانه", priority: "1" })).row;
    expect((await sys.write((tx) => transitionIn(tx, sys, "todo", v.id, "in_progress"))).state).toBe("in_progress");
    expect((await sys.write((tx) => transitionIn(tx, sys, "todo", v.id, "canceled", { close_notes: "لغو سامانه" }))).state).toBe("canceled");
  });

  it("judges the organisation fields a Windows app pushes with the transition", async () => {
    await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: key("in_progress", "new"), requires: ["u_amount"] }] });
    const t = (await member.client.post(`${R}/todo`, { short_description: "مبلغ لازم", assigned_to: member.userId })).row;
    expect(await push(member.client, "todo", t.id, { state: "in_progress" })).toMatchObject({ status: "error", message: "برای «شروع کار»، «مبلغ» را وارد کنید" });
    expect((await push(member.client, "todo", t.id, { state: "in_progress", custom: { u_amount: "2000" } })).status).toBe("ok");
    expect((await e.owner.get(`${R}/todo/${t.id}`)).row).toMatchObject({ state: "in_progress", u_amount: "2000" });
  });

  it("refuses a requirement on a hidden field, and hiding a field a transition requires", async () => {
    await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: key("in_progress", "new"), requires: ["due_at"] }] });
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { channel: { form_hidden: true } } });
    expect(msg(await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key: key("in_progress", "new"), requires: ["channel"] }] }, 400))).toBe(
      "«مجرای دریافت» در فرم پنهان است و برای «شروع کار» لازم نمی‌شود؛ نخست آن را در فرم نشان دهید",
    );
    expect(msg(await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { due_at: { form_hidden: true } } }, 400))).toBe("«موعد» برای «شروع کار» لازم است و از فرم پنهان نمی‌شود");
    // «بازگشت به پیش‌فرض»
    const reset = await e.owner.put(`${P}/lifecycles/todo`, {});
    expect(reset.overlay).toBeNull();
    expect((await meta(e.owner)).states!.transitions.some((t) => t.to === "on_hold")).toBe(true);
  });

  it("offers a lifecycle a module configures elsewhere its labels, colours and primary only", async () => {
    const cr = tableDef("change_request")!;
    const first = cr.states!.transitions[0];
    expect(msg(await e.owner.put(`${P}/lifecycles/change_request`, { transitions: [{ key: transitionKey(first), also: ["tenant_admin"] }] }, 400))).toContain("فقط برچسب، رنگ و انتقال اصلی تغییر می‌کند");
    const out = await e.owner.put(`${P}/lifecycles/change_request`, { transitions: [{ key: transitionKey(first), label: "ارسال", primary: true }] });
    expect(out).toMatchObject({ labels_only: true, notes: [{ link: "changes/models" }] });
  });

  it("merges purely: stranded states are never switched off, and stored junk is dropped", () => {
    const model = { ...def.states!, transitions: def.states!.transitions.map((t) => ({ ...t, optional: true })) as Transition[] };
    expect(strandedStates(model, new Set([transitionKey(close), transitionKey(reopen)]))).toEqual(["resolved"]);
    const merged = mergeLifecycle(model, { transitions: [{ key: transitionKey(close), off: true }, { key: transitionKey(reopen), off: true }] });
    expect(merged.transitions.filter((t) => t.from !== "*" && t.from.includes("resolved")).length).toBe(1);
    expect(cleanLifecycle({ states: { new: { label: 5, color: "neon" } }, transitions: [{ key: "", off: true }, "x"] })).toBeNull();
  });
});

describe("locked options", () => {
  const general = CHORE();
  function CHORE() {
    return CHOICE_LISTS.get("todo.category")!.find((o) => o.value === "general")!;
  }
  beforeAll(() => {
    general.locked = true;
  });
  afterAll(() => {
    delete general.locked;
  });

  it("are relabelled and recoloured, never deactivated", async () => {
    expect(msg(await e.owner.post(`${R}/choice`, { list: "todo.category", value: "general", label: "عمومی", active: false }, 400))).toBe("گزینهٔ «عمومی» را ماژول به کار می‌برد و غیرفعال نمی‌شود؛ برچسب، رنگ و ترتیبش را می‌توانید تغییر دهید");
    await e.owner.post(`${R}/choice`, { list: "todo.category", value: "general", label: "همگانی", color: "teal" });
    // a row that says otherwise (stored before the lock) does not switch it off
    await e.db.query(`update sm_choices set active = false, updated_at = now() + interval '1 second' where org_id = $1 and list = 'todo.category' and value = 'general'`, [e.org]);
    const opts = (await e.owner.get(`${P}/meta/tables/todo`)).choices["todo.category"];
    expect(opts.find((o: { value: string }) => o.value === "general")).toMatchObject({ label: "همگانی", color: "teal", locked: true });
    expect(opts.find((o: { value: string }) => o.value === "general").active).toBeUndefined();
  });
});

describe("F1's routes", () => {
  it("open the library to its designers and readers, the overrides to settings managers and the lifecycles to administrators", async () => {
    const lib = await viewer.client.get(`${P}/fields/library`);
    const amount = lib.fields.find((f: { name: string }) => f.name === "u_amount");
    expect(amount).toMatchObject({ type: "money", type_label: "مبلغ", storage: "money", status: "active", usage: { tables: ["todo"], forms: [], versions: [] } });
    await viewer.client.post(`${P}/fields/library`, { name: "u_x", label: "x", type: "string" }, 403);
    await member.client.get(`${P}/fields/library`, 403);
    await member.client.post(`${P}/fields/attach`, { table: "todo", field: "u_amount" }, 403);
    await member.client.put(`${P}/forms/system/todo/overrides`, { fields: {} }, 403);
    await member.client.put(`${P}/lifecycles/todo`, {}, 403);
    expect((await member.client.get(`${P}/lifecycles/todo`)).table).toBe("todo");
    const types = await viewer.client.get(`${P}/fields/types`);
    expect(types.builtin.slice(0, 2).map((t: { key: string }) => t.key)).toEqual(["string", "text"]);
    expect(types.builtin.find((t: { key: string }) => t.key === "money")).toMatchObject({ available: true, fields: 1 });
    const locked = await viewer.client.get(`${P}/fields/locked/todo`);
    expect(locked.locked.state.map((l: { label: string }) => l.label)).toEqual(["شناسهٔ رکورد"]);
    const paths = await e.owner.get(`${P}/fields/paths/incident?required_for=agents`);
    expect(paths.blockers).toEqual([]);
    expect(paths.effects.find((x: { path: { key: string } }) => x.path.key === "email")).toMatchObject({ checked: false, text: "ثبت خودکار سامانه: بررسی نمی‌شود" });
    expect(paths.effects.find((x: { path: { key: string } }) => x.path.key === "portal_report")).toMatchObject({ checked: false, text: "درخواست‌دهندگان: بررسی نمی‌شود" });
    expect((await e.owner.get(`${P}/fields/paths/incident?required_for=all`)).blockers.length).toBe(1);
  });

  it("keep the lifecycle overlay to administrators on every path: a settings editor changes overrides, never `_states` (F1-2, F1-13)", async () => {
    const editor = await e.member("member");
    const mid = (await e.db.one<{ id: string }>(`select id from sm_org_members where org_id = $1 and user_id = $2`, [e.org, editor.userId]))!.id;
    await e.owner.patch(`${P}/members/${mid}`, { overrides: { settings: "edit" } });
    const refusal = "چرخهٔ عمر رکوردها را مدیر سازمان تغییر می‌دهد";
    // the overrides of the default form are theirs
    const saved = await editor.client.put(`${P}/forms/system/todo/overrides`, { fields: { description: { help: "شرح کار را کامل بنویسید" } } });
    expect(saved.fields.find((f: { name: string }) => f.name === "description").help).toBe("شرح کار را کامل بنویسید");
    await editor.client.put(`${P}/forms/system/todo/overrides`, { fields: { description: { help: null } } });
    // the lifecycle is not: on F1's route…
    const key = "new,on_hold>in_progress";
    expect(msg(await editor.client.put(`${P}/lifecycles/todo`, { transitions: [{ key, also: ["tenant_admin"] }] }, 403))).toBe(refusal);
    // …nor through the generic record API: creating the row,
    expect(msg(await editor.client.post(`${R}/custom_field`, { table_key: "todo", name: "_states", label: "چرخهٔ عمر", options: { transitions: [{ key, also: ["tenant_admin"] }] } }, 403))).toBe(refusal);
    expect((await meta(e.owner)).states!.transitions.find((t) => t.to === "in_progress")!.also).toBeUndefined();
    // changing the administrator's overlay, or switching it off (which would widen who may take the transition)
    await e.owner.put(`${P}/lifecycles/todo`, { transitions: [{ key, also: ["tenant_admin"] }] });
    const row = (await e.db.one<{ id: string }>(`select id from sm_custom_fields where org_id = $1 and table_key = 'todo' and name = '_states' and deleted_at is null`, [e.org]))!;
    expect(msg(await editor.client.patch(`${R}/custom_field/${row.id}`, { options: { transitions: [{ key, also: ["tenant_admin"], when: { and: [{ f: "priority", op: "eq", v: "1" }] } }] } }, 403))).toBe(refusal);
    expect(msg(await editor.client.patch(`${R}/custom_field/${row.id}`, { active: false }, 403))).toBe(refusal);
    expect((await meta(e.owner)).states!.transitions.find((t) => t.to === "in_progress")!.also).toEqual(["tenant_admin"]);
    // the administrator may, on either path
    await e.owner.patch(`${R}/custom_field/${row.id}`, { active: false });
    expect((await meta(e.owner)).states!.transitions.find((t) => t.to === "in_progress")!.also).toBeUndefined();
    await e.owner.put(`${P}/lifecycles/todo`, null);
  });

  it("write as the person: a support session's change is audited as support, and a view-only session changes nothing (F1-10)", async () => {
    // another organisation, where the platform administrator (the first account) is not a member
    const lead = new Client(e.app);
    const org2 = await signupWithOrg(lead, { email: "lead-f1@example.com", name: "سازمان پشتیبانی‌شونده" });
    const { session } = await e.owner.post(`/admin/orgs/${org2}/support`, { level: "edit", reason: "تنظیم چرخهٔ عمر به درخواست مالک", hours: 1 });
    await e.owner.put(`/o/${org2}/lifecycles/todo`, { transitions: [{ key: "new,on_hold>in_progress", label: "آغاز کار" }] });
    await e.owner.put(`/o/${org2}/forms/system/todo/overrides`, { fields: { description: { help: "شرح را کامل بنویسید" } } });
    const audit = await e.db.query<{ action: string; actor_kind: string; summary: string }>(
      `select action, actor_kind, summary from sm_audit where org_id = $1 and support_session_id = $2 and action <> 'support_start' order by at`,
      [org2, session.id],
    );
    expect(audit.length).toBe(2);
    expect(audit.every((r) => r.action === "support_write" && r.actor_kind === "support")).toBe(true);
    // the change is the session's: once it ends, nothing more is written in its name
    await e.owner.post(`/admin/support/${session.id}/end`);
    const view = (await e.owner.post(`/admin/orgs/${org2}/support`, { level: "view", reason: "بررسی چرخهٔ عمر", hours: 1 })).session;
    await e.owner.put(`/o/${org2}/lifecycles/todo`, null, 403);
    expect((await lead.get(`/o/${org2}/lifecycles/todo`)).transitions.find((t: { to: string }) => t.to === "in_progress").label).toBe("آغاز کار");
    await e.owner.post(`/admin/support/${view.id}/end`);
  });
});
