/**
 * The seam between a light band and a dark one: the two grounds melt into each other instead of meeting at a
 * hard edge (docs/DESIGN_SYSTEM.md). An empty span; the band that holds it must be `relative isolate`.
 *
 * - in a LIGHT band (default): `at="top"` — the dark band above (its foot plain night-2, or plain night-teal for
 *   `tone="teal"`) melts into this band's light; `at="bottom"` — this band's light melts into the dark band below
 *   (whose top row must be plain night-2 / night-teal). Sits under the band's content (-z-10).
 * - in a DARK band (`on="dark"`): `at="bottom"` — the band's foot turns into the plain ground colour of the light
 *   band below, or into bone when the band ends the page (the services strip then opens on bone; the page-ending
 *   rule in globals.css); `at="top"` — the reverse. Place it after the band's Aura / Grain, before its content, and
 *   keep the content clear of it (bottom padding ≥ --melt-h).
 *
 * Height: --melt-h (globals.css).
 */
export function Melt({ at, tone = "night", on = "light", className = "" }: { at: "top" | "bottom"; tone?: "night" | "teal"; on?: "light" | "dark"; className?: string }) {
  let look: string;
  // the light end (--dusk-light: ground, or bone at the page's end) is set by [data-melt="dark"] in globals.css;
  // upside-down strips flip the gradient's direction, never rotate(): a transformed strip leaves a hairline seam
  if (on === "dark") look = `bg-dusk [--dusk-dark:transparent] ${at === "bottom" ? "[--dusk-dir:0deg]" : ""}`;
  else if (tone === "teal") look = `bg-tide ${at === "bottom" ? "[--tide-dir:0deg]" : ""}`;
  else look = `bg-dusk ${at === "top" ? "[--dusk-dir:0deg]" : ""}`;
  return <span aria-hidden data-melt={on === "dark" ? "dark" : undefined} className={`pointer-events-none absolute inset-x-0 h-[var(--melt-h)] ${at === "top" ? "top-0" : "bottom-0"} ${on === "dark" ? "" : "-z-10"} ${look} ${className}`} />;
}

/**
 * The seam between two LIGHT bands (porcelain and bone): each band settles into the plain ground at the shared edge
 * — its mesh lights fade out, a bone band fades into the ground — so the two meet on one flat colour instead of a
 * straight edge. Put one in each of the two bands (`at="bottom"` in the upper one, `at="top"` in the lower one).
 * An empty span under the band's content (-z-10); the band must be `relative isolate`. A page's last band needs
 * none: the page-ending rule in globals.css settles it into the services strip.
 */
export function Settle({ at, className = "" }: { at: "top" | "bottom"; className?: string }) {
  return <span aria-hidden className={`pointer-events-none absolute inset-x-0 -z-10 h-[var(--melt-h)] from-transparent to-ground ${at === "top" ? "top-0 bg-gradient-to-t" : "bottom-0 bg-gradient-to-b"} ${className}`} />;
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
