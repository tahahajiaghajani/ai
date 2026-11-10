// The design system's token checker and palette generator (docs/DESIGN_SYSTEM.md §Colour).
//
//   npx tsx scripts/ds-tokens.ts            check: contrast of every token pair (WCAG 2.2 AA), the chart palettes
//                                           (lightness band, chroma, colour-blind separation), the ramps, the two
//                                           dark blocks and the brand mirror; prints a report, exits 1 on failure
//   npx tsx scripts/ds-tokens.ts --write    also regenerates src/ui/ds/ds-palette.ts (the hex palette antd reads)
//   npx tsx scripts/ds-tokens.ts --check    fails when ds-palette.ts is not what tokens.css generates
//
// tests/design-system.test.ts runs the same checks, so `npm test` keeps the tokens honest.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_COLORS } from "../src/shared/brand";
import { parseColor, over, contrast, toHex, oklch, deltaE, type RGBA } from "../src/shared/color";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TOKENS_FILE = join(ROOT, "src/ui/ds/tokens.css");
export const PALETTE_FILE = join(ROOT, "src/ui/ds/ds-palette.ts");

export type Mode = "light" | "dark";
export type Vars = Map<string, string>;

// ------------------------------------------------------------------ parsing
/** Top-level blocks of a stylesheet: [prelude, body] (comments removed). */
function blocks(css: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let start = 0;
  let head = "";
  let quote = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === quote && css[i - 1] !== "\\") quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") {
      if (depth === 0) {
        head = css.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push([head, css.slice(start, i)]);
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) start = i + 1;
  }
  return out;
}

/** `--name: value` declarations of a block body (values may hold parentheses, quotes and commas). */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const push = (end: number) => {
    const d = body.slice(start, end).trim();
    const m = /^(--[\w-]+)\s*:\s*([\s\S]*)$/.exec(d);
    if (m) out.push([m[1], m[2].trim()]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(body.length);
  return out;
}

export interface Tokens {
  light: Vars;
  dark: Vars;
  /** the dark declarations as written in each of the two dark blocks */
  darkMedia: [string, string][];
  darkAttr: [string, string][];
}

export function parseTokens(css = readFileSync(TOKENS_FILE, "utf8")): Tokens {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const light: Vars = new Map();
  let darkMedia: [string, string][] = [];
  let darkAttr: [string, string][] = [];
  for (const [head, body] of blocks(clean)) {
    if (head === ":root") for (const [k, v] of declarations(body)) light.set(k, v);
    else if (head === ':root[data-theme="dark"]') darkAttr = declarations(body);
    else if (/^@media\s*\(prefers-color-scheme:\s*dark\)$/.test(head)) {
      const inner = blocks(body).find(([h]) => h === ':root:not([data-theme="light"])');
      if (inner) darkMedia = declarations(inner[1]);
    }
  }
  const dark: Vars = new Map(light);
  for (const [k, v] of darkAttr) dark.set(k, v);
  return { light, dark, darkMedia, darkAttr };
}

/** A token's value with every var() resolved against the theme. */
export function resolveVar(vars: Vars, name: string, seen: string[] = []): string {
  const raw = vars.get(name);
  if (raw === undefined) throw new Error(`undefined token ${name}`);
  if (seen.includes(name)) throw new Error(`cycle: ${[...seen, name].join(" → ")}`);
  return substitute(vars, raw, [...seen, name]);
}
function substitute(vars: Vars, value: string, seen: string[]): string {
  let out = value;
  for (let guard = 0; guard < 20 && out.includes("var("); guard++) {
    out = out.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (_m, n: string, fb?: string) => (vars.has(n) ? resolveVar(vars, n, seen) : (fb ?? "")));
  }
  return out;
}

// ------------------------------------------------------------------ colour maths (src/shared/color.ts)
export { parseColor, over, contrast, toHex, oklch, deltaE } from "../src/shared/color";
export type { RGBA } from "../src/shared/color";

// ------------------------------------------------------------------ the checks
export interface Finding {
  mode: Mode;
  check: string;
  detail: string;
  ok: boolean;
}

const SURFACES = ["--ds-canvas", "--ds-surface", "--ds-raised", "--ds-sunken", "--ds-well"];
const CARDS = ["--ds-surface", "--ds-raised"];
/** text tokens that must read on every surface of their theme */
const TEXTS = ["--ds-text", "--ds-text-2", "--ds-text-3"];
/** coloured text roles: on the surfaces they appear on */
const ROLE_TEXTS = ["--ds-accent-text", "--ds-in", "--ds-danger", "--ds-warning", "--ds-info", "--ds-sea-text", "--ds-ai-text", "--ds-holiday"];
/** [text, its tint] */
const ON_TINT: [string, string][] = [
  ["--ds-accent-text", "--ds-accent-tint"],
  ["--ds-accent-text", "--ds-accent-tint-2"],
  ["--ds-in", "--ds-in-tint"],
  ["--ds-danger", "--ds-danger-tint"],
  ["--ds-warning", "--ds-warning-tint"],
  ["--ds-info", "--ds-info-tint"],
  ["--ds-sea-text", "--ds-sea-tint"],
  ["--ds-ai-text", "--ds-ai-tint"],
  ["--ds-text-2", "--ds-neutral-tint"],
  ...["new", "progress", "hold", "resolved", "closed", "cancelled"].map((s) => [`--ds-state-${s}-text`, `--ds-state-${s}-tint`] as [string, string]),
  ...[1, 2, 3, 4, 5].map((n) => [`--ds-p${n}-text`, `--ds-p${n}-tint`] as [string, string]),
  ...["ok", "risk", "breach", "paused", "met"].map((s) => [`--ds-sla-${s}-text`, `--ds-sla-${s}-tint`] as [string, string]),
];
const HUES = ["gray", "red", "orange", "gold", "green", "teal", "blue", "indigo", "purple", "magenta"].map((h) => `--ds-hue-${h}`);
/** graphics that identify state or position (1.4.11): ≥ 3:1 on the surfaces they sit on */
const GRAPHICS = [
  "--ds-focus-color",
  "--ds-control-strong",
  "--ds-accent-bar",
  "--ds-accent-line",
  "--ds-info-fill",
  "--ds-brand-arch",
  ...["new", "progress", "hold", "resolved", "closed", "cancelled"].map((s) => `--ds-state-${s}`),
  ...[1, 2, 3, 4, 5].map((n) => `--ds-p${n}`),
  ...["ok", "risk", "breach", "paused", "met"].map((s) => `--ds-sla-${s}`),
];
export const CHART_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--ds-chart-${n}`);

export function checkTokens(t: Tokens = parseTokens()): Finding[] {
  const findings: Finding[] = [];
  const push = (mode: Mode, check: string, ok: boolean, detail: string) => findings.push({ mode, check, ok, detail });

  // the two dark blocks must be the same declarations
  const a = JSON.stringify(t.darkMedia);
  const b = JSON.stringify(t.darkAttr);
  push("dark", "dark blocks identical", a === b && t.darkAttr.length > 0, a === b ? `${t.darkAttr.length} declarations` : "the @media and [data-theme=dark] blocks differ");

  // brand.ts mirrors §2
  for (const scale of ["firuzeh", "lajvard", "zaferan"] as const) {
    for (const [step, hex] of Object.entries(BRAND_COLORS[scale])) {
      const tok = t.light.get(`--ds-${scale}-${step}`);
      push("light", "brand mirror", tok?.toUpperCase() === hex.toUpperCase(), `--ds-${scale}-${step} ${tok} vs brand.ts ${hex}`);
    }
  }

  for (const mode of ["light", "dark"] as Mode[]) {
    const vars = t[mode];
    const col = (name: string): RGBA => {
      const v = resolveVar(vars, name);
      const c = parseColor(v);
      if (!c) throw new Error(`${mode}: ${name} is not a colour: ${v}`);
      return c;
    };
    const solid = (name: string, bg = "--ds-surface"): RGBA => {
      const c = col(name);
      return c[3] < 1 ? over(c, col(bg)) : c;
    };
    const selectedRow = over(col("--ds-selected"), col("--ds-surface"));
    const pair = (check: string, fgName: string, fg: RGBA, bgName: string, bg: RGBA, min: number) => {
      const r = contrast(fg[3] < 1 ? over(fg, bg) : fg, bg);
      push(mode, check, r >= min, `${fgName} on ${bgName}: ${r.toFixed(2)}:1 (≥ ${min})`);
    };

    for (const f of TEXTS) for (const s of SURFACES) pair("text on surfaces", f, col(f), s, col(s), 4.5);
    for (const f of TEXTS) pair("text on the selected row", f, col(f), "selected row", selectedRow, 4.5);
    for (const f of ROLE_TEXTS) for (const s of SURFACES) pair("coloured text on surfaces", f, col(f), s, col(s), 4.5);
    pair("coloured text on the selected row", "--ds-accent-text", col("--ds-accent-text"), "selected row", selectedRow, 4.5);
    for (const [f, bgn] of ON_TINT) pair("text on its tint", f, col(f), bgn, solid(bgn), 4.5);
    for (const h of HUES) for (const s of CARDS) pair("named hue as text", h, col(h), s, col(s), 4.5);
    for (const h of HUES) pair("text on a filled hue", "--ds-on-hue", col("--ds-on-hue"), h, col(h), mode === "light" ? 4.5 : 4.5);
    pair("primary button", "--ds-on-accent", col("--ds-on-accent"), "--ds-accent", col("--ds-accent"), 4.5);
    pair("primary button (hover)", "--ds-on-accent", col("--ds-on-accent"), "--ds-accent-hover", col("--ds-accent-hover"), 4.5);
    if (mode === "light") pair("destructive button", "--ds-on-danger", col("--ds-on-danger"), "--ds-danger-solid", col("--ds-danger-solid"), 4.5);
    else pair("destructive button", "--ds-on-danger", col("--ds-on-danger"), "--ds-danger", col("--ds-danger"), 4.5);
    pair("tooltip", "--ds-tooltip-text", col("--ds-tooltip-text"), "--ds-tooltip-bg", col("--ds-tooltip-bg"), 4.5);
    pair("selection", "--ds-text", col("--ds-text"), "--ds-selection", col("--ds-selection"), 4.5);
    // white text on the brand night (its lightest stop), primary and secondary
    for (const f of ["--ds-on-brand", "--ds-on-brand-2", "--ds-on-brand-3"]) pair("text on the brand night", f, col(f), "#123A62", parseColor("#123A62")!, 4.5);

    for (const g of GRAPHICS) for (const s of ["--ds-canvas", "--ds-surface", "--ds-raised"]) pair("graphics ≥ 3:1", g, col(g), s, col(s), 3);
    pair("graphics ≥ 3:1", "--ds-accent-bar", col("--ds-accent-bar"), "selected row", selectedRow, 3);
    pair("graphics ≥ 3:1", "--ds-focus-color", col("--ds-focus-color"), "--ds-sunken", col("--ds-sunken"), 3);

    // categorical chart palette (dataviz method): band, chroma, adjacent CVD ΔE ≥ 8, normal ΔE ≥ 15, ≥ 3:1 on cards
    const chart = CHART_SLOTS.map(col);
    const band = mode === "light" ? [0.43, 0.77] : [0.48, 0.67];
    chart.forEach((c, i) => {
      const [L, C] = oklch(c);
      push(mode, "chart lightness band", L >= band[0] && L <= band[1], `${CHART_SLOTS[i]} L ${L.toFixed(3)} in ${band.join("–")}`);
      push(mode, "chart chroma ≥ 0.10", C >= 0.1, `${CHART_SLOTS[i]} C ${C.toFixed(3)}`);
      for (const s of CARDS) pair("chart ≥ 3:1", CHART_SLOTS[i], c, s, col(s), 3);
    });
    for (let i = 0; i < chart.length - 1; i++) {
      const cvd = Math.min(deltaE(chart[i], chart[i + 1], "protan"), deltaE(chart[i], chart[i + 1], "deutan"));
      const nor = deltaE(chart[i], chart[i + 1]);
      push(mode, "chart CVD ΔE ≥ 8 (adjacent)", cvd >= 8, `${CHART_SLOTS[i]}↔${CHART_SLOTS[i + 1]} ${cvd.toFixed(1)}`);
      push(mode, "chart normal ΔE ≥ 15 (adjacent)", nor >= 15, `${CHART_SLOTS[i]}↔${CHART_SLOTS[i + 1]} ${nor.toFixed(1)}`);
    }

    // sequential: one hue, monotone lightness (light → dark on paper, dark → light on charcoal), steps ≥ .06
    const seq = Array.from({ length: 9 }, (_, i) => oklch(col(`--ds-seq-${i + 1}`)));
    const dir = mode === "light" ? -1 : 1;
    for (let i = 0; i < 8; i++) {
      const dL = (seq[i + 1][0] - seq[i][0]) * dir;
      push(mode, "sequential ramp", dL >= 0.06, `--ds-seq-${i + 1}→${i + 2} ΔL ${(dL).toFixed(3)} (≥ .06, ${mode === "light" ? "darker" : "lighter"})`);
    }
    const hues = seq.map((x) => x[2]);
    push(mode, "sequential ramp", Math.max(...hues) - Math.min(...hues) <= 8, `hue spread ${(Math.max(...hues) - Math.min(...hues)).toFixed(1)}° (≤ 8)`);
    // diverging: a gray midpoint, each arm monotone toward it
    const div = Array.from({ length: 9 }, (_, i) => oklch(col(`--ds-div-${i + 1}`)));
    push(mode, "diverging ramp", div[4][1] < 0.02, `--ds-div-5 chroma ${div[4][1].toFixed(3)} (gray midpoint)`);
    const toMid = mode === "light" ? 1 : -1; // light: lightness rises toward the middle; dark: falls toward it
    for (let i = 0; i < 4; i++) {
      push(mode, "diverging ramp", (div[i + 1][0] - div[i][0]) * toMid > 0, `--ds-div-${i + 1}→${i + 2} toward the middle`);
      push(mode, "diverging ramp", (div[7 - i][0] - div[8 - i][0]) * toMid > 0, `--ds-div-${9 - i}→${8 - i} toward the middle`);
    }
  }
  return findings;
}

// ------------------------------------------------------------------ ds-palette.ts
const KEYS: [string, string][] = [
  ["canvas", "--ds-canvas"], ["surface", "--ds-surface"], ["raised", "--ds-raised"], ["sunken", "--ds-sunken"], ["well", "--ds-well"],
  ["text", "--ds-text"], ["text2", "--ds-text-2"], ["text3", "--ds-text-3"], ["text4", "--ds-text-4"],
  ["line", "--ds-line"], ["line2", "--ds-line-2"], ["line3", "--ds-line-3"], ["controlStrong", "--ds-control-strong"],
  ["hover", "--ds-hover"], ["selected", "--ds-selected"], ["pressed", "--ds-pressed"],
  ["accent", "--ds-accent"], ["accentHover", "--ds-accent-hover"], ["accentText", "--ds-accent-text"], ["accentLine", "--ds-accent-line"],
  ["accentTint", "--ds-accent-tint"], ["accentTint2", "--ds-accent-tint-2"], ["accentBorder", "--ds-accent-border"], ["accentBar", "--ds-accent-bar"],
  ["focus", "--ds-focus-color"],
  ["in", "--ds-in"], ["inTint", "--ds-in-tint"], ["inBorder", "--ds-in-border"],
  ["danger", "--ds-danger"], ["dangerTint", "--ds-danger-tint"], ["dangerBorder", "--ds-danger-border"], ["dangerSolid", "--ds-danger-solid"], ["dangerSolidHover", "--ds-danger-solid-hover"],
  ["warning", "--ds-warning"], ["warningTint", "--ds-warning-tint"], ["warningBorder", "--ds-warning-border"], ["warningFill", "--ds-warning-fill"],
  ["info", "--ds-info"], ["infoTint", "--ds-info-tint"], ["infoBorder", "--ds-info-border"], ["infoFill", "--ds-info-fill"],
  ["ai", "--ds-ai"], ["aiText", "--ds-ai-text"], ["aiTint", "--ds-ai-tint"],
  ["neutralTint", "--ds-neutral-tint"], ["holiday", "--ds-holiday"], ["segmentOn", "--ds-segment-on"],
  ["tooltip", "--ds-tooltip-bg"], ["tooltipText", "--ds-tooltip-text"], ["scrim", "--ds-scrim"],
  ["e1", "--ds-shadow-e1"], ["e2", "--ds-shadow-e2"], ["e3", "--ds-shadow-e3"], ["e4", "--ds-shadow-e4"],
  ["segmentShadow", "--ds-shadow-segment"], ["buttonShadow", "--ds-shadow-button"],
  ["glass", "--ds-glass-tint"], ["glassFloat", "--ds-glass-float-tint"], ["glassBlur", "--ds-glass-blur"],
  ["dangerActive", "--ds-danger-active"], ["dangerHoverText", "--ds-danger-hover-text"], ["onDanger", "--ds-on-danger"],
  ["brandArch", "--ds-brand-arch"], ["brandNuqta", "--ds-brand-nuqta"], ["chartOther", "--ds-chart-other"],
];

const fmt = (c: RGBA) => (c[3] < 1 ? `rgba(${c[0]},${c[1]},${c[2]},${+c[3].toFixed(3)})` : toHex(c));

/** The palette object antd reads: plain hex/rgba values plus the opaque composites antd's tables need. */
export function buildPalette(t: Tokens = parseTokens()): Record<Mode, Record<string, string | string[]>> {
  const out = {} as Record<Mode, Record<string, string | string[]>>;
  for (const mode of ["light", "dark"] as Mode[]) {
    const vars = t[mode];
    const raw = (n: string) => resolveVar(vars, n);
    const col = (n: string) => parseColor(raw(n))!;
    const p: Record<string, string | string[]> = {};
    for (const [k, n] of KEYS) {
      const c = parseColor(raw(n));
      p[k] = c ? fmt(c) : raw(n);
    }
    // opaque composites (antd's row and menu fills must hide what is under a sticky header)
    p.hoverRowSolid = toHex(over(col("--ds-hover-row"), col("--ds-surface")));
    p.hoverSolid = toHex(over(col("--ds-hover"), col("--ds-raised")));
    p.selectedSolid = toHex(over(col("--ds-selected"), col("--ds-raised")));
    p.pressedSolid = toHex(over(col("--ds-pressed"), col("--ds-raised")));
    p.selectedRowSolid = toHex(over(col("--ds-selected"), col("--ds-surface")));
    const line = col("--ds-accent-line");
    p.focusSoft = `rgba(${line[0]},${line[1]},${line[2]},0.16)`;
    p.chart = CHART_SLOTS.map((n) => fmt(col(n)));
    p.seq = Array.from({ length: 9 }, (_, i) => fmt(col(`--ds-seq-${i + 1}`)));
    p.div = Array.from({ length: 9 }, (_, i) => fmt(col(`--ds-div-${i + 1}`)));
    out[mode] = p;
  }
  return out;
}

export function paletteSource(t: Tokens = parseTokens()): string {
  return `// GENERATED from tokens.css by scripts/ds-tokens.ts — do not edit by hand; edit tokens.css and run
// \`npx tsx scripts/ds-tokens.ts --write\` (tests/design-system.test.ts fails while they differ).
// Hex/rgba only: Ant Design's algorithm and its CSS-in-JS read these as plain colours.
export const DS_PALETTE = ${JSON.stringify(buildPalette(t), null, 2)} as const;

export type DsMode = keyof typeof DS_PALETTE;
export type DsPalette = (typeof DS_PALETTE)[DsMode];
`;
}

// ------------------------------------------------------------------ CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const t = parseTokens();
  const findings = checkTokens(t);
  const failed = findings.filter((f) => !f.ok);
  const byCheck = new Map<string, { ok: number; bad: Finding[] }>();
  for (const f of findings) {
    const k = `${f.mode.padEnd(5)} ${f.check}`;
    const e = byCheck.get(k) ?? { ok: 0, bad: [] };
    if (f.ok) e.ok++;
    else e.bad.push(f);
    byCheck.set(k, e);
  }
  for (const [k, e] of byCheck) console.log(`${e.bad.length ? "FAIL" : "pass"}  ${k}  (${e.ok}/${e.ok + e.bad.length})${e.bad.map((f) => `\n        ✗ ${f.detail}`).join("")}`);
  const src = paletteSource(t);
  if (process.argv.includes("--write")) {
    writeFileSync(PALETTE_FILE, src);
    console.log(`wrote ${PALETTE_FILE.slice(ROOT.length + 1)}`);
  } else if (process.argv.includes("--check") && readFileSync(PALETTE_FILE, "utf8") !== src) {
    console.log("FAIL  src/ui/ds/ds-palette.ts is out of date: npx tsx scripts/ds-tokens.ts --write");
    process.exit(1);
  }
  console.log(failed.length ? `\n${failed.length} of ${findings.length} checks failed` : `\nall ${findings.length} checks pass`);
  process.exit(failed.length ? 1 : 0);
}
