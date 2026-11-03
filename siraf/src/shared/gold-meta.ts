// Validation of a coin item's or bar model's metadata (tz_items.gold_meta) and board key
// (tz_items.rate_key). Kept apart from gold-catalogue.ts so the UI bundle does not carry zod.
import { z } from "zod";
import { isNumeric, D } from "./money";
import { DATE_BAND_RE, RATE_KEY_RE, coinMeta, type GoldMeta, type ProductKind } from "./gold-catalogue";

const dec = (label: string, opts: { max?: number } = {}) =>
  z
    .union([z.string().max(40), z.number()])
    .nullish()
    .transform((v, c) => {
      if (v === null || v === undefined || v === "") return null;
      if (!isNumeric(v)) {
        c.addIssue({ code: "custom", message: `«${label}» باید عدد باشد` });
        return z.NEVER;
      }
      const d = D(v);
      if (d.isNeg() || (opts.max !== undefined && d.gt(opts.max))) {
        c.addIssue({ code: "custom", message: `«${label}» معتبر نیست` });
        return z.NEVER;
      }
      return d.toString();
    });

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));

export const goldMetaSchema = z.object({
  family: z.enum(["bank", "parsian", "foreign", "other", "bar"]).optional(),
  spec: text(40),
  design: z.enum(["emami", "old"]).nullish(),
  date_band: z
    .string()
    .nullish()
    .refine((v) => !v || DATE_BAND_RE.test(v), "دوره‌ی ضرب معتبر نیست (۸۶، زیر ۸۶ یا سال چهاررقمی)"),
  packaging: z.enum(["sealed", "loose"]).nullish(),
  sut: z.number().int().min(1).max(100000).nullish(),
  pricing_mode: z.enum(["board", "weight", "manual"]).optional(),
  wage_type: z.enum(["percent", "per_gram", "fixed"]).nullish(),
  wage_value: dec("اجرت"),
  profit_pct: dec("سود فروشنده", { max: 100 }),
  vat_mode: z.enum(["exempt", "wage_profit", "margin", "full"]).optional(),
  buy_spread_pct: dec("اختلاف خرید", { max: 100 }),
  tolerance: dec("رواداری وزن"),
  tgju: z
    .string()
    .max(60)
    .nullish()
    .refine((v) => !v || /^[a-z0-9_]{2,60}$/.test(v), "کلید tgju معتبر نیست"),
  brand: text(80),
  bar_type: z.enum(["minted", "cast", "kilo", "other"]).nullish(),
  premium_type: z.enum(["pct", "per_gram", "per_bar"]).nullish(),
  premium_value: dec("حق ضرب"),
  fee_sealed_pct: dec("کارمزد خرید شمش پلمپ", { max: 100 }),
  fee_opened_pct: dec("کارمزد خرید شمش باز", { max: 100 }),
  assay_fee: dec("هزینه‌ی ری‌گیری"),
});

/** Validated metadata with the family's defaults (Persian error message on the first problem). */
export function parseGoldMeta(kind: ProductKind, raw: unknown): { meta: GoldMeta } | { error: string } {
  const r = goldMetaSchema.safeParse(raw ?? {});
  if (!r.success) return { error: r.error.issues[0]?.message ?? "مشخصات سکه معتبر نیست" };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.data)) if (v !== null && v !== undefined) clean[k] = v;
  if (kind === "bar") clean.family = "bar";
  else if (clean.family === "bar") return { error: "خانواده‌ی سکه معتبر نیست" };
  return { meta: coinMeta(kind, clean as GoldMeta) };
}

/** A board key in canonical form, or null; throws a Persian message when it is not valid. */
export function normalizeRateKey(raw: unknown): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const k = String(raw).trim().toLowerCase();
  if (!RATE_KEY_RE.test(k)) throw new Error("کلید تابلو باید ۲ تا ۴۰ حرف لاتین کوچک، رقم یا _ باشد (مثل rob_pre86)");
  return k;
}
