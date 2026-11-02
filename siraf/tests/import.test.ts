import { describe, it, expect, beforeAll } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { readSpreadsheet, parseCsv } from "@shared/sheet";
import type { Db } from "@server/db";

describe("spreadsheet reader", () => {
  it("reads the first sheet of an .xlsx file", async () => {
    const buf = await writeXlsxFile(
      [
        [{ value: "کد" }, { value: "نام" }, { value: "قیمت" }],
        [{ value: "101" }, { value: "شیر & کره <ویژه>" }, { type: Number, value: 250000 }],
        [null, { value: "دوغ" }, { type: Number, value: 0.1 + 0.2 }],
        [],
      ] as never,
      { sheet: "کالاها" },
    ).toBuffer();
    const r = await readSpreadsheet("items.xlsx", new Uint8Array(buf));
    expect(r.sheet).toBe("کالاها");
    expect(r.rows).toEqual([
      ["کد", "نام", "قیمت"],
      ["101", "شیر & کره <ویژه>", "250000"],
      ["", "دوغ", "0.3"],
    ]);
  });

  it("parses CSV with quotes, other delimiters and Windows-1256 text", async () => {
    expect(parseCsv('a;"b;c";"say ""hi"""\r\n1;2;3\r\n')).toEqual([["a", "b;c", 'say "hi"'], ["1", "2", "3"]]);
    // «سلام,1» saved by Excel on Persian Windows
    const r = await readSpreadsheet("x.csv", new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3, 0x2c, 0x31, 0x0d, 0x0a]));
    expect(r.rows).toEqual([["سلام", "1"]]);
    await expect(readSpreadsheet("old.xls", new Uint8Array([1, 2]))).rejects.toThrow(/xlsx/);
  });
});

describe("bulk import of master data", () => {
  let c: Client;
  let db: Db;
  let org: string;
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
  });

  it("validates without saving (dry run), then imports and links references by name", async () => {
    const rows = [
      { name: "شیر پرچرب", kind: "کالا", unit_id: "عدد", category_id: "لبنیات", sale_price: "۲۵۰٬۰۰۰", is_active: "بله" },
      { name: "ماست", kind: "کالا", unit_id: "عدد", category_id: "لبنیات", sale_price: "180000" },
      { name: "بدون نوع", kind: "خوراکی", sale_price: "1" },
      { name: "", kind: "", sale_price: "" },
      { name: "نصب", kind: "service", sale_price: "abc" },
    ];
    const dry = await c.post(`/o/${org}/data/item/import`, { rows, dry_run: true });
    expect(dry).toMatchObject({ created: 2, failed: 2, dry_run: true });
    expect(dry.results.find((r: { row: number }) => r.row === 2).error).toContain("نوع");
    const count = async () => (await db.one<{ n: number }>(`select count(*)::int as n from tz_items where org_id = $1`, [org]))!.n;
    const before = await count();
    expect(await db.one(`select 1 from tz_item_categories where org_id = $1 and name = 'لبنیات'`, [org])).toBeNull();

    const res = await c.post(`/o/${org}/data/item/import`, { rows, offset: 10 });
    expect(res).toMatchObject({ created: 2, updated: 0, failed: 2 });
    expect(res.results.map((r: { row: number }) => r.row)).toEqual([10, 11, 12, 14]);
    expect(await count()).toBe(before + 2);
    const items = await db.query(`select i.name, i.sale_price, i.is_active, u.name as unit, g.name as cat from tz_items i
      join tz_units u on u.id = i.unit_id join tz_item_categories g on g.id = i.category_id where i.org_id = $1 and g.name = 'لبنیات' order by i.code`, [org]);
    expect(items).toEqual([
      { name: "شیر پرچرب", sale_price: "250000", is_active: true, unit: "عدد", cat: "لبنیات" },
      { name: "ماست", sale_price: "180000", is_active: true, unit: "عدد", cat: "لبنیات" },
    ]);
    // the unit and the category were matched (existing) or created once
    const cats = await db.one<{ n: number }>(`select count(*)::int as n from tz_item_categories where org_id = $1 and name = 'لبنیات'`, [org]);
    expect(cats!.n).toBe(1);
  });

  it("updates rows with an existing code only when asked", async () => {
    const milk = await db.one<{ code: string }>(`select code from tz_items where org_id = $1 and name = 'شیر پرچرب'`, [org]);
    const rows = [{ code: milk!.code, name: "شیر پرچرب ۱ لیتری", sale_price: "260000" }];
    const refused = await c.post(`/o/${org}/data/item/import`, { rows });
    expect(refused.failed).toBe(1);
    expect(refused.results[0].error).toContain("وجود دارد");
    const ok = await c.post(`/o/${org}/data/item/import`, { rows, update_existing: true });
    expect(ok).toMatchObject({ updated: 1, failed: 0 });
    const item = await db.one(`select name, sale_price, unit_id is not null as has_unit from tz_items where org_id = $1 and code = $2`, [org, milk!.code]);
    expect(item).toEqual({ name: "شیر پرچرب ۱ لیتری", sale_price: "260000", has_unit: true });
    const dup = await c.post(`/o/${org}/data/item/import`, { rows: [{ code: "777", name: "الف" }, { code: "۷۷۷", name: "ب" }] });
    expect(dup.failed).toBe(1);
    expect(dup.results[1].error).toContain("تکراری");
  });

  it("imports parties with roles, Jalali dates, mobile numbers without the leading zero and detail accounts", async () => {
    const res = await c.post(`/o/${org}/data/party/import`, {
      rows: [
        { name: "مریم احمدی", roles: "مشتری، تأمین‌کننده", mobile: "9121234567", birth_date: "1370/06/31", national_id: "12345679" },
        { name: "شرکت نمونه", kind: "حقوقی", roles: "supplier", birth_date: "33333" },
      ],
    });
    expect(res.results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
    const p = await db.query(`select name, kind, roles, mobile, birth_date, national_id, detail_id is not null as has_detail from tz_parties where org_id = $1 and name in ('مریم احمدی', 'شرکت نمونه') order by code`, [org]);
    expect(p[0]).toEqual({ name: "مریم احمدی", kind: "person", roles: ["customer", "supplier"], mobile: "09121234567", birth_date: "1991-09-22", national_id: "0012345679", has_detail: true });
    expect(p[1]).toMatchObject({ kind: "company", roles: ["supplier"], birth_date: "1991-04-05" });
  });
});
