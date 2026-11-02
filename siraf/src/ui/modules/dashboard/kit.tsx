// The dashboard's own parts (components.md §3, §7, §8, §10): cards, money on one scale per strip, delta chips,
// rolling digits, micro-visuals (bars, segmented bars, sparklines, the week of nuqtas), skeletons and empty states.
// Module widgets (modules/*/widgets.tsx) build on these so every card on «پیشخوان» reads as one system.
// Styles: ./dashboard.css (scoped under .db).
import "./dashboard.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { fa, pct, splitDecimals } from "../../lib/fa";
import { useCountUp, useReducedMotion } from "../../lib/motion";
import { useOrg } from "../../lib/org";

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ------------------------------------------------------------------ money scale (components.md §0.3)

export interface Scale {
  div: number;
  /** «میلیون ریال», or the bare unit («ریال») when amounts are shown exactly */
  unit: string;
  /** «میلیون», or "" */
  word: string;
}

const STEPS: [number, string][] = [
  [1, ""],
  [1e3, "هزار"],
  [1e6, "میلیون"],
  [1e9, "میلیارد"],
  [1e12, "هزار میلیارد"],
];

/** One scale for a strip: the smallest step that keeps the largest amount at six integer digits or fewer. */
export function pickScale(values: unknown[], unit: string, maxDigits = 6): Scale {
  const max = Math.max(0, ...values.map((v) => Math.abs(num(v))));
  const limit = 10 ** maxDigits;
  const [div, word] = STEPS.find(([d]) => max / d < limit) ?? STEPS[STEPS.length - 1];
  return { div, word, unit: word ? `${word} ${unit}` : unit };
}

export function useScale(values: unknown[], maxDigits = 6): Scale {
  const { unit } = useOrg();
  return pickScale(values, unit, maxDigits);
}

/** An amount on a scale: 0 decimals, or 1 when the scaled figure is under 10 (so ۰٫۳ never reads «۰»). */
export function scaled(v: unknown, s: Scale, dp?: number): string {
  const n = num(v) / s.div;
  const d = dp ?? (s.div > 1 && n !== 0 && Math.abs(n) < 10 ? 1 : 0);
  return fa(n, d);
}

/** A scaled amount; zero shows «—» in text-3 (components.md §0.3). */
export function Amt({ v, s, dp, className, zero = "—" }: { v: unknown; s: Scale; dp?: number; className?: string; zero?: string }) {
  if (num(v) === 0) return <span className={`db-zero ${className ?? ""}`}>{zero}</span>;
  return <span className={className}>{scaled(v, s, dp)}</span>;
}

// ------------------------------------------------------------------ cards

export function Card({
  title,
  caption,
  end,
  children,
  className,
  bodyClass,
  label,
  style,
}: {
  title?: ReactNode;
  caption?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`db-card ${className ?? ""}`} aria-label={label} style={style}>
      {title || end ? (
        <header className="db-card-h">
          {title ? <h2 className="db-card-t">{title}</h2> : null}
          {caption ? <span className="db-caption">{caption}</span> : null}
          {end ? <div className="db-card-x">{end}</div> : null}
        </header>
      ) : null}
      <div className={bodyClass ?? "db-card-b"}>{children}</div>
    </section>
  );
}

/**
 * A quiet header action: ink text, hover tint, never Dusk (links are ink, components.md §0.4). With `squeeze` (and an
 * icon) the words drop under 480 px and the icon stays, named by its aria-label and title.
 */
export function HeadLink({ children, onClick, icon, squeeze }: { children: ReactNode; onClick: () => void; icon?: LucideIcon; squeeze?: boolean }) {
  const name = squeeze && typeof children === "string" ? children : undefined;
  return (
    <button type="button" className={`db-hlink sf-press ${squeeze && icon ? "is-squeeze" : ""}`} onClick={onClick} aria-label={name} title={name}>
      {icon ? <Ic icon={icon} size={14} /> : null}
      <span className="db-hlink-t">{children}</span>
    </button>
  );
}

// ------------------------------------------------------------------ mixed-direction text that must fit one line

let canvas: HTMLCanvasElement | null = null;
const ELLIPSIS = "…";

/** The longest logical prefix of `text` (cut at a word when it can) that fits `width` px with «…». */
function fitText(text: string, width: number, font: string): string {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || width <= 0) return text;
  ctx.font = font;
  const w = (t: string) => ctx.measureText(t).width;
  // canvas ignores the font's ss01 and tabular features: keep a small margin
  const room = width - 6;
  if (w(text) <= room) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (w(text.slice(0, mid).trimEnd() + ELLIPSIS) <= room) lo = mid;
    else hi = mid - 1;
  }
  let cut = text.slice(0, lo);
  const space = cut.search(/\s\S*$/);
  // cut at the last word boundary unless that would throw away most of the line
  if (space > lo * 0.5) cut = cut.slice(0, space);
  // never end on a separator or a lone letter (an abbreviation such as «ش» reads as a broken word)
  for (let prev = ""; prev !== cut; ) {
    prev = cut;
    cut = cut.replace(/[\s،,:;—–-]+$/, "").replace(/(\S)\s+\S$/u, "$1");
  }
  return cut + ELLIPSIS;
}

/**
 * One line of text that may mix Persian and Latin runs. CSS ellipsis cuts bidi text in visual order, so a trailing
 * Latin run loses its start («…ading LLC»); this cuts in logical order at a word («Dubai…») and keeps the full text in
 * the title. The cell's width comes from its grid column, never from its content.
 */
export function ClipText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [fonts, setFonts] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    let live = true;
    document.fonts?.ready.then(() => live && setFonts((n) => n + 1));
    return () => {
      live = false;
      ro.disconnect();
    };
  }, []);
  const shown = useMemo(() => {
    const el = ref.current;
    if (!el || !width) return text;
    const cs = getComputedStyle(el);
    return fitText(text, width, `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
    // fonts: re-measure once the web fonts are in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, width, fonts]);
  return (
    <span ref={ref} className={`db-desc ${className ?? ""}`} title={shown !== text ? text : undefined}>
      {shown}
    </span>
  );
}

/** Separator between words or figures: a hairline, never «·» (Vazirmatn's zero is a dot). */
export const Sep = () => <span className="db-sep" aria-hidden />;

// ------------------------------------------------------------------ deltas

const Tri = ({ down }: { down?: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="db-tri">
    {down ? <path d="M1 2.5h8L5 8.5z" fill="currentColor" /> : <path d="M1 7.5h8L5 1.5z" fill="currentColor" />}
  </svg>
);

/**
 * A delta chip: a 10 px triangle and pct(). Colour is direction × meaning — for a balance, income or profit up is
 * `in`; for an expense, up is `danger` (`invert`). Under 0.1 % it is neutral.
 */
export function Delta({ ratio, invert, dp = 1, title }: { ratio: number | null | undefined; invert?: boolean; dp?: number; title?: string }) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  const flat = Math.abs(ratio) < 0.001;
  const up = ratio > 0;
  const good = invert ? !up : up;
  const tone = flat ? "flat" : good ? "up" : "down";
  return (
    <span className={`db-delta ${tone}`} title={title}>
      {flat ? null : <Tri down={!up} />}
      <span className="db-delta-v">{pct(Math.abs(ratio), Math.abs(ratio) >= 10 ? 0 : dp)}</span>
      <span className="sf-sr">{flat ? "بدون تغییر" : up ? "افزایش" : "کاهش"}</span>
    </span>
  );
}

export const ratioOf = (now: number, before: number): number | null => (before === 0 ? null : (now - before) / Math.abs(before));

// ------------------------------------------------------------------ rolling digits (components.md §3.1)

const DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const played = new Set<string>();

/**
 * Rolling digits for display figures on the first view of a session: each Persian digit rolls a strip of ۰–۹ to its
 * final glyph inside a slot as wide as that glyph, so the figure never changes width and never shows an amount that
 * did not exist. Separators stay put. Under reduced motion it is a 150 ms crossfade. `id` keys "first view".
 */
export function Roll({ text, id, className }: { text: string; id: string; className?: string }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "start" | "roll" | "done">(() => (played.has(id) ? "done" : "idle"));
  useLayoutEffect(() => {
    if (phase !== "idle") return;
    played.add(id);
    if (reduced) {
      setPhase("done");
      return;
    }
    setPhase("start");
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setPhase("roll"));
    });
    const t = window.setTimeout(() => setPhase("done"), 900);
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      window.clearTimeout(t);
    };
    // only on the first view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (phase === "done" || phase === "idle") return <span className={`${className ?? ""} ${reduced && phase === "done" ? "sf-fade" : ""}`}>{text}</span>;
  let k = 0;
  return (
    <span className={`db-roll ${className ?? ""}`} aria-label={text}>
      {[...text].map((ch, i) => {
        const d = DIGITS.indexOf(ch);
        if (d < 0)
          return (
            <span key={i} aria-hidden>
              {ch}
            </span>
          );
        const n = k++;
        return (
          <span key={i} className="db-slot" aria-hidden>
            <span className="db-slot-f">{ch}</span>
            <span className="db-reel" style={{ transform: phase === "roll" ? `translateY(calc(${-d} * var(--db-lh)))` : undefined, transitionDelay: `${Math.min(n, 6) * 30}ms` }}>
              {[...DIGITS].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** A display figure (KPI, 28/36 500): rolling digits, decimals at 65 % text-3, the unit after a 5 px gap. */
export function Figure({ text, unit, id, size = "kpi", muted }: { text: string; unit?: ReactNode; id: string; size?: "kpi" | "hero"; muted?: boolean }) {
  const [int, dec] = splitDecimals(text);
  return (
    <div className={`${size === "hero" ? "db-hero-fig" : "db-kpi-val"} ${muted ? "is-muted" : ""}`}>
      <span className="db-fig-n">
        <Roll text={int} id={id} />
        {dec ? <span className="db-fig-dec">{dec}</span> : null}
      </span>
      {unit ? <span className="db-unit">{unit}</span> : null}
    </div>
  );
}

/** A count that counts up on first load (counts only — never money, weights or rates). */
export function Count({ n }: { n: number }) {
  const v = useCountUp(n, { duration: 500 });
  return <>{fa(v)}</>;
}

// ------------------------------------------------------------------ micro-visuals (components.md §3.2)

function useWidth<T extends HTMLElement>(fallback = 160) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(([e]) => setW(Math.max(40, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

export { useWidth };

/**
 * Bars in time order (oldest first). Time runs right to left: the oldest bar is at the start (right), the latest at
 * the end. Neutral line-3 bars; the `hi` index (default: the latest) in accent-line; negatives a 2 px danger stub.
 */
export function MiniBars({ values, hi, label, h = 26 }: { values: number[]; hi?: number; label?: string; h?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = values.length;
  const max = Math.max(1, ...values.map((v) => Math.max(0, v)));
  const bw = Math.min(12, Math.max(4, (w - (n - 1) * 6) / n));
  const gap = n > 1 ? (w - n * bw) / (n - 1) : 0;
  const hiI = hi ?? n - 1;
  return (
    <div ref={ref} className="db-mini" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg width={w} height={h} className="db-mini-svg">
        {values.map((v, i) => {
          const neg = v < 0;
          const bh = v > 0 ? Math.max(3, (v / max) * (h - 2)) : 2;
          const x = w - (i + 1) * bw - i * gap;
          return <rect key={i} className={`db-bar ${i === hiI && !neg ? "hi" : ""} ${neg ? "neg" : ""}`} x={x} y={h - bh} width={bw} height={bh} rx={2} style={{ ["--i" as string]: i }} />;
        })}
      </svg>
    </div>
  );
}

/** Parts of one whole as a 6 px segmented bar with 2 px gaps (components.md §3.2 «Age bar»). */
export function SegBar({ parts, label }: { parts: { v: number; tone: "line" | "ink" | "accent" | "warn" | "danger" | "in" }[]; label: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.v), 0);
  return (
    <div className="db-segbar" role="img" aria-label={label}>
      {total > 0 ? (
        parts
          .filter((p) => p.v > 0)
          .map((p, i) => <i key={i} className={`t-${p.tone}`} style={{ inlineSize: `${(p.v / total) * 100}%` }} />)
      ) : (
        <i className="t-line" style={{ inlineSize: "100%" }} />
      )}
    </div>
  );
}

/** Two values compared as horizontal bars (comparing values → bars), each with its label and figure. */
export function PairBars({ rows }: { rows: { label: string; v: number; text: string; hi?: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div className="db-pair">
      {rows.map((r) => (
        <div key={r.label} className="db-pair-r">
          <span className="db-pair-l">{r.label}</span>
          <span className="db-pair-t">
            {r.v ? <i className={r.hi ? "hi" : ""} style={{ inlineSize: `${Math.max(2, (Math.abs(r.v) / max) * 100)}%` }} /> : null}
          </span>
          <span className="db-pair-v">{r.v ? r.text : <span className="db-zero">—</span>}</span>
        </div>
      ))}
    </div>
  );
}

/** A 1.5 px text-3 sparkline at 70 %, time right → left, the latest point r 3.5 in accent-line. */
export function Sparkline({ values, h = 26, label }: { values: number[]; h?: number; label?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  if (values.length < 2) return <div ref={ref} className="db-mini" aria-hidden />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const n = values.length;
  const px = (i: number) => w - 3.5 - (i / (n - 1)) * (w - 7);
  const py = (v: number) => (hi === lo ? h / 2 : h - 3.5 - ((v - lo) / span) * (h - 7));
  const d = values.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join("");
  return (
    <div ref={ref} className="db-mini" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg width={w} height={h} className="db-mini-svg">
        <path d={d} className="db-spark" pathLength={1} />
        <circle cx={px(n - 1)} cy={py(values[n - 1])} r={3.5} className="db-spark-dot" />
      </svg>
    </div>
  );
}

/** Seven rhombic nuqtas, one per day: hollow for none, text-3 when due, warning-fill for the next due day. */
export function WeekDots({ days }: { days: { initial: string; n: number; today?: boolean; next?: boolean; overdue?: boolean; title?: string }[] }) {
  return (
    <div className="db-week">
      {days.map((d, i) => (
        <span key={i} className={d.today ? "today" : ""} title={d.title}>
          <i className={d.overdue ? "late" : d.next ? "soon" : d.n ? "has" : ""} />
          {d.initial}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ stats strip (components.md §4.4)

export function Stat({ label, children, foot, onClick, tone }: { label: ReactNode; children: ReactNode; foot?: ReactNode; onClick?: () => void; tone?: "in" | "danger" | "warning" }) {
  const body = (
    <>
      <span className="db-stat-l">{label}</span>
      <span className={`db-stat-v ${tone ? `t-${tone}` : ""}`}>{children}</span>
      {foot ? <span className="db-stat-f">{foot}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="db-stat is-link sf-press" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="db-stat">{body}</div>
  );
}

// ------------------------------------------------------------------ skeletons and empty states (§7, §8)

/** A skeleton bar: shown only after 200 ms (CSS), shimmer swept start → end, static under reduced motion. */
export function Sk({ w = "100%", h = 12, r, className, style }: { w?: number | string; h?: number; r?: number; className?: string; style?: CSSProperties }) {
  return <i className={`db-sk ${className ?? ""}`} style={{ inlineSize: w, blockSize: h, borderRadius: r, ...style }} aria-hidden />;
}

/** Skeleton rows that mirror a list (6–8 rows). */
export function SkRows({ rows = 5, cols = [0.18, 0.46, 0.2] }: { rows?: number; cols?: number[] }) {
  return (
    <div className="db-skrows" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="db-skrow" style={{ gridTemplateColumns: cols.map((_, j) => (j === 1 ? "2.4fr" : "1fr")).join(" ") }}>
          {cols.map((c, j) => (
            <Sk key={j} w={`${Math.round(c * (j === 1 ? 100 - (i % 3) * 12 : 100))}%`} h={10} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A stats strip skeleton. */
export function SkStats({ n = 4 }: { n?: number }) {
  return (
    <div className="db-strip" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="db-stat">
          <Sk w="55%" h={10} />
          <Sk w="75%" h={18} style={{ marginBlockStart: 8 }} />
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, text, action, compact }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`db-empty ${compact ? "is-compact" : ""}`}>
      <span className="db-empty-tile">
        <Ic icon={icon} size={compact ? 22 : 28} />
      </span>
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {action ? <div className="db-empty-a">{action}</div> : null}
    </div>
  );
}

/** Persist a small per-viewer preference (the selected period); never required for correctness. */
export function usePref<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      return s && allowed.includes(s) ? s : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* private window or blocked storage */
    }
  }, [key, v]);
  return [v, setV];
}
