"use client";

import { useEffect, useState } from "react";

/** Site-level motion switch (WCAG 2.3.3) stored per visitor. The label is fixed so that it matches aria-pressed. */
export function MotionToggle({ reduceLabel }: { reduceLabel: string; /** no longer shown */ fullLabel?: string }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(document.documentElement.dataset.motion === "reduced"), []);
  return (
    <button
      type="button"
      aria-pressed={reduced}
      onClick={() => {
        const next = !reduced;
        setReduced(next);
        const d = document.documentElement;
        if (next) d.dataset.motion = "reduced";
        else delete d.dataset.motion;
        try {
          localStorage.setItem("pars-motion", next ? "reduced" : "full");
        } catch {}
      }}
      className="inline-flex items-center gap-2 text-sm text-muted transition hover:text-fg"
    >
      <span className={`relative h-5 w-9 rounded-full transition ${reduced ? "bg-magenta" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${reduced ? "start-[18px]" : "start-0.5"}`} />
      </span>
      {reduceLabel}
    </button>
  );
}
