// Read-only presentation helpers: amounts, dates, weights, statuses, empty states, stat cards.
import type { ReactNode } from "react";
import { Tag, Tooltip, Empty } from "antd";
import { D, type Num } from "@shared/money";
import { formatNumber, formatWeight, faDigits, balanceSide } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../lib/org";

export function Money({ v, dp, zero, colored, parens, className, unit }: { v: Num; dp?: number; zero?: string; colored?: boolean; parens?: boolean; className?: string; unit?: boolean }) {
  const { org, unit: u } = useOrg();
  const d = D(v);
  if (d.isZero() && zero !== undefined) return <span className={`num text-muted ${className ?? ""}`}>{zero}</span>;
  const text = formatNumber(d, { dp: dp ?? org.money_decimals ?? 0, parens });
  const color = colored ? (d.isNeg() ? "tz-neg" : d.gt(0) ? "tz-pos" : "") : d.isNeg() ? "tz-neg" : "";
  return (
    <span className={`num ${color} ${className ?? ""}`}>
      {text}
      {unit ? <span className="ms-1 text-[11px] text-muted">{u}</span> : null}
    </span>
  );
}

export function Amount({ v, dp = 8, minDp, zero = "", className, suffix }: { v: Num; dp?: number; minDp?: number; zero?: string; className?: string; suffix?: ReactNode }) {
  const d = D(v);
  if (d.isZero() && zero) return <span className={`num text-muted ${className ?? ""}`}>{zero}</span>;
  return (
    <span className={`num ${d.isNeg() ? "tz-neg" : ""} ${className ?? ""}`}>
      {formatNumber(d, { dp, minDp })}
      {suffix ? <span className="ms-1 text-[11px] text-muted">{suffix}</span> : null}
    </span>
  );
}

export function Weight({ v, zero = "", unit = true }: { v: Num; zero?: string; unit?: boolean }) {
  const d = D(v);
  if (d.isZero() && zero) return <span className="num text-muted">{zero}</span>;
  return (
    <span className={`num ${d.isNeg() ? "tz-neg" : ""}`}>
      {formatWeight(d)}
      {unit ? <span className="ms-1 text-[11px] text-muted">گرم</span> : null}
    </span>
  );
}

/** Signed balance with «بد/بس» marker (debit/credit). */
export function Balance({ v, dp }: { v: Num; dp?: number }) {
  const { org } = useOrg();
  const d = D(v);
  if (d.isZero()) return <span className="num text-muted">—</span>;
  return (
    <span className="num">
      {formatNumber(d.abs(), { dp: dp ?? org.money_decimals })}
      <span className={`ms-1 text-[11px] ${d.gt(0) ? "text-brand" : "text-gold"}`}>{balanceSide(d)}</span>
    </span>
  );
}

export function JDate({ v, style }: { v: string | null | undefined; style?: "short" | "long" | "full" }) {
  if (!v) return <span className="text-muted">—</span>;
  return <span className="num">{formatJalali(v, { style })}</span>;
}

export function JDateTime({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="text-muted">—</span>;
  return <span className="num">{formatJalaliDateTime(v)}</span>;
}

export function Fa({ children }: { children: ReactNode }) {
  return <>{typeof children === "string" || typeof children === "number" ? faDigits(children) : children}</>;
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

export function StatusTag({ s, map }: { s: string | null | undefined; map?: Record<string, [string, string]> }) {
  if (!s) return null;
  const [label, color] = (map ?? STATUS)[s] ?? STATUS[s] ?? [s, "default"];
  return (
    <Tag color={color} variant="filled" className="!m-0">
      {label}
    </Tag>
  );
}

export function EmptyState({ title = "هنوز موردی ثبت نشده است", action }: { title?: string; action?: ReactNode }) {
  return (
    <div className="py-10">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-muted">{title}</span>}>
        {action}
      </Empty>
    </div>
  );
}

export function StatCard({ title, value, hint, icon, tone = "brand", onClick }: { title: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "brand" | "gold" | "ok" | "bad" | "muted"; onClick?: () => void }) {
  const toneBg: Record<string, string> = {
    brand: "bg-brand-soft text-brand",
    gold: "bg-gold-soft text-gold",
    ok: "bg-[color-mix(in_srgb,var(--tz-success)_12%,transparent)] text-ok",
    bad: "bg-[color-mix(in_srgb,var(--tz-danger)_12%,transparent)] text-bad",
    muted: "bg-surface-2 text-muted",
  };
  return (
    <div className={`tz-card flex items-start gap-3 p-4 ${onClick ? "cursor-pointer transition hover:-translate-y-0.5" : ""}`} onClick={onClick}>
      {icon ? <div className={`grid h-10 w-10 shrink-0 place-content-center rounded-xl text-lg ${toneBg[tone]}`}>{icon}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">{title}</div>
        <div className="mt-1 truncate text-lg font-bold">{value}</div>
        {hint ? <div className="mt-0.5 truncate text-[11px] text-muted">{hint}</div> : null}
      </div>
    </div>
  );
}

export function Hint({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  return (
    <Tooltip title={tip}>
      <span className="cursor-help border-b border-dashed border-muted">{children}</span>
    </Tooltip>
  );
}
