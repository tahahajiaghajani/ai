/** Shop listing copy (fa / en, same shape). Materials as the brand states them (story.ts). */
export const shopCopy = {
  fa: {
    eyebrow: "زیورآلات سلین",
    intro: "نگین‌های درخشان با تراش مشابه برلیان، مخراج‌کاری دقیق و آبکاری رودیوم، طلا و شامپاین گلد.",
    categories: "دسته‌های زیورآلات",
    all: "همه",
    pieces: (n: string) => `${n} اثر`,
    editorial: "از مجموعه‌ها",
  },
  en: {
    eyebrow: "CELIN jewelry",
    intro: "Brilliant stones with a diamond-like cut, precise setting, rhodium, gold and champagne-gold plating.",
    categories: "Jewelry categories",
    all: "All",
    pieces: (n: string) => (n === "1" ? "1 piece" : `${n} pieces`),
    editorial: "From the collections",
  },
};

export type ShopCopy = (typeof shopCopy)["fa"];
