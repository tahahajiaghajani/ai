/** /contact — labels only; the numbers, handles, hours and address come from Admin → Settings → Contact. */
export const contactCopy = {
  fa: {
    meta: { title: "تماس با سلین", description: "راه‌های تماس با سلین — گالری اعتماد: واتس‌اپ، تلفن، اینستاگرام و تلگرام، ساعات پاسخ‌گویی و نشانی." },
    channels: { eyebrow: "راه‌های ارتباط", title: "از هر راهی که آسان‌تر است" },
    whatsapp: { label: "واتس‌اپ", action: "گفتگو در واتس‌اپ" },
    phone: { label: "تلفن", action: "تماس تلفنی" },
    instagram: { label: "اینستاگرام", action: "صفحه‌ی اینستاگرام" },
    telegram: { label: "تلگرام", action: "پیام در تلگرام" },
    email: { label: "ایمیل", action: "نوشتن ایمیل" },
    hours: "ساعات پاسخ‌گویی",
    address: "نشانی",
    map: "مسیریابی روی نقشه",
    help: {
      eyebrow: "راهنما",
      title: "شاید این‌ها را بخواهید",
      items: [
        { path: "/account/orders", title: "سفارش و پیگیری", text: "وضعیت سفارش‌ها در حساب شما" },
        { path: "/pro", title: "اشتراک Pro", text: "قیمت و موجودی برای همکاران" },
        { path: "/care", title: "نگهداری و ضمانت", text: "راهنمای نگهداری آثار سلین" },
      ],
    },
  },
  en: {
    meta: { title: "Contact CELIN", description: "How to reach CELIN — Etemad Gallery: WhatsApp, phone, Instagram and Telegram, hours and address." },
    channels: { eyebrow: "Ways to reach us", title: "Whichever way is easiest" },
    whatsapp: { label: "WhatsApp", action: "Chat on WhatsApp" },
    phone: { label: "Phone", action: "Call us" },
    instagram: { label: "Instagram", action: "Our Instagram" },
    telegram: { label: "Telegram", action: "Message us on Telegram" },
    email: { label: "Email", action: "Write to us" },
    hours: "Hours",
    address: "Address",
    map: "Directions on the map",
    help: {
      eyebrow: "Help",
      title: "You may be looking for",
      items: [
        { path: "/account/orders", title: "Orders & tracking", text: "Follow your orders in your account" },
        { path: "/pro", title: "Pro membership", text: "Prices and stock for partners" },
        { path: "/care", title: "Care & warranty", text: "Caring for your CELIN pieces" },
      ],
    },
  },
};

export type ContactCopy = (typeof contactCopy)["fa"];
