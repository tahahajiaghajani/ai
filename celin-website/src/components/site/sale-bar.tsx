"use client";

import Link from "next/link";
import { useLayoutEffect, useSyncExternalStore, type CSSProperties } from "react";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { SaleBarData } from "@/lib/sale";

/** The inline script: html[data-sale] = "on" inside the window by the browser's clock, else "off" (numbers only). */
const script = (from: number, until: number) => `(function(n){document.documentElement.dataset.sale=n>=${from}&&n<${until}?"on":"off"})(Date.now())`;

const never = () => () => {};
const MAX_TIMER = 2_147_483_647;

/**
 * The look of the bar: one quiet 2rem line in the announcement's place — the sale's title and percentage, the
 * description beside it from tablets up; a link when the admin gave one; no close button, no motion. Shared by the
 * site (SaleBar) and the admin's live preview.
 */
export function SaleBarView({ lang, bar, preview = false }: { lang: Lang; bar: Pick<SaleBarData, "headline" | "text" | "className" | "color" | "link">; preview?: boolean }) {
  const inner = (
    <span className="block truncate">
      <span className="font-bold">{bar.headline}</span>
      {bar.text && <span className="max-sm:hidden"> — {bar.text}</span>}
    </span>
  );
  const style = bar.color ? ({ "--sale-bg": bar.color } as CSSProperties) : undefined;
  return (
    <div className={`relative h-8 border-b text-center font-ui text-xs leading-8 ${bar.className} ${preview ? "" : "z-[51]"}`} style={style}>
      <div className={preview ? "px-4" : "container-lux"}>
        {bar.link && !preview ? (
          bar.link.startsWith("/") ? (
            <Link href={href(lang, bar.link)} className="block underline-offset-4 hover:underline">
              {inner}
            </Link>
          ) : (
            <a href={bar.link} className="block underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
              {inner}
            </a>
          )
        ) : (
          inner
        )}
      </div>
    </div>
  );
}

/**
 * The special-day discount bar of the public pages. Static pages carry it with its window; the browser decides
 * whether it shows (html[data-sale], set by an inline script before the first paint, and again by a timer when the
 * window opens or closes in an open tab). While it shows, the announcement bar steps aside (globals.css). Without
 * JS it shows when the page was built inside the window (data-live). Prices are never here: the server decides them.
 */
export function SaleBar({ lang, bar }: { lang: Lang; bar: SaleBarData }) {
  // the script element stays as the server sent it while hydrating; pages React renders in the browser use the effect
  const fromServer = useSyncExternalStore(never, () => false, () => true);
  useLayoutEffect(() => {
    const h = document.documentElement;
    let timer = 0;
    const set = () => {
      const now = Date.now();
      h.dataset.sale = now >= bar.from && now < bar.until ? "on" : "off";
      const next = now < bar.from ? bar.from : now < bar.until ? bar.until : 0;
      if (next && next - now < MAX_TIMER) timer = window.setTimeout(set, next - now + 50);
    };
    set();
    return () => {
      window.clearTimeout(timer);
      delete h.dataset.sale;
    };
  }, [bar.from, bar.until]);
  return (
    <>
      {fromServer ? <script dangerouslySetInnerHTML={{ __html: script(bar.from, bar.until) }} /> : null}
      <div data-sale-bar data-live={bar.live ? "" : undefined}>
        <SaleBarView lang={lang} bar={bar} />
      </div>
    </>
  );
}
