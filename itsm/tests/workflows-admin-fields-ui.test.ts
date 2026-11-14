// «فیلدها» (design F §3.1, §3.3, §8.1, package F5; src/ui/modules/workflows/admin/fields): who is offered which tab
// and action, the tab an address opens (old links of the studio and settings/choices included), the library's search
// and chips, the type picker, what a field's and a type's sheet send and preview (money in the organisation's unit),
// every field of a table with its locks and blockers, promoting a table-only field — and the same payloads accepted
// by F1's routes on a real organisation: a library field and a type made, attached to a table, hidden from the form
// and shown again, a requirement's creation paths, a table-only field promoted with its values kept.
import { describe, it, expect, beforeAll } from "vitest";
import { composeEffective, gateAllows, roleCatalog, type AccessGate, type FullGrant } from "@shared/access";
import { LEVEL_ORDER, type Level } from "@shared/permissions";
import { tableDef } from "@shared/tables";
import { builtinFieldType, resolveFieldType } from "@shared/forms/fieldtypes";
import { lockRefusal } from "@shared/forms/locked";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import type { TableDef } from "@shared/model/types";
import {
  RETIRE_TEXT, attachable, draftType, fieldDraft, fieldDraftProblems, fieldPayload, fieldsAccess, filterLibrary, hideBlocker, previewField, promoteBody,
  requireBlocker, requirementText, resolvedType, settingsLines, tabOf, tableFieldRows, typeChoices, typeDraft, typeDraftProblems, typeOptions, typePayload,
  usageText, visibleTabs,
} from "../src/ui/modules/workflows/admin/fields/model";
import type { LibraryEntry, TypesResult } from "../src/ui/modules/workflows/admin/fields/api";
import { typeRows } from "../src/ui/modules/workflows/admin/fields/Types";
import { choicesSearch, fieldsPart } from "../src/ui/modules/workflows/admin/fields/routes";
import { NAV, ROUTES } from "../src/ui/modules/registry";
import { engineOrg, type EngineOrg } from "./engine-helpers";

// ---------------------------------------------------------------------------------------------------------------
// helpers

const catalog = roleCatalog([]);
const grantsOf = (...roles: string[]) => composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog }).grants;
const DESIGNER: Record<string, FullGrant> = { [PROCESS_DESIGN_AREA]: { read: "all", create: true, write: "all", delete: "none", approve: false, admin: false }, org: { read: "all", create: false, write: "none", delete: "none", approve: false, admin: false } };
const probe = (grants: Record<string, FullGrant>, settings: Level = "view", writable = true) => ({
  can: (_: "settings", level: Level) => LEVEL_ORDER.indexOf(settings) >= LEVEL_ORDER.indexOf(level),
  allows: (g: AccessGate) => gateAllows(grants, g),
  writable,
});

const entry = (p: Partial<LibraryEntry> & { name: string; label: string }): LibraryEntry => ({
  id: p.name, type: "string", type_label: "متن کوتاه", storage: "string", group: "text", field_group: null, status: "active", help: null, placeholder: null,
  usage: { tables: [], forms: [], versions: [] }, ...p,
});

const TYPES: TypesResult = {
  groups: { text: "متن", bank: "متن (بانکی)", number: "عدد", money: "مبلغ", bool: "بله/خیر", choice: "گزینه", date: "تاریخ", people: "افراد و سازمان", reference: "ارجاع", file: "پیوست", other: "دیگر" },
  builtin: (["string", "national_id", "money", "select", "radio", "date", "position", "record", "attachment"] as const).map((k) => {
    const b = builtinFieldType(k)!;
    return { key: b.key, label: b.label, group: b.group, storage: b.base, widget: b.settings.widget, settings: b.settings, editable: b.editable, available: k !== "position", fields: 0 };
  }),
  types: [
    { id: "t1", key: "u_leave_kind", name: "نوع مرخصی", base: "radio", base_label: "گزینه‌های تکی", storage: "choice", widget: "radio", settings: { widget: "radio", options: [{ value: "annual", label: "استحقاقی" }] }, status: "active", description: null, fields: 2 },
    { id: "t2", key: "u_old", name: "نوع کهنه", base: "string", base_label: "متن کوتاه", storage: "string", widget: "input", settings: { widget: "input" }, status: "retired", description: null, fields: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------------------------

describe("who is offered what", () => {
  it("a workflow designer: the library and the types, written; not the lists or the tables' fields", () => {
    const a = fieldsAccess(probe(DESIGNER));
    expect(a).toMatchObject({ designRead: true, designWrite: true, settingsEdit: false, settingsRead: false, choicesWrite: false, customWrite: false });
    expect(visibleTabs(a)).toEqual(["library", "types"]);
  });

  it("the organisation's administrator: every tab and every write; read-only while the organisation is", () => {
    const a = fieldsAccess(probe(grantsOf("tenant_admin"), "full"));
    expect(Object.values(a).every(Boolean)).toBe(true);
    expect(visibleTabs(a)).toEqual(["library", "types", "choices", "tables"]);
    const frozen = fieldsAccess(probe(grantsOf("tenant_admin"), "full", false));
    expect(frozen).toMatchObject({ designRead: true, settingsRead: true, designWrite: false, settingsEdit: false, choicesWrite: false, customWrite: false });
  });

  it("an auditor reads every tab and writes nothing; an agent and a requester are offered nothing", () => {
    const auditor = fieldsAccess(probe(grantsOf("auditor")));
    expect(visibleTabs(auditor)).toEqual(["library", "types", "choices", "tables"]);
    expect(auditor.designWrite || auditor.settingsEdit || auditor.choicesWrite || auditor.customWrite).toBe(false);
    for (const r of ["agent", "requester"]) expect(visibleTabs(fieldsAccess(probe(grantsOf(r))))).toEqual([]);
  });

  it("`settings` edit by membership alone (F1's routes accept it) opens the library too", () => {
    const a = fieldsAccess(probe(grantsOf("agent"), "edit"));
    expect(a.designRead && a.designWrite && a.settingsEdit).toBe(true);
  });

  it("the nav row is for «طراحی فرم و گردش‌کار»; the module serves settings/fields and settings/choices, the records module no longer", () => {
    const row = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).find((i) => i.key === "workflows:fields")!;
    expect(row).toMatchObject({ path: "settings/fields", group: "فرم‌ها و گردش‌کارها", access: { area: PROCESS_DESIGN_AREA } });
    expect([row.access].flat().every((g) => gateAllows(DESIGNER, g!))).toBe(true);
    expect([row.access].flat().every((g) => gateAllows(grantsOf("agent"), g!))).toBe(false);
    expect(NAV.flatMap((g) => g.items).some((i) => i.key === "custom-fields" || i.key === "choice-lists")).toBe(false);
    for (const p of ["settings/fields", "settings/choices"]) expect(ROUTES.filter((r) => r.path === p)).toHaveLength(1);
    expect(fieldsPart.routes.map((r) => r.path)).toEqual(["settings/fields", "settings/choices"]);
  });
});

describe("the tab an address opens", () => {
  const all = ["library", "types", "choices", "tables"] as const;
  const q = (s: string) => new URLSearchParams(s);
  it("?tab= wins; the studio's settings/fields?table=custom_03 opens «فیلدهای جدول‌ها»; ?list= «فهرست‌های گزینه»", () => {
    expect(tabOf(q("tab=types"), all)).toBe("types");
    expect(tabOf(q("table=custom_03"), all)).toBe("tables");
    expect(tabOf(q("list=todo.category"), all)).toBe("choices");
    expect(tabOf(q(""), all)).toBe("library");
  });
  it("a tab the person may not open falls back to one they may", () => {
    expect(tabOf(q("tab=tables"), ["library", "types"])).toBe("library");
    expect(tabOf(q("table=custom_03"), ["library", "types"])).toBe("library");
    expect(tabOf(q("tab=library"), [])).toBeNull();
  });
  it("settings/choices?list=… goes to the lists' tab with its list", () => {
    expect(choicesSearch("?list=todo.category")).toBe("?list=todo.category&tab=choices");
    expect(choicesSearch("")).toBe("?tab=choices");
  });
});

describe("the library: search, chips, usage", () => {
  const rows = [
    entry({ name: "u_national_id", label: "کد ملی", type: "national_id", type_label: "کد ملی", group: "bank", usage: { tables: ["incident", "todo"], forms: ["درخواست وام"], versions: [] } }),
    entry({ name: "u_amount", label: "مبلغ درخواستی", type: "money", type_label: "مبلغ", storage: "money", group: "money" }),
    entry({ name: "u_due", label: "تاریخ نیاز", type: "date", type_label: "تاریخ", storage: "date", group: "date", status: "retired" }),
    entry({ name: "u_branch", label: "شعبه", type: "unit", type_label: "واحد سازمانی", storage: "ref", group: "people" }),
  ];
  it("search reads Arabic letters and Persian digits as the same text; chips are any of their groups", () => {
    expect(filterLibrary(rows, { q: "كد ملي", chips: [], retired: false }).map((r) => r.name)).toEqual(["u_national_id"]);
    expect(filterLibrary(rows, { q: "", chips: ["money", "people"], retired: false }).map((r) => r.name)).toEqual(["u_amount", "u_branch"]);
    expect(filterLibrary(rows, { q: "", chips: [], retired: true }).map((r) => r.name)).toEqual(["u_due"]);
    expect(filterLibrary(rows, { q: "u_amo", chips: [], retired: false }).map((r) => r.name)).toEqual(["u_amount"]);
  });
  it("usage in words, and what retiring says", () => {
    expect(usageText(rows[0].usage)).toBe("۲ جدول، ۱ فرم");
    expect(usageText(rows[1].usage)).toBe("");
    expect(RETIRE_TEXT).toBe("در فرم‌ها و نسخه‌های تازه پیشنهاد نمی‌شود؛ جاهایی که به کار رفته می‌ماند.");
  });
  it("library fields a table may still take: active ones not on it", () => {
    expect(attachable(rows, "incident", new Set(["u_branch"])).map((r) => r.name)).toEqual(["u_amount"]);
  });
});

describe("types", () => {
  it("the picker offers built-in types this server has and the organisation's active ones, by group; a used field keeps its storage", () => {
    const choices = typeChoices(TYPES);
    expect(choices.some((c) => c.key === "position")).toBe(false);
    const opts = typeOptions(choices, TYPES.groups);
    expect(opts.map((g) => g.label)).toEqual(["متن", "متن (بانکی)", "مبلغ", "گزینه", "تاریخ", "ارجاع", "پیوست"]);
    expect(opts.flatMap((g) => g.options.map((o) => o.value))).not.toContain("u_old");
    expect(typeOptions(choices, TYPES.groups, { current: "u_old" }).flatMap((g) => g.options.map((o) => o.value))).toContain("u_old");
    const sameStorage = typeOptions(choices, TYPES.groups, { storage: "choice", current: "select" }).flatMap((g) => g.options.map((o) => o.value));
    expect(sameStorage.sort()).toEqual(["radio", "select", "u_leave_kind"]);
  });
  it("an organisation's type resolves on its base with its own settings; the tab lists it under its base's group", () => {
    const t = resolvedType("u_leave_kind", TYPES)!;
    expect(t).toMatchObject({ base: "choice", custom: true, group: "choice" });
    expect(t.settings.options?.[0].value).toBe("annual");
    expect(resolvedType("national_id", TYPES)?.settings.check).toBe("national_id");
    const rows = typeRows(TYPES);
    const i = rows.findIndex((r) => r.key === "u_leave_kind");
    expect(rows[i - 1].key).toBe("radio");
    expect(rows.find((r) => r.key === "money")?.id).toBeNull();
  });
  it("a built-in type's fixed settings in words", () => {
    expect(settingsLines(resolveFieldType("national_id")!)).toEqual(["بررسی کد ملی", "چپ‌به‌راست"]);
    expect(settingsLines(resolveFieldType("attachment")!)).toEqual(["تا ۵ پرونده"]);
    expect(settingsLines(resolveFieldType("money")!)).toEqual(["بی‌اعشار"]);
  });
});

describe("a library field's sheet", () => {
  it("sends only what its type allows, u_ before the name, options or a list for choice types", () => {
    const d = fieldDraft(null);
    Object.assign(d, { name: "amount", label: " مبلغ درخواستی ", type: "money", help: "", placeholder: "۰", default_value: "" });
    Object.assign(d.settings, { min: 0, max: 2_000_000_000, unit: "toman", maxLength: 12, pattern: "x" });
    const t = resolvedType("money", TYPES)!;
    expect(fieldDraftProblems(d, t)).toEqual({});
    const body = fieldPayload(d, t);
    expect(body).toMatchObject({ name: "u_amount", label: "مبلغ درخواستی", type: "money", options: null, choices: null, placeholder: "۰" });
    expect(body.validation).toEqual({ min: 0, max: 2_000_000_000, unit: "toman" });
    const choice = fieldDraft(null);
    Object.assign(choice, { name: "kind", label: "نوع", type: "select" });
    expect(fieldDraftProblems(choice, resolvedType("select", TYPES))).toMatchObject({ options: "دست‌کم یک گزینه بیفزایید" });
    choice.settings.options = [{ value: " a ", label: "" }, { value: "", label: "x" }];
    expect(fieldPayload(choice, resolvedType("select", TYPES)!).options).toEqual([{ value: "a", label: "a", order: 1 }]);
    choice.settings.optionsMode = "list";
    choice.settings.choices = "todo.category";
    expect(fieldPayload(choice, resolvedType("select", TYPES)!)).toMatchObject({ options: null, choices: "todo.category" });
    // a field of an organisation's type that carries options may keep them
    const leave = fieldDraft({ id: "x", version: 1, type: "u_leave_kind", name: "u_leave", label: "مرخصی" });
    expect(leave.settings.optionsMode).toBe("inherit");
    expect(fieldDraftProblems(leave, resolvedType("u_leave_kind", TYPES))).toEqual({});
  });
  it("refuses a bad name and a reference without its table", () => {
    const d = fieldDraft(null);
    Object.assign(d, { name: "Bad-Name", label: "", type: "record" });
    expect(Object.keys(fieldDraftProblems(d, resolvedType("record", TYPES))).sort()).toEqual(["label", "name", "ref"]);
    expect(previewField(d, resolvedType("record", TYPES))).toBeNull();
  });
  it("previews the field the engine would build: the check of «کد ملی», money's own unit, the options", () => {
    const d = fieldDraft(null);
    Object.assign(d, { name: "nid", label: "کد ملی متقاضی", type: "national_id" });
    expect(previewField(d, resolvedType("national_id", TYPES))).toMatchObject({ name: "u_nid", type: "string", check: "national_id", ltr: true, custom: true });
    const m = fieldDraft(null);
    Object.assign(m, { name: "", label: "", type: "money" });
    m.settings.unit = "toman";
    expect(previewField(m, resolvedType("money", TYPES))).toMatchObject({ name: "u_preview", label: "پیش‌نمایش", type: "money", unit: "toman" });
  });
});

describe("an organisation's type's sheet", () => {
  it("sends the widget in its column, ltr and unit in `display`, the rest in `validation`", () => {
    const d = typeDraft(null, "string");
    Object.assign(d, { key: "personnel_code", name: "کد پرسنلی", widget: "input" });
    Object.assign(d.settings, { pattern: "^\\d{6}$", patternMessage: "شش رقم", ltr: true, maxLength: 6 });
    expect(typeDraftProblems(d)).toEqual({});
    expect(typePayload(d)).toEqual({
      key: "u_personnel_code", name: "کد پرسنلی", base: "string", widget: "input", validation: { maxLength: 6, pattern: "^\\d{6}$", patternMessage: "شش رقم" }, display: { ltr: true }, options: null, choices: null, description: null,
    });
    expect(draftType(d)?.settings).toMatchObject({ widget: "input", pattern: "^\\d{6}$", ltr: true });
    const bad = typeDraft(null, "string");
    Object.assign(bad, { key: "", name: " ", widget: "switch" });
    expect(Object.keys(typeDraftProblems(bad)).sort()).toEqual(["key", "name"]);
    expect(typePayload(bad).widget).toBeNull();
  });
});

describe("«فیلدهای جدول‌ها»", () => {
  const base = tableDef("todo")!;
  const eff: Pick<TableDef, "fields"> = {
    fields: [
      ...base.fields.map((f) => (f.name === "estimate" ? { ...f, formHidden: true } : f.name === "due_at" ? { ...f, formRequired: "agents" as const, label: "سررسید کار" } : f)),
      { name: "u_branch", label: "شعبه", type: "ref", ref: "org_unit", custom: true, library: "u_branch" },
      { name: "u_note", label: "یادداشت", type: "string", custom: true },
    ],
  };
  const rows = [
    { id: "r1", version: 1, name: "u_note", label: "یادداشت", type: "string", active: true, max_length: 40 },
    { id: "r2", version: 1, name: "u_gone", label: "خاموش", type: "string", active: false },
    { id: "r3", version: 1, name: "u_branch", label: "شعبه", type: "ref", library_id: "lib1", active: true },
  ];
  const list = tableFieldRows(eff, base, rows);
  const row = (n: string) => list.find((r) => r.name === n)!;

  it("lists every field of the form — form-hidden ones too — but no module-internal or base column, then switched-off ones", () => {
    expect(list.some((r) => r.name === "workspace_id" || r.name === "number" || r.name === "created_at")).toBe(false);
    expect(row("estimate")).toMatchObject({ kind: "module", formHidden: true });
    expect(row("u_branch").kind).toBe("library");
    expect(row("u_note")).toMatchObject({ kind: "table", row: rows[0] });
    expect(list[list.length - 1]).toMatchObject({ name: "u_gone", active: false });
    expect(row("due_at")).toMatchObject({ defaultLabel: "موعد", formRequired: "agents" });
  });
  it("locked fields carry their reasons, and are neither hidden nor required — as the server refuses", () => {
    const short = row("short_description");
    expect(short.locks.map((l) => l.label)).toEqual(["شناسهٔ رکورد", "الزامی در ماژول", "پایهٔ جست‌وجوی هوشمند"]);
    expect(hideBlocker(short)).toBe("قفل است: شناسهٔ رکورد، الزامی در ماژول، پایهٔ جست‌وجوی هوشمند");
    expect(requireBlocker(short)).toMatch(/^قفل است/);
    expect(lockRefusal(base, "short_description", "hide")).toMatch(/شناسهٔ رکورد/);
    expect(row("u_note").locks).toEqual([]);
  });
  it("a hidden field cannot be required, a required one cannot be hidden; a switched-off field neither", () => {
    expect(hideBlocker(row("estimate"))).toBeNull();
    expect(requireBlocker(row("estimate"))).toBe("در فرم پنهان است؛ نخست آن را در فرم نمایش دهید");
    expect(hideBlocker(row("due_at"))).toBe("الزامی است؛ نخست الزام را بردارید");
    expect(requirementText(row("due_at"))).toBe("الزامی برای کارشناسان");
    expect(requirementText(row("short_description"))).toBe("الزامی در ماژول");
    expect(hideBlocker(row("u_gone"))).toBe("این فیلد خاموش است");
  });
});

describe("«افزودن به کتابخانه»", () => {
  const r = (p: Record<string, unknown>) => ({ id: "r", version: 1, name: "u_x", label: "ایکس", ...p });
  it("keeps the storage: a text's length, a unit's or a record's target, a choice's own options or list", () => {
    expect(promoteBody(r({ type: "string", max_length: 20, search: true }))).toEqual({
      body: { name: "u_x", label: "ایکس", type: "string", help: null, options: null, choices: null, validation: { maxLength: 20 }, field_group: null, list: false, search: true, filter: false },
    });
    expect((promoteBody(r({ type: "ref", ref: "org_unit" })) as { body: Record<string, unknown> }).body).toMatchObject({ type: "unit", validation: null });
    expect((promoteBody(r({ type: "refs", ref: "incident" })) as { body: Record<string, unknown> }).body).toMatchObject({ type: "records", validation: { ref: "incident" } });
    expect((promoteBody(r({ type: "choice", options: [{ value: "a", label: "الف" }] })) as { body: Record<string, unknown> }).body).toMatchObject({ type: "select", options: [{ value: "a", label: "الف", order: 1 }], choices: null });
    expect((promoteBody(r({ type: "multichoice", choices: "todo.category" })) as { body: Record<string, unknown> }).body).toMatchObject({ type: "multiselect", options: null, choices: "todo.category" });
    expect((promoteBody(r({ type: "bool" })) as { body: Record<string, unknown> }).body.type).toBe("switch");
  });
  it("refuses a library row, a module field's override and a storage the library has no type for", () => {
    expect(promoteBody(r({ type: "string", library_id: "l" }))).toEqual({ problem: "این فیلد از کتابخانه است" });
    expect(promoteBody(r({ name: "impact", type: "choice" }))).toEqual({ problem: "فقط فیلدهای سازمان (u_…) به کتابخانه افزوده می‌شوند" });
    expect("problem" in promoteBody(r({ type: "json" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The same payloads on F1's routes

describe("the screens' calls on a real organisation", () => {
  let e: EngineOrg;
  let P: string;
  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
  }, 600_000);

  it("a money field and a type made from the sheets' payloads; the library lists them with their usage", async () => {
    const types: TypesResult = await e.owner.get(`${P}/fields/types`);
    const d = fieldDraft(null);
    Object.assign(d, { name: "loan_amount", label: "مبلغ وام", type: "money" });
    Object.assign(d.settings, { max: 2_000_000_000, unit: "toman" });
    const made = await e.owner.post(`${P}/fields/library`, fieldPayload(d, resolvedType("money", types)!), 201);
    const td = typeDraft(null, "string");
    Object.assign(td, { key: "personnel_code", name: "کد پرسنلی" });
    Object.assign(td.settings, { pattern: "^\\d{6}$", patternMessage: "کد پرسنلی شش رقم است", ltr: true });
    await e.owner.post(`${P}/fields/types`, typePayload(td), 201);
    const after: TypesResult = await e.owner.get(`${P}/fields/types`);
    expect(resolvedType("u_personnel_code", after)?.settings).toMatchObject({ pattern: "^\\d{6}$", ltr: true, widget: "input" });
    const lib: { fields: LibraryEntry[] } = await e.owner.get(`${P}/fields/library`);
    expect(lib.fields.find((f) => f.id === made.row.id)).toMatchObject({ name: "u_loan_amount", storage: "money", group: "money", usage: { tables: [], forms: [], versions: [] } });
  });

  it("attached to a table, it is a library field of that table; a form-hidden field is listed and shown again", async () => {
    const lib: { fields: LibraryEntry[] } = await e.owner.get(`${P}/fields/library`);
    const amount = lib.fields.find((f) => f.name === "u_loan_amount")!;
    await e.owner.post(`${P}/fields/attach`, { table: "todo", field: amount.id, section: null }, 201);
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { estimate: { form_hidden: true } } });
    const meta = await e.owner.get(`${P}/meta/tables/todo`);
    const cf = await e.owner.get(`${P}/r/custom_field?size=500`);
    let list = tableFieldRows(meta.table, tableDef("todo"), cf.rows.filter((r: { table_key: string }) => r.table_key === "todo"));
    expect(list.find((r) => r.name === "u_loan_amount")).toMatchObject({ kind: "library", type: "money" });
    expect(list.find((r) => r.name === "estimate")).toMatchObject({ formHidden: true });
    expect((await e.owner.get(`${P}/fields/library`)).fields.find((f: LibraryEntry) => f.id === amount.id).usage.tables).toEqual(["todo"]);
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { estimate: { form_hidden: false } } });
    list = tableFieldRows((await e.owner.get(`${P}/meta/tables/todo`)).table, tableDef("todo"), []);
    expect(list.find((r) => r.name === "estimate")?.formHidden).toBe(false);
  });

  it("a locked field is refused with the reasons the chips show", async () => {
    const out = await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { short_description: { form_hidden: true } } }, 400);
    expect(out.error.message).toBe(lockRefusal(tableDef("todo")!, "short_description", "hide"));
  });

  it("«الزامی برای…» shows the creation paths a requirement binds and the ones it does not", async () => {
    const all = await e.owner.get(`${P}/fields/paths/incident?required_for=all`);
    const effect = (k: string) => all.effects.find((x: { path: { key: string } }) => x.path.key === k);
    expect(effect("record")).toMatchObject({ checked: true, text: "بررسی می‌شود" });
    expect(effect("email")).toMatchObject({ checked: false, text: "ثبت خودکار سامانه: بررسی نمی‌شود" });
    expect(all.blockers[0]).toMatch(/درگاه/);
    const agents = await e.owner.get(`${P}/fields/paths/incident?required_for=agents`);
    expect(agents.blockers).toEqual([]);
    expect(agents.effects.find((x: { path: { key: string } }) => x.path.key === "portal_report")).toMatchObject({ checked: false, text: "درخواست‌دهندگان: بررسی نمی‌شود" });
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { due_at: { required: true, required_for: "agents" } } });
    const meta = await e.owner.get(`${P}/meta/tables/todo`);
    expect(tableFieldRows(meta.table, tableDef("todo"), []).find((r) => r.name === "due_at")?.formRequired).toBe("agents");
  });

  it("a table-only field promoted to the library keeps its values", async () => {
    const R = `${P}/r`;
    const cf = (await e.owner.post(`${R}/custom_field`, { table_key: "todo", name: "u_ref_no", label: "شمارهٔ نامه", type: "string", max_length: 30, active: true })).row;
    // «موعد» is required for agents now (the test above), so the owner's write names it
    const todo = (await e.owner.post(`${R}/todo`, { short_description: "نامهٔ اداری", due_at: "2026-12-01T08:00:00.000Z", u_ref_no: "۱۲/۳۴۵" })).row;
    const p = promoteBody(cf);
    if (!("body" in p)) throw new Error(p.problem);
    const lib = await e.owner.post(`${P}/fields/library`, p.body, 201);
    await e.owner.patch(`${R}/custom_field/${cf.id}`, { library_id: lib.row.id, version: cf.version });
    const meta = await e.owner.get(`${P}/meta/tables/todo`);
    expect(tableFieldRows(meta.table, tableDef("todo"), []).find((r) => r.name === "u_ref_no")).toMatchObject({ kind: "library" });
    expect((await e.owner.get(`${R}/todo/${todo.id}`)).row.u_ref_no).toBe("۱۲/۳۴۵");
  });
});
