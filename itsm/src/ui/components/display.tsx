// Read-only presentation helpers: amounts, dates, statuses, empty states, stat tiles, loaders.
// Number rules (components.md §0.3, §4.2): tabular Persian figures, decimals full size in text-2, a negative is an
// isolated true minus («−۱۲۳» in an LTR isolate, never red), units small and quiet after a no-break space.
import "./kit.css";
import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { Inbox, ChevronLeft, type LucideIcon } from "lucide-react";
import { D, type Num } from "@shared/money";
import { formatNumber, faDigits } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { Illustration, type IllustrationName } from "../ds/illustrations";
import { splitDecimals } from "../lib/fa";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const NBSP = "\u00a0";
const MINUS = "\u2212"; // U+2212: the true minus (the hyphen is a different, shorter glyph)

/**
 * The figure itself: digits with the decimals in `.ds-dec` (full size, text-2; they step down only inside display
 * figures) and, when negative, an isolated true minus or accounting parentheses. `inkDecimals` keeps the decimals
 * in ink (a measure whose last decimal matters).
 */
export function Figure({ v, dp, minDp, parens, inkDecimals, sign }: { v: Num; dp: number; minDp?: number; parens?: boolean; inkDecimals?: boolean; sign?: boolean }) {
  const r = D(v).toDecimalPlaces(dp);
  const neg = r.isNeg() && !r.isZero();
  const [int, dec] = splitDecimals(formatNumber(r.abs(), { dp, minDp }));
  const body = (
    <>
      {int}
      {dec ? inkDecimals ? dec : <span className="ds-dec">{dec}</span> : null}
    </>
  );
  if (neg) return <bdi dir="ltr" className="ds-ltr">{parens ? <>({body})</> : <>{MINUS}{body}</>}</bdi>;
  if (sign && !r.isZero()) return <bdi dir="ltr" className="ds-ltr">+{body}</bdi>;
  return body;
}

const Unit = ({ children }: { children: ReactNode }) => (
  <>
    {NBSP}
    <span className="ds-unit">{children}</span>
  </>
);

/**
 * An amount of money with `dp` decimals (default 0) and its currency unit after it when given («ریال», «USD»…).
 * `colored` paints money in (positive) green; money out and negatives stay ink.
 */
export function Money({ v, dp = 0, zero, colored, parens, className, unit }: { v: Num; dp?: number; zero?: string; colored?: boolean; parens?: boolean; className?: string; unit?: ReactNode }) {
  const d = D(v);
  if (d.isZero() && zero !== undefined) return <span className={cx("ds-num ds-zero", className)}>{zero}</span>;
  const pos = d.toDecimalPlaces(dp).gt(0);
  return (
    <span className={cx("ds-num", colored && pos && "ds-in-t", className)}>
      <Figure v={d} dp={dp} parens={parens} />
      {unit ? <Unit>{unit}</Unit> : null}
    </span>
  );
}

/** A plain quantity, rate or count with up to `dp` decimals and an optional unit after it. */
export function Amount({ v, dp = 8, minDp, zero = "", className, suffix }: { v: Num; dp?: number; minDp?: number; zero?: string; className?: string; suffix?: ReactNode }) {
  const d = D(v);
  if (d.isZero() && zero) return <span className={cx("ds-num ds-zero", className)}>{zero}</span>;
  return (
    <span className={cx("ds-num", className)}>
      <Figure v={d} dp={dp} minDp={minDp} />
      {suffix ? <Unit>{suffix}</Unit> : null}
    </span>
  );
}

/** «۱۴۰۵/۰۸/۱۰» — tabular, start-aligned. */
export function JDate({ v, style }: { v: string | null | undefined; style?: "short" | "long" | "full" }) {
  if (!v) return <span className="ds-zero">—</span>;
  return <span className={style && style !== "short" ? "whitespace-nowrap" : "ds-num"}>{formatJalali(v, { style })}</span>;
}

export function JDateTime({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="ds-zero">—</span>;
  return <span className="ds-num">{formatJalaliDateTime(v)}</span>;
}

export function Fa({ children }: { children: ReactNode }) {
  return <>{typeof children === "string" || typeof children === "number" ? faDigits(children) : children}</>;
}

// ---------------------------------------------------------------- status

/** Chip tones (components.md §4.3): tint fill + coloured text + a 5 px nuqta. `info` is lapis, `ai` the AI's lapis. */
export type ChipTone = "warning" | "danger" | "neutral" | "in" | "accent" | "info" | "ai";

/** A 22 px status chip: the nuqta, then the word. `fig` when it holds a figure (13 px, tabular). */
export function Chip({ tone = "neutral", fig, dot = true, children, className, title }: { tone?: ChipTone; fig?: boolean; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("ds-chip", fig && "ds-chip-fig", className)} data-tone={tone} title={title}>
      {dot ? <i className="ds-nuqta" aria-hidden /> : null}
      <span>{children}</span>
    </span>
  );
}

/** The six record-state families of the design system (tokens --ds-state-*; docs/DESIGN_SYSTEM.md). */
export type StateKind = "new" | "progress" | "hold" | "resolved" | "closed" | "cancelled";
/** An engine state category (@shared/model/types) → its family. */
export const STATE_KIND: Record<string, StateKind> = { new: "new", active: "progress", waiting: "hold", resolved: "resolved", closed: "closed", canceled: "cancelled", cancelled: "cancelled" };

/** A record state as a chip in its family's colours (the label is always written: colour is never the only signal). */
export function StateChip({ state, children, className, title }: { state: StateKind; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("ds-chip", className)} data-state={state} title={title}>
      <i className="ds-nuqta" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/** A priority (1 = critical … 5 = planning): «P1» in Latin, then the label; the P1 nuqta draws attention once. */
export function PriorityChip({ p, children, className }: { p: 1 | 2 | 3 | 4 | 5; children?: ReactNode; className?: string }) {
  return (
    <span className={cx("ds-chip", className)} data-p={p}>
      <i className="ds-nuqta" aria-hidden />
      <b>{`P${p}`}</b>
      {children ? <span>{children}</span> : null}
    </span>
  );
}

/** Common record states; a module passes its own map to StatusTag for anything else. */
const STATUS: Record<string, [string, string]> = {
  draft: ["پیش‌نویس", "default"],
  active: ["فعال", "success"],
  inactive: ["غیرفعال", "default"],
  open: ["باز", "processing"],
  closed: ["بسته", "default"],
  pending: ["در انتظار", "warning"],
  in_progress: ["در حال انجام", "processing"],
  done: ["انجام‌شده", "success"],
  approved: ["تأییدشده", "success"],
  rejected: ["ردشده", "error"],
  cancelled: ["لغوشده", "error"],
  failed: ["ناموفق", "error"],
  received: ["دریافت شد", "warning"],
  processed: ["پردازش شد", "success"],
  archived: ["بایگانی", "default"],
  none: ["ثبت‌نشده", "default"],
};

/** Keys that are a neutral chip whatever their colour (a draft is not done yet). */
const NEUTRAL_KEYS = new Set(["draft", "archived"]);

/** antd colour names of the old maps → a chip tone, or null for the normal state (plain text-3 text). */
function toneOf(key: string, color: string): ChipTone | null {
  if (NEUTRAL_KEYS.has(key)) return "neutral";
  switch (color) {
    case "error":
    case "red":
      return "danger";
    case "warning":
    case "orange":
    case "yellow":
      return "warning";
    case "purple":
    case "magenta":
    case "volcano":
      return "neutral";
    default:
      // success, processing, blue, cyan, green, default: the normal state is plain text, not a chip
      return null;
  }
}

/**
 * Status is the exception, not the default (components.md §4.3): the normal state («فعال»، «انجام‌شده») is plain
 * 13 px text-3 text; only what needs attention wears a chip — pending (warning), failed / rejected (danger) and draft
 * (neutral). `map` takes `[label, antd colour]` pairs.
 */
export function StatusTag({ s, map, chip }: { s: string | null | undefined; map?: Record<string, [string, string]>; chip?: boolean }) {
  if (!s) return null;
  const [label, color] = (map ?? STATUS)[s] ?? STATUS[s] ?? [s, "default"];
  const tone = toneOf(s, color) ?? (chip ? "neutral" : null);
  if (!tone) return <span className="ds-status">{label}</span>;
  return <Chip tone={tone}>{label}</Chip>;
}

// ---------------------------------------------------------------- empty, loading

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/**
 * Empty state (components.md §7): a 56 px sunken tile with a 28 px icon, a title, one helpful sentence and at most
 * one action (plus an optional quiet link). Page-level and first-run states may pass `art` for one of the brand's
 * illustrations (ds/illustrations.tsx) instead of the tile; data views keep the tile. The accent stays rare: when the
 * page header already shows a primary button, a primary `action` is drawn as a default button (or pass
 * `primary={false}`; `primary` forces it back).
 */
export function EmptyState({
  title = "هنوز موردی ثبت نشده است",
  description,
  action,
  secondary,
  icon: Icon = Inbox,
  art,
  compact,
  className,
  primary,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  icon?: LucideIcon;
  art?: IllustrationName;
  compact?: boolean;
  className?: string;
  primary?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [headerPrimary, setHeaderPrimary] = useState(false);
  useLayoutEffect(() => {
    if (primary !== undefined) return;
    setHeaderPrimary(!!document.querySelector(".ds-ph-actions .ant-btn-primary, .ds-ph-actions .ant-btn-color-primary.ant-btn-variant-solid"));
  }, [primary]);
  const demote = primary === false || (primary === undefined && headerPrimary);
  const isPrimaryButton = isValidElement(action) && action.type === Button && (action.props as { type?: string }).type === "primary";
  const act = demote && isPrimaryButton ? cloneElement(action as React.ReactElement<{ type?: string }>, { type: "default" }) : action;
  return (
    <div ref={ref} className={cx("ds-empty ds-fade", compact && "ds-empty-compact", className)}>
      {art ? (
        <Illustration name={art} size={compact ? 120 : 168} className="ds-empty-art" />
      ) : (
        <div className="ds-empty-tile" aria-hidden>
          <Icon size={compact ? 22 : 28} strokeWidth={1.5} absoluteStrokeWidth />
        </div>
      )}
      <div className="ds-empty-title">{title}</div>
      {description ? <div className="ds-empty-text">{description}</div> : null}
      {act || secondary ? (
        <div className="ds-empty-act">
          {act}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

/** The loader for waits over a second: three rhombic nuqtas in the mark's rhythm (never a spinner in content). */
export function Loader({ label = "در حال بارگذاری", className }: { label?: string; className?: string }) {
  return (
    <span className={cx("ds-loader", className)} role="status" aria-label={label}>
      <i className="ds-nuqta" />
      <i className="ds-nuqta" />
      <i className="ds-nuqta" />
    </span>
  );
}

/** Skeleton lines for a region's first load (components.md §8): shimmer from start to end, shown after 200 ms. */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const widths = [88, 64, 76, 55, 82, 70, 60, 90];
  return (
    <div className={cx("ds-skel-block", className)} aria-busy="true" aria-label="در حال بارگذاری">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} className="ds-skel" style={{ inlineSize: `${widths[i % widths.length]}%` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- stat tiles

/**
 * KPI tile (components.md §3.2). Placed side by side in a grid, the tiles join into ONE stat card with hairline
 * dividers (kit.css), so a row of four reads as one grid, not four boxes. The label is 13 px text-2 after a quiet
 * 16 px icon; the figure is 28 px weight 500 with proportional digits (it shrinks with a narrow tile and never
 * truncates); the foot is one 13 px text-3 fact. `tone` is accepted for compatibility: tiles are never coloured.
 */
export function StatCard({
  title,
  value,
  hint,
  icon,
  onClick,
  className,
}: {
  title: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "brand" | "ok" | "bad" | "muted";
  onClick?: () => void;
  className?: string;
}) {
  const interactive = !!onClick;
  return (
    <div
      className={cx("ds-stat", interactive && "ds-stat-link", className)}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
    >
      <div className="ds-stat-label">
        {icon ? (
          <span className="ds-stat-ic" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="min-w-0">{title}</span>
        {interactive ? (
          <span className="ds-stat-go" aria-hidden>
            <ChevronLeft {...ICON} />
          </span>
        ) : null}
      </div>
      <div className="ds-stat-val ds-t-figure">{value}</div>
      {hint ? <div className="ds-stat-foot">{hint}</div> : null}
    </div>
  );
}

/** A term with an explanation on hover (never the only place essential information lives). */
export function Hint({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  return (
    <Tooltip title={tip}>
      <span className="ds-hint">{children}</span>
    </Tooltip>
  );
}
