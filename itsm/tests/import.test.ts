import { describe, it, expect, beforeAll } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import "./fixtures/module";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { readSpreadsheet, parseCsv } from "@shared/sheet";
import type { Db } from "@server/db";

describe("spreadsheet reader", () => {
  it("reads the first sheet of an .xlsx file", async () => {
    const buf = await writeXlsxFile(
      [
        [{ value: "کد" }, { value: "نام" }, { value: "تعداد" }],
        [{ value: "101" }, { value: "سرور & ذخیره‌ساز <ویژه>" }, { type: Number, value: 250000 }],
        [null, { value: "کابل" }, { type: Number, value: 0.1 + 0.2 }],
        [],
      ] as never,
      { sheet: "دارایی‌ها" },
    ).toBuffer();
    const r = await readSpreadsheet("items.xlsx", new Uint8Array(buf));
    expect(r.sheet).toBe("دارایی‌ها");
    expect(r.rows).toEqual([
      ["کد", "نام", "تعداد"],
      ["101", "سرور & ذخیره‌ساز <ویژه>", "250000"],
      ["", "کابل", "0.3"],
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

describe("bulk import of master data (the fixture module's entities)", () => {
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
      { name: "سوئیچ ۲۴ پورت", kind: "سخت‌افزار", group_id: "شبکه", qty: "۱۲", is_active: "بله" },
      { name: "روتر", kind: "hardware", group_id: "شبکه", qty: "3" },
      { name: "بدون نوع درست", kind: "خودرو", qty: "1" },
      { name: "", kind: "", qty: "" },
      { name: "مجوز", kind: "نرم‌افزار", qty: "abc" },
    ];
    const dry = await c.post(`/o/${org}/data/test_item/import`, { rows, dry_run: true });
    expect(dry).toMatchObject({ created: 2, failed: 2, dry_run: true });
    expect(dry.results.find((r: { row: number }) => r.row === 2).error).toContain("نوع");
    const count = async () => (await db.one<{ n: number }>(`select count(*)::int as n from sm_test_items where org_id = $1`, [org]))!.n;
    const before = await count();
    expect(await db.one(`select 1 from sm_test_groups where org_id = $1 and name = 'شبکه'`, [org])).toBeNull();

    const res = await c.post(`/o/${org}/data/test_item/import`, { rows, offset: 10 });
    expect(res).toMatchObject({ created: 2, updated: 0, failed: 2 });
    expect(res.results.map((r: { row: number }) => r.row)).toEqual([10, 11, 12, 14]);
    expect(await count()).toBe(before + 2);
    const items = await db.query(`select i.name, i.kind, i.qty::text as qty, i.is_active, g.name as grp from sm_test_items i
      join sm_test_groups g on g.id = i.group_id where i.org_id = $1 and g.name = 'شبکه' order by i.code`, [org]);
    expect(items).toEqual([
      { name: "سوئیچ ۲۴ پورت", kind: "hardware", qty: "12", is_active: true, grp: "شبکه" },
      { name: "روتر", kind: "hardware", qty: "3", is_active: true, grp: "شبکه" },
    ]);
    // the group was created once, by name (autoCreate), and then matched
    const groups = await db.one<{ n: number }>(`select count(*)::int as n from sm_test_groups where org_id = $1 and name = 'شبکه'`, [org]);
    expect(groups!.n).toBe(1);
  });

  it("updates rows with an existing code only when asked", async () => {
    const sw = await db.one<{ code: string }>(`select code from sm_test_items where org_id = $1 and name = 'سوئیچ ۲۴ پورت'`, [org]);
    const rows = [{ code: sw!.code, name: "سوئیچ ۴۸ پورت", qty: "2" }];
    const refused = await c.post(`/o/${org}/data/test_item/import`, { rows });
    expect(refused.failed).toBe(1);
    expect(refused.results[0].error).toContain("وجود دارد");
    const ok = await c.post(`/o/${org}/data/test_item/import`, { rows, update_existing: true });
    expect(ok).toMatchObject({ updated: 1, failed: 0 });
    const item = await db.one(`select name, qty::text as qty, group_id is not null as has_group from sm_test_items where org_id = $1 and code = $2`, [org, sw!.code]);
    expect(item).toEqual({ name: "سوئیچ ۴۸ پورت", qty: "2", has_group: true });
    const dup = await c.post(`/o/${org}/data/test_item/import`, { rows: [{ code: "777", name: "الف" }, { code: "۷۷۷", name: "ب" }] });
    expect(dup.failed).toBe(1);
    expect(dup.results[1].error).toContain("تکراری");
  });

  it("reads option labels, lists of labels, Jalali and Excel dates and mobile numbers without the leading zero", async () => {
    const res = await c.post(`/o/${org}/data/test_item/import`, {
      rows: [
        { name: "لپ‌تاپ مدیر", kind: "سخت‌افزار", tags: "حیاتی، مشترک", mobile: "9121234567", starts_on: "1370/06/31", email: "it@example.com" },
        { name: "پشتیبانی سالانه", kind: "خدمت", tags: "spare", starts_on: "33333" },
      ],
    });
    expect(res.results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
    const p = await db.query(`select name, kind, tags, mobile, to_char(starts_on, 'YYYY-MM-DD') as starts_on, email from sm_test_items where org_id = $1 and name in ('لپ‌تاپ مدیر', 'پشتیبانی سالانه') order by code`, [org]);
    expect(p[0]).toEqual({ name: "لپ‌تاپ مدیر", kind: "hardware", tags: ["critical", "shared"], mobile: "09121234567", starts_on: "1991-09-22", email: "it@example.com" });
    expect(p[1]).toMatchObject({ kind: "service", tags: ["spare"], starts_on: "1991-04-05" });
    const bad = await c.post(`/o/${org}/data/test_item/import`, { rows: [{ name: "بد", tags: "نامعلوم" }, { name: "بد۲", email: "not-mail" }] });
    expect(bad.failed).toBe(2);
  });
});
