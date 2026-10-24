import { story } from "@/content/copy/story";

/**
 * /craft — «هنر ساخت»: design → the stones → precise setting → rhodium & gold plating. The step titles and
 * texts are the home page's craft slots (home.craft.1–4, editable in «تصاویر سایت»); the long text is the
 * brand's own craft chapter (story.ts). Only labels live here — no technical claims beyond those texts.
 */
export const craftCopy = {
  fa: {
    meta: {
      title: "هنر ساخت",
      description: "در سلین، هر قطعه با الهام از ساختار و ظرافت طلا و جواهر طراحی و ساخته می‌شود؛ با نگین‌های درخشان، مخراج‌کاری دقیق و آبکاری‌های باکیفیت رودیوم و طلا.",
    },
    lede: { eyebrow: story.fa.chapters[0].title, text: story.fa.chapters[0].text },
    steps: {
      eyebrow: "چهار مرحله",
      title: "مسیر ساخت یک قطعه",
      step: "مرحله‌ی",
      tags: [
        ["به‌روزترین طرح‌های روز دنیا", "دیزاینرهای بین‌المللی"],
        ["نگین‌های درخشان", "تراش اتمی"],
        ["انتخاب نگین", "نشاندن هر سنگ"],
        ["رودیوم", "طلا"],
      ],
    },
    plating: { eyebrow: "آبکاری", rhodium: "رودیوم", gold: "طلا", rhodiumTone: "نقره‌ای", goldTone: "طلایی" },
    next: {
      eyebrow: "ادامه‌ی مسیر",
      title: "زیبایی، در جزئیات",
      care: { title: "نگهداری و ضمانت", text: "راهنمای نگهداری از آبکاری و نگین‌ها" },
      collections: { title: "مجموعه‌ها", text: "هر مجموعه با نام، رنگ و داستان خود" },
    },
  },
  en: {
    meta: {
      title: "The craft",
      description: "At CELIN, every piece is designed and made in the spirit of gold and jewels, with their structure and finesse: brilliant stones, precise stone setting and quality rhodium and gold plating.",
    },
    lede: { eyebrow: story.en.chapters[0].title, text: story.en.chapters[0].text },
    steps: {
      eyebrow: "Four steps",
      title: "How a piece is made",
      step: "Step",
      tags: [
        ["The latest designs from around the world", "International designers"],
        ["Brilliant stones", "Atomic cut"],
        ["Choosing each stone", "Setting each stone"],
        ["Rhodium", "Gold"],
      ],
    },
    plating: { eyebrow: "Plating", rhodium: "Rhodium", gold: "Gold", rhodiumTone: "Silver tone", goldTone: "Gold tone" },
    next: {
      eyebrow: "Continue",
      title: "Beauty, in the details",
      care: { title: "Care & warranty", text: "Caring for the plating and the stones" },
      collections: { title: "Collections", text: "Each with its own name, color and story" },
    },
  },
};

export type CraftCopy = (typeof craftCopy)["fa"];
