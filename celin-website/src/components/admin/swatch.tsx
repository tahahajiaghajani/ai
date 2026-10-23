"use client";

/** Colour dot of a product option: a preset (gold | silver | rose | black | two-tone) or a custom #rrggbb. */

export const SWATCH_PRESETS = [
  { key: "gold", fa: "طلایی", en: "Gold tone" },
  { key: "silver", fa: "نقره‌ای", en: "Silver tone" },
  { key: "rose", fa: "رزگلد", en: "Rose gold" },
  { key: "black", fa: "مشکی", en: "Black" },
  { key: "two-tone", fa: "دورنگ", en: "Two-tone" },
] as const;

const PRESET_CLASS: Record<string, string> = {
  gold: "bg-swatch-gold",
  silver: "bg-swatch-silver",
  rose: "bg-swatch-rose",
  black: "bg-swatch-black",
  "two-tone": "bg-[linear-gradient(135deg,var(--color-swatch-gold)_50%,var(--color-swatch-silver)_50%)]",
};

export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export function Swatch({ value, className = "size-5" }: { value: string; className?: string }) {
  if (!value) return <span aria-hidden className={`inline-block shrink-0 rounded-full border border-dashed border-line-strong ${className}`} />;
  const preset = PRESET_CLASS[value];
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ring-1 ring-ink/15 ${preset ?? ""} ${className}`} style={preset ? undefined : isHex(value) ? { background: value } : undefined} />;
}

export function swatchLabel(value: string): string {
  if (!value) return "بدون رنگ";
  return SWATCH_PRESETS.find((p) => p.key === value)?.fa ?? value;
}
