/** /collections and /collections/[slug] — labels only; names, taglines and stories come from celin_collections. */
export const collectionsCopy = {
  fa: {
    meta: { title: "مجموعه‌ها", description: "مجموعه‌های سلین؛ هر مجموعه با نام، رنگ و داستان خود — زیورآلات سبک جواهری با نگین‌های کیوبیک زیرکونیا و آبکاری رودیوم و طلا." },
    index: { eyebrow: "مجموعه‌های سلین", title: "رواقِ مجموعه‌ها", count: (n: string) => `${n} مجموعه`, discover: "کشف مجموعه" },
    pieces: (n: string) => `${n} اثر`,
    collection: "مجموعه",
    see: "مشاهده‌ی آثار",
    story: "داستان مجموعه",
    piecesTitle: (name: string) => `آثار مجموعه‌ی ${name}`,
    piecesEyebrow: "آثار",
    empty: "آثار این مجموعه به‌زودی این‌جا قرار می‌گیرند.",
    others: { eyebrow: "مجموعه‌های دیگر", title: "رواقِ مجموعه‌ها", all: "همه‌ی مجموعه‌ها", discover: "کشف مجموعه" },
    closing: { title: "همه‌ی آثار سلین، در یک نگاه", shop: "همه‌ی جواهرات", craft: "هنر ساخت" },
  },
  en: {
    meta: { title: "Collections", description: "The CELIN collections — each with its own name, colour and story: fine-jewelry-style pieces with cubic zirconia and rhodium and gold plating." },
    index: { eyebrow: "CELIN collections", title: "The arcade of collections", count: (n: string) => `${n} collections`, discover: "Discover" },
    pieces: (n: string) => `${n} pieces`,
    collection: "Collection",
    see: "See the pieces",
    story: "The story",
    piecesTitle: (name: string) => `The ${name} pieces`,
    piecesEyebrow: "Pieces",
    empty: "The pieces of this collection will be here soon.",
    others: { eyebrow: "More collections", title: "The arcade of collections", all: "All collections", discover: "Discover" },
    closing: { title: "Every CELIN piece, at a glance", shop: "All jewelry", craft: "The craft" },
  },
};

export type CollectionsCopy = (typeof collectionsCopy)["fa"];
