// «فرم‌ها» (design F §3.2, §3.3, §8.2, package F5; src/ui/modules/workflows/admin/forms): who is offered the page and
// its routes (the records module's «چیدمان فرم‌ها» gone, its old address kept), the list of every form (kinds, search,
// groups, words), the layout operations both designers share, undo and redo, a table's default form as a draft (its
// fields, locks and blockers, what saving sends and says, the preview's rights for «ثبت‌کننده» and «کارشناس»), a process
// form's draft (autosave, problems, palette, save state) and the steps that use it — and the same payloads on a real
// organisation: every row of GET /forms opens a route the UI registers, a default form saved and laid back to the
// module's, the preview's rights equal the server's, a process form autosaved and previewed at a step of a process.
import { describe, it, expect, beforeAll } from "vitest";
import { composeEffective, gateAllows, roleCatalog, type AccessGate, type FullGrant } from "@shared/access";
import { LEVEL_ORDER, type Level } from "@shared/permissions";
import { tableDef } from "@shared/tables";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import type { FieldDef, TableDef } from "@shared/model/types";
import { fieldItems, type FormLayoutV2 } from "@shared/forms/layout";
import { moneyUnitOf } from "@shared/forms/fieldtypes";
import { seedPortalDefaults } from "@server/modules/portal";
import { seedChangeDefaults } from "@server/modules/change";
import { seedRequestDefaults } from "@server/modules/request";
import { NAV, ROUTES } from "../src/ui/modules/registry";
import { formsPart } from "../src/ui/modules/workflows/admin/forms/routes";
import { fieldsAccess } from "../src/ui/modules/workflows/admin/fields/model";
import type { LibraryEntry } from "../src/ui/modules/workflows/admin/fields/api";
import { formsApi, type FormEntry, type FormOut, type FormPreview, type FormsList, type SystemPreview } from "../src/ui/modules/workflows/admin/forms/api";
import type { OrgApi } from "../src/ui/lib/api";
import {
  HISTORY_LIMIT, KIND_SHORT, PROCESS_GROUP, addSection, addTab, autoSpan, behaviourOf, changeText, clampSel, draftProblems, filterForms, findField, groupRows,
  hideBlocker, historyOf, historyPush, historyRedo, historyReplace, historyUndo, insertItem, kindOf, libraryDef, moveItem, oldLayoutTarget, paletteFields, previewTable,
  processDraft, processPatch, reconcileDraft, removeSection, requireBlocker, rightsSummary, saveStateText, sectionList, shiftItem, statusText, stepsUsing,
  systemChanges, systemDraft, systemFields, systemProblems, systemRights, typingKey, unplaced, updateSection, usedText, withBehaviour, type SystemDraft,
} from "../src/ui/modules/workflows/admin/forms/model";
import { confirmLeave, historyGuard, holdLeave, type HistoryHost } from "../src/ui/modules/workflows/admin/forms/leave";
import type { TableMeta } from "../src/ui/records/model/types";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";

// ---------------------------------------------------------------------------------------------------------------
// helpers

const catalog = roleCatalog([]);
const grantsOf = (...roles: string[]) => composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog }).grants;
const DESIGNER: Record<string, FullGrant> = { [PROCESS_DESIGN_AREA]: { read: "all", create: true, write: "all", delete: "none", approve: false, admin: false } };
const probe = (grants: Record<string, FullGrant>, settings: Level = "view", writable = true) => ({
  can: (_: "settings", level: Level) => LEVEL_ORDER.indexOf(settings) >= LEVEL_ORDER.indexOf(level),
  allows: (g: AccessGate) => gateAllows(grants, g),
  writable,
});

const entry = (p: Partial<FormEntry> & { key: string; kind: FormEntry["kind"]; name: string; group: string }): FormEntry => ({
  table: null, id: null, fields: 0, used_in: [], updated_at: null, link: "", editable: true, ...p,
});
const lib = (p: Partial<LibraryEntry> & { name: string; label: string }): LibraryEntry => ({
  id: p.name, type: "string", type_label: "متن کوتاه", storage: "string", group: "text", field_group: null, status: "active", help: null, placeholder: null,
  usage: { tables: [], forms: [], versions: [] }, ...p,
});
const L = (...sections: { label?: string | null; items: FormLayoutV2["tabs"][number]["sections"][number]["items"] }[]): FormLayoutV2 => ({
  tabs: [{ label: "جزئیات", sections: sections.map((s) => ({ label: s.label ?? null, items: s.items })) }],
});
const names = (l: FormLayoutV2) => l.tabs.map((t) => t.sections.map((s) => s.items.map((i) => ("field" in i ? i.field : `«${i.text}»`))));
/** A route the UI registers for an org-relative path (`:param` segments match anything). */
const routed = (path: string) => {
  const parts = path.split("?")[0].split("/");
  return ROUTES.some((r) => {
    const p = r.path.split("/");
    return p.length === parts.length && p.every((seg, i) => seg.startsWith(":") || seg === parts[i]);
  });
};
const NO_DOT_BEFORE_DIGIT = /·\s*[۰-۹0-9]/;
/** The UI's organisation client over a test client (the pages' own calls, on the in-memory server). */
const orgApiOf = (c: Client, P: string) =>
  ({
    get: (path: string, q?: Record<string, string>) => c.get(`${P}${path}${q ? `?${new URLSearchParams(q)}` : ""}`),
    post: (path: string, body?: unknown) => c.post(`${P}${path}`, body),
    put: (path: string, body?: unknown) => c.put(`${P}${path}`, body),
    patch: (path: string, body?: unknown) => c.patch(`${P}${path}`, body),
    del: (path: string) => c.del(`${P}${path}`),
  }) as unknown as OrgApi;

// ---------------------------------------------------------------------------------------------------------------

describe("who is offered «فرم‌ها», and where it lives", () => {
  it("the row is in «فرم‌ها و گردش‌کارها» for «طراحی فرم و گردش‌کار»; the module serves the list and both designers", () => {
    const row = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).find((i) => i.key === "workflows:forms")!;
    expect(row).toMatchObject({ label: "فرم‌ها", path: "settings/forms", group: "فرم‌ها و گردش‌کارها", access: { area: PROCESS_DESIGN_AREA } });
    expect([row.access].flat().every((g) => gateAllows(DESIGNER, g!))).toBe(true);
    for (const r of ["agent", "requester"]) expect([row.access].flat().every((g) => gateAllows(grantsOf(r), g!))).toBe(false);
    expect(formsPart.routes.map((r) => r.path)).toEqual(["settings/forms", "settings/forms/t/:table", "settings/forms/:id"]);
    for (const p of formsPart.routes.map((r) => r.path)) expect(ROUTES.filter((r) => r.path === p)).toHaveLength(1);
    // the records module's «چیدمان فرم‌ها» is gone
    expect(NAV.flatMap((g) => g.items).some((i) => i.key === "form-layouts")).toBe(false);
  });

  it("designers design process forms and read the tables' forms; `settings` editors change those; auditors read", () => {
    expect(fieldsAccess(probe(DESIGNER))).toMatchObject({ designRead: true, designWrite: true, settingsEdit: false });
    expect(fieldsAccess(probe(grantsOf("tenant_admin"), "full"))).toMatchObject({ designRead: true, designWrite: true, settingsEdit: true });
    const auditor = fieldsAccess(probe(grantsOf("auditor")));
    expect(auditor.designRead && !auditor.designWrite && !auditor.settingsEdit).toBe(true);
    expect(fieldsAccess(probe(grantsOf("agent"))).designRead).toBe(false);
    // a read-only organisation is offered no writes
    expect(fieldsAccess(probe(grantsOf("tenant_admin"), "full", false))).toMatchObject({ designWrite: false, settingsEdit: false });
  });

  it("the old address of the layout editor (the studio's link) opens that table's form", () => {
    expect(oldLayoutTarget("?table=todo")).toBe("settings/forms/t/todo");
    expect(oldLayoutTarget("?table=custom_03&x=1")).toBe("settings/forms/t/custom_03");
    expect(oldLayoutTarget("")).toBeNull();
    expect(oldLayoutTarget("?table=../admin")).toBeNull();
  });
});

describe("the list of every form", () => {
  const forms = [
    entry({ key: "system:incident", kind: "system", name: "رخدادها", table: "incident", group: "رخدادها", fields: 30, overrides: 3, arranged: true, used_in: ["درگاه اصلی: گزارش مشکل"], link: "settings/forms/t/incident" }),
    entry({ key: "process:f1", kind: "process", name: "درخواست تنخواه", group: PROCESS_GROUP, status: "published", version: 2, used_in: ["تنخواه شعبه", "خرید کالا", "مرخصی"], link: "settings/forms/f1" }),
    entry({ key: "portal_report:p1", kind: "portal_report", name: "گزارش مشکل", table: "incident", group: "رخدادها", status: "فعال", note: "فرم پیش‌فرض درگاه (رخداد)", link: "portal-admin/portals/p1" }),
    entry({ key: "system:todo", kind: "system", name: "کارها", table: "todo", group: "کارها", link: "settings/forms/t/todo" }),
    entry({ key: "process:f2", kind: "process", name: "فرم مرخصی", group: PROCESS_GROUP, status: "draft", link: "settings/forms/f2" }),
  ];

  it("a kind chip and a search narrow it (the table's name too, Arabic letters as Persian)", () => {
    expect(kindOf(new URLSearchParams("kind=process"), ["system", "process"])).toBe("process");
    expect(kindOf(new URLSearchParams("kind=survey"), ["system", "process"])).toBeNull();
    expect(filterForms(forms, { kind: "process", q: "" }).map((f) => f.key)).toEqual(["process:f1", "process:f2"]);
    expect(filterForms(forms, { kind: null, q: "مرخصي" }).map((f) => f.key)).toEqual(["process:f2"]);
    expect(filterForms(forms, { kind: "system", q: "تیکت" }, (k) => (k === "incident" ? "تیکت‌ها" : k)).map((f) => f.key)).toEqual(["system:incident"]);
  });

  it("is grouped by module with the process forms last, in a group of their own; a group shows the system form before the other kinds", () => {
    // the automation flows' tables keep their area «گردش‌کارها»: never one group with the process forms
    const rows = groupRows([...forms, entry({ key: "system:flow", kind: "system", name: "گردش‌کارها", table: "flow", group: "گردش‌کارها", link: "settings/forms/t/flow" })]);
    expect(rows.filter((r) => r.type === "group").map((r) => (r.type === "group" ? `${r.label}:${r.count}` : ""))).toEqual(["رخدادها:2", "کارها:1", "گردش‌کارها:1", `${PROCESS_GROUP}:2`]);
    expect(rows.map((r) => r.key).slice(0, 3)).toEqual(["group:رخدادها", "system:incident", "portal_report:p1"]);
  });

  it("says what changed, where a form is used and its state, never with a dot beside a figure", () => {
    expect(changeText(forms[0])).toBe("۳ تغییر، چیدمان سازمان");
    expect(changeText(forms[1])).toBe("");
    expect(usedText(forms[1].used_in)).toBe("تنخواه شعبه، خرید کالا و ۱ مورد دیگر");
    expect(statusText(forms[1])).toBe("منتشرشده، نسخهٔ ۲");
    expect(statusText(forms[4])).toBe("پیش‌نویس");
    expect(statusText(forms[2])).toBe("فعال");
    expect(KIND_SHORT.portal_report).toBe("درگاه");
    for (const t of [changeText(forms[0]), statusText(forms[1]), usedText(forms[1].used_in)]) expect(t).not.toMatch(NO_DOT_BEFORE_DIGIT);
  });
});

describe("the layout operations both designers share", () => {
  it("an item goes into the selected section, or a first tab and section are made for it", () => {
    const r = insertItem({ tabs: [] }, { field: "u_a" }, { t: 0, s: 0 });
    expect(names(r.layout)).toEqual([[["u_a"]]]);
    expect(r.sel).toEqual({ kind: "item", t: 0, s: 0, i: 0 });
    const two = L({ label: "یک", items: [{ field: "u_a" }] }, { label: "دو", items: [] });
    expect(insertItem(two, { text: "یادداشت" }, { t: 0, s: 1 }).sel).toEqual({ kind: "item", t: 0, s: 1, i: 0 });
  });

  it("moves an item within its section, to another one, and one step at a time across sections (Alt+↑/↓)", () => {
    const l = L({ label: "یک", items: [{ field: "u_a" }, { field: "u_b" }, { field: "u_c" }] }, { label: "دو", items: [{ field: "u_d" }] });
    expect(names(moveItem(l, { t: 0, s: 0, i: 0 }, { t: 0, s: 0, i: 2 }).layout)[0][0]).toEqual(["u_b", "u_a", "u_c"]);
    expect(names(moveItem(l, { t: 0, s: 0, i: 2 }, { t: 0, s: 0, i: 0 }).layout)[0][0]).toEqual(["u_c", "u_a", "u_b"]);
    const across = moveItem(l, { t: 0, s: 0, i: 1 }, { t: 0, s: 1 });
    expect(names(across.layout)[0]).toEqual([["u_a", "u_c"], ["u_d", "u_b"]]);
    expect(across.sel).toEqual({ kind: "item", t: 0, s: 1, i: 1 });
    // the last item of a section steps into the next one's start; the first of the next back to the end
    const down = shiftItem(l, { t: 0, s: 0, i: 2 }, 1);
    expect(names(down.layout)[0]).toEqual([["u_a", "u_b"], ["u_c", "u_d"]]);
    expect(down.sel).toEqual({ kind: "item", t: 0, s: 1, i: 0 });
    expect(names(shiftItem(down.layout, { t: 0, s: 1, i: 0 }, -1).layout)[0]).toEqual([["u_a", "u_b", "u_c"], ["u_d"]]);
    // nowhere further up from the very first item
    expect(shiftItem(l, { t: 0, s: 0, i: 0 }, -1).layout).toBe(l);
    expect(findField(l, "u_d")).toEqual({ t: 0, s: 1, i: 0 });
    expect(sectionList(l).map((s) => s.label)).toEqual(["جزئیات › یک", "جزئیات › دو"]);
  });

  it("tabs and sections: names for new ones, columns, removal with the selection kept on what is left", () => {
    const a = addTab({ tabs: [] });
    expect(a.layout.tabs[0].label).toBe("جزئیات");
    const b = addTab(a.layout);
    expect(b.layout.tabs[1].label).toBe("زبانهٔ تازه");
    const c = addSection(b.layout, 0);
    expect(c.sel).toEqual({ kind: "section", t: 0, s: 1 });
    expect(updateSection(c.layout, 0, 1, { columns: 1 }).tabs[0].sections[1].columns).toBe(1);
    expect(updateSection(c.layout, 0, 1, { label: "  " }).tabs[0].sections[1].label).toBeNull();
    const gone = removeSection(c.layout, 0, 1);
    expect(clampSel(gone, { kind: "section", t: 0, s: 1 })).toEqual({ kind: "section", t: 0, s: 0 });
    expect(clampSel(gone, { kind: "item", t: 0, s: 0, i: 3 })).toEqual({ kind: "section", t: 0, s: 0 });
  });

  it("an item's behaviours exclude each other; its width defaults as the form shows it", () => {
    const i = withBehaviour({ field: "u_a", hidden: true, label: "x" }, "required");
    expect(i).toEqual({ field: "u_a", label: "x", required: true });
    expect(behaviourOf(i)).toBe("required");
    expect(withBehaviour(i, "normal")).toEqual({ field: "u_a", label: "x" });
    expect([autoSpan("string", 2), autoSpan("text", 2), autoSpan("string", 1)]).toEqual([12, 24, 24]);
  });

  it("typing on in one box is one step of undo: only a typed text, one property at a time", () => {
    expect(typingKey("item:0:0:1", { field: "u_a", label: "مب" }, { field: "u_a", label: "مبل" })).toBe("item:0:0:1:label");
    expect(typingKey("item:0:0:1", { field: "u_a" }, { field: "u_a", help: "x" })).toBe("item:0:0:1:help");
    expect(typingKey("item", { field: "u_a" }, { field: "u_a", required: true })).toBeUndefined();
    expect(typingKey("field:x", { label: "a", hidden: false }, { label: "b", hidden: true })).toBeUndefined();
    expect(typingKey("field:x", { requiredFor: null }, { requiredFor: "all" })).toBeUndefined();
    const h = historyPush(historyOf("a"), "ab");
    expect(historyReplace(h, "abc")).toEqual({ past: ["a"], present: "abc", future: [] });
    expect(historyReplace(h, "ab")).toBe(h);
  });

  it("undo and redo: the same value changes nothing, a new one drops what was undone, the past is capped", () => {
    let h = historyOf(1);
    expect(historyPush(h, 1)).toBe(h);
    h = historyPush(historyPush(h, 2), 3);
    h = historyUndo(h);
    expect(h.present).toBe(2);
    expect(historyRedo(h).present).toBe(3);
    h = historyPush(h, 9);
    expect(h.future).toEqual([]);
    for (let n = 0; n < HISTORY_LIMIT + 20; n++) h = historyPush(h, 100 + n);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("a table's default form", () => {
  const todo = tableDef("todo")!;
  const withCustom: TableDef = {
    ...todo,
    fields: [
      ...todo.fields,
      { name: "u_branch", label: "شعبه", type: "string", custom: true } as FieldDef,
      { name: "u_amount", label: "مبلغ", type: "money", custom: true, library: "lib1", group: "financial" } as FieldDef,
    ],
  };
  const fields = systemFields(withCustom, todo);
  const at = (n: string) => fields.find((f) => f.name === n)!;

  it("lists the fields the form arranges, each with where it comes from, its locks and what the module requires", () => {
    expect(fields.some((f) => f.name === "number" || f.name === "state" || f.name === "opened_at")).toBe(false);
    expect(at("short_description")).toMatchObject({ kind: "module", moduleRequired: true });
    expect(at("short_description").locks.map((l) => l.reason)).toContain("identity");
    expect(at("estimate")).toMatchObject({ kind: "module", locks: [], moduleRequired: false, defaultLabel: "برآورد (ساعت)" });
    expect(at("u_branch")).toMatchObject({ kind: "table", locks: [], section: null });
    expect(at("u_amount")).toMatchObject({ kind: "library", group: "financial" });
  });

  it("starts from the form as laid out today: the module's layout, or the organisation's arrangement", () => {
    const d = systemDraft(withCustom, fields);
    expect(d.arranged).toBe(false);
    expect(fieldItems(d.layout).map((i) => i.field)).toEqual(fields.map((f) => f.name));
    const arranged = systemDraft({ ...withCustom, form: { arrangement: { tabs: [{ label: "اصلی", sections: [{ label: "شعبه", fields: ["estimate", "short_description"] }] }] } } }, fields);
    expect(arranged.arranged).toBe(true);
    expect(arranged.layout.tabs[0].sections[0].items.slice(0, 2)).toEqual([{ field: "estimate" }, { field: "short_description" }]);
  });

  it("a field added while designing goes to the section of its name; one removed leaves; edits stay", () => {
    const base = systemDraft(todo, systemFields(todo, todo));
    const edited: SystemDraft = { ...base, layout: addSection(base.layout, 0).layout, fields: { ...base.fields, estimate: { ...base.fields.estimate, label: "زمان" } } };
    edited.layout.tabs[0].sections[1].label = "شعبه";
    // a field of the organisation's that names its section («بخش فرم» when it was added)
    const sectioned = systemFields({ ...withCustom, fields: withCustom.fields.map((f) => (f.name === "u_branch" ? { ...f, section: "شعبه" } : f)) }, todo);
    const next = reconcileDraft(edited, sectioned.filter((f) => f.name !== "tags"));
    expect(findField(next.layout, "u_branch")).toEqual({ t: 0, s: 1, i: 0 });
    expect(findField(next.layout, "u_amount")?.s).toBe(0);
    expect(findField(next.layout, "tags")).toBeNull();
    expect(next.fields.estimate.label).toBe("زمان");
    expect("tags" in next.fields).toBe(false);
  });

  it("fields of a removed section wait in «فیلدهای بی‌جا»", () => {
    const d = systemDraft(todo, systemFields(todo, todo));
    const two = moveItem(addSection(d.layout, 0).layout, { t: 0, s: 0, i: 0 }, { t: 0, s: 1 }).layout;
    expect(unplaced({ ...d, layout: removeSection(two, 0, 1) }, systemFields(todo, todo)).map((f) => f.name)).toEqual(["short_description"]);
  });

  it("offers neither «پنهان در فرم» nor «الزامی برای…» where the server refuses them, with the same reasons", () => {
    const d = systemDraft(withCustom, fields);
    expect(hideBlocker(at("short_description"), d.fields.short_description)).toMatch(/^قفل است: /);
    expect(requireBlocker(at("caller_id"), d.fields.caller_id)).toMatch(/پایهٔ دسترسی/);
    expect(hideBlocker(at("estimate"), { ...d.fields.estimate, requiredFor: "agents" })).toBe("الزامی است؛ نخست الزام را بردارید");
    expect(requireBlocker(at("estimate"), { ...d.fields.estimate, hidden: true })).toBe("در فرم پنهان است؛ نخست آن را در فرم نمایش دهید");
    expect(hideBlocker(at("estimate"), d.fields.estimate)).toBeNull();
  });

  it("saving sends only what changed — never a library field's texts — and says it; going back to the module's layout sends null", () => {
    const d = systemDraft(withCustom, fields);
    expect(systemChanges(fields, d, d)).toEqual({ body: {}, lines: [], count: 0 });
    const moved = moveItem(addSection(d.layout, 0).layout, { t: 0, s: 0, i: 1 }, { t: 0, s: 1 }).layout;
    const edited: SystemDraft = {
      layout: moved,
      arranged: true,
      fields: {
        ...d.fields,
        estimate: { ...d.fields.estimate, label: "زمان لازم", hidden: true },
        tags: { ...d.fields.tags, requiredFor: "agents" },
        u_amount: { ...d.fields.u_amount, label: "عوض نمی‌شود", help: "نه" },
      },
    };
    const c = systemChanges(fields, d, edited);
    expect(c.body.fields).toEqual({ estimate: { label: "زمان لازم", form_hidden: true }, tags: { required: true, required_for: "agents" } });
    expect(c.body.arrangement?.tabs[0].sections.map((s) => s.fields.length)).toEqual([fields.length - 1, 1]);
    expect(c.lines).toEqual(["«برچسب‌ها» برای کارشناسان الزامی می‌شود", "برچسب «برآورد (ساعت)» ← «زمان لازم»", "«برآورد (ساعت)» در فرم پنهان می‌شود", "چیدمان: ۱ فیلد جای تازه دارد؛ بخش‌ها تغییر کرد"]);
    const back = systemChanges(fields, { ...edited, arranged: true }, { ...edited, arranged: false });
    expect(back.body).toEqual({ arrangement: null });
    expect(back.lines).toEqual(["چیدمان به پیش‌فرض ماژول برمی‌گردد"]);
    // a cleared label sends null (the module's own label comes back)
    expect(systemChanges(fields, edited, { ...edited, fields: { ...edited.fields, estimate: { ...edited.fields.estimate, label: "" } } }).body.fields).toEqual({ estimate: { label: null } });
  });

  it("a cleared text: a module field's own comes back, and the line says so; an organisation field keeps a label (F5-6)", () => {
    const inc = tableDef("incident")!;
    const moduleHelp = inc.fields.find((f) => f.name === "external_ref")!.help!;
    // the organisation's definition: its own help on «شناسهٔ بیرونی», and a field of its own
    const eff: TableDef = {
      ...inc,
      fields: [...inc.fields.map((f) => (f.name === "external_ref" ? { ...f, help: "شمارهٔ تیکت شرکت پشتیبان" } : f)), { name: "u_branch", label: "شعبه", type: "string", custom: true } as FieldDef],
    };
    const fs = systemFields(eff, inc);
    const d = systemDraft(eff, fs);
    const edit = (name: string, p: Partial<SystemDraft["fields"][string]>, from: SystemDraft = d): SystemDraft => ({ ...from, fields: { ...from.fields, [name]: { ...from.fields[name], ...p } } });
    expect(fs.find((f) => f.name === "external_ref")).toMatchObject({ kind: "module", help: "شمارهٔ تیکت شرکت پشتیبان", defaultHelp: moduleHelp });
    // the organisation's help cleared: the module's comes back (F1's overlay keeps no empty override) — null is sent, and said so
    const back = systemChanges(fs, d, edit("external_ref", { help: "" }));
    expect(back.body).toEqual({ fields: { external_ref: { help: null } } });
    expect(back.lines).toEqual(["راهنمای «شناسهٔ بیرونی» به متن ماژول برمی‌گردد"]);
    expect(previewTable({ ...eff, can: { read: true, create: true } } as TableMeta, edit("external_ref", { help: "" })).fields.find((f) => f.name === "external_ref")?.help).toBe(moduleHelp);
    // typing the module's own text again is the same
    expect(systemChanges(fs, d, edit("external_ref", { help: ` ${moduleHelp} ` })).body).toEqual({ fields: { external_ref: { help: null } } });
    // the module's own text cannot be cleared: emptying the box changes nothing, so nothing is sent or said
    const plain = systemFields(inc, inc);
    const atModule = systemDraft(inc, plain);
    expect(systemChanges(plain, atModule, edit("external_ref", { help: "" }, atModule))).toEqual({ body: {}, lines: [], count: 0 });
    // a help where the module has none is removed
    const told = edit("impact", { help: "اثر بر کار" });
    expect(systemChanges(fs, told, edit("impact", { help: "" }, told))).toMatchObject({ body: { fields: { impact: { help: null } } }, lines: ["راهنمای «اثر» برداشته شد"] });
    // an organisation field («فیلد همین جدول») keeps a label: an empty one holds the save and is never sent
    const unlabelled = edit("u_branch", { label: "  " });
    expect(systemProblems(fs, unlabelled)).toEqual({ u_branch: "برچسب را بنویسید" });
    expect(systemChanges(fs, d, unlabelled).body).toEqual({});
    expect(systemProblems(fs, d)).toEqual({});
    // its help cleared is removed: it has no module text to go back to
    const helped = edit("u_branch", { help: "نام شعبه" });
    expect(systemChanges(fs, helped, edit("u_branch", { help: "" }, helped))).toMatchObject({ body: { fields: { u_branch: { help: null } } }, lines: ["راهنمای «شعبه» برداشته شد"] });
  });

  it("the preview's rights for a viewpoint: hidden on the form, the module's and the binding requirements, field groups, engine fields", () => {
    const d = systemDraft(withCustom, fields);
    const draft: SystemDraft = { ...d, fields: { ...d.fields, tags: { ...d.fields.tags, hidden: true }, estimate: { ...d.fields.estimate, requiredFor: "agents" } } };
    const requester = systemRights(withCustom, fields, draft, { groups: [], scope: ["all"] });
    const agent = systemRights(withCustom, fields, draft, { groups: ["financial"], scope: ["all", "agents"] });
    expect([requester.tags, requester.short_description, requester.estimate, requester.u_amount, requester.approval]).toEqual(["hidden", "required", "edit", "hidden", "read"]);
    expect([agent.estimate, agent.u_amount]).toEqual(["required", "edit"]);
    expect(rightsSummary(requester)).toMatch(/^۱ الزامی، ۱ فقط‌خواندنی، ۲ پنهان$/);
    expect(rightsSummary(requester)).not.toMatch(NO_DOT_BEFORE_DIGIT);
  });

  it("the preview lays the form out as the draft would: its arrangement, labels and help", () => {
    const d = systemDraft(withCustom, fields);
    const shown = previewTable({ ...withCustom, can: { read: true, create: true } } as TableMeta, { ...d, fields: { ...d.fields, estimate: { ...d.fields.estimate, label: "زمان", help: "به ساعت" } } });
    expect(shown.form?.arrangement?.tabs[0].sections[0].fields).toEqual(fields.map((f) => f.name));
    expect(shown.fields.find((f) => f.name === "estimate")).toMatchObject({ label: "زمان", help: "به ساعت" });
  });
});

describe("leaving a page with unsaved changes (F5-3)", () => {
  /**
   * A stand-in window at history entry `at`, whose popstate listeners run in the order they were added (as Chromium
   * runs a window's own listeners): the guard, installed when the app loads, then the router.
   */
  const browser = (at: number) => {
    let state: { idx: number } = { idx: at };
    const listeners: ((e: Event) => void)[] = [];
    const moves: number[] = [];
    const host: HistoryHost = {
      history: { get state() { return state; }, go: (d: number) => void moves.push(d) },
      addEventListener: (_t, fn) => void listeners.push(fn),
    };
    const guard = historyGuard(host);
    const routed: number[] = [];
    host.addEventListener("popstate", () => routed.push(state.idx));
    /** the browser arrives at entry `to` */
    const pop = (to: number) => {
      state = { idx: to };
      let stopped = false;
      const e = { stopImmediatePropagation: () => void (stopped = true) } as unknown as Event;
      for (const l of [...listeners]) if (!stopped) l(e);
    };
    return { guard, pop, moves, routed };
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const asker = () => {
    const a = { asked: 0, answer: (_: boolean) => {} };
    const ask = () => {
      a.asked++;
      return new Promise<boolean>((r) => (a.answer = r));
    };
    return { a, ask };
  };

  it("Back is taken back before the router sees it; «stay» keeps the page, «leave» makes the move again for the router", async () => {
    const b = browser(5);
    const { a, ask } = asker();
    b.guard.hold(ask);
    b.pop(4);
    expect([b.routed, b.moves, a.asked]).toEqual([[], [1], 1]);
    b.pop(5); // the way back arrives: nobody else hears of it
    // Back again while the question is open: taken back, not asked twice
    b.pop(4);
    b.pop(5);
    expect([b.routed, b.moves, a.asked]).toEqual([[], [1, 1], 1]);
    a.answer(false);
    await settle();
    expect([b.routed, b.moves]).toEqual([[], [1, 1]]);
    // Forward is held the same way; «leave» lets it go
    b.pop(6);
    expect(a.asked).toBe(2);
    b.pop(5);
    a.answer(true);
    await settle();
    expect(b.moves).toEqual([1, 1, -1, 1]);
    b.pop(6);
    expect(b.routed).toEqual([6]);
  });

  it("«leave» given before the way back arrives waits for it; a released hold, or none, lets every move through", async () => {
    const b = browser(3);
    const { a, ask } = asker();
    const release = b.guard.hold(ask);
    b.pop(2);
    a.answer(true);
    await settle();
    expect(b.moves).toEqual([1]);
    b.pop(3);
    expect(b.moves).toEqual([1, -1]);
    b.pop(2);
    expect(b.routed).toEqual([2]);
    release();
    const c = browser(7);
    c.pop(6);
    c.guard.hold(ask)();
    c.pop(5);
    expect(c.routed).toEqual([6, 5]);
    expect(c.moves).toEqual([]);
  });

  it("the shell's menus and command palette ask the page that holds changes; without one they go at once", async () => {
    expect(await confirmLeave()).toBe(true);
    const { a, ask } = asker();
    const release = holdLeave(ask);
    const asked = confirmLeave();
    a.answer(false);
    expect(await asked).toBe(false);
    expect(a.asked).toBe(1);
    release();
    expect(await confirmLeave()).toBe(true);
    expect(a.asked).toBe(1);
  });
});

describe("a process form", () => {
  const saved: FormOut = {
    id: "f1", name: "درخواست تنخواه", description: null, status: "draft", version_no: 0, layout: L({ label: "درخواست", items: [{ field: "u_amount", required: true }] }),
    fields: ["u_amount"], published_at: null, changed: false, updated_at: "2026-11-14T10:00:00.000Z",
  };

  it("autosave sends what changed, compared as the server keeps it", () => {
    const d = processDraft(saved);
    expect(processPatch(saved, d)).toBeNull();
    // the server trims labels: a trailing space is no change
    expect(processPatch(saved, { ...d, layout: L({ label: "درخواست ", items: [{ field: "u_amount", required: true }] }) })).toBeNull();
    expect(processPatch(saved, { ...d, name: " فرم تنخواه " })).toEqual({ name: "فرم تنخواه" });
    expect(processPatch(saved, { ...d, name: "" })).toBeNull();
    const more = L({ label: "درخواست", items: [{ field: "u_amount", required: true }, { text: "پیوست را فراموش نکنید" }] });
    expect(processPatch(saved, { ...d, description: "شرح", layout: more })).toEqual({ description: "شرح", layout: more });
  });

  it("is not saved while the server would refuse it: no name, an unknown field, a retired one it did not hold", () => {
    const defOf = (n: string) => (["u_amount", "u_old"].includes(n) ? ({ name: n, label: n === "u_old" ? "کهنه" : "مبلغ", type: "money" } as FieldDef) : undefined);
    const d = { name: "", description: "", layout: L({ items: [{ field: "u_amount" }, { field: "u_old" }, { field: "u_ghost" }] }) };
    const p = draftProblems(d, defOf, new Set(["u_old"]), new Set(["u_amount"]));
    expect(p).toEqual(["نام فرم را بنویسید", "فیلد «کهنه» بازنشسته است و به فرم افزوده نمی‌شود", "فیلد «u_ghost» در کتابخانه نیست"]);
    expect(draftProblems({ ...d, name: "x", layout: L({ items: [{ field: "u_old" }] }) }, defOf, new Set(["u_old"]), new Set(["u_old"]))).toEqual([]);
  });

  it("the palette offers active library fields not on the form yet, by search", () => {
    const all = [lib({ name: "u_amount", label: "مبلغ" }), lib({ name: "u_reason", label: "علت" }), lib({ name: "u_old", label: "کهنه", status: "retired" }), lib({ name: "u_need", label: "تاریخ نیاز" })];
    expect(paletteFields(all, saved.layout, "").map((e) => e.name)).toEqual(["u_need", "u_reason"]);
    expect(paletteFields(all, saved.layout, "علت").map((e) => e.name)).toEqual(["u_reason"]);
    expect(libraryDef(all[1])).toEqual({ name: "u_reason", label: "علت", type: "string" });
  });

  it("the save state in words, never a dot before the minutes", () => {
    const at = "2026-11-14T10:00:00.000Z";
    const now = Date.parse("2026-11-14T10:02:10.000Z");
    expect(saveStateText("saved", at, now)).toBe("ذخیره شد، ۲ دقیقه پیش");
    expect(saveStateText("saving", at, now)).toBe("در حال ذخیره…");
    expect(saveStateText("pending", at, now)).toBe("تغییر ذخیره‌نشده");
    expect(saveStateText("invalid", at, now, 2)).toBe("۲ ایراد؛ ذخیره نمی‌شود");
    expect(saveStateText("error", at, now)).toBe("ذخیره نشد");
    expect(saveStateText("saved", at, now)).not.toMatch(NO_DOT_BEFORE_DIGIT);
  });

  it("finds the steps that use the form in processes' drafts and published versions, with their rights", () => {
    const step = (id: string, form: string, rights: object, label?: string) => ({ id, type: "form_step", config: { action: "approve", form, rights, assignees: [] }, ...(label ? { label } : {}) });
    const graph = { nodes: [{ id: "t", type: "trigger", config: {} }, step("s", "f1", { default: "edit", fields: {} }), step("a1", "f1", { default: "read", fields: { u_amount: "hidden" } }, "تأیید رئیس شعبه"), step("x", "f9", { default: "edit", fields: {} })], edges: [] };
    const steps = stepsUsing("f1", {
      processes: [{ id: "p1", version: 1, name: "تنخواه شعبه", draft: { graph }, current_version_id: "v1" }, { id: "p2", version: 1, name: "خرید", draft: graph }],
      versions: [{ id: "v1", version: 1, process_id: "p1", version_no: 2, graph, steps: { a1: { action: "approve", form: "f1", rights: { default: "read", fields: { u_amount: "edit" } } } } }],
    });
    expect(steps.map((s) => s.label)).toEqual(["تنخواه شعبه › تأیید", "تنخواه شعبه › تأیید رئیس شعبه", "خرید › تأیید", "خرید › تأیید رئیس شعبه", "تنخواه شعبه › تأیید رئیس شعبه (نسخهٔ ۲)"]);
    expect(steps[1].rights).toEqual({ default: "read", fields: { u_amount: "hidden" } });
    expect(steps[4]).toMatchObject({ key: "p1:نسخهٔ ۲:a1", source: "version", rights: { default: "read", fields: { u_amount: "edit" } } });
    // a published step its draft holds unchanged is listed once
    expect(stepsUsing("f1", { processes: [{ id: "p1", version: 1, name: "تنخواه شعبه", draft: { graph } }], versions: [{ id: "v1", version: 1, process_id: "p1", version_no: 1, graph, steps: {} }] })).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The same payloads on F1's and F2's routes

describe("the screens' calls on a real organisation", () => {
  let e: EngineOrg;
  let P: string;
  const meta = async (t: string): Promise<TableMeta> => (await e.owner.get(`${P}/meta/tables/${t}`)).table;
  const draftOf = async (t: string) => {
    const def = await meta(t);
    const fields = systemFields(def, tableDef(t));
    return { def, fields, draft: systemDraft(def, fields) };
  };

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    await seedRequestDefaults(e.cfg, e.org);
    await seedPortalDefaults(e.cfg, e.org);
    await seedChangeDefaults(e.cfg, e.org);
    await e.owner.post(`${P}/fields/library`, { name: "u_amount", label: "مبلغ درخواستی", type: "money", validation: { unit: "toman" } }, 201);
    await e.owner.post(`${P}/fields/library`, { name: "u_reason", label: "علت", type: "text" }, 201);
    await e.owner.post(`${P}/fields/library`, { name: "u_pay", label: "شیوهٔ پرداخت", type: "radio", options: [{ value: "cash", label: "نقد" }, { value: "card", label: "کارت" }] }, 201);
  }, 900_000);

  it("«فرم‌ها» lists every kind, and every row opens a route the UI registers", async () => {
    const all: FormsList = await e.owner.get(`${P}/forms`);
    const kinds = new Set(all.forms.map((f) => f.kind));
    for (const k of ["system", "catalog", "portal_report", "risk"] as const) expect(kinds.has(k)).toBe(true);
    expect(all.kinds.filter((k) => k.available).map((k) => k.key)).toEqual(["system", "process", "catalog", "portal_report", "survey", "risk"]);
    const broken = all.forms.filter((f) => !routed(f.link)).map((f) => `${f.kind}:${f.link}`);
    expect(broken).toEqual([]);
    expect(all.forms.find((f) => f.key === "system:todo")?.link).toBe("settings/forms/t/todo");
    // the list groups them with the process forms last
    const made = (await e.owner.post(`${P}/forms`, { name: "فرم نمونه" }, 201)).form as FormOut;
    const rows = groupRows((await e.owner.get(`${P}/forms`)).forms as FormEntry[]);
    expect(rows.filter((r) => r.type === "group").at(-1)).toMatchObject({ label: PROCESS_GROUP, count: 1 });
    expect(routed(`settings/forms/${made.id}`)).toBe(true);
  });

  it("a table's default form saved from the designer's draft: labels, «پنهان در فرم», a requirement and the arrangement, then the module's layout again", async () => {
    const { fields, draft } = await draftOf("todo");
    const layout = moveItem(addSection(draft.layout, 0).layout, { t: 0, s: 0, i: fields.findIndex((f) => f.name === "estimate") }, { t: 0, s: 1 }).layout;
    layout.tabs[0].sections[1].label = "برآورد";
    const edited: SystemDraft = {
      layout,
      arranged: true,
      fields: { ...draft.fields, estimate: { ...draft.fields.estimate, label: "زمان لازم" }, tags: { ...draft.fields.tags, hidden: true }, due_at: { ...draft.fields.due_at, requiredFor: "agents" } },
    };
    const c = systemChanges(fields, draft, edited);
    await e.owner.put(`${P}/forms/system/todo/overrides`, c.body);
    const after = await draftOf("todo");
    expect(after.draft.arranged).toBe(true);
    expect(after.draft.layout.tabs[0].sections[1]).toEqual({ label: "برآورد", items: [{ field: "estimate" }] });
    expect(after.draft.fields.estimate.label).toBe("زمان لازم");
    expect(after.draft.fields.tags.hidden).toBe(true);
    expect(after.draft.fields.due_at.requiredFor).toBe("agents");
    // what the server keeps is what was drafted: nothing left to save
    expect(systemChanges(after.fields, after.draft, edited).count).toBe(0);
    // «پیش‌فرض»: the module's layout again
    const back = systemChanges(after.fields, after.draft, { ...after.draft, arranged: false });
    await e.owner.put(`${P}/forms/system/todo/overrides`, back.body);
    expect((await meta("todo")).form?.arrangement).toBeFalsy();
  });

  it("a module field's help the organisation set, then cleared, is the module's again — as the line said; an organisation field's empty label is refused (F5-6)", async () => {
    const set = await draftOf("incident");
    const own: SystemDraft = { ...set.draft, fields: { ...set.draft.fields, external_ref: { ...set.draft.fields.external_ref, help: "شمارهٔ تیکت شرکت پشتیبان" } } };
    await e.owner.put(`${P}/forms/system/incident/overrides`, systemChanges(set.fields, set.draft, own).body);
    const saved = await draftOf("incident");
    expect(saved.draft.fields.external_ref.help).toBe("شمارهٔ تیکت شرکت پشتیبان");
    const cleared: SystemDraft = { ...saved.draft, fields: { ...saved.draft.fields, external_ref: { ...saved.draft.fields.external_ref, help: "" } } };
    const c = systemChanges(saved.fields, saved.draft, cleared);
    expect(c.lines).toEqual(["راهنمای «شناسهٔ بیرونی» به متن ماژول برمی‌گردد"]);
    await e.owner.put(`${P}/forms/system/incident/overrides`, c.body);
    const after = await draftOf("incident");
    expect(after.draft.fields.external_ref.help).toBe(tableDef("incident")!.fields.find((f) => f.name === "external_ref")!.help);
    // what the server keeps is what the draft showed: nothing left to save
    expect(systemChanges(after.fields, after.draft, cleared).count).toBe(0);
    // the server refuses an organisation field's empty label — with the whole save — so the designer holds it instead
    await e.owner.post(`${P}/r/custom_field`, { table_key: "todo", name: "u_room", label: "اتاق", type: "string", active: true });
    const todo = await draftOf("todo");
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { u_room: { label: null }, estimate: { help: "به ساعت" } } }, 400);
    expect((await draftOf("todo")).draft.fields.estimate.help).toBe("");
    const unlabelled: SystemDraft = { ...todo.draft, fields: { ...todo.draft.fields, u_room: { ...todo.draft.fields.u_room, label: "" } } };
    expect(systemProblems(todo.fields, unlabelled)).toEqual({ u_room: "برچسب را بنویسید" });
    expect(systemChanges(todo.fields, todo.draft, unlabelled).body).toEqual({});
  });

  it("a requirement the server refuses is refused for the reason the designer shows; a locked field cannot be hidden", async () => {
    const paths = await e.owner.get(`${P}/fields/paths/incident?required_for=all`);
    expect(paths.blockers.length).toBeGreaterThan(0);
    const r = await e.owner.put(`${P}/forms/system/incident/overrides`, { fields: { category: { required: true, required_for: "all" } } }, 400);
    expect(r.error.message).toContain("الزام برای «همه» ثبت نمی‌شود");
    const { fields, draft } = await draftOf("incident");
    const caller = fields.find((f) => f.name === "caller_id")!;
    expect(hideBlocker(caller, draft.fields.caller_id)).toMatch(/پایهٔ دسترسی/);
    await e.owner.put(`${P}/forms/system/incident/overrides`, { fields: { caller_id: { form_hidden: true } } }, 400);
  });

  it("the preview's rights for «ثبت‌کننده» and «کارشناس» equal the server's preview of the stored form", async () => {
    await e.owner.put(`${P}/forms/system/todo/overrides`, { fields: { tags: { form_hidden: true }, estimate: { required: true, required_for: "agents" } } });
    const { def, fields, draft } = await draftOf("todo");
    for (const as of ["requester", "agent"]) {
      const server: SystemPreview = await e.owner.get(`${P}/forms/system/todo/preview?as=${as}`);
      const mine = systemRights(def, fields, draft, server.as);
      for (const f of fields) expect(`${as}:${f.name}:${mine[f.name]}`).toBe(`${as}:${f.name}:${server.rights[f.name]}`);
    }
    const agent: SystemPreview = await e.owner.get(`${P}/forms/system/todo/preview?as=agent`);
    expect([agent.rights.tags, agent.rights.estimate]).toEqual(["hidden", "required"]);
    expect((await e.owner.get(`${P}/forms/system/todo/preview?as=requester`)).rights.estimate).toBe("edit");
  });

  it("a process form autosaved from the designer's draft, then previewed at a step of a process and from a viewpoint", async () => {
    const form = (await e.owner.post(`${P}/forms`, { name: "درخواست تنخواه" }, 201)).form as FormOut;
    let d = processDraft(form);
    d = { ...d, layout: insertItem(d.layout, { field: "u_amount", required: true }, { t: 0, s: 0 }).layout };
    d = { ...d, layout: insertItem(d.layout, { field: "u_reason" }, { t: 0, s: 0 }).layout };
    d = { ...d, layout: insertItem(d.layout, { field: "u_pay", showIf: { f: "u_amount", op: "gt", v: 0 } }, { t: 0, s: 0 }).layout };
    d = { ...d, layout: insertItem(d.layout, { text: "  پیوست را فراموش نکنید  " }, { t: 0, s: 0 }).layout };
    const saved = (await e.owner.patch(`${P}/forms/${form.id}`, processPatch(form, d)!)).form as FormOut;
    expect(saved.fields).toEqual(["u_amount", "u_reason", "u_pay"]);
    expect(processPatch(saved, d)).toBeNull();
    // a step of a process's draft that hides the reason and lets the approver edit the payment
    const graph = { nodes: [{ id: "t", type: "trigger", config: {} }, { id: "a1", type: "form_step", label: "تأیید رئیس شعبه", config: { action: "approve", form: form.id, rights: { default: "read", fields: { u_reason: "hidden", u_pay: "edit" } }, assignees: [] } }], edges: [] };
    await e.owner.post(`${P}/r/process`, { name: "تنخواه شعبه", key: "petty_cash", draft: { graph } });
    // the designer's own call (the drafts' graphs are long columns: asked for by name)
    const sources = await formsApi.processSources(orgApiOf(e.owner, P));
    expect(sources.processes.map((p) => p.name)).toEqual(["تنخواه شعبه"]);
    const [step] = stepsUsing(form.id, sources);
    expect(step).toMatchObject({ label: "تنخواه شعبه › تأیید رئیس شعبه", action: "approve" });
    const pv: FormPreview = await e.owner.post(`${P}/forms/${form.id}/preview`, { rights: step.rights, as: "agent" });
    expect(pv.as.label).toBe("کارشناس");
    expect(pv.shown).toEqual({ u_amount: "read", u_reason: "hidden", u_pay: "edit" });
    expect(pv.view.tabs[0].sections[0].items.map((i) => (i.kind === "field" ? i.name : "note"))).toEqual(["u_amount", "u_pay", "note"]);
    // money in its own unit (the field's), else the organisation's
    expect(moneyUnitOf(pv.fields.u_amount, "rial")).toBe("toman");
    // the form alone, with sample values: «نمایش وقتی…» reads them, and the required amount is asked for
    const alone: FormPreview = await e.owner.post(`${P}/forms/${form.id}/preview`, { as: "me", values: { u_reason: "x" } });
    expect(alone.shown.u_pay).toBe("hidden");
    expect(Object.keys(alone.check?.problems ?? {})).toEqual(["u_amount"]);
    const filled: FormPreview = await e.owner.post(`${P}/forms/${form.id}/preview`, { as: "me", values: { u_amount: "5000000" } });
    expect(filled.shown.u_pay).toBe("edit");
    expect(filled.check?.problems).toEqual({});
  });

  it("people without the grant are offered nothing and refused by the server", async () => {
    const m = await e.member("member");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles: ["agent"], persona: "agent" });
    const me = await (m.client as Client).get(`${P}`);
    expect(fieldsAccess({ can: () => false, allows: (g) => gateAllows(me.access?.grants, g), writable: true }).designRead).toBe(false);
    await m.client.get(`${P}/forms`, 403);
    await m.client.put(`${P}/forms/system/todo/overrides`, { fields: { tags: { form_hidden: false } } }, 403);
  });
});
