// Persian explanations and remedies for every AI error kind. Client-safe: the assistant panel, the
// AI settings page and the server (error events, stored connection errors) all use the same words.
import type { AiErrorKind } from "./types";

export interface AiErrorText {
  /** short heading, e.g. «کلید پذیرفته نشد» */
  title: string;
  /** what happened, one sentence */
  message: string;
  /** what to do, one sentence */
  remedy: string;
}

export interface AiErrorContext {
  /** the reader manages AI (ai:full): remedies point to the settings */
  canManage?: boolean;
  /** shown in the Windows app */
  desktop?: boolean;
  /** turned off by the platform administrator (not by the organisation) */
  byPlatform?: boolean;
}

const ASK_MANAGER = "از مدیر سازمان بخواهید هوش مصنوعی را راه‌اندازی کند";

export function aiErrorText(kind: AiErrorKind, c: AiErrorContext = {}): AiErrorText {
  const settings = c.canManage ? "در تنظیمات ← هوش مصنوعی" : null;
  switch (kind) {
    case "auth":
      return {
        title: "کلید پذیرفته نشد",
        message: "سرویس هوش مصنوعی کلید این اتصال را نپذیرفت یا دسترسی آن را بسته است.",
        remedy: settings ? `${settings} کلید تازه را وارد کنید و اتصال را آزمایش کنید.` : "از مدیر سازمان بخواهید کلید اتصال را بررسی کند.",
      };
    case "region":
      return {
        title: "از این مکان در دسترس نیست",
        message: "سرویس درخواست‌هایی را که از ایران یا از این شبکه می‌رسد نمی‌پذیرد.",
        remedy: c.desktop
          ? "در نسخهٔ ویندوز «استفاده از اتصال‌های نسخهٔ وب» را روشن کنید، یا یک درگاه ایرانی یا مدل محلی را به کار بگیرید."
          : "یک درگاه ایرانی (مانند متیس) یا سرویس دیگری را به زنجیرهٔ مدل‌ها اضافه کنید.",
      };
    case "quota":
      return {
        title: "اعتبار یا سهمیه تمام شده است",
        message: "سرویس اعلام کرد اعتبار یا سهمیهٔ این کلید برای این مدل تمام شده است.",
        remedy: "حساب سرویس را شارژ کنید یا اتصال دیگری را در زنجیرهٔ مدل‌ها بگذارید.",
      };
    case "rate":
      return {
        title: "درخواست‌ها زیاد شد",
        message: "سرویس برای مدتی کوتاه درخواست تازه نمی‌پذیرد.",
        remedy: "چند دقیقهٔ دیگر دوباره امتحان کنید؛ اتصال دوم در زنجیره این وقفه را پوشش می‌دهد.",
      };
    case "overloaded":
      return {
        title: "سرویس شلوغ است",
        message: "سرویس هوش مصنوعی فعلاً پاسخ نمی‌دهد یا بیش از ظرفیت درخواست دارد.",
        remedy: "کمی بعد دوباره امتحان کنید.",
      };
    case "model":
      return {
        title: "مدل در دسترس نیست",
        message: "این مدل برای این کلید پیدا نشد یا کنار گذاشته شده است.",
        remedy: settings ? `${settings} فهرست مدل‌ها را تازه کنید و مدل دیگری انتخاب کنید.` : "از مدیر سازمان بخواهید مدل دیگری انتخاب کند.",
      };
    case "invalid":
      return {
        title: "درخواست پذیرفته نشد",
        message: "سرویس درخواست را نامعتبر دانست.",
        remedy: "دوباره امتحان کنید؛ اگر تکرار شد، مدل یا اتصال دیگری را به کار بگیرید.",
      };
    case "refusal":
      return {
        title: "مدل پاسخ نداد",
        message: "مدل از پاسخ دادن به این درخواست خودداری کرد.",
        remedy: "پرسش را روشن‌تر یا به شکل دیگری بنویسید.",
      };
    case "timeout":
      return {
        title: "پاسخ دیر شد",
        message: "پاسخی در زمان مقرر از سرویس نرسید.",
        remedy: "دوباره امتحان کنید یا پرسش را کوتاه‌تر کنید.",
      };
    case "network":
      return {
        title: "اتصال برقرار نشد",
        message: "به نشانی سرویس هوش مصنوعی وصل نشدیم.",
        remedy: c.desktop ? "اتصال اینترنت این رایانه و نشانی سرویس را بررسی کنید." : "نشانی سرویس را بررسی کنید و دوباره امتحان کنید.",
      };
    case "budget":
      return {
        title: "سقف هزینه پر شده است",
        message: "سقف هزینهٔ هوش مصنوعی این سازمان یا سقف روزانهٔ شما پر شده است.",
        remedy: settings ? `${settings} ← مصرف و بودجه می‌توانید سقف را بالا ببرید.` : "از مدیر سازمان بخواهید سقف هزینه را بالا ببرد.",
      };
    case "disabled":
      return c.byPlatform
        ? {
            title: "هوش مصنوعی خاموش است",
            message: "هوش مصنوعی از سوی مدیر سامانه برای این سازمان خاموش شده است.",
            remedy: "برای روشن شدن دوباره با پشتیبانی سامانه تماس بگیرید.",
          }
        : {
            title: "هوش مصنوعی خاموش است",
            message: "هوش مصنوعی یا این قابلیت برای این سازمان خاموش است.",
            remedy: settings ? `${settings} روشنش کنید.` : "از مدیر سازمان بخواهید آن را روشن کند.",
          };
    case "not_configured":
      return {
        title: "هوش مصنوعی راه‌اندازی نشده است",
        message: "هنوز اتصالی به سرویس هوش مصنوعی برای این کار ثبت نشده است.",
        remedy: settings ? `${settings} یک اتصال بسازید و آزمایشش کنید.` : ASK_MANAGER,
      };
    case "empty":
      return {
        title: "پاسخی برنگشت",
        message: "مدل پاسخ خالی برگرداند.",
        remedy: "دوباره امتحان کنید.",
      };
    default:
      return {
        title: "خطای سرویس هوش مصنوعی",
        message: "سرویس هوش مصنوعی خطا داد.",
        remedy: "دوباره امتحان کنید؛ اگر تکرار شد، اتصال را آزمایش کنید.",
      };
  }
}

/** One line for toasts and error events: message + remedy. */
export function aiErrorMessage(kind: AiErrorKind, c: AiErrorContext = {}): string {
  const t = aiErrorText(kind, c);
  return `${t.message} ${t.remedy}`;
}

/** Errors that a person can fix in the settings (the UI offers a button to the AI settings). */
export const AI_SETUP_KINDS: AiErrorKind[] = ["auth", "not_configured", "model", "budget", "disabled", "quota"];
