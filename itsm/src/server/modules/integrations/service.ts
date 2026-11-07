// Integrations: API keys for other programs (/api/v1) and inbound webhooks (/api/hooks/:id) that receive signed
// JSON events from other systems — monitoring, forms, chat tools, another service desk. Every delivery is
// stored (sm_integration_events, deduplicated by the sender's event id); a module that understands a topic
// registers a handler with `registerTopicHandler` and turns the event into its own records. Without a
// handler the event is kept as «دریافت شد» for people to see (and to process later with «تلاش دوباره»).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Ctx } from "../../context";
import type { Db } from "../../db";
import { insertRow } from "../../db/sql";
import { bad, notFound } from "../../http/errors";
import { randomToken, sha256 } from "../../auth/password";
import { uuidv7 } from "@shared/id";
import { encryptSecret, decryptSecret } from "./crypto";

/** The only kind today: a webhook that receives signed JSON. Later connectors (directory, e-mail…) add theirs. */
export type IntegrationKind = "webhook";

export interface IntegrationConfig {
  /** what the sending system is and what it sends (shown on the integrations page) */
  description?: string | null;
}

/** The largest webhook body accepted (bytes of the raw text). */
export const MAX_HOOK_BYTES = 1_000_000;

// ---------------------------------------------------------------- API keys

/** A new API key: `sm_<prefix>_<secret>`. Only its SHA-256 is stored; the key is shown once. */
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

// ---------------------------------------------------------------- webhooks

/** A webhook: the secret is chosen by the person (the sending system's own) or made here, and stored encrypted. */
export async function createIntegration(ctx: Ctx, input: { name: string; config?: IntegrationConfig | null; secret?: string | null }) {
  ctx.need("integrations", "full");
  const secret = input.secret?.trim() || randomToken(24);
  const row = await ctx.write((tx) =>
    insertRow<{ id: string; kind: IntegrationKind; name: string; config: IntegrationConfig; is_active: boolean; created_at: string }>(
      tx,
      "sm_integrations",
      { id: uuidv7(), org_id: ctx.org.id, kind: "webhook", name: input.name, config: input.config ?? {}, secret: encryptSecret(ctx.cfg.secret, secret), created_by: ctx.user.id },
      "id, kind, name, config, is_active, created_at",
    ),
  );
  return { ...row, secret, webhook_path: `/api/hooks/${row.id}` };
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Is the delivery signed with the webhook's secret? Accepted, in this order:
 * - `X-Signature` (or `X-Hub-Signature-256`): the hex HMAC-SHA256 of the raw body, optionally written `sha256=<hex>`;
 * - `X-Webhook-Secret`: the secret itself (for senders that cannot sign; use it over HTTPS only).
 */
export function verifySignature(secret: string, raw: string, headers: (h: string) => string | undefined): boolean {
  const signed = headers("x-signature") ?? headers("x-hub-signature-256");
  if (signed) return safeEqual(createHmac("sha256", secret).update(raw, "utf8").digest("hex"), signed.trim().replace(/^sha256=/i, "").toLowerCase());
  const plain = headers("x-webhook-secret");
  return !!plain && safeEqual(plain, secret);
}

const field = (body: unknown, keys: string[]): string | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const k of keys) {
    const v = (body as Record<string, unknown>)[k];
    if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  }
  return null;
};

/** The event's topic: the `X-Topic` / `X-Event` header, else `topic` / `event` / `type` of the body, else «event». */
export function eventTopic(headers: (h: string) => string | undefined, body: unknown): string {
  const t = headers("x-topic") ?? headers("x-event") ?? headers("x-github-event") ?? field(body, ["topic", "event", "type"]) ?? "event";
  return t.trim().slice(0, 120) || "event";
}

/** The sender's id of the event (a retried delivery carries the same one and is stored once), or null. */
export function eventExternalId(headers: (h: string) => string | undefined, body: unknown): string | null {
  const id = headers("x-event-id") ?? headers("x-delivery-id") ?? headers("x-github-delivery") ?? field(body, ["event_id", "id"]);
  return id ? id.trim().slice(0, 200) : null;
}

export interface HookEvent {
  id: string;
  topic: string;
  external_id: string | null;
  payload: unknown;
  integration: { id: string; name: string; config: IntegrationConfig };
}

/**
 * What a module does with an event of a topic it understands, as the organisation's owner (`ctx`): it writes
 * its own records (inside `ctx.write`) and returns a small result that is stored with the event (e.g. the id
 * of the record it made). Throwing marks the event «ناموفق» with the message.
 */
export type TopicHandler = (ctx: Ctx, event: HookEvent) => Promise<Record<string, unknown> | void>;

const HANDLERS: { match: string | RegExp; handler: TopicHandler }[] = [];

/** Registers the handler of a topic (exact text, or a pattern); the first registered match wins. Returns its removal. */
export function registerTopicHandler(match: string | RegExp, handler: TopicHandler): () => void {
  const entry = { match, handler };
  HANDLERS.push(entry);
  return () => {
    const at = HANDLERS.indexOf(entry);
    if (at >= 0) HANDLERS.splice(at, 1);
  };
}

export function handlerFor(topic: string): TopicHandler | null {
  return HANDLERS.find((h) => (typeof h.match === "string" ? h.match === topic : h.match.test(topic)))?.handler ?? null;
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
