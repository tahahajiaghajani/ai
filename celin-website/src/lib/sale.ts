import { cleanSalePct, type PriceLevel, type SaleRule } from "@/lib/pricing";
import { formatPct, type Lang } from "@/lib/format";
import type { SaleSettings, SaleTone } from "@/lib/settings-types";

/**
 * The special-day discount (client-safe; Settings → «نوار تخفیف روزهای خاص»). Two clocks, on purpose:
 * - the PRICE follows the server's clock: /api/pro/prices and the order action ask liveSale() at that moment, and
 *   celin_place_order applies what the action sends (and refuses an order whose total differs from what was shown);
 * - the BAR follows the browser's clock: public pages are static, so the bar is in their HTML with its start and
 *   end, and a tiny inline script (src/components/site/sale-bar.tsx) shows it only inside the window. Without JS the
 *   bar shows when the page was built inside the window.
 */

export type SaleState = "off" | "soon" | "live" | "over";

const time = (iso: string, open: number) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : open;
};

/** The window in ms: from (inclusive) and until (exclusive); open ends are ±infinity. */
export function saleWindow(s: Pick<SaleSettings, "from" | "until">): { from: number; until: number } {
  return { from: time(s.from, Number.NEGATIVE_INFINITY), until: time(s.until, Number.POSITIVE_INFINITY) };
}

/** Where the sale stands at `now`: off (switched off or no valid percentage), soon, live or over. */
export function saleState(s: SaleSettings, now: number): SaleState {
  if (!s.enabled || !cleanSalePct(s.pct)) return "off";
  const w = saleWindow(s);
  if (now < w.from) return "soon";
  if (now >= w.until) return "over";
  return "live";
}

/** The price rule for an account level at `now`, or null: members while it runs, Pro accounts too when the admin allows it. */
export function liveSale(s: SaleSettings, level: PriceLevel, now: number): SaleRule | null {
  if (saleState(s, now) !== "live" || (level === "pro" && !s.pro)) return null;
  return saleRule(s);
}

/** The price rule of the settings, whatever the clock says (the order action uses it to explain a sale that just ended). */
export function saleRule(s: SaleSettings): SaleRule {
  return { pct: cleanSalePct(s.pct), title_fa: s.title_fa, title_en: s.title_en, until: s.until };
}

/** The sale's own title in the page language (English falls back to Persian), or "" for the site's label. */
export function saleTitle(r: Pick<SaleRule, "title_fa" | "title_en">, lang: Lang): string {
  return (lang === "en" ? r.title_en || r.title_fa : r.title_fa).trim();
}

// ------------------------------------------------------------------ colour

/**
 * The brand presets, literal so Tailwind sees them. Contrast of the text on each ground (WCAG, tests/sale.test.ts
 * measures it from globals.css): night 16.5, cocoa 11.7, pomegranate 9.8, paraiba 10.7, copper (gold-deep) 7.5,
 * champagne 12.2. bg-gold (#9c5e34) is not offered: it reaches only 4.4 with either text colour.
 */
export const TONE_CLASS: Record<Exclude<SaleTone, "custom">, string> = {
  pomegranate: "bg-pomegranate text-on-night border-night-line",
  night: "bg-night text-on-night border-night-line",
  cocoa: "bg-cocoa text-on-night border-night-line",
  paraiba: "bg-paraiba text-on-night border-night-line",
  copper: "bg-gold-deep text-on-night border-night-line",
  champagne: "bg-champagne text-ink border-line",
};

export const TONE_LABEL: Record<SaleTone, string> = {
  pomegranate: "اناری",
  night: "اسپرسو",
  cocoa: "کاکائو",
  paraiba: "فیروزه‌ای",
  copper: "مسی",
  champagne: "شامپاینی",
  custom: "رنگ دلخواه",
};

export const HEX = /^#[0-9a-f]{6}$/i;

/** Where the admin's colour picker starts (the pomegranate ground). */
export const CUSTOM_START = "#6d1a26";

/** Relative luminance of the two text colours (globals.css --color-ink #1a1310, --color-on-night #f5ecdf). */
export const INK_LUMINANCE = 0.00723;
export const ON_NIGHT_LUMINANCE = 0.84731;

/** WCAG relative luminance of "#rrggbb". */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio of two luminances. */
export function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The better of the two text colours on a custom ground, with its contrast (below 4.5 the admin is warned). */
export function inkFor(hex: string): { ink: "dark" | "light"; ratio: number } {
  if (!HEX.test(hex)) return { ink: "light", ratio: 0 };
  const l = luminance(hex);
  const dark = contrast(l, INK_LUMINANCE);
  const light = contrast(l, ON_NIGHT_LUMINANCE);
  return dark > light ? { ink: "dark", ratio: dark } : { ink: "light", ratio: light };
}

/** The bar's classes: a preset, or the custom ground (style --sale-bg) with the text colour that reads best on it. */
export function barClass(tone: SaleTone, color: string): string {
  if (tone !== "custom" || !HEX.test(color)) return TONE_CLASS[tone === "custom" ? "pomegranate" : tone];
  return inkFor(color).ink === "dark" ? "bg-[var(--sale-bg)] text-ink border-line" : "bg-[var(--sale-bg)] text-on-night border-night-line";
}

// ------------------------------------------------------------------ the bar

/** What a static page carries for the bar: words, percentage, colour and window only — never a price. */
export interface SaleBarData {
  /** «عنوان · ۱۰٪ تخفیف» (or «۱۰٪ تخفیف روزهای خاص» without a title) */
  headline: string;
  text: string;
  className: string;
  /** the custom ground, or "" */
  color: string;
  /** the window in ms (0 / 8.64e15 for open ends: numbers the inline script can compare) */
  from: number;
  until: number;
  /** live when the page was built (the bar shows without JS) */
  live: boolean;
  link: string;
}

export const OPEN_END = 8.64e15;

/** The words of the bar (src/content/copy/common.ts `sale`). */
export interface SaleWords {
  line: (title: string, p: string) => string;
}

/** How the bar reads and looks, whatever the clock says (the admin's preview uses it too). */
export function saleLook(s: SaleSettings, lang: Lang, words: SaleWords): Pick<SaleBarData, "headline" | "text" | "className" | "color" | "link"> {
  return {
    headline: words.line(saleTitle(s, lang), formatPct(cleanSalePct(s.pct), lang)),
    text: (lang === "en" ? s.text_en || s.text_fa : s.text_fa).trim(),
    className: barClass(s.tone, s.color),
    color: s.tone === "custom" && HEX.test(s.color) ? s.color : "",
    link: s.link,
  };
}

/** The bar of a page built at `now`, or null when the sale is off or already over. */
export function saleBar(s: SaleSettings, lang: Lang, now: number, words: SaleWords): SaleBarData | null {
  const state = saleState(s, now);
  if (state === "off" || state === "over") return null;
  const w = saleWindow(s);
  return {
    ...saleLook(s, lang, words),
    from: Number.isFinite(w.from) ? w.from : 0,
    until: Number.isFinite(w.until) ? w.until : OPEN_END,
    live: state === "live",
  };
}
