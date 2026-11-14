// Staging (design A §7.3, §7.4): one set-based upsert per page into discovery_item, keyed by (connector, tool id), in
// an `internal` transaction — no write-admission slot and no organisation lock (raw SQL never asks for one). A page
// stamps every listed item: its listing time and generation (drives only «gone»), the tool's own last contact (never
// moved back), its status (DA2 aggregates it), its normalised record and its hash.
//
// THE WORK MARKER. An item waits for the reconciliation engine while `reconciled_at` is null: new items, items whose
// hash changed (the record, `config_version` or the kind's version), and items listed again after they were gone. An
// ignored item whose hash changes is offered again. The marker is durable — a killed worker loses nothing — and the
// runner clears it in the same transaction as the IRE's writes (runner.ts).
import { createHash } from "node:crypto";
import { recordState } from "@shared/discovery/availability";
import { hashMaterial } from "@shared/discovery/hash";
import type { DiscoveredRecord } from "@shared/discovery/types";
import { uuidv7 } from "@shared/id";
import type { Queryable } from "../../db";

/** The normalised record an item keeps (`data`, field group internal): without software, at most 32 KB. */
export const MAX_DATA_BYTES = 32 * 1024;

export function itemHash(record: DiscoveredRecord, configVersion: number, kindVersion: number): string {
  return createHash("sha256").update(hashMaterial(record, configVersion, kindVersion)).digest("hex");
}

/** What an item stores of its record: no software (staged apart, §11.2), bounded to 32 KB. */
export function itemData(record: DiscoveredRecord): Record<string, unknown> {
  const { software: _software, ...rest } = record;
  void _software;
  const fits = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8") <= MAX_DATA_BYTES;
  if (fits(rest)) return rest as Record<string, unknown>;
  const { attrs: _attrs, ...core } = rest;
  void _attrs;
  if (fits(core)) return { ...core, _truncated: true };
  const { external_id, kind, name, hostname, fqdn, serial_number, bios_uuid, terminal_id, class: cls } = record;
  return { external_id, kind, name, hostname, fqdn, serial_number, bios_uuid, terminal_id, class: cls, _truncated: true };
}

export interface StageInput {
  orgId: string;
  connectorId: string;
  generation: number;
  configVersion: number;
  kindVersion: number;
  /** normalised, one per tool id */
  records: DiscoveredRecord[];
  /** a deep link into the tool per record (the kind's `link`) */
  link?: (r: DiscoveredRecord) => string | null;
  origin: string;
}

export interface StageResult {
  staged: number;
  inserted: number;
  /** existing items whose hash changed */
  changed: number;
  /** existing items listed again after they were gone */
  relisted: number;
  /** existing items with the same hash (no IRE call unless a refresh or a retry is due) */
  unchanged: number;
}

/** Stage one page (set-based, lock-free). Idempotent: the same page again changes nothing but the stamps. */
export async function stagePage(q: Queryable, input: StageInput): Promise<StageResult> {
  if (!input.records.length) return { staged: 0, inserted: 0, changed: 0, relisted: 0, unchanged: 0 };
  const rows = input.records.map((r) => ({
    id: uuidv7(),
    external_id: r.external_id,
    kind: r.kind,
    name: String(r.name ?? r.external_id).slice(0, 200),
    hash: itemHash(r, input.configVersion, input.kindVersion),
    data: itemData(r),
    last_contact_at: r.last_contact_at ?? null,
    status: recordState(r.status),
    status_since: r.status?.since ?? null,
    status_message: r.status?.message?.slice(0, 500) ?? null,
    link_url: input.link?.(r)?.slice(0, 1000) ?? null,
  }));
  const r = await q.one<{ staged: number; inserted: number; changed: number; relisted: number }>(
    `with x as (
       select * from jsonb_to_recordset($1::jsonb) as x(id uuid, external_id text, kind text, name text, hash text, data jsonb,
         last_contact_at timestamptz, status text, status_since timestamptz, status_message text, link_url text)
     ),
     old as (
       select t.external_id, t.hash, t.state from sm_discovery_items t
       where t.org_id = $2 and t.connector_id = $3 and t.deleted_at is null and t.external_id in (select external_id from x)
     ),
     up as (
       insert into sm_discovery_items as t (id, org_id, connector_id, external_id, kind, name, hash, data, first_seen_at, listed_at,
         last_contact_at, seen_generation, status, status_since, status_message, link_url, mismatch_state, origin)
       select x.id, $2, $3, x.external_id, x.kind, x.name, x.hash, x.data, now(), now(), x.last_contact_at, $4, x.status,
         case when x.status is null then null else coalesce(x.status_since, now()) end, x.status_message, x.link_url, 'none', $5
       from x
       on conflict (org_id, connector_id, external_id) where deleted_at is null do update set
         kind = excluded.kind,
         name = excluded.name,
         data = excluded.data,
         link_url = excluded.link_url,
         listed_at = excluded.listed_at,
         seen_generation = excluded.seen_generation,
         last_contact_at = case when t.last_contact_at is null or excluded.last_contact_at > t.last_contact_at then excluded.last_contact_at else t.last_contact_at end,
         status = coalesce(excluded.status, t.status),
         status_since = case when excluded.status is null then t.status_since when excluded.status is distinct from t.status then excluded.status_since else t.status_since end,
         status_message = case when excluded.status is null then t.status_message else excluded.status_message end,
         reconciled_at = case when t.hash is distinct from excluded.hash or t.state = 'gone' then null else t.reconciled_at end,
         state = case when t.hash is distinct from excluded.hash and t.state = 'ignored' then null else t.state end,
         hash = excluded.hash,
         updated_at = now()
       returning t.external_id, (xmax = 0) as inserted
     )
     select count(*)::int as staged,
            count(*) filter (where up.inserted)::int as inserted,
            count(*) filter (where not up.inserted and old.hash is distinct from x.hash)::int as changed,
            count(*) filter (where not up.inserted and old.hash = x.hash and old.state = 'gone')::int as relisted
     from up join x on x.external_id = up.external_id left join old on old.external_id = up.external_id`,
    [JSON.stringify(rows), input.orgId, input.connectorId, input.generation, input.origin],
  );
  const staged = r?.staged ?? 0;
  const inserted = r?.inserted ?? 0;
  const changed = r?.changed ?? 0;
  const relisted = r?.relisted ?? 0;
  return { staged, inserted, changed, relisted, unchanged: staged - inserted - changed - relisted };
}

/** How many items of a connector wait for the reconciliation engine (bounded: `limit` + 1 at most). */
export async function pendingCount(q: Queryable, orgId: string, connectorId: string, limit = 2000): Promise<number> {
  const r = await q.one<{ n: number }>(
    `select count(*)::int as n from (select 1 from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null
       and reconciled_at is null and (state is null or state <> 'ignored') limit $3) p`,
    [orgId, connectorId, limit + 1],
  );
  return r?.n ?? 0;
}
