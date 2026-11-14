// Fields people and ITAM own (design A §8.3). A tool's view of a machine whose CI is linked to an asset may differ from
// what the asset register holds. Discovery never writes the asset: each difference becomes a mismatch on the item — the
// reconciliation queue's «ناهمخوانی» tab — for the asset manager to settle:
//   · a CI field the engine skipped (locked, set by hand, ITAM's — `syncCi` stamps the values the asset decides, §8.3 b —
//     or held by a stronger source) on a CI linked to an asset;
//   · a reported user who resolves to a member other than the asset's holder (`assigned_to`);
//   · a reported location or site that resolves to a place outside the asset's — neither it, one of its ancestors nor
//     one of its descendants (a site above the asset's room is no contradiction);
//   · a reported asset tag, or a serial, that differs from the asset's.
// Values that resolve to nobody and nothing stay hints in the CI's `attrs.reported_*` only. The item keeps
// `{ fingerprint, entries, at, notified? }` in `mismatch` and `mismatch_state` none/open/dismissed: «نادیده گرفتن»
// holds until the reported values change (the fingerprint, over fields and reported values); «به‌روزرسانی دارایی با
// مقدار ابزار» is a normal asset write as the person, under their rights. A daily digest tells the asset managers and
// the connector's owner «… ناهمخوانی تازه میان ابزارها و دفتر اموال».
// Every write here is bookkeeping of a non-synced table (set-based SQL); the runner calls `recordMismatches` inside each
// engine call's own transaction, so the queue moves with the CI.
import { createHash } from "node:crypto";
import { normalizeIdent } from "@shared/cmdb/logic";
import { ciValues } from "@shared/discovery/mapping";
import type { DiscoveredRecord } from "@shared/discovery/types";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { condEnv, loadReadable, orgSchema, update } from "../../engine";
import { notifyPeople } from "../notify";
import { bad, forbidden, notFound } from "../../http/errors";
import { access } from "../../access/provider";
import { isCmdbAdmin } from "../cmdb/common";

type Row = Record<string, any>;

/** Where the differing value is held: the asset (its holder, place, tag, serial) or the CI (a field the engine skipped). */
export type MismatchTarget = "asset" | "ci";

export interface MismatchEntry {
  /** the asset field (assigned_to, location_id, asset_tag, serial_number) or the CI field / `attrs.<key>` skipped */
  field: string;
  target: MismatchTarget;
  /** the Persian name of the field */
  label: string;
  /** what the tool reported, as it reported it */
  reported: string | number | boolean | null;
  /** the member or location the reported value resolves to (holder and place) */
  resolved?: string | null;
  /** what the asset (or the CI) holds */
  held: string | number | boolean | null;
}

export interface MismatchData {
  /** over fields and reported values: «نادیده گرفتن» holds while it stays */
  fingerprint: string;
  entries: MismatchEntry[];
  /** when this set of differences first appeared */
  at: string;
  /** when the daily digest told of it */
  notified?: string;
}

export const MISMATCH_LABELS: Record<string, string> = {
  assigned_to: "تحویل‌گیرنده",
  location_id: "مکان",
  asset_tag: "برچسب اموال",
  serial_number: "شمارهٔ سریال",
};

/** Asset fields a person may set from the tool's value («به‌روزرسانی دارایی با مقدار ابزار»). */
export const APPLICABLE_FIELDS = new Set(["assigned_to", "location_id", "asset_tag", "serial_number"]);

/** One item as the engine left it: its CI, the record it reported, the fields the engine skipped and what was sent. */
export interface MismatchInput {
  itemId: string;
  /** the CI the item is linked to (null: not linked — no mismatch) */
  ciId: string | null;
  record: DiscoveredRecord;
  /** the engine's `skipped` fields of this item's update */
  skipped?: string[];
  /** what the engine was sent (the item's CI values and class attributes) */
  sent?: { values?: Record<string, unknown> | null; attrs?: Record<string, unknown> | null };
}

const ciLabel = (field: string): string => {
  if (field.startsWith("attrs.")) return `ویژگی «${field.slice(6)}»`;
  return tableDef("ci")?.fields.find((f) => f.name === field)?.label ?? field;
};

const plain = (v: unknown): string | number | boolean | null =>
  v === undefined || v === null ? null : typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v).slice(0, 300);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** «DOMAIN\login», «login@domain» or «login» → the forms a member may be known by. */
function loginForms(raw: string): { email: string | null; login: string } {
  const s = raw.trim().toLowerCase();
  const login = (s.includes("\\") ? s.slice(s.lastIndexOf("\\") + 1) : s).split("@")[0];
  return { email: s.includes("@") ? s : null, login };
}

/** Members a reported user names: an exact e-mail first, else a unique login (the part of the e-mail before @). */
async function resolveUsers(q: Queryable, orgId: string, reported: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!reported.length) return out;
  const forms = reported.map((r) => ({ r, ...loginForms(r) }));
  const rows = await q.query<{ id: string; email: string }>(
    `select u.id, lower(u.email) as email from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.deleted_at is null and m.is_active and not u.disabled
       and (lower(u.email) = any($2::text[]) or split_part(lower(u.email), '@', 1) = any($3::text[]))`,
    [orgId, pgArray(forms.map((f) => f.email).filter((x): x is string => !!x)), pgArray(forms.map((f) => f.login).filter(Boolean))],
  );
  for (const f of forms) {
    const exact = f.email ? rows.find((r) => r.email === f.email) : undefined;
    const byLogin = rows.filter((r) => r.email.split("@")[0] === f.login);
    const id = exact?.id ?? (byLogin.length === 1 ? byLogin[0].id : undefined);
    if (id) out.set(f.r, id);
  }
  return out;
}

/** Locations a reported place names: by code, else by a unique name (case and Persian letter forms aside). */
async function resolvePlaces(q: Queryable, orgId: string, reported: string[]): Promise<Map<string, { id: string; path: string }>> {
  const out = new Map<string, { id: string; path: string }>();
  if (!reported.length) return out;
  const key = (s: string) => s.trim().toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ");
  const keys = [...new Set(reported.map(key))];
  const rows = await q.query<{ id: string; code: string | null; name: string; path: string | null }>(
    `select id, lower(code) as code, name, path from sm_locations
     where org_id = $1 and deleted_at is null and (lower(code) = any($2::text[]) or lower(replace(replace(replace(name, 'ي', 'ی'), 'ى', 'ی'), 'ك', 'ک')) = any($2::text[]))`,
    [orgId, pgArray(keys)],
  );
  for (const r of reported) {
    const k = key(r);
    const byCode = rows.filter((x) => x.code === k);
    const byName = rows.filter((x) => key(x.name) === k);
    const hit = byCode.length === 1 ? byCode[0] : byCode.length === 0 && byName.length === 1 ? byName[0] : null;
    if (hit) out.set(r, { id: hit.id, path: hit.path ?? `/${hit.id}/` });
  }
  return out;
}

/** The fingerprint of a set of differences: fields and reported values only (what «نادیده گرفتن» waits on). */
export function mismatchFingerprint(entries: MismatchEntry[]): string {
  const material = entries.map((e) => [e.target, e.field, e.reported]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 32);
}

/** The differences of each item (linked items whose CI is linked to an asset; others have none). */
export async function computeMismatches(q: Queryable, orgId: string, inputs: MismatchInput[]): Promise<Map<string, MismatchEntry[]>> {
  const out = new Map<string, MismatchEntry[]>();
  for (const i of inputs) out.set(i.itemId, []);
  const linked = inputs.filter((i) => i.ciId);
  if (!linked.length) return out;
  const assets = await q.query<Row>(
    `select a.id, a.ci_id, a.assigned_to, a.location_id, a.asset_tag, a.serial_number, l.path as location_path
     from sm_assets a left join sm_locations l on l.org_id = a.org_id and l.id = a.location_id
     where a.org_id = $1 and a.deleted_at is null and a.ci_id = any($2::uuid[])`,
    [orgId, pgArray([...new Set(linked.map((i) => i.ciId!))])],
  );
  const assetOf = new Map<string, Row>();
  for (const a of assets) if (!assetOf.has(a.ci_id)) assetOf.set(a.ci_id, a);
  const withAsset = linked.filter((i) => assetOf.has(i.ciId!));
  if (!withAsset.length) return out;
  const users = await resolveUsers(q, orgId, [...new Set(withAsset.map((i) => i.record.reported?.user).filter((x): x is string => !!x))]);
  const places = await resolvePlaces(q, orgId, [...new Set(withAsset.flatMap((i) => [i.record.reported?.location, i.record.reported?.site]).filter((x): x is string => !!x))]);
  const skippedCis = [...new Set(withAsset.filter((i) => i.skipped?.length).map((i) => i.ciId!))];
  const cis = new Map(
    skippedCis.length ? (await q.query<{ id: string; row: Row }>(`select t.id, to_jsonb(t) as row from sm_cis t where t.org_id = $1 and t.id = any($2::uuid[])`, [orgId, pgArray(skippedCis)])).map((r) => [r.id, r.row]) : [],
  );
  for (const i of withAsset) {
    const a = assetOf.get(i.ciId!)!;
    const entries: MismatchEntry[] = [];
    const r = i.record;
    // the holder
    const user = r.reported?.user;
    const member = user ? users.get(user) : undefined;
    if (user && member && member !== a.assigned_to) entries.push({ field: "assigned_to", target: "asset", label: MISMATCH_LABELS.assigned_to, reported: user, resolved: member, held: a.assigned_to ?? null });
    // the place: the most specific reported value that resolves decides
    const placeRaw = [r.reported?.location, r.reported?.site].find((x) => !!x && places.has(x));
    const place = placeRaw ? places.get(placeRaw)! : undefined;
    if (placeRaw && place) {
      const assetPath = String(a.location_path ?? "");
      const lineage = !!a.location_id && (place.id === a.location_id || assetPath.includes(`/${place.id}/`) || place.path.includes(`/${a.location_id}/`));
      if (!lineage) entries.push({ field: "location_id", target: "asset", label: MISMATCH_LABELS.location_id, reported: placeRaw, resolved: place.id, held: a.location_id ?? null });
    }
    // the tag and the serial (compared as identification compares them)
    const tag = r.reported?.asset_tag;
    if (tag && normalizeIdent("asset_tag", tag) && normalizeIdent("asset_tag", tag) !== normalizeIdent("asset_tag", a.asset_tag)) {
      entries.push({ field: "asset_tag", target: "asset", label: MISMATCH_LABELS.asset_tag, reported: tag, held: a.asset_tag ?? null });
    }
    const serial = r.serial_number;
    if (serial && a.serial_number && normalizeIdent("serial_number", serial) && normalizeIdent("serial_number", serial) !== normalizeIdent("serial_number", a.serial_number)) {
      entries.push({ field: "serial_number", target: "asset", label: MISMATCH_LABELS.serial_number, reported: serial, held: a.serial_number });
    }
    // CI fields the engine skipped (the asset's own fields above already say it)
    const ci = cis.get(i.ciId!);
    for (const f of i.skipped ?? []) {
      if (entries.some((e) => e.field === f)) continue;
      const attr = f.startsWith("attrs.") ? f.slice(6) : null;
      const reported = attr ? i.sent?.attrs?.[attr] : i.sent?.values?.[f];
      const held = attr ? (ci?.attrs as Row | undefined)?.[attr] : ci?.[f];
      if (reported === undefined || same(reported, held)) continue;
      entries.push({ field: f, target: "ci", label: ciLabel(f), reported: plain(reported), held: plain(held) });
    }
    out.set(i.itemId, entries);
  }
  return out;
}

/**
 * Store the items' differences (set-based): none → `none`; differences → `open`, unless a person dismissed the same
 * ones (the fingerprint) — then they stay dismissed. The first appearance (`at`) and the digest's stamp stay while the
 * fingerprint does.
 */
export async function storeMismatches(q: Queryable, orgId: string, found: Map<string, MismatchEntry[]>): Promise<void> {
  if (!found.size) return;
  const rows = [...found].map(([id, entries]) => ({ id, fp: entries.length ? mismatchFingerprint(entries) : null, entries: entries.length ? entries : null }));
  await q.query(
    `update sm_discovery_items t set
       mismatch = case when x.entries is null then null
                       when t.mismatch ->> 'fingerprint' = x.fp then t.mismatch || jsonb_build_object('entries', x.entries)
                       else jsonb_build_object('fingerprint', x.fp, 'entries', x.entries, 'at', now()) end,
       mismatch_state = case when x.entries is null then 'none'
                             when t.mismatch_state = 'dismissed' and t.mismatch ->> 'fingerprint' = x.fp then 'dismissed'
                             else 'open' end,
       updated_at = now()
     from jsonb_to_recordset($2::jsonb) as x(id uuid, fp text, entries jsonb)
     where t.org_id = $1 and t.id = x.id
       and (t.mismatch is distinct from null or x.entries is not null or t.mismatch_state is distinct from 'none')`,
    [orgId, JSON.stringify(rows)],
  );
}

/** Compute and store in one go (the runner, after each engine call, inside its transaction). */
export async function recordMismatches(q: Queryable, orgId: string, inputs: MismatchInput[]): Promise<void> {
  if (!inputs.length) return;
  await storeMismatches(q, orgId, await computeMismatches(q, orgId, inputs));
}

/** The CI fields and class attributes the engine is sent for a stored record (what a refresh sends). */
function sentOf(record: DiscoveredRecord): MismatchInput["sent"] {
  const { values, attrs } = ciValues(record);
  return { values, attrs };
}

/**
 * Look again at a connector's items with differences (open or dismissed) against what the asset and the CI hold now
 * (a person may have settled them by hand): the daily ladder's pass. Fields the engine skipped are taken from the
 * stored differences.
 */
export async function refreshMismatches(q: Queryable, orgId: string, connectorId: string, limit = 5000): Promise<number> {
  const items = await q.query<Row>(
    `select id, ci_id, data, mismatch from sm_discovery_items
     where org_id = $1 and connector_id = $2 and deleted_at is null and mismatch_state in ('open', 'dismissed') order by id limit $3`,
    [orgId, connectorId, limit],
  );
  if (!items.length) return 0;
  const inputs: MismatchInput[] = items.map((it) => {
    const record = (it.data ?? {}) as DiscoveredRecord;
    const skipped = ((it.mismatch?.entries ?? []) as MismatchEntry[]).filter((e) => e.target === "ci").map((e) => e.field);
    return { itemId: it.id, ciId: it.ci_id ?? null, record, skipped, sent: sentOf(record) };
  });
  await recordMismatches(q, orgId, inputs);
  return items.length;
}

// ---------------------------------------------------------------------------------------------------------------
// The queue's actions (routes: DA1 part 3)

async function itemFor(q: Queryable, orgId: string, itemId: string): Promise<Row> {
  const it = await q.one<Row>(`select id, connector_id, ci_id, data, mismatch, mismatch_state from sm_discovery_items where org_id = $1 and id = $2::uuid and deleted_at is null`, [orgId, itemId]);
  if (!it) throw notFound("مورد منبع داده پیدا نشد");
  return it;
}

/** The asset of the item's CI as the person reads it, and whether they may change it. */
async function assetAsPerson(ctx: Ctx, ciId: string | null): Promise<{ row: Row | null; writable: boolean }> {
  if (!ciId) return { row: null, writable: false };
  const a = await ctx.db.one<{ id: string }>(`select id from sm_assets where org_id = $1 and ci_id = $2::uuid and deleted_at is null limit 1`, [ctx.org.id, ciId]);
  if (!a) return { row: null, writable: false };
  const schema = await orgSchema(ctx);
  const def = schema.def("asset")!;
  const row = await loadReadable(ctx.db, ctx, def, a.id, await condEnv(ctx));
  return { row, writable: !!row && access().canWrite(ctx, def, row) && row.$writable !== false };
}

/** Who may settle an item's differences: a CMDB administrator, or a person who may change the asset (§14.5). */
async function needSettler(ctx: Ctx, it: Row): Promise<{ row: Row | null; writable: boolean }> {
  const asset = await assetAsPerson(ctx, it.ci_id ?? null);
  if (asset.writable || (await isCmdbAdmin(ctx))) return asset;
  throw forbidden("ناهمخوانی‌های این دستگاه را مدیر دارایی آن یا مدیر پیکربندی رسیدگی می‌کند");
}

/** «نادیده گرفتن»: the item's current differences are not offered again until the reported values change. */
export async function dismissMismatch(ctx: Ctx, itemId: string): Promise<{ state: string }> {
  const it = await itemFor(ctx.db, ctx.org.id, itemId);
  await needSettler(ctx, it);
  if (it.mismatch_state !== "open") throw bad("این مورد ناهمخوانی بازی ندارد");
  await ctx.db.query(`update sm_discovery_items set mismatch_state = 'dismissed', updated_at = now() where org_id = $1 and id = $2 and mismatch_state = 'open'`, [ctx.org.id, itemId]);
  return { state: "dismissed" };
}

/**
 * «به‌روزرسانی دارایی با مقدار ابزار»: the asset takes the tool's value of one field — a normal write of the asset as the
 * person, under their rights (the asset's own rules and its CI sync follow) — then the item's differences are looked at
 * again.
 */
export async function applyMismatch(ctx: Ctx, itemId: string, field: string): Promise<{ applied: string; asset_id: string }> {
  const it = await itemFor(ctx.db, ctx.org.id, itemId);
  const entry = ((it.mismatch?.entries ?? []) as MismatchEntry[]).find((e) => e.field === field && e.target === "asset");
  if (!entry || !APPLICABLE_FIELDS.has(field) || it.mismatch_state === "none") throw bad("این ناهمخوانی در دارایی اعمال‌شدنی نیست");
  const asset = await needSettler(ctx, it);
  if (!asset.row) throw notFound("دارایی این دستگاه پیدا نشد");
  if (!asset.writable) throw forbidden("اجازهٔ تغییر این دارایی را ندارید");
  const value = field === "assigned_to" || field === "location_id" ? entry.resolved ?? null : entry.reported;
  if (value === null || value === undefined || value === "") throw bad("مقدار ابزار به عضو یا مکانی در کاریز نرسید");
  await update(ctx, "asset", asset.row.id, { [field]: value });
  const record = (it.data ?? {}) as DiscoveredRecord;
  const skipped = ((it.mismatch?.entries ?? []) as MismatchEntry[]).filter((e) => e.target === "ci").map((e) => e.field);
  await recordMismatches(ctx.db, ctx.org.id, [{ itemId, ciId: it.ci_id ?? null, record, skipped, sent: sentOf(record) }]);
  return { applied: field, asset_id: asset.row.id };
}

// ---------------------------------------------------------------------------------------------------------------
// The daily digest

const faNum = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/**
 * The asset managers of assets (design A §8.3, §10): each asset's `managed_by` and the members of its
 * `managed_by_group_id`, by asset.
 */
export async function assetManagers(q: Queryable, orgId: string, assetIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await q.query<{ id: string; users: string[] | null }>(
    `select a.id, array_remove(array_cat(array[a.managed_by],
              coalesce((select array_agg(gm.user_id) from sm_group_members gm where gm.org_id = a.org_id and gm.group_id = a.managed_by_group_id and gm.deleted_at is null), '{}'::uuid[])), null)::text[] as users
     from sm_assets a where a.org_id = $1 and a.id = any($2::uuid[]) and a.deleted_at is null`,
    [orgId, pgArray(ids)],
  );
  for (const r of rows) out.set(r.id, [...new Set(r.users ?? [])]);
  return out;
}

/**
 * «… ناهمخوانی تازه میان ابزارها و دفتر اموال» (daily, from the sweep): differences opened since the last digest are
 * stamped told — once, whatever the number of processes — and each connector's owner and the managers of the assets
 * concerned are told of that connector's (delivery checks that each may read the connector).
 */
export async function mismatchDigest(q: Queryable, orgId: string): Promise<number> {
  const fresh = await q.query<{ connector_id: string; asset_id: string | null }>(
    `with told as (
       update sm_discovery_items t set mismatch = t.mismatch || jsonb_build_object('notified', now())
       where t.org_id = $1 and t.deleted_at is null and t.mismatch_state = 'open' and t.mismatch is not null and not (t.mismatch ? 'notified')
       returning t.connector_id, t.ci_id
     )
     select told.connector_id, (select a.id from sm_assets a where a.org_id = $1 and a.ci_id = told.ci_id and a.deleted_at is null limit 1) as asset_id
     from told`,
    [orgId],
  );
  if (!fresh.length) return 0;
  const managers = await assetManagers(q, orgId, fresh.map((f) => f.asset_id).filter((x): x is string => !!x));
  const byConnector = new Map<string, { n: number; users: Set<string> }>();
  for (const f of fresh) {
    const x = byConnector.get(f.connector_id) ?? { n: 0, users: new Set<string>() };
    x.n++;
    for (const u of (f.asset_id && managers.get(f.asset_id)) || []) x.users.add(u);
    byConnector.set(f.connector_id, x);
  }
  for (const [connectorId, x] of byConnector) {
    const c = await q.one<{ name: string; owner_id: string | null }>(`select name, owner_id from sm_discovery_connectors where org_id = $1 and id = $2`, [orgId, connectorId]);
    if (!c) continue;
    if (c.owner_id) x.users.add(c.owner_id);
    if (!x.users.size) continue;
    const subject = `${faNum(x.n)} ناهمخوانی تازه میان ابزارها و دفتر اموال`;
    await notifyPeople(q, orgId, {
      table: "discovery_connector", id: connectorId, users: [...x.users], subject,
      body: `منبع دادهٔ «${c.name}» برای ${faNum(x.n)} دستگاه مقداری گزارش کرده است که با دفتر اموال یکی نیست. آن‌ها را در زبانهٔ «ناهمخوانی» صف آشتی ببینید؛ هیچ مقداری خودکار در دارایی نوشته نشده است.`,
      short_text: subject, label: "ناهمخوانی منبع داده", source: "منبع‌های داده",
    });
  }
  return fresh.length;
}
