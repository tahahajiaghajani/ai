import Link from "next/link";
import { accountCopy } from "@/content/copy/account";
import { formatDate, formatPrice, num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { isOpen, type OrderItem } from "@/lib/order-meta";
import type { OrderSummary } from "@/lib/orders";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { MiniProgress, StatusChip } from "@/components/account/ui";

/** An order line's picture snapshot as a Picture media object. */
export function itemMedia(img: OrderItem["image"]): Media | null {
  return img ? { src: img.src, ext: img.ext, widths: img.widths, width: img.width, height: img.height, placeholder: img.placeholder, fx: img.fx, fy: img.fy } : null;
}

/** Up to four thumbnails of an order, then «+n» for the pieces not shown. */
export function Thumbs({ order, lang, size = "size-12 sm:size-14" }: { order: OrderSummary; lang: Lang; size?: string }) {
  const shown = order.preview.slice(0, 4);
  const extra = Math.max(0, order.items_count - shown.reduce((n, p) => n + p.qty, 0));
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((p, i) => (
        <Picture key={i} media={itemMedia(p.image)} lang={lang} ratio="1/1" sizes="56px" alt={t(p, "name", lang)} className={`${size} bg-tile`} />
      ))}
      {extra > 0 && <span className={`${size} grid place-items-center bg-bone text-xs text-muted tabular-nums ltr`}>{accountCopy(lang).orders.more(num(extra, lang))}</span>}
    </span>
  );
}

export function OrderRow({ order, lang }: { order: OrderSummary; lang: Lang }) {
  const c = accountCopy(lang).orders;
  const open = isOpen(order.status);
  return (
    <li>
      <Link
        href={href(lang, `/account/orders/${order.code}`)}
        className="group grid gap-x-6 gap-y-4 border-b border-line py-5 transition-colors hover:bg-bone/40 sm:px-3 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-center"
      >
        <Thumbs order={order} lang={lang} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-label text-sm tracking-[0.04em] whitespace-nowrap text-ink ltr">{order.code}</span>
            <span className="text-xs text-muted">{formatDate(order.created_at, lang)}</span>
            <span className="text-xs text-muted">{c.items(num(order.items_count, lang))}</span>
          </span>
          {open && <MiniProgress status={order.status} lang={lang} className="mt-3 max-w-60" />}
        </span>
        <span className="flex items-center justify-between gap-4 xl:justify-end">
          <StatusChip status={order.status} lang={lang} />
          <span className="flex items-center gap-2">
            <span className="text-sm text-ink tabular-nums">{formatPrice(order.total, lang)}</span>
            <Icon name="chevron" className="size-4 text-faint transition-colors group-hover:text-ink rtl:-scale-x-100" />
          </span>
        </span>
      </Link>
    </li>
  );
}
