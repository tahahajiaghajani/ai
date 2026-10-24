/** Client-safe order statuses and their labels (the four steps the client asked for, plus «لغو شد»). */

export const ORDER_STEPS = ["pending", "packing", "ready", "shipped"] as const;
export type OrderStep = (typeof ORDER_STEPS)[number];
export type OrderStatus = OrderStep | "cancelled";
export const ORDER_STATUSES: OrderStatus[] = [...ORDER_STEPS, "cancelled"];

export const STATUS_LABEL: Record<OrderStatus, { fa: string; en: string }> = {
  pending: { fa: "در انتظار تأیید فروشگاه", en: "Awaiting store confirmation" },
  packing: { fa: "در حال جمع‌آوری و بسته‌بندی", en: "Being prepared and packed" },
  ready: { fa: "آماده‌ی ارسال", en: "Ready to ship" },
  shipped: { fa: "ارسال شد", en: "Shipped" },
  cancelled: { fa: "لغو شد", en: "Cancelled" },
};

/** Orders still on their way (shown first in the account). */
export const isOpen = (s: OrderStatus) => s !== "shipped" && s !== "cancelled";

/**
 * Whether an order may move from `from` to `to` (celin_set_order_status enforces the same): a cancelled order
 * stays cancelled; a shipped order can only be cancelled — and its pieces then stay out of stock.
 */
export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  if (from === "cancelled") return false;
  if (from === "shipped") return to === "cancelled" || to === "shipped";
  return true;
}

/** Cancelling from this status puts the pieces back in stock. */
export const restocksOnCancel = (from: OrderStatus) => from === "pending" || from === "packing" || from === "ready";

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && (ORDER_STATUSES as string[]).includes(v);
}

export interface OrderItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  name_fa: string;
  name_en: string;
  variant_fa: string;
  variant_en: string;
  sku: string;
  slug: string;
  image: { src: string; ext: string; widths: number[]; width: number; height: number; placeholder: string; fx: number; fy: number } | null;
  unit_price: number;
  qty: number;
  line_total: number;
}

export interface OrderEvent {
  status: OrderStatus;
  note: string;
  actor: "customer" | "admin" | "system";
  created_at: string;
}

export interface Customer {
  name: string;
  phone: string;
  business: string;
  city: string;
  address: string;
  postal_code: string;
}

export interface Order {
  id: string;
  code: string;
  user_id: string | null;
  status: OrderStatus;
  subtotal: number;
  shipping_fee: number;
  discount: number;
  total: number;
  items_count: number;
  customer: Customer;
  note: string;
  carrier: string;
  tracking_code: string;
  cancel_reason: string;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
  events: OrderEvent[];
  /** admin only */
  admin_note?: string;
}

/** One line of the cart as the browser keeps it (prices are always read again on the server). */
export interface CartLine {
  productId: string;
  variantId: string | null;
  qty: number;
}

export const MAX_QTY = 99;
export const MAX_LINES = 60;
