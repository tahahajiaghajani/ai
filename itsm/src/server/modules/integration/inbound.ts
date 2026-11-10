// Inbound endpoints (catalogue INT-006, INT-011, INT-023): other systems post JSON to /api/v1/in/:id with the
// endpoint's token (Bearer) or an HMAC signature; each delivery is kept once (the sender's event id or Idempotency-Key)
// and mapped to the target table — a new record, or the record whose correlation field holds the sender's id — as the
// endpoint's integration user, so the user's roles bound what an endpoint can create or change.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Ctx, ServerConfig } from "../../context";
import { uuidv7 } from "@shared/id";
import { tableDef } from "@shared/tables";
import { cleanInboundRules, jsonPath, mapInbound } from "@shared/integration/webhooks";
import { bad, forbidden, notFound, unauthorized } from "../../http/errors";
import { create, list, readSecret, systemCtx, update, updateIn } from "../../engine";
import { hasFeature } from "../admin/common";
import { intLog, liveRow, needIntegrations, principalCtx, isUuid, type Row } from "./common";

export const MAX_INBOUND_BYTES = 1_000_000;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface InboundResult {
  ok: boolean;
  duplicate?: boolean;
  action?: "created" | "updated";
  id?: string;
  number?: string | null;
  message?: string;
}

async function endpointOf(cfg: ServerConfig, id: string): Promise<{ sys: Ctx; ep: Row; orgId: string }> {
  if (!isUuid(id)) throw notFound("نقطهٔ دریافت پیدا نشد");
  const r = await cfg.db.one<{ org_id: string }>(`select org_id from sm_inbound_endpoints where id = $1 and deleted_at is null`, [id]);
  if (!r) throw notFound("نقطهٔ دریافت پیدا نشد");
  const sys = await systemCtx(cfg, r.org_id);
  const ep = await liveRow(cfg.db, sys, "inbound_endpoint", id);
  if (!ep) throw notFound("نقطهٔ دریافت پیدا نشد");
  return { sys, ep, orgId: r.org_id };
}

/** Map one payload to the endpoint's table as its integration user. */
export async function applyInbound(ctx: Ctx, ep: Row, payload: unknown): Promise<Required<Pick<InboundResult, "action" | "id">> & { number: string | null }> {
  const table = String(ep.target_table);
  if (!tableDef(table)) throw bad(`جدول «${table}» وجود ندارد`);
  const values = mapInbound(payload, cleanInboundRules(ep.mapping), (ep.defaults ?? {}) as Record<string, unknown>);
  if (ep.action === "upsert" && ep.match_field && ep.match_path) {
    const key = jsonPath(payload, String(ep.match_path));
    if (key === null || key === undefined || key === "") throw bad(`شناسهٔ هم‌بستگی در مسیر «${ep.match_path}» پیام نیست`);
    const found = await list(ctx, table, { filter: { f: String(ep.match_field), op: "eq", v: String(key) }, size: 1, total: false });
    if (found.rows.length) {
      const cur = found.rows[0];
      const r = await update(ctx, table, String(cur.id), values, { version: Number(cur.version) });
      return { action: "updated", id: String(r.row.id), number: (r.row.number as string) ?? null };
    }
    values[String(ep.match_field)] = String(key);
  }
  const r = await create(ctx, table, values);
  return { action: "created", id: String(r.row.id), number: (r.row.number as string) ?? null };
}

/** A delivery to /api/v1/in/:id (verified, kept once, applied). */
export async function receiveInbound(cfg: ServerConfig, id: string, raw: string, header: (h: string) => string | undefined): Promise<InboundResult> {
  const { sys, ep, orgId } = await endpointOf(cfg, id);
  if (ep.active === false) throw forbidden("این نقطهٔ دریافت غیرفعال است");
  if (!(await hasFeature(cfg.db, orgId, "webhooks", cfg.mode))) throw forbidden("دریافت وب‌هوک برای این سازمان روشن نیست");
  const secret = await readSecret(cfg.db, sys, tableDef("inbound_endpoint")!, id, "token");
  if (!secret) throw unauthorized("توکن این نقطهٔ دریافت تنظیم نشده است");
  const auth = header("authorization");
  const signed = header("x-signature") ?? header("x-hub-signature-256");
  const ok =
    ep.auth === "hmac"
      ? !!signed && safeEqual(createHmac("sha256", secret).update(raw, "utf8").digest("hex"), signed.trim().replace(/^sha256=/i, "").toLowerCase())
      : !!auth && auth.toLowerCase().startsWith("bearer ") && safeEqual(auth.slice(7).trim(), secret);
  if (!ok) {
    await intLog(cfg.db, { org_id: orgId, kind: "inbound", ref_id: id, method: "POST", status: 401, ok: false, summary: "احراز ناموفق" });
    throw unauthorized(ep.auth === "hmac" ? "امضای درخواست معتبر نیست" : "توکن نقطهٔ دریافت معتبر نیست");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw bad("بدنهٔ درخواست JSON نیست");
  }
  const externalId = (header("idempotency-key") ?? header("x-event-id") ?? header("x-delivery-id") ?? "").trim().slice(0, 200) || null;
  const eventId = uuidv7();
  const stored = await cfg.db.one<{ id: string }>(
    `insert into sm_integration_events (id, org_id, integration_id, topic, external_id, payload, status) values ($1, $2, $3, 'inbound', $4, $5, 'received') on conflict do nothing returning id`,
    [eventId, orgId, id, externalId, payload],
  );
  if (!stored) return { ok: true, duplicate: true };
  return processStored(cfg, sys, ep, orgId, eventId, payload);
}

async function processStored(cfg: ServerConfig, sys: Ctx, ep: Row, orgId: string, eventId: string, payload: unknown): Promise<InboundResult> {
  const started = Date.now();
  let result: InboundResult;
  try {
    const { ctx } = await principalCtx(cfg, orgId, String(ep.principal_id));
    const r = await applyInbound(ctx, ep, payload);
    await cfg.db.query(`update sm_integration_events set status = 'processed', result = $2, error = null where id = $1`, [eventId, r]);
    result = { ok: true, ...r };
  } catch (e) {
    const message = String((e as Error).message ?? e).slice(0, 500);
    await cfg.db.query(`update sm_integration_events set status = 'failed', error = $2 where id = $1`, [eventId, message]);
    result = { ok: false, message };
  }
  await sys
    .write((tx) =>
      updateIn(tx, sys, "inbound_endpoint", String(ep.id), { received: Number(ep.received ?? 0) + 1, failed: Number(ep.failed ?? 0) + (result.ok ? 0 : 1), last_received_at: new Date().toISOString() }, { trusted: true, keepVersion: true }),
    )
    .catch(() => undefined);
  await intLog(cfg.db, { org_id: orgId, kind: "inbound", ref_id: String(ep.id), method: "POST", status: result.ok ? 200 : 422, ok: result.ok, latency_ms: Date.now() - started, summary: result.ok ? `${result.action} ${result.number ?? result.id}` : "پردازش ناموفق", error: result.ok ? null : result.message });
  return result;
}

/** The deliveries an endpoint received (payloads only to those who manage integrations). */
export async function inboundEvents(ctx: Ctx, endpointId: string | null) {
  needIntegrations(ctx, "view");
  const params: unknown[] = [ctx.org.id];
  return ctx.db.query(
    `select id, integration_id as endpoint_id, received_at, external_id, status, result, error from sm_integration_events
     where org_id = $1 and topic = 'inbound' ${endpointId ? `and integration_id = $${params.push(endpointId)}` : ""} order by received_at desc limit 200`,
    params,
  );
}

/** Process a stored delivery again (after fixing the mapping or the integration user's roles). */
export async function retryInbound(ctx: Ctx, eventId: string): Promise<InboundResult> {
  needIntegrations(ctx, "edit");
  const ev = await ctx.db.one<{ id: string; integration_id: string; payload: unknown }>(`select id, integration_id, payload from sm_integration_events where id = $1 and org_id = $2 and topic = 'inbound'`, [eventId, ctx.org.id]);
  if (!ev) throw notFound("دریافتی پیدا نشد");
  const { sys, ep, orgId } = await endpointOf(ctx.cfg, ev.integration_id);
  return processStored(ctx.cfg, sys, ep, orgId, ev.id, ev.payload);
}
