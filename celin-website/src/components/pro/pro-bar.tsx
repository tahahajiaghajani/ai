"use client";

import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { openProSheet } from "@/components/pro/events";
import { useMe } from "@/components/pro/session";

/** The copper PRO seal: a small arch of living metal (decorative; the text beside it says what it means). */
export function ProSeal({ className = "", large = false }: { className?: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`arch relative inline-grid shrink-0 items-end justify-items-center bg-metal font-label leading-none font-semibold text-ink shadow-[0_6px_14px_-8px_var(--color-gold-deep)] ltr ${large ? "h-16 w-13 pb-3 text-[11px] tracking-[0.18em]" : "h-9 w-8 pb-1.5 text-[8.5px] tracking-[0.12em]"} ${className}`}
    >
      PRO
    </span>
  );
}

/**
 * The bar above every product grid — the "Pro button above the products" of the brief. Warm glass in a
 * copper hairline frame: it says what the visitor can do next (enter a code, request membership, wait for
 * review) and disappears for members.
 */
export function ProBar({ lang, className = "" }: { lang: Lang; className?: string }) {
  const c = commonCopy(lang).proBar;
  const me = useMe();
  if (me === undefined) return <div className={`min-h-14 ${className}`} aria-hidden />;
  if (me?.pro.active) return null;
  const state = !me ? "guest" : me.pro.issued ? "issued" : me.pro.request === "pending" ? "pending" : "signedIn";
  const text = state === "guest" ? c.guest : state === "issued" ? c.issued : state === "pending" ? c.pending : c.signedIn;
  const cta = state === "guest" ? c.guestCta : state === "issued" ? c.issuedCta : state === "signedIn" ? c.signedInCta : null;
  return (
    <div
      className={`frame-metal glass relative isolate flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-3 overflow-hidden px-3 py-2.5 [--frame:var(--metal-copper)] sm:px-4 animate-fade-in ${className}`}
    >
      <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(55%_140%_at_0%_50%,var(--color-gold-mist),transparent_70%),radial-gradient(40%_120%_at_100%_50%,var(--color-champagne-2),transparent_70%)] opacity-90" />
      <span className="flex min-w-0 items-center gap-3 font-ui text-sm leading-6 text-ink-2">
        <ProSeal />
        <span className="sr-only ltr">PRO — </span>
        {text}
      </span>
      {cta && (
        <button type="button" onClick={() => openProSheet(state === "signedIn" ? "request" : "code")} className="btn btn-metal min-h-10 px-5 text-xs">
          {cta}
        </button>
      )}
    </div>
  );
}
