// F2 — process forms in shared code (design F §3.2): the layout (FormLayoutV2) cleaned and capped like the table
// arrangement, the problems a write is refused for (unknown, repeated or retired fields, contradicting flags, widths,
// caps, «نمایش وقتی…» conditions that are not valid on the form's own fields or depend on each other in a circle),
// the rights of a step — ONE function, `effectiveRights`, with the precedence form flag < step < field group < lock —
// «نمایش وقتی…» on the values being entered, and what a form shows.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STEP_RIGHTS, FORM_LIMITS, applyShowIf, canEdit, canRead, cleanFormLayout, cleanStepRights, effectiveRights, formLayoutProblems, formView,
  layoutFields, narrower, tableFormFields, type FormLayoutV2, type LayoutEnv,
} from "@shared/forms/layout";
import { tableDef } from "@shared/tables";
import type { FieldDef } from "@shared/model/types";

const F = (name: string, label: string, type: FieldDef["type"], more: Partial<FieldDef> = {}): FieldDef => ({ name, label, type, custom: true, library: name, ...more });

const FIELDS: Record<string, FieldDef> = {
  u_title: F("u_title", "عنوان", "string"),
  u_amount: F("u_amount", "مبلغ", "money", { group: "financial", decimals: 0 }),
  u_kind: F("u_kind", "نوع پرداخت", "choice", { choices: [{ value: "cash", label: "نقد" }, { value: "card", label: "کارت" }] }),
  u_note: F("u_note", "شرح", "text"),
  u_hidden: F("u_hidden", "یادداشت داخلی", "string"),
  u_locked: F("u_locked", "شمارهٔ پرونده", "string"),
  u_fixed: F("u_fixed", "کد سامانه", "string", { readonly: true }),
  u_agree: F("u_agree", "تعهد", "bool", { widget: "checkbox" }),
};
const fields = new Map(Object.entries(FIELDS));
const env = (more: Partial<LayoutEnv> = {}): LayoutEnv => ({ field: (n) => FIELDS[n] ?? null, ...more });
const one = (items: unknown[], extra: Record<string, unknown> = {}) => ({ tabs: [{ label: "درخواست", sections: [{ label: null, items, ...extra }] }] });

// the form of the precedence tests: one field per flag
const FORM: FormLayoutV2 = cleanFormLayout(
  one([
    { field: "u_title" },
    { field: "u_amount" },
    { field: "u_kind", required: true },
    { field: "u_note", readonly: true },
    { field: "u_hidden", hidden: true },
    { field: "u_locked" },
    { field: "u_fixed" },
    { field: "u_gone" },
  ]),
);
const ALL = { groups: "all" as const };

describe("effectiveRights: form flag < step < field group < lock", () => {
  it("the form alone: its item flags; a field without a definition is hidden", () => {
    expect(effectiveRights(FORM, null, fields, ALL)).toEqual({
      u_title: "edit", u_amount: "edit", u_kind: "required", u_note: "read", u_hidden: "hidden", u_locked: "edit", u_fixed: "read", u_gone: "hidden",
    });
  });

  it("a step: what it names wins over the form's flags; its default, refined by the flags, covers the rest", () => {
    // default «ویرایش»: the form's flags refine it (hidden stays hidden, read-only is read, required is required)
    expect(effectiveRights(FORM, { default: "edit", fields: {} }, fields, ALL)).toMatchObject({ u_title: "edit", u_kind: "required", u_note: "read", u_hidden: "hidden" });
    // default «خواندنی»: a required item is only read here; what the step names wins, widening or narrowing the form
    const step = { default: "read" as const, fields: { u_title: "required" as const, u_note: "edit" as const, u_hidden: "read" as const, u_kind: "hidden" as const } };
    expect(effectiveRights(FORM, step, fields, ALL)).toMatchObject({ u_title: "required", u_note: "edit", u_hidden: "read", u_kind: "hidden", u_amount: "read" });
    // a step that says nothing: everything readable («همه خواندنی»)
    expect(effectiveRights(FORM, DEFAULT_STEP_RIGHTS, fields, ALL)).toMatchObject({ u_title: "read", u_kind: "read", u_hidden: "hidden" });
  });

  it("the viewer's field groups win over the step: a group the viewer lacks hides the field", () => {
    const step = { default: "edit" as const, fields: { u_amount: "required" as const } };
    expect(effectiveRights(FORM, step, fields, { groups: [] }).u_amount).toBe("hidden");
    expect(effectiveRights(FORM, step, fields, { groups: ["personal"] }).u_amount).toBe("hidden");
    expect(effectiveRights(FORM, step, fields, { groups: ["financial"] }).u_amount).toBe("required");
    expect(effectiveRights(FORM, step, fields, ALL).u_amount).toBe("required");
  });

  it("locks win over everything: a locked field is never editable, and a hidden one stays hidden", () => {
    const locked = { locked: ["u_locked"] };
    expect(effectiveRights(FORM, null, fields, ALL, locked).u_locked).toBe("read");
    for (const r of ["edit", "required"] as const) {
      expect(effectiveRights(FORM, { default: "read", fields: { u_locked: r, u_fixed: r } }, fields, ALL, locked)).toMatchObject({ u_locked: "read", u_fixed: "read" });
    }
    expect(effectiveRights(FORM, { default: "read", fields: { u_locked: "hidden" } }, fields, ALL, locked).u_locked).toBe("hidden");
    // a locked field of a group the viewer lacks: hidden (the lock only ever takes «ویرایش» away)
    const both = new Map(fields).set("u_amount", { ...FIELDS.u_amount, readonly: true });
    expect(effectiveRights(FORM, { default: "edit", fields: {} }, both, { groups: [] }).u_amount).toBe("hidden");
    expect(effectiveRights(FORM, { default: "edit", fields: {} }, both, { groups: ["financial"] }).u_amount).toBe("read");
  });

  it("a step's rights from stored JSON keep only known rights of library fields; the default is read unless valid", () => {
    expect(cleanStepRights({ default: "write", fields: { u_title: "admin", u_note: "edit", short_description: "edit", "u_bad name": "read" } })).toEqual({ default: "read", fields: { u_note: "edit" } });
    expect(cleanStepRights('{"default":"hidden","fields":{"u_title":"required"}}')).toEqual({ default: "hidden", fields: { u_title: "required" } });
    expect(cleanStepRights("نه JSON")).toEqual({ default: "read", fields: {} });
    expect([narrower("edit", "read"), narrower("hidden", "required"), canRead("read"), canRead("hidden"), canEdit("required"), canEdit("read")]).toEqual(["read", "hidden", true, false, true, false]);
  });
});

describe("«نمایش وقتی…» (showIf) on the values being entered", () => {
  const form = cleanFormLayout(
    one([
      { field: "u_kind" },
      { field: "u_amount", showIf: { f: "u_kind", op: "eq", v: "cash" } },
      { field: "u_note", showIf: { f: "u_amount", op: "nempty" } },
      { field: "u_title", showIf: { f: "u_kind", op: "bogus", v: 1 } },
    ]),
  );
  const rights = effectiveRights(form, { default: "edit", fields: {} }, fields, ALL);

  it("shows a field while its condition holds, and a hidden field counts as empty for the others' conditions", () => {
    expect(applyShowIf(form, rights, { u_kind: "cash", u_amount: "1000" }, fields)).toMatchObject({ u_kind: "edit", u_amount: "edit", u_note: "edit" });
    // «کارت»: the amount is hidden, so the note that depends on it is hidden too, whatever the amount still holds
    expect(applyShowIf(form, rights, { u_kind: "card", u_amount: "1000" }, fields)).toMatchObject({ u_amount: "hidden", u_note: "hidden" });
    expect(applyShowIf(form, rights, {}, fields)).toMatchObject({ u_amount: "hidden", u_note: "hidden" });
  });

  it("hides a chain of any length all the way down, in whatever order the form lists it", () => {
    const names = Array.from({ length: 14 }, (_, k) => `u_f${k}`);
    const chainFields = new Map(names.map((n, k) => [n, F(n, `گام ${k}`, "string")]));
    const items = names.map((field, k) => (k ? { field, showIf: { f: names[k - 1], op: "nempty" } } : { field }));
    const filled = Object.fromEntries(names.map((n) => [n, "x"]));
    const { u_f0: _, ...headless } = filled;
    for (const listed of [items, [...items].reverse()]) {
      const chain = cleanFormLayout(one(listed));
      const r = effectiveRights(chain, { default: "edit", fields: {} }, chainFields, ALL);
      expect(names.map((n) => applyShowIf(chain, r, filled, chainFields)[n])).toEqual(names.map(() => "edit"));
      expect(names.map((n) => applyShowIf(chain, r, headless, chainFields)[n])).toEqual(names.map((_n, k) => (k ? "hidden" : "edit")));
    }
  });

  it("reads only what the person may read, and leaves a field with a condition that is not valid shown", () => {
    // the step hides «نوع پرداخت» from this person: its value cannot show them the amount
    const blind = effectiveRights(form, { default: "edit", fields: { u_kind: "hidden" } }, fields, ALL);
    expect(applyShowIf(form, blind, { u_kind: "cash", u_amount: "1000" }, fields)).toMatchObject({ u_kind: "hidden", u_amount: "hidden" });
    expect(applyShowIf(form, rights, { u_kind: "card" }, fields).u_title).toBe("edit");
    // nothing to do without conditions
    const plain = cleanFormLayout(one([{ field: "u_kind" }]));
    const r = effectiveRights(plain, null, fields, ALL);
    expect(applyShowIf(plain, r, {}, fields)).toBe(r);
  });
});

describe("the layout: cleaning and limits", () => {
  it("cleans stored JSON: names once, library fields only, flags that agree, widths, trimmed labels", () => {
    const raw = JSON.stringify({
      tabs: [
        {
          label: "  مشخصات   درخواست  ",
          sections: [
            {
              label: "",
              columns: 3,
              items: [
                { field: "u_title", span: 12, label: "  عنوان   درخواست ", help: "x".repeat(400) },
                { field: "u_title", span: 24 },
                { field: "short_description" },
                { field: "U_TITLE" },
                { field: `u_${"a".repeat(41)}` },
                { field: "u_note", span: 7, hidden: true, readonly: true, required: true },
                { field: "u_kind", readonly: true, required: true },
                { field: "u_agree", required: true, showIf: { f: "u_kind", op: "eq", v: "cash" } },
                { text: "   " },
                { text: "مدارک را پیوست کنید", tone: "warning" },
                { text: "یادداشت", tone: "danger" },
                42,
                null,
              ],
            },
            "بخش نامعتبر",
          ],
        },
        { label: "", sections: [{ label: "پیوست‌ها", columns: 1, items: [] }] },
      ],
    });
    expect(cleanFormLayout(raw)).toEqual({
      tabs: [
        {
          label: "مشخصات درخواست",
          sections: [
            {
              label: null,
              items: [
                { field: "u_title", span: 12, label: "عنوان درخواست", help: "x".repeat(FORM_LIMITS.help) },
                { field: "u_note", hidden: true },
                { field: "u_kind", readonly: true },
                { field: "u_agree", required: true, showIf: { f: "u_kind", op: "eq", v: "cash" } },
                { text: "مدارک را پیوست کنید", tone: "warning" },
                { text: "یادداشت" },
              ],
            },
          ],
        },
        { label: "جزئیات", sections: [{ label: "پیوست‌ها", columns: 1, items: [] }] },
      ],
    });
    for (const bad of ["نه JSON", 42, null, undefined, [], { tabs: "x" }, { tabs: [null, "x"] }]) expect(cleanFormLayout(bad).tabs.filter((t) => t.sections.length)).toEqual([]);
  });

  it("caps tabs, sections, fields and notes", () => {
    const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));
    const name = (i: number) => `u_f${i}`;
    expect(cleanFormLayout({ tabs: many(FORM_LIMITS.tabs + 1, (i) => ({ label: `ز${i}`, sections: [] })) }).tabs.length).toBe(FORM_LIMITS.tabs);
    const sections = cleanFormLayout({ tabs: [{ label: "یک", sections: many(FORM_LIMITS.sections + 5, () => ({ label: null, items: [] })) }] });
    expect(sections.tabs[0].sections.length).toBe(FORM_LIMITS.sections);
    const fieldsCapped = cleanFormLayout(one(many(FORM_LIMITS.fields + 1, (i) => ({ field: name(i) }))));
    expect(layoutFields(fieldsCapped).length).toBe(FORM_LIMITS.fields);
    const notes = cleanFormLayout(one(many(FORM_LIMITS.notes + 1, (i) => ({ text: `یادداشت ${i}` }))));
    expect(notes.tabs[0].sections[0].items.length).toBe(FORM_LIMITS.notes);
  });
});

describe("what a write of a layout is refused for", () => {
  it("accepts a sound layout", () => {
    expect(formLayoutProblems(one([{ field: "u_title", span: 12 }, { field: "u_kind", required: true }, { field: "u_amount", showIf: { f: "u_kind", op: "eq", v: "cash" } }, { text: "یادداشت" }], { columns: 2 }), env())).toEqual([]);
    expect(formLayoutProblems({ tabs: [] }, env())).toEqual([]);
  });

  it("refuses shapes, unknown and repeated fields, retired fields new to the form, contradicting flags, widths and caps", () => {
    expect(formLayoutProblems("نه JSON", env())).toEqual(["چیدمان فرم معتبر نیست"]);
    expect(formLayoutProblems({ tabs: {} }, env())).toEqual(["چیدمان فرم معتبر نیست"]);
    expect(formLayoutProblems({ tabs: ["x"] }, env())).toEqual(["یکی از زبانه‌های فرم معتبر نیست"]);
    expect(formLayoutProblems({ tabs: [{ label: "یک", sections: [{ items: "x" }] }] }, env())).toEqual(["یکی از بخش‌های فرم معتبر نیست"]);
    expect(formLayoutProblems(one([{ span: 12 }]), env())).toEqual(["یکی از اجزای فرم نه فیلد است نه یادداشت"]);
    expect(formLayoutProblems(one([{ text: "  " }]), env())).toEqual(["یادداشت خالی در فرم آمده است"]);
    expect(formLayoutProblems(one([{ field: "short_description" }]), env())).toEqual(["«short_description» نام فیلد کتابخانه نیست"]);
    expect(formLayoutProblems(one([{ field: "u_nope" }]), env())).toEqual(["فیلد «u_nope» در کتابخانه نیست"]);
    expect(formLayoutProblems(one([{ field: "u_title" }, { field: "u_title", label: "دوباره" }]), env())).toEqual(["«عنوان» دو بار در فرم آمده است"]);
    expect(formLayoutProblems(one([{ field: "u_title", span: 7 }]), env())).toEqual(["پهنای «عنوان» باید یکی از ۶، ۸، ۱۲، ۱۶، ۱۸ یا ۲۴ باشد"]);
    expect(formLayoutProblems(one([{ field: "u_title", required: true, hidden: true }]), env())).toEqual(["«عنوان» نمی‌تواند هم پنهان باشد و هم الزامی"]);
    expect(formLayoutProblems(one([{ field: "u_title", label: "نام", required: true, readonly: true }]), env())).toEqual(["«نام» نمی‌تواند هم فقط‌خواندنی باشد و هم الزامی"]);
    expect(formLayoutProblems(one([{ field: "u_title" }], { label: "ب", columns: 3 }), env())).toEqual(["ستون‌های بخش «ب» باید ۱ یا ۲ باشد"]);
    // a retired field: refused where the form did not hold it already, kept where it did
    const retired = env({ retired: (n) => n === "u_note" });
    expect(formLayoutProblems(one([{ field: "u_note" }]), retired)).toEqual(["فیلد «شرح» بازنشسته است و به فرم افزوده نمی‌شود"]);
    expect(formLayoutProblems(one([{ field: "u_note" }]), { ...retired, kept: new Set(["u_note"]) })).toEqual([]);
    // caps
    const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));
    const all = (name: string) => FIELDS[name] ?? F(name, name, "string");
    expect(formLayoutProblems({ tabs: many(FORM_LIMITS.tabs + 1, () => ({ label: "ز", sections: [] })) }, env())).toEqual(["فرم حداکثر ۱۲ زبانه دارد"]);
    expect(formLayoutProblems({ tabs: [{ label: "ز", sections: many(FORM_LIMITS.sections + 1, () => ({ label: null, items: [] })) }] }, env())).toEqual(["فرم حداکثر ۶۰ بخش دارد"]);
    expect(formLayoutProblems(one(many(FORM_LIMITS.fields + 1, (i) => ({ field: `u_f${i}` }))), { field: all })).toEqual(["فرم حداکثر ۳۰۰ فیلد دارد"]);
    expect(formLayoutProblems(one(many(FORM_LIMITS.notes + 1, (i) => ({ text: `ی${i}` }))), env())).toEqual(["فرم حداکثر ۱۰۰ یادداشت دارد"]);
  });

  it("refuses «نمایش وقتی…» conditions that are not valid on the form's own fields, or depend on each other in a circle", () => {
    const cond = (showIf: unknown, more: unknown[] = []) => one([{ field: "u_kind" }, { field: "u_amount", showIf }, ...more]);
    expect(formLayoutProblems(cond({ f: "u_kind.label", op: "eq", v: "x" }), env())).toEqual(["شرط نمایش «مبلغ» فقط فیلدهای همین فرم را می‌سنجد"]);
    expect(formLayoutProblems(cond({ f: "u_note", op: "nempty" }), env())).toEqual(["شرط نمایش «مبلغ» فیلد «u_note» را می‌سنجد که در این فرم نیست"]);
    expect(formLayoutProblems(cond({ f: "short_description", op: "nempty" }), env())).toEqual(["شرط نمایش «مبلغ» فیلد «short_description» را می‌سنجد که در این فرم نیست"]);
    expect(formLayoutProblems(cond({ f: "u_amount", op: "nempty" }), env())).toEqual(["شرط نمایش «مبلغ» به خود آن فیلد بستگی دارد"]);
    expect(formLayoutProblems(cond("u_kind = cash"), env())).toEqual(["شرط نمایش «مبلغ» معتبر نیست"]);
    expect(formLayoutProblems(cond({ f: "u_kind", op: "bogus", v: 1 }), env())[0]).toMatch(/^شرط نمایش «مبلغ»: /);
    // «مبلغ» shows by «شرح» and «شرح» by «مبلغ»: neither could ever be shown first
    const circle = one([
      { field: "u_kind" },
      { field: "u_amount", showIf: { f: "u_note", op: "nempty" } },
      { field: "u_note", showIf: { and: [{ f: "u_kind", op: "eq", v: "cash" }, { f: "u_title", op: "nempty" }] } },
      { field: "u_title", showIf: { f: "u_amount", op: "nempty" } },
    ]);
    expect(formLayoutProblems(circle, env())).toEqual(["شرط‌های نمایش «مبلغ»، «شرح» و «عنوان» به یکدیگر بستگی دارند؛ یکی را بی‌شرط بگذارید"]);
    // a chain is not a circle
    const chain = one([{ field: "u_kind" }, { field: "u_amount", showIf: { f: "u_kind", op: "eq", v: "cash" } }, { field: "u_note", showIf: { f: "u_amount", op: "nempty" } }]);
    expect(formLayoutProblems(chain, env())).toEqual([]);
  });
});

describe("what a form shows", () => {
  it("leaves out hidden fields and empty sections, keeps notes, and sizes fields", () => {
    const form = cleanFormLayout({
      tabs: [
        {
          label: "درخواست",
          sections: [
            { label: "اصلی", items: [{ field: "u_title", label: "عنوان درخواست", help: "کوتاه بنویسید" }, { field: "u_note" }, { field: "u_kind", span: 8 }, { text: "مدارک را پیوست کنید" }] },
            { label: "تک‌ستونی", columns: 1, items: [{ field: "u_agree" }] },
            { label: "پنهان", items: [{ field: "u_hidden", hidden: true }, { text: "دربارهٔ فیلد پنهان" }] },
            { label: "فقط یادداشت", items: [{ text: "خوانده شود", tone: "warning" }] },
          ],
        },
        { label: "داخلی", sections: [{ label: null, items: [{ field: "u_hidden", hidden: true }] }] },
      ],
    });
    const view = formView(form, effectiveRights(form, null, fields, ALL), fields);
    expect(view.tabs.map((t) => t.label)).toEqual(["درخواست"]);
    expect(view.tabs[0].sections.map((s) => s.label)).toEqual(["اصلی", "تک‌ستونی", "فقط یادداشت"]);
    const [main, single, notes] = view.tabs[0].sections;
    expect(main.items.map((i) => (i.kind === "field" ? [i.name, i.span, i.label, i.right] : [i.text, i.tone]))).toEqual([
      ["u_title", 12, "عنوان درخواست", "edit"],
      ["u_note", 24, "شرح", "edit"],
      ["u_kind", 8, "نوع پرداخت", "edit"],
      ["مدارک را پیوست کنید", "info"],
    ]);
    expect(main.items[0]).toMatchObject({ help: "کوتاه بنویسید", field: { name: "u_title", type: "string" } });
    expect(single).toMatchObject({ columns: 1, items: [{ name: "u_agree", span: 24 }] });
    expect(notes.items).toEqual([{ kind: "note", text: "خوانده شود", tone: "warning" }]);
  });

  it("a table's default form: the record page's body, engine fields only on request", () => {
    const incident = tableDef("incident")!;
    const names = tableFormFields(incident).map((f) => f.name);
    expect(names).toContain("short_description");
    for (const out of ["number", "state", "id", "created_at"]) expect(names).not.toContain(out);
    expect(incident.fields.filter((f) => f.system && !f.hidden && !f.base).every((f) => !names.includes(f.name))).toBe(true);
    const withEngine = tableFormFields(incident, { engine: true }).map((f) => f.name);
    expect(withEngine.length).toBeGreaterThan(names.length);
    expect(withEngine).not.toContain("number");
  });
});
