"use client";

import { useEffect, useState } from "react";

/** «کاهش حرکت»: a per-device switch (localStorage) on top of prefers-reduced-motion. */
export function MotionToggle({ labels }: { labels: { reduce: string; restore: string } }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(document.documentElement.dataset.motion === "reduced"), []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !reduced;
        setReduced(next);
        if (next) document.documentElement.dataset.motion = "reduced";
        else delete document.documentElement.dataset.motion;
        try {
          localStorage.setItem("celin-motion", next ? "reduced" : "full");
        } catch {
          // private mode
        }
      }}
      aria-pressed={reduced}
      className="text-on-night-muted underline-offset-4 hover:text-on-night hover:underline"
    >
      {reduced ? labels.restore : labels.reduce}
    </button>
  );
}
