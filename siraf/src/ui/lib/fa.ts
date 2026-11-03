// Siraf · Persian figures, dates and search — the only formatting the UI should use.
// fa-IR gives ٬ thousands, ٫ decimal and LRM + U+2212 for minus; these helpers add the brand rules on top.

const nf = (d = 0, o: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat("fa-IR", { minimumFractionDigits: d, maximumFractionDigits: d, ...o });

/** Plain figure: 1234567 → «۱٬۲۳۴٬۵۶۷». Rial and toman: 0 decimals. Use 0 or 2 decimals per context, never mixed. */
export const fa = (n: number, decimals = 0) => nf(decimals).format(n);

/** Gold weight, always 3 decimals: 12.345 → «۱۲٫۳۴۵». */
export const grams = (g: number) => nf(3).format(g);

/** Signed figure for deltas and net changes: «‎+۱۲٬۴۵۰» / «‎−۱۲٬۴۵۰» (LRM + true minus). Render inside an LTR isolate. */
export const signed = (n: number, decimals = 0) => nf(decimals, { signDisplay: "exceptZero" }).format(n);

/** Accounting negative for printed reports and running balances: −1234567 → «(۱٬۲۳۴٬۵۶۷)». */
export const accounting = (n: number, decimals = 0) => (n < 0 ? `(${fa(-n, decimals)})` : fa(n, decimals));

/** Ledger balance (دفتر کل، معین، صورت‌حساب): «مانده» unsigned plus its «تشخیص» column — debit «بد», credit «بس»,
 *  zero «—». In Siraf Num (Vazirmatn digits) U+2212 is the same 6 px glyph as the hyphen, so ledgers never rely on the sign. */
export const balance = (n: number, decimals = 0): [amount: string, side: "بد" | "بس" | "—"] =>
  n === 0 ? ["—", "—"] : [fa(Math.abs(n), decimals), n > 0 ? "بد" : "بس"];

/** Business document numbers (voucher, invoice, cheque, receipt, the shop's item codes): Persian digits, NO grouping —
 *  58 → «۵۸», 1405 → «۱۴۰۵» (never «۱٬۴۰۵»). Findable by digits alone through normalizeFa. */
export const docNo = (n: number) => nf(0, { useGrouping: false }).format(n);

/** Percent with ٪ after the number in reading order (its left side) in every context.
 *  The leading ALM (U+061C) turns the digits into an Arabic-number run, so «۱۲٫۴٪» no longer flips to «٪» on the
 *  right when it stands alone in a cell or chip. 0.124 → «؜۱۲٫۴٪». */
export const pct = (ratio: number, decimals = 1) => "؜" + nf(decimals, { style: "percent" }).format(ratio);

/** Compact amounts for tight places (sidebar bookmarks, axis ticks): 482_500_000 → «۴۸۲٫۵ میلیون». */
export const compact = (n: number, maxDecimals = 1) =>
  new Intl.NumberFormat("fa-IR", { notation: "compact", maximumFractionDigits: maxDecimals }).format(n);

/** Splits a formatted figure so the decimals can be styled: «۱۲٫۳۴۵» → ["۱۲", "٫۳۴۵"]. They stay full size (`.sf-dec`,
 *  text-2; ink in gold-weight columns) and only step down to 65 % text-3 inside display figures ≥ 24 px (hero, KPI). */
export const splitDecimals = (s: string): [string, string] => {
  const i = s.lastIndexOf("٫");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i)];
};

/** Parses what people type: Persian, Arabic-Indic or Latin digits; ٬ , ، as grouping; ٫ . / as decimal; − - as minus. */
export function parseAmount(input: string): number | null {
  let s = toLatinDigits(input).replace(/[‎‏؜\s]/g, "").replace(/[٬,،]/g, "").replace(/[٫/]/g, ".").replace(/[−–]/g, "-");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

const FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";
export const toLatinDigits = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => String(FA.includes(d) ? FA.indexOf(d) : AR.indexOf(d)));
export const toPersianDigits = (s: string) => s.replace(/[0-9]/g, (d) => FA[+d]);

// ---- Jalali dates (the persian calendar is built into Intl; compose the long form yourself) ----
const P = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", ...o });
const fNumeric = P({ year: "numeric", month: "2-digit", day: "2-digit" });
const fDayMonth = P({ day: "numeric", month: "long" });
const fWeekday = P({ weekday: "long" });
const fYear = P({ year: "numeric" });
const fMonth = P({ month: "long" });
const fTime = P({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** «۱۴۰۵/۰۸/۱۰» — tables and inputs (an LTR run; start-align it). */
export const jDate = (d: Date | number) => fNumeric.format(d);
/** «۱۰ آبان» — axis labels, compact meta. */
export const jDayMonth = (d: Date | number) => fDayMonth.format(d);
/** «یکشنبه ۱۰ آبان ۱۴۰۵». Not `dateStyle: "full"`: ICU's Persian pattern is «۱۴۰۵ آبان ۱۰, یکشنبه» (Latin comma, odd order). */
export const jLong = (d: Date | number) => `${fWeekday.format(d)} ${fDayMonth.format(d)} ${fYear.format(d).replace(/[^۰-۹]/g, "")}`;
/** «آبان ۱۴۰۵» — period chips (ICU's month-year pattern puts the year first, so compose it). */
export const jMonth = (d: Date | number) => `${fMonth.format(d)} ${fYear.format(d).replace(/[^۰-۹]/g, "")}`;
/** «۱۰:۴۲» — 24-hour clock, Tehran time. */
export const jTime = (d: Date | number) => fTime.format(d);

// ---- search: normalise both the query and the haystack (command palette, selects, table filters) ----
/** ي/ى→ی, ك→ک, ة→ه, ۀ→ه, أإٱ→ا, ؤ→و, drops ZWNJ/ZWJ, tatweel and diacritics, Persian/Arabic digits→Latin, lower-cases Latin. */
export function normalizeFa(s: string): string {
  return toLatinDigits(s)
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[ةۀ]/g, "ه").replace(/[أإٱ]/g, "ا").replace(/ؤ/g, "و")
    .replace(/[‌‍ـ]/g, "").replace(/[ً-ٰٟ]/g, "")
    .replace(/[٬,،]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
/** True when every word of the query appears in the text (order-free), after normalising both. */
export const matchesFa = (text: string, query: string) => {
  const t = normalizeFa(text);
  return normalizeFa(query).split(" ").filter(Boolean).every((w) => t.includes(w));
};

/** Never join figures with «·»: the Persian zero «۰» of Siraf Num (Vazirmatn's digits) is a dot, so «۵ · ۲» reads «۵۰۲». */
export const SEP = "، ";
