import Form from "next/form";
import { Badge } from "@/components/admin/ui";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { num } from "@/lib/format";
import { STATUS_LABEL, type OrderItem, type OrderStatus } from "@/lib/order-meta";

/**
 * Small pieces shared by the sales pages (orders, Pro, users, dashboard). No hooks here, so they render in
 * server and client components alike.
 */

export const STATUS_TONE: Record<OrderStatus, "warning" | "gold" | "ink" | "success" | "danger"> = {
  pending: "warning",
  packing: "gold",
  ready: "ink",
  shipped: "success",
  cancelled: "danger",
};

/** Short tab labels (the full wording is STATUS_LABEL). */
export const STATUS_SHORT: Record<OrderStatus, string> = {
  pending: "در انتظار تأیید",
  packing: "بسته‌بندی",
  ready: "آماده‌ی ارسال",
  shipped: "ارسال‌شده",
  cancelled: "لغوشده",
};

export const ACTOR_LABEL: Record<string, string> = { customer: "مشتری", admin: "مدیر", system: "سیستم" };

export const CARRIERS = ["پست", "تیپاکس", "پیک"] as const;

export function StatusBadge({ status, big }: { status: OrderStatus; big?: boolean }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={big ? "px-3 py-1 text-xs" : ""}>
      {STATUS_LABEL[status].fa}
    </Badge>
  );
}

type Thumb = Pick<OrderItem, "name_fa" | "image" | "qty">;

/** Up to `max` product pictures of an order, then «+n» for the pieces not shown. */
export function OrderThumbs({ preview, count, size = "size-10", max = 4 }: { preview: Thumb[]; count: number; size?: string; max?: number }) {
  const shown = preview.slice(0, max);
  const rest = Math.max(0, count - shown.reduce((s, p) => s + p.qty, 0));
  return (
    <div className="flex items-center gap-1">
      {shown.map((p, i) => (
        <div key={i} className={`relative shrink-0 ${size}`} title={p.name_fa}>
          {p.image ? (
            <Picture media={p.image} alt="" sizes="48px" className="size-full" />
          ) : (
            <div className="grid size-full place-items-center bg-tile text-faint">
              <Icon name="image" className="size-4" />
            </div>
          )}
          {p.qty > 1 && (
            <span dir="ltr" className="absolute -end-1 -bottom-1 rounded-sm bg-ink px-1 text-[10px] leading-4 text-bone">
              {num(`×${p.qty}`, "fa")}
            </span>
          )}
        </div>
      ))}
      {rest > 0 && (
        <span dir="ltr" className={`grid shrink-0 place-items-center border border-line bg-bone text-[11px] text-ink-2 ${size}`} title={`${num(rest, "fa")} قطعه‌ی دیگر`}>
          {num(`+${rest}`, "fa")}
        </span>
      )}
      {!shown.length && !rest && <span className={`block shrink-0 bg-tile ${size}`} />}
    </div>
  );
}

/** A GET search box (state in the URL); hidden fields keep the other filters. */
export function SearchBox({ action, q, placeholder, keep = {} }: { action: string; q: string; placeholder: string; keep?: Record<string, string | undefined> }) {
  return (
    <Form action={action} className="flex w-full gap-2 sm:max-w-md" role="search">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative min-w-0 flex-1">
        <Icon name="search" className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
        <input
          name="q"
          type="search"
          dir="auto"
          defaultValue={q}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 w-full rounded-sm border border-line-strong bg-white px-9 text-sm placeholder-shown:[direction:rtl] outline-none transition-colors placeholder:text-faint focus:border-gold"
        />
      </div>
      <button type="submit" className="h-10 shrink-0 rounded-sm border border-line-strong bg-white px-4 text-sm hover:border-ink">
        جستجو
      </button>
    </Form>
  );
}

/** Label/value pair in detail cards. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-end break-words">{children}</span>
    </div>
  );
}

// ------------------------------------------------------------------ Pro

export type ProState = "active" | "issued" | "expired" | "revoked" | "none";

export const PRO_STATE: Record<ProState, { label: string; tone: "success" | "gold" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Pro فعال", tone: "success" },
  issued: { label: "کد صادر شده، وارد نشده", tone: "gold" },
  expired: { label: "منقضی", tone: "warning" },
  revoked: { label: "باطل‌شده", tone: "danger" },
  none: { label: "بدون Pro", tone: "neutral" },
};

export function ProBadge({ state }: { state: ProState }) {
  return <Badge tone={PRO_STATE[state].tone}>{PRO_STATE[state].label}</Badge>;
}

export const KIND_LABEL: Record<string, string> = {
  retail: "فروشگاه حضوری",
  online: "فروش آنلاین",
  wholesale: "عمده‌فروش",
  personal: "خرید شخصی",
  other: "سایر",
};

/** wa.me link for an Iranian mobile (09… → 989…). */
export function whatsappUrl(phone: string, text?: string): string {
  const n = phone.replace(/\D/g, "").replace(/^0/, "");
  return `https://wa.me/98${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
