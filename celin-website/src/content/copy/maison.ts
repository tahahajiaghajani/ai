import { story } from "@/content/copy/story";

/**
 * /maison — «داستان سلین». The story itself is the brand's own text in story.ts (used verbatim); this file
 * only holds the page's small labels. Same shape in both languages.
 */
export const maisonCopy = {
  fa: {
    meta: { title: "داستان سلین", description: story.fa.born },
    prologue: { eyebrow: "آغاز", year: 1385 },
    chapter: (n: string) => `فصل ${n}`,
    chapters: { eyebrow: "فصل‌ها", title: "چهار فصل از یک مسیر" },
    timeline: {
      eyebrow: "۲۰ سال درخشش",
      from: 1385,
      to: 1405,
      fromLabel: "تولد سلین",
      toLabel: "افتتاح وب‌سایت رسمی سلین",
      years: "سال درخشش",
      count: 20,
    },
    letter: { eyebrow: "بیستمین سال", signature: "گالـــری اعتـــماد", signatureLabel: "گالری اعتماد" },
    closing: { collections: "مشاهده‌ی مجموعه‌ها", craft: "هنر ساخت" },
    scroll: "ادامه",
  },
  en: {
    meta: { title: "Our story", description: story.en.born },
    prologue: { eyebrow: "The beginning", year: 2006 },
    chapter: (n: string) => `Chapter ${n}`,
    chapters: { eyebrow: "Chapters", title: "Four chapters of one path" },
    timeline: {
      eyebrow: "Twenty years of brilliance",
      from: 2006,
      to: 2026,
      fromLabel: "CELIN is born",
      toLabel: "CELIN's official website opens",
      years: "years of brilliance",
      count: 20,
    },
    letter: { eyebrow: "The twentieth year", signature: "Etemad Gallery", signatureLabel: "Etemad Gallery" },
    closing: { collections: "Discover the collections", craft: "The craft" },
    scroll: "Scroll",
  },
};

export type MaisonCopy = (typeof maisonCopy)["fa"];
