/** Shop listing copy (fa / en, same shape). Materials as the brand states them (story.ts). */
export const shopCopy = {
  fa: {
    eyebrow: "جواهرات سلین",
    intro: "نگین‌های درخشان کیوبیک زیرکونیا، مخراج‌کاری دقیق و آبکاری رودیوم و طلا.",
    categories: "دسته‌های جواهرات",
    all: "همه",
    pieces: (n: string) => `${n} اثر`,
    editorial: "از مجموعه‌ها",
  },
  en: {
    eyebrow: "CELIN jewelry",
    intro: "Brilliant cubic zirconia, precise setting, rhodium and gold plating.",
    categories: "Jewelry categories",
    all: "All",
    pieces: (n: string) => `${n} pieces`,
    editorial: "From the collections",
  },
};

export type ShopCopy = (typeof shopCopy)["fa"];
