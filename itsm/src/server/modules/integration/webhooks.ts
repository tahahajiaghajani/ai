// Outbound webhooks (catalogue INT-005, INT-010): record events of a table delivered to another system as signed JSON.
// The subscriber queues one delivery per matching subscription; the job projects the record through the
// subscription's integration user — a record it cannot read is skipped, a field it cannot see is left out, the
// subscription's condition is checked with its access — signs the body (HMAC-SHA256 in X-Signature) and posts it.
// Failures retry with backoff; after the last attempt a delivery is dead (the dead-letter list, replayable) and after
// repeated failures the subscription pauses itself and tells its owner. The payload is never stored: a replay projects
// the record again, as it is then.
import { createHmac } from "node:crypto";
import type { Ctx, ServerConfig } from "../../context";
import { uuidv7 } from "@shared/id";
import { tableDef } from "@shared/tables";
import { HOOK_ATTEMPTS, HOOK_PAUSE_AFTER, hookBackoffMs, hookEventOf, type HookEvent } from "@shared/integration/webhooks";
import type { Cond } from "@shared/model/conditions";
import { bad, notFound } from "../../http/errors";
import { emitEvent, get, list, listJournal, onRecordEvent, readSecret, systemCtx, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, PermanentJobError } from "../../jobs";
import { hasFeature } from "../admin/common";
import { callOut, failText } from "./net";
import { intLog, liveRow, liveRows, needIntegrations, principalCtx, redactUrl, type Row } from "./common";

/** Tables whose events are never delivered (the hub's own bookkeeping: a delivery would change them again). */
const OWN_TABLES = new Set(["webhook_subscription", "inbound_endpoint", "integration_user", "export_schedule", "directory_source", "issue_connection", "external_ref", "data_export"]);

// organisations with at least one active subscription (refreshed every 30 s): events of other organisations cost nothing
let subscribedOrgs: { at: number; orgs: Set<string> } = { at: 0, orgs: new Set() };
async function hasSubscriptions(cfg: ServerConfig, orgId: string): Promise<boolean> {
  if (Date.now() - subscribedOrgs.at > 30_000) {
    const rows = await cfg.db.query<{ org_id: string }>(`select distinct org_id from sm_webhook_subscriptions where deleted_at is null and active and not paused`);
    subscribedOrgs = { at: Date.now(), orgs: new Set(rows.map((r) => r.org_id)) };
  }
  return subscribedOrgs.orgs.has(orgId);
}

/** Forget the cache (a subscription was saved in this process). */
export function invalidateSubscriptions(): void {
  subscribedOrgs = { at: 0, orgs: new Set() };
}

async function onEvent(e: RecordEvent, cfg: ServerConfig): Promise<void> {
  if (e.via === "sync" || OWN_TABLES.has(e.table)) return;
  const event = hookEventOf(e.kind);
  if (!event || !(await hasSubscriptions(cfg, e.org_id))) return;
  const sys = await systemCtx(cfg, e.org_id);
  const subs = await liveRows(cfg.db, sys, "webhook_subscription", { and: [{ f: "table_key", op: "eq", v: e.table }, { f: "active", op: "eq", v: true }, { f: "paused", op: "eq", v: false }] });
  const matching = subs.filter((s) => Array.isArray(s.events) && (s.events as string[]).includes(event));
  if (!matching.length || !(await hasFeature(cfg.db, e.org_id, "webhooks", cfg.mode))) return;
  await cfg.db.tx(async (tx) => {
    for (const s of matching) {
      const id = uuidv7();
      await tx.query(
        `insert into sm_webhook_deliveries (id, org_id, subscription_id, event, table_key, record_id, record_number, actor, status) values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [id, e.org_id, s.id, event, e.table, e.id, e.number ?? null, e.actor ?? null],
      );
      await enqueue(tx, { kind: "integration.webhook.deliver", orgId: e.org_id, payload: { id, entry: e.entry?.id ?? null, at: e.at }, maxAttempts: HOOK_ATTEMPTS });
    }
  });
}

interface Delivery {
  id: string;
  org_id: string;
  subscription_id: string;
  event: HookEvent;
  table_key: string;
  record_id: string | null;
  record_number: string | null;
  actor: string | null;
  status: string;
  attempts: number;
}

export interface BuiltPayload {
  body: string;
  skipped: string | null;
}

/** The delivery's body, projected through the subscription's integration user (null body: skipped, with the reason). */
export async function buildPayload(cfg: ServerConfig, sub: Row, d: Pick<Delivery, "id" | "event" | "table_key" | "record_id" | "record_number" | "actor">, extra: { entry?: string | null; at?: string | null } = {}): Promise<BuiltPayload> {
  const { ctx } = await principalCtx(cfg, String(sub.org_id ?? ""), String(sub.principal_id));
  const base = { id: d.id, event: d.event, table: d.table_key, record_id: d.record_id, number: d.record_number, occurred_at: extra.at ?? new Date().toISOString() };
  if (d.event === "deleted" || !d.record_id) return { body: JSON.stringify({ ...base, data: null }), skipped: null };
  let rec: Awaited<ReturnType<typeof get>>;
  try {
    rec = await get(ctx, d.table_key, d.record_id);
  } catch {
    return { body: "", skipped: "کاربر یکپارچه‌سازی این رکورد را نمی‌بیند" };
  }
  if (sub.condition && typeof sub.condition === "object") {
    const r = await list(ctx, d.table_key, { filter: { and: [{ f: "id", op: "in", v: [d.record_id] }, sub.condition as Cond] }, size: 1, total: false });
    if (!r.rows.length) return { body: "", skipped: "شرط اشتراک برقرار نیست" };
  }
  const wanted = Array.isArray(sub.fields) && (sub.fields as string[]).length ? new Set([...(sub.fields as string[]), "id", "number", "version", "state"]) : null;
  const data = wanted ? Object.fromEntries(Object.entries(rec.row).filter(([k]) => wanted.has(k))) : rec.row;
  let entry: unknown = null;
  if (d.event === "commented" && extra.entry) {
    const j = await listJournal(ctx, d.table_key, d.record_id, { limit: 50 }).catch(() => null);
    const found = j?.entries.find((x) => x.id === extra.entry);
    // an internal note the integration user may not read is not delivered
    if (!found) return { body: "", skipped: "کاربر یکپارچه‌سازی این یادداشت را نمی‌بیند" };
    entry = { id: found.id, kind: found.kind, visibility: found.visibility, body: found.body, author: j!.display[found.author ?? ""] ?? null, created_at: found.created_at };
  }
  return { body: JSON.stringify({ ...base, number: rec.row.number ?? d.record_number, data, display: rec.display, ...(entry ? { entry } : {}) }), skipped: null };
}

const sign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

/** Post a body to a subscription's URL (signed). */
async function post(cfg: ServerConfig, sub: Row, secret: string | null, body: string, headers: Record<string, string>) {
  return callOut(cfg, String(sub.url), { method: "POST", headers: { "content-type": "application/json", "user-agent": "ITSM-Webhooks/1", ...(secret ? { "X-Signature": sign(secret, body) } : {}), ...headers }, body }, `نشانی وب‌هوک «${sub.name}»`, 10_000);
}

async function setSubscription(cfg: ServerConfig, orgId: string, subId: string, patch: Record<string, unknown>, event?: string): Promise<void> {
  const sys = await systemCtx(cfg, orgId);
  await sys.write(async (tx) => {
    const row = await updateIn(tx, sys, "webhook_subscription", subId, patch, { trusted: true, keepVersion: true });
    if (event) await emitEvent(tx, sys, { kind: `record.${event}`, table: "webhook_subscription", id: subId, data: { users: [row.created_by].filter(Boolean) } });
  });
}

async function deliver(cfg: ServerConfig, deliveryId: string, attempt: number, extra: { entry?: string | null; at?: string | null }): Promise<void> {
  const d = await cfg.db.one<Delivery>(`select * from sm_webhook_deliveries where id = $1`, [deliveryId]);
  if (!d || d.status === "delivered" || d.status === "skipped") return;
  const sys = await systemCtx(cfg, d.org_id);
  const sub = await liveRow(cfg.db, sys, "webhook_subscription", d.subscription_id);
  const finish = (status: string, patch: { code?: number | null; ms?: number | null; error?: string | null } = {}) =>
    cfg.db.query(
      `update sm_webhook_deliveries set status = $2, attempts = $3, response_code = $4, latency_ms = $5, error = $6, delivered_at = case when $2 = 'delivered' then now() else delivered_at end, next_retry_at = $7 where id = $1`,
      [d.id, status, attempt, patch.code ?? null, patch.ms ?? null, patch.error?.slice(0, 1000) ?? null, status === "failed" ? new Date(Date.now() + hookBackoffMs(attempt)).toISOString() : null],
    );
  if (!sub || sub.active === false || sub.paused) return void (await finish("skipped", { error: "اشتراک غیرفعال یا متوقف است" }));
  let built: BuiltPayload;
  try {
    built = await buildPayload(cfg, { ...sub, org_id: d.org_id }, d, extra);
  } catch (e) {
    await finish("dead", { error: String((e as Error).message ?? e) });
    await intLog(cfg.db, { org_id: d.org_id, kind: "webhook", ref_id: d.subscription_id, ok: false, summary: `${d.event} ${d.table_key}`, error: String((e as Error).message ?? e) });
    return;
  }
  if (built.skipped) return void (await finish("skipped", { error: built.skipped }));
  const secret = await readSecret(cfg.db, sys, tableDef("webhook_subscription")!, String(sub.id), "secret");
  const r = await post(cfg, sub, secret, built.body, { "X-Event": d.event, "X-Delivery-Id": d.id, "X-Table": d.table_key });
  await intLog(cfg.db, { org_id: d.org_id, kind: "webhook", ref_id: String(sub.id), method: "POST", target: redactUrl(String(sub.url)), status: r.status || null, ok: r.ok, latency_ms: r.ms, summary: `${d.event} ${d.record_number ?? d.table_key}`, error: r.ok ? null : failText("نشانی", r) });
  if (r.ok) {
    await finish("delivered", { code: r.status, ms: r.ms });
    if (sub.health !== "ok" || Number(sub.failures ?? 0) > 0 || !sub.last_delivery_at || Date.now() - Date.parse(String(sub.last_delivery_at)) > 60_000)
      await setSubscription(cfg, d.org_id, String(sub.id), { health: "ok", failures: 0, last_delivery_at: new Date().toISOString(), last_status: `${r.status} (${r.ms} ms)` });
    return;
  }
  const last = attempt >= HOOK_ATTEMPTS;
  await finish(last ? "dead" : "failed", { code: r.status || null, ms: r.ms, error: failText("نشانی", r) });
  const failures = Number(sub.failures ?? 0) + 1;
  const pause = failures >= HOOK_PAUSE_AFTER;
  await setSubscription(cfg, d.org_id, String(sub.id), { health: pause ? "paused" : "failing", failures, paused: pause || !!sub.paused, last_status: failText("نشانی", r).slice(0, 300) }, pause ? "webhook_paused" : undefined);
  if (!last) throw new Error(failText("نشانی", r));
}

// ---------------------------------------------------------------- the hub's actions

/** Deliveries of a subscription (or all), newest first; `status` «dead» is the dead-letter list. */
export async function listDeliveries(ctx: Ctx, f: { subscription?: string | null; status?: string | null; limit?: number }) {
  needIntegrations(ctx, "view");
  const params: unknown[] = [ctx.org.id];
  const where = ["org_id = $1"];
  if (f.subscription) where.push(`subscription_id = $${params.push(f.subscription)}`);
  if (f.status) where.push(`status = $${params.push(f.status)}`);
  return ctx.db.query(
    `select id, subscription_id, event, table_key, record_id, record_number, status, attempts, response_code, latency_ms, error, created_at, delivered_at, next_retry_at
     from sm_webhook_deliveries where ${where.join(" and ")} order by created_at desc limit ${Math.min(Math.max(f.limit ?? 100, 1), 500)}`,
    params,
  );
}

/** Send a delivery again (from the dead-letter list or after fixing the receiver). */
export async function replayDelivery(ctx: Ctx, id: string): Promise<void> {
  needIntegrations(ctx, "edit");
  await ctx.write(async (tx) => {
    const r = await tx.one(`update sm_webhook_deliveries set status = 'pending', attempts = 0, error = null, next_retry_at = null where id = $1 and org_id = $2 and status in ('dead', 'failed', 'skipped') returning id`, [id, ctx.org.id]);
    if (!r) throw notFound("ارسالی برای تکرار پیدا نشد");
    await enqueue(tx, { kind: "integration.webhook.deliver", orgId: ctx.org.id, payload: { id }, maxAttempts: HOOK_ATTEMPTS });
  });
}

/** Resume a paused subscription (its failure count starts again). */
export async function resumeSubscription(ctx: Ctx, id: string): Promise<void> {
  needIntegrations(ctx, "edit");
  const sub = await liveRow(ctx.db, ctx, "webhook_subscription", id);
  if (!sub) throw notFound("اشتراک پیدا نشد");
  await setSubscription(ctx.cfg, ctx.org.id, id, { paused: false, failures: 0, health: "unknown" });
  invalidateSubscriptions();
}

/** «ارسال آزمایشی با یک رکورد واقعی»: one delivery now, synchronously, with its result. */
export async function testSubscription(ctx: Ctx, id: string, recordId?: string | null): Promise<{ ok: boolean; status: number; ms: number; skipped: string | null; response: string }> {
  needIntegrations(ctx, "edit");
  const sub = await liveRow(ctx.db, ctx, "webhook_subscription", id);
  if (!sub) throw notFound("اشتراک پیدا نشد");
  const { ctx: p } = await principalCtx(ctx.cfg, ctx.org.id, String(sub.principal_id));
  let rid = recordId ?? null;
  let number: string | null = null;
  if (!rid) {
    const r = await list(p, String(sub.table_key), { size: 1, sort: "-updated_at", total: false });
    if (!r.rows.length) throw bad("کاربر یکپارچه‌سازی هیچ رکوردی از این جدول نمی‌بیند؛ ارسال آزمایشی ممکن نیست");
    rid = String(r.rows[0].id);
    number = (r.rows[0].number as string) ?? null;
  }
  const built = await buildPayload(ctx.cfg, { ...sub, org_id: ctx.org.id }, { id: `test-${uuidv7()}`, event: "updated", table_key: String(sub.table_key), record_id: rid, record_number: number, actor: ctx.user.id });
  if (built.skipped) return { ok: false, status: 0, ms: 0, skipped: built.skipped, response: "" };
  const secret = await readSecret(ctx.db, ctx, tableDef("webhook_subscription")!, id, "secret");
  const r = await post(ctx.cfg, sub, secret, built.body, { "X-Event": "test", "X-Delivery-Id": "test", "X-Table": String(sub.table_key) });
  await intLog(ctx.db, { org_id: ctx.org.id, kind: "webhook", ref_id: id, actor: ctx.user.id, method: "POST", target: redactUrl(String(sub.url)), status: r.status || null, ok: r.ok, latency_ms: r.ms, summary: "ارسال آزمایشی", error: r.ok ? null : failText("نشانی", r) });
  return { ok: r.ok, status: r.status, ms: r.ms, skipped: null, response: r.text.slice(0, 500) };
}

let installed = false;
export function installWebhooks(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("integration.webhooks", (e, jctx) => onEvent(e, jctx.cfg as ServerConfig), { kinds: ["record.created", "record.updated", "record.state_changed", "record.deleted", "record.commented"] });
  registerJobHandler("integration.webhook.deliver", async (job, jctx) => {
    if (!job.payload.id) throw new PermanentJobError("delivery id missing");
    await deliver(jctx.cfg as ServerConfig, String(job.payload.id), job.attempts, { entry: job.payload.entry ?? null, at: job.payload.at ?? null });
  });
}
