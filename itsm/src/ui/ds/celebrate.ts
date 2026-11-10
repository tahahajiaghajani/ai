// A milestone, marked once (docs/DESIGN_SYSTEM.md §Motion): a major incident resolved, a change closed without
// incident, an SLA review all green. A handful of the brand's nuqtas — turquoise, saffron, lapis — rise from the
// element and fade, with a soft ring; about 0.9 s, never looped, never blocking input, never for routine saves.
// Under reduced motion (OS setting, data-motion="reduced" or the low-power switch) only a quiet ring fades in and out
// in place. Always pair it with words (a toast or the page itself): the celebration is decoration.
import { cssDuration, prefersReducedMotion } from "../lib/motion";

const COLORS = ["var(--ds-brand-arch)", "var(--ds-brand-nuqta)", "var(--ds-info-fill)", "var(--ds-accent-line)"];
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

export interface CelebrateOptions {
  /** how many nuqtas rise (default 12, at most 24) */
  count?: number;
  /** how far they travel, px (default 84) */
  spread?: number;
}

/** Celebrate at `target` (its centre), or at the centre of the window. Returns when the animation has finished. */
export async function celebrate(target?: Element | null, { count = 12, spread = 84 }: CelebrateOptions = {}): Promise<void> {
  if (typeof document === "undefined" || typeof Element === "undefined" || !("animate" in Element.prototype)) return;
  const r = target?.getBoundingClientRect();
  const box = r ?? { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;

  const layer = document.createElement("div");
  layer.className = "ds-celebrate";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  const animations: Animation[] = [];

  const ring = document.createElement("i");
  ring.className = "ds-celebrate-ring";
  const size = Math.max(40, Math.min(160, Math.max(box.width, box.height) + 24));
  Object.assign(ring.style, { left: `${cx}px`, top: `${cy}px`, width: `${size}px`, height: `${size}px` });
  layer.appendChild(ring);

  if (prefersReducedMotion()) {
    animations.push(ring.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: 700, easing: "linear" }));
  } else {
    const duration = cssDuration("--ds-dur-celebrate", 900);
    animations.push(
      ring.animate(
        [
          { opacity: 0.55, transform: "translate(-50%, -50%) scale(.55)" },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.35)" },
        ],
        { duration: duration * 0.8, easing: EASE_OUT, fill: "both" },
      ),
    );
    const n = Math.max(1, Math.min(24, count));
    for (let i = 0; i < n; i++) {
      const q = document.createElement("i");
      q.className = "ds-celebrate-nq";
      const s = 5 + ((i * 7) % 5); // 5–9 px, deterministic variety
      q.style.width = `${s}px`;
      q.style.height = `${s}px`;
      q.style.left = `${cx}px`;
      q.style.top = `${cy}px`;
      q.style.background = COLORS[i % COLORS.length];
      layer.appendChild(q);
      // an upward fan (−90° ± 70°), the reading direction's side a little favoured
      const angle = ((-90 + (i / Math.max(1, n - 1) - 0.5) * 140 + (Math.random() - 0.5) * 16) * Math.PI) / 180;
      const dist = spread * (0.55 + Math.random() * 0.45);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const spin = (Math.random() - 0.5) * 120;
      animations.push(
        q.animate(
          [
            { opacity: 0, transform: "translate(-50%, -50%) rotate(45deg) scale(.4)" },
            { opacity: 1, offset: 0.18 },
            { opacity: 0, transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${(45 + spin).toFixed(0)}deg) scale(1)` },
          ],
          { duration: duration * (0.8 + Math.random() * 0.3), delay: (i % 4) * 25, easing: EASE_OUT, fill: "both" },
        ),
      );
    }
  }
  try {
    await Promise.all(animations.map((a) => a.finished));
  } catch {
    /* cancelled (the page left): nothing to clean but the layer */
  } finally {
    layer.remove();
  }
}
