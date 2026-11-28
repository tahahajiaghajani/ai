import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown, jar: null as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => h.jar, headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7" }) }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined, refresh: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return { ...real, db: () => h.db };
});

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
  const lines = readFileSync(path.resolve(__dirname, "../docs/SETUP_FA.md"), "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith("- **به‌روزرسانی آذر ۱۴۰۵"));
  // the entry and the sub-items under it
  const rest = lines.slice(at + 1);
  const entry = [lines[at], ...rest.slice(0, rest.findIndex((l) => !l.startsWith("  ")))].join("\n");
  const collections = lines.find((l) => l.startsWith("4. **دسته‌ها و مجموعه‌ها**"))!;

  it("names everything the file enables", () => {
    expect(entry).toContain("`20261128100000_celin_round_six.sql`");
    for (const what of ["ثبت سفارش با تخفیف روزهای خاص", "فروش بسته‌ای سایزها", "رنگ‌های آبکاری، نگین و چرم", "سنجیدن جمع سفارش", "تصاویر چرخان سرآغاز", "حذف مجموعه‌ی «میرا» (فقط اگر محصولی در آن نباشد)"]) expect(entry).toContain(what);
  });

  it("says it needs the round-five file first, and that «کپی SQL» gives them in order", () => {
    expect(entry).toContain("به `20261111100000_celin_membership_pro.sql` نیاز دارد");
    expect(entry).toContain("«کپی SQL» فایل‌های اجرانشده را به‌ترتیب می‌دهد");
  });

  it("says the collections follow within an hour, and that a re-run has no effect", () => {
    expect(entry).toContain("نمایش مجموعه‌ها در سایت تا یک ساعت بعد");
    expect(entry).toContain("اجرای دوباره‌ی فایل بی‌اثر است");
  });

  it("says a collection with no picture anywhere is not listed", () => {
    expect(collections).toContain("مجموعه‌ای که نه تصویر خودش را دارد و نه اثر منتشرشده‌ی تصویردار، در فهرست‌های سایت");
    expect(entry + collections).not.toMatch(/ضمانت|زیرکونیا/);
  });

  /*
   * What the note says works before the file runs is what this code does, asked of the code itself rather than
   * written down twice: the site's order function and the sale switch are run against a database that has round
   * five's order function only (no p_expect) and no round-six record. Whichever way the code answers, the note must
   * say the same, so a note written for other code — or a merge that keeps the wrong side — fails here.
   */
  describe("before the file runs", () => {
    let fake: FakeDb;
    let jar: FakeJar;
    const ROUND_FIVE = { name: "20261111100000_celin_membership_pro" };

    beforeAll(() => {
      process.env.APP_SECRET = "test-secret-test-secret-test-secret";
    });

    beforeEach(() => {
      fake = new FakeDb();
      fake.rpcs.celin_hit_rate_limit = () => ({ data: true, error: null });
      // round five's function takes no p_expect; round six's, which also takes it, is not there yet
      fake.rpcs.celin_place_order = (args) =>
        "p_expect" in args ? { data: null, error: { message: "Could not find the function public.celin_place_order(p_customer, p_expect, p_items, p_note, p_pricing, p_user)", code: "PGRST202" } } : { data: [{ order_id: "o-1", order_code: "CL-100001" }], error: null };
      fake.table("celin_migrations").push(ROUND_FIVE);
      h.db = fake;
      jar = new FakeJar();
      h.jar = jar;
    });

    // «… قطعه‌های تک … ثبت می‌شوند / سفارش می‌دهند»: single pieces are still ordered
    const singlesOrder = /قطعه‌های تک[^.؛]*(ثبت می‌شوند|سفارش می‌دهند)/;
    // «روشن کردن … تخفیف … پیام اجرای فایل را می‌دهد»: switching the sale on asks for the file
    const saleAsks = /روشن کردن[^.؛]*تخفیف[^.؛]*پیام اجرای فایل را می‌دهد/;

    it("ordering: as src/lib/orders.ts places a member's order of single pieces", async () => {
      const { placeOrder } = await import("@/lib/orders");
      const customer = { name: "QA", phone: "09121234567", business: "", city: "Tehran", address: "Street 1", postal_code: "" };
      const lines = [{ productId: "33333333-3333-4333-8333-333333333333", variantId: null, qty: 2, pack: 1 }];
      const r = await placeOrder("11111111-1111-4111-8111-111111111111", lines, customer, "", { level: "member", listPct: 200, steps: [], sale: null }, 2_000_000);
      if (r.ok) {
        expect(entry).toMatch(singlesOrder);
        expect(entry).not.toContain("ثبت سفارش در سایت «هنوز راه‌اندازی نشده» نوشته می‌شود");
      } else {
        expect(r.error.reason).toBe("unavailable");
        expect(entry).toContain("ثبت سفارش در سایت «هنوز راه‌اندازی نشده» نوشته می‌شود");
        expect(entry).not.toMatch(singlesOrder);
      }
      // the words the note quotes are the ones the member reads
      const src = readFileSync(path.resolve(__dirname, "../src/app/actions/orders.ts"), "utf8");
      expect(/unavailable: \{ fa: "([^"]*)"/.exec(src)?.[1]).toContain("هنوز راه‌اندازی نشده");
      expect(entry).toContain("«هنوز راه‌اندازی نشده»");
    });

    it("the special-day discount: as Admin → «نوار تخفیف» saves it switched on", async () => {
      const { saveSale } = await import("@/app/actions/admin");
      const { sessionValue } = await import("@/lib/auth");
      const admin = { id: crypto.randomUUID(), phone: "09121119990", email: "", name: "QA", business: "", city: "", address: "", postal_code: "", role: "admin", disabled: false, session_version: 0, password_hash: "scrypt$x", password_from_code: false, created_by_admin: false, admin_note: "", pro_at: null, created_at: new Date().toISOString() };
      fake.table("celin_users").push(admin);
      jar.set("celin_session", sessionValue(admin.id, 0, Date.now(), "pw"));
      const r = await saveSale({ enabled: true, pct: 10, title_fa: "جشن یلدا" });
      const stored = fake.table("celin_settings").find((row) => row.key === "sale")?.value as { enabled?: boolean } | undefined;
      if (r.ok) {
        expect(stored?.enabled).toBe(true);
        expect(entry).not.toMatch(saleAsks);
      } else {
        // refused for the file (not for the sign-in), and nothing saved
        expect(r.error).toContain("20261128100000_celin_round_six");
        expect(stored).toBeUndefined();
        expect(entry).toMatch(saleAsks);
      }
    });
  });
});
