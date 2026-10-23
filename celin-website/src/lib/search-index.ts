import "server-only";
import { getCatalog } from "@/lib/catalog";
import { common } from "@/content/copy/common";
import type { SearchItem } from "@/lib/search";

const PAGES: SearchItem[] = [
  { kind: "page", slug: "care", path: "/care", name_fa: "نگهداری و ضمانت", name_en: "Care & warranty", sub_fa: "مراقبت از آبکاری، ضمانت رنگ", sub_en: "Caring for the plating, colour warranty", terms: "ضمانت گارانتی نگهداری تمیز کردن آب عطر care warranty clean guarantee" },
  { kind: "page", slug: "craft", path: "/craft", name_fa: "هنر تراش اتمی", name_en: "The atomic cut", sub_fa: "نگین‌ها و آبکاری رودیوم", sub_en: "Stones and rhodium plating", terms: "تراش اتمی رودیوم رادیوم آبکاری نگین زیرکونیا cut rhodium plating zirconia stone" },
  { kind: "page", slug: "pro", path: "/pro", name_fa: "اشتراک Pro", name_en: "Pro membership", sub_fa: "قیمت، موجودی و سفارش برای همکاران", sub_en: "Prices, stock and ordering for partners", terms: "پرو pro همکار عمده قیمت موجودی سفارش wholesale price stock order" },
  { kind: "page", slug: "contact", path: "/contact", name_fa: "تماس با ما", name_en: "Contact", sub_fa: "تلفن، واتس‌اپ، نشانی", sub_en: "Phone, WhatsApp, address", terms: "تماس تلفن واتساپ آدرس ارسال پست contact phone whatsapp address shipping delivery" },
  { kind: "page", slug: "maison", path: "/maison", name_fa: "گالری اعتماد", name_en: "Etemad Gallery", sub_fa: "داستان سلین", sub_en: "The story of CELIN", terms: "درباره داستان about story" },
];

/** Products, collections, categories and a few service pages, without prices. */
export async function buildSearchIndex(): Promise<SearchItem[]> {
  const cat = await getCatalog();
  const catName = new Map(cat.categories.map((c) => [c.slug, c]));
  const colName = new Map(cat.collections.map((c) => [c.slug, c]));
  const fa = common.fa;
  const en = common.en;
  const products: SearchItem[] = cat.products.map((p) => {
    const k = p.category ? catName.get(p.category) : undefined;
    const col = p.collection ? colName.get(p.collection) : undefined;
    const cover = p.images[0];
    return {
      kind: "product",
      slug: p.slug,
      path: `/product/${p.slug}`,
      name_fa: p.name_fa,
      name_en: p.name_en,
      sub_fa: [col?.name_fa, k?.name_fa].filter(Boolean).join(" · "),
      sub_en: [col?.name_en, k?.name_en].filter(Boolean).join(" · "),
      sku: p.sku,
      media: cover ? { src: cover.src, ext: cover.ext, widths: cover.widths, placeholder: cover.placeholder, fx: cover.fx, fy: cover.fy } : null,
      terms: [
        p.subtitle_fa,
        p.subtitle_en,
        p.metal ? `${fa.tones[p.metal]} ${en.tones[p.metal]}` : "",
        p.stone ? `${fa.stones[p.stone]} ${en.stones[p.stone]}` : "",
        ...p.variants.map((v) => `${v.name_fa} ${v.name_en} ${v.sku}`),
      ].join(" "),
    };
  });
  const collections: SearchItem[] = cat.collections.map((c) => ({
    kind: "collection",
    slug: c.slug,
    path: `/collections/${c.slug}`,
    name_fa: `مجموعه‌ی ${c.name_fa}`,
    name_en: `${c.name_en} collection`,
    sub_fa: c.tagline_fa,
    sub_en: c.tagline_en,
    media: c.media ? { src: c.media.src, ext: c.media.ext, widths: c.media.widths, placeholder: c.media.placeholder, fx: c.media.fx, fy: c.media.fy } : null,
    terms: "کالکشن مجموعه collection",
  }));
  const categories: SearchItem[] = cat.categories.map((c) => ({
    kind: "category",
    slug: c.slug,
    path: `/shop/${c.slug}`,
    name_fa: c.name_fa,
    name_en: c.name_en,
    sub_fa: c.description_fa,
    sub_en: c.description_en,
    media: c.media ? { src: c.media.src, ext: c.media.ext, widths: c.media.widths, placeholder: c.media.placeholder, fx: c.media.fx, fy: c.media.fy } : null,
    terms: c.slug,
  }));
  return [...categories, ...collections, ...products, ...PAGES];
}
