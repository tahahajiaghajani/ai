import { productCopy } from "@/content/copy/product";

/**
 * /care — «نگهداری». The care rules and the delivery steps are the product page's own texts (product.ts), so both
 * pages always say the same thing. No warranty is stated anywhere on the site (the owner's decision): the last
 * section only offers after-sales help through the store's channels; `afterSales.points` can hold one-sentence
 * items if the owner wants to list services there.
 */
export const careCopy = {
  fa: {
    meta: {
      title: "نگهداری",
      description: "راهنمای نگهداری از آبکاری و نگین‌های آثار سلین، بسته‌بندی و ارسال، و راه‌های تماس برای خدمات پس از فروش.",
    },
    rules: { eyebrow: "نگهداری", title: "چند مراقبت ساده", items: productCopy.fa.careText, note: productCopy.fa.careNote },
    delivery: { eyebrow: "سفارش", title: productCopy.fa.delivery, steps: productCopy.fa.deliveryText },
    afterSales: {
      eyebrow: "پشتیبانی",
      title: "خدمات پس از فروش",
      body: "برای خدمات پس از فروش هر قطعه، لطفاً با ما تماس بگیرید؛ با کمال میل راهنمایی‌تان می‌کنیم.",
      points: [] as string[],
      contact: "تماس با ما",
      whatsapp: "گفتگو در واتس‌اپ",
      call: "تماس تلفنی",
    },
    more: { craft: "هنر ساخت", shop: "همه‌ی زیورآلات" },
  },
  en: {
    meta: {
      title: "Care",
      description: "How to care for the plating and stones of your CELIN pieces, packaging and delivery, and how to reach us for after-sales care.",
    },
    rules: { eyebrow: "Care", title: "A few simple habits", items: productCopy.en.careText, note: productCopy.en.careNote },
    delivery: { eyebrow: "Orders", title: productCopy.en.delivery, steps: productCopy.en.deliveryText },
    afterSales: {
      eyebrow: "Support",
      title: "After-sales care",
      body: "For after-sales care of any piece, please contact us — we will gladly help.",
      points: [] as string[],
      contact: "Contact us",
      whatsapp: "Chat on WhatsApp",
      call: "Call us",
    },
    more: { craft: "The craft", shop: "All jewelry" },
  },
};

export type CareCopy = (typeof careCopy)["fa"];
