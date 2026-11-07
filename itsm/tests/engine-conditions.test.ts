// The condition language: `evaluate` (JS) and `toSql` (PostgreSQL) give the same answer for every operator on every
// field type — dot-walks one and two levels deep (also into members), jsonb arrays (refs, users, multichoice, tags),
// relative Jalali windows in the organisation's time zone, Persian normalisation of text — and `not` composes the
// same way on both sides. Plus validation and the Persian description of conditions.
import { describe, it, expect, beforeAll } from "vitest";
import { registerTable, tableDef } from "@shared/tables";
import { evaluate, describe as describeCond, validateCond, type Cond, type CondEnv } from "@shared/model/conditions";
import { windowDates } from "@shared/model/jalali-buckets";
import { toSql, searchSql, parseNumber } from "@server/engine/sql";
import type { Db } from "@server/db";
import { makeServer, Client, signupWithOrg } from "./helpers";

const OPTS = [
  { value: "a", label: "الف" },
  { value: "b", label: "ب" },
  { value: "c", label: "ج" },
];

registerTable({
  key: "cond_ref",
  table: "sm_cond_refs",
  label: "مرجع",
  plural: "مرجع‌ها",
  icon: "box",
  module: "core",
  area: "work",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string" },
    { name: "owner", label: "مالک", type: "user" },
    { name: "level", label: "سطح", type: "int" },
    { name: "parent_id", label: "والد", type: "ref", ref: "$self" },
  ],
  scope: {},
  features: { sync: false },
});

registerTable({
  key: "cond_row",
  table: "sm_cond_rows",
  label: "ردیف",
  plural: "ردیف‌ها",
  icon: "box",
  module: "core",
  area: "work",
  numbered: { prefix: "CR", pad: 4 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", search: true },
    { name: "body", label: "متن", type: "text", search: true },
    { name: "qty", label: "تعداد", type: "int" },
    { name: "price", label: "بها", type: "decimal" },
    { name: "flag", label: "پرچم", type: "bool" },
    { name: "day", label: "روز", type: "date" },
    { name: "at", label: "زمان", type: "datetime" },
    { name: "spent", label: "مدت", type: "duration" },
    { name: "kind", label: "نوع", type: "choice", choices: OPTS },
    { name: "kinds", label: "انواع", type: "multichoice", choices: OPTS },
    { name: "tags", label: "برچسب", type: "tags" },
    { name: "ref_id", label: "مرجع", type: "ref", ref: "cond_ref" },
    { name: "refs", label: "مرجع‌ها", type: "refs", ref: "cond_ref" },
    { name: "who", label: "کسی", type: "user" },
    { name: "whos", label: "کسانی", type: "users" },
    { name: "team", label: "تیم", type: "group" },
    { name: "data", label: "داده", type: "json" },
    { name: "mail", label: "ایمیل", type: "email" },
    { name: "stars", label: "امتیاز", type: "rating" },
  ],
  scope: {},
  features: { sync: false },
});

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const U1 = id(901);
const U2 = id(902);
const U3 = id(903);
const G1 = id(801);
const G2 = id(802);
const UNIT = id(701);
const SUBUNIT = id(702);
const R1 = id(101);
const R2 = id(102);
const R3 = id(103);

// 2026-03-25T08:00:00Z = 1405/01/05 11:30 in Tehran (a Wednesday; the Jalali week began on Saturday 1405/01/01)
const NOW = Date.parse("2026-03-25T08:00:00Z");
const ENV: CondEnv = {
  now: NOW,
  tz: "Asia/Tehran",
  userId: U1,
  groups: [G1],
  groupUsers: [U1, U2],
  unitId: UNIT,
  unitTree: [UNIT, SUBUNIT],
  unitUsers: [U1],
  unitTreeUsers: [U1, U3],
};

const REFS = [
  { id: R1, name: "سرور اصلي", owner: U1, level: 3, parent_id: null },
  { id: R2, name: "چاپگر", owner: U2, level: 1, parent_id: R1 },
  { id: R3, name: "Router", owner: null, level: null, parent_id: R2 },
];

type Fx = Record<string, unknown>;
const ROWS: Fx[] = [
  {
    id: id(1), title: "سرور ايميل از کار افتاد", body: "کاربر گفت ۱۲ بار امتحان کرد و نمي‌شود", qty: 5, price: "1.50", flag: true,
    day: "2026-03-21", at: "2026-03-24T20:30:00.000Z", spent: 3600, kind: "a", kinds: ["a", "b"], tags: ["شبکه", "ایمیل"],
    ref_id: R1, refs: [R1, R2], who: U1, whos: [U1, U2], team: G1, data: { x: 1 }, mail: "a@example.com", stars: 4, unit_id: UNIT,
  },
  {
    id: id(2), title: "Printer jam 50%", body: "paper_jam in tray", qty: 0, price: "2.25", flag: false,
    day: "2026-03-20", at: "2026-03-20T20:29:59.999Z", spent: 60, kind: "b", kinds: ["c"], tags: ["چاپ"],
    ref_id: R2, refs: [R3], who: U2, whos: [U3], team: G2, data: [], mail: "b@test.org", stars: 1, unit_id: SUBUNIT,
  },
  {
    id: id(3), title: "", body: null, qty: null, price: null, flag: false,
    day: null, at: null, spent: null, kind: null, kinds: null, tags: [], ref_id: null, refs: null, who: null, whos: [],
    team: null, data: null, mail: null, stars: null, unit_id: null,
  },
  {
    id: id(4), title: "درخواست مجوز VPN", body: "می‌شود سريع؟", qty: -3, price: "-0.5", flag: true,
    day: "2026-02-19", at: "2026-01-01T00:00:00.000Z", spent: 0, kind: "c", kinds: ["a"], tags: ["شبکه"],
    ref_id: R3, refs: [R2], who: U3, whos: [U1], team: null, data: {}, mail: "c@example.com", stars: 5, unit_id: UNIT,
  },
  {
    id: id(5), title: "سرور بک‌آپ", body: "next week", qty: 12, price: "100", flag: false,
    day: "2026-04-01", at: "2026-03-28T10:00:00.000Z", spent: 7200, kind: "a", kinds: [], tags: null,
    ref_id: id(999), refs: [id(999)], who: U2, whos: null, team: G1, data: { y: [1] }, mail: "d@example.com", stars: 3, unit_id: null,
  },
];

/** The flat dot-walk keys `evaluate` reads (the server's loader fills them the same way). */
function jsRow(r: Fx): Fx {
  const ref = REFS.find((x) => x.id === r.ref_id);
  const parent = ref ? REFS.find((x) => x.id === ref.parent_id) : undefined;
  const names: Record<string, string> = { [U1]: "علی رضایی", [U2]: "Sara", [U3]: "مریم" };
  return {
    ...r,
    "ref_id.name": ref?.name,
    "ref_id.level": ref?.level,
    "ref_id.owner": ref?.owner,
    "ref_id.parent_id": ref?.parent_id,
    "ref_id.parent_id.name": parent?.name,
    "who.name": r.who ? names[r.who as string] : undefined,
  };
}

const CONDS: Cond[] = [
  // text
  { f: "title", op: "eq", v: "Printer jam 50%" },
  { f: "title", op: "ne", v: "Printer jam 50%" },
  { f: "title", op: "in", v: ["Printer jam 50%", "سرور بک‌آپ"] },
  { f: "title", op: "nin", v: ["Printer jam 50%"] },
  { f: "title", op: "contains", v: "سرور" },
  { f: "title", op: "contains", v: "ایمیل" },
  { f: "title", op: "contains", v: "PRINTER" },
  { f: "title", op: "contains", v: "50%" },
  { f: "title", op: "contains", v: "_" },
  { f: "body", op: "contains", v: "paper_jam" },
  { f: "body", op: "contains", v: "12" },
  { f: "body", op: "contains", v: "نمیشود" },
  { f: "body", op: "contains", v: "سریع" },
  { f: "title", op: "ncontains", v: "سرور" },
  { f: "title", op: "starts", v: "سرور" },
  { f: "title", op: "ends", v: "vpn" },
  { f: "title", op: "empty" },
  { f: "title", op: "nempty" },
  { f: "body", op: "empty" },
  { f: "mail", op: "ends", v: "@example.com" },
  // numbers
  { f: "qty", op: "eq", v: "۵" },
  { f: "qty", op: "ne", v: 5 },
  { f: "qty", op: "lt", v: 1 },
  { f: "qty", op: "lte", v: 0 },
  { f: "qty", op: "gt", v: "0" },
  { f: "qty", op: "gte", v: 5 },
  { f: "qty", op: "between", v: [-3, 5] },
  { f: "qty", op: "in", v: [0, 12] },
  { f: "qty", op: "nin", v: [0, 12] },
  { f: "qty", op: "empty" },
  { f: "price", op: "eq", v: "1.5" },
  { f: "price", op: "lt", v: "2.25" },
  { f: "price", op: "gte", v: "2.25" },
  { f: "price", op: "between", v: ["-1", "2"] },
  { f: "spent", op: "gt", v: 60 },
  { f: "stars", op: "gte", v: 4 },
  // booleans
  { f: "flag", op: "eq", v: true },
  { f: "flag", op: "eq", v: "false" },
  { f: "flag", op: "ne", v: true },
  // dates
  { f: "day", op: "eq", v: "2026-03-21" },
  { f: "day", op: "eq", v: "1405/01/01" },
  { f: "day", op: "lt", v: "2026-03-21" },
  { f: "day", op: "gte", v: "1405/01/01" },
  { f: "day", op: "between", v: ["2026-02-01", "2026-03-20"] },
  { f: "day", op: "relative", v: { unit: "week", n: 0 } },
  { f: "day", op: "relative", v: { unit: "day", n: 7, dir: "past" } },
  { f: "day", op: "relative", v: { unit: "month", from: -1, to: -1 } },
  { f: "day", op: "relative", v: { unit: "month", n: 1 } },
  { f: "day", op: "relative", v: { unit: "quarter", n: 1 } },
  { f: "day", op: "relative", v: { unit: "year", n: 1 } },
  { f: "day", op: "relative", v: { unit: "week", n: 2, dir: "next" } },
  { f: "day", op: "empty" },
  { f: "at", op: "eq", v: "2026-03-24T20:30:00.000Z" },
  { f: "at", op: "lt", v: "2026-03-24T20:30:00.000Z" },
  { f: "at", op: "lte", v: "2026-03-20T20:29:59.999Z" },
  { f: "at", op: "gt", v: "2026-03-20T20:29:59.999Z" },
  { f: "at", op: "gte", v: "2026-03-21" },
  { f: "at", op: "between", v: ["2026-03-20T20:29:59.999Z", "2026-03-24T20:30:00.000Z"] },
  { f: "at", op: "relative", v: { unit: "day", n: 1 } },
  { f: "at", op: "relative", v: { unit: "day", from: -1, to: -1 } },
  { f: "at", op: "relative", v: { unit: "week", n: 1 } },
  { f: "at", op: "relative", v: { unit: "week", from: -1, to: -1 } },
  { f: "at", op: "relative", v: { unit: "month", n: 1 } },
  { f: "at", op: "relative", v: { unit: "month", from: -1, to: -1 } },
  { f: "at", op: "relative", v: { unit: "year", from: -1, to: 0 } },
  { f: "at", op: "relative", v: { unit: "week", n: 1, dir: "next" } },
  // choices and arrays
  { f: "kind", op: "eq", v: "a" },
  { f: "kind", op: "ne", v: "a" },
  { f: "kind", op: "in", v: ["b", "c"] },
  { f: "kind", op: "nin", v: ["b", "c"] },
  { f: "kind", op: "empty" },
  { f: "kinds", op: "contains", v: "a" },
  { f: "kinds", op: "ncontains", v: "a" },
  { f: "kinds", op: "eq", v: "b" },
  { f: "kinds", op: "ne", v: "b" },
  { f: "kinds", op: "in", v: ["b", "c"] },
  { f: "kinds", op: "nin", v: ["b", "c"] },
  { f: "kinds", op: "empty" },
  { f: "kinds", op: "nempty" },
  { f: "tags", op: "contains", v: "شبکه" },
  { f: "tags", op: "in", v: ["چاپ", "ایمیل"] },
  { f: "tags", op: "empty" },
  // references and members
  { f: "ref_id", op: "eq", v: R1 },
  { f: "ref_id", op: "ne", v: R1.toUpperCase() },
  { f: "ref_id", op: "in", v: [R2, R3] },
  { f: "ref_id", op: "empty" },
  { f: "refs", op: "contains", v: R2 },
  { f: "refs", op: "in", v: [R3, id(999)] },
  { f: "refs", op: "empty" },
  { f: "who", op: "is_me" },
  { f: "who", op: "eq", v: U2 },
  { f: "who", op: "in_my_groups" },
  { f: "who", op: "in_my_unit" },
  { f: "who", op: "in_my_unit_tree" },
  { f: "whos", op: "is_me" },
  { f: "whos", op: "contains", v: U2 },
  { f: "whos", op: "in_my_groups" },
  { f: "whos", op: "empty" },
  { f: "team", op: "is_my_group" },
  { f: "team", op: "in_my_groups" },
  { f: "unit_id", op: "in_my_unit" },
  { f: "unit_id", op: "in_my_unit_tree" },
  { f: "data", op: "empty" },
  { f: "data", op: "nempty" },
  // dot-walks
  { f: "ref_id.name", op: "contains", v: "اصلی" },
  { f: "ref_id.name", op: "eq", v: "چاپگر" },
  { f: "ref_id.level", op: "gt", v: 1 },
  { f: "ref_id.level", op: "empty" },
  { f: "ref_id.owner", op: "is_me" },
  { f: "ref_id.owner", op: "in_my_groups" },
  { f: "ref_id.parent_id", op: "eq", v: R1 },
  { f: "ref_id.parent_id.name", op: "eq", v: "چاپگر" },
  { f: "ref_id.parent_id.name", op: "nempty" },
  { f: "who.name", op: "contains", v: "علي" },
  { f: "who.name", op: "starts", v: "sa" },
  // composition
  { and: [{ f: "kind", op: "eq", v: "a" }, { f: "flag", op: "eq", v: true }] },
  { or: [{ f: "qty", op: "gt", v: 10 }, { f: "title", op: "empty" }] },
  { not: { f: "qty", op: "gt", v: 0 } },
  { not: { or: [{ f: "kinds", op: "contains", v: "a" }, { f: "ref_id.level", op: "gte", v: 3 }] } },
  { and: [] },
  { or: [] },
];

describe("conditions: evaluate (JS) and toSql (SQL) agree", () => {
  let db: Db;
  let org = "";
  const def = () => tableDef("cond_row")!;

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    const c = new Client(s.app);
    org = await signupWithOrg(c);
    for (const [uid, name] of [[U1, "علی رضایی"], [U2, "Sara"], [U3, "مریم"]]) {
      await db.query(`insert into sm_users (id, email, full_name) values ($1, $2, $3)`, [uid, `${uid}@example.com`, name]);
      await db.query(`insert into sm_org_members (id, org_id, user_id, role) values ($1, $2, $3, 'member')`, [uid, org, uid]);
    }
    for (const r of REFS) await db.query(`insert into sm_cond_refs (id, org_id, name, owner, level, parent_id) values ($1, $2, $3, $4, $5, $6)`, [r.id, org, r.name, r.owner, r.level, r.parent_id]);
    const cols = Object.keys(ROWS[0]);
    for (const [i, r] of ROWS.entries()) {
      const json = new Set(["kinds", "tags", "refs", "whos", "data"]);
      const params = cols.map((k) => (json.has(k) ? (r[k] === null ? null : JSON.stringify(r[k])) : r[k]));
      await db.query(
        `insert into sm_cond_rows (org_id, no, ${cols.join(", ")}) values ($1, $2, ${cols.map((k, j) => `$${j + 3}${json.has(k) ? "::jsonb" : ""}`).join(", ")})`,
        [org, i + 1, ...params],
      );
    }
  });

  async function sqlIds(cond: Cond): Promise<string[]> {
    const params: unknown[] = [org];
    const where = toSql(cond, def(), "t", params, ENV);
    const rows = await db.query<{ id: string }>(`select t.id from sm_cond_rows t where t.org_id = $1 and ${where} order by t.id`, params);
    return rows.map((r) => r.id);
  }
  const jsIds = (cond: Cond) => ROWS.filter((r) => evaluate(cond, jsRow(r), ENV, def())).map((r) => r.id as string).sort();

  it("every fixture condition is valid for the table", () => {
    for (const c of CONDS) expect(validateCond(c, def()), JSON.stringify(c)).toBeNull();
  });

  it("matches the same rows, and so does its negation", async () => {
    let nonTrivial = 0;
    for (const cond of CONDS) {
      const js = jsIds(cond);
      expect(await sqlIds(cond), JSON.stringify(cond)).toEqual(js);
      expect(await sqlIds({ not: cond }), `not ${JSON.stringify(cond)}`).toEqual(jsIds({ not: cond }));
      if (js.length > 0 && js.length < ROWS.length) nonTrivial++;
    }
    // the fixtures discriminate: most conditions split the rows
    expect(nonTrivial).toBeGreaterThan(CONDS.length * 0.7);
  });

  it("spot checks of the semantics", () => {
    expect(jsIds({ f: "title", op: "contains", v: "ایمیل" })).toEqual([id(1)]); // ي/ی
    expect(jsIds({ f: "body", op: "contains", v: "نمیشود" })).toEqual([id(1)]); // ي/ی and the zero-width non-joiner
    expect(jsIds({ f: "body", op: "contains", v: "نمی‌شود" })).toEqual([id(1)]);
    expect(jsIds({ f: "at", op: "relative", v: { unit: "day", n: 1 } })).toEqual([id(1)]); // 00:00 Tehran today
    expect(jsIds({ f: "at", op: "relative", v: { unit: "day", from: -1, to: -1 } })).toEqual([]);
    expect(jsIds({ f: "day", op: "relative", v: { unit: "week", n: 0 } })).toEqual([id(1)]); // week from Saturday 1405/01/01
    expect(jsIds({ f: "day", op: "relative", v: { unit: "month", from: -1, to: -1 } })).toEqual([id(2)]); // اسفند ۱۴۰۴ (1404/11/30 is not in it)
    expect(jsIds({ f: "qty", op: "ne", v: 5 })).toContain(id(3)); // negative operators hold on empty values
    expect(jsIds({ f: "ref_id.parent_id.name", op: "eq", v: "چاپگر" })).toEqual([id(4)]);
    expect(windowDates({ unit: "month", from: 0, to: 0 }, NOW, "Asia/Tehran")).toEqual({ from: "2026-03-21", to: "2026-04-21" });
  });

  it("refuses what does not fit the table", () => {
    expect(validateCond({ f: "nope", op: "eq", v: 1 }, def())).toMatch(/وجود ندارد/);
    expect(validateCond({ f: "qty", op: "contains", v: "1" }, def())).toMatch(/به کار نمی‌رود/);
    expect(validateCond({ f: "qty", op: "eq", v: "abc" }, def())).toMatch(/معتبر نیست/);
    expect(validateCond({ f: "day", op: "relative", v: { unit: "decade" } }, def())).toMatch(/بازه/);
    expect(validateCond({ f: "kind", op: "changed" }, def())).toMatch(/قواعد/);
    expect(validateCond({ f: "kind", op: "changed" }, def(), { rules: true })).toBeNull();
    expect(validateCond({ and: [{ f: "qty", op: "eq", v: 1 }], or: [] } as unknown as Cond, def())).toMatch(/ساختار/);
    expect(validateCond({ f: "ref_id.name.x", op: "eq", v: 1 }, def())).toMatch(/وجود ندارد/);
  });

  it("describes a condition in Persian", () => {
    const text = describeCond({ and: [{ f: "kind", op: "in", v: ["a", "b"] }, { f: "who", op: "is_me" }, { f: "day", op: "relative", v: { unit: "day", n: 7 } }] }, def());
    expect(text).toBe("«نوع» یکی از «الف»، «ب» است و «کسی» من هستم و «روز» در ۷ روز گذشته است");
    expect(describeCond({ f: "ref_id.name", op: "contains", v: "سرور" }, def())).toBe("«مرجع ← نام» شامل «سرور» است");
    expect(describeCond(null, def())).toBe("همهٔ رکوردها");
  });

  it("search: words in search fields, Persian normalisation, numbers", async () => {
    const run = async (q: string) => {
      const params: unknown[] = [org];
      const where = searchSql(def(), "t", q, params)!;
      return (await db.query<{ id: string }>(`select t.id from sm_cond_rows t where t.org_id = $1 and ${where} order by t.id`, params)).map((r) => r.id);
    };
    expect(await run("سرور ایمیل")).toEqual([id(1)]);
    expect(await run("كاربر ۱۲")).toEqual([id(1)]);
    expect(await run("CR0002")).toEqual([id(2)]);
    expect(await run("cr2")).toEqual([id(2)]);
    expect(await run("2")).toEqual([id(1), id(2)]); // the number, and «۱۲» in a text
    expect(await run("printer")).toEqual([id(2)]);
    expect(parseNumber(def(), "cr-12")).toBe(12);
    expect(parseNumber(def(), "۰۰۷")).toBe(7);
    expect(parseNumber(def(), "abc")).toBeNull();
  });
});
