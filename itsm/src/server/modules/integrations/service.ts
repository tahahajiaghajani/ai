// Integrations: API keys for other programs (and online shops) and webhook receivers that turn
// online orders (WooCommerce, Shopify or any JSON) into sales invoices automatically — so a
// business with a website does not need someone to type its orders in.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Ctx } from "../../context";
import type { Db, Tx } from "../../db";
import { insertRow, nextCode } from "../../db/sql";
import { bad, notFound } from "../../http/errors";
import { randomToken, sha256 } from "../../auth/password";
import { uuidv7 } from "@shared/id";
import { D } from "@shared/money";
import { normalizeMobile } from "@shared/validate";
import { ensureDetail } from "../accounting/details";
import { encryptSecret, decryptSecret } from "./crypto";

export type IntegrationKind = "woocommerce" | "shopify" | "generic";

export interface IntegrationConfig {
  /** create invoices as drafts (to review) or post them directly */
  post: boolean;
  /** warehouse used for stock moves */
  warehouse_id?: string | null;
  /** party used when the order has no identifiable customer */
  default_party_id?: string | null;
  /** price includes VAT (most Iranian shops) */
  prices_include_vat?: boolean;
  /** shop currency → base: multiply prices (e.g. toman shop on a rial ledger: 10) */
  price_factor?: string;
}

// ---------------------------------------------------------------- API keys

export async function createApiKey(ctx: Ctx, name: string, scopes: string[]) {
  ctx.need("integrations", "full");
  const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).padEnd(8, "x");
  const secret = randomToken(24);
  const key = `sm_${prefix}_${secret}`;
  await ctx.write((tx) =>
    insertRow(tx, "sm_api_keys", { id: uuidv7(), org_id: ctx.org.id, name, prefix, key_hash: sha256(key), scopes, created_by: ctx.user.id }, "id"),
  );
  return { key, prefix };
}

export async function resolveApiKey(db: Db, key: string | null | undefined): Promise<{ org_id: string; scopes: string[]; id: string } | null> {
  if (!key || !/^sm_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  const prefix = key.split("_")[1];
  const row = await db.one<{ id: string; org_id: string; key_hash: string; scopes: string[]; revoked_at: string | null }>(
    `select id, org_id, key_hash, scopes, revoked_at from sm_api_keys where prefix = $1`,
    [prefix],
  );
  if (!row || row.revoked_at) return null;
  const a = Buffer.from(row.key_hash);
  const b = Buffer.from(sha256(key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await db.query(`update sm_api_keys set last_used_at = now() where id = $1`, [row.id]);
  return { org_id: row.org_id, scopes: row.scopes ?? [], id: row.id };
}

// ---------------------------------------------------------------- integrations

export async function createIntegration(ctx: Ctx, input: { kind: IntegrationKind; name: string; config: IntegrationConfig; secret?: string | null }) {
  ctx.need("integrations", "full");
  const secret = input.secret?.trim() || randomToken(24);
  const row = await ctx.write((tx) =>
    insertRow(tx, "sm_integrations", {
      id: uuidv7(), org_id: ctx.org.id, kind: input.kind, name: input.name, config: input.config, secret: encryptSecret(ctx.cfg.secret, secret), origin: ctx.cfg.origin,
    }),
  );
  return { ...row, secret, webhook_path: `/api/hooks/${row.id}` };
}

/** Verify the webhook signature of the shop. */
export function verifySignature(kind: IntegrationKind, secret: string, raw: string, headers: (h: string) => string | undefined): boolean {
  const eq = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  if (kind === "woocommerce") {
    const sig = headers("x-wc-webhook-signature");
    if (!sig) return false;
    return eq(createHmac("sha256", secret).update(raw, "utf8").digest("base64"), sig);
  }
  if (kind === "shopify") {
    const sig = headers("x-shopify-hmac-sha256");
    if (!sig) return false;
    return eq(createHmac("sha256", secret).update(raw, "utf8").digest("base64"), sig);
  }
  // generic: header X-Taraz-Signature = hex HMAC-SHA256, or the secret itself in X-Taraz-Secret
  const hex = headers("x-taraz-signature");
  if (hex) return eq(createHmac("sha256", secret).update(raw, "utf8").digest("hex"), hex.replace(/^sha256=/, ""));
  const plain = headers("x-taraz-secret");
  return !!plain && eq(plain, secret);
}

export interface NormalizedOrder {
  external_id: string;
  topic: string;
  date: string;
  status: string;
  customer: { name: string; email?: string | null; mobile?: string | null; national_id?: string | null; postal_code?: string | null; address?: string | null; city?: string | null };
  lines: { sku?: string | null; name: string; qty: string; unit_price: string; discount?: string }[];
  shipping: string;
  discount: string;
  total: string;
  paid: boolean;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Order payload → our neutral shape. */
export function normalizeOrder(kind: IntegrationKind, body: any, topic: string): NormalizedOrder {
  if (kind === "woocommerce") {
    const b = body.billing ?? {};
    return {
      external_id: str(body.id ?? body.number),
      topic: topic || "order.created",
      date: str(body.date_created ?? body.date_created_gmt ?? new Date().toISOString()).slice(0, 10),
      status: str(body.status),
      customer: {
        name: `${str(b.first_name)} ${str(b.last_name)}`.trim() || str(b.company) || str(b.email) || "مشتری فروشگاه اینترنتی",
        email: b.email || null,
        mobile: b.phone ? normalizeMobile(str(b.phone)) : null,
        postal_code: b.postcode || null,
        address: [b.address_1, b.address_2].filter(Boolean).join("، ") || null,
        city: b.city || null,
      },
      lines: (body.line_items ?? []).map((l: any) => ({
        sku: l.sku || null,
        name: str(l.name),
        qty: str(l.quantity || 1),
        unit_price: D(l.subtotal ?? l.total ?? 0).div(D(l.quantity || 1)).toString(),
        discount: D(l.subtotal ?? 0).minus(D(l.total ?? l.subtotal ?? 0)).toString(),
      })),
      shipping: str(body.shipping_total || 0),
      discount: "0",
      total: str(body.total || 0),
      paid: ["processing", "completed"].includes(str(body.status)) || !!body.date_paid,
    };
  }
  if (kind === "shopify") {
    const c = body.customer ?? {};
    const a = body.billing_address ?? body.shipping_address ?? {};
    return {
      external_id: str(body.id ?? body.order_number),
      topic: topic || "orders/create",
      date: str(body.created_at ?? new Date().toISOString()).slice(0, 10),
      status: str(body.financial_status),
      customer: {
        name: `${str(c.first_name ?? a.first_name)} ${str(c.last_name ?? a.last_name)}`.trim() || str(body.email) || "مشتری فروشگاه اینترنتی",
        email: body.email || c.email || null,
        mobile: (a.phone || c.phone) ? normalizeMobile(str(a.phone || c.phone)) : null,
        postal_code: a.zip || null,
        address: [a.address1, a.address2].filter(Boolean).join("، ") || null,
        city: a.city || null,
      },
      lines: (body.line_items ?? []).map((l: any) => ({ sku: l.sku || null, name: str(l.title ?? l.name), qty: str(l.quantity || 1), unit_price: str(l.price || 0), discount: str(l.total_discount || 0) })),
      shipping: str((body.shipping_lines ?? []).reduce((s: ReturnType<typeof D>, x: any) => s.plus(D(x.price ?? 0)), D(0))),
      discount: str(body.total_discounts || 0),
      total: str(body.total_price || 0),
      paid: str(body.financial_status) === "paid",
    };
  }
  // generic JSON
  const c = body.customer ?? {};
  return {
    external_id: str(body.id ?? body.order_id ?? body.number),
    topic: topic || "order",
    date: str(body.date ?? new Date().toISOString()).slice(0, 10),
    status: str(body.status ?? "paid"),
    customer: { name: str(c.name) || "مشتری فروشگاه اینترنتی", email: c.email ?? null, mobile: c.mobile ? normalizeMobile(str(c.mobile)) : null, national_id: c.national_id ?? null, postal_code: c.postal_code ?? null, address: c.address ?? null, city: c.city ?? null },
    lines: (body.items ?? body.lines ?? []).map((l: any) => ({ sku: l.sku ?? l.code ?? null, name: str(l.name ?? l.title), qty: str(l.qty ?? l.quantity ?? 1), unit_price: str(l.price ?? l.unit_price ?? 0), discount: str(l.discount ?? 0) })),
    shipping: str(body.shipping ?? 0),
    discount: str(body.discount ?? 0),
    total: str(body.total ?? 0),
    paid: body.paid !== false,
  };
}

/** Find (by mobile, email) or create the customer of an online order. */
export async function findOrCreateCustomer(tx: Tx, orgId: string, origin: string, c: NormalizedOrder["customer"]): Promise<string> {
  if (c.mobile) {
    const r = await tx.one<{ id: string }>(`select id from sm_parties where org_id = $1 and mobile = $2 and deleted_at is null limit 1`, [orgId, c.mobile]);
    if (r) return r.id;
  }
  if (c.email) {
    const r = await tx.one<{ id: string }>(`select id from sm_parties where org_id = $1 and lower(email) = lower($2) and deleted_at is null limit 1`, [orgId, c.email]);
    if (r) return r.id;
  }
  const id = uuidv7();
  const code = await nextCode(tx, "sm_parties", orgId, 1001);
  const detail = await ensureDetail(tx, orgId, "person", id, c.name);
  await insertRow(tx, "sm_parties", {
    id, org_id: orgId, code, name: c.name.slice(0, 200), roles: ["customer"], mobile: c.mobile || null, email: c.email || null,
    national_id: c.national_id || null, postal_code: c.postal_code || null, address: c.address || null, city: c.city || null,
    detail_id: detail, tags: ["فروشگاه اینترنتی"], origin,
  }, "id");
  return id;
}

/** Match order lines to items by SKU, barcode or exact name. */
export async function matchItems(tx: Tx, orgId: string, lines: NormalizedOrder["lines"]) {
  const out: { item_id: string | null; line: NormalizedOrder["lines"][number] }[] = [];
  for (const l of lines) {
    let item: { id: string } | null = null;
    if (l.sku) item = await tx.one(`select id from sm_items where org_id = $1 and deleted_at is null and (sku = $2 or barcode = $2 or code = $2) limit 1`, [orgId, l.sku]);
    if (!item && l.name) item = await tx.one(`select id from sm_items where org_id = $1 and deleted_at is null and name = $2 limit 1`, [orgId, l.name]);
    out.push({ item_id: item?.id ?? null, line: l });
  }
  return out;
}

export async function loadIntegration(db: Db, id: string) {
  const row = await db.one<{ id: string; org_id: string; kind: IntegrationKind; name: string; config: IntegrationConfig; secret: string | null; is_active: boolean }>(
    `select id, org_id, kind, name, config, secret, is_active from sm_integrations where id = $1 and deleted_at is null`,
    [id],
  );
  if (!row) throw notFound("اتصال پیدا نشد");
  return row;
}

export function integrationSecret(appSecret: string, stored: string | null): string {
  if (!stored) throw bad("کلید اتصال تنظیم نشده است");
  return decryptSecret(appSecret, stored);
}
