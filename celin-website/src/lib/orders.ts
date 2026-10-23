import "server-only";
import { db, isMissingTable } from "@/lib/db";
import { storageBase } from "@/lib/catalog";
import { folderUrl } from "@/lib/media";
import { MAX_LINES, MAX_QTY, isOrderStatus, type CartLine, type Customer, type Order, type OrderDetail, type OrderEvent, type OrderItem, type OrderStatus } from "@/lib/order-meta";

export const ORDER_COLUMNS =
  "id, code, user_id, status, subtotal, shipping_fee, discount, total, items_count, customer, note, carrier, tracking_code, cancel_reason, status_changed_at, created_at, updated_at";
const ITEM_COLUMNS = "id, order_id, product_id, variant_id, name_fa, name_en, variant_fa, variant_en, sku, slug, image, unit_price, qty, line_total";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cleans what the browser sent: valid ids, whole quantities 1–99, duplicate lines merged. */
export function cleanLines(input: unknown): CartLine[] {
  if (!Array.isArray(input)) return [];
  const merged = new Map<string, CartLine>();
  for (const raw of input.slice(0, MAX_LINES * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const productId = typeof r.productId === "string" ? r.productId : "";
    const variantId = typeof r.variantId === "string" && r.variantId ? r.variantId : null;
    const qty = Math.floor(Number(r.qty));
    if (!UUID.test(productId) || (variantId && !UUID.test(variantId)) || !Number.isFinite(qty) || qty < 1) continue;
    const key = `${productId}:${variantId ?? ""}`;
    const prev = merged.get(key);
    merged.set(key, { productId, variantId, qty: Math.min(MAX_QTY, (prev?.qty ?? 0) + qty) });
  }
  return [...merged.values()].slice(0, MAX_LINES);
}

export type PlaceError =
  | { reason: "empty" | "no_account" | "unavailable" | "failed" }
  | { reason: "out_of_stock" | "product_unavailable" | "variant_unavailable" | "variant_required" | "no_price"; id: string };

/** Turns the database function's exception ("out_of_stock:<id>") into a reason the page can explain. */
export function parsePlaceError(message: string): PlaceError {
  const m = /(out_of_stock|product_unavailable|variant_unavailable|variant_required|no_price):([0-9a-f-]{36})/i.exec(message);
  if (m) return { reason: m[1] as "out_of_stock", id: m[2] };
  if (/empty_order/.test(message)) return { reason: "empty" };
  if (/no_account/.test(message)) return { reason: "no_account" };
  if (/bad_qty|too_many_items/.test(message)) return { reason: "failed" };
  return { reason: "failed" };
}

export async function placeOrder(userId: string, lines: CartLine[], customer: Customer, note: string): Promise<{ ok: true; id: string; code: string } | { ok: false; error: PlaceError }> {
  const c = db();
  if (!c) return { ok: false, error: { reason: "unavailable" } };
  if (!lines.length) return { ok: false, error: { reason: "empty" } };
  const items = lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId ?? "", qty: l.qty }));
  const { data, error } = await c.rpc("celin_place_order", { p_user: userId, p_items: items, p_customer: customer, p_note: note });
  if (error) {
    if (isMissingTable(error) || error.code === "PGRST202") return { ok: false, error: { reason: "unavailable" } };
    const parsed = parsePlaceError(error.message);
    if (parsed.reason === "failed") console.error("[orders] place", error.message);
    return { ok: false, error: parsed };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { order_id: string; order_code: string } | null;
  if (!row) return { ok: false, error: { reason: "failed" } };
  return { ok: true, id: row.order_id, code: row.order_code };
}

function toOrder(r: Record<string, unknown>): Order {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    ...(r as unknown as Order),
    status: isOrderStatus(r.status) ? r.status : "pending",
    subtotal: n(r.subtotal),
    shipping_fee: n(r.shipping_fee),
    discount: n(r.discount),
    total: n(r.total),
    items_count: n(r.items_count),
    customer: { name: "", phone: "", business: "", city: "", address: "", postal_code: "", ...((r.customer as object) ?? {}) },
  };
}

function toItem(r: Record<string, unknown>): OrderItem {
  const img = r.image as { path?: string; ext?: string; widths?: number[]; width?: number; height?: number; placeholder?: string; focal_x?: number; focal_y?: number } | null;
  return {
    id: String(r.id),
    product_id: (r.product_id as string | null) ?? null,
    variant_id: (r.variant_id as string | null) ?? null,
    name_fa: String(r.name_fa ?? ""),
    name_en: String(r.name_en ?? ""),
    variant_fa: String(r.variant_fa ?? ""),
    variant_en: String(r.variant_en ?? ""),
    sku: String(r.sku ?? ""),
    slug: String(r.slug ?? ""),
    image: img?.path
      ? { src: folderUrl(img.path, storageBase()), ext: img.ext || "webp", widths: img.widths ?? [], width: img.width ?? 0, height: img.height ?? 0, placeholder: img.placeholder ?? "", fx: img.focal_x ?? 50, fy: img.focal_y ?? 50 }
      : null,
    unit_price: Number(r.unit_price ?? 0),
    qty: Number(r.qty ?? 0),
    line_total: Number(r.line_total ?? 0),
  };
}

export interface OrderSummary extends Order {
  /** first few lines for thumbnails in lists */
  preview: Pick<OrderItem, "name_fa" | "name_en" | "image" | "qty">[];
}

/** A member's orders, newest first, with a small preview of their lines. */
export async function listOrders(userId: string): Promise<OrderSummary[]> {
  const c = db();
  if (!c) return [];
  const { data, error } = await c.from("celin_orders").select(ORDER_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
  if (error) {
    if (!isMissingTable(error)) console.error("[orders] list", error.message);
    return [];
  }
  return withPreview(((data ?? []) as Record<string, unknown>[]).map(toOrder));
}

export async function withPreview(orders: Order[]): Promise<OrderSummary[]> {
  const c = db();
  if (!c || !orders.length) return orders.map((o) => ({ ...o, preview: [] }));
  const byOrder = new Map<string, OrderSummary["preview"]>();
  const ids = orders.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await c.from("celin_order_items").select("order_id, name_fa, name_en, image, qty").in("order_id", ids.slice(i, i + 100));
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const list = byOrder.get(String(r.order_id)) ?? [];
      if (list.length < 4) {
        const it = toItem({ ...r, id: "" });
        list.push({ name_fa: it.name_fa, name_en: it.name_en, image: it.image, qty: it.qty });
      }
      byOrder.set(String(r.order_id), list);
    }
  }
  return orders.map((o) => ({ ...o, preview: byOrder.get(o.id) ?? [] }));
}

/** One order with lines and history; `userId` restricts it to that member (omit only for the admin). */
export async function getOrder(code: string, userId?: string): Promise<OrderDetail | null> {
  const c = db();
  if (!c || !/^CL-\d{6}$/.test(code)) return null;
  let q = c.from("celin_orders").select(`${ORDER_COLUMNS}, admin_note`).eq("code", code);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q.maybeSingle();
  if (error || !data) {
    if (error && !isMissingTable(error)) console.error("[orders] get", error.message);
    return null;
  }
  const order = toOrder(data as Record<string, unknown>);
  const [items, events] = await Promise.all([
    c.from("celin_order_items").select(ITEM_COLUMNS).eq("order_id", order.id),
    c.from("celin_order_events").select("status, note, actor, created_at").eq("order_id", order.id).order("created_at"),
  ]);
  const detail: OrderDetail = {
    ...order,
    items: ((items.data ?? []) as Record<string, unknown>[]).map(toItem),
    events: ((events.data ?? []) as OrderEvent[]).filter((e) => isOrderStatus(e.status)),
  };
  if (userId) {
    // members never see the store's internal note
    delete (detail as Partial<OrderDetail>).admin_note;
  } else {
    detail.admin_note = String((data as Record<string, unknown>).admin_note ?? "");
  }
  return detail;
}

export async function setOrderStatus(orderId: string, status: OrderStatus, note: string, actor: "admin" | "customer", onlyFrom?: OrderStatus): Promise<{ ok: true } | { ok: false; reason: "cancelled" | "changed" | "missing" | "failed" }> {
  const c = db();
  if (!c) return { ok: false, reason: "failed" };
  const { error } = await c.rpc("celin_set_order_status", { p_order: orderId, p_status: status, p_note: note, p_actor: actor, p_only_from: onlyFrom ?? null });
  if (!error) return { ok: true };
  if (/order_cancelled/.test(error.message)) return { ok: false, reason: "cancelled" };
  if (/status_changed/.test(error.message)) return { ok: false, reason: "changed" };
  if (/order_not_found/.test(error.message)) return { ok: false, reason: "missing" };
  console.error("[orders] status", error.message);
  return { ok: false, reason: "failed" };
}
