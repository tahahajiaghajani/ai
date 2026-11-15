// Problems a tool reports (design A §9.6): each connector's open problems in discovery_problem, diffed against the
// tool's complete open set — a new one fires, a vanished one clears, a changed severity fires again — and sent to event
// management through `ingest()` with the connector's own event source (kind generic, fixed mapping, no public key), so
// its rules, deduplication, correlation, maintenance and alert → incident rules apply unchanged.
//
// Sending is paced: chunks of ≤ 100 events per `ingest()` call (it checks only the first 500 dedupe keys of a delivery)
// and ≤ half of the source's `rate_limit` per minute (it answers 429 above the rate) — a first pass with 2 000 open
// problems goes out over about 7 minutes, later passes send only changes; unsent rows wait. Dedupe key
// `disc:<connector>:<problem_key>:<firing|resolved>:<seq>`, fingerprint `disc:<connector>:<problem_key>`.
// Bookkeeping is lock-free set-based SQL; only the events themselves are engine writes (ingest's own).
import type { DiscoveredProblem } from "@shared/discovery/types";
import { mapSeverity } from "@shared/event/logic";
import { AVAILABILITY_TAG } from "@shared/discovery/availability";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { createIn } from "../../engine";
import { AppError } from "../../http/errors";
import { ingest, type SourceRow } from "../event/ingest";

type Row = Record<string, any>;

/** Events per `ingest()` call. */
export const PROBLEM_CHUNK = 100;
/** The share of the source's per-minute rate the module uses. */
export const RATE_SHARE = 0.5;
const DEFAULT_RATE = 600;

export const fingerprintOf = (connectorId: string, key: string) => `disc:${connectorId}:${key}`;
export const dedupeKeyOf = (connectorId: string, key: string, status: "firing" | "resolved", seq: number) => `disc:${connectorId}:${key}:${status}:${seq}`;

/** Problems seen now: inserted, refreshed, re-opened (cleared earlier) or re-fired (severity changed). Set-based. */
export async function recordProblems(q: Queryable, orgId: string, connectorId: string, problems: DiscoveredProblem[], seenAt: Date, origin: string): Promise<{ opened: number }> {
  const byKey = new Map<string, DiscoveredProblem>();
  for (const p of problems) {
    const key = String(p?.key ?? "").trim().slice(0, 200);
    if (key) byKey.set(key, { ...p, key });
  }
  if (!byKey.size) return { opened: 0 };
  const rows = [...byKey.values()].map((p) => ({
    key: p.key,
    external_id: p.external_id ? String(p.external_id).slice(0, 200) : null,
    severity: mapSeverity(p.severity, null, "minor"),
    availability: p.availability === true,
    message: p.message ? String(p.message).slice(0, 500) : null,
    since: p.since && Number.isFinite(Date.parse(p.since)) && Date.parse(p.since) <= seenAt.getTime() ? new Date(p.since).toISOString() : null,
  }));
  let opened = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await q.query<{ inserted: boolean; reopened: boolean }>(
      `with x as (
         select * from jsonb_to_recordset($3::jsonb) as x(key text, external_id text, severity text, availability boolean, message text, since timestamptz)
       ),
       it as (
         select x.*, (select i.id from sm_discovery_items i where i.org_id = $1 and i.connector_id = $2 and i.deleted_at is null and i.external_id = x.external_id) as item_id
         from x
       )
       insert into sm_discovery_problems as p (id, org_id, connector_id, item_id, problem_key, fingerprint, severity, availability, message, opened_at, last_seen_at,
         sent_firing, sent_clear, sent_seq, origin)
       select gen_random_uuid(), $1, $2, it.item_id, it.key, 'disc:' || $2 || ':' || it.key, it.severity, it.availability, it.message, coalesce(it.since, $4), $4, false, false, 0, $5
       from it
       on conflict (org_id, connector_id, problem_key) where deleted_at is null do update set
         item_id = coalesce(excluded.item_id, p.item_id),
         last_seen_at = excluded.last_seen_at,
         message = excluded.message,
         availability = excluded.availability,
         sent_seq = case when p.cleared_at is not null or p.severity is distinct from excluded.severity then p.sent_seq + 1 else p.sent_seq end,
         sent_firing = case when p.cleared_at is not null or p.severity is distinct from excluded.severity then false else p.sent_firing end,
         sent_clear = case when p.cleared_at is not null then false else p.sent_clear end,
         opened_at = case when p.cleared_at is not null then excluded.opened_at else p.opened_at end,
         cleared_at = null,
         severity = excluded.severity,
         updated_at = now()
       returning (xmax = 0) as inserted, false as reopened`,
      [orgId, connectorId, JSON.stringify(rows.slice(i, i + 1000)), seenAt.toISOString(), origin],
    );
    opened += r.filter((x) => x.inserted).length;
  }
  return { opened };
}

/** After the tool's complete open set: problems it no longer reports (not seen since `seenAt`) are cleared. */
export async function clearVanished(q: Queryable, orgId: string, connectorId: string, seenAt: Date): Promise<number> {
  const r = await q.query(
    `update sm_discovery_problems set cleared_at = now(), updated_at = now()
     where org_id = $1 and connector_id = $2 and deleted_at is null and cleared_at is null and last_seen_at < $3 returning id`,
    [orgId, connectorId, seenAt.toISOString()],
  );
  return r.length;
}

/** The connector's event source, made on first need (kind generic, no key: only the module sends to it). */
export async function ensureEventSource(sys: Ctx, conn: Row): Promise<SourceRow | null> {
  const org = sys.org.id;
  const load = (id: string) =>
    sys.db.one<SourceRow>(
      `select id, org_id, name, kind, active, mapping, severity_map, default_severity, rate_limit, assignment_group_id, service_id
       from sm_event_sources where org_id = $1 and id = $2 and deleted_at is null`,
      [org, id],
    );
  if (conn.event_source_id) {
    const src = await load(String(conn.event_source_id));
    if (src) return src;
  }
  const id = await sys.write(async (tx) => {
    const cur = await tx.one<{ event_source_id: string | null }>(`select event_source_id from sm_discovery_connectors where org_id = $1 and id = $2 for update`, [org, conn.id]);
    if (cur?.event_source_id && (await tx.one(`select 1 from sm_event_sources where org_id = $1 and id = $2 and deleted_at is null`, [org, cur.event_source_id]))) return cur.event_source_id;
    const made = await createIn(tx, sys, "event_source", {
      name: `منبع داده «${String(conn.name ?? "").slice(0, 100)}»`, kind: "generic", active: true,
      description: "مشکل‌های گزارش‌شدهٔ این منبع داده از این‌جا به مدیریت رویداد می‌رسد؛ کلید عمومی ندارد",
    }, { trusted: true });
    // bookkeeping of the module (no history line: the connector's history keeps people's changes)
    await tx.query(`update sm_discovery_connectors set event_source_id = $3 where org_id = $1 and id = $2`, [org, conn.id, made.id]);
    return String(made.id);
  });
  conn.event_source_id = id;
  return load(id);
}

/** Events sent per source within the current minute (this process; the leader ticks on the server edition). */
const paced = new Map<string, { start: number; count: number }>();
export const resetProblemPacing = () => paced.clear();

/** How many events may still go to the source this minute, and when the window ends. */
function allowance(src: SourceRow, now: number): { left: number; resetAt: number } {
  const per = Math.max(1, Math.floor((Number(src.rate_limit) || DEFAULT_RATE) * RATE_SHARE));
  const w = paced.get(src.id);
  if (!w || now - w.start >= 60_000) return { left: per, resetAt: now + 60_000 };
  return { left: Math.max(0, per - w.count), resetAt: w.start + 60_000 };
}

function spend(src: SourceRow, now: number, n: number): void {
  const w = paced.get(src.id);
  if (!w || now - w.start >= 60_000) paced.set(src.id, { start: now, count: n });
  else w.count += n;
}

export interface SendResult {
  sent: number;
  /** rows still waiting */
  left: number;
  /** come back after this many ms (the rate window), when rows wait */
  again: number | null;
}

/**
 * Send what event management has not received yet: firings of open problems, clears of problems that fired — in
 * chunks of ≤ 100, within half the source's rate per minute. A problem that cleared before it was ever sent needs no
 * clear. Stops at the deadline or on a 429; unsent rows wait for the next call.
 */
export async function sendProblems(sys: Ctx, conn: Row, opts: { deadline?: number; now?: () => number } = {}): Promise<SendResult> {
  const org = sys.org.id;
  const clock = opts.now ?? (() => Date.now());
  await sys.db.query(
    `update sm_discovery_problems set sent_clear = true, updated_at = now()
     where org_id = $1 and connector_id = $2 and deleted_at is null and cleared_at is not null and not sent_firing and not sent_clear`,
    [org, conn.id],
  );
  const waiting = async () =>
    Number((await sys.db.one<{ n: number }>(
      `select count(*)::int as n from sm_discovery_problems where org_id = $1 and connector_id = $2 and deleted_at is null
         and ((cleared_at is null and not sent_firing) or (cleared_at is not null and sent_firing and not sent_clear))`,
      [org, conn.id],
    ))?.n ?? 0);
  if (!(await waiting())) return { sent: 0, left: 0, again: null };
  const src = await ensureEventSource(sys, conn);
  if (!src || !src.active) return { sent: 0, left: await waiting(), again: null };
  let sent = 0;
  for (;;) {
    if (opts.deadline && Date.now() >= opts.deadline - 500) break;
    const { left, resetAt } = allowance(src, clock());
    if (left <= 0) {
      const rest = await waiting();
      return { sent, left: rest, again: rest ? Math.max(1000, resetAt - clock()) : null };
    }
    const rows = await sys.db.query<Row>(
      `select p.id, p.problem_key, p.severity, p.availability, p.message, p.opened_at, p.cleared_at, p.sent_seq, i.name as item_name, i.data->>'hostname' as hostname, i.ci_id
       from sm_discovery_problems p left join sm_discovery_items i on i.org_id = p.org_id and i.id = p.item_id and i.deleted_at is null
       where p.org_id = $1 and p.connector_id = $2 and p.deleted_at is null
         and ((p.cleared_at is null and not p.sent_firing) or (p.cleared_at is not null and p.sent_firing and not p.sent_clear))
       order by p.opened_at, p.id limit $3`,
      [org, conn.id, Math.min(PROBLEM_CHUNK, left)],
    );
    if (!rows.length) break;
    const events = rows.map((r) => {
      const status = r.cleared_at ? "resolved" : "firing";
      return {
        message: r.message || `مشکل ${r.problem_key} در «${conn.name}»`,
        node: r.hostname || r.item_name || null,
        severity: r.severity,
        status,
        fingerprint: fingerprintOf(conn.id, r.problem_key),
        dedupe_key: dedupeKeyOf(conn.id, r.problem_key, status, Number(r.sent_seq ?? 0)),
        ci: r.ci_id ?? null,
        tags: [`discovery=${conn.kind}`, ...(r.availability ? [AVAILABILITY_TAG] : [])],
        occurred_at: new Date(r.cleared_at ?? r.opened_at).toISOString(),
      };
    });
    try {
      await ingest(sys.cfg, src, { events });
    } catch (e) {
      if (e instanceof AppError && e.status === 429) {
        const rest = await waiting();
        return { sent, left: rest, again: 60_000 };
      }
      throw e;
    }
    spend(src, clock(), events.length);
    sent += events.length;
    const firing = rows.filter((r) => !r.cleared_at).map((r) => String(r.id));
    const clears = rows.filter((r) => r.cleared_at).map((r) => String(r.id));
    if (firing.length) await sys.db.query(`update sm_discovery_problems set sent_firing = true, updated_at = now() where org_id = $1 and id = any($2::uuid[])`, [org, pgArray(firing)]);
    if (clears.length) await sys.db.query(`update sm_discovery_problems set sent_clear = true, updated_at = now() where org_id = $1 and id = any($2::uuid[])`, [org, pgArray(clears)]);
  }
  const rest = await waiting();
  return { sent, left: rest, again: rest ? 60_000 : null };
}
