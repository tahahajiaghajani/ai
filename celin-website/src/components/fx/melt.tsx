/**
 * The seam between a light band and a dark one: the two grounds melt into each other instead of meeting at a
 * hard edge (docs/DESIGN_SYSTEM.md). An empty span; the band that holds it must be `relative isolate`.
 *
 * - in a LIGHT band (default): `at="top"` — the dark band above (its foot plain night-2, or plain night-teal for
 *   `tone="teal"`) melts into this band's light; `at="bottom"` — this band's light melts into the dark band below
 *   (whose top row must be plain night-2 / night-teal). Sits under the band's content (-z-10).
 * - in a DARK band (`on="dark"`): `at="bottom"` — the band's foot turns into the plain ground colour of the light
 *   band below (the services strip opens on that ground); `at="top"` — the reverse. Place it after the band's
 *   Aura / Grain, before its content, and keep the content clear of it (bottom padding ≥ --melt-h).
 *
 * Height: --melt-h (globals.css).
 */
export function Melt({ at, tone = "night", on = "light", className = "" }: { at: "top" | "bottom"; tone?: "night" | "teal"; on?: "light" | "dark"; className?: string }) {
  let look: string;
  // upside-down strips flip the gradient's direction, never rotate(): a transformed strip leaves a hairline seam
  if (on === "dark") look = `bg-dusk [--dusk-light:var(--color-ground)] [--dusk-dark:transparent] ${at === "bottom" ? "[--dusk-dir:0deg]" : ""}`;
  else if (tone === "teal") look = `bg-tide ${at === "bottom" ? "[--tide-dir:0deg]" : ""}`;
  else look = `bg-dusk ${at === "top" ? "[--dusk-dir:0deg]" : ""}`;
  return <span aria-hidden className={`pointer-events-none absolute inset-x-0 h-[var(--melt-h)] ${at === "top" ? "top-0" : "bottom-0"} ${on === "dark" ? "" : "-z-10"} ${look} ${className}`} />;
}

/** The plain night at the foot of a dark band with this Aura palette, so the next light band's <Melt at="top"/> matches it. */
export const seamTone = (palette: "espresso" | "paraiba" | "cocoa" | "porcelain"): "night" | "teal" => (palette === "paraiba" ? "teal" : "night");

/**
 * The foot of a dark band (hero) settling into the plain night where the next light band's melt begins: night-2,
 * or night-teal for the paraiba light. Place it after the band's Aura / Grain, before its content.
 */
export function NightFoot({ tone = "night", className = "" }: { tone?: "night" | "teal"; className?: string }) {
  return <span aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-[clamp(8rem,22vh,14rem)] bg-gradient-to-b from-transparent ${tone === "teal" ? "to-night-teal" : "to-night-2"} ${className}`} />;
}

/** The head of a dark band opening on the plain night (night-2 / night-teal) where the light band above melted into it. */
export function NightHead({ tone = "night", className = "" }: { tone?: "night" | "teal"; className?: string }) {
  return <span aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-[clamp(8rem,22vh,14rem)] bg-gradient-to-t from-transparent ${tone === "teal" ? "to-night-teal" : "to-night-2"} ${className}`} />;
}
