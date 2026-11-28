"use client";

import { Icon } from "@/components/ui/icons";

/** Colour dot of a product option: a preset (gold | silver | rose | champagne | black | two-tone) or a custom #rrggbb. */

export const SWATCH_PRESETS = [
  { key: "gold", fa: "طلایی", en: "Gold tone" },
  { key: "silver", fa: "نقره‌ای", en: "Silver tone" },
  { key: "rose", fa: "رزگلد", en: "Rose gold" },
  { key: "champagne", fa: "شامپاین گلد", en: "Champagne gold" },
  { key: "black", fa: "مشکی", en: "Black" },
  { key: "two-tone", fa: "دورنگ", en: "Two-tone" },
] as const;

// written out literally: Tailwind only generates classes it can read in the source
const PRESET_CLASS: Record<string, string> = {
  gold: "bg-swatch-gold",
  silver: "bg-swatch-silver",
  rose: "bg-swatch-rose",
  champagne: "bg-swatch-champagne",
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

/**
 * Picks a dot: the presets (`presets`: the metals for plating and the plain list; none for stone and leather colours,
 * which are the admin's own) and a free colour.
 */
export function SwatchPicker({ value, onChange, presets = true, none = true, label = "رنگ نشانگر", hex = true }: { value: string; onChange: (v: string) => void; presets?: boolean; none?: boolean; label?: string; hex?: boolean }) {
  const custom = isHex(value);
  const opts = [...(none ? [{ key: "", fa: "بدون رنگ" }] : []), ...(presets ? SWATCH_PRESETS : [])];
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center sm:gap-1">
      {opts.map((o) => (
        <button
          key={o.key || "none"}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          aria-label={o.fa}
          title={o.fa}
          onClick={() => onChange(o.key)}
          className={`grid size-10 place-items-center rounded-full border transition-colors ${value === o.key ? "border-ink" : "border-transparent hover:border-line-strong"}`}
        >
          <Swatch value={o.key} className="size-6" />
        </button>
      ))}
      <label
        title="رنگ دلخواه"
        className={`relative grid size-10 cursor-pointer place-items-center rounded-full border transition-colors focus-within:outline focus-within:outline-1 focus-within:outline-gold ${custom ? "border-ink" : "border-transparent hover:border-line-strong"}`}
      >
        {/* the only raw colour of the admin: a free swatch colour chosen by the admin */}
        <input type="color" value={custom ? value : "#7a7a7a"} onChange={(e) => onChange(e.target.value.toLowerCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="رنگ دلخواه" />
        {custom ? <Swatch value={value} className="size-6" /> : <span className="grid size-6 place-items-center rounded-full border border-dashed border-line-strong text-muted"><Icon name="plus" className="size-3.5" /></span>}
      </label>
      {custom && hex && <span className="ltr ms-1 font-mono text-xs text-muted">{value}</span>}
    </div>
  );
}
