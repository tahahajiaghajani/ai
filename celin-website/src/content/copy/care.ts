import { productCopy } from "@/content/copy/product";

/**
 * /care — «نگهداری و ضمانت». The care rules and the delivery steps are the product page's own texts
 * (product.ts), so both pages always say the same thing.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ WARRANTY — TO BE WRITTEN BY THE OWNER (متن ضمانت را صاحب فروشگاه تکمیل کند)                  │
 * │ The `warranty` texts below are a placeholder that only invites the visitor to contact CELIN. │
 * │ No warranty terms (duration, what is covered, how a claim works) are stated anywhere on the  │
 * │ site yet. When the terms are decided, replace `warranty.body` (and add `warranty.points`     │
 * │ items, one sentence each) in both languages; the page renders whatever is here.              │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export const careCopy = {
  fa: {
    meta: {
      title: "نگهداری و ضمانت",
      description: "راهنمای نگهداری از آبکاری و نگین‌های آثار سلین، بسته‌بندی و ارسال، و راه‌های تماس برای پشتیبانی.",
    },
    rules: { eyebrow: "نگهداری", title: "چند مراقبت ساده", items: productCopy.fa.careText, note: productCopy.fa.careNote },
    delivery: { eyebrow: "سفارش", title: productCopy.fa.delivery, steps: productCopy.fa.deliveryText },
    warranty: {
      eyebrow: "ضمانت",
      title: "ضمانت و خدمات پس از فروش",
      // EDIT: placeholder until the owner writes the warranty terms (see the box above)
      body: "برای اطلاع از شرایط ضمانت و خدمات پس از فروش هر قطعه، لطفاً با ما تماس بگیرید؛ با کمال میل راهنمایی‌تان می‌کنیم.",
      points: [] as string[],
      contact: "تماس با ما",
      whatsapp: "گفتگو در واتس‌اپ",
      call: "تماس تلفنی",
    },
    more: { craft: "هنر ساخت", shop: "همه‌ی زیورآلات" },
  },
  en: {
    meta: {
      title: "Care & warranty",
      description: "How to care for the plating and stones of your CELIN pieces, packaging and delivery, and how to reach us for support.",
    },
    rules: { eyebrow: "Care", title: "A few simple habits", items: productCopy.en.careText, note: productCopy.en.careNote },
    delivery: { eyebrow: "Orders", title: productCopy.en.delivery, steps: productCopy.en.deliveryText },
    warranty: {
      eyebrow: "Warranty",
      title: "Warranty & after-sales care",
      // EDIT: placeholder until the owner writes the warranty terms (see the box above)
      body: "For the warranty and after-sales care of any piece, please contact us — we will gladly help.",
      points: [] as string[],
      contact: "Contact us",
      whatsapp: "Chat on WhatsApp",
      call: "Call us",
    },
    more: { craft: "The craft", shop: "All jewelry" },
  },
};

export type CareCopy = (typeof careCopy)["fa"];
