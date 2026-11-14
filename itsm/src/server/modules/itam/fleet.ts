// Which discovered hardware waits for an asset — one rule for ITAM's own discovered-hardware step (assets.ts
// `discoveredStep` and «دارایی برای سخت‌افزار کشف‌شده», ITAM-002) and for a connector's asset feed «ساخت دارایی برای
// دستگاه‌های تازه» (discovery/itamfeed.ts, design A §11.1): live hardware of ITAM's classes that has no asset, never an
// ATM, CRS or kiosk. Monitoring tools report the bank fleet as plain devices (Zabbix and PRTG items are of kind
// `device`), so the fleet is told by what the CI carries, not by its class: neither path ever makes an «تأییدنشده» asset
// for one of the fleet's terminals.
import { FLEET_CATEGORIES } from "@shared/tables/itam";
import { pgArray, type Queryable } from "../../db";

/** The CMDB classes ITAM treats as hardware (an asset per CI). */
export const HW_CLASSES = ["laptop", "desktop", "server", "computer", "mobile_device", "printer", "network_device", "router", "switch", "firewall", "access_point", "storage", "ups"];

const literals = (xs: readonly string[]) =>
  xs
    .map((x) => {
      if (!/^[a-z_]+$/.test(x)) throw new Error(`unexpected class key ${x}`);
      return `'${x}'`;
    })
    .join(", ");

/**
 * A model as compared with the bank fleet's: lower case, Latin letters and digits only, Persian and Arabic digits as
 * Latin ones — «ان‌سی‌آر SelfServ 22e (خودپرداز)», "SelfServ 22e" and "SELFSERV-22E" give one key.
 */
const modelKey = (expr: string) => `regexp_replace(lower(translate(${expr}, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')), '[^a-z0-9]+', '', 'g')`;

/**
 * The CI `c` waits for an asset: live hardware (ITAM's classes) without one, never an ATM, CRS or kiosk. Monitoring
 * tools report those as plain devices, so any of these names one:
 *   · an item of kind `atm` links it (a connector's ATM rows: the switch's export, the push API);
 *   · it has a terminal id (an ATM's or a POS terminal's id in the switch, a class attribute): a bank terminal;
 *   · its model is one of `fleet` (fleetKeys, a text[] parameter): the model ITAM would give it (`assetsForDiscovered`
 *     finds it by the CI's model name, else «<class> نامشخص») by name in any case, or the tool's model by its key
 *     (modelKey) — the fleet model's name, its name without the bracketed kind, or its model number.
 * Each check is an index probe or a test of the row; `offset 0` keeps the planner from flattening the probes into joins
 * it would size without statistics (PGlite, a fresh load).
 */
export const ciWaits = (fleet: string) => `c.deleted_at is null and c.merged_into is null and c.class in (${literals(HW_CLASSES)})
  and coalesce(c.state, '') not in ('retired', 'disposed', 'canceled')
  and coalesce(c.attrs->>'terminal_id', '') = ''
  and lower(left(coalesce(nullif(c.model_name, ''), c.class || ' نامشخص'), 200)) <> all(${fleet}::text[])
  and ${modelKey("coalesce(c.model_name, '')")} <> all(${fleet}::text[])
  and not exists (select 1 from sm_assets a where a.org_id = c.org_id and a.ci_id = c.id and a.deleted_at is null offset 0)
  and not exists (select 1 from sm_discovery_items x where x.org_id = c.org_id and x.ci_id = c.id and x.kind = 'atm' and x.deleted_at is null offset 0)`;

/**
 * The bank fleet's models (ATM, CRS, kiosk) as ciWaits compares them: each name in lower case, and the keys (modelKey)
 * of its name, its name without the bracketed kind and its model number — keys of fewer than 3 characters say too
 * little (the «۲۱» of «کیوسک خدمات بانکی ۲۱ اینچ»). A CI whose model is one of them never gets an asset this way.
 */
export async function fleetKeys(q: Queryable, orgId: string): Promise<string[]> {
  const rows = await q.query<{ k: string }>(
    `with m as (select name, model_number from sm_asset_models where org_id = $1 and deleted_at is null and category = any($2::text[]))
     select lower(name) as k from m where coalesce(name, '') <> ''
     union
     select k from (select ${modelKey("v")} as k from m, lateral (values (name), (regexp_replace(name, '\\([^)]*\\)', '', 'g')), (model_number)) x(v) where v is not null) s
     where length(k) >= 3`,
    [orgId, pgArray(FLEET_CATEGORIES)],
  );
  return rows.map((r) => r.k);
}

/** The organisation's hardware CIs that wait for an asset (ciWaits), oldest first, at most `limit`: their ids. */
export async function waitingHardware(q: Queryable, orgId: string, limit: number): Promise<string[]> {
  const rows = await q.query<{ id: string }>(`select c.id from sm_cis c where c.org_id = $1 and ${ciWaits("$2")} order by c.created_at, c.no limit ${Math.max(0, Math.trunc(limit))}`, [
    orgId,
    pgArray(await fleetKeys(q, orgId)),
  ]);
  return rows.map((r) => String(r.id));
}
