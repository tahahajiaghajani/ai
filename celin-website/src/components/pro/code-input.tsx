"use client";

import { useState } from "react";
import { enterCode } from "@/app/actions/account";
import { commonCopy } from "@/content/copy/common";
import { latinDigits, type Lang } from "@/lib/format";
import { sessionChanged } from "@/components/pro/session";

/** Groups typed digits as 4827 1930 5561 (Latin digits in an LTR field; Persian/Arabic digits are accepted). */
function group(raw: string): string {
  const d = latinDigits(raw).replace(/\D/g, "").slice(0, 12);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/**
 * The single most important field of the site: one input, numeric keyboard, paste-friendly (a whole SMS
 * text works), submits by itself at 12 digits. On success the session reloads and prices fade in place.
 */
export function CodeInput({ lang, next, onDone, autoFocus }: { lang: Lang; next?: string; onDone?: (r: { signedIn: boolean; next: string }) => void; autoFocus?: boolean }) {
  const c = commonCopy(lang).proSheet;
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(code: string) {
    if (state === "pending" || state === "ok") return;
    setState("pending");
    setError("");
    try {
      const r = await enterCode({ code, lang, next });
      if (r.ok) {
        setState("ok");
        await sessionChanged();
        setTimeout(() => onDone?.({ signedIn: r.signedIn, next: r.next }), 900);
      } else {
        setState("error");
        setError(r.error);
      }
    } catch {
      setState("error");
      setError(commonCopy(lang).errors.network);
    }
  }

  const digits = value.replace(/\D/g, "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(value);
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="mb-2 block text-sm text-ink-2">{c.codeLabel}</span>
        <div className="relative">
          <input
            value={value}
            onChange={(e) => {
              const g = group(e.target.value);
              setValue(g);
              if (state === "error") setState("idle");
              if (g.replace(/\D/g, "").length === 12) void submit(g);
            }}
            onPaste={(e) => {
              const g = group(e.clipboardData.getData("text"));
              if (g.replace(/\D/g, "").length === 12) {
                e.preventDefault();
                setValue(g);
                void submit(g);
              }
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            dir="ltr"
            maxLength={40}
            autoFocus={autoFocus}
            placeholder="0000 0000 0000"
            aria-invalid={state === "error"}
            aria-describedby="pro-code-help"
            className={`h-14 w-full border bg-white px-4 text-center font-label text-xl tracking-[0.14em] tabular-nums outline-none transition-colors placeholder:text-faint/70 ${state === "ok" ? "border-gold" : state === "error" ? "border-danger" : "border-control focus:border-gold"}`}
          />
          {state === "ok" && (
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute inset-y-0 end-4 my-auto size-5 text-gold" aria-hidden>
              <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="1.6" pathLength={1} className="[stroke-dasharray:1] [animation:draw_.3s_var(--ease-lux)_both]" />
            </svg>
          )}
        </div>
        <span id="pro-code-help" className="mt-2 block text-xs text-muted">
          {c.codeHelp}
        </span>
      </label>
      <div aria-live="polite" className="min-h-6 text-sm">
        {state === "error" && <p className="text-danger">{error}</p>}
        {state === "ok" && <p className="text-gold-text">{c.success}</p>}
      </div>
      <button
        type="submit"
        disabled={state === "pending" || state === "ok" || digits.length < 12}
        className="btn btn-metal w-full disabled:cursor-not-allowed disabled:opacity-45"
      >
        {state === "pending" ? "…" : c.submit}
      </button>
    </form>
  );
}
