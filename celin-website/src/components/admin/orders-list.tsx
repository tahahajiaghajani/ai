import Link from "next/link";
import { OrderThumbs, StatusBadge } from "@/components/admin/sales-ui";
import { formatDate, formatPhone, formatPrice, num } from "@/lib/format";
import type { OrderSummary } from "@/lib/orders";

/**
 * Orders as rows: a grid "table" from lg up, stacked cards below. Every row is one link to the order.
 * `compact` drops the city and items columns (dashboard); `member` also drops the customer (member page).
 */
const COLS = {
  full: "lg:grid-cols-[160px_96px_minmax(0,1.7fr)_minmax(0,0.7fr)_48px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)]",
  compact: "lg:grid-cols-[160px_96px_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)]",
  member: "lg:grid-cols-[160px_90px_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]",
};

export function OrdersList({
  orders,
  variant = "full",
  bare,
}: {
  orders: Pick<OrderSummary, "code" | "customer" | "items_count" | "total" | "status" | "created_at" | "preview">[];
  variant?: keyof typeof COLS;
  bare?: boolean;
}) {
  const cols = COLS[variant];
  const compact = variant !== "full";
  const member = variant === "member";
  return (
    <div className={bare ? "" : "border border-line bg-white"}>
      <div className={`hidden gap-4 border-b border-line bg-bone/60 px-4 py-2.5 text-xs text-muted lg:grid ${cols}`}>
        <span>اقلام</span>
        <span>کد</span>
        {!member && <span>مشتری</span>}
        {!compact && <span>شهر</span>}
        {!compact && <span>تعداد</span>}
        <span>مبلغ</span>
        <span>وضعیت</span>
        <span>تاریخ</span>
      </div>
      <ul className="divide-y divide-line">
        {orders.map((o) => (
          <li key={o.code}>
            <Link href={`/admin/orders/${o.code}`} className={`group block px-4 py-3.5 transition-colors hover:bg-ground lg:grid lg:items-center lg:gap-4 ${cols}`}>
              {/* thumbnails */}
              <div className="hidden lg:block">
                <OrderThumbs preview={o.preview} count={o.items_count} size="size-9" max={3} />
              </div>
              <span className="hidden text-xs lg:block">
                <span className="ltr font-mono">{o.code}</span>
              </span>
              {!member && (
                <span className="hidden min-w-0 lg:block">
                  <span className="block truncate text-sm font-medium">{o.customer.name || "—"}</span>
                  <span className="block truncate text-xs text-muted">
                    <span className="ltr">{formatPhone(o.customer.phone, "fa")}</span>
                  </span>
                </span>
              )}
              {!compact && <span className="hidden truncate text-sm text-ink-2 lg:block">{o.customer.city || "—"}</span>}
              {!compact && <span className="hidden text-sm text-ink-2 lg:block">{num(o.items_count, "fa")}</span>}
              <span className="hidden text-sm font-medium lg:block">{formatPrice(o.total, "fa")}</span>
              <span className="hidden lg:block">
                <StatusBadge status={o.status} />
              </span>
              <span className="hidden text-xs text-muted lg:block">{formatDate(o.created_at, "fa", true)}</span>

              {/* phone / tablet card */}
              <div className="lg:hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{member ? <span className="ltr font-mono">{o.code}</span> : o.customer.name || "—"}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      {!member && <span className="font-mono ltr">{o.code}</span>}
                      {o.customer.city && (
                        <span>
                          {member ? "" : "· "}
                          {o.customer.city}
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <OrderThumbs preview={o.preview} count={o.items_count} />
                  <div className="text-end">
                    <div className="text-sm font-medium whitespace-nowrap">{formatPrice(o.total, "fa")}</div>
                    <div className="text-[11px] text-muted">{formatDate(o.created_at, "fa", true)}</div>
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
