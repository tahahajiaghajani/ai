import "server-only";
import type { Badge, Metal, Spec, Stone } from "@/lib/catalog-types";
import { SEED_MEDIA, type SeedKey } from "@/content/seed-media";

/**
 * The starter catalogue, built from the brand's own photos. The site shows it until the catalogue lives in
 * the database (Admin → Products → «ورود محصولات نمونه», or the first product saved there); after that the
 * admin edits or deletes these items like any other. Prices and stock are samples for the demo.
 */

export interface SeedCategory {
  slug: string;
  name_fa: string;
  name_en: string;
  description_fa: string;
  description_en: string;
  image: SeedKey;
}

export interface SeedCollection {
  slug: string;
  name_fa: string;
  name_en: string;
  tagline_fa: string;
  tagline_en: string;
  story_fa: string;
  story_en: string;
  image: SeedKey;
}

export interface SeedVariant {
  key: string;
  name_fa: string;
  name_en: string;
  swatch: string;
  sku: string;
  price: number | null;
  stock: number;
  image?: SeedKey;
}

export interface SeedProduct {
  slug: string;
  sku: string;
  name_fa: string;
  name_en: string;
  subtitle_fa: string;
  subtitle_en: string;
  description_fa: string;
  description_en: string;
  category: string;
  collection: string;
  metal: Metal;
  stone: Stone;
  specs: Spec[];
  images: SeedKey[];
  price: number;
  stock: number;
  variants: SeedVariant[];
  featured: boolean;
  badge: Badge;
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { slug: "rings", name_fa: "انگشتر", name_en: "Rings", description_fa: "از نگین‌های درشت شب تا حلقه‌های امضای هر روز.", description_en: "From evening cocktail stones to everyday signets.", image: "ring-paraiba-oval" },
  { slug: "necklaces", name_fa: "گردنبند", name_en: "Necklaces", description_fa: "ردیف‌های نور، چوکرها و آویزهای نشان‌دار.", description_en: "Lines of light, chokers and signature pendants.", image: "necklace-triple-tennis" },
  { slug: "earrings", name_fa: "گوشواره", name_en: "Earrings", description_fa: "گوشواره‌هایی که با هر حرکت نور را برمی‌گردانند.", description_en: "Earrings that return the light with every move.", image: "earrings-sunburst" },
  { slug: "bracelets", name_fa: "دستبند و النگو", name_en: "Bracelets & bangles", description_fa: "النگوهای حکاکی‌شده و دستبندهای تنیسی.", description_en: "Engraved bangles and tennis bracelets.", image: "bangles-emerald" },
  { slug: "sets", name_fa: "ست", name_en: "Sets", description_fa: "ست‌های هماهنگ برای شب‌هایی که می‌مانند.", description_en: "Matching sets for the evenings that stay with you.", image: "set-cascade" },
];

export const SEED_COLLECTIONS: SeedCollection[] = [
  {
    slug: "yas",
    name_fa: "یاس",
    name_en: "Yas",
    tagline_fa: "نورِ سفید، از نزدیک",
    tagline_en: "White light, up close",
    story_fa: "یاس، گلی سفید که بویش پیش از خودش می‌رسد. ردیف‌های پیوسته‌ی نگین‌های سفید با تراش اتمی، که هر کدام جدا نشانده شده‌اند تا از هر زاویه نور را برگردانند؛ گاهی در مرکز به یک گل می‌رسند.",
    story_en: "Yas is jasmine, the white flower you notice before you see it. Unbroken rows of white atomic-cut stones, each set on its own to return the light from every angle — sometimes meeting in a single flower.",
    image: "choker-rose",
  },
  {
    slug: "firouzeh",
    name_fa: "فیروزه",
    name_en: "Firouzeh",
    tagline_fa: "آبیِ فیروزه‌ای، در قابی از نور",
    tagline_en: "Firouzeh blue, framed in light",
    story_fa: "رنگی که ایرانی‌ها قرن‌ها با آن آسمان و کاشی را نوشته‌اند. نگین‌های آبی فیروزه‌ای در هاله‌ای از نگین‌های سفید و گلبرگ‌های مارکیز؛ روشن در نور روز، عمیق در شب.",
    story_en: "The colour Persians have used for centuries to write the sky and the tile. Firouzeh-blue centre stones in halos of white and marquise petals — bright by day, deep at night.",
    image: "ring-paraiba-cushion",
  },
  {
    slug: "aftab",
    name_fa: "آفتاب",
    name_en: "Aftab",
    tagline_fa: "پرتوهایی که از یک نقطه باز می‌شوند",
    tagline_en: "Rays opening from a single point",
    story_fa: "آفتاب یعنی نورِ خورشید. ده‌ها پرتو نگین‌کاری‌شده که از یک هلال باز می‌شوند؛ برای شب‌هایی که می‌خواهید دیده شوید.",
    story_en: "Aftab is sunlight. Dozens of pavé rays opening from a single crescent — for the nights you mean to be seen.",
    image: "earrings-sunburst",
  },
  {
    slug: "golbarg",
    name_fa: "گلبرگ",
    name_en: "Golbarg",
    tagline_fa: "مارکیزها، مثل گلبرگ باز می‌شوند",
    tagline_en: "Marquise stones, opening like petals",
    story_fa: "گلبرگ: نگین‌های مارکیز که مثل گلبرگ‌های یک گل روی انگشت باز می‌شوند، روی پرتوهای نگین‌کاری‌شده‌ی رزگلد.",
    story_en: "Golbarg is a petal: marquise stones that open across the finger like the petals of a flower, on pavé rose-gold-tone rays.",
    image: "ring-emerald-fan",
  },
  {
    slug: "kashi",
    name_fa: "کاشی",
    name_en: "Kashi",
    tagline_fa: "هندسه‌ی کاشی، به زبان نگین",
    tagline_en: "The geometry of Persian tile, in stones",
    story_fa: "کاشی یعنی هندسه‌ای که ایران را با آن می‌شناسند. قاب‌های مربع و ردیف‌های منظم نگین، با آبکاری طلایی؛ دقتی که می‌شود پوشید.",
    story_en: "Kashi is the tilework Iran is known for. Square frames and ordered rows of stones in a gold-tone finish — precision you can wear.",
    image: "ring-gold-pave-rows",
  },
  {
    slug: "del",
    name_fa: "دل",
    name_en: "Del",
    tagline_fa: "برای آنچه دل می‌گوید",
    tagline_en: "For what the heart says",
    story_fa: "قلب‌هایی در قاب‌های شیاردار طلایی و نقره‌ای؛ هدیه‌ای که هر روز به دست می‌شود، تنها یا دوتایی.",
    story_en: "Hearts set in ribbed gold-tone and silver-tone frames — a gift worn every day, alone or as a pair.",
    image: "rings-heart-signet",
  },
  {
    slug: "negar",
    name_fa: "نگار",
    name_en: "Negar",
    tagline_fa: "نقشی که دست می‌کشد",
    tagline_en: "Patterns drawn by hand",
    story_fa: "نگار یعنی نقش و هم‌چنین محبوب. سطح‌های حکاکی‌شده‌ی خطی با یک نگین مارکیز رنگی، در دو رنگ طلایی و نقره‌ای؛ کنار هم بهتر دیده می‌شوند.",
    story_en: "Negar means both an engraved image and the beloved. Finely lined, engraved surfaces with a single coloured marquise, in gold and silver tones — better worn together.",
    image: "bangles-sapphire",
  },
  {
    slug: "gereh",
    name_fa: "گره",
    name_en: "Gereh",
    tagline_fa: "گرهی از نور که می‌ماند",
    tagline_en: "A knot of light that stays",
    story_fa: "گره هم پاپیون است و هم نقش‌های هندسی گره‌چینی در هنر ایرانی. پاپیون‌های نگین‌کاری‌شده با آویزهای رنگی و مرواریدی؛ برای پیوندهایی که می‌مانند.",
    story_en: "Gereh is both a bow and the interlaced geometry of Persian art. Pavé bows with coloured and pearl-look drops — for the bonds that last.",
    image: "set-bow-ruby",
  },
];

const RH: Spec = { label_fa: "پوشش", label_en: "Finish", value_fa: "نقره‌ای (آبکاری رودیوم)", value_en: "Silver-tone, rhodium plated" };
const GT: Spec = { label_fa: "پوشش", label_en: "Finish", value_fa: "طلایی (آبکاری طلایی‌رنگ)", value_en: "Gold-tone" };
const RS: Spec = { label_fa: "پوشش", label_en: "Finish", value_fa: "رزگلد (آبکاری رزگلد)", value_en: "Rose-gold-tone" };
const TT: Spec = { label_fa: "پوشش", label_en: "Finish", value_fa: "طلایی یا نقره‌ای (رودیوم)", value_en: "Gold-tone or silver-tone (rhodium plated)" };
const stones = (fa: string, en: string): Spec => ({ label_fa: "نگین", label_en: "Stones", value_fa: fa, value_en: en });
const WHITE = stones("زیرکونیای مکعبی سفید با تراش اتمی", "White cubic zirconia, atomic cut");
const HAND: Spec = { label_fa: "پرداخت", label_en: "Finishing", value_fa: "نشانده و پرداخت‌شده با دست", value_en: "Hand-set and hand-finished" };
const includes = (fa: string, en: string): Spec => ({ label_fa: "شامل", label_en: "Includes", value_fa: fa, value_en: en });

export const SEED_PRODUCTS: SeedProduct[] = [
  // ------------------------------------------------------------ Yas (white)
  {
    slug: "yas-tennis-choker",
    sku: "CL-YAS-CK-001-RH",
    name_fa: "یاس · چوکر تنیسی",
    name_en: "Yas tennis choker",
    subtitle_fa: "تراش گرد · سفید · نقره‌ای (رودیوم)",
    subtitle_en: "Round cut, White, Rhodium plated",
    description_fa: "ردیفی از نگین‌های سفید با تراش گرد که در مرکز به یک گل می‌رسد. سبک است و روی گردن آرام می‌نشیند؛ یقه‌ی ساده را خاص می‌کند.",
    description_en: "A line of round white stones that meets in a single flower. Light on the neck, it turns a plain neckline into an occasion.",
    category: "necklaces",
    collection: "yas",
    metal: "silver",
    stone: "white",
    specs: [RH, WHITE, HAND],
    images: ["choker-rose"],
    price: 5_400_000,
    stock: 4,
    variants: [],
    featured: true,
    badge: "bestseller",
  },
  {
    slug: "yas-triple-riviera",
    sku: "CL-YAS-NK-002-RH",
    name_fa: "یاس · گردنبند سه‌ردیفه",
    name_en: "Yas triple riviera",
    subtitle_fa: "تراش گرد و باگت · سفید · نقره‌ای (رودیوم)",
    subtitle_en: "Round and baguette cut, White, Rhodium plated",
    description_fa: "سه ردیف نگین با فاصله‌ای حساب‌شده که با یک قفل باگت به هم می‌رسند. شکوهی آرام، برای شب.",
    description_en: "Three rows of stones at measured intervals, joined by a baguette clasp. Quiet grandeur for the evening.",
    category: "necklaces",
    collection: "yas",
    metal: "silver",
    stone: "white",
    specs: [RH, WHITE, HAND],
    images: ["necklace-triple-tennis"],
    price: 7_800_000,
    stock: 2,
    variants: [],
    featured: true,
    badge: "limited",
  },
  {
    slug: "yas-tennis-set",
    sku: "CL-YAS-SET-003-RH",
    name_fa: "یاس · ست تنیسی",
    name_en: "Yas tennis set",
    subtitle_fa: "تراش گرد · سفید · نقره‌ای (رودیوم)",
    subtitle_en: "Round cut, White, Rhodium plated",
    description_fa: "گردنبند، دستبند و گوشواره‌ی آویز تنیسی از نگین‌های تراش اتمی؛ پایه‌ی هر جعبه‌ی جواهر.",
    description_en: "The tennis necklace, bracelet and drop earrings in atomic-cut stones — the foundation of any jewelry box.",
    category: "sets",
    collection: "yas",
    metal: "silver",
    stone: "white",
    specs: [RH, WHITE, includes("گردنبند، دستبند و یک جفت گوشواره", "Necklace, bracelet and a pair of earrings")],
    images: ["set-tennis-lace"],
    price: 9_600_000,
    stock: 3,
    variants: [],
    featured: false,
    badge: "",
  },
  {
    slug: "yas-baguette-set",
    sku: "CL-YAS-SET-004-RH",
    name_fa: "یاس · ست آویز باگت",
    name_en: "Yas baguette drop set",
    subtitle_fa: "تراش باگت · سفید · نقره‌ای (رودیوم)",
    subtitle_en: "Baguette cut, White, Rhodium plated",
    description_fa: "نگین‌های باگت که مثل قطره‌های باران از یک ردیف ظریف آویخته‌اند؛ گردنبند، دستبند و گوشواره‌ی هماهنگ.",
    description_en: "Baguette stones hanging from a fine row like falling rain — a matching necklace, bracelet and earrings.",
    category: "sets",
    collection: "yas",
    metal: "silver",
    stone: "white",
    specs: [RH, stones("زیرکونیای مکعبی سفید، تراش باگت و گرد", "White cubic zirconia, baguette and round cut"), includes("گردنبند، دستبند و یک جفت گوشواره", "Necklace, bracelet and a pair of earrings")],
    images: ["set-baguette-drops"],
    price: 8_900_000,
    stock: 2,
    variants: [],
    featured: false,
    badge: "new",
  },
  {
    slug: "yas-cascade-set",
    sku: "CL-YAS-SET-005-RH",
    name_fa: "یاس · ست آبشاری",
    name_en: "Yas cascade set",
    subtitle_fa: "تراش گرد · سفید · نقره‌ای (رودیوم)",
    subtitle_en: "Round cut, White, Rhodium plated",
    description_fa: "گردنبندی که در مرکز به آبشاری از ردیف‌های نگین می‌رسد، با دستبند و گوشواره‌ی بلند هم‌خانواده. چشمگیرترین ست سلین.",
    description_en: "A necklace that falls into a cascade of stone rows, with a matching bracelet and long earrings. The most striking CELIN set.",
    category: "sets",
    collection: "yas",
    metal: "silver",
    stone: "white",
    specs: [RH, WHITE, includes("گردنبند، دستبند و یک جفت گوشواره", "Necklace, bracelet and a pair of earrings")],
    images: ["set-cascade"],
    price: 10_800_000,
    stock: 2,
    variants: [],
    featured: true,
    badge: "limited",
  },
  // ------------------------------------------------------------ Firouzeh (blue)
  {
    slug: "firouzeh-cushion-ring",
    sku: "CL-FIR-RG-001-RH",
    name_fa: "فیروزه · انگشتر کوشن",
    name_en: "Firouzeh cushion ring",
    subtitle_fa: "تراش کوشن · آبی فیروزه‌ای · نقره‌ای (رودیوم)",
    subtitle_en: "Cushion cut, Firouzeh blue, Rhodium plated",
    description_fa: "نگین کوشن آبی فیروزه‌ای در هاله‌ای از نگین‌های سفید. روی شانه‌های انگشتر، برگ‌های مارکیز نور را از هر سو به نگین می‌رسانند.",
    description_en: "A Firouzeh-blue cushion stone in a halo of white. Marquise leaves along the shoulders bring light to the centre from every side.",
    category: "rings",
    collection: "firouzeh",
    metal: "silver",
    stone: "blue",
    specs: [RH, stones("زیرکونیای مکعبی آبی فیروزه‌ای و سفید، تراش کوشن، گرد و مارکیز", "Firouzeh-blue and white cubic zirconia; cushion, round and marquise cut"), HAND],
    images: ["ring-paraiba-cushion"],
    price: 3_850_000,
    stock: 6,
    variants: [],
    featured: true,
    badge: "new",
  },
  {
    slug: "firouzeh-oval-ring",
    sku: "CL-FIR-RG-002-RH",
    name_fa: "فیروزه · انگشتر بیضی",
    name_en: "Firouzeh oval ring",
    subtitle_fa: "تراش بیضی · آبی فیروزه‌ای · نقره‌ای (رودیوم)",
    subtitle_en: "Oval cut, Firouzeh blue, Rhodium plated",
    description_fa: "نگین بیضی آبی که دو ردیف هاله و گلبرگ‌های مارکیز آن را مثل گلی باز در بر گرفته‌اند؛ انگشتری که از دور دیده می‌شود و از نزدیک بهتر.",
    description_en: "An oval blue stone held by a double halo and marquise petals like an open flower — seen from across the room, better up close.",
    category: "rings",
    collection: "firouzeh",
    metal: "silver",
    stone: "blue",
    specs: [RH, stones("زیرکونیای مکعبی آبی فیروزه‌ای و سفید، تراش بیضی و مارکیز", "Firouzeh-blue and white cubic zirconia; oval and marquise cut"), HAND],
    images: ["ring-paraiba-oval", "ring-paraiba-oval-side"],
    price: 4_200_000,
    stock: 4,
    variants: [],
    featured: true,
    badge: "bestseller",
  },
  {
    slug: "firouzeh-pear-wrap-ring",
    sku: "CL-FIR-RG-003-RH",
    name_fa: "فیروزه · انگشتر اشکی پیچان",
    name_en: "Firouzeh pear wrap ring",
    subtitle_fa: "تراش اشکی · آبی فیروزه‌ای · نقره‌ای (رودیوم)",
    subtitle_en: "Pear cut, Firouzeh blue, Rhodium plated",
    description_fa: "حلقه‌ای که دور انگشت می‌پیچد و نگین اشکی آبی را میان دو خط نگین‌کاری‌شده نگه می‌دارد؛ مدرن، سبک و روشن.",
    description_en: "A band that wraps the finger and holds a pear blue stone between two pavé lines — modern, light and bright.",
    category: "rings",
    collection: "firouzeh",
    metal: "silver",
    stone: "blue",
    specs: [RH, stones("زیرکونیای مکعبی آبی فیروزه‌ای و سفید، تراش اشکی و گرد", "Firouzeh-blue and white cubic zirconia; pear and round cut"), HAND],
    images: ["ring-paraiba-wrap", "ring-paraiba-wrap-hand"],
    price: 3_400_000,
    stock: 8,
    variants: [],
    featured: false,
    badge: "",
  },
  // ------------------------------------------------------------ Aftab, Golbarg, Kashi
  {
    slug: "aftab-sunburst-earrings",
    sku: "CL-AFT-ER-001-RH",
    name_fa: "آفتاب · گوشواره",
    name_en: "Aftab sunburst earrings",
    subtitle_fa: "تراش گرد · سفید · نقره‌ای (رودیوم)",
    subtitle_en: "Round cut, White, Rhodium plated",
    description_fa: "ده‌ها پرتو نگین‌کاری‌شده که از یک هلال باز می‌شوند. سبک‌تر از آن‌اند که به نظر می‌رسند.",
    description_en: "Dozens of pavé rays opening from a single crescent. Lighter than they look.",
    category: "earrings",
    collection: "aftab",
    metal: "silver",
    stone: "white",
    specs: [RH, WHITE, HAND],
    images: ["earrings-sunburst"],
    price: 4_450_000,
    stock: 3,
    variants: [],
    featured: true,
    badge: "limited",
  },
  {
    slug: "golbarg-fan-ring",
    sku: "CL-GOL-RG-001-RS",
    name_fa: "گلبرگ · انگشتر بادبزنی",
    name_en: "Golbarg fan ring",
    subtitle_fa: "تراش مارکیز · سبز جنگلی · رزگلد",
    subtitle_en: "Marquise cut, Forest green, Rose-gold-tone",
    description_fa: "پرتوهای نگین‌کاری‌شده‌ی رزگلد که مثل بادبزن روی انگشت باز می‌شوند و در انتهای هر کدام، یک نگین مارکیز سبز جنگلی.",
    description_en: "Pavé rose-gold-tone rays that open across the finger like a fan, each tipped with a forest-green marquise.",
    category: "rings",
    collection: "golbarg",
    metal: "rose",
    stone: "green",
    specs: [RS, stones("زیرکونیای مکعبی سبز جنگلی و سفید، تراش مارکیز و گرد", "Forest-green and white cubic zirconia; marquise and round cut"), HAND],
    images: ["ring-emerald-fan"],
    price: 3_600_000,
    stock: 5,
    variants: [],
    featured: true,
    badge: "",
  },
  {
    slug: "kashi-square-pendant",
    sku: "CL-KAS-PD-001-GT",
    name_fa: "کاشی · آویز مربع",
    name_en: "Kashi square pendant",
    subtitle_fa: "تراش گرد · سفید · طلایی",
    subtitle_en: "Round cut, White, Gold-tone",
    description_fa: "آویزی مربع با قابی حکاکی‌شده و مرکزی نگین‌کاری‌شده، بر زنجیری ظریف. نشانی آرام برای هر روز.",
    description_en: "A square pendant with an engraved frame and a pavé centre on a fine chain. A quiet signature for every day.",
    category: "necklaces",
    collection: "kashi",
    metal: "gold",
    stone: "white",
    specs: [GT, WHITE, HAND],
    images: ["necklace-gold-square"],
    price: 3_700_000,
    stock: 9,
    variants: [],
    featured: false,
    badge: "",
  },
  {
    slug: "kashi-pave-ring",
    sku: "CL-KAS-RG-002-GT",
    name_fa: "کاشی · انگشتر چندردیفه",
    name_en: "Kashi pavé ring",
    subtitle_fa: "تراش گرد · سفید · طلایی",
    subtitle_en: "Round cut, White, Gold-tone",
    description_fa: "سه ردیف نگین درخشان میان پرتوهای شیاردار طلایی؛ انگشتری پهن که نور را منظم پخش می‌کند.",
    description_en: "Three rows of brilliant stones between ribbed gold-tone rays — a wide ring that spreads light in order.",
    category: "rings",
    collection: "kashi",
    metal: "gold",
    stone: "white",
    specs: [GT, WHITE, HAND],
    images: ["ring-gold-pave-rows"],
    price: 3_250_000,
    stock: 7,
    variants: [],
    featured: false,
    badge: "",
  },
  // ------------------------------------------------------------ Del
  {
    slug: "del-signet-ring",
    sku: "CL-DEL-SG-001",
    name_fa: "دل · انگشتر امضا",
    name_en: "Del signet ring",
    subtitle_fa: "تراش گرد · سفید · طلایی یا نقره‌ای",
    subtitle_en: "Round cut, White, Gold-tone or silver-tone",
    description_fa: "قلبی کوچک با قاب نگین‌کاری‌شده بر سطح شیاردار یک انگشتر پهن؛ تنها یا دوتایی، طلایی و نقره‌ای کنار هم.",
    description_en: "A small heart outlined in pavé on the ribbed face of a wide band — alone or as a pair, gold-tone beside silver-tone.",
    category: "rings",
    collection: "del",
    metal: "two-tone",
    stone: "white",
    specs: [TT, WHITE, HAND],
    images: ["rings-heart-signet"],
    price: 2_650_000,
    stock: 0,
    variants: [
      { key: "gold", name_fa: "طلایی", name_en: "Gold-tone", swatch: "gold", sku: "CL-DEL-SG-001-GT", price: null, stock: 9 },
      { key: "silver", name_fa: "نقره‌ای (رودیوم)", name_en: "Silver-tone", swatch: "silver", sku: "CL-DEL-SG-001-RH", price: null, stock: 6 },
    ],
    featured: true,
    badge: "bestseller",
  },
  {
    slug: "del-leaf-ring",
    sku: "CL-DEL-RG-002",
    name_fa: "دل · انگشتر برگ",
    name_en: "Del leaf ring",
    subtitle_fa: "تراش قلب · سفید · طلایی یا نقره‌ای",
    subtitle_en: "Heart cut, White, Gold-tone or silver-tone",
    description_fa: "سه برگ شیاردار که در مرکز به هم می‌رسند و هر کدام نگینی قلبی را در بر دارند.",
    description_en: "Three ribbed leaves meeting at the centre, each holding a heart-cut stone.",
    category: "rings",
    collection: "del",
    metal: "two-tone",
    stone: "white",
    specs: [TT, stones("زیرکونیای مکعبی سفید، تراش قلب و گرد", "White cubic zirconia; heart and round cut"), HAND],
    images: ["rings-heart-leaf"],
    price: 2_900_000,
    stock: 0,
    variants: [
      { key: "gold", name_fa: "طلایی", name_en: "Gold-tone", swatch: "gold", sku: "CL-DEL-RG-002-GT", price: null, stock: 5 },
      { key: "silver", name_fa: "نقره‌ای (رودیوم)", name_en: "Silver-tone", swatch: "silver", sku: "CL-DEL-RG-002-RH", price: null, stock: 4 },
    ],
    featured: false,
    badge: "new",
  },
  // ------------------------------------------------------------ Negar
  {
    slug: "negar-bangle",
    sku: "CL-NEG-BG-001",
    name_fa: "نگار · النگو",
    name_en: "Negar bangle",
    subtitle_fa: "تراش مارکیز · سرمه‌ای، سبز جنگلی یا قرمز اناری · طلایی یا نقره‌ای",
    subtitle_en: "Marquise cut, Night blue, Forest green or Pomegranate red, Gold-tone or silver-tone",
    description_fa: "النگویی با سطح حکاکی‌شده‌ی خطی و نگین‌های مارکیز رنگی. طلایی و نقره‌ای را کنار هم ببندید؛ همان‌طور که ما دوست داریم.",
    description_en: "A bangle with a finely lined, engraved surface and coloured marquise stones. Wear the gold-tone and the silver-tone together, as we like to.",
    category: "bracelets",
    collection: "negar",
    metal: "two-tone",
    stone: "mixed",
    specs: [TT, stones("زیرکونیای مکعبی رنگی و سفید، تراش مارکیز و گرد", "Coloured and white cubic zirconia; marquise and round cut"), HAND],
    images: ["bangles-emerald", "bangles-sapphire", "bangles-ruby"],
    price: 3_300_000,
    stock: 0,
    variants: [
      { key: "gold-navy", name_fa: "طلایی · سرمه‌ای", name_en: "Gold-tone · Night blue", swatch: "gold", sku: "CL-NEG-BG-001-GT-NB", price: null, stock: 4, image: "bangles-sapphire" },
      { key: "silver-navy", name_fa: "نقره‌ای · سرمه‌ای", name_en: "Silver-tone · Night blue", swatch: "silver", sku: "CL-NEG-BG-001-RH-NB", price: null, stock: 4, image: "bangles-sapphire" },
      { key: "gold-green", name_fa: "طلایی · سبز جنگلی", name_en: "Gold-tone · Forest green", swatch: "gold", sku: "CL-NEG-BG-001-GT-FG", price: null, stock: 3, image: "bangles-emerald" },
      { key: "silver-green", name_fa: "نقره‌ای · سبز جنگلی", name_en: "Silver-tone · Forest green", swatch: "silver", sku: "CL-NEG-BG-001-RH-FG", price: null, stock: 3, image: "bangles-emerald" },
      { key: "gold-red", name_fa: "طلایی · قرمز اناری", name_en: "Gold-tone · Pomegranate red", swatch: "gold", sku: "CL-NEG-BG-001-GT-PR", price: null, stock: 2, image: "bangles-ruby" },
      { key: "silver-red", name_fa: "نقره‌ای · قرمز اناری", name_en: "Silver-tone · Pomegranate red", swatch: "silver", sku: "CL-NEG-BG-001-RH-PR", price: null, stock: 2, image: "bangles-ruby" },
    ],
    featured: true,
    badge: "",
  },
  // ------------------------------------------------------------ Gereh
  {
    slug: "gereh-pearl-earrings",
    sku: "CL-GER-ER-001-RH",
    name_fa: "گره · گوشواره مرواریدی",
    name_en: "Gereh pearl-drop earrings",
    subtitle_fa: "تراش گرد · سفید و مرواریدی · نقره‌ای (رودیوم)",
    subtitle_en: "Round cut, White and pearl-look, Rhodium plated",
    description_fa: "پاپیونی از خطوط نگین‌کاری‌شده که یک آویز اشکی مرواریدی از آن آویخته است؛ کلاسیک و ماندگار.",
    description_en: "A bow drawn in pavé lines with a pearl-look drop beneath — classic and lasting.",
    category: "earrings",
    collection: "gereh",
    metal: "silver",
    stone: "pearl",
    specs: [RH, stones("زیرکونیای مکعبی سفید با تراش گرد و آویز مرواریدی", "White round-cut cubic zirconia and a pearl-look drop"), HAND],
    images: ["earrings-bow-pearl"],
    price: 3_950_000,
    stock: 6,
    variants: [],
    featured: true,
    badge: "",
  },
  {
    slug: "gereh-bow-set",
    sku: "CL-GER-SET-002-RH",
    name_fa: "گره · ست گوشواره و انگشتر",
    name_en: "Gereh bow set",
    subtitle_fa: "تراش اشکی و امرالد · سرمه‌ای یا قرمز اناری · نقره‌ای (رودیوم)",
    subtitle_en: "Pear and emerald cut, Night blue or Pomegranate red, Rhodium plated",
    description_fa: "گوشواره‌های پاپیونی با آویز رنگی و انگشتر مربع هم‌خانواده؛ در دو رنگ سرمه‌ای و قرمز اناری.",
    description_en: "Bow earrings with a coloured drop and a matching square ring, in night blue or pomegranate red.",
    category: "sets",
    collection: "gereh",
    metal: "silver",
    stone: "navy",
    specs: [RH, stones("زیرکونیای مکعبی رنگی و سفید، تراش اشکی، امرالد و گرد", "Coloured and white cubic zirconia; pear, emerald and round cut"), includes("یک جفت گوشواره و یک انگشتر", "A pair of earrings and a ring")],
    images: ["set-bow-sapphire", "set-bow-ruby"],
    price: 6_900_000,
    stock: 0,
    variants: [
      { key: "navy", name_fa: "سرمه‌ای", name_en: "Night blue", swatch: "#1f3a6e", sku: "CL-GER-SET-002-RH-NB", price: null, stock: 3, image: "set-bow-sapphire" },
      { key: "red", name_fa: "قرمز اناری", name_en: "Pomegranate red", swatch: "#9e1b32", sku: "CL-GER-SET-002-RH-PR", price: null, stock: 2, image: "set-bow-ruby" },
    ],
    featured: true,
    badge: "new",
  },
];

export const seedMedia = (k: SeedKey) => SEED_MEDIA[k];
