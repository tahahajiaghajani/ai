/** A plating / stone colour dot. */
export function swatchClass(swatch: string): string {
  switch (swatch) {
    case "gold":
      return "bg-swatch-gold";
    case "silver":
      return "bg-swatch-silver";
    case "rose":
      return "bg-swatch-rose";
    case "black":
      return "bg-swatch-black";
    case "two-tone":
      return "bg-[linear-gradient(135deg,var(--color-swatch-gold)_50%,var(--color-swatch-silver)_50%)]";
    default:
      return "";
  }
}

export function Swatch({ swatch, className = "size-3" }: { swatch: string; className?: string }) {
  const custom = /^#[0-9a-f]{6}$/i.test(swatch);
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ring-1 ring-ink/10 ${custom ? "" : swatchClass(swatch)} ${className}`} style={custom ? { background: swatch } : undefined} />;
}
