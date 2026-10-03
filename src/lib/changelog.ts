/**
 * «تازه‌ها» in the help center. Newest first; the first id drives the "new" dot next to
 * «راهنما». Keep each line short — one change per line, no explanations.
 */
export interface Release {
  id: string;
  date: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    id: "2026-10-03-brand",
    date: "2026-10-03",
    title: "Task Flow با هویت تازه",
    items: ["لوگو، رنگ‌ها و فونت‌های جدید", "منوی ساده‌تر با پنج بخش اصلی", "اطلاعیه‌ی روزانه بالای صفحه", "راهنما و تازه‌ها در یک جا"],
  },
  {
    id: "2026-10-03-teams",
    date: "2026-10-03",
    title: "برای همه، با کلیدهای خودتان",
    items: ["تسک به هر کسی، با مسئول مشخص", "حالت ساده و حالت کامل", "اتصال Claude، Gemini، ChatGPT و سرویس‌های دیگر", "پروژه‌ها در GitHub خودتان، با فایل‌های کامل"],
  },
  {
    id: "2026-09-26-agents",
    date: "2026-09-26",
    title: "ایجنت‌ها و ورکفلوی بصری",
    items: ["ساخت ایجنت دلخواه", "ورکفلوی موازی برای پیش‌کار و کار اصلی", "گفت‌وگوی تسک با خروجی‌های قابل دانلود"],
  },
  {
    id: "2026-09-25-launch",
    date: "2026-09-25",
    title: "نسخه‌ی نخست",
    items: ["ثبت و پیگیری زنده‌ی تسک‌ها", "پیش‌کار و کار اصلی با هوش مصنوعی", "دانش و گراف پروژه‌ها"],
  },
];

export const LATEST_RELEASE = RELEASES[0].id;
export const SEEN_RELEASE_KEY = "tf-seen-release";
