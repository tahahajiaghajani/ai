/**
 * Colour options (round six): plating colour, stone colour and leather colour are chosen from lists the admin keeps in
 * Settings → «رنگ‌های گزینه‌ها» (celin_settings "options"). A product uses up to three axes, always plating → stone →
 * leather; each variant is one combination ({"plating":"gold","stone":"white"}, celin_variants.options) with its own
 * price override, stock, SKU and picture. The site composes a combination's name and colour dot from the lists
 * («طلایی · نگین سفید · چرم مشکی»), so orders, the basket, the admin and notifications read variant names as before,
 * and a renamed colour is written into every stored combination. Variants with {} are the older plain list.
 *
 * Client-safe and pure: shared by the server, the admin editor and the product page. Never a price or stock here.
 */
import { LEATHERS, METALS, OPTION_AXES, STONES, SWATCH_RE, type OptionAxis, type ProductAxis, type VariantOptions } from "@/lib/catalog-types";
import type { Lang } from "@/lib/format";

export { OPTION_AXES, type OptionAxis, type VariantOptions } from "@/lib/catalog-types";

export interface PaletteValue {
  /** stable slug (stored combinations, links): never renamed */
  key: string;
  fa: string;
  en: string;
  /** a site preset (SWATCH_KEYS) or #rrggbb; "" = no dot */
  swatch: string;
  /** 1–4 Latin capitals or digits: the SKU suffix, as in CL-NEG-BG-001-GT-NB */
  code: string;
  /** the shop filter value it falls under (METALS / STONES / LEATHERS), "" = none */
  facet: string;
}

export type OptionPalette = Record<OptionAxis, PaletteValue[]>;

/** combinations of one product (the database function takes at most 100 lines an order; the editor grid stays usable) */
export const MAX_VARIANTS = 100;
/** values of one list */
export const MAX_VALUES = 40;

export const FACETS: Record<OptionAxis, readonly string[]> = { plating: METALS, stone: STONES, leather: LEATHERS };

/** The admin's names of the axes (messages, the editor). The site's own are in src/content/copy/product.ts. */
export const AXIS_FA: Record<OptionAxis, string> = { plating: "رنگ آبکاری", stone: "رنگ نگین", leather: "رنگ چرم" };

/**
 * The starting lists. Stone colours are the brand book's colour names (§ رنگ نگین‌ها; never a gem or the material),
 * platings its finishes, leathers plain colour words. The keys are stable forever: never rename them here.
 */
export const DEFAULT_OPTIONS: OptionPalette = {
  plating: [
    { key: "silver", fa: "نقره‌ای (رودیوم)", en: "Silver-tone", swatch: "silver", code: "RH", facet: "silver" },
    { key: "gold", fa: "طلایی", en: "Gold-tone", swatch: "gold", code: "GT", facet: "gold" },
    { key: "champagne", fa: "شامپاین گلد", en: "Champagne-gold", swatch: "champagne", code: "CG", facet: "gold" },
    { key: "rose", fa: "رزگلد", en: "Rose-gold-tone", swatch: "rose", code: "RS", facet: "rose" },
  ],
  stone: [
    { key: "white", fa: "سفید", en: "White", swatch: "#f3efe6", code: "WH", facet: "white" },
    { key: "blue", fa: "آبی فیروزه‌ای", en: "Firouzeh blue", swatch: "#3aa7b4", code: "FB", facet: "blue" },
    { key: "navy", fa: "سرمه‌ای", en: "Night blue", swatch: "#1f3a6e", code: "NB", facet: "navy" },
    { key: "green", fa: "سبز جنگلی", en: "Forest green", swatch: "#1f5a3d", code: "FG", facet: "green" },
    { key: "red", fa: "قرمز اناری", en: "Pomegranate red", swatch: "#9e1b32", code: "PR", facet: "red" },
    { key: "pearl", fa: "مرواریدی", en: "Pearl-look", swatch: "#ebe2d2", code: "PL", facet: "pearl" },
    { key: "blush", fa: "صورتی ملایم", en: "Blush", swatch: "#e5b8b2", code: "BL", facet: "blush" },
    { key: "black", fa: "مشکی", en: "Black", swatch: "#23201f", code: "BK", facet: "black" },
  ],
  leather: [
    { key: "black", fa: "مشکی", en: "Black", swatch: "#1f1c1a", code: "BK", facet: "black" },
    { key: "brown", fa: "قهوه‌ای", en: "Brown", swatch: "#5b3a26", code: "BR", facet: "brown" },
    { key: "tan", fa: "عسلی", en: "Tan", swatch: "#b07a3f", code: "TN", facet: "tan" },
    { key: "burgundy", fa: "زرشکی", en: "Burgundy", swatch: "#6b1f2a", code: "BU", facet: "burgundy" },
    { key: "navy", fa: "سرمه‌ای", en: "Navy", swatch: "#1e2a44", code: "NV", facet: "navy" },
    { key: "cream", fa: "کرم", en: "Cream", swatch: "#e8dbc2", code: "CR", facet: "cream" },
  ],
};

// ------------------------------------------------------------------ reading

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A stored palette read leniently (a list edited by hand never breaks a page): rows without a key or name are left out. */
export function paletteOf(raw: unknown): OptionPalette {
  const src = isObj(raw) ? raw : {};
  const out = {} as OptionPalette;
  for (const axis of OPTION_AXES) {
    const list = Array.isArray(src[axis]) ? (src[axis] as unknown[]) : DEFAULT_OPTIONS[axis];
    out[axis] = list
      .filter(isObj)
      .map((v) => ({ key: str(v.key), fa: str(v.fa), en: str(v.en), swatch: str(v.swatch), code: str(v.code), facet: str(v.facet) }))
      .filter((v) => v.key && v.fa);
  }
  return out;
}

/** The combination stored on a variant (jsonb), keeping only the known axes with a key. */
export function readOptions(raw: unknown): VariantOptions {
  if (!isObj(raw)) return {};
  const out: VariantOptions = {};
  for (const axis of OPTION_AXES) if (typeof raw[axis] === "string" && raw[axis]) out[axis] = raw[axis] as string;
  return out;
}

export const hasOptions = (o: VariantOptions | null | undefined): boolean => Boolean(o) && OPTION_AXES.some((a) => Boolean(o![a]));
export const axesUsed = (o: VariantOptions): OptionAxis[] => OPTION_AXES.filter((a) => Boolean(o[a]));

/** Canonical text of a combination, in axis order whatever the object's key order: "plating=gold|stone=white". */
export function optionsKey(o: VariantOptions): string {
  return axesUsed(o)
    .map((a) => `${a}=${o[a]}`)
    .join("|");
}

export const valueOf = (palette: OptionPalette, axis: OptionAxis, key: string | undefined): PaletteValue | undefined => (key ? palette[axis]?.find((v) => v.key === key) : undefined);

/**
 * A combination from the editor, checked against the lists: only known axes, every key in its list (`unknown`
 * names the first one that is not — a colour deleted while the editor was open).
 */
export function cleanOptions(raw: unknown, palette: OptionPalette): { options: VariantOptions; unknown: string | null } {
  const o = readOptions(raw);
  for (const axis of axesUsed(o)) if (!valueOf(palette, axis, o[axis])) return { options: o, unknown: o[axis]! };
  return { options: o, unknown: null };
}

// ------------------------------------------------------------------ words and dots

const WORD: Record<Exclude<OptionAxis, "plating">, Record<Lang, string>> = { stone: { fa: "نگین", en: "stones" }, leather: { fa: "چرم", en: "leather" } };

/** One value as the customer reads it in a combination: «طلایی», «نگین سفید», «چرم مشکی» / "Gold-tone", "White stones", "Black leather". */
export function valueWord(axis: OptionAxis, v: Pick<PaletteValue, "fa" | "en"> | undefined, key: string, lang: Lang): string {
  const fa = v?.fa.trim() || key;
  const name = lang === "en" ? v?.en.trim() || fa : fa;
  if (axis === "plating") return name;
  const w = WORD[axis][lang];
  if (lang === "fa") return name.startsWith(`${w} `) ? name : `${w} ${name}`;
  return /\b(stones?|leather)$/i.test(name) ? name : `${name} ${w}`;
}

/** The name of a combination, plating → stone → leather: «طلایی · نگین سفید · چرم مشکی». */
export function optionLabel(o: VariantOptions, palette: OptionPalette, lang: Lang): string {
  return axesUsed(o)
    .map((a) => valueWord(a, valueOf(palette, a, o[a]), o[a]!, lang))
    .join(" · ");
}

/** The colour dot of a combination: its plating's, otherwise the first axis's. */
export function optionSwatch(o: VariantOptions, palette: OptionPalette): string {
  for (const a of axesUsed(o)) {
    const s = valueOf(palette, a, o[a])?.swatch ?? "";
    if (s) return s;
  }
  return "";
}

/** SKU of a combination: the product's code with each value's code, as in the brand book (CL-NEG-BG-001-GT-NB). */
export function comboSku(base: string, o: VariantOptions, palette: OptionPalette): string {
  const b = base.trim();
  if (!b) return "";
  const codes = axesUsed(o)
    .map((a) => valueOf(palette, a, o[a])?.code ?? "")
    .filter(Boolean);
  return [b, ...codes].join("-").slice(0, 60);
}

// ------------------------------------------------------------------ grids

/** Keys in the order of the list (a key the list no longer has stays, at the end). */
function inOrder(axis: OptionAxis, keys: Iterable<string>, palette: OptionPalette): string[] {
  const set = new Set(keys);
  const known = (palette[axis] ?? []).map((v) => v.key).filter((k) => set.has(k));
  return [...known, ...[...set].filter((k) => !known.includes(k))];
}

/** Every combination of the chosen values (axes without a value are not used), plating first, in the lists' order. */
export function combos(selected: Partial<Record<OptionAxis, string[]>>, palette: OptionPalette): VariantOptions[] {
  const axes = OPTION_AXES.filter((a) => (selected[a] ?? []).length > 0);
  if (!axes.length) return [];
  let out: VariantOptions[] = [{}];
  for (const a of axes) {
    const keys = inOrder(a, selected[a]!, palette);
    out = out.flatMap((o) => keys.map((k) => ({ ...o, [a]: k })));
  }
  return out;
}

/** The axes of a product from its combinations, each with the values used, in the lists' order (public: no price, no stock). */
export function axesOf(variants: { options: VariantOptions }[], palette: OptionPalette): ProductAxis[] {
  const out: ProductAxis[] = [];
  for (const axis of OPTION_AXES) {
    const used = variants.map((v) => v.options[axis]).filter((k): k is string => Boolean(k));
    if (!used.length) continue;
    out.push({
      axis,
      values: inOrder(axis, used, palette).map((key) => {
        const v = valueOf(palette, axis, key);
        return { key, name_fa: v?.fa || key, name_en: v?.en || v?.fa || key, swatch: v?.swatch ?? "", facet: v?.facet ?? "" };
      }),
    });
  }
  return out;
}

/** The shop-filter facets the combinations of a product offer on one axis. */
export const facetsOf = (axes: ProductAxis[] | undefined, axis: OptionAxis): string[] => (axes ?? []).find((a) => a.axis === axis)?.values.map((v) => v.facet).filter(Boolean) ?? [];

// ------------------------------------------------------------------ choosing (the product page)

/** A combination that has every colour chosen so far. */
export const fitsPick = (o: VariantOptions, pick: VariantOptions) => OPTION_AXES.every((a) => !pick[a] || o[a] === pick[a]);
const fits = fitsPick;

/** The combination chosen on every axis, or null while an axis is still open. */
export function findVariant<T extends { options: VariantOptions }>(variants: T[], axes: ProductAxis[], pick: VariantOptions): T | null {
  if (!axes.length || axes.some((x) => !pick[x.axis])) return null;
  return variants.find((v) => axes.every((x) => v.options[x.axis] === pick[x.axis])) ?? null;
}

/** The axes still to choose, in order. */
export const missingAxes = (axes: ProductAxis[], pick: VariantOptions): OptionAxis[] => axes.filter((x) => !pick[x.axis]).map((x) => x.axis);

/**
 * How a value reads next to the other choices: "none" = no combination with them is made (dimmed, still clickable),
 * "out" = made but none of them can be ordered now (members and Pro only: `orderable` comes from their price book),
 * "ok" otherwise.
 */
export function valueState<T extends { options: VariantOptions }>(variants: T[], pick: VariantOptions, axis: OptionAxis, key: string, orderable?: (v: T) => boolean): "ok" | "none" | "out" {
  const others = { ...pick, [axis]: undefined };
  const made = variants.filter((v) => v.options[axis] === key && fits(v.options, others));
  if (!made.length) return "none";
  if (orderable && !made.some(orderable)) return "out";
  return "ok";
}

/** Choosing a value: it is kept, and an earlier choice that no combination makes with it is dropped. */
export function pickValue<T extends { options: VariantOptions }>(variants: T[], axes: ProductAxis[], pick: VariantOptions, axis: OptionAxis, key: string): VariantOptions {
  const next: VariantOptions = { [axis]: key };
  for (const x of axes) {
    if (x.axis === axis || !pick[x.axis]) continue;
    const tryIt = { ...next, [x.axis]: pick[x.axis] };
    if (variants.some((v) => fits(v.options, tryIt))) next[x.axis] = pick[x.axis];
  }
  return next;
}

/** What is chosen before the customer does anything: an axis with one value, or the only combination. */
export function startPick<T extends { options: VariantOptions }>(variants: T[], axes: ProductAxis[]): VariantOptions {
  if (variants.length === 1) return { ...variants[0].options };
  const out: VariantOptions = {};
  for (const x of axes) if (x.values.length === 1) out[x.axis] = x.values[0].key;
  return out;
}

/**
 * A choice from the address (?v=<variant id>, or ?plating=gold&stone=white), when it names what the product has. The
 * colours it names are added to what is chosen before the customer does anything (startPick), so ?stone=red on a
 * gold-only piece keeps «طلایی» chosen.
 */
export function pickFromQuery<T extends { id: string; options: VariantOptions }>(q: URLSearchParams, variants: T[], axes: ProductAxis[]): VariantOptions | null {
  const v = q.get("v");
  const byId = v ? variants.find((x) => x.id === v) : undefined;
  if (byId) return { ...byId.options };
  let out: VariantOptions = startPick(variants, axes);
  let any = false;
  for (const x of axes) {
    const key = q.get(x.axis);
    if (key && x.values.some((val) => val.key === key)) {
      out = pickValue(variants, axes, out, x.axis, key);
      any = true;
    }
  }
  return any ? out : null;
}

// ------------------------------------------------------------------ the older plain lists

const normText = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‌‍‎‏ـ]/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
const bare = (s: string) => s.replace(/\([^)]*\)/g, "").trim();

/** Which value of an axis a written part names: its Persian or English name, with or without the bracketed note. */
function valueNamed(palette: OptionPalette, axis: OptionAxis, part: string): string | null {
  const want = new Set([normText(part), normText(bare(part))].filter(Boolean));
  for (const v of palette[axis] ?? []) {
    const names = [v.fa, bare(v.fa), v.en, bare(v.en)].filter(Boolean).map(normText);
    if (names.some((n) => want.has(n))) return v.key;
  }
  return null;
}

/** One plain option's name split into axis values («طلایی · سرمه‌ای» → gold plating, night-blue stones), or null. */
function parseName(name: string, palette: OptionPalette): VariantOptions | null {
  const parts = name
    .split("·")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: VariantOptions = {};
  for (const raw of parts) {
    let part = raw;
    let only: OptionAxis | null = null;
    const fa = /^(نگین|چرم)\s+(.+)$/.exec(part);
    const en = /^(.+?)\s+(stones?|leather)$/i.exec(part);
    if (fa) [only, part] = [fa[1] === "نگین" ? "stone" : "leather", fa[2]];
    else if (en) [only, part] = [/^leather$/i.test(en[2]) ? "leather" : "stone", en[1]];
    const axis = (only ? [only] : OPTION_AXES).find((a) => !out[a] && valueNamed(palette, a, part));
    if (!axis) return null;
    out[axis] = valueNamed(palette, axis, part)!;
  }
  return out;
}

/**
 * «تبدیل به رنگ‌ها»: maps a product's plain options onto the colour lists by their names (Persian, else English), or
 * null when one cannot be mapped, two would become the same combination, or they would not use the same axes.
 */
export function legacyToOptions(rows: { name_fa: string; name_en: string }[], palette: OptionPalette): VariantOptions[] | null {
  if (!rows.length) return null;
  const out: VariantOptions[] = [];
  for (const r of rows) {
    const o = parseName(r.name_fa, palette) ?? parseName(r.name_en, palette);
    if (!o) return null;
    out.push(o);
  }
  const axes = axesUsed(out[0]).join();
  if (out.some((o) => axesUsed(o).join() !== axes)) return null;
  if (new Set(out.map(optionsKey)).size !== out.length) return null;
  return out;
}

// ------------------------------------------------------------------ the admin's lists

/** Words for the stone's material: the owner's rule (brand book §4) keeps them out of every name. */
export const MATERIAL_RE = /زیرکون|کیوبیک|zircon|cubic/i;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");

const clip = (v: unknown, max: number) => str(v).replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** A code from the English name's initials (Olive green → OG), else from the key. */
function codeFor(en: string, key: string): string {
  const words = en.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const initials = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 2);
  return (initials || key.replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 2) || "X").slice(0, 4);
}

function unique(base: string, taken: Set<string>, max: number, join = ""): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const tail = `${join}${i}`;
    const c = `${base.slice(0, max - tail.length)}${tail}`;
    if (!taken.has(c)) return c;
  }
  return base;
}

/**
 * The colour lists as the admin saves them: a Persian name each (unique in its list), an optional English name, a dot,
 * a code (unique; made from the English name when empty) and a filter facet. A new value gets its key from its English
 * name (or the list's name); keys never change afterwards. Only the stone's material is refused in a name — naming a
 * colour is the owner's choice.
 */
export function cleanPalette(input: unknown): { palette: OptionPalette; error: null } | { palette: null; error: string } {
  const src = isObj(input) ? input : {};
  const palette = {} as OptionPalette;
  for (const axis of OPTION_AXES) {
    const rows = Array.isArray(src[axis]) ? (src[axis] as unknown[]) : [];
    const label = AXIS_FA[axis];
    if (rows.length > MAX_VALUES) return { palette: null, error: `«${label}» حداکثر ${MAX_VALUES} رنگ دارد.` };
    const keys = new Set<string>();
    const codes = new Set<string>();
    const names = new Set<string>();
    const list: PaletteValue[] = [];
    // keys and codes the admin kept are reserved first, so a new value never takes one of them
    const given = rows.filter(isObj);
    for (const r of given) {
      const k = clip(r.key, 30).toLowerCase();
      if (k && KEY_RE.test(k)) {
        if (keys.has(k)) return { palette: null, error: `دو رنگ «${label}» یک نشانی دارند؛ صفحه را دوباره باز کنید.` };
        keys.add(k);
      }
      const c = clip(r.code, 4).toUpperCase();
      if (c) {
        if (!/^[A-Z0-9]{1,4}$/.test(c)) return { palette: null, error: `کد «${c}» در «${label}» فقط حروف بزرگ و عدد لاتین (تا ۴ نویسه) می‌پذیرد؛ مثلاً GT.` };
        if (codes.has(c)) return { palette: null, error: `کد «${c}» دو بار در «${label}» آمده است؛ کد هر رنگ باید جدا باشد.` };
        codes.add(c);
      }
    }
    for (const r of given) {
      const fa = clip(r.fa, 40);
      const en = clip(r.en, 40);
      if (!fa) return { palette: null, error: `نام فارسی همه‌ی رنگ‌های «${label}» را بنویسید.` };
      if (MATERIAL_RE.test(fa) || MATERIAL_RE.test(en)) return { palette: null, error: `نام جنس نگین در نام رنگ‌ها نمی‌آید («${MATERIAL_RE.test(fa) ? fa : en}»)؛ رنگ را با نام رنگ بنویسید، مثلاً «سفید».` };
      const n = normText(fa);
      if (names.has(n)) return { palette: null, error: `«${fa}» دو بار در «${label}» آمده است.` };
      names.add(n);
      let key = clip(r.key, 30).toLowerCase();
      if (!key || !KEY_RE.test(key)) {
        key = unique(slug(en) || axis, keys, 30, "-");
        keys.add(key);
      }
      let code = clip(r.code, 4).toUpperCase();
      if (!code) {
        code = unique(codeFor(en, key), codes, 4);
        codes.add(code);
      }
      const swatch = clip(r.swatch, 9).toLowerCase();
      const facet = clip(r.facet, 20);
      list.push({ key, fa, en, swatch: SWATCH_RE.test(swatch) ? swatch : "", code, facet: FACETS[axis].includes(facet) ? facet : "" });
    }
    palette[axis] = list;
  }
  return { palette, error: null };
}

/** Two combinations that agree on every axis they share (one may have an axis the other has not). */
const compatible = (a: VariantOptions, b: VariantOptions) => OPTION_AXES.every((x) => !a[x] || !b[x] || a[x] === b[x]);

/**
 * The editor's rows for a grid of combinations: every combination gets its row — the one with the same colours, else
 * a stored row no combination holds any more whose stored colours (`orig`) agree with it (adding or dropping a whole
 * axis keeps the stored option, its id and stock: «طلایی» becomes «طلایی · نگین سفید»), else a new one from `make`.
 * Matching the stored colours, not the row's current ones, keeps a swapped colour from taking the stock: «نگین سفید»
 * taken off and «نگین آبی» chosen is a new combination, whichever is clicked first, and the white one is deleted.
 * Rows of combinations that left the grid stay as they are, so choosing a colour again brings them back unchanged.
 */
export function syncCombos<T extends { id: string | null; options: VariantOptions; orig?: VariantOptions }>(rows: T[], grid: VariantOptions[], make: (o: VariantOptions) => T): T[] {
  const keys = new Set(grid.map(optionsKey));
  const out = [...rows];
  const held = new Set(out.filter((r) => keys.has(optionsKey(r.options))));
  for (const o of grid) {
    const k = optionsKey(o);
    if (out.some((r) => optionsKey(r.options) === k)) continue;
    const i = out.findIndex((r) => r.id && !held.has(r) && !keys.has(optionsKey(r.options)) && compatible(r.orig ?? r.options, o));
    if (i >= 0) {
      out[i] = { ...out[i], options: o };
      held.add(out[i]);
    } else out.push(make(o));
  }
  return out;
}
