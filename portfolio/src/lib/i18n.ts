export type Lang = "fa" | "en";

/** Persian lives at the root, English under /en. */
export function href(lang: Lang, path = "/"): string {
  if (lang === "fa") return path;
  return path === "/" ? "/en" : `/en${path}`;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Latin digits → Persian digits (for Persian pages). */
export function faDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Digits in the page's language. */
export function num(lang: Lang, s: string | number): string {
  return lang === "fa" ? faDigits(s) : String(s);
}

/** A bilingual value. */
export type L<T = string> = { fa: T; en: T };

export function t<T>(v: L<T>, lang: Lang): T {
  return v[lang];
}

export function formatDate(iso: string, lang: Lang, withTime = true): string {
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Tehran",
  }).format(new Date(iso));
}
