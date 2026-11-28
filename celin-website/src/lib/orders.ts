import "server-only";
import { db, isMissingColumn, isMissingTable } from "@/lib/db";
import { storageBase } from "@/lib/catalog";
import { folderUrl } from "@/lib/media";
import { linePieces } from "@/lib/basket";
import { cleanPack, packCap } from "@/lib/packs";
import { pricingArg, type Pricing } from "@/lib/pricing";
import { ACCEPTED_STATUSES, MAX_LINES, isOrderStatus, type CartLine, type Customer, type Order, type OrderDetail, type OrderEvent, type OrderItem, type OrderStatus } from "@/lib/order-meta";

export const ORDER_COLUMNS =
  "id, code, user_id, status, subtotal, shipping_fee, discount, total, items_count, customer, note, carrier, tracking_code, cancel_reason, status_changed_at, created_at, updated_at";
const ITEM_COLUMNS = "id, order_id, product_id, variant_id, name_fa, name_en, variant_fa, variant_en, sku, slug, image, unit_price, qty, line_total";
// round five's database file adds what the member saw (list prices, the price rules); older databases lack them
const ITEM_LIST_COLUMNS = `${ITEM_COLUMNS}, list_price`;
// round six's adds how each line was sold (packs); read in steps, so a missing round six never loses the list prices
const ITEM_R6_COLUMNS = `${ITEM_LIST_COLUMNS}, pack`;
const ORDER_LIST_COLUMNS = "list_subtotal, pricing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cleans what the browser sent: valid ids, whole quantities (packs) up to 99 pieces a line, the pack 1–5 (none: single,
 * as every line before round six), duplicate lines of the same pack merged, and sorted by product and option —
 * celin_place_order locks rows in line order, so two orders never wait on each other.
 */
export function cleanLines(input: unknown): CartLine[] {
  if (!Array.isArray(input)) return [];
  const merged = new Map<string, CartLine>();
  for (const raw of input.slice(0, MAX_LINES * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const productId = typeof r.productId === "string" ? r.productId : "";
    const variantId = typeof r.variantId === "string" && r.variantId ? r.variantId : null;
    const qty = Math.floor(Number(r.qty));
    const pack = cleanPack(r.pack ?? 1);
    if (!UUID.test(productId) || (variantId && !UUID.test(variantId)) || !Number.isFinite(qty) || qty < 1) continue;
    const key = `${productId}:${variantId ?? ""}:${pack}`;
    const prev = merged.get(key);
    merged.set(key, { productId, variantId, qty: Math.min(packCap(pack), (prev?.qty ?? 0) + qty), pack });
  }
  const key = (l: CartLine) => `${l.productId.toLowerCase()}:${(l.variantId ?? "").toLowerCase()}:${l.pack}`;
  return [...merged.values()].slice(0, MAX_LINES).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export type PlaceError =
  | { reason: "empty" | "no_account" | "unavailable" | "price_changed" | "failed" }
  | { reason: "out_of_stock" | "product_unavailable" | "variant_unavailable" | "variant_required" | "no_price" | "pack_unavailable"; id: string };

/** Turns the database function's exception ("out_of_stock:<id>") into a reason the page can explain. */
export function parsePlaceError(message: string): PlaceError {
  const m = /(out_of_stock|product_unavailable|variant_unavailable|variant_required|no_price|pack_unavailable):([0-9a-f-]{36})/i.exec(message);
  if (m) return { reason: m[1] as "out_of_stock", id: m[2] };
  if (/price_changed/.test(message)) return { reason: "price_changed" };
  if (/empty_order/.test(message)) return { reason: "empty" };
  if (/no_account/.test(message)) return { reason: "no_account" };
  // bad_qty / bad_pack / too_many_items / bad_pricing: the site never sends them; nothing the member can fix
  return { reason: "failed" };
}

/**
 * Places the order with the account's price rules (celin_place_order with p_pricing and p_expect). `expect` is the
 * total the action computed from the same lines and rules (src/lib/pricing.ts invoice, which the member confirmed):
 * the database computes its own and places nothing when the two differ ('price_changed').
 *
 * Until round six's database file has run that function does not exist. An order of single pieces without the
 * special-day discount then goes to round five's function (p_pricing, no p_expect) — how the site ordered before
 * round six: it charges such an order exactly alike (list → step, rounded per piece), and the action has already
 * checked the member's total against its own. Packs or a running sale need the new function: such an order reads
 * as «not set up yet», as does any order when neither function is there.
 */
export async function placeOrder(
  userId: string,
  lines: CartLine[],
  customer: Customer,
  note: string,
  pricing: Pricing,
  expect: number,
): Promise<{ ok: true; id: string; code: string } | { ok: false; error: PlaceError }> {
  const c = db();
  if (!c) return { ok: false, error: { reason: "unavailable" } };
  if (!lines.length) return { ok: false, error: { reason: "empty" } };
  // qty in pieces (a whole number of the line's packs) and the pack, which the database checks against the product
  const items = lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId ?? "", qty: linePieces(l), pack: cleanPack(l.pack) }));
  const call = async (args: Record<string, unknown>) => {
    let r = await c.rpc("celin_place_order", args);
    // a deadlock (40P01) rolls the whole order back: one more try is safe
    if (r.error && (r.error.code === "40P01" || /deadlock detected/i.test(r.error.message))) r = await c.rpc("celin_place_order", args);
    return r;
  };
  const base = { p_user: userId, p_customer: customer, p_note: note, p_pricing: pricingArg(pricing) };
  let { data, error } = await call({ ...base, p_items: items, p_expect: Math.round(expect) });
  if (error?.code === "PGRST202" && !pricing.sale && items.every((i) => i.pack === 1)) {
    ({ data, error } = await call({ ...base, p_items: items.map(({ pack: _, ...i }) => i) }));
  }
  if (error) {
    if (isMissingTable(error) || error.code === "PGRST202") return { ok: false, error: { reason: "unavailable" } };
    const parsed = parsePlaceError(error.message);
    if (parsed.reason === "failed") console.error("[orders] place", error.message);
    // the site and the database disagree on the total: a price changed at that moment, or the two computations drifted
    if (parsed.reason === "price_changed") console.warn(`[orders] price_changed: the site expected ${Math.round(expect)}`);
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
    list_price: r.list_price === null || r.list_price === undefined ? null : Number(r.list_price),
    qty: Number(r.qty ?? 0),
    pack: cleanPack(r.pack ?? 1),
    line_total: Number(r.line_total ?? 0),
  };
}

export interface OrderSummary extends Order {
  /** first few lines for thumbnails in lists */
  preview: Pick<OrderItem, "name_fa" | "name_en" | "image" | "qty">[];
}

/**
 * A member's progress towards Pro: the goods (subtotal − discount, never shipping) of their own accepted orders
 * placed within the last `days` days, and after the admin last took Pro away — the same count as members.ts goodsBought.
 */
export async function recentPurchases(userId: string, days: number): Promise<number> {
  const c = db();
  if (!c) return 0;
  const u = await c.from("celin_users").select("pro_off_at").eq("id", userId).maybeSingle();
  const off = u.error ? null : ((u.data as { pro_off_at: string | null } | null)?.pro_off_at ?? null);
  const since = new Date(Math.max(Date.now() - days * 86400_000, off ? Date.parse(off) : 0)).toISOString();
  const { data, error } = await c.from("celin_orders").select("subtotal, discount").eq("user_id", userId).in("status", [...ACCEPTED_STATUSES]).gte("created_at", since).limit(2000);
  if (error) {
    if (!isMissingTable(error)) console.error("[orders] recent", error.message);
    return 0;
  }
  return ((data ?? []) as { subtotal: number; discount: number }[]).reduce((sum, r) => sum + Math.max(0, Number(r.subtotal ?? 0) - Number(r.discount ?? 0)), 0);
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
  const read = (extra: string) => {
    const columns: string = `${ORDER_COLUMNS}, admin_note${extra}`;
    let q = c.from("celin_orders").select(columns).eq("code", code);
    if (userId) q = q.eq("user_id", userId);
    return q.maybeSingle();
  };
  let { data, error } = (await read(`, ${ORDER_LIST_COLUMNS}`)) as { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
  if (error && isMissingColumn(error)) ({ data, error } = (await read("")) as { data: Record<string, unknown> | null; error: { code?: string; message: string } | null });
  if (error || !data) {
    if (error && !isMissingTable(error)) console.error("[orders] get", error.message);
    return null;
  }
  const order = toOrder(data as Record<string, unknown>);
  const lines = async () => {
    // the newest columns first, one step back at a time while a database file has not run
    for (const columns of [ITEM_R6_COLUMNS, ITEM_LIST_COLUMNS]) {
      const r = await c.from("celin_order_items").select(columns).eq("order_id", order.id);
      if (!r.error || !isMissingColumn(r.error)) return r;
    }
    return c.from("celin_order_items").select(ITEM_COLUMNS).eq("order_id", order.id);
  };
  const [items, events] = await Promise.all([lines(), c.from("celin_order_events").select("status, note, actor, created_at").eq("order_id", order.id).order("created_at")]);
  const raw = data as Record<string, unknown>;
  const detail: OrderDetail = {
    ...order,
    items: ((items.data ?? []) as Record<string, unknown>[]).map(toItem),
    events: ((events.data ?? []) as OrderEvent[]).filter((e) => isOrderStatus(e.status)),
    list_subtotal: Number(raw.list_subtotal ?? 0),
    pricing: raw.pricing && typeof raw.pricing === "object" ? (raw.pricing as OrderDetail["pricing"]) : {},
  };
  if (userId) {
    // members never see the store's internal note
    delete (detail as Partial<OrderDetail>).admin_note;
  } else {
    detail.admin_note = String((data as Record<string, unknown>).admin_note ?? "");
  }
  return detail;
}

/**
 * Moves an order through celin_set_order_status. `changed` is false when the order already had that status
 * (e.g. the member cancelled at the same moment) — then nobody should be told about a change.
 * Rules (database): a cancelled order stays cancelled; a shipped order can only be cancelled, and then its
 * pieces do not go back to stock (they have left the shop).
 */
export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  note: string,
  actor: "admin" | "customer",
  onlyFrom?: OrderStatus,
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: "cancelled" | "changed" | "missing" | "transition" | "failed" }> {
  const c = db();
  if (!c) return { ok: false, reason: "failed" };
  const { data, error } = await c.rpc("celin_set_order_status", { p_order: orderId, p_status: status, p_note: note, p_actor: actor, p_only_from: onlyFrom ?? null });
  if (!error) return { ok: true, changed: data !== "unchanged" };
  if (/order_cancelled/.test(error.message)) return { ok: false, reason: "cancelled" };
  if (/bad_transition/.test(error.message)) return { ok: false, reason: "transition" };
  if (/status_changed/.test(error.message)) return { ok: false, reason: "changed" };
  if (/order_not_found/.test(error.message)) return { ok: false, reason: "missing" };
  console.error("[orders] status", error.message);
  return { ok: false, reason: "failed" };
}
