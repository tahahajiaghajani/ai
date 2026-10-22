/** Client-safe digit helpers (no site copy imported). */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Digits in the page language (Persian digits on fa pages); keeps leading zeros. */
export function num(value: string | number, lang: "fa" | "en"): string {
  const s = String(value);
  if (lang === "en") return s;
  return s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]).replace(/%/g, "٪");
}

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → 0-9, e.g. for tel: links built from admin-entered numbers. */
export function latinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
