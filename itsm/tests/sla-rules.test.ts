// Rules of records end to end (src/server/modules/sla/rules.ts and policies.ts, docs/spec/services/sla.md §5): the
// priority matrix (ITIL default and the organisation's own), the category tree (choice lists kept in step, default
// groups, workspaces, the checks), business rules (order, values set before the save seen by later rules, tokens,
// abort, work notes / watchers / related records / state changes after the save, the nesting limit), assignment rules
// (fixed, round robin, least loaded, skills, on call, delegation) and UI policies enforced on the server (mandatory,
// read-only, order, create-only, imports, rules' own writes).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { actionsProblem, fillTemplate, ITIL_MATRIX, matrixProblem, policyActionsProblem, policyOf, priorityFrom } from "@shared/sla/rules";
import { policyEffects } from "@shared/sla/policy-types";
import { MAX_RULE_DEPTH, registerPriorityDefault, setOnCallResolver } from "@server/modules/sla";
import type { Client } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";

const CASE: TableDef = {
  key: "rule_case",
  table: "sm_rule_cases",
  label: "پرونده",
  plural: "پرونده‌ها",
  icon: "folder",
  module: "test",
  area: "work",
  extends: "task",
  numbered: { prefix: "RC", pad: 5 },
  display: "short_description",
  fields: [
    { name: "kind", label: "نوع", type: "string", maxLength: 40 },
    { name: "note", label: "یادداشت", type: "string", maxLength: 200 },
    { name: "copied", label: "رونوشت", type: "string", maxLength: 200 },
    { name: "reviewer", label: "بازبین", type: "user" },
    { name: "stamp", label: "مهر زمان", type: "datetime" },
  ],
  scope: {},
};
registerTable(CASE);
registerTable({
  key: "rule_note",
  table: "sm_rule_notes",
  label: "یادداشت پیگیری",
  plural: "یادداشت‌های پیگیری",
  icon: "sticky-note",
  module: "test",
  area: "work",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200 },
    { name: "source_id", label: "منبع", type: "string", maxLength: 36 },
  ],
  scope: {},
});

describe("pure rule helpers", () => {
  it("reads and checks a priority matrix", () => {
    expect(priorityFrom(ITIL_MATRIX, "1", "1")).toBe("1");
    expect(priorityFrom(ITIL_MATRIX, "2", "3")).toBe("4");
    expect(priorityFrom(ITIL_MATRIX, "3", "3")).toBe("5");
    expect(priorityFrom(ITIL_MATRIX, "9", "1")).toBeUndefined();
    expect(priorityFrom(null, "1", "1")).toBeUndefined();
    const opts = ["1", "2", "3"];
    expect(matrixProblem(ITIL_MATRIX, opts, opts, ["1", "2", "3", "4", "5"])).toBeNull();
    expect(matrixProblem({ "4": { "1": "1" } }, opts, opts, ["1"])).toContain("اثر «4»");
    expect(matrixProblem({ "1": { "1": "7" } }, opts, opts, ["1", "2"])).toContain("اولویت «7»");
    expect(matrixProblem([], opts, opts, opts)).toContain("معتبر نیست");
  });

  it("checks business-rule actions and fills templates", () => {
    const fields: Record<string, { type: string; base?: boolean }> = { note: { type: "string" }, state: { type: "choice" }, reviewer: { type: "user" }, org_id: { type: "uuid", base: true } };
    const opts = (timing: string) => ({ field: (n: string) => fields[n], table: (k: string) => k === "rule_note", stateField: "state", timing });
    expect(actionsProblem([{ type: "set", field: "note", value: "x" }, { type: "work_note", body: "یادداشت" }], opts("before"))).toBeNull();
    expect(actionsProblem([{ type: "set", field: "nope" }], opts("before"))).toContain("«nope»");
    expect(actionsProblem([{ type: "set", field: "org_id" }], opts("before"))).toContain("سامانه");
    expect(actionsProblem([{ type: "set", field: "state", value: "closed" }], opts("before"))).toContain("پس از ذخیره");
    expect(actionsProblem([{ type: "set", field: "state", value: "closed" }], opts("after"))).toBeNull();
    expect(actionsProblem([{ type: "watcher", op: "add", field: "note" }], opts("after"))).toContain("کاربر نیست");
    expect(actionsProblem([{ type: "abort", message: "" }], opts("before"))).toContain("پیام");
    expect(actionsProblem([{ type: "create", table: "nope", values: {} }], opts("after"))).toContain("وجود ندارد");
    expect(actionsProblem([{ type: "teleport" }], opts("after"))).toContain("شناخته نیست");
    expect(fillTemplate("{{number}} — {{short_description}}", { number: "RC1", short_description: "چاپگر" })).toBe("RC1 — چاپگر");
    expect(fillTemplate("{{count}}", { count: 3 })).toBe(3);
    expect(fillTemplate("{{missing}}!", {})).toBe("!");
  });

  it("turns stored policies into the record UI's shape; a later policy wins", () => {
    const p = policyOf({ id: "p1", condition: {}, actions: [{ field: "note", mandatory: true, junk: 1 }, { nofield: true }], sort_order: 5, applies_on: "update", tone: "warning", message: "!" });
    expect(p).toEqual({ key: "ui_policy:p1", when: null, actions: [{ field: "note", mandatory: true }], message: "!", tone: "warning", order: 5, on: "update" });
    const a = { actions: [{ field: "note", mandatory: true, readonly: true }], order: 1 };
    const b = { actions: [{ field: "note", mandatory: false }], order: 2 };
    const out = policyEffects([b, a], "create", () => true);
    expect([...out.mandatory.keys()]).toEqual([]);
    expect([...out.readonly.keys()]).toEqual(["note"]);
    expect(policyEffects([{ ...a, on: "update" }], "create", () => true).mandatory.size).toBe(0);
    expect(policyActionsProblem([{ field: "note" }], () => true)).toContain("الزامی");
    expect(policyActionsProblem([{ field: "x", mandatory: true }], (n) => n !== "x")).toContain("«x»");
  });
});

describe("rules of records", () => {
  let e: EngineOrg;
  let P = "";
  const u: Record<string, { client: Client; userId: string }> = {};
  const id = (k: string) => u[k].userId;
  const g: Record<string, string> = {};
  let unregisterMatrix: () => void = () => {};
  const past = new Date(Date.now() - 3600_000).toISOString();

  const create = async (data: Record<string, unknown>, status = 200) => {
    const r = await e.owner.post(`${P}/r/rule_case`, { short_description: "پرونده آزمایشی", ...data }, status);
    return status === 200 ? r.row : r;
  };
  const patch = async (recId: string, data: Record<string, unknown>, status = 200) => {
    const r = await e.owner.patch(`${P}/r/rule_case/${recId}`, data, status);
    return status === 200 ? r.row : r;
  };
  const post = async (table: string, data: Record<string, unknown>, status = 200) => {
    const r = await e.owner.post(`${P}/r/${table}`, { table_key: "rule_case", ...data }, status);
    return status === 200 ? r.row : r;
  };
  const group = async (name: string, members: string[]) => {
    const gid = (await e.owner.post(`${P}/r/group`, { name })).row.id;
    if (members.length) await e.owner.post(`${P}/access/groups/${gid}/members`, { user_ids: members.map(id) });
    return gid as string;
  };

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    unregisterMatrix = registerPriorityDefault("rule_case");
    for (let i = 1; i <= 8; i++) u[`U${i}`] = await e.member("member", `rules-u${i}@example.com`);
    g.fix = await group("ثابت", ["U2"]);
    g.rr = await group("نوبتی", ["U1", "U2", "U3"]);
    g.ll = await group("کم‌کار", ["U4", "U5"]);
    g.sk = await group("مهارت", ["U6", "U7"]);
    g.hw = await group("سخت‌افزار", []);
    g.lap = await group("لپ‌تاپ", []);
  });

  afterAll(() => {
    unregisterMatrix();
    setOnCallResolver(null);
  });

  it("the priority follows impact × urgency: ITIL by default, the organisation's matrix when it has one", async () => {
    expect((await create({ impact: "1", urgency: "1" })).priority).toBe("1");
    const r = await create({ impact: "2", urgency: "3" });
    expect(r.priority).toBe("4");
    expect((await patch(r.id, { urgency: "1" })).priority).toBe("2");
    // a person may still set the priority by hand; it moves again only with impact or urgency
    expect((await patch(r.id, { priority: "5" })).priority).toBe("5");
    expect((await patch(r.id, { description: "شرح" })).priority).toBe("5");

    const bad = await post("priority_matrix", { name: "نادرست", cells: { "9": { "1": "1" } } }, 400);
    expect(bad.error.details.fields.cells).toContain("اثر «9»");
    const m = await post("priority_matrix", { name: "ماتریس ما", cells: { "1": { "1": "2", "2": "2" }, "2": { "1": "3" } } });
    expect((await create({ impact: "1", urgency: "1" })).priority).toBe("2");
    // an empty cell leaves the priority as given
    expect((await create({ impact: "3", urgency: "3", priority: "3" })).priority).toBe("3");
    await e.owner.patch(`${P}/r/priority_matrix/${m.id}`, { active: false });
    expect((await create({ impact: "1", urgency: "1" })).priority).toBe("4");
    await e.owner.del(`${P}/r/priority_matrix/${m.id}`);
    expect((await create({ impact: "1", urgency: "1" })).priority).toBe("1");
    // a matrix created without cells (the form hides them behind the grid editor) starts as ITIL
    const plain = await post("priority_matrix", { name: "پیش‌فرض" });
    expect(plain.cells).toEqual(ITIL_MATRIX);
    await e.owner.del(`${P}/r/priority_matrix/${plain.id}`);
  });

  it("categories: a tree per table keeps the choice lists in step, fills the default group and stays in its workspace", async () => {
    const hw = await post("category", { name: "سخت‌افزار", value: "hardware", default_group_id: g.hw });
    const lap = await post("category", { name: "لپ‌تاپ", value: "laptop", parent_id: hw.id, default_group_id: g.lap });
    const choices = async () =>
      (await e.db.query<{ list: string; value: string; label: string; parent: string | null; active: boolean }>(
        `select list, value, label, parent, active from sm_choices where org_id = $1 and list like 'rule_case.%' and deleted_at is null order by list, value`, [e.org],
      ));
    expect(await choices()).toEqual([
      { list: "rule_case.category", value: "hardware", label: "سخت‌افزار", parent: null, active: true },
      { list: "rule_case.subcategory", value: "laptop", label: "لپ‌تاپ", parent: "hardware", active: true },
    ]);
    expect((await create({ category: "hardware", subcategory: "laptop" })).assignment_group_id).toBe(g.lap);
    expect((await create({ category: "hardware" })).assignment_group_id).toBe(g.hw);
    expect((await create({ category: "hardware", assignment_group_id: g.rr })).assignment_group_id).toBe(g.rr);

    // a category of one workspace
    const ws = (await e.owner.post(`${P}/r/workspace`, { key: "hr", name: "منابع انسانی" })).row.id;
    await post("category", { name: "حقوق", value: "payroll", workspace_id: ws });
    const outside = await create({ category: "payroll" }, 400);
    expect(outside.error.details.fields.category).toContain("برای این فضای کاری تعریف نشده است");
    expect((await create({ category: "payroll", workspace_id: ws })).category).toBe("payroll");

    // the checks of the tree
    expect((await post("category", { name: "بد", value: "bad value!" }, 400)).error.details.fields.value).toBeTruthy();
    expect((await post("category", { name: "سوم", value: "third", parent_id: lap.id }, 400)).error.details.fields.parent_id).toContain("دو سطح");
    expect((await post("category", { name: "دیگر", table_key: "rule_note", value: "x" }, 400)).error.details.fields.table_key).toContain("دسته");
    await e.owner.del(`${P}/r/category/${hw.id}`, 409);

    // a new code: the old option goes inactive, the children follow
    await e.owner.patch(`${P}/r/category/${hw.id}`, { value: "hw" });
    expect(await choices()).toEqual(expect.arrayContaining([
      expect.objectContaining({ list: "rule_case.category", value: "hardware", active: false }),
      expect.objectContaining({ list: "rule_case.category", value: "hw", active: true }),
      expect.objectContaining({ list: "rule_case.subcategory", value: "laptop", parent: "hw" }),
    ]));
  });

  it("business rules before the save run in order, see each other's values, use tokens and can abort", async () => {
    const vip = { f: "kind", op: "eq", v: "vip" };
    await post("business_rule", { name: "اثر زیاد", timing: "before", events: ["insert"], condition: vip, sort_order: 10, actions: [{ type: "set", field: "impact", value: "1" }] });
    await post("business_rule", { name: "یک", timing: "before", events: ["insert"], condition: vip, sort_order: 20, actions: [{ type: "set", field: "note", value: "یک" }] });
    await post("business_rule", { name: "دو", timing: "before", events: ["insert"], condition: vip, sort_order: 30, actions: [{ type: "set", field: "note", value: "دو" }] });
    await post("business_rule", {
      name: "رونوشت", timing: "before", events: ["insert"], condition: { f: "note", op: "eq", v: "دو" }, sort_order: 40,
      actions: [{ type: "set", field: "copied", from: "short_description" }, { type: "set", field: "reviewer", token: "$me" }, { type: "set", field: "stamp", token: "$now" }],
    });
    const r = await create({ kind: "vip", short_description: "پرونده ویژه" });
    expect(r).toMatchObject({ impact: "1", priority: "3", note: "دو", copied: "پرونده ویژه", reviewer: e.ownerId });
    expect(Math.abs(Date.parse(r.stamp) - Date.now())).toBeLessThan(10_000);

    await post("business_rule", { name: "مسدود", timing: "before", events: ["insert", "update"], condition: { f: "kind", op: "eq", v: "blocked" }, sort_order: 5, actions: [{ type: "abort", message: "ثبت پرونده‌های مسدود مجاز نیست" }] });
    const before = (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_rule_cases where org_id = $1`, [e.org]))!.n;
    const refused = await create({ kind: "blocked" }, 400);
    expect(refused.error.message).toBe("ثبت پرونده‌های مسدود مجاز نیست");
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_rule_cases where org_id = $1`, [e.org]))!.n).toBe(before);
    const open = await create({ kind: "open" });
    expect((await patch(open.id, { kind: "blocked" }, 400)).error.message).toBe("ثبت پرونده‌های مسدود مجاز نیست");

    // an update rule with a change operator; the matrix answers the impact or urgency it sets
    await post("business_rule", { name: "فوری", timing: "before", events: ["update"], condition: { f: "kind", op: "changes_to", v: "urgent" }, actions: [{ type: "set", field: "urgency", value: "1" }] });
    const later = await create({ kind: "normal", impact: "2", urgency: "3" });
    expect(later.priority).toBe("4");
    expect((await patch(later.id, { kind: "urgent" })).priority).toBe("2");
    expect((await patch(later.id, { urgency: "3" })).urgency).toBe("3");

    // the rule rows are checked
    expect((await post("business_rule", { name: "بد", events: ["insert"], actions: [{ type: "set", field: "nope" }] }, 400)).error.details.fields.actions).toContain("«nope»");
    expect((await post("business_rule", { name: "وضعیت", timing: "before", events: ["insert"], actions: [{ type: "set", field: "state", value: "closed" }] }, 400)).error.details.fields.actions).toContain("پس از ذخیره");
    expect((await post("business_rule", { name: "بی‌رویداد", events: [], actions: [] }, 400)).error.details.fields.events).toBeTruthy();
  });

  it("after the save: work notes, watchers, related records and state changes; nested writes stop at the limit", async () => {
    const after = { f: "kind", op: "eq", v: "after" };
    await post("business_rule", { name: "یادداشت پیش", timing: "before", events: ["insert"], condition: after, actions: [{ type: "work_note", body: "پیش از ذخیره دیده شد" }] });
    await post("business_rule", {
      name: "پیگیری", timing: "after", events: ["insert"], condition: after,
      actions: [
        { type: "work_note", body: "ثبت شد: {{number}}" },
        { type: "watcher", op: "add", users: [id("U1")] },
        { type: "create", table: "rule_note", values: { title: "پیگیری {{short_description}}", source_id: "{{id}}" } },
      ],
    });
    await post("business_rule", { name: "در جریان", timing: "after", events: ["state_change"], condition: { and: [after, { f: "state", op: "eq", v: "in_progress" }] }, actions: [{ type: "set", field: "note", value: "در جریان" }] });
    const r = await create({ kind: "after", short_description: "چاپگر طبقه دوم" });
    const fresh = (await e.owner.get(`${P}/r/rule_case/${r.id}`)).row;
    expect(fresh.watch_list).toContain(id("U1"));
    const notes = (await e.owner.get(`${P}/r/rule_case/${r.id}/journal`)).entries.filter((x: { kind: string }) => x.kind === "work_note").map((x: { body: string }) => x.body);
    expect(notes).toEqual(expect.arrayContaining(["پیش از ذخیره دیده شد", `ثبت شد: ${r.number}`]));
    expect(notes).toHaveLength(2);
    const related = await e.db.query<{ title: string; source_id: string }>(`select title, source_id from sm_rule_notes where org_id = $1`, [e.org]);
    expect(related).toEqual([{ title: "پیگیری چاپگر طبقه دوم", source_id: r.id }]);
    const moved = await e.owner.post(`${P}/r/rule_case/${r.id}/transition`, { to: "in_progress" });
    expect(moved.row.note).toBe("در جریان");

    // an after rule that changes its own record: the nested writes stop at the limit
    await post("business_rule", { name: "حلقه", timing: "after", events: ["update"], condition: { f: "kind", op: "eq", v: "loop" }, actions: [{ type: "set", field: "stamp", token: "$now" }] });
    const loop = await create({ kind: "loop" });
    await patch(loop.id, { description: "تغییر" });
    const v = (await e.owner.get(`${P}/r/rule_case/${loop.id}`)).row.version;
    expect(v).toBeGreaterThanOrEqual(3);
    expect(v).toBeLessThanOrEqual(2 + MAX_RULE_DEPTH);

    // an abort after the save undoes the whole write
    await post("business_rule", { name: "لغو پس از ذخیره", timing: "after", events: ["insert"], condition: { f: "kind", op: "eq", v: "late-abort" }, actions: [{ type: "abort", message: "این ثبت برگشت خورد" }] });
    const n = async () => (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_rule_cases where org_id = $1 and kind = 'late-abort'`, [e.org]))!.n;
    expect((await create({ kind: "late-abort" }, 400)).error.message).toBe("این ثبت برگشت خورد");
    expect(await n()).toBe(0);
  });

  it("assignment rules: fixed, round robin, least loaded, skills, on call, and delegation", async () => {
    const rule = (kind: string, data: Record<string, unknown>) => post("assignment_rule", { name: `ارجاع ${kind}`, condition: { f: "kind", op: "eq", v: kind }, ...data });
    await rule("fixed", { group_id: g.fix, method: "fixed", user_id: id("U2") });
    expect(await create({ kind: "fixed" })).toMatchObject({ assignment_group_id: g.fix, assigned_to: id("U2") });
    // a record that already has a group is left alone
    expect(await create({ kind: "fixed", assignment_group_id: g.hw })).toMatchObject({ assignment_group_id: g.hw, assigned_to: null });

    await rule("rr", { group_id: g.rr, method: "round_robin" });
    const rr: string[] = [];
    for (let i = 0; i < 4; i++) rr.push((await create({ kind: "rr" })).assigned_to);
    expect(new Set(rr.slice(0, 3))).toEqual(new Set([id("U1"), id("U2"), id("U3")]));
    expect(rr[3]).toBe(rr[0]);

    // U4 already has two open records of the table
    for (let i = 0; i < 2; i++) await create({ kind: "pre", assignment_group_id: g.ll, assigned_to: id("U4") });
    await rule("ll", { group_id: g.ll, method: "least_loaded" });
    const ll: string[] = [];
    for (let i = 0; i < 3; i++) ll.push((await create({ kind: "ll" })).assigned_to);
    expect(ll).toEqual([id("U5"), id("U5"), id("U4")]);

    await e.owner.put(`${P}/access/members/${id("U6")}`, { skills: ["network", "linux"] });
    await e.owner.put(`${P}/access/members/${id("U7")}`, { skills: ["windows"] });
    await rule("net", { group_id: g.sk, method: "skills", skills: ["Network"] });
    expect((await create({ kind: "net" })).assigned_to).toBe(id("U6"));
    // the only skilled member is away: the group is set, nobody is picked
    await e.owner.put(`${P}/access/members/${id("U6")}`, { out_of_office: true });
    expect(await create({ kind: "net" })).toMatchObject({ assignment_group_id: g.sk, assigned_to: null });
    await e.owner.put(`${P}/access/members/${id("U6")}`, { out_of_office: false });

    setOnCallResolver(async (_q, _ctx, groupId) => (groupId === g.rr ? id("U3") : null));
    await rule("oncall", { group_id: g.rr, method: "oncall" });
    expect((await create({ kind: "oncall" })).assigned_to).toBe(id("U3"));
    setOnCallResolver(null);
    expect((await create({ kind: "oncall" })).assigned_to).toBeNull();

    // U2 is away and hands new work to U8
    const d = (await u.U2.client.post(`${P}/r/delegation`, { from_user: id("U2"), to_user: id("U8"), starts_at: past, scopes: ["assignments"] })).row;
    expect((await create({ kind: "fixed" })).assigned_to).toBe(id("U8"));
    await u.U2.client.patch(`${P}/r/delegation/${d.id}`, { active: false });
    expect((await create({ kind: "fixed" })).assigned_to).toBe(id("U2"));

    expect((await post("assignment_rule", { name: "بی‌گروه", method: "round_robin" }, 400)).error.details.fields.group_id).toBeTruthy();
    expect((await post("assignment_rule", { name: "خالی", method: "fixed" }, 400)).error.details.fields.group_id).toBeTruthy();
    expect((await post("assignment_rule", { name: "جدول بی‌گروه", table_key: "rule_note", group_id: g.fix }, 400)).error.details.fields.table_key).toContain("گروه");
  });

  it("UI policies are enforced on the server: mandatory and read-only fields, order, create-only, imports", async () => {
    const change = { f: "kind", op: "eq", v: "change" };
    const p = await post("ui_policy", { name: "تغییر", condition: change, actions: [{ field: "note", mandatory: true }, { field: "reviewer", readonly: true }], message: "برای تغییر، یادداشت لازم است", sort_order: 100 });
    const served = (await e.owner.get(`${P}/rules/ui-policies/rule_case`)).policies;
    expect(served).toEqual([{ key: `ui_policy:${p.id}`, when: change, actions: [{ field: "note", mandatory: true }, { field: "reviewer", readonly: true }], message: "برای تغییر، یادداشت لازم است", tone: "info", order: 100, on: "both" }]);

    const missing = await create({ kind: "change" }, 400);
    expect(missing.error.details.fields.note).toBe("برای تغییر، یادداشت لازم است — «یادداشت» را وارد کنید");
    const r = await create({ kind: "change", note: "دلیل تغییر" });
    expect((await patch(r.id, { reviewer: id("U1") }, 400)).error.details.fields.reviewer).toContain("تغییر نمی‌کند");
    expect((await patch(r.id, { note: "" }, 400)).error.details.fields.note).toBeTruthy();
    expect((await patch(r.id, { description: "شرح تازه" })).description).toBe("شرح تازه");
    // the moment the policy starts to apply
    const other = await create({ kind: "other" });
    expect((await patch(other.id, { kind: "change" }, 400)).error.details.fields.note).toBeTruthy();
    expect((await patch(other.id, { kind: "change", note: "حالا دارد" })).kind).toBe("change");

    // a later policy wins on the same field
    await post("ui_policy", { name: "استثنا", condition: { and: [change, { f: "note", op: "eq", v: "باز" }] }, actions: [{ field: "reviewer", readonly: false }], sort_order: 200 });
    await patch(r.id, { note: "باز" });
    expect((await patch(r.id, { reviewer: id("U1") })).reviewer).toBe(id("U1"));

    // rules write as the system: not held to UI policies
    await post("business_rule", { name: "بازبین خودکار", timing: "after", events: ["update"], condition: { and: [change, { f: "note", op: "eq", v: "خودکار" }] }, actions: [{ type: "set", field: "reviewer", token: "$me" }] });
    expect((await patch(r.id, { note: "خودکار" })).note).toBe("خودکار");
    expect((await e.owner.get(`${P}/r/rule_case/${r.id}`)).row.reviewer).toBe(e.ownerId);

    // only on create
    await post("ui_policy", { name: "رونوشت هنگام ثبت", condition: { f: "kind", op: "eq", v: "create-only" }, actions: [{ field: "copied", mandatory: true }], applies_on: "create" });
    await create({ kind: "create-only" }, 400);
    const c = await create({ kind: "create-only", copied: "دارد" });
    expect((await patch(c.id, { copied: "" })).copied).toBeNull();

    // imports go through the same checks, row by row
    const imported = await e.owner.post(`${P}/r/rule_case/import`, { rows: [{ short_description: "ورودی یک", kind: "change" }, { short_description: "ورودی دو", kind: "change", note: "دارد" }] });
    expect(imported.created).toBe(1);
    expect(imported.errors).toEqual([expect.objectContaining({ row: 0, field: "note", message: expect.stringContaining("یادداشت") })]);

    // the policy rows are checked
    expect((await post("ui_policy", { name: "بد", actions: [{ field: "nope", mandatory: true }] }, 400)).error.details.fields.actions).toContain("«nope»");
    expect((await post("ui_policy", { name: "بی‌اثر", actions: [{ field: "note" }] }, 400)).error.details.fields.actions).toBeTruthy();
    expect((await post("ui_policy", { name: "روی خودش", table_key: "ui_policy", actions: [{ field: "name", mandatory: true }] }, 400)).error.details.fields.table_key).toBeTruthy();
    // a requester filling the form gets the policies too
    const requester = await e.member("member", "rules-requester@example.com");
    await e.owner.put(`${P}/access/members/${requester.userId}`, { roles: ["requester"] });
    expect((await requester.client.get(`${P}/rules/ui-policies/rule_case`)).policies.length).toBeGreaterThan(0);
  });
});
