/** Client-safe digit helpers (no site copy imported). */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Digits in the page language (Persian digits on fa pages); keeps leading zeros. */
export function num(value: string | number, lang: "fa" | "en"): string {
  const s = String(value);
  if (lang === "en") return s;
  return s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]).replace(/%/g, "٪");
}
