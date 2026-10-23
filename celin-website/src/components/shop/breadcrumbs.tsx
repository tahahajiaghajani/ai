import Link from "next/link";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";

/** The path above a page title; `tone="light"` on dark bands (page heroes under the transparent header). */
export function Breadcrumbs({ lang, items, tone = "dark", className = "" }: { lang: Lang; items: { label: string; path?: string }[]; tone?: "dark" | "light"; className?: string }) {
  const light = tone === "light";
  return (
    <nav aria-label={lang === "fa" ? "مسیر صفحه" : "Breadcrumb"} className={`font-ui text-xs ${light ? "text-on-night-muted" : "text-muted"} ${className}`}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && (
              <svg viewBox="0 0 10 10" className={`size-1.5 ${light ? "text-gold-on-dark/70" : "text-gold/60"}`} aria-hidden>
                <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
              </svg>
            )}
            {it.path ? (
              <Link href={href(lang, it.path)} className={`transition-colors ${light ? "hover:text-on-night" : "hover:text-ink"}`}>
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className={light ? "text-on-night" : "text-ink-2"}>
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
