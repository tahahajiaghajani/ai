/**
 * The products' own marks in the page's ink (currentColor), so they follow normal and inverted bands. Both are
 * single-colour by their brand rules: Siraf's measured alef with three nuqtas, Kariz's qanat arch with its rhombus.
 */
export function ProductMark({ slug, className = "size-10" }: { slug: string; className?: string }) {
  if (slug === "siraf") {
    return (
      <svg viewBox="12 0 40 64" className={className} fill="currentColor" aria-hidden>
        <path d="M40 12L48 4V52L40 60ZM24 12L32 20L24 28L16 20ZM24 28L32 36L24 44L16 36ZM24 44L32 52L24 60L16 52Z" />
      </svg>
    );
  }
  if (slug === "kariz") {
    return (
      <svg viewBox="2.7 3.4 18.6 18.6" className={className} aria-hidden>
        <path d="M17.6 19.6V11.4a5.6 5.6 0 0 0-11.2 0v8.2" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 14.1l2.75 2.75L12 19.6l-2.75-2.75z" fill="currentColor" />
      </svg>
    );
  }
  return null;
}
