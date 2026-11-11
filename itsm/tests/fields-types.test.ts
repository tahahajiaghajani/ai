// F1 — field types and library fields (design F §3.1): the built-in types (labels, storage, widgets; «پیوست» on json
// storage, no storage type added), the settings an organisation's type or a library field may carry and how they are
// checked, the resolution of an organisation's types (the bank's examples), the FieldDef a library field becomes,
// the storage rule (a widget changes only within its storage type), and money: stored in Rials, shown in the
// organisation's currency_display or the field's own unit.
import { describe, it, expect } from "vitest";
import { FIELD_TYPES } from "@shared/model/types";
import {
  BUILTIN_FIELD_TYPES, BUILTIN_TYPE_OPTIONS, FIELD_TYPE_GROUPS, LIBRARY_NAME, TYPE_KEY, availableBuiltinTypes, builtinFieldType, cleanSettings,
  dateBounds, formatFieldMoney, libraryFieldDef, libraryFieldSettings, moneyUnitOf, resolveFieldType, rialFromInput, sameStorage,
  typeRowSettings, widgetsFor, type FieldTypeRow,
} from "@shared/forms/fieldtypes";

const fa = (s: string) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

describe("built-in field types", () => {
  it("are listed once each, by group, on the engine's storage types", () => {
    const keys = BUILTIN_FIELD_TYPES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of BUILTIN_FIELD_TYPES) {
      expect(b.base in FIELD_TYPES, b.key).toBe(true);
      expect(b.group in FIELD_TYPE_GROUPS, b.key).toBe(true);
      expect(widgetsFor(b.base, b.settings.ref), b.key).toContain(b.settings.widget);
    }
    expect(BUILTIN_TYPE_OPTIONS.map((o) => o.value)).toEqual(keys);
  });

  it("keep the engine's 28 storage types: «پیوست» is json with the files widget and the attachments check", () => {
    expect(Object.keys(FIELD_TYPES)).toHaveLength(28);
    expect(builtinFieldType("attachment")).toMatchObject({ label: "پیوست", base: "json", settings: { widget: "files", check: "attachments", max: 5 } });
  });

  it("carry the design's labels, storage and widgets", () => {
    const row = (k: string) => {
      const b = builtinFieldType(k)!;
      return [b.label, b.base, b.settings.widget];
    };
    expect(row("national_id")).toEqual(["کد ملی", "string", "input"]);
    expect(builtinFieldType("national_id")!.settings).toMatchObject({ ltr: true, check: "national_id" });
    expect(row("iban")).toEqual(["شمارهٔ شبا", "string", "input"]);
    expect(row("card")).toEqual(["شمارهٔ کارت", "string", "input"]);
    expect(row("postal_code")).toEqual(["کد پستی", "string", "input"]);
    expect(row("mobile")).toEqual(["تلفن همراه", "string", "input"]);
    expect(row("checkbox")).toEqual(["کادر انتخاب", "bool", "checkbox"]);
    expect(row("switch")).toEqual(["کلید روشن/خاموش", "bool", "switch"]);
    expect(row("select")).toEqual(["فهرست کشویی", "choice", "select"]);
    expect(row("radio")).toEqual(["گزینه‌های تکی", "choice", "radio"]);
    expect(row("checklist")).toEqual(["فهرست تیک‌دار", "multichoice", "checklist"]);
    expect(row("money")).toEqual(["مبلغ", "money", "money"]);
    expect(row("unit")).toEqual(["واحد سازمانی", "ref", "record"]);
    expect(row("position")).toEqual(["نقش سازمانی", "ref", "position"]);
    expect(row("color")).toEqual(["رنگ", "color", "swatches"]);
  });

  it("offer the «نقش سازمانی» picker only once the positions table exists", () => {
    const without = availableBuiltinTypes((k) => k !== "position").map((b) => b.key);
    expect(without).not.toContain("position");
    expect(without).toContain("unit");
    expect(availableBuiltinTypes(() => true).map((b) => b.key)).toContain("position");
  });

  it("change widgets only within the storage type", () => {
    expect(widgetsFor("choice")).toEqual(["select", "radio"]);
    expect(widgetsFor("bool")).toEqual(["checkbox", "switch"]);
    expect(widgetsFor("ref", "position")).toContain("position");
    expect(widgetsFor("ref", "org_unit")).not.toContain("position");
    expect(sameStorage(resolveFieldType("select")!, resolveFieldType("radio")!)).toBe(true);
    expect(sameStorage(resolveFieldType("select")!, resolveFieldType("multiselect")!)).toBe(false);
    expect(sameStorage(resolveFieldType("string")!, resolveFieldType("national_id")!)).toBe(true);
  });
});

describe("settings of a type or a field", () => {
  it("keep what the built-in type allows and refuse the rest with a reason", () => {
    const nid = builtinFieldType("national_id")!;
    expect(cleanSettings(nid, { pattern: "^\\d+$" }).problems).toEqual(["«الگو» برای نوع «کد ملی» تنظیم نمی‌شود"]);
    expect(cleanSettings(nid, { check: "iban" }).problems).toEqual(["«بررسی» برای نوع «کد ملی» تنظیم نمی‌شود"]);
    const str = builtinFieldType("string")!;
    expect(cleanSettings(str, { pattern: "^\\d{6}$", patternMessage: "شش رقم", maxLength: 6, unknown_key: 1 })).toEqual({ settings: { pattern: "^\\d{6}$", patternMessage: "شش رقم", maxLength: 6 }, problems: [] });
    expect(cleanSettings(str, { pattern: "(a+)+" }).problems[0]).toContain("تکرار");
    expect(cleanSettings(str, { maxLength: 501 }).problems[0]).toContain("۵۰۰");
  });

  it("check numbers, decimals, units and date limits", () => {
    const dec = builtinFieldType("decimal")!;
    expect(cleanSettings(dec, { min: 10, max: 1 }).problems).toEqual(["کمینه از بیشینه بزرگ‌تر است"]);
    expect(cleanSettings(dec, { decimals: 13 }).problems[0]).toContain("۰ تا ۱۲");
    expect(cleanSettings(dec, { min: "x" }).problems).toEqual(["«کمینه» باید عدد باشد"]);
    expect(cleanSettings(builtinFieldType("money")!, { unit: "dollar" }).problems).toEqual(["واحد مبلغ باید ریال یا تومان باشد"]);
    expect(cleanSettings(builtinFieldType("rating")!, { max: 11 }).problems[0]).toContain("۱ تا ۱۰");
    const date = builtinFieldType("date")!;
    expect(cleanSettings(date, { minDate: "$today", maxDate: fa("$today+30d") }).settings).toEqual({ minDate: "$today", maxDate: "$today+30d" });
    expect(cleanSettings(date, { minDate: "2026-05-01", maxDate: "2026-04-01" }).problems).toEqual(["آغاز محدودهٔ تاریخ پس از پایان آن است"]);
    expect(cleanSettings(date, { minDate: "soon" }).problems).toHaveLength(1);
  });

  it("check widgets, options, lists, references and attachments", () => {
    expect(cleanSettings(builtinFieldType("select")!, { widget: "checkbox" }).problems).toEqual(["نمایش «checkbox» برای نوع «فهرست کشویی» نیست"]);
    expect(cleanSettings(builtinFieldType("select")!, { widget: "radio" }).settings.widget).toBe("radio");
    const opts = cleanSettings(builtinFieldType("radio")!, { options: [{ value: "a", label: "الف" }, { value: "a" }, { value: "" }, { value: fa("2"), color: "red" }] });
    expect(opts.settings.options).toEqual([{ value: "a", label: "الف" }, { value: "2", label: "2", color: "red" }]);
    expect(opts.problems).toEqual(["گزینهٔ «a» تکراری است", "هر گزینه مقداری لازم دارد"]);
    expect(cleanSettings(builtinFieldType("select")!, { options: [{ value: "a" }], choices: "leave.kind" }).problems).toEqual(["گزینه‌های ثابت یا یک فهرست گزینه؛ هر دو با هم نه"]);
    const rec = builtinFieldType("record")!;
    expect(cleanSettings(rec, { ref: "nope" }, { tableExists: (k) => k === "contract" }).problems).toEqual(["جدول «nope» وجود ندارد"]);
    expect(cleanSettings(rec, { ref: "user" }).problems).toEqual(["جدول «user» وجود ندارد"]);
    expect(cleanSettings(rec, { ref: "contract", refFilter: { f: "x", op: "eq", v: 1 } }, { tableExists: () => true, condProblem: () => "فیلد «x» وجود ندارد" }).problems).toEqual(["شرط رکوردهای قابل انتخاب: فیلد «x» وجود ندارد"]);
    expect(cleanSettings(builtinFieldType("unit")!, { ref: "location" }).problems).toEqual(["«جدول مقصد» برای نوع «واحد سازمانی» تنظیم نمی‌شود"]);
    const att = builtinFieldType("attachment")!;
    expect(cleanSettings(att, { max: 3, accept: ["PDF", ".png", "image"] }).settings).toEqual({ max: 3, accept: ["pdf", "png", "image"] });
    expect(cleanSettings(att, { max: 51 }).problems[0]).toContain("۵۰");
    expect(cleanSettings(att, { accept: ["exe!"] }).problems[0]).toContain("exe!");
  });
});

describe("an organisation's types (the bank's examples)", () => {
  const rows: FieldTypeRow[] = [
    { key: "u_personnel_code", name: "کد پرسنلی", base: "string", validation: { pattern: "^\\d{6}$", patternMessage: "کد پرسنلی شش رقم است" }, display: { ltr: true } },
    { key: "u_petty_cash", name: "مبلغ تنخواه", base: "money", validation: { min: 0, max: 2_000_000_000 }, display: { unit: "toman" } },
    { key: "u_branch", name: "شعبه", base: "unit", validation: { refFilter: { f: "kind", op: "eq", v: "branch" } } },
    { key: "u_leave_kind", name: "نوع مرخصی", base: "radio", options: [{ value: "annual", label: "استحقاقی" }, { value: "sick", label: "استعلاجی" }], status: "retired" },
    { key: "u_bad_base", name: "پایهٔ ناشناخته", base: "nope" },
  ];

  it("resolve on their built-in type, with the row's settings on top", () => {
    expect(resolveFieldType("u_personnel_code", rows)).toMatchObject({ label: "کد پرسنلی", base: "string", custom: true, retired: false, settings: { widget: "input", ltr: true, pattern: "^\\d{6}$", patternMessage: "کد پرسنلی شش رقم است" } });
    expect(resolveFieldType("u_petty_cash", rows)!.settings).toMatchObject({ widget: "money", decimals: 0, min: 0, max: 2_000_000_000, unit: "toman" });
    expect(resolveFieldType("u_branch", rows)).toMatchObject({ base: "ref", settings: { ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "branch" } } });
    expect(resolveFieldType("u_leave_kind", new Map(rows.map((r) => [r.key, r])))).toMatchObject({ base: "choice", retired: true, settings: { widget: "radio", options: [{ value: "annual", label: "استحقاقی" }, { value: "sick", label: "استعلاجی" }] } });
  });

  it("are unknown without a built-in base, a u_ key or a row", () => {
    expect(resolveFieldType("u_bad_base", rows)).toBeNull();
    expect(resolveFieldType("u_missing", rows)).toBeNull();
    expect(resolveFieldType("personnel_code", [{ ...rows[0], key: "personnel_code" }])).toBeNull();
    expect(resolveFieldType(42)).toBeNull();
    expect(TYPE_KEY.test("u_personnel_code")).toBe(true);
    expect(TYPE_KEY.test("string")).toBe(false);
  });

  it("report what a row cannot keep (display settings stay in display)", () => {
    const b = builtinFieldType("money")!;
    expect(typeRowSettings(b, { validation: { unit: "toman" } }).problems).toEqual(["«واحد مبلغ» در تنظیمات نمایش می‌آید"]);
    expect(typeRowSettings(b, { display: { min: 3 } }).problems).toEqual(["«کمینه» در تنظیمات نمایش نمی‌آید"]);
    expect(typeRowSettings(b, { validation: "x" }).problems).toEqual(["اعتبارسنجی نوع فیلد معتبر نیست"]);
    expect(typeRowSettings(b, { validation: { min: 1 }, display: { unit: "rial" } }).problems).toEqual([]);
  });
});

describe("library fields", () => {
  const types: FieldTypeRow[] = [{ key: "u_branch", name: "شعبه", base: "unit", validation: { refFilter: { f: "kind", op: "eq", v: "branch" } } }];

  it("become a custom FieldDef of their type's storage, marked with the library field", () => {
    const f = libraryFieldDef({ name: "u_national_code", label: "کد ملی", type: "national_id", help: "کد ملی ده‌رقمی", placeholder: "۰۰۱۲۳۴۵۶۷۸", field_group: "personal", list: true, search: true, filter: true }, resolveFieldType("national_id")!);
    expect(f).toEqual({ name: "u_national_code", label: "کد ملی", type: "string", custom: true, library: "u_national_code", widget: "input", ltr: true, check: "national_id", help: "کد ملی ده‌رقمی", placeholder: "۰۰۱۲۳۴۵۶۷۸", group: "personal", list: true, search: true, filter: true });
  });

  it("follow their row: a changed label reaches every table that builds from it", () => {
    const row = { name: "u_branch", label: "شعبه", type: "u_branch" };
    const type = resolveFieldType("u_branch", types)!;
    expect(libraryFieldDef(row, type)).toMatchObject({ label: "شعبه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "branch" }, widget: "record" });
    expect(libraryFieldDef({ ...row, label: "شعبهٔ محل خدمت" }, type)!.label).toBe("شعبهٔ محل خدمت");
  });

  it("take their own options and settings over their type's", () => {
    const radio = resolveFieldType("radio")!;
    const f = libraryFieldDef({ name: "u_kind", label: "نوع", type: "radio", options: [{ value: "x", label: "ایکس" }], depends_on: "u_parent" }, radio)!;
    expect(f).toMatchObject({ type: "choice", widget: "radio", choices: [{ value: "x", label: "ایکس" }], dependsOn: "u_parent" });
    expect(libraryFieldDef({ name: "u_kind", label: "نوع", type: "radio", choices: "leave.kind" }, radio)!.choices).toBe("leave.kind");
    expect(libraryFieldDef({ name: "u_kind", label: "نوع", type: "radio" }, radio)!.choices).toEqual([]);
    const money = libraryFieldDef({ name: "u_amount", label: "مبلغ", type: "money", validation: { max: 500, unit: "toman" } }, resolveFieldType("money")!)!;
    expect(money).toMatchObject({ type: "money", decimals: 0, max: 500, unit: "toman" });
    expect(libraryFieldSettings({ validation: { check: "iban" } }, resolveFieldType("string")!).problems).toEqual(["«بررسی» برای نوع «متن کوتاه» تنظیم نمی‌شود"]);
  });

  it("are not fields without a u_ name, or as references without a table", () => {
    expect(libraryFieldDef({ name: "national_code", label: "x", type: "string" }, resolveFieldType("string")!)).toBeNull();
    expect(libraryFieldDef({ name: "u_contract", label: "قرارداد", type: "record" }, resolveFieldType("record")!)).toBeNull();
    expect(libraryFieldDef({ name: "u_contract", label: "قرارداد", type: "record", validation: { ref: "contract" } }, resolveFieldType("record")!)).toMatchObject({ type: "ref", ref: "contract", widget: "record" });
    expect(LIBRARY_NAME.test("u_" + "a".repeat(40))).toBe(true);
    expect(LIBRARY_NAME.test("u_" + "a".repeat(41))).toBe(false);
  });

  it("carry «پیوست» as json with its limits", () => {
    const f = libraryFieldDef({ name: "u_docs", label: "مدارک", type: "attachment", validation: { max: 3, accept: ["pdf"] } }, resolveFieldType("attachment")!);
    expect(f).toMatchObject({ type: "json", widget: "files", check: "attachments", max: 3, accept: ["pdf"] });
  });
});

describe("money", () => {
  it("is shown in the organisation's unit unless the field sets its own", () => {
    expect(moneyUnitOf({}, "toman")).toBe("toman");
    expect(moneyUnitOf({ unit: "rial" }, "toman")).toBe("rial");
    expect(formatFieldMoney({}, "25000000", "toman")).toBe("۲٬۵۰۰٬۰۰۰ تومان");
    expect(formatFieldMoney({ unit: "rial" }, "25000000", "toman")).toBe("۲۵٬۰۰۰٬۰۰۰ ریال");
    expect(formatFieldMoney({}, "25000000")).toBe("۲۵٬۰۰۰٬۰۰۰ ریال");
    expect(formatFieldMoney({}, null, "toman")).toBe("");
  });
  it("is stored in Rials: Tomans typed are multiplied by ten", () => {
    expect(rialFromInput(fa("2,500,000"), "toman")).toBe("25000000");
    expect(rialFromInput("2500000", "rial")).toBe("2500000");
    expect(rialFromInput("1.5", "toman")).toBe("15");
    expect(rialFromInput("abc", "rial")).toBeNull();
    expect(rialFromInput("", "rial")).toBeNull();
  });
});

describe("date bounds", () => {
  it("resolve a field's limits for today", () => {
    expect(dateBounds({ minDate: "$today-7d", maxDate: "2027-01-01" }, "2026-11-11")).toEqual({ min: "2026-11-04", max: "2027-01-01" });
    expect(dateBounds({}, "2026-11-11")).toEqual({ min: null, max: null });
  });
});
