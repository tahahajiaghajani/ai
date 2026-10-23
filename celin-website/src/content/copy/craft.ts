import { story } from "@/content/copy/story";

/**
 * /craft — «هنر ساخت»: design → cubic zirconia → precise setting → rhodium & gold plating. The step titles and
 * texts are the home page's craft slots (home.craft.1–4, editable in «تصاویر سایت»); the long text is the
 * brand's own craft chapter (story.ts). Only labels live here — no technical claims beyond those texts.
 */
export const craftCopy = {
  fa: {
    meta: {
      title: "هنر ساخت",
      description: "در سلین، هر قطعه با الهام از ساختار و ظرافت طلا و جواهر طراحی و ساخته می‌شود؛ با نگین‌های درخشان کیوبیک زیرکونیا، مخراج‌کاری دقیق و آبکاری‌های باکیفیت رودیوم و طلا.",
    },
    lede: { eyebrow: story.fa.chapters[0].title, text: story.fa.chapters[0].text },
    steps: {
      eyebrow: "چهار مرحله",
      title: "مسیر ساخت یک قطعه",
      step: (n: string) => `مرحله‌ی ${n}`,
      tags: [
        ["به‌روزترین طرح‌های روز دنیا", "دیزاینرهای بین‌المللی"],
        ["کیوبیک زیرکونیا", "تراش اتمی"],
        ["انتخاب نگین", "نشاندن هر سنگ"],
        ["رودیوم", "طلا"],
      ],
    },
    plating: { eyebrow: "آبکاری", rhodium: "رودیوم", gold: "طلا", rhodiumTone: "نقره‌ای", goldTone: "طلایی" },
    next: {
      eyebrow: "ادامه‌ی مسیر",
      title: story.fa.shine,
      care: { title: "نگهداری و ضمانت", text: "راهنمای نگهداری از آبکاری و نگین‌ها" },
      collections: { title: "مجموعه‌ها", text: "رواقِ مجموعه‌های سلین" },
    },
  },
  en: {
    meta: {
      title: "The craft",
      description: "At CELIN, every piece is designed and made after the structure and finesse of fine jewelry — with brilliant cubic zirconia, precise stone setting and quality rhodium and gold plating.",
    },
    lede: { eyebrow: story.en.chapters[0].title, text: story.en.chapters[0].text },
    steps: {
      eyebrow: "Four steps",
      title: "How a piece is made",
      step: (n: string) => `Step ${n}`,
      tags: [
        ["The latest designs of the world", "International designers"],
        ["Cubic zirconia", "Atomic cut"],
        ["Choosing each stone", "Setting each stone"],
        ["Rhodium", "Gold"],
      ],
    },
    plating: { eyebrow: "Plating", rhodium: "Rhodium", gold: "Gold", rhodiumTone: "Silver tone", goldTone: "Gold tone" },
    next: {
      eyebrow: "Continue",
      title: story.en.shine,
      care: { title: "Care & warranty", text: "Caring for the plating and the stones" },
      collections: { title: "Collections", text: "The arcade of CELIN collections" },
    },
  },
};

export type CraftCopy = (typeof craftCopy)["fa"];
