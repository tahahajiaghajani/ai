// Motion helpers (components.md §13). Durations and easings are CSS tokens (tokens.css §3); read them from
// CSS so prefers-reduced-motion and data-motion="reduced" (tokens.css §6) apply everywhere. The CSS side is
// src/ui/ds/motion.css: .ds-enter, .ds-fade, .ds-pop, .ds-stagger, .ds-press, .ds-launch.
import { useEffect, useRef, useState, type CSSProperties } from "react";

/** True when the OS asks for reduced motion or the app sets <html data-motion="reduced"> (or data-power="low"). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  const root = document.documentElement;
  if (root.dataset.motion === "reduced" || root.dataset.power === "low") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Live version of prefersReducedMotion(). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(prefersReducedMotion());
    m.addEventListener("change", update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion", "data-power"] });
    return () => {
      m.removeEventListener("change", update);
      obs.disconnect();
    };
  }, []);
  return reduced;
}

/** A duration token in ms, e.g. cssDuration("--ds-dur-sheet") → 240 (150 under reduced motion). */
export function cssDuration(token: `--ds-dur-${string}`, fallback = 200): number {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
}

/** Inline style for the n-th item of a hand-built stagger with .ds-enter (at most 6 are staggered, 30 ms apart). */
export const stagger = (i: number): CSSProperties => ({ ["--ds-i" as string]: Math.min(Math.max(i, 0), 5) });

// the default entering curve, cubic-bezier(.23, 1, .32, 1), approximated for JS-driven values
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Counts from the previous value to `target` over `duration` ms with the ease-out curve and returns the current value.
 * Under reduced motion (and on the first render when `fromZero` is false) it returns the target at once.
 *
 * Only for counts, percentages and scores (rows imported, documents waiting, a progress figure).
 * NEVER for money, weights or rates: «never count up through intermediate amounts» (components.md §3.1) — those use
 * the rolling digits of the hero figure, which only ever show the final digits. Tables never animate numbers.
 */
export function useCountUp(target: number, { duration = 500, fromZero = true, decimals = 0 }: { duration?: number; fromZero?: boolean; decimals?: number } = {}): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(() => (fromZero && !reduced ? 0 : target));
  const from = useRef(value);
  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const f = 10 ** decimals;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = t >= 1 ? target : Math.round((a + (target - a) * easeOut(t)) * f) / f;
      from.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, decimals, reduced]);
  return value;
}
