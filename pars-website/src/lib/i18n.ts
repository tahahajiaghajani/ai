import { fa, type Copy } from "@/content/fa";
import { en } from "@/content/en";

export type Lang = "fa" | "en";

export function copy(lang: Lang): Copy {
  return lang === "en" ? en : (fa as Copy);
}

/** Persian lives at the root, English under /en. */
export function href(lang: Lang, path = "/"): string {
  if (lang === "fa") return path;
  return path === "/" ? "/en" : `/en${path}`;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Digits in the page language (Persian digits on fa pages); keeps leading zeros. */
export function num(value: string | number, lang: Lang): string {
  const s = String(value);
  if (lang === "en") return s;
  return s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]).replace(/%/g, "٪");
}

export function formatDate(iso: string, lang: Lang, withTime = true): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Tehran",
  }).format(d);
}
