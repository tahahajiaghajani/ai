import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";
import { prunePending, shownValue, type Want } from "@/components/admin/pending";

/**
 * Admin → دسته‌ها و مجموعه‌ها, «نمایش» (and «انتشار» in Products): the switch shows its new state the moment it is
 * pressed and goes back if the change fails, and the switch writes only `visible` — a row drawn from an older copy
 * of the list never writes its picture, order or texts back over fresher ones.
 */

const h = vi.hoisted(() => ({ db: null as unknown, jar: null as unknown, refreshed: 0 }));

vi.mock("next/headers", () => ({ cookies: async () => h.jar, headers: async () => new Headers() }));
vi.mock("next/cache", () => ({
  unstable_cache: <T>(fn: T) => fn,
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  refresh: () => {
    h.refreshed++;
  },
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...real,
    db: () => h.db,
    requireDb: () => {
      if (!h.db) throw new real.UserError("db");
      return h.db;
    },
  };
});

const ID = "5b0f6d1e-3a43-4c4e-9d55-0d9a3c1f2b77";
let fake: FakeDb;

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
});

beforeEach(() => {
  fake = new FakeDb();
  h.db = fake;
  h.jar = new FakeJar();
  h.refreshed = 0;
  delete process.env.ADMIN_PASSWORD;
  fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
  fake.table("celin_collections").push({ id: ID, slug: "negar", name_fa: "نگار", name_en: "Negar", tagline_fa: "", tagline_en: "", story_fa: "داستان", story_en: "", media_id: "m1", sort: 3, visible: false });
});

async function asAdmin() {
  process.env.ADMIN_PASSWORD = "the-admin-pass-1";
  const { startSession } = await import("@/lib/admin-auth");
  await startSession();
}

describe("setTaxonVisible", async () => {
  const { setTaxonVisible } = await import("@/lib/admin-catalog");

  it("writes only `visible`: the row's picture, order and texts stay as they are", async () => {
    await asAdmin();
    await setTaxonVisible("collections", ID, true);
    const row = fake.table("celin_collections")[0];
    expect(row).toMatchObject({ visible: true, media_id: "m1", sort: 3, story_fa: "داستان", slug: "negar" });
    const writes = fake.calls.filter((c) => c.op === "update" && c.table === "celin_collections");
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0].values ?? {}).sort()).toEqual(["updated_at", "visible"]);
  });

  it("refuses an id it does not know", async () => {
    await asAdmin();
    await expect(setTaxonVisible("collections", "not-a-uuid", true)).rejects.toThrow(/پیدا نشد/);
    await expect(setTaxonVisible("collections", "0a2c6c7e-2f2d-4b0b-8a5e-6b1a9c2f1e00", true)).rejects.toThrow(/پیدا نشد/);
    expect(fake.table("celin_collections")[0].visible).toBe(false);
  });

  it("needs the admin session", async () => {
    await expect(setTaxonVisible("collections", ID, true)).rejects.toThrow("unauthorized");
    expect(fake.table("celin_collections")[0].visible).toBe(false);
  });
});

describe("adminSetTaxonVisible", async () => {
  const { adminSetTaxonVisible } = await import("@/app/actions/admin-catalog");

  it("says what the site now does and refreshes the panel page", async () => {
    await asAdmin();
    expect(await adminSetTaxonVisible({ kind: "collections", id: ID, visible: true })).toEqual({ ok: true, message: "در سایت نمایش داده می‌شود.", visible: true });
    expect(fake.table("celin_collections")[0].visible).toBe(true);
    expect(await adminSetTaxonVisible({ kind: "collections", id: ID, visible: false })).toEqual({ ok: true, message: "از سایت پنهان شد.", visible: false });
    expect(fake.table("celin_collections")[0].visible).toBe(false);
    expect(h.refreshed).toBe(2);
  });

  it("answers with the session message when the admin is signed out (the switch then goes back)", async () => {
    expect(await adminSetTaxonVisible({ kind: "collections", id: ID, visible: true })).toEqual({ ok: false, error: "نشست شما منقضی شده است؛ دوباره وارد شوید." });
    expect(fake.table("celin_collections")[0].visible).toBe(false);
  });
});

describe("a pressed switch until the page catches up", () => {
  const want = (to: boolean, from: boolean): Want<boolean> => ({ to, from });

  it("shows the new state while the page still holds the old one", () => {
    expect(shownValue(want(true, false), false)).toBe(true);
    expect(shownValue(undefined, false)).toBe(false);
    // the page moved (its refresh arrived, or another save changed it): the page leads
    expect(shownValue(want(true, false), true)).toBe(true);
    expect(shownValue(want(false, true), false)).toBe(false);
  });

  it("drops a change once its row moved or is gone, and keeps the others (one row's refresh is not another's)", () => {
    const wants = new Map([
      ["a", want(true, false)],
      ["b", want(true, false)],
      ["c", want(false, true)],
    ]);
    // the refreshed page after a's change: a is now true, b's change has not landed yet, c was deleted
    const out = prunePending(wants, new Map([["a", true], ["b", false]]));
    expect([...out.keys()]).toEqual(["b"]);
    // nothing to drop: the same map comes back (no re-render)
    expect(prunePending(out, new Map([["b", false]]))).toBe(out);
  });

  it("is what the row switch and the publish button use", () => {
    const taxa = readFileSync(path.resolve(__dirname, "../src/components/admin/taxa-manager.tsx"), "utf8");
    expect(taxa).toContain("adminSetTaxonVisible({ kind, id: t.id, visible })");
    expect(taxa).not.toMatch(/adminSaveTaxon\(\{ kind, \.\.\.t/);
    expect(taxa).toContain("usePending(items, (t) => t.visible)");
    const products = readFileSync(path.resolve(__dirname, "../src/components/admin/product-list.tsx"), "utf8");
    expect(products).toContain("usePending(items, (p) => p.status)");
    expect(products).toContain("{ onError: onStatusFailed }");
  });
});
