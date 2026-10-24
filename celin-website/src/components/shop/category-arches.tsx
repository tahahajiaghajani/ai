"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { Picture } from "@/components/ui/picture";

export interface CategoryArchItem {
  slug: string;
  name: string;
  media: Media | null;
  /** e.g. «۴ اثر» */
  count: string;
}

interface Props {
  lang: Lang;
  items: CategoryArchItem[];
  current: string | null;
  label: string;
  allLabel: string;
  /** count label of «همه» */
  total: string;
}

/**
 * The categories as an arcade on one sill (in-page navigation on the dark shop hero): each a small arch
 * window onto the category's picture; «همه» is the house monogram. The current one wears the champagne ring
 * and keystone. Swipes sideways on phones; centred on wide screens.
 */
export function CategoryArchesView({ lang, items, current, label, allLabel, total, qs = "" }: Props & { qs?: string }) {
  const list = [{ slug: "", name: allLabel, media: null, count: total }, ...items];
  return (
    <nav aria-label={label} className="-mx-[var(--gutter)] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="relative mx-auto flex w-max min-w-full justify-start gap-[clamp(1rem,2.6vw,2.5rem)] px-[var(--gutter)] pt-4 pb-1 [--tw:6.25rem] sm:justify-center sm:[--tw:7.5rem] lg:[--tw:clamp(8rem,9.4vw,9.5rem)]">
        {/* the sill under the whole arcade */}
        <span aria-hidden className="pointer-events-none absolute inset-x-[var(--gutter)] top-[calc(1rem+var(--tw)*4/3)] h-px bg-[image:var(--metal-champagne)] opacity-45" />
        {list.map((k, i) => {
          const on = (current ?? "") === k.slug;
          return (
            <li key={k.slug || "all"} className="shrink-0">
              <Link
                href={`${href(lang, k.slug ? `/shop/${k.slug}` : "/shop")}${qs}`}
                aria-current={on ? "page" : undefined}
                className="group flex w-[var(--tw)] flex-col items-center text-center outline-offset-4"
              >
                <span className="relative block aspect-[3/4] w-full [--ring-gap:6px]">
                  <span
                    aria-hidden
                    className={`arch-ring transition-opacity duration-500 ${on ? "opacity-100" : "opacity-0 group-hover:opacity-60"}`}
                    style={{ "--ring": "var(--color-gold-on-dark)" } as CSSProperties}
                  />
                  {on && (
                    <svg aria-hidden viewBox="0 0 10 10" className="absolute left-1/2 top-[-6px] z-[2] size-2 -translate-x-1/2 -translate-y-1/2 text-gold-glow">
                      <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                    </svg>
                  )}
                  <span className="fx-sheen arch absolute inset-0 overflow-hidden bg-night-3">
                    {k.media ? (
                      <Picture
                        media={k.media}
                        lang={lang}
                        alt=""
                        sizes="(min-width: 1024px) 10vw, (min-width: 640px) 8rem, 6.5rem"
                        priority={i < 4}
                        className="absolute inset-0"
                        imgClassName="transition-transform duration-[1.2s] ease-[var(--ease-out-expo)] group-hover:scale-[1.07]"
                      />
                    ) : (
                      <span aria-hidden className="absolute inset-0 grid place-items-center bg-mesh-cocoa">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/brand/celin-mark-reverse.svg" alt="" className="w-[40%] translate-y-[8%] opacity-90" width={186} height={256} />
                      </span>
                    )}
                    <span aria-hidden className={`absolute inset-0 bg-gradient-to-t from-night/55 via-night/10 to-transparent transition-opacity duration-700 ${on ? "opacity-40" : "opacity-100 group-hover:opacity-30"}`} />
                  </span>
                </span>
                <span className={`title-card mt-3.5 transition-colors duration-500 sm:mt-4 ${on ? "text-gold-glow" : "text-on-night group-hover:text-gold-glow"}`}>{k.name}</span>
                <span className="font-ui text-[11px] leading-5 text-on-night-muted">{k.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The arcade with the visitor's current filters carried into each category link. */
export function CategoryArches(props: Props) {
  const sp = useSearchParams();
  const qs = sp?.toString() ? `?${sp.toString()}` : "";
  return <CategoryArchesView {...props} qs={qs} />;
}
