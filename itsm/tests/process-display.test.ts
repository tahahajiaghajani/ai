// How a workflow's texts show a case's values (release 1.1.5, NB3): one rule — @shared/process/display, loaded on the
// server by src/server/modules/process/engine/display.ts — for the case title, «تعیین مقدار» into a text field, the
// subject and body of «اعلان» and the printable view: names of units, people, groups and organisational roles, option
// labels, Jalali dates (a date-time in the organisation's time zone), amounts in the organisation's unit, «بله»/«خیر»,
// grouped Persian digits. A value stored into a field that is not text keeps the stored value (a unit field from
// `{{case.u_branch}}` takes the unit's id), and what is inserted into a notice is never read as Markdown or as one of
// the notice template's own placeholders. The pure helpers here; a case end to end on PGlite in
// ./process-display-case.test.ts.
import { describe, it, expect } from "vitest";
import type { FieldDef } from "@shared/model/types";
import { caseValueText, casePillKey, durationText, takesDisplayText, valueText, type DisplayEnv } from "@shared/process/display";
import { pillText, renderText } from "@shared/flows";
import { escapeMarkdown, inlineValue, renderTemplate } from "@shared/notify";

const UNIT = "01a20000-0000-7000-8000-000000000001";
const ALI = "01a20000-0000-7000-8000-000000000002";
const FILE = "01a20000-0000-7000-8000-000000000003";
const env = (o: Partial<DisplayEnv> = {}): DisplayEnv => ({ names: new Map([[UNIT, "شعبهٔ ونک"], [ALI, "علی یکم"], [FILE, "فاکتور.pdf"]]), tz: "Asia/Tehran", ...o });
const f = (type: FieldDef["type"], more: Partial<FieldDef> = {}): FieldDef => ({ name: "u_x", label: "فیلد", type, ...more }) as FieldDef;

describe("a stored value as people read it (@shared/process/display)", () => {
  it("names, labels, Jalali dates, amounts, yes/no and numbers — never an id or an option key", () => {
    expect(valueText(f("ref", { ref: "org_unit" }), UNIT, env())).toBe("شعبهٔ ونک");
    expect(valueText(f("users"), [ALI, "01a20000-0000-7000-8000-0000000000ff"], env())).toBe("علی یکم");
    // a value that cannot be named shows nothing rather than its id
    expect(valueText(f("ref", { ref: "org_unit" }), "01a20000-0000-7000-8000-0000000000ff", env())).toBeNull();
    const kinds = [{ value: "phishing", label: "فیشینگ" }, { value: "fraud", label: "تقلب" }];
    expect(valueText(f("choice", { choices: kinds }), "phishing", env())).toBe("فیشینگ");
    expect(valueText(f("multichoice", { choices: kinds }), ["fraud", "phishing"], env())).toBe("تقلب، فیشینگ");
    expect(valueText(f("date"), "2099-01-01", env())).toBe("۱۴۷۷/۱۰/۱۲");
    // a date-time in the organisation's time zone: 21:00 UTC is the next day's 00:30 in Tehran
    expect(valueText(f("datetime"), "2099-01-01T21:00:00.000Z", env())).toBe("۱۴۷۷/۱۰/۱۳ ۰۰:۳۰");
    expect(valueText(f("money"), "750000000", env())).toBe("۷۵۰٬۰۰۰٬۰۰۰ ریال");
    expect(valueText(f("money"), "750000000", env({ money: "toman" }))).toBe("۷۵٬۰۰۰٬۰۰۰ تومان");
    // a field's own unit wins over the organisation's
    expect(valueText(f("money", { unit: "rial" }), "750000000", env({ money: "toman" }))).toBe("۷۵۰٬۰۰۰٬۰۰۰ ریال");
    expect(valueText(f("bool"), true, env())).toBe("بله");
    expect(valueText(f("bool"), false, env())).toBe("خیر");
    expect(valueText(f("int"), 1500, env())).toBe("۱٬۵۰۰");
    expect(valueText(f("decimal"), "12.5", env())).toBe("۱۲٫۵");
    expect(valueText(f("percent"), "12.5", env())).toBe("۱۲٫۵٪");
    expect(valueText(f("duration"), 9000, env())).toBe("۲ ساعت و ۳۰ دقیقه");
    expect(durationText(0)).toBe("۰");
    expect(valueText(f("tags"), ["فوری", "شعبه"], env())).toBe("فوری، شعبه");
    expect(valueText(f("json", { check: "attachments" }), [FILE], env())).toBe("فاکتور.pdf");
    expect(valueText(f("string"), "متن", env())).toBe("متن");
    expect(valueText(f("json"), { a: 1 }, env())).toBeNull();
    expect(valueText(f("string"), "", env())).toBeNull();
    // a field the version no longer has: a scalar as stored
    expect(valueText(undefined, "x", env())).toBe("x");
  });

  it("the keys beside a case's values: people and the unit by name, the number and the title as they are", () => {
    const values = { requested_by: ALI, unit_id: UNIT, number: "PRC0000007", title: "عنوان", u_x: UNIT };
    const fields = new Map<string, FieldDef>([["u_x", f("ref", { ref: "org_unit" })]]);
    expect(caseValueText("requested_by", values, fields, env())).toBe("علی یکم");
    expect(caseValueText("unit_id", values, fields, env())).toBe("شعبهٔ ونک");
    expect(caseValueText("number", values, fields, env())).toBe("PRC0000007");
    expect(caseValueText("u_x", values, fields, env())).toBe("شعبهٔ ونک");
    expect(caseValueText("u_missing", values, fields, env())).toBe("");
    expect(casePillKey(" case.u_x ")).toBe("u_x");
    expect(casePillKey("case.u_x.y")).toBeNull();
    expect(casePillKey("steps.a.output.x")).toBeNull();
  });

  it("only text people read takes display text: identifiers and every other type take stored values", () => {
    expect(takesDisplayText(f("string"))).toBe(true);
    expect(takesDisplayText(f("text"))).toBe(true);
    expect(takesDisplayText(f("markdown"))).toBe(true);
    expect(takesDisplayText(f("string", { check: "national_id" }))).toBe(false);
    expect(takesDisplayText(f("string", { ltr: true }))).toBe(false);
    for (const t of ["ref", "date", "datetime", "money", "int", "choice", "users", "email"] as const) expect(takesDisplayText(f(t))).toBe(false);
  });
});

describe("pills in a text people read (@shared/flows renderText with `show`, `pillText`)", () => {
  const now = Date.parse("2099-01-01T21:00:00.000Z");
  const data = { trigger: { record: { priority: "1", $labels: { priority: "۱ — بحرانی" } } }, steps: { s: { output: { ref: 42 } } }, case: { u_x: UNIT } };
  const show = (expr: string, v: unknown) => pillText(expr, v, data, { now, tz: "Asia/Tehran" });

  it("the clock in Jalali, the Jalali parts in Persian digits, a record's field by its labels; anything else as stored", () => {
    expect(renderText("امروز {{today}}، اکنون {{now}}، فردا {{today + 1d}}", data, { now, tz: "Asia/Tehran" }, show)).toBe("امروز ۱۴۷۷/۱۰/۱۳، اکنون ۱۴۷۷/۱۰/۱۳ ۰۰:۳۰، فردا ۱۴۷۷/۱۰/۱۴");
    expect(renderText("{{jalali.date}} {{jalali.month_name}}", data, { now, tz: "Asia/Tehran" }, show)).toBe("۱۴۷۷/۱۰/۱۳ دی");
    expect(renderText("اولویت {{trigger.record.priority}}", data, { now }, show)).toBe("اولویت ۱ — بحرانی");
    // exactly one pill is written as text too
    expect(renderText("{{trigger.record.priority}}", data, { now }, show)).toBe("۱ — بحرانی");
    // a step's output has no field to say what it is: stored
    expect(renderText("شمارهٔ {{steps.s.output.ref}}", data, { now }, show)).toBe("شمارهٔ 42");
    // without `show` nothing changes: ids, keys and ISO dates (what machines read)
    expect(renderText("{{trigger.record.priority}} {{today}}", data, { now, tz: "Asia/Tehran" })).toBe("1 2099-01-02");
  });

  it("a value inserted into a notice's template is shown as it is: no placeholder, no Markdown", () => {
    const typed = "**مهم** [پیوند](http://x.example) {{recipient.name}}";
    const scope = { text: (p: string) => (p === "recipient.name" ? "گیرنده" : ""), raw: () => null };
    // the subject (plain): the braces of a typed «{{…}}» are no placeholder of the notice's template
    expect(renderTemplate(inlineValue(typed, "plain"), scope, "plain").replace(/‌/g, "")).toBe(typed);
    // the body (Markdown): escaped as the service escapes a placeholder's value
    expect(inlineValue(typed, "markdown")).toBe(escapeMarkdown(typed));
    expect(renderTemplate(inlineValue(typed, "markdown"), scope, "markdown")).not.toContain("گیرنده");
  });
});
