"use client";

import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { openProSheet } from "@/components/pro/events";
import { useMe } from "@/components/pro/session";

/**
 * The quiet bar above every product grid — the "Pro button above the products" of the brief. It says what
 * the visitor can do next (enter a code, request membership, wait for review) and disappears for members.
 */
export function ProBar({ lang, className = "" }: { lang: Lang; className?: string }) {
  const c = commonCopy(lang).proBar;
  const me = useMe();
  if (me === undefined) return <div className={`h-11 ${className}`} aria-hidden />;
  if (me?.pro.active) return null;
  const state = !me ? "guest" : me.pro.issued ? "issued" : me.pro.request === "pending" ? "pending" : "signedIn";
  const text = state === "guest" ? c.guest : state === "issued" ? c.issued : state === "pending" ? c.pending : c.signedIn;
  const cta = state === "guest" ? c.guestCta : state === "issued" ? c.issuedCta : state === "signedIn" ? c.signedInCta : null;
  return (
    <div className={`flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-line bg-bone px-4 py-2 text-sm text-ink-2 sm:px-5 ${className}`}>
      <span className="flex items-center gap-2.5">
        <span className="font-label text-[11px] tracking-[0.18em] text-gold-text ltr">PRO</span>
        <span className="h-3 w-px bg-line-strong" aria-hidden />
        {text}
      </span>
      {cta && (
        <button
          type="button"
          onClick={() => openProSheet(state === "signedIn" ? "request" : "code")}
          className="h-8 border border-ink px-4 text-xs text-ink transition-colors hover:bg-ink hover:text-bone"
        >
          {cta}
        </button>
      )}
    </div>
  );
}
