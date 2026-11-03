// Online-shop webhooks (/api/hooks/:id), the key-authenticated public API (/api/v1) and
// integration management (/api/o/:org/integrations).
import { z } from "zod";
import { router, body, type C } from "../http/hono";
import { bad, forbidden, notFound, unauthorized } from "../http/errors";
import { makeCtx, type AuthUser, type Ctx, type MemberRow, type OrgRow, type ServerConfig } from "../context";
import {
  createApiKey, createIntegration, findOrCreateCustomer, integrationSecret, loadIntegration, matchItems, normalizeOrder,
  resolveApiKey, verifySignature, type IntegrationConfig, type IntegrationKind, type NormalizedOrder,
} from "../modules/integrations/service";
import { saveInvoiceTx, getInvoice } from "../modules/goods/invoices";
import { insertRow, nextCode, updateRow } from "../db/sql";
import { uuidv7 } from "@shared/id";
import { D } from "@shared/money";
import { todayISO } from "@shared/jalali";
import { likeContains } from "../db";
import { normalizeDigits } from "@shared/money";
import { orgStatus, statusError } from "../modules/platform/org-admin";

/** Act on behalf of the organisation's owner (webhooks and API keys have no signed-in user). */
async function ownerCtx(cfg: ServerConfig, orgId: string): Promise<Ctx> {
  const org = await cfg.db.one<OrgRow>(`select * from tz_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("کسب‌وکار پیدا نشد");
  const member = await cfg.db.one<MemberRow>(
    `select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1 and role = 'owner' and is_active and deleted_at is null order by created_at limit 1`,
    [orgId],
  );
  if (!member) throw forbidden("مالک کسب‌وکار پیدا نشد");
  const user = await cfg.db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from tz_users where id = $1`, [member.user_id]);
  // a suspended business is closed to keys and shops as to its members (read-only refuses writes in ctx.write)
  const status = await orgStatus(cfg.db, orgId);
  if (status.status === "suspended") throw statusError(status);
  return makeCtx(cfg, user!, org, member, { status });
}

/** Turn an online order into a sales invoice (draft or posted, per integration settings). */
async function orderToInvoice(ctx: Ctx, kind: IntegrationKind | "api", config: IntegrationConfig, order: NormalizedOrder, integrationId: string | null = null) {
  if (!order.lines.length) throw bad("سفارش هیچ قلمی ندارد");
  const factor = D(config.price_factor || "1");
  return ctx.write(async (tx) => {
    const existing = await tx.one<{ id: string; no: number }>(
      // two shops of one business number their orders independently: an order is a duplicate only
      // for the shop it came from (older invoices carry no shop and still count for every shop)
      `select id, no from tz_invoices where org_id = $1 and source = $2 and external_ref = $3 and deleted_at is null
         and (extra->>'integration_id' is null or extra->>'integration_id' = $4)`,
      [ctx.org.id, kind, order.external_id, integrationId],
    );
    if (existing) return { invoice_id: existing.id, no: existing.no, duplicate: true };
    const partyId = order.customer.mobile || order.customer.email ? await findOrCreateCustomer(tx, ctx.org.id, ctx.cfg.origin, order.customer) : config.default_party_id ?? null;
    const matched = await matchItems(tx, ctx.org.id, order.lines);
    const lines = [];
    for (const { item_id, line } of matched) {
      let itemId = item_id;
      if (!itemId) {
        // unknown product: created as a service item (no stock) for the accountant to review
        itemId = uuidv7();
        await insertRow(tx, "tz_items", {
          id: itemId, org_id: ctx.org.id, code: await nextCode(tx, "tz_items", ctx.org.id, 10001), name: line.name.slice(0, 200) || "کالای فروشگاه اینترنتی",
          kind: "service", sku: line.sku || null, sale_price: D(line.unit_price).times(factor).toString(), description: "ساخته‌شده از سفارش فروشگاه اینترنتی", origin: ctx.cfg.origin,
        }, "id");
      }
      const vat = D((ctx.org.settings?.vat_pct as string) ?? "10");
      let price = D(line.unit_price).times(factor);
      if (config.prices_include_vat) price = price.div(D(1).plus(vat.div(100)));
      lines.push({
        item_id: itemId,
        qty: line.qty,
        unit_price: price.toDecimalPlaces(ctx.org.money_decimals + 2).toString(),
        discount: D(line.discount ?? 0).times(factor).toString(),
        warehouse_id: config.warehouse_id ?? null,
      });
    }
    const fy = await tx.one(`select 1 from tz_fiscal_years where org_id = $1 and status <> 'closed' and deleted_at is null and start_date <= $2 and end_date >= $2`, [ctx.org.id, order.date]);
    const date = fy ? order.date : todayISO((ctx.org.settings?.timezone as string) || "Asia/Tehran");
    const input = {
      kind: "sale" as const,
      status: config.post ? ("posted" as const) : ("draft" as const),
      date,
      party_id: partyId,
      warehouse_id: config.warehouse_id ?? null,
      ref_no: `${kind === "api" ? "API" : kind}#${order.external_id}`.slice(0, 60),
      additions: D(order.shipping || 0).times(factor).toString(),
      discount: D(order.discount || 0).times(factor).toString(),
      notes: `سفارش ${order.external_id} از ${kind === "woocommerce" ? "ووکامرس" : kind === "shopify" ? "شاپیفای" : "فروشگاه اینترنتی"}${order.paid ? " (پرداخت‌شده)" : ""}`,
      lines,
    };
    const extra = integrationId ? { extra: { integration_id: integrationId } } : {};
    let saved;
    try {
      await tx.query("savepoint tz_hook");
      saved = await saveInvoiceTx(tx, ctx, input as never, null, extra);
      await tx.query("release savepoint tz_hook");
    } catch (e) {
      // e.g. not enough stock to post: keep the order as a draft invoice for review
      await tx.query("rollback to savepoint tz_hook");
      if (input.status !== "posted") throw e;
      saved = await saveInvoiceTx(tx, ctx, { ...input, status: "draft" } as never, null, extra);
    }
    await updateRow(tx, "tz_invoices", { id: saved.id, org_id: ctx.org.id }, { source: kind, external_ref: order.external_id, origin: ctx.cfg.origin });
    return { invoice_id: saved.id, no: (saved as { no?: number }).no ?? null, duplicate: false };
  });
}

// ---------------------------------------------------------------- webhooks (public)

export const hookRoutes = router();

hookRoutes.post("/:id", async (c) => {
  const cfg = c.get("cfg");
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("اتصال پیدا نشد");
  const integ = await loadIntegration(cfg.db, id);
  if (!integ.is_active) return c.json({ ok: false, message: "این اتصال غیرفعال است" }, 410);
  const raw = await c.req.text();
  const ct = c.req.header("content-type") ?? "";
  // WooCommerce sends an unsigned form ping when the webhook is created
  if (integ.kind === "woocommerce" && ct.includes("application/x-www-form-urlencoded") && raw.startsWith("webhook_id=")) return c.json({ ok: true, ping: true });
  const secret = integrationSecret(cfg.secret, integ.secret);
  if (!verifySignature(integ.kind, secret, raw, (h) => c.req.header(h))) throw unauthorized("امضای درخواست معتبر نیست");
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw bad("بدنه‌ی درخواست JSON نیست");
  }
  const topic = c.req.header("x-wc-webhook-topic") ?? c.req.header("x-shopify-topic") ?? c.req.header("x-taraz-topic") ?? "order";
  const isOrder = /order/i.test(topic);
  const order = isOrder ? normalizeOrder(integ.kind, payload, topic) : null;
  const eventId = uuidv7();
  const inserted = await cfg.db.one<{ id: string }>(
    `insert into tz_integration_events (id, org_id, integration_id, topic, external_id, payload, status)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning id`,
    [eventId, integ.org_id, integ.id, topic, order?.external_id ?? null, payload, isOrder ? "received" : "ignored"],
  );
  await cfg.db.query(`update tz_integrations set last_event_at = now() where id = $1`, [integ.id]);
  if (!inserted) return c.json({ ok: true, duplicate: true });
  if (!order) return c.json({ ok: true, ignored: true });
  try {
    const ctx = await ownerCtx(cfg, integ.org_id);
    const result = await orderToInvoice(ctx, integ.kind, integ.config ?? { post: false }, order, integ.id);
    await cfg.db.query(`update tz_integration_events set status = 'processed', result = $2 where id = $1`, [eventId, result]);
    return c.json({ ok: true, ...result });
  } catch (e) {
    const message = String((e as Error).message ?? e).slice(0, 500);
    await cfg.db.query(`update tz_integration_events set status = 'failed', error = $2 where id = $1`, [eventId, message]);
    // 200 so the shop does not retry forever; the event can be retried from the app
    return c.json({ ok: false, message });
  }
});

// ---------------------------------------------------------------- public API (/api/v1)

export const publicApiRoutes = router();

async function apiCtx(c: C, scope: "read" | "write"): Promise<Ctx> {
  const cfg = c.get("cfg");
  const auth = c.req.header("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : c.req.header("x-api-key");
  const k = await resolveApiKey(cfg.db, key);
  if (!k) throw unauthorized("کلید API معتبر نیست");
  if (!k.scopes.includes(scope)) throw forbidden("این کلید اجازه‌ی این کار را ندارد");
  return ownerCtx(cfg, k.org_id);
}

publicApiRoutes.get("/ping", async (c) => {
  const ctx = await apiCtx(c, "read");
  return c.json({ ok: true, org: { id: ctx.org.id, name: ctx.org.name, base_currency: ctx.org.base_currency } });
});

publicApiRoutes.get("/items", async (c) => {
  const ctx = await apiCtx(c, "read");
  const q = c.req.query("q") ?? "";
  const n = Math.trunc(Number(c.req.query("page") ?? 1));
  const page = Number.isFinite(n) ? Math.min(Math.max(1, n), 100_000) : 1;
  const params: unknown[] = [ctx.org.id];
  let cond = "i.org_id = $1 and i.deleted_at is null and i.is_active";
  if (q) {
    params.push(likeContains(normalizeDigits(q)));
    cond += ` and (i.name ilike $2 or i.code ilike $2 or i.sku ilike $2 or i.barcode ilike $2)`;
  }
  const rows = await ctx.db.query(
    `select i.id, i.code, i.name, i.kind, i.sku, i.barcode, i.sale_price, i.vat_pct,
            coalesce((select sum(m.qty) from tz_stock_moves m where m.org_id = i.org_id and m.item_id = i.id), 0) as stock
     from tz_items i where ${cond} order by i.code limit 100 offset ${(page - 1) * 100}`,
    params,
  );
  return c.json({ items: rows, page });
});

publicApiRoutes.get("/parties", async (c) => {
  const ctx = await apiCtx(c, "read");
  const mobile = c.req.query("mobile");
  const email = c.req.query("email");
  const rows = await ctx.db.query(
    `select id, code, name, mobile, email, national_id from tz_parties where org_id = $1 and deleted_at is null
       and (($2::text is not null and mobile = $2) or ($3::text is not null and lower(email) = lower($3))) limit 20`,
    [ctx.org.id, mobile ?? null, email ?? null],
  );
  return c.json({ parties: rows });
});

const apiOrderSchema = z.object({
  id: z.union([z.string(), z.number()]),
  date: z.string().optional(),
  post: z.boolean().optional(),
  customer: z.object({ name: z.string(), mobile: z.string().nullish(), email: z.string().nullish(), national_id: z.string().nullish(), postal_code: z.string().nullish(), address: z.string().nullish(), city: z.string().nullish() }),
  items: z.array(z.object({ sku: z.string().nullish(), name: z.string(), qty: z.union([z.string(), z.number()]), price: z.union([z.string(), z.number()]), discount: z.union([z.string(), z.number()]).nullish() })).min(1),
  shipping: z.union([z.string(), z.number()]).nullish(),
  discount: z.union([z.string(), z.number()]).nullish(),
  warehouse_id: z.string().uuid().nullish(),
});

publicApiRoutes.post("/orders", async (c) => {
  const ctx = await apiCtx(c, "write");
  const input = await body(c, apiOrderSchema);
  const order = normalizeOrder("generic", { ...input, id: String(input.id) }, "order");
  const result = await orderToInvoice(ctx, "api", { post: !!input.post, warehouse_id: input.warehouse_id ?? null }, order);
  return c.json({ ok: true, ...result });
});

publicApiRoutes.get("/invoices/:id", async (c) => {
  const ctx = await apiCtx(c, "read");
  const inv = await getInvoice(ctx, c.req.param("id"));
  return c.json({ invoice: { id: inv.id, kind: inv.kind, no: inv.no, date: inv.date, status: inv.status, total: inv.total, allocated: inv.allocated ?? null, party_id: inv.party_id } });
});

// ---------------------------------------------------------------- management (/api/o/:org/integrations)

export const integrationRoutes = router();

integrationRoutes.get("/", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "view");
  const rows = await ctx.db.query(
    `select id, kind, name, config, is_active, last_event_at, created_at,
            (select count(*)::int from tz_integration_events e where e.integration_id = i.id) as events,
            (select count(*)::int from tz_integration_events e where e.integration_id = i.id and e.status = 'failed') as failed
     from tz_integrations i where org_id = $1 and deleted_at is null order by created_at`,
    [ctx.org.id],
  );
  return c.json({ integrations: rows.map((r) => ({ ...r, webhook_path: `/api/hooks/${r.id}` })) });
});

const configSchema = z.object({
  post: z.boolean().default(false),
  warehouse_id: z.string().uuid().nullish(),
  default_party_id: z.string().uuid().nullish(),
  prices_include_vat: z.boolean().optional(),
  price_factor: z.string().max(20).optional(),
});

integrationRoutes.post("/", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ kind: z.enum(["woocommerce", "shopify", "generic"]), name: z.string().trim().min(2).max(120), config: configSchema, secret: z.string().max(200).nullish() }));
  return c.json({ integration: await createIntegration(ctx, input) });
});

integrationRoutes.patch("/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "full");
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(120).optional(), config: configSchema.optional(), is_active: z.boolean().optional() }));
  const row = await ctx.write((tx) => updateRow(tx, "tz_integrations", { id: c.req.param("id"), org_id: ctx.org.id }, { ...input, origin: ctx.cfg.origin }, "id, kind, name, config, is_active"));
  if (!row) throw notFound("اتصال پیدا نشد");
  return c.json({ integration: row });
});

integrationRoutes.delete("/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "full");
  await ctx.write((tx) => tx.query(`update tz_integrations set deleted_at = now(), is_active = false where id = $1 and org_id = $2`, [c.req.param("id"), ctx.org.id]));
  return c.json({ ok: true });
});

integrationRoutes.get("/events", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "view");
  const rows = await ctx.db.query(
    `select e.id, e.integration_id, e.received_at, e.topic, e.external_id, e.status, e.result, e.error, i.name as integration_name
     from tz_integration_events e left join tz_integrations i on i.id = e.integration_id
     where e.org_id = $1 order by e.received_at desc limit 200`,
    [ctx.org.id],
  );
  return c.json({ events: rows });
});

integrationRoutes.post("/events/:id/retry", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "edit");
  const ev = await ctx.db.one<{ id: string; integration_id: string; payload: unknown; topic: string }>(
    `select id, integration_id, payload, topic from tz_integration_events where id = $1 and org_id = $2`,
    [c.req.param("id"), ctx.org.id],
  );
  if (!ev) throw notFound("رویداد پیدا نشد");
  const integ = await loadIntegration(ctx.db, ev.integration_id);
  const order = normalizeOrder(integ.kind, ev.payload, ev.topic);
  try {
    const owner = await ownerCtx(ctx.cfg, ctx.org.id);
    const result = await orderToInvoice(owner, integ.kind, integ.config ?? { post: false }, order, integ.id);
    await ctx.db.query(`update tz_integration_events set status = 'processed', result = $2, error = null where id = $1`, [ev.id, result]);
    return c.json({ ok: true, ...result });
  } catch (e) {
    const message = String((e as Error).message ?? e).slice(0, 500);
    await ctx.db.query(`update tz_integration_events set status = 'failed', error = $2 where id = $1`, [ev.id, message]);
    throw bad(message);
  }
});

integrationRoutes.get("/api-keys", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "view");
  const rows = await ctx.db.query(
    `select k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.revoked_at, u.full_name as created_by_name
     from tz_api_keys k left join tz_users u on u.id = k.created_by where k.org_id = $1 order by k.created_at desc`,
    [ctx.org.id],
  );
  return c.json({ keys: rows });
});

integrationRoutes.post("/api-keys", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(120), scopes: z.array(z.enum(["read", "write"])).min(1).default(["read", "write"]) }));
  return c.json(await createApiKey(ctx, input.name, input.scopes));
});

integrationRoutes.delete("/api-keys/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "full");
  await ctx.db.query(`update tz_api_keys set revoked_at = now() where id = $1 and org_id = $2`, [c.req.param("id"), ctx.org.id]);
  return c.json({ ok: true });
});
