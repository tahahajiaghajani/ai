import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Task Flow mark: a check whose long arm becomes a flow line ending in a node —
 * a task done, and the work flowing on. Navy tile = trust and stability.
 */
export function Logo({ className = "size-9" }: { className?: string }) {
  // unique gradient ids: a hidden copy (e.g. the desktop-only brand) must not take the others' fill with it
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1a2a5e" />
          <stop offset="1" stopColor="#0b1222" />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4f72ff" />
          <stop offset="1" stopColor="#3fe0f5" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id}t)`} />
      <rect x="0.5" y="0.5" width="47" height="47" rx="12.5" fill="none" stroke="#fff" strokeOpacity="0.08" />
      <path d="M12 25.6 L19 32.6 C 25 38.6 27 16.2 34.2 16.2" fill="none" stroke={`url(#${id}f)`} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35.4" cy="16.2" r="3.5" fill="#fff" />
    </svg>
  );
}

/** The wordmark: «task flow», with the flow in the brand gradient. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cn("font-brand font-semibold tracking-[-0.04em] text-fg", className)}>
      task <span className="text-gradient">flow</span>
    </span>
  );
}

/** Creator signature — gold, used sparingly. */
export function Signature({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cn("font-brand text-[10px] font-light uppercase tracking-[0.3em] text-gold", className)}>
      By Taha Aghajani
    </span>
  );
}

export function Brand({ signature = false, className }: { signature?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo className="size-9" />
      <span className="flex flex-col leading-none">
        <Wordmark className="text-[19px]" />
        {signature ? <Signature className="mt-1.5 text-[9px] tracking-[0.26em]" /> : null}
      </span>
    </span>
  );
}

/** Taha Aghajani monogram: T and A share one line; the gold node is the intelligence. */
export function Monogram({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} aria-hidden>
      <rect width="48" height="48" rx="13" fill="#0b1222" />
      <path d="M9.5 14.5 H 30.5 L 22 35 M 30.5 14.5 L 39 35 M 18 14.5 V 35" fill="none" stroke="#eef1f8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="30.5" cy="28" r="2.5" fill="#d4af5a" />
    </svg>
  );
}
