"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/components/chat/chat-context";

/** The big "ask Pars" box — the first thing a visitor sees. */
export function HeroComposer({ placeholders, label, send, hint }: { placeholders: string[]; label: string; send: string; hint: string }) {
  const { ask, prefetch, suggestions } = useChat();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [ph, setPh] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focused || value) return;
    const id = window.setInterval(() => setPh((i) => (i + 1) % placeholders.length), 4200);
    return () => window.clearInterval(id);
  }, [focused, value, placeholders.length]);

  const submit = () => {
    if (!value.trim()) {
      ref.current?.focus();
      return;
    }
    ask(value);
    setValue("");
    if (ref.current) ref.current.style.height = "";
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="ring-border group relative flex items-end gap-2 rounded-[2rem] p-2 text-start shadow-[0_30px_90px_-30px_rgb(223_17_115/0.6),0_0_0_1px_rgb(255_255_255/0.02)] transition-shadow duration-500 focus-within:shadow-[0_30px_110px_-24px_rgb(223_17_115/0.8)]"
      >
        <span aria-hidden className="mb-3.5 ms-3 grid size-7 shrink-0 place-items-center rounded-full bg-reverse text-white">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M12 2l2.4 6.1L20.5 10l-6.1 2.4L12 18.5l-2.4-6.1L3.5 10l6.1-1.9z" />
          </svg>
        </span>
        <div className="relative flex-1">
          <textarea
            ref={ref}
            value={value}
            rows={1}
            dir="auto"
            maxLength={4000}
            aria-label={label}
            onFocus={() => {
              setFocused(true);
              prefetch();
            }}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setValue(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="block max-h-[180px] min-h-14 w-full resize-none bg-transparent px-2 py-4 text-base leading-7 text-fg outline-none focus-visible:outline-none sm:text-lg"
          />
          {!value && (
            <span key={ph} aria-hidden className="pointer-events-none absolute inset-x-2 top-4 truncate text-base leading-7 text-faint animate-[fade-in_.7s_both] sm:text-lg">
              {placeholders[ph]}
            </span>
          )}
        </div>
        <button
          type="submit"
          aria-label={send}
          className="grid size-14 shrink-0 place-items-center rounded-full bg-magenta text-white shadow-[0_10px_30px_-8px_rgb(223_17_115/0.9)] transition hover:scale-[1.04] hover:bg-magenta-deep active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="size-5.5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      <div className="mt-2 hidden justify-end px-6 text-[11px] text-faint sm:flex">{hint}</div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {suggestions.slice(0, 4).map((s) => (
          <button
            key={s}
            type="button"
            onPointerEnter={prefetch}
            onClick={() => ask(s)}
            className="rounded-full border border-line bg-ink-2/75 px-4 py-2 text-[13px] text-muted backdrop-blur-md transition hover:-translate-y-0.5 hover:border-pink/40 hover:text-fg sm:text-sm"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
