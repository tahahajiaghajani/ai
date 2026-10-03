"use client";
import * as React from "react";
import { INTRO_KEY } from "./boot-script";

const FLOW_PATH = "M -40 118 C 90 118, 120 46, 230 58 S 380 128, 500 92 S 600 40, 680 64";

/**
 * Opening titles: a flow line sweeps across the screen and, as its light passes, writes
 * «task flow»; then the signature appears. Once per browser session, skipped with a tap,
 * shortened for reduced motion. Rendered on the server so nothing flashes before it; an
 * inline script in <head> hides it at once when it was already shown this session.
 */
export function BrandIntro() {
  const [state, setState] = React.useState<"playing" | "leaving" | "gone">("playing");

  const leave = React.useCallback(() => {
    setState((s) => (s === "playing" ? "leaving" : s));
    window.setTimeout(() => setState("gone"), 520);
  }, []);

  React.useEffect(() => {
    if (document.documentElement.dataset.intro === "done") {
      setState("gone");
      return;
    }
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode: plays once per page load */
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(leave, reduced ? 1100 : 2900);
    return () => window.clearTimeout(t);
  }, [leave]);

  if (state === "gone") return null;
  const letters = (word: string, offset: number) =>
    word.split("").map((ch, i) => (
      <span key={`${word}-${i}`} className="brand-intro__ch" style={{ "--i": offset + i } as React.CSSProperties}>
        {ch}
      </span>
    ));

  return (
    <div className={`brand-intro${state === "leaving" ? " is-leaving" : ""}`} onClick={leave} aria-hidden>
      <div className="brand-intro__stage" dir="ltr">
        <svg className="brand-intro__line" viewBox="0 0 640 160" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="tf-intro-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--brand)" stopOpacity="0" />
              <stop offset="0.25" stopColor="var(--brand)" />
              <stop offset="1" stopColor="var(--flow)" />
            </linearGradient>
          </defs>
          <path className="brand-intro__path" d={FLOW_PATH} pathLength={1} />
          {/* the light that travels the flow (SVG motion scales with the drawing on every screen) */}
          <circle className="brand-intro__spark" r="5" opacity="0">
            <animateMotion dur="1.15s" begin="0.15s" fill="freeze" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.65 0 0.35 1" path={FLOW_PATH} />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.85;1" dur="1.15s" begin="0.15s" fill="freeze" />
          </circle>
        </svg>
        <p className="brand-intro__word">
          <span>{letters("task", 0)}</span>
          <span className="brand-intro__flow">{letters("flow", 5)}</span>
        </p>
        <p className="brand-intro__sig">By Taha Aghajani</p>
      </div>
    </div>
  );
}
