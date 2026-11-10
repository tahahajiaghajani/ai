// Named colours of choice options and states (`COLOR_KEYS`, never hex in data) → design-system tokens. A tag draws a
// tinted fill (the hue at 14 % on the surface), a 6 px dot in the hue and ink text, so every colour also reads in
// words (WCAG: colour is never the only signal) and keeps its contrast in both themes.
import type { ColorKey, StateCategory } from "@shared/model/types";
import { STATE_CATEGORIES } from "@shared/model/types";

/** The token each named colour maps to (records.css reads the same mapping through `data-c`): the --ds-hue-* tokens,
 * which keep their hue whatever the chart order (tokens.css §4/§5). */
export const COLOR_TOKENS: Record<ColorKey, string> = {
  gray: "var(--ds-hue-gray)",
  red: "var(--ds-hue-red)",
  orange: "var(--ds-hue-orange)",
  gold: "var(--ds-hue-gold)",
  green: "var(--ds-hue-green)",
  teal: "var(--ds-hue-teal)",
  blue: "var(--ds-hue-blue)",
  indigo: "var(--ds-hue-indigo)",
  purple: "var(--ds-hue-purple)",
  magenta: "var(--ds-hue-magenta)",
};

export const COLOR_LABELS: Record<ColorKey, string> = {
  gray: "خاکستری",
  red: "قرمز",
  orange: "نارنجی",
  gold: "طلایی",
  green: "سبز",
  teal: "فیروزه‌ای",
  blue: "آبی",
  indigo: "نیلی",
  purple: "بنفش",
  magenta: "ارغوانی",
};

/** The colour of a state: its own, else its category's. */
export function stateColor(color: ColorKey | undefined, category: StateCategory | undefined): ColorKey {
  return color ?? (category ? STATE_CATEGORIES[category].color : "gray");
}

/** SLA tone by the share of the target already used (0–1+): calm, warning from 75 %, danger once breached. */
export function slaTone(used: number, breached: boolean): "in" | "warning" | "danger" | "neutral" {
  if (breached || used >= 1) return "danger";
  if (used >= 0.75) return "warning";
  if (used >= 0) return "in";
  return "neutral";
}
