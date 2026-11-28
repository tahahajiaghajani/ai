import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakeDb } from "./stubs/fake-db";
import { CENTRE_H, CENTRE_W, GAP, heroPose, offsetOf, ringIndex, ringLength, ringNear, SIDE_H, SIDE_W, wrap } from "@/components/home/hero-pose";
import { resolveGallery } from "@/lib/slot-types";
import type { Media } from "@/lib/media";

/**
 * The turning home arcade («سرآغاز»): its rest poses are the former fixed arcade, a turn keeps the gap and hands the
 * scroll parting over smoothly; the slot keeps an ordered list of pictures (celin_slots.gallery) with the former
 * three pictures as its fallback; the server renders exactly the first view.
 */

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, prefetch: () => undefined }), usePathname: () => "/" }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: async () => undefined, isAdmin: async () => true }));
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

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
const right = (o: number, rtl: boolean) => {
  const p = heroPose(o, rtl);
  return p.left + p.width;
};

describe("the arcade's poses", () => {
  it("rest exactly where the fixed three-arch row was (45 / 27.5 / 27.5 and two 3.5% gaps, shrunk to fit)", () => {
    expect(CENTRE_W).toBeCloseTo(41.85, 9);
    expect(SIDE_W).toBeCloseTo(25.575, 9);
    for (const rtl of [true, false]) {
      const c = heroPose(0, rtl);
      close(c.left, 29.075);
      close(c.width, 41.85);
      close(c.height, 100);
      // the side heights: 3/4 arches under the 3/4.3 centre
      close(heroPose(1, rtl).height, (SIDE_H / CENTRE_H) * 100);
      expect(heroPose(1, rtl).height).toBeCloseTo(56.8475, 3);
    }
    // Persian: the next picture (o = +1) waits on the left, the previous on the right; English mirrored
    close(heroPose(1, true).left, 0);
    close(heroPose(-1, true).left, 100 - SIDE_W);
    close(heroPose(1, false).left, 100 - SIDE_W);
    close(heroPose(-1, false).left, 0);
    // the row fills the stage edge to edge, as the flex row did
    close(right(-1, true), 100);
    close(heroPose(0, true).left - right(1, true), GAP);
  });

  it("keeps the 3.5% gap between neighbours all through a turn, and side arches keep their size past the sides", () => {
    for (const rtl of [true, false]) {
      for (const f of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
        // the arch at offset f and the one a step further on the end side (f + 1), and on the start side (f − 1)
        const [a, b, c] = [heroPose(f, rtl), heroPose(f + 1, rtl), heroPose(f - 1, rtl)];
        const endGap = rtl ? a.left - (b.left + b.width) : b.left - (a.left + a.width);
        const startGap = rtl ? c.left - (a.left + a.width) : a.left - (c.left + c.width);
        close(endGap, GAP);
        close(startGap, GAP);
      }
      for (const o of [1, 1.3, 1.8, 2.5]) close(heroPose(o, rtl).width, SIDE_W);
    }
  });

  it("fades an arch out past the side, layers the centre on top and moves keystone, ring and lean with the role", () => {
    expect(heroPose(1, true).fade).toBe(1);
    // the start side faces the words on desktop: gone within 0.4 of a step; the next picture fades in from the edge
    expect(heroPose(-1.2, true).fade).toBeCloseTo(0.5, 9);
    expect(heroPose(-1.4, false).fade).toBe(0);
    expect(heroPose(1.45, true).fade).toBeCloseTo(0.5, 9);
    expect(heroPose(1.9, false).fade).toBe(0);
    expect(heroPose(2, true).fade).toBe(0);
    expect(heroPose(-2, true).fade).toBe(0);
    expect(heroPose(0.3, true).z).toBeGreaterThan(heroPose(0.7, true).z);
    expect(heroPose(0.7, true).z).toBeGreaterThan(heroPose(1.8, true).z);
    expect(heroPose(0, true).keystone).toBe(1);
    expect(heroPose(0.5, true).keystone).toBe(0);
    expect(heroPose(0, true).ringGap).toBe(12);
    expect(heroPose(1, true).ringGap).toBe(8);
    expect(heroPose(0, true).depth).toBe(7);
    expect(heroPose(-1, true).depth).toBe(14);
  });

  it("weights the scroll parting as the former tweens did: sides out by 18% and down 8% to 0.35, the centre up 6% and 4% larger", () => {
    // Persian: the start side (o = −1) is on the right and drifts right (+18), the end side drifts left (−18)
    expect(heroPose(-1, true).px).toBe(18);
    expect(heroPose(1, true).px).toBe(-18);
    expect(heroPose(-1, false).px).toBe(-18);
    expect(heroPose(1, false).px).toBe(18);
    const c = heroPose(0, true);
    expect([c.px, c.py, c.ps, c.po]).toEqual([0, -6, 0.04, 0]);
    const s = heroPose(1, true);
    expect([s.py, s.ps, s.po]).toEqual([8, 0, 0.65]);
  });

  it("runs a ring long enough for a turn: three pictures go round twice", () => {
    expect([1, 2, 3, 4, 5, 24].map(ringLength)).toEqual([4, 4, 6, 4, 5, 24]);
    expect(wrap(3, 6)).toBe(-3);
    expect(wrap(-4, 6)).toBe(2);
    expect(wrap(2.5, 6)).toBe(2.5);
    expect(ringIndex(-1, 6)).toBe(5);
    // the first view: picture 1 in the centre, 2 on the end side, the last on the start side
    const L = ringLength(8);
    expect(offsetOf(0, 0, L)).toBe(0);
    expect(offsetOf(1, 0, L)).toBe(1);
    expect(offsetOf(L - 1, 0, L)).toBe(-1);
    expect(ringNear(0, 0, 1, 6)).toEqual([0, 1, 5]);
    expect(ringNear(0, 2, 2, 8)).toEqual([0, 1, 2, 3, 4, 6, 7]);
  });
});

const pic = (k: string, id?: string): Media => ({ id, src: `/media/u/${k}`, ext: "webp", widths: [480, 960], width: 960, height: 1280, placeholder: "", fx: 50, fy: 50, alt_fa: k, alt_en: k });

describe("resolveGallery", () => {
  it("uses the stored list, falls back to the former pictures, pads to the minimum without repeats", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((k) => pic(k));
    expect(resolveGallery([], [a, c, b], 3)).toEqual([a, c, b]);
    expect(resolveGallery([d, a, b, c], [a, c, b], 3)).toEqual([d, a, b, c]);
    expect(resolveGallery([d], [a, c, b], 3)).toEqual([d, a, c]);
    expect(resolveGallery([d, d, a], [a, c, b], 3)).toEqual([d, a, c]);
  });
});

// ------------------------------------------------------------------ the slot, against the in-memory database
const SLOT_COLS = ["key", "media_id", "media_mobile_id", "video_id", "gallery", "texts", "updated_at"];
const MEDIA_COLS = ["id", "path", "ext", "widths", "width", "height", "placeholder", "focal_x", "focal_y", "alt_fa", "alt_en", "created_at"];
let fake: FakeDb;

function media(name: string) {
  const row = { id: crypto.randomUUID(), path: `uploads/${name}`, ext: "webp", widths: [480, 960], width: 960, height: 1280, placeholder: "", focal_x: 50, focal_y: 50, alt_fa: name, alt_en: name, created_at: new Date().toISOString() };
  fake.table("celin_media").push(row);
  return row.id;
}

beforeEach(() => {
  fake = new FakeDb();
  fake.columns.celin_slots = SLOT_COLS;
  fake.columns.celin_media = MEDIA_COLS;
  h.db = fake;
});

describe("the opening's list of pictures (celin_slots.gallery)", () => {
  it("shows the former three pictures in the order a (centre), c (end side), b (start side) until a list is saved", async () => {
    const { getSlots } = await import("@/lib/slots");
    const hero = (await getSlots())["home.hero.a"];
    expect(hero.gallery?.map((m) => m.src)).toEqual(["/media/seed/choker-rose", "/media/seed/earrings-sunburst", "/media/seed/set-cascade"]);
    expect(hero.media.src).toBe("/media/seed/choker-rose");
  });

  it("keeps changed former pictures in the fallback", async () => {
    const b = media("b-new");
    fake.table("celin_slots").push({ key: "home.hero.b", media_id: b, media_mobile_id: null, video_id: null, gallery: null, texts: {}, updated_at: "" });
    const { getSlots } = await import("@/lib/slots");
    expect((await getSlots())["home.hero.a"].gallery?.map((m) => m.alt_fa)).toEqual([expect.any(String), expect.any(String), "b-new"]);
  });

  it("resolves a saved list in its order, its first picture being the slot's picture", async () => {
    const ids = ["one", "two", "three", "four", "five"].map(media);
    fake.table("celin_slots").push({ key: "home.hero.a", media_id: ids[0], media_mobile_id: null, video_id: null, gallery: ids, texts: {}, updated_at: "" });
    const { getSlots } = await import("@/lib/slots");
    const hero = (await getSlots())["home.hero.a"];
    expect(hero.gallery?.map((m) => m.alt_fa)).toEqual(["one", "two", "three", "four", "five"]);
    expect(hero.media.id).toBe(ids[0]);
  });

  it("reads a database without the gallery column (before the round-six SQL) as before", async () => {
    fake.columns.celin_slots = SLOT_COLS.filter((c) => c !== "gallery");
    const a = media("a-new");
    fake.table("celin_slots").push({ key: "home.hero.a", media_id: a, media_mobile_id: null, video_id: null, texts: {}, updated_at: "" });
    const { getSlots } = await import("@/lib/slots");
    const hero = (await getSlots())["home.hero.a"];
    expect(hero.gallery?.length).toBe(3);
    expect(hero.gallery?.[0].alt_fa).toBe("a-new");
  });

  it("saves a checked list: repeats and strangers dropped, built-in pictures copied into the library, the first as the slot's picture, the former slots' rows gone", async () => {
    const ids = ["one", "two"].map(media);
    fake.table("celin_slots").push({ key: "home.hero.b", media_id: ids[1], media_mobile_id: null, video_id: null, gallery: null, texts: {}, updated_at: "" });
    fake.table("celin_slots").push({ key: "home.hero.c", media_id: null, media_mobile_id: null, video_id: null, gallery: null, texts: {}, updated_at: "" });
    const { saveSlot } = await import("@/lib/slots");
    await saveSlot("home.hero.a", { gallery: [ids[1], "seed:choker-rose", ids[1], "nope", "seed:../../etc", ids[0]], texts: {} });
    const rows = fake.table("celin_slots");
    expect(rows.map((r) => r.key)).toEqual(["home.hero.a"]);
    const row = rows[0] as { gallery: string[]; media_id: string };
    expect(row.gallery).toHaveLength(3);
    expect(row.gallery[0]).toBe(ids[1]);
    expect(row.gallery[2]).toBe(ids[0]);
    expect(row.media_id).toBe(ids[1]);
    const seedRow = fake.table("celin_media").find((m) => m.id === row.gallery[1]);
    expect(seedRow?.path).toBe("/media/seed/choker-rose");
  });

  it("refuses fewer than three and more than twenty-four pictures", async () => {
    const { saveSlot } = await import("@/lib/slots");
    const ids = Array.from({ length: 25 }, (_, i) => media(`p${i}`));
    await expect(saveSlot("home.hero.a", { gallery: ids.slice(0, 2), texts: {} })).rejects.toThrow("حداقل ۳ تصویر");
    await expect(saveSlot("home.hero.a", { gallery: ids, texts: {} })).rejects.toThrow("حداکثر ۲۴ تصویر");
    await expect(saveSlot("home.hero.a", { gallery: "x", texts: {} })).rejects.toThrow();
    expect(fake.table("celin_slots")).toHaveLength(0);
  });

  it("says plainly when the gallery column is missing", async () => {
    fake.columns.celin_slots = SLOT_COLS.filter((c) => c !== "gallery");
    const ids = ["one", "two", "three"].map(media);
    const { saveSlot } = await import("@/lib/slots");
    await expect(saveSlot("home.hero.a", { gallery: ids, texts: {} })).rejects.toThrow("ستون تصاویر سرآغاز");
    // the other slots still save
    await saveSlot("home.statement", { media_id: ids[0], texts: {} });
    expect(fake.table("celin_slots").map((r) => r.key)).toEqual(["home.statement"]);
  });

  it("goes back to the built-in pictures on reset (the former slots' rows too)", async () => {
    for (const key of ["home.hero.a", "home.hero.b", "home.hero.c", "home.statement"]) fake.table("celin_slots").push({ key, media_id: null, media_mobile_id: null, video_id: null, gallery: null, texts: {}, updated_at: "" });
    const { resetSlot } = await import("@/lib/slots");
    await resetSlot("home.hero.a");
    expect(fake.table("celin_slots").map((r) => r.key)).toEqual(["home.statement"]);
  });

  it("protects a listed picture from deletion, naming the place once", async () => {
    const ids = ["one", "two", "three"].map(media);
    fake.table("celin_slots").push({ key: "home.hero.a", media_id: ids[0], media_mobile_id: null, video_id: null, gallery: ids, texts: {}, updated_at: "" });
    const { mediaUsage } = await import("@/lib/admin-media");
    expect(await mediaUsage(ids[0])).toEqual(["تصویر سایت: صفحه‌ی اصلی — سرآغاز — تصاویر چرخان و متن"]);
    expect(await mediaUsage(ids[2])).toEqual(["تصویر سایت: صفحه‌ی اصلی — سرآغاز — تصاویر چرخان و متن"]);
  });
});

// ------------------------------------------------------------------ the server-rendered hero
describe("the hero's first render (server, and without JS)", () => {
  it("is exactly the three arches of the first view, the centre the link and the LCP picture", async () => {
    const { HomeHero } = await import("@/components/home/hero");
    const { homeCopy } = await import("@/content/copy/home");
    const pictures = Array.from({ length: 8 }, (_, i) => pic(`p${i}`, `id-${i}`));
    for (const lang of ["fa", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(HomeHero, { lang, d: { eyebrow: "e", title: "t", subtitle: "s", cta: "CTA", href: "/collections", all: "all", pictures, mobile: null, video: null, labels: homeCopy[lang].hero } }),
      );
      const items = html.match(/class="hero-item"/g) ?? [];
      expect(items).toHaveLength(3);
      // the three unveil after the intro, as before
      expect(html.match(/class="relative fx-unveil size-full"[^>]*data-fx="now"/g)).toHaveLength(3);
      // one LCP picture: the centre's (React also preloads it)
      expect(html.match(/<img [^>]*fetchPriority="high"/gi)).toHaveLength(1);
      expect(html).toMatch(/<img src="\/media\/u\/p0\/[^>]*fetchPriority="high"/);
      // the centre is the link; the sides are not
      expect(html.match(/<a [^>]*href="[^"]*collections"[^>]*aria-label="CTA"/g)).toHaveLength(1);
      expect(html).toContain("/media/u/p0/");
      expect(html).toContain("/media/u/p1/");
      expect(html).toContain("/media/u/p7/");
      expect(html).not.toContain("/media/u/p2/");
      // the controls wait for the script
      expect(html).toMatch(/data-hero-controls="true"(?![^>]*data-ready)/);
      expect(html).toContain(homeCopy[lang].hero.next);
    }
  });

  it("gives the first picture its phone version and video, in the centre only", async () => {
    const { HomeHero } = await import("@/components/home/hero");
    const { homeCopy } = await import("@/content/copy/home");
    const pictures = ["a", "c", "b"].map((k) => pic(k, `id-${k}`));
    const video = { id: "v", src: "/media/u/v/x.mp4", type: "video/mp4" as const, width: 720, height: 960, duration: 8, bytes: 1 };
    const html = renderToStaticMarkup(
      createElement(HomeHero, { lang: "fa", d: { eyebrow: "e", title: "t", subtitle: "s", cta: "CTA", href: "/collections", all: "all", pictures, mobile: pic("phone", "id-phone"), video, labels: homeCopy.fa.hero } }),
    );
    // one <picture> with the phone source, inside the centre link; the video box sits in the same arch
    expect(html.match(/<source media="\(max-width: 767px\)" srcSet="\/media\/u\/phone\//g)).toHaveLength(1);
    const centre = html.slice(html.indexOf('aria-label="CTA"'), html.indexOf('class="hero-item"', html.indexOf('aria-label="CTA"')));
    expect(centre).toContain("/media/u/phone/");
    expect(centre).toMatch(/<div aria-hidden="true" class="pointer-events-none absolute inset-0 z-\[1\] ">/);
    expect(html.match(/pointer-events-none absolute inset-0 z-\[1\] "/g)).toHaveLength(1);
  });
});
