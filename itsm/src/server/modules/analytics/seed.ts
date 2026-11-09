// Day-one defaults of analytics for an organisation (Persian, idempotent):
//   · the settings row (analytics_config) — it also records that the defaults were added (`seeded`)
//   · the ITSM KPI library (MTTA, MTTR, first-contact resolution, reopen rate, SLA compliance, backlog and its ageing,
//     change success, emergency share, change-caused incidents, request fulfilment time, CSAT…) — only the indicators
//     whose tables and fields exist in this organisation's schema at seed time (`libraryFor`): a module that is not
//     installed contributes nothing, and a later «افزودن پیش‌فرض‌ها» adds what a newly installed module enables
//   · «داشبورد میز خدمت» and «داشبورد مدیریت تغییر» (when their tables exist), shared with the roles that work there
//     (view) and the managers who curate them (edit); their indicator widgets resolved to the seeded indicators
// Stored scores of the org-wide library indicators are readable only by the roles the library names (`score_roles`);
// every live number is computed with the viewer's own access. Every item is created only when no live row with its
// natural key exists (indicators by `key`, dashboards by `library_key`); once the defaults were added a second run
// adds nothing unless forced.
import { dashboardsFor, libraryFor, type LibraryDashboard } from "@shared/analytics/library";
import type { Share, Widget } from "@shared/analytics/types";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgSchema, updateIn } from "../../engine";
import { eqAll, liveRows, sysOf, type Row } from "./common";

/**
 * 2: the DORA metrics, release/project KPIs and the «انتشار و دواپس» dashboard (release module installed).
 * 3: the event (alert MTTA/MTTR, noise, on-call load), continuity (availability against target, unplanned downtime),
 *    ITAM (stock below reorder, licence compliance), supplier (contracts expiring) and financial (budget against
 *    actual — scores only for holders of the «مالی» field group) indicators, each only when its module is installed.
 */
export const ANALYTICS_SEED_VERSION = 3;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

/** Who curates a seeded dashboard besides its readers (edit right). */
const CURATORS: Record<string, string[]> = {
  service_desk: ["service_desk_manager", "tenant_admin"],
  change_management: ["change_manager", "tenant_admin"],
  release_devops: ["release_manager", "tenant_admin"],
};

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<{ row: Row; created: boolean }> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return { row: found, created: false };
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return { row, created: true };
}

/** The roles of a seeded dashboard as sharing entries: readers view, curators edit. */
export function seededShares(d: Pick<LibraryDashboard, "key" | "shares">): Share[] {
  const curators = CURATORS[d.key] ?? ["tenant_admin"];
  const out: Share[] = curators.map((id) => ({ kind: "role", id, right: "edit" }));
  for (const s of d.shares) if (!out.some((x) => x.kind === s.kind && x.id === s.id)) out.push({ ...s, right: "view" });
  return out;
}

/** A seeded layout with its indicator keys resolved to this organisation's indicators (unknown ones dropped). */
export function resolveLayout(widgets: Widget[], ids: Map<string, string>): Widget[] {
  const out: Widget[] = [];
  for (const w of widgets) {
    if (w.kind === "indicator") {
      const id = w.indicator_key ? ids.get(w.indicator_key) : null;
      if (!id) continue;
      out.push({ ...w, indicator_id: id });
      continue;
    }
    if (w.kind === "scorecard") {
      const keys = (w.indicator_keys ?? []).filter((k) => ids.has(k));
      if (!keys.length) continue;
      out.push({ ...w, indicator_keys: keys, indicator_ids: keys.map((k) => ids.get(k)!) });
      continue;
    }
    out.push(w);
  }
  return out;
}

/** Add the defaults inside `tx` as the system. */
export async function seedAnalyticsDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "analytics_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= ANALYTICS_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "analytics_config", { config_key: "default" }, { name: "تنظیمات گزارش‌ها" })).row;

  const schema = await orgSchema(sys, tx);
  const ids = new Map<string, string>();
  for (const k of libraryFor(schema.lookup)) {
    const { score_roles, collect, requires: _requires, ...def } = k;
    const { row } = await ensure(tx, sys, out, "analytics_indicator", { key: k.key }, {
      name: def.name,
      description: def.description ?? null,
      practice: def.practice,
      unit: def.unit,
      direction: def.direction,
      grain: def.grain,
      formula: def.formula,
      parts: def.parts,
      breakdowns: def.breakdowns ?? [],
      target: def.target ?? null,
      warn: def.warn ?? null,
      crit: def.crit ?? null,
      decimals: def.decimals ?? null,
      collect,
      active: true,
      certified: true,
      library_key: k.key,
      score_shares: score_roles.map((id) => ({ kind: "role", id, right: "view" })),
    });
    ids.set(k.key, String(row.id));
  }
  // indicators the organisation already had under a library key (seeded earlier, or made by hand) are used too
  for (const r of await liveRows(tx, sys, "analytics_indicator", { f: "key", op: "nempty" }, { limit: 500 })) if (!ids.has(String(r.key))) ids.set(String(r.key), String(r.id));

  for (const d of dashboardsFor(schema.lookup)) {
    await ensure(tx, sys, out, "analytics_dashboard", { library_key: d.key }, {
      name: d.name,
      description: d.description,
      status: "published",
      folder: "داشبوردهای آماده",
      is_home: d.is_home,
      certified: true,
      layout: { ...d.layout, widgets: resolveLayout(d.layout.widgets, ids) },
      filters: d.filters,
      shares: seededShares(d),
      tv_cycle: 20,
      refresh_minutes: 5,
    });
  }

  await updateIn(tx, sys, "analytics_config", config.id, { seeded: ANALYTICS_SEED_VERSION }, { trusted: true });
  return out;
}
