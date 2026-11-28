// A case's texts show its values as people read them (release 1.1.5, NB3), end to end on PGlite: the title,
// «تعیین مقدار» into a text field, the subject and body of «اعلان» and the printable view use one display rule
// (@shared/process/display; the pure helpers are tested in ./process-display.test.ts) — the unit's and the role's
// names, option labels, a date-time in the organisation's time zone, the amount in the organisation's unit — while a
// unit field or a date field set from exactly one pill keeps the stored value, and what the requester typed reaches
// the notice as typed (no Markdown, no placeholder of the notice's template).
import { describe, it, expect, beforeAll } from "vitest";
import { escapeMarkdown } from "@shared/notify";
import { createIn, updateIn } from "@server/engine";
import { casePrint } from "@server/modules/process/api";
import type { ProcessGraph } from "@shared/process/graph";
import { edge, kase, node, person, publish, start, world, type World } from "./process-engine-helpers";

describe("a case's texts show its values as people read them (PGlite)", () => {
  let w: World;
  const P: Record<string, string> = {};
  const U: Record<string, string> = {};
  let form = "";

  beforeAll(async () => {
    w = await world();
    for (const [k, name] of [["r", "رضا درخواست‌دهنده"], ["a", "علی یکم"], ["b", "بهرام دوم"]] as const) P[k] = await person(w, name);
    U.vanak = String((await w.sys.write((tx) => createIn(tx, w.sys, "org_unit", { name: "شعبهٔ ونک", kind: "branch" }, { trusted: true }))).id);
    U.finance = String((await w.sys.write((tx) => createIn(tx, w.sys, "group", { name: "امور مالی" }, { trusted: true }))).id);
    U.head = String((await w.sys.write((tx) => createIn(tx, w.sys, "position", { key: "dsp_head", name: "رئیس شعبه", active: true }, { trusted: true }))).id);
    const lib: [string, string, string, Record<string, unknown>][] = [
      ["u_dsp_pos", "نقش در مقصد", "position", {}],
      ["u_dsp_when", "زمان رخداد", "datetime", {}],
      ["u_dsp_kind", "نوع رخداد", "select", { options: [{ value: "phishing", label: "فیشینگ" }, { value: "fraud", label: "تقلب" }] }],
      ["u_dsp_tags", "برچسب‌ها", "multiselect", { options: [{ value: "a", label: "الف" }, { value: "b", label: "ب" }] }],
      ["u_dsp_people", "همراهان", "users", {}],
      ["u_dsp_group", "گروه پیگیر", "group", {}],
      ["u_dsp_ok", "تأیید شد", "checkbox", {}],
      ["u_dsp_count", "تعداد", "int", {}],
      ["u_dsp_unit2", "شعبهٔ مقصد", "unit", {}],
      ["u_dsp_day", "روز اجرا", "date", {}],
    ];
    for (const [name, label, type, more] of lib) await w.o.owner.post(`${w.P}/fields/library`, { name, label, type, ...more }, 201);
    const items = ["u_amount", "u_need", "u_date", "u_branch", "u_finance_note", ...lib.map(([n]) => n)].map((field) => ({ field }));
    form = (await w.o.owner.post(`${w.P}/forms`, { name: "فرم نمایش مقدارها", layout: { tabs: [{ label: "فرم", sections: [{ label: null, items }] }] } }, 201)).form.id;
    // the organisation shows amounts in Tomans (financial settings «نمایش مبلغ‌ها»)
    const cfg = await w.o.db.one<{ id: string }>(`select id from sm_financial_configs where org_id = $1 and deleted_at is null order by created_at limit 1`, [w.o.org]);
    await w.sys.write((tx) =>
      cfg
        ? updateIn(tx, w.sys, "financial_config", cfg.id, { currency_display: "toman" }, { trusted: true })
        : createIn(tx, w.sys, "financial_config", { name: "تنظیمات مالی", config_key: "default", currency_display: "toman" }, { trusted: true }),
    );
  }, 600_000);

  const graph = (): ProcessGraph => ({
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form, rights: { default: "edit", fields: {} } }),
      node("v", "set_values", {
        values: {
          u_finance_note: "{{case.u_dsp_pos}}؛ {{case.u_dsp_kind}}؛ {{case.u_dsp_tags}}؛ {{case.u_dsp_people}}؛ {{case.u_dsp_group}}؛ {{case.u_date}}؛ {{case.u_dsp_ok}}؛ {{case.u_dsp_count}}؛ {{case.requested_by}}",
          // exactly the pill of a value that is not text: the stored value, of its type
          u_dsp_unit2: "{{case.u_branch}}",
          u_dsp_day: "{{case.u_date}}",
        },
      }),
      node("n", "notify", { to: [{ kind: "requester" }], subject: "{{case.u_dsp_kind}} — {{case.u_branch}}", body: "{{case.u_need}}" }, "اعلان به درخواست‌دهنده"),
      node("e", "end", { outcome: "completed" }),
    ],
    edges: [edge("t", "s"), edge("s", "v"), edge("v", "n"), edge("n", "e")],
  });
  const typed = "**مهم** [پیوند](http://x.example) {{recipient.name}}";
  const values = () => ({
    u_amount: "750000000", u_need: typed, u_date: "2099-01-01", u_branch: U.vanak, u_dsp_pos: U.head, u_dsp_when: "2099-01-01T21:00:00.000Z",
    u_dsp_kind: "phishing", u_dsp_tags: ["a", "b"], u_dsp_people: [P.a, P.b], u_dsp_group: U.finance, u_dsp_ok: true, u_dsp_count: 1500,
  });

  let id = "";
  const caseRow = () => kase(w, id);

  it("the case completes", async () => {
    const p = await publish(w, graph(), { forms: [form], title: "{{case.u_branch}} — {{case.u_dsp_when}} — {{case.u_amount}}" });
    id = (await start(w, P.r, p, { values: values() })).case!;
    await w.k.drain();
    expect((await caseRow()).state).toBe("completed");
  }, 300_000);

  it("the title: the unit's name, the date-time in Tehran (the next day), the amount in the organisation's Tomans", async () => {
    expect((await caseRow()).title).toBe("شعبهٔ ونک — ۱۴۷۷/۱۰/۱۳ ۰۰:۳۰ — ۷۵٬۰۰۰٬۰۰۰ تومان");
  });

  it("«تعیین مقدار»: a text field takes the display text; a unit field and a date field from exactly one pill the stored values", async () => {
    const c = await caseRow();
    expect(c.data.u_finance_note).toBe("رئیس شعبه؛ فیشینگ؛ الف، ب؛ علی یکم، بهرام دوم؛ امور مالی؛ ۱۴۷۷/۱۰/۱۲؛ بله؛ ۱٬۵۰۰؛ رضا درخواست‌دهنده");
    expect(c.data.u_dsp_unit2).toBe(U.vanak);
    expect(c.data.u_dsp_day).toBe("2099-01-01");
  });

  it("«اعلان»: the option's label and the unit's name; what the requester typed shows as typed", async () => {
    // the requester's bells on the case: the step's notice among any the workflow's own notices add
    const bells = await w.o.db.query<{ title: string; body: string }>(`select title, body from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3`, [w.o.org, P.r, id]);
    const bell = bells.find((b) => b.title === "فیشینگ — شعبهٔ ونک");
    expect(bell, JSON.stringify(bells.map((b) => b.title))).toBeDefined();
    expect(bell?.body).toBe(escapeMarkdown(typed));
    expect(bell?.body).not.toContain("رضا درخواست‌دهنده");
  });

  it("the printable view: the same text for each value the requester reads", async () => {
    const print = await casePrint(await w.o.ctxOf(P.r), id);
    const text = (field: string) => print.values.find((v) => v.field === field)?.text;
    expect(text("u_dsp_when")).toBe("۱۴۷۷/۱۰/۱۳ ۰۰:۳۰");
    expect(text("u_dsp_pos")).toBe("رئیس شعبه");
    expect(text("u_dsp_people")).toBe("علی یکم، بهرام دوم");
    expect(text("u_dsp_group")).toBe("امور مالی");
    expect(text("u_amount")).toBe("۷۵٬۰۰۰٬۰۰۰ تومان");
    expect(text("u_dsp_count")).toBe("۱٬۵۰۰");
    expect(text("u_dsp_unit2")).toBe("شعبهٔ ونک");
  });
});
