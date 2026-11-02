// Read-only presentation helpers: amounts, dates, weights, statuses, empty states, stat tiles, loaders.
// Number rules (components.md §0.3, §4.2): tabular Persian figures, decimals full size in text-2, a negative is an
// isolated true minus («−۱۲۳» in an LTR isolate, never red), units small and quiet after a no-break space.
import "./kit.css";
import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { Inbox, ChevronLeft, type LucideIcon } from "lucide-react";
import { D, type Num } from "@shared/money";
import { formatNumber, faDigits, balanceSide } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { splitDecimals } from "../lib/fa";
import { useOrg } from "../lib/org";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const NBSP = "\u00a0";
const MINUS = "\u2212"; // U+2212: the true minus (the hyphen is a different, shorter glyph)

/**
 * The figure itself: digits with the decimals in `.sf-dec` (full size, text-2; they step down only inside display
 * figures) and, when negative, an isolated true minus or accounting parentheses. `inkDecimals` keeps the decimals
 * in ink (gold weights: a milligram is money).
 */
export function Figure({ v, dp, minDp, parens, inkDecimals, sign }: { v: Num; dp: number; minDp?: number; parens?: boolean; inkDecimals?: boolean; sign?: boolean }) {
  const r = D(v).toDecimalPlaces(dp);
  const neg = r.isNeg() && !r.isZero();
  const [int, dec] = splitDecimals(formatNumber(r.abs(), { dp, minDp }));
  const body = (
    <>
      {int}
      {dec ? inkDecimals ? dec : <span className="sf-dec">{dec}</span> : null}
    </>
  );
  if (neg) return <bdi dir="ltr" className="sf-ltr">{parens ? <>({body})</> : <>{MINUS}{body}</>}</bdi>;
  if (sign && !r.isZero()) return <bdi dir="ltr" className="sf-ltr">+{body}</bdi>;
  return body;
}

const Unit = ({ children }: { children: ReactNode }) => (
  <>
    {NBSP}
    <span className="sf-unit">{children}</span>
  </>
);

/** Money in the business's currency. `colored` paints money in (positive) green; money out and negatives stay ink. */
export function Money({ v, dp, zero, colored, parens, className, unit }: { v: Num; dp?: number; zero?: string; colored?: boolean; parens?: boolean; className?: string; unit?: boolean }) {
  const { org, unit: u } = useOrg();
  const d = D(v);
  if (d.isZero() && zero !== undefined) return <span className={cx("sf-num sf-zero", className)}>{zero}</span>;
  const places = dp ?? org.money_decimals ?? 0;
  const pos = d.toDecimalPlaces(places).gt(0);
  return (
    <span className={cx("sf-num", colored && pos && "sf-in-t", className)}>
      <Figure v={d} dp={places} parens={parens} />
      {unit ? <Unit>{u}</Unit> : null}
    </span>
  );
}

/** A plain quantity, rate or count with up to `dp` decimals and an optional unit after it. */
export function Amount({ v, dp = 8, minDp, zero = "", className, suffix }: { v: Num; dp?: number; minDp?: number; zero?: string; className?: string; suffix?: ReactNode }) {
  const d = D(v);
  if (d.isZero() && zero) return <span className={cx("sf-num sf-zero", className)}>{zero}</span>;
  return (
    <span className={cx("sf-num", className)}>
      <Figure v={d} dp={dp} minDp={minDp} />
      {suffix ? <Unit>{suffix}</Unit> : null}
    </span>
  );
}

/** Gold weight: always 3 decimals, at full size and in ink (components.md §4.7). */
export function Weight({ v, zero = "", unit = true }: { v: Num; zero?: string; unit?: boolean }) {
  const d = D(v);
  if (d.isZero() && zero) return <span className="sf-num sf-zero">{zero}</span>;
  return (
    <span className="sf-num">
      <Figure v={d} dp={3} minDp={3} inkDecimals />
      {unit ? <Unit>گرم</Unit> : null}
    </span>
  );
}

/** Ledger balance: unsigned «مانده» plus its «تشخیص» (بد / بس); zero is «—» (components.md §0.3). */
export function Balance({ v, dp }: { v: Num; dp?: number }) {
  const { org } = useOrg();
  const d = D(v);
  if (d.isZero()) return <span className="sf-num sf-zero">—</span>;
  const side = balanceSide(d);
  return (
    <span className="sf-num">
      <Figure v={d.abs()} dp={dp ?? org.money_decimals ?? 0} />
      {NBSP}
      <span className="sf-bal-side" data-side={side === "بد" ? "dr" : "cr"}>
        {side}
      </span>
    </span>
  );
}

/** «۱۴۰۵/۰۸/۱۰» — tabular, start-aligned. */
export function JDate({ v, style }: { v: string | null | undefined; style?: "short" | "long" | "full" }) {
  if (!v) return <span className="sf-zero">—</span>;
  return <span className={style && style !== "short" ? "whitespace-nowrap" : "sf-num"}>{formatJalali(v, { style })}</span>;
}

export function JDateTime({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="sf-zero">—</span>;
  return <span className="sf-num">{formatJalaliDateTime(v)}</span>;
}

export function Fa({ children }: { children: ReactNode }) {
  return <>{typeof children === "string" || typeof children === "number" ? faDigits(children) : children}</>;
}

// ---------------------------------------------------------------- status

/** Chip tones (components.md §4.3): tint fill + coloured text + a 5 px nuqta. Info (blue) is retired. */
export type ChipTone = "warning" | "danger" | "neutral" | "in" | "accent";

/** A 22 px status chip: the nuqta, then the word. `fig` when it holds a figure (13 px, tabular). */
export function Chip({ tone = "neutral", fig, dot = true, children, className, title }: { tone?: ChipTone; fig?: boolean; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("sf-chip", fig && "sf-chip-fig", className)} data-tone={tone} title={title}>
      {dot ? <i className="sf-nuqta" aria-hidden /> : null}
      <span>{children}</span>
    </span>
  );
}

const STATUS: Record<string, [string, string]> = {
  draft: ["پیش‌نویس", "default"],
  posted: ["ثبت‌شده", "processing"],
  final: ["قطعی", "success"],
  void: ["باطل", "error"],
  cancelled: ["لغوشده", "error"],
  open: ["باز", "processing"],
  closing: ["در حال بستن", "warning"],
  closed: ["بسته", "default"],
  pending: ["در انتظار", "warning"],
  sent: ["ارسال‌شده", "processing"],
  paid: ["پرداخت‌شده", "success"],
  returned: ["برگشتی", "error"],
  in_hand: ["نزد صندوق", "processing"],
  deposited: ["در جریان وصول", "warning"],
  cleared: ["وصول‌شده", "success"],
  bounced: ["برگشتی", "error"],
  endorsed: ["خرج‌شده", "purple"],
  issued: ["صادرشده", "processing"],
  in_stock: ["موجود", "success"],
  sold: ["فروخته‌شده", "default"],
  reserved: ["رزرو", "warning"],
  melted: ["ذوب‌شده", "default"],
  consigned_out: ["امانی نزد دیگران", "purple"],
  verified: ["تأییدشده", "success"],
  rejected: ["ردشده", "error"],
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
    case "gold":
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
 * Status is the exception, not the default (components.md §4.3): the normal state («ثبت‌شده»، «پرداخت‌شده») is
 * plain 13 px text-3 text; only what needs attention wears a chip — pending (warning), bounced / void (danger) and
 * draft (neutral). `map` keeps the old `[label, antd colour]` shape.
 */
export function StatusTag({ s, map, chip }: { s: string | null | undefined; map?: Record<string, [string, string]>; chip?: boolean }) {
  if (!s) return null;
  const [label, color] = (map ?? STATUS)[s] ?? STATUS[s] ?? [s, "default"];
  const tone = toneOf(s, color) ?? (chip ? "neutral" : null);
  if (!tone) return <span className="sf-status">{label}</span>;
  return <Chip tone={tone}>{label}</Chip>;
}

// ---------------------------------------------------------------- empty, loading

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/**
 * Empty state (components.md §7): a 56 px sunken tile with a 28 px icon, a title, one helpful sentence and at most
 * one action (plus an optional quiet link). Never an illustration inside data views. Dusk stays rare: when the page
 * header already shows a primary button, a primary `action` is drawn as a default button (or pass `primary={false}`;
 * `primary` forces it back).
 */
export function EmptyState({
  title = "هنوز موردی ثبت نشده است",
  description,
  action,
  secondary,
  icon: Icon = Inbox,
  compact,
  className,
  primary,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  className?: string;
  primary?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [headerPrimary, setHeaderPrimary] = useState(false);
  useLayoutEffect(() => {
    if (primary !== undefined) return;
    setHeaderPrimary(!!document.querySelector(".sf-ph-actions .ant-btn-primary, .sf-ph-actions .ant-btn-color-primary.ant-btn-variant-solid"));
  }, [primary]);
  const demote = primary === false || (primary === undefined && headerPrimary);
  const isPrimaryButton = isValidElement(action) && action.type === Button && (action.props as { type?: string }).type === "primary";
  const act = demote && isPrimaryButton ? cloneElement(action as React.ReactElement<{ type?: string }>, { type: "default" }) : action;
  return (
    <div ref={ref} className={cx("sf-empty sf-fade", compact && "sf-empty-compact", className)}>
      <div className="sf-empty-tile" aria-hidden>
        <Icon size={compact ? 22 : 28} strokeWidth={1.5} absoluteStrokeWidth />
      </div>
      <div className="sf-empty-title">{title}</div>
      {description ? <div className="sf-empty-text">{description}</div> : null}
      {act || secondary ? (
        <div className="sf-empty-act">
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
    <span className={cx("sf-loader", className)} role="status" aria-label={label}>
      <i className="sf-nuqta" />
      <i className="sf-nuqta" />
      <i className="sf-nuqta" />
    </span>
  );
}

/** Skeleton lines for a region's first load (components.md §8): shimmer from start to end, shown after 200 ms. */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const widths = [88, 64, 76, 55, 82, 70, 60, 90];
  return (
    <div className={cx("sf-skel-block", className)} aria-busy="true" aria-label="در حال بارگذاری">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} className="sf-skel" style={{ inlineSize: `${widths[i % widths.length]}%` }} />
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
  tone?: "brand" | "gold" | "ok" | "bad" | "muted";
  onClick?: () => void;
  className?: string;
}) {
  const interactive = !!onClick;
  return (
    <div
      className={cx("sf-stat", interactive && "sf-stat-link", className)}
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
      <div className="sf-stat-label">
        {icon ? (
          <span className="sf-stat-ic" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="min-w-0">{title}</span>
        {interactive ? (
          <span className="sf-stat-go" aria-hidden>
            <ChevronLeft {...ICON} />
          </span>
        ) : null}
      </div>
      <div className="sf-stat-val sf-t-figure">{value}</div>
      {hint ? <div className="sf-stat-foot">{hint}</div> : null}
    </div>
  );
}

/** A term with an explanation on hover (never the only place essential information lives). */
export function Hint({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  return (
    <Tooltip title={tip}>
      <span className="sf-hint">{children}</span>
    </Tooltip>
  );
}
