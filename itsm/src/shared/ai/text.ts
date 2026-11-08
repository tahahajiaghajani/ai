// Persian-aware text services of the AI layer: the normal form text takes before it is embedded or shown to a model
// (`normalizeFa`), the search form the full-text index and the fallback embedder work on (`searchForm`), query terms
// without stop words, language detection and a token estimate. Shared by the RAG indexer on the server and the UI
// (highlighting a cited passage in a document). Client-safe: no server imports.
//
// Normal form (embedding, display): Unicode NFKC (presentation forms → letters), Arabic yeh/alef maksura → Persian
// yeh, Arabic kaf → Persian kaf, Persian and Arabic-Indic digits → Latin, diacritics and tatweel removed, invisible
// marks (ZWJ, bidi controls, BOM…) removed, the zero-width non-joiner (ZWNJ) kept once where a word needs it, spaces
// collapsed. Search form: the normal form lower-cased, ZWNJ removed (so «می‌شود» and «میشود» meet), hamza seats,
// teh marbuta, «ۀ» and «آ» folded, punctuation turned into spaces (identifiers such as INC-0012 or 10.0.0.1 kept).

const ZWNJ = "‌";

/** Characters removed outright: diacritics, Quranic marks, tatweel, invisible format marks (not ZWNJ). */
const DROP_RE = /[ؐ-ًؚ-ٰٟۖ-ۭـ​‍-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;

const LETTER_MAP: Record<string, string> = {
  "ي": "ی", // ي Arabic yeh
  "ى": "ی", // ى alef maksura
  "ك": "ک", // ك Arabic kaf
  "ە": "ه", // ە ae
};

/** Digits of every script the organisation types → Latin. */
export function latinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

/** The normal form of a text before it is embedded, indexed or shown to a model (see the header). */
export function normalizeFa(input: unknown): string {
  let s = String(input ?? "");
  if (!s) return "";
  s = s.normalize("NFKC");
  s = s.replace(DROP_RE, "");
  s = s.replace(/[يىكە]/g, (c) => LETTER_MAP[c] ?? c);
  s = latinDigits(s);
  // ZWNJ: one at a time, never next to a space or at the edge of a word
  s = s.replace(/‌{2,}/g, ZWNJ).replace(/\s*‌\s+|\s+‌\s*/g, " ").replace(/(^|[^\p{L}\p{M}])‌|‌(?=[^\p{L}\p{M}]|$)/gu, "$1");
  // spaces: tabs and odd spaces become one space; lines kept (paragraphs matter to the chunker)
  s = s.replace(/[\t\f\v   -   　]+/g, " ").replace(/ *\r?\n */g, "\n").replace(/ {2,}/g, " ");
  return s.trim();
}

/**
 * A light clean-up that keeps the text as written (what passages show and cite): NFC, line breaks unified, invisible
 * and bidi marks removed (ZWNJ kept), runs of spaces inside a line collapsed — leading indentation and letters stay.
 */
export function cleanText(input: unknown): string {
  let s = String(input ?? "");
  if (!s) return "";
  s = s.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u200b\u200d-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]/g, "");
  s = s.replace(/\t/g, "    ").replace(/[\f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ");
  s = s.replace(/(\S) {2,}/g, "$1 ").replace(/ +$/gm, "");
  return s.replace(/^\n+|\s+$/g, "");
}

const SEARCH_FOLD: Record<string, string> = {
  "أ": "ا", "إ": "ا", "ٱ": "ا", "آ": "ا",
  "ؤ": "و", "ئ": "ی", "ة": "ه", "ۀ": "ه", "ء": "",
};

/**
 * The character tables of `searchForm` for its SQL twin (knowledge search): every character it removes outright
 * (marks, tatweel, invisible and bidi controls, ZWNJ, hamza) and the letters it folds — derived from the same tables,
 * so the two sides agree.
 */
export const SEARCH_DROPPED: string = (() => {
  const re = new RegExp(DROP_RE.source);
  let out = "";
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCharCode(cp);
    if (re.test(c)) out += c;
  }
  return out + ZWNJ + Object.keys(SEARCH_FOLD).filter((k) => !SEARCH_FOLD[k]).join("");
})();
export const SEARCH_FOLDS: readonly (readonly [string, string])[] = [...Object.entries(LETTER_MAP), ...Object.entries(SEARCH_FOLD).filter(([, v]) => v)];

/**
 * The search form: what the full-text index, the trigram-style fallback and the local embedder see. Lower-case,
 * ZWNJ removed, letters folded, punctuation as spaces; dots, dashes, slashes, colons, @ and underscores survive only
 * between letters or digits (record numbers, addresses, versions).
 */
export function searchForm(input: unknown): string {
  let s = normalizeFa(input).toLowerCase();
  s = s.replace(/‌/g, "").replace(/[أإٱآؤئةۀء]/g, (c) => SEARCH_FOLD[c] ?? c);
  s = s.replace(/([\p{L}\p{N}])[.\-_/:@]+(?=[\p{L}\p{N}])/gu, "$1\u0000");
  s = s.replace(/[^\p{L}\p{N}\u0000]+/gu, " ");
  s = s.replace(/\u0000/g, "-");
  return s.replace(/ {2,}/g, " ").trim();
}

/** Words of the search form (identifiers keep their dashes). */
export function words(input: unknown): string[] {
  const s = searchForm(input);
  return s ? s.split(" ") : [];
}

/** Persian and English words that carry no meaning for retrieval (also question words). */
export const STOP_WORDS = new Set(
  (
    "و در به از که این آن را با است هست بود شد شود میشود می ها های برای تا هم بر یا اما اگر چه چرا چگونه چطور کجا کی " +
    "آیا ای یک دو هر همه نیز باید شده شده‌اند کرد کرده کند کنید کنم کنیم کردن داریم دارد دارند داشت ما من تو او شما ایشان " +
    "خود دیگر بین پس پیش روی زیر بالا چند چی چیست کدام کدوم وقتی حتی فقط لطفا لطفاً درباره مورد ولی نه بله خیر " +
    "the a an of to in on for and or is are was were be been it this that these those with as at by from how what why " +
    "when where which who whom do does did can could should would will please about into than then there their"
  ).split(/\s+/).map((w) => searchForm(w)),
);

/** Query terms: words without stop words, each once, at most 16 (record numbers and identifiers kept). */
export function queryTerms(q: unknown): string[] {
  const out: string[] = [];
  for (const w of words(q)) {
    if (STOP_WORDS.has(w) || (w.length < 2 && !/\d/.test(w))) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 16) break;
  }
  return out;
}

/** A light stem for prefix matching: Persian plural/possessive suffixes and English plurals off. */
export function stem(w: string): string {
  if (/^[a-z]+$/.test(w)) {
    if (w.length > 5 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && /(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  }
  for (const suf of ["هایی", "های", "ها", "ترین", "تری", "تر", "یی"]) {
    if (w.length - suf.length >= 2 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

export type TextLang = "fa" | "en" | "mixed" | "other";

/** Persian (Arabic script), English (Latin script), both, or neither. */
export function detectLang(input: unknown): TextLang {
  const s = String(input ?? "");
  let fa = 0;
  let en = 0;
  for (const ch of s.slice(0, 20_000)) {
    if (/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(ch)) fa++;
    else if (/[A-Za-z]/.test(ch)) en++;
  }
  if (!fa && !en) return "other";
  if (fa >= en * 4) return "fa";
  if (en >= fa * 4) return "en";
  return "mixed";
}

/**
 * Estimated model tokens: about four Latin characters and three Persian characters per token (byte-pair encoders
 * split Persian finer), digits and punctuation counted on their own.
 */
export function estimateTokens(input: unknown): number {
  const s = String(input ?? "");
  if (!s) return 0;
  let latin = 0;
  let other = 0;
  let marks = 0;
  for (const ch of s) {
    if (/[A-Za-z]/.test(ch)) latin++;
    else if (/\s/.test(ch)) continue;
    else if (/[\p{L}]/u.test(ch)) other++;
    else marks++;
  }
  return Math.max(1, Math.ceil(latin / 4 + other / 3 + marks / 2));
}

/** At most `max` tokens of a text, cut at a word boundary. */
export function clipTokens(input: string, max: number): string {
  if (estimateTokens(input) <= max) return input;
  const parts = input.split(/(\s+)/);
  let out = "";
  for (const p of parts) {
    if (estimateTokens(out + p) > max) break;
    out += p;
  }
  return out.trimEnd();
}
