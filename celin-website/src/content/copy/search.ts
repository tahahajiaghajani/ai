/** The search (the overlay under the header's search icon, and the /search results page). */
export const searchCopy = {
  fa: {
    meta: { title: "جستجو", description: "جستجو در زیورآلات، مجموعه‌ها و صفحه‌های سلین." },
    title: "جستجو",
    kinds: { category: "دسته", collection: "مجموعه", page: "صفحه", product: "" },
    none: (q: string) => `نتیجه‌ای برای «${q}» پیدا نشد.`,
    count: (n: string) => `${n} نتیجه`,
    all: (n: string) => `همه‌ی ${n} نتیجه`,
    browse: "یا از میان دسته‌ها و مجموعه‌ها:",
    noScript: "نتیجه‌ها با جاوااسکریپت نمایش داده می‌شوند؛ از دسته‌ها و مجموعه‌های زیر هم می‌توانید شروع کنید.",
  },
  en: {
    meta: { title: "Search", description: "Search CELIN jewelry, collections and pages." },
    title: "Search",
    kinds: { category: "Category", collection: "Collection", page: "Page", product: "" },
    none: (q: string) => `No results for “${q}”.`,
    count: (n: string) => `${n} results`,
    all: (n: string) => `All ${n} results`,
    browse: "Or start from a category or collection:",
    noScript: "Results need JavaScript; you can also start from the categories and collections below.",
  },
};
