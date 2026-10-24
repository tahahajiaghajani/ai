import { describe, expect, it } from "vitest";
import { clip, collectionDescription, productDescription } from "@/lib/seo";

// the seeded texts of three collections (celin_collections), as the meta descriptions see them
const negar = {
  tagline_fa: "نقش، در خط‌های ظریف",
  tagline_en: "Patterns in fine engraved lines",
  story_fa: "نگار یعنی نقش و هم‌چنین محبوب. سطح‌های حکاکی‌شده‌ی خطی با یک نگین مارکیز رنگی، در دو رنگ طلایی و نقره‌ای؛ کنار هم بهتر دیده می‌شوند.",
  story_en: "Negar means both an engraved image and the beloved. Finely lined, engraved surfaces with a single colored marquise, in gold and silver tones — better worn together.",
};
const del = {
  tagline_fa: "برای آنچه دل می‌گوید",
  tagline_en: "For what the heart says",
  story_fa: "قلب‌هایی در قاب‌های شیاردار طلایی و نقره‌ای؛ هدیه‌ای که هر روز به دست می‌شود، تنها یا دوتایی.",
  story_en: "Hearts set in ribbed gold-tone and silver-tone frames — a gift worn every day, alone or as a pair.",
};
const yas = {
  tagline_fa: "نورِ سفید، از نزدیک",
  tagline_en: "White light, up close",
  story_fa: "یاس، گلی سفید که بویش پیش از خودش می‌رسد. ردیف‌های پیوسته‌ی نگین‌های سفید با تراش اتمی، که هر کدام جدا نشانده شده‌اند تا از هر زاویه نور را برگردانند؛ گاهی در مرکز به یک گل می‌رسند.",
  story_en: "Yas is jasmine, the white flower you notice before you see it. Unbroken rows of white atomic-cut stones, each set on its own to return the light from every angle — sometimes meeting in a single flower.",
};

describe("collection meta description", () => {
  it("ends on a whole sentence instead of a clipped «in gold…»", () => {
    const d = collectionDescription(negar, "en");
    expect(d).toBe("Patterns in fine engraved lines — Negar means both an engraved image and the beloved.");
    expect(d).not.toMatch(/gold…|silver…/);
  });

  it("keeps every whole sentence that fits, in both languages, within 160 characters", () => {
    for (const c of [negar, del, yas]) {
      for (const lang of ["fa", "en"] as const) {
        const d = collectionDescription(c, lang);
        expect(d.length).toBeLessThanOrEqual(160);
        expect(d.endsWith(".")).toBe(true);
        expect(d.startsWith(lang === "fa" ? c.tagline_fa : c.tagline_en)).toBe(true);
      }
    }
    expect(collectionDescription(del, "en")).toBe(`${del.tagline_en} — ${del.story_en}`);
  });

  it("falls back to a word-boundary cut only when not even the first sentence fits", () => {
    const long = { tagline_fa: "", tagline_en: "", story_fa: "", story_en: `${"A very long sentence about the pieces ".repeat(6).trim()}.` };
    const d = collectionDescription(long, "en");
    expect(d).toBe(clip(long.story_en));
    expect(d.endsWith("…")).toBe(true);
    expect(d.length).toBeLessThanOrEqual(160);
    // no tagline: the story alone
    expect(collectionDescription({ ...negar, tagline_fa: "", tagline_en: "" }, "en")).toBe("Negar means both an engraved image and the beloved.");
  });
});

describe("product meta description (Persian)", () => {
  const p = { name_fa: "نگار · النگو", name_en: "Negar Bangle", subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "" };
  const collection = { name_fa: "نگار", name_en: "Negar" };

  it("never puts the indefinite ی on a compound category («دستبند و النگویی»)", () => {
    const d = productDescription(p, "fa", { category: { name_fa: "دستبند و النگو", name_en: "Bracelets & bangles" }, collection });
    expect(d).toContain("نگار · النگو، اثری از مجموعه‌ی نگار سلین");
    expect(d).not.toContain("النگویی");
  });

  it("still names a single-word category as «a ring», «an earring»", () => {
    expect(productDescription(p, "fa", { category: { name_fa: "انگشتر", name_en: "Rings" }, collection })).toContain("، انگشتری از مجموعه‌ی نگار سلین");
    expect(productDescription(p, "fa", { category: { name_fa: "گوشواره", name_en: "Earrings" }, collection })).toContain("، گوشواره‌ای از مجموعه‌ی نگار سلین");
  });
});
