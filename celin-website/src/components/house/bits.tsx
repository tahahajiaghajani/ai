import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Icon } from "@/components/ui/icons";

/**
 * Small pieces shared by the house pages (/maison, /craft, /care, /contact, /collections).
 */

export const diamond = (className = "size-2 text-gold") => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

/** The diamond eyebrow of the design system (copper on light grounds, champagne on dark). */
export function Eyebrow({ children, tone = "dark", center = false, className = "", style, reveal = false }: { children: ReactNode; tone?: "dark" | "light"; center?: boolean; className?: string; style?: CSSProperties; reveal?: boolean }) {
  return (
    <p
      className={`label flex items-center gap-2.5 ${center ? "justify-center" : ""} ${tone === "light" ? "text-gold-on-dark!" : "text-gold-text!"} ${className}`}
      data-reveal={reveal || undefined}
      style={style}
    >
      {diamond(`size-1.5 shrink-0 ${tone === "light" ? "text-gold-glow" : "text-gold"}`)}
      {children}
    </p>
  );
}

/** Breadcrumbs for a dark hero (the shop's breadcrumbs are styled for light grounds). */
export function NightCrumbs({ lang, items, className = "" }: { lang: Lang; items: { label: string; path?: string }[]; className?: string }) {
  return (
    <nav aria-label={lang === "fa" ? "مسیر صفحه" : "Breadcrumb"} className={`text-xs text-on-night-muted ${className}`}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <Icon name="chevron" className="size-3 opacity-60 rtl:-scale-x-100" />}
            {it.path ? (
              <Link href={href(lang, it.path)} className="transition-colors hover:text-on-night">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-on-night">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A champagne (dark grounds) or copper (light grounds) sill under a row of arches. */
export function Sill({ tone = "copper", className = "" }: { tone?: "copper" | "champagne"; className?: string }) {
  return <span aria-hidden className={`block h-px ${tone === "champagne" ? "bg-[image:var(--metal-champagne)] opacity-60" : "bg-[image:var(--metal-copper)] opacity-50"} ${className}`} />;
}

/** «۰۱» in the page language. */
export const ordinal = (i: number, lang: Lang) => num(String(i).padStart(2, "0"), lang);

/**
 * A numeral for a big moment (404, years): the Persian zero becomes the brand's copper rhombus, as the dot
 * of Naskh calligraphy. `className` sets the size and the fill of the digits.
 */
export function RhombusDigits({ text, lang, className = "", zeroClassName = "" }: { text: string; lang: Lang; className?: string; zeroClassName?: string }) {
  const parts = lang === "fa" ? text.split(/(۰)/).filter(Boolean) : [text];
  return (
    <span className={`ltr inline-flex items-center ${className}`} aria-hidden>
      {parts.map((p, i) =>
        p === "۰" ? (
          <svg key={i} viewBox="0 0 10 14" className={`mx-[0.04em] h-[0.42em] w-auto ${zeroClassName}`}>
            <defs>
              <linearGradient id={`rh-${i}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style={{ stopColor: "var(--color-gold-deep)" }} />
                <stop offset="0.45" style={{ stopColor: "var(--color-gold-bright)" }} />
                <stop offset="0.6" style={{ stopColor: "var(--color-gold-glow)" }} />
                <stop offset="1" style={{ stopColor: "var(--color-gold)" }} />
              </linearGradient>
            </defs>
            <path d="M5 0 10 7 5 14 0 7Z" fill={`url(#rh-${i})`} />
          </svg>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
