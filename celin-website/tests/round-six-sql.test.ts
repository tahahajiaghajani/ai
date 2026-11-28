import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sixth round's SQL file builds on the fifth's (20261111100000_celin_membership_pro.sql). Pasted on its own, out of
 * order, it would apply and record itself while the order lines lack their list price, and the fifth round's file run
 * afterwards would bring «میرا» and its older order function back. So the file stops before anything else when the
 * fifth round is not recorded; the SQL Editor runs a pasted script as one transaction, so nothing of it applies.
 * (Checked on private copies of the database: it applies twice with the same result, and without the fifth round's
 * record it raises and leaves the database byte for byte as it was.)
 */
const FILE = path.resolve(__dirname, "../supabase/migrations/20261128100000_celin_round_six.sql");
const sql = readFileSync(FILE, "utf8");
/** the statements in order, without comment lines (enough for this file: no `--` inside strings before the guard) */
const code = sql
  .split("\n")
  .filter((l) => !/^\s*--/.test(l))
  .join("\n")
  .trim();

describe("the round-six SQL file", () => {
  it("starts with the guard: nothing runs before it", () => {
    expect(code.startsWith("do $$\nbegin\n")).toBe(true);
    const guard = code.slice(0, code.indexOf("end $$;") + "end $$;".length);
    expect(guard).toContain("to_regclass('public.celin_migrations') is null");
    expect(guard).toContain("if not exists (select 1 from public.celin_migrations where name = '20261111100000_celin_membership_pro') then");
    expect(guard.match(/raise exception 'CELIN round six: run 20261111100000_celin_membership_pro\.sql/g)).toHaveLength(2);
    // the guard only reads
    expect(guard).not.toMatch(/\b(insert|update|delete|alter|create|drop)\b/i);
  });

  it("checks the table before reading it, so a database without it gets the same clear message", () => {
    expect(code.indexOf("to_regclass('public.celin_migrations') is null")).toBeLessThan(code.indexOf("from public.celin_migrations where name = '20261111100000_celin_membership_pro'"));
  });

  it("still records itself last, so a re-run passes the guard and changes nothing", () => {
    expect(code).toContain("insert into public.celin_migrations (name) values ('20261128100000_celin_round_six') on conflict (name) do nothing;");
    expect(code.indexOf("insert into public.celin_migrations (name) values ('20261128100000_celin_round_six')")).toBeGreaterThan(code.indexOf("drop function if exists public.celin_place_order(uuid, jsonb, jsonb, text, jsonb);"));
  });
});

describe("the owner's note on the round-six file (docs/SETUP_FA.md)", () => {
  const setup = readFileSync(path.resolve(__dirname, "../docs/SETUP_FA.md"), "utf8");
  const entry = setup.split("\n").find((l) => l.startsWith("- **به‌روزرسانی آذر ۱۴۰۵"))!;
  const collections = setup.split("\n").find((l) => l.startsWith("4. **دسته‌ها و مجموعه‌ها**"))!;

  it("names everything the file enables", () => {
    expect(entry).toContain("`20261128100000_celin_round_six.sql`");
    for (const what of ["ثبت سفارش با تخفیف روزهای خاص", "فروش بسته‌ای سایزها", "رنگ‌های آبکاری، نگین و چرم", "سنجیدن جمع سفارش", "تصاویر چرخان سرآغاز", "حذف مجموعه‌ی «میرا» (فقط اگر محصولی در آن نباشد)"]) expect(entry).toContain(what);
  });

  it("says it needs the round-five file first, and that «کپی SQL» gives them in order", () => {
    expect(entry).toContain("به `20261111100000_celin_membership_pro.sql` نیاز دارد");
    expect(entry).toContain("«کپی SQL» فایل‌های اجرانشده را به‌ترتیب می‌دهد");
  });

  it("says what works before it runs, and that the collections follow within an hour", () => {
    expect(entry).toContain("اعضا همچنان قطعه‌های تک را بدون تخفیف روزهای خاص سفارش می‌دهند");
    expect(entry).toContain("بسته‌ها، رنگ‌ها و روشن کردن تخفیف روزهای خاص منتظر این فایل می‌مانند");
    expect(entry).toContain("نمایش مجموعه‌ها در سایت تا یک ساعت بعد");
    expect(entry).toContain("اجرای دوباره‌ی فایل بی‌اثر است");
  });

  it("says a collection with no picture anywhere is not listed", () => {
    expect(collections).toContain("مجموعه‌ای که نه تصویر خودش را دارد و نه اثر منتشرشده‌ی تصویردار، در فهرست‌های سایت");
    expect(entry + collections).not.toMatch(/ضمانت|زیرکونیا/);
  });
});
