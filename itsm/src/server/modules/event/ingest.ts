// Ingestion (catalogue EVT-002/003/006/049): monitoring tools post to /api/public/events/<key> (or /api/public/events
// with «Authorization: Bearer <key>»). The endpoint is cheap on purpose: the key names the source (only its SHA-256 is
// stored; looked up once and cached briefly), each source has its own rate limit on top of the public router's, the
// payload is normalised in memory (secrets redacted), repeats with the same delivery key are stored once
// (idempotency: the tool's id of the delivery, or the sender's Idempotency-Key header), and the events are written as
// «در صف پردازش» in one transaction that also queues the organisation's processing job. Rules, CI binding,
// deduplication into alerts and correlation run in that job (pipeline.ts).
import { createHash, randomBytes } from "node:crypto";
import { fingerprintOf, isSnsUrl, normalize, type NormalizedEvent } from "@shared/event/logic";
import type { ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { createIn, systemCtx, updateIn } from "../../engine";
import { enqueue } from "../../jobs";
import { AppError, notFound } from "../../http/errors";
import { hit } from "../../http/ratelimit";
import { liveRows, type Row } from "./common";

export const PROCESS_JOB = "event.process";
export const SNS_JOB = "event.sns_confirm";
/** Largest delivery accepted (bytes). */
export const MAX_EVENT_BYTES = 512 * 1024;

export interface SourceRow {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  active: boolean;
  mapping: Record<string, unknown> | null;
  severity_map: Record<string, unknown> | null;
  default_severity: string | null;
  rate_limit: number | null;
  assignment_group_id: string | null;
  service_id: string | null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const cache = new Map<string, { at: number; src: SourceRow | null }>();
const CACHE_MS = 30_000;

/** Forget cached sources (a key was rotated, a source switched off; tests). */
export function forgetSources(): void {
  cache.clear();
}

/** A new random key for a source: the key itself (shown once), its hash and its hint. */
export function newSourceKey(): { token: string; hash: string; hint: string } {
  const token = `ev_${randomBytes(24).toString("base64url")}`;
  return { token, hash: sha256(token), hint: `…${token.slice(-4)}` };
}

/** The source a key names (any organisation), or null. */
export async function sourceOfKey(db: Queryable, key: string): Promise<SourceRow | null> {
  if (!/^ev_[A-Za-z0-9_-]{20,80}$/.test(key)) return null;
  const hash = sha256(key);
  const hitc = cache.get(hash);
  if (hitc && Date.now() - hitc.at < CACHE_MS) return hitc.src;
  const rows = await db
    .query<SourceRow>(
      `select id, org_id, name, kind, active, mapping, severity_map, default_severity, rate_limit, assignment_group_id, service_id
         from sm_event_sources where token_hash = $1 and deleted_at is null limit 1`,
      [hash],
    )
    .catch(() => [] as SourceRow[]);
  const src = rows[0] ?? null;
  if (cache.size > 5000) cache.clear();
  cache.set(hash, { at: Date.now(), src });
  return src;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  skipped?: string | null;
  confirm?: boolean;
  ids: string[];
}

const statsAt = new Map<string, number>();

/** Parse a delivery's body: JSON (also when sent as text, like SNS), a form, or (e-mail sources) plain text. */
export function parseBody(raw: string, contentType: string, kind: string): unknown {
  const ct = contentType.toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  const text = raw.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (kind === "email") {
      const [first, ...rest] = text.split(/\r?\n/);
      return { subject: first.replace(/^subject:\s*/i, ""), text: rest.join("\n") };
    }
    throw new AppError(400, "bad_request", "بدنهٔ رویداد JSON معتبر نیست");
  }
}

/** Store the events of one delivery of a source and queue their processing. */
export async function ingest(cfg: ServerConfig, src: SourceRow, payload: unknown, opts: { idempotencyKey?: string | null; now?: number } = {}): Promise<IngestResult> {
  if (!src.active) throw new AppError(410, "gone", "این منبع رویداد غیرفعال است");
  const wait = hit({ name: "event-source", limit: Math.max(1, Number(src.rate_limit) || 600), windowMs: 60_000 }, src.id);
  if (wait) {
    const e = new AppError(429, "rate_limited", "رویدادهای این منبع بیش از سقف دقیقه است؛ کمی بعد دوباره بفرستید");
    (e as AppError & { retryAfter?: number }).retryAfter = wait;
    throw e;
  }
  const n = normalize(src, payload);
  const sys = await systemCtx(cfg, src.org_id);
  if (n.confirm_url !== undefined) {
    if (n.confirm_url && isSnsUrl(n.confirm_url)) await sys.write((tx) => enqueue(tx, { kind: SNS_JOB, orgId: src.org_id, payload: { url: n.confirm_url, source: src.id }, maxAttempts: 3 }).then(() => undefined));
    return { accepted: 0, duplicates: 0, confirm: !!n.confirm_url, skipped: n.skipped ?? null, ids: [] };
  }
  if (!n.events.length) return { accepted: 0, duplicates: 0, skipped: n.skipped ?? "رویدادی در این پیام نبود", ids: [] };
  const now = opts.now ?? Date.now();
  const idem = opts.idempotencyKey ? String(opts.idempotencyKey).trim().slice(0, 150) : null;
  const keyOf = (e: NormalizedEvent, i: number) => (idem ? `${idem}:${i}` : e.dedupe_hint ? String(e.dedupe_hint).slice(0, 200) : null);
  return sys.write(async (tx) => {
    const keys = n.events.map(keyOf);
    const wanted = [...new Set(keys.filter((k): k is string => !!k))];
    const seen = new Set<string>();
    if (wanted.length) {
      const old = await liveRows(tx, sys, "event", { and: [{ f: "source_id", op: "eq", v: src.id }, { f: "dedupe_key", op: "in", v: wanted.slice(0, 500) }] }, { limit: 500 });
      for (const r of old) seen.add(String(r.dedupe_key));
    }
    const out: IngestResult = { accepted: 0, duplicates: 0, ids: [] };
    for (const [i, e] of n.events.entries()) {
      const key = keys[i];
      if (key && seen.has(key)) {
        out.duplicates++;
        continue;
      }
      if (key) seen.add(key);
      const row = await createIn(tx, sys, "event", {
        message: e.message,
        description: e.description,
        source_id: src.id,
        status: e.status,
        severity: e.severity,
        node: e.node,
        resource: e.resource,
        metric: e.metric,
        value: e.value === null ? null : String(e.value),
        tags: e.tags,
        occurred_at: e.occurred_at,
        received_at: new Date(now).toISOString(),
        fingerprint: fingerprintOf(src.id, e),
        dedupe_key: key,
        assignment_group_id: src.assignment_group_id ?? null,
        outcome: "pending",
        decision: { hints: { ci: e.ci_hint, service: e.service_hint } },
        payload: e.payload,
      }, { trusted: true });
      out.ids.push(String(row.id));
      out.accepted++;
    }
    if (out.accepted) await enqueue(tx, { kind: PROCESS_JOB, orgId: src.org_id, payload: {}, dedupeKey: PROCESS_JOB, maxAttempts: 10 });
    // the source's activity (its heartbeat) and counters, at most once a minute per source (a busy tool must not write
    // its source row each time); a delivery of duplicates only is activity too — a tool re-sending an always-firing
    // alert (Alertmanager's Watchdog) is alive although nothing new is stored
    if (now - (statsAt.get(src.id) ?? 0) > 60_000) {
      statsAt.set(src.id, now);
      const [cur] = await liveRows(tx, sys, "event_source", { f: "id", op: "eq", v: src.id }, { limit: 1 });
      if (cur) await updateIn(tx, sys, "event_source", src.id, { last_event_at: new Date(now).toISOString(), event_count: Number(cur.event_count ?? 0) + out.accepted }, { trusted: true, keepVersion: true });
    }
    return out;
  });
}

/** Confirm an SNS subscription (GET of Amazon's URL, through the server's fetch with a timeout). */
export async function confirmSns(cfg: Pick<ServerConfig, "fetch"> & Partial<ServerConfig>, url: string): Promise<void> {
  if (!isSnsUrl(url)) throw notFound("نشانی تأیید اشتراک SNS معتبر نیست");
  const f = cfg.fetch ?? globalThis.fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await f(url, { method: "GET", redirect: "error", signal: ctl.signal });
    if (!r.ok) throw new Error(`تأیید اشتراک SNS پذیرفته نشد (${r.status})`);
  } catch (e) {
    throw new Error(`تأیید اشتراک SNS انجام نشد: ${String((e as Error).message ?? e).slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Mark a source's statistics as unknown (tests). */
export const resetIngestThrottle = () => statsAt.clear();

export type { Row };
