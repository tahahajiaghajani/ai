"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { commonCopy } from "@/content/copy/common";
import { formatDate, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { LuxFrame } from "@/components/ui/lux-frame";
import { ProCodeLink } from "@/components/pro/pro-code-link";
import { ProSeal } from "@/components/pro/seal";
import { useMe } from "@/components/pro/session";
import { ProSteps } from "@/components/pro/steps";

export { ProSeal };

/** The seal under its own hairline arch, like a window in the bar. */
function SealWindow({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="relative inline-grid shrink-0 place-items-end" style={{ "--ring-gap": size === "md" ? "6px" : "4px", "--ring": "rgb(156 94 52 / 0.42)" } as CSSProperties}>
      {/* a vitrine light behind the seal */}
      <span aria-hidden className="absolute -inset-6 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(233_185_138/0.45),transparent)]" />
      <span aria-hidden className="arch-ring" />
      <ProSeal size={size} />
    </span>
  );
}

/**
 * The bar above every product grid — the "Pro button above the products" of the brief. A jewel-box panel of
 * warm glass: the seal in its arch window, two calm lines that say where the visitor stands, the next step.
 * Guest → enter a code / request; member → request / have a code; pending → the steps and the status;
 * code issued → enter it; Pro → a quiet line that prices are shown, with the validity.
 */
export function ProBar({ lang, className = "" }: { lang: Lang; className?: string }) {
  const c = commonCopy(lang);
  const b = c.proBar;
  const me = useMe();
  if (me === undefined) return <div className={`min-h-[11rem] sm:min-h-[6.5rem] ${className}`} aria-hidden />;

  if (me?.pro.active) {
    return (
      <div className={`relative flex min-h-14 animate-fade-in flex-wrap items-center gap-x-4 gap-y-1 border-y border-gold/25 py-2.5 font-ui text-sm ${className}`}>
        <ProSeal />
        <span className="text-gold-text">{b.active}</span>
        <span aria-hidden className="size-1 rotate-45 bg-gold/50" />
        <span className="text-ink-2">{b.activeText}</span>
        {me.pro.expiresAt && <span className="ms-auto text-xs text-muted">{c.proSheet.until(formatDate(me.pro.expiresAt, lang))}</span>}
      </div>
    );
  }

  const state = !me ? "guest" : me.pro.issued ? "issued" : me.pro.request === "pending" ? "pending" : "signedIn";
  const title = state === "pending" ? b.pendingTitle : state === "issued" ? b.issued : b.title;
  const text = state === "guest" ? c.proSheet.intro : state === "signedIn" ? b.signedIn : state === "pending" ? b.pendingText : b.issuedText;

  return (
    <LuxFrame className={`glass animate-fade-in overflow-hidden ${className}`}>
      <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60%_160%_at_0%_50%,var(--color-gold-mist),transparent_72%),radial-gradient(45%_140%_at_100%_50%,var(--color-champagne-2),transparent_70%)]" />
      <div className="relative grid items-center gap-x-8 gap-y-4 px-5 pt-6 pb-5 sm:px-7 sm:py-5 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:px-8">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <SealWindow />
          <div className="min-w-0">
            <p className="title-card text-ink">
              <span className="sr-only ltr">PRO — </span>
              {title}
            </p>
            <p className="mt-0.5 font-ui text-sm leading-7 text-muted">{text}</p>
          </div>
        </div>

        {/* a hairline with a rhombus between the message and the next step (desktop) */}
        <span aria-hidden className="relative hidden h-12 w-px self-center bg-gold/25 lg:block">
          <span className="absolute top-1/2 left-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-gold/70" />
        </span>

        {state === "pending" ? (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-gold/20 pt-4 lg:border-0 lg:pt-0">
            <ProSteps lang={lang} current={1} className="w-full sm:w-[22rem]" />
            <Link href={href(lang, "/account/pro")} className="btn-link">
              {b.statusCta}
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-gold/20 pt-4 lg:border-0 lg:pt-0">
            {state === "guest" && (
              <>
                <ProCodeLink lang={lang} className="btn btn-metal flex-1 sm:flex-none">
                  {b.guestCta}
                </ProCodeLink>
                <Link href={href(lang, "/pro")} className="btn-link max-sm:mx-auto">
                  {b.requestCta}
                </Link>
              </>
            )}
            {state === "signedIn" && (
              <>
                <Link href={`${href(lang, "/pro")}#request`} className="btn btn-metal flex-1 sm:flex-none">
                  {b.signedInCta}
                </Link>
                <ProCodeLink lang={lang} className="btn-link max-sm:mx-auto">
                  {b.codeCta}
                </ProCodeLink>
              </>
            )}
            {state === "issued" && (
              <ProCodeLink lang={lang} className="btn btn-metal flex-1 sm:flex-none">
                {b.issuedCta}
              </ProCodeLink>
            )}
          </div>
        )}
      </div>
    </LuxFrame>
  );
}
