"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
      className="rounded-full border border-line px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted transition-colors hover:border-fg hover:text-fg"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}
