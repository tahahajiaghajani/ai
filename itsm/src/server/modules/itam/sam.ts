// Software asset management (catalogue ITAM-048/050/052/053/056/058/059/061/066): installations taken from the CMDB —
// the inventory collector reports installed programs as software CIs that «اجرا روی» their computer, so every live
// `runs_on` relationship from a software CI to a computer is an installation — normalised to software models by
// their patterns; the reconciliation run computing the effective licence position of every software model
// (`licensePosition`); the compliance view with true-up projections, unmatched names and restricted software.
// Discovery-made installs no source reports any more are marked removed. Everything here runs as the system except
// `compliance`, which reads with the caller's access (money only with the financial field group).
import type { Cond } from "@shared/model/conditions";
import type { Compliance, CompliancePosition, TrueUpRow } from "@shared/itam/api";
import { licensePosition, matchSoftware, positionTotals, trueUpProjection, type LicenseMetric, type PosAllocation, type PosEntitlement, type PosInstall } from "@shared/itam/logic";
import { builtinDescendants } from "@shared/cmdb/classes";
import { addDays, diffDays } from "@shared/jalali";
import type { Ctx } from "../../context";
import { forbidden } from "../../http/errors";
import { access } from "../../access/provider";
import { aggregate, createIn, defFor, emitEvent, list, updateIn } from "../../engine";
import { hasGroup, holds, isUuid, itamConfig, liveRow, liveRows, orgToday, sysOf, type Row } from "./common";

const COMPUTERS = new Set(builtinDescendants("computer").concat(["mobile_device"]));
const SOFTWARE = new Set(builtinDescendants("software"));
const BATCH = 200;

/** Installations from the CMDB's `runs_on` relationships (software CI → computer). */
export async function syncInstalls(sys: Ctx): Promise<{ seen: number; created: number; updated: number; removed: number; matched: number }> {
  const rels = await liveRows(sys.db, sys, "ci_rel", { and: [{ f: "type", op: "eq", v: "runs_on" }, { f: "valid_to", op: "empty" }] } as Cond, { limit: 100000 });
  const ciIds = [...new Set(rels.flatMap((r) => [String(r.parent_id), String(r.child_id)]))];
  const cis = new Map<string, Row>();
  for (let i = 0; i < ciIds.length; i += 500) {
    for (const c of await liveRows(sys.db, sys, "ci", { f: "id", op: "in", v: ciIds.slice(i, i + 500) } as Cond, { limit: 500 })) cis.set(String(c.id), c);
  }
  const pairs: { device: Row; app: Row }[] = [];
  for (const r of rels) {
    const app = cis.get(String(r.parent_id));
    const device = cis.get(String(r.child_id));
    if (!app || !device || !SOFTWARE.has(String(app.class)) || !COMPUTERS.has(String(device.class))) continue;
    if (["retired", "disposed", "canceled"].includes(String(device.state))) continue;
    pairs.push({ device, app });
  }
  const models = await liveRows(sys.db, sys, "software_model", null, { limit: 5000 });
  const existing = await liveRows(sys.db, sys, "software_install", { f: "source", op: "eq", v: "discovery" } as Cond, { limit: 200000 });
  const byKey = new Map(existing.map((x) => [`${x.ci_id}|${x.source_ci_id}`, x]));
  const seenKeys = new Set<string>();
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let matched = 0;
  for (let i = 0; i < pairs.length; i += BATCH) {
    await sys.write(async (tx) => {
      for (const { device, app } of pairs.slice(i, i + BATCH)) {
        const key = `${device.id}|${app.id}`;
        seenKeys.add(key);
        const publisher = String((app.attrs as Row | null)?.vendor ?? app.manufacturer ?? "") || null;
        const raw = { raw_name: String(app.name ?? "").slice(0, 300), raw_version: (app.sw_version as string) ?? null, raw_publisher: publisher };
        const hit = matchSoftware({ name: raw.raw_name, publisher }, models as never);
        if (hit) matched++;
        const found = byKey.get(key);
        if (!found) {
          await createIn(tx, sys, "software_install", { ci_id: device.id, source_ci_id: app.id, source: "discovery", ...raw, software_model_id: hit?.id ?? null, normalized_by: hit ? "rule" : "none", user_id: device.used_by ?? null, first_seen_at: now, last_seen_at: now, active: true }, { trusted: true });
          created++;
          continue;
        }
        const patch: Row = { last_seen_at: now };
        if (!found.active) Object.assign(patch, { active: true, removed_at: null });
        if (found.raw_name !== raw.raw_name || (found.raw_version ?? null) !== raw.raw_version) Object.assign(patch, raw);
        if (found.normalized_by !== "manual" && (found.software_model_id ?? null) !== (hit?.id ?? null)) Object.assign(patch, { software_model_id: hit?.id ?? null, normalized_by: hit ? "rule" : "none" });
        if ((found.user_id ?? null) !== (device.used_by ?? null)) patch.user_id = device.used_by ?? null;
        await updateIn(tx, sys, "software_install", found.id, patch, { trusted: true });
        updated++;
      }
    });
  }
  // installs no relationship reports any more
  const gone = existing.filter((x) => x.active && !seenKeys.has(`${x.ci_id}|${x.source_ci_id}`));
  for (let i = 0; i < gone.length; i += BATCH) {
    await sys.write(async (tx) => {
      for (const x of gone.slice(i, i + BATCH)) await updateIn(tx, sys, "software_install", x.id, { active: false, removed_at: now }, { trusted: true });
    });
  }
  return { seen: pairs.length, created, updated, removed: gone.length, matched };
}

/** Match every install that was not normalised by hand again (after a model's patterns changed). */
export async function renormalize(sys: Ctx): Promise<{ changed: number }> {
  const models = await liveRows(sys.db, sys, "software_model", null, { limit: 5000 });
  const installs = await liveRows(sys.db, sys, "software_install", { f: "normalized_by", op: "ne", v: "manual" } as Cond, { limit: 200000 });
  const changes: { id: string; model: string | null }[] = [];
  for (const x of installs) {
    const hit = matchSoftware({ name: String(x.raw_name ?? ""), publisher: x.raw_publisher ?? null }, models as never);
    if ((x.software_model_id ?? null) !== (hit?.id ?? null)) changes.push({ id: String(x.id), model: hit?.id ?? null });
  }
  for (let i = 0; i < changes.length; i += BATCH) {
    await sys.write(async (tx) => {
      for (const c of changes.slice(i, i + BATCH)) await updateIn(tx, sys, "software_install", c.id, { software_model_id: c.model, normalized_by: c.model ? "rule" : "none" }, { trusted: true });
    });
  }
  return { changed: changes.length };
}

/** One reconciliation run: the effective licence position of every software model with installs or entitlements. */
export async function reconcile(sys: Ctx, trigger: "manual" | "schedule" | "change" = "manual"): Promise<{ run_id: string; products: number; under_licensed: number }> {
  const today = orgToday(sys);
  const cfg = await itamConfig(sys.db, sys);
  const run = await sys.write((tx) => createIn(tx, sys, "license_reconcile_run", { status: "running", trigger, started_at: new Date().toISOString() }, { trusted: true }));
  try {
    const models = await liveRows(sys.db, sys, "software_model", null, { limit: 5000 });
    const ents = await liveRows(sys.db, sys, "license_entitlement", { f: "state", op: "in", v: ["active", "expired", "terminated"] } as Cond, { limit: 50000 });
    const installs = await liveRows(sys.db, sys, "software_install", { and: [{ f: "active", op: "eq", v: true }, { f: "software_model_id", op: "nempty" }] } as Cond, { limit: 500000 });
    const allocations = await liveRows(sys.db, sys, "license_allocation", { f: "active", op: "eq", v: true } as Cond, { limit: 200000 });
    const byModel = <T extends Row>(xs: T[], f: string) => {
      const m = new Map<string, T[]>();
      for (const x of xs) if (isUuid(x[f])) m.set(String(x[f]), [...(m.get(String(x[f])) ?? []), x]);
      return m;
    };
    const entsBy = byModel(ents, "software_model_id");
    const instBy = byModel(installs, "software_model_id");
    const entIds = new Map(ents.map((e) => [String(e.id), String(e.software_model_id)]));
    const allocBy = new Map<string, Row[]>();
    for (const a of allocations) {
      const m = entIds.get(String(a.entitlement_id));
      if (m) allocBy.set(m, [...(allocBy.get(m) ?? []), a]);
    }
    const positions: { model: Row; p: ReturnType<typeof licensePosition> }[] = [];
    for (const model of models) {
      const e = entsBy.get(String(model.id)) ?? [];
      const ins = instBy.get(String(model.id)) ?? [];
      if (!e.length && !ins.length) continue;
      const p = licensePosition({
        metric: (model.license_metric as LicenseMetric) ?? "per_device",
        list_price: model.list_price ?? 0,
        entitlements: e.map((x): PosEntitlement => ({ id: String(x.id), metric: x.metric as LicenseMetric, quantity: Number(x.quantity ?? 0), min_cores: x.min_cores, unit_cost: x.unit_cost, total_cost: x.total_cost, state: String(x.state), start_date: x.start_date, end_date: x.end_date, allocation_required: !!x.allocation_required })),
        installs: ins.map((x): PosInstall => ({ id: String(x.id), ci_id: String(x.ci_id), user_id: x.user_id ?? null, cores: x.cores ?? null, last_used_at: x.last_used_at ?? null, active: x.active !== false })),
        allocations: (allocBy.get(String(model.id)) ?? []).map((a): PosAllocation => ({ entitlement_id: String(a.entitlement_id), user_id: a.user_id, ci_id: a.ci_id, active: a.active !== false })),
        today,
        unusedDays: cfg.unused_days,
      });
      positions.push({ model, p });
    }
    for (let i = 0; i < positions.length; i += BATCH) {
      await sys.write(async (tx) => {
        for (const { model, p } of positions.slice(i, i + BATCH)) {
          await createIn(tx, sys, "license_position", {
            run_id: run.id, software_model_id: model.id, metric: p.metric, entitled: p.entitled, consumed: p.consumed, delta: p.delta, installs: p.installs, devices: p.devices,
            users: p.users, unused_installs: p.unused_installs, status: p.status, unit_price: p.unit_price, exposure: p.exposure, savings: p.savings, detail: { ...p.detail, reclaimable: p.reclaimable },
            label: String(model.name ?? "").slice(0, 300),
          }, { trusted: true });
        }
      });
    }
    const totals = positionTotals(positions.map((x) => x.p));
    await sys.write(async (tx) => {
      await updateIn(tx, sys, "license_reconcile_run", run.id, { status: "done", finished_at: new Date().toISOString(), products: totals.products, compliant: totals.compliant, under_licensed: totals.under_licensed, over_licensed: totals.over_licensed, exposure: totals.exposure, savings: totals.savings }, { trusted: true });
      if (cfg.id) await updateIn(tx, sys, "itam_config", cfg.id, { last_reconcile_at: new Date().toISOString() }, { trusted: true });
      const short = positions.filter((x) => x.p.status === "under_licensed" || x.p.status === "unlicensed");
      if (short.length) await emitEvent(tx, sys, { kind: "record.itam.license_shortfall", table: "license_reconcile_run", id: run.id, number: run.number ?? null, data: { users: [], products: short.map((x) => x.model.name).slice(0, 20), count: short.length, exposure: totals.exposure } });
    });
    // reclaim candidates: installs unused for the configured days (ITAM-061)
    const cutoff = addDays(today, -cfg.unused_days);
    const stale = installs.filter((x) => x.last_used_at && String(x.last_used_at).slice(0, 10) < cutoff && (!x.reclaim_state || x.reclaim_state === "none"));
    for (let i = 0; i < stale.length; i += BATCH) {
      await sys.write(async (tx) => {
        for (const x of stale.slice(i, i + BATCH)) await updateIn(tx, sys, "software_install", x.id, { reclaim_state: "proposed" }, { trusted: true });
      });
    }
    return { run_id: String(run.id), products: totals.products, under_licensed: totals.under_licensed };
  } catch (e) {
    await sys.write((tx) => updateIn(tx, sys, "license_reconcile_run", run.id, { status: "failed", finished_at: new Date().toISOString(), error: String((e as Error).message ?? e).slice(0, 500) }, { trusted: true }));
    throw e;
  }
}

/** The compliance view (ITAM-058/059/066), read with the caller's access. */
export async function compliance(ctx: Ctx): Promise<Compliance> {
  const { def } = await defFor(ctx, "license_position");
  if (!access().canReadTable(ctx, def)) throw forbidden("به وضعیت مجوزها دسترسی ندارید");
  const financial = await hasGroup(ctx, "financial");
  const today = orgToday(ctx);
  const runs = await list(ctx, "license_reconcile_run", { filter: { f: "status", op: "eq", v: "done" }, sort: "-started_at", size: 12, total: false });
  const run = runs.rows[0] ?? null;
  const positions: CompliancePosition[] = [];
  if (run) {
    const r = await list(ctx, "license_position", { filter: { f: "run_id", op: "eq", v: run.id }, size: 2000, total: false, fields: ["software_model_id", "metric", "entitled", "consumed", "delta", "installs", "devices", "users", "unused_installs", "status", "unit_price", "exposure", "savings", "detail"] });
    const modelIds = [...new Set(r.rows.map((p) => String(p.software_model_id)))];
    const models = modelIds.length ? (await list(ctx, "software_model", { ids: modelIds, size: modelIds.length, total: false, fields: ["name", "publisher_id", "category", "status"] })) : { rows: [], display: {} as Record<string, string> };
    const byId = new Map(models.rows.map((m) => [String(m.id), m]));
    for (const p of r.rows) {
      const m = byId.get(String(p.software_model_id));
      const detail = (p.detail ?? { active_entitlements: [], notes: [], by_metric: {} }) as CompliancePosition["detail"] & { reclaimable?: number };
      positions.push({
        id: String(p.id), software_model_id: String(p.software_model_id), model: String(m?.name ?? r.display[String(p.software_model_id)] ?? ""), publisher: m?.publisher_id ? models.display[String(m.publisher_id)] ?? null : null,
        category: (m?.category as string) ?? null, model_status: (m?.status as string) ?? null,
        metric: p.metric as LicenseMetric, entitled: Number(p.entitled ?? 0), consumed: Number(p.consumed ?? 0), delta: Number(p.delta ?? 0), installs: Number(p.installs ?? 0), devices: Number(p.devices ?? 0),
        users: Number(p.users ?? 0), unused_installs: Number(p.unused_installs ?? 0), reclaimable: Number(detail.reclaimable ?? 0), status: p.status as CompliancePosition["status"],
        unit_price: financial ? String(p.unit_price ?? "0") : "", exposure: financial ? String(p.exposure ?? "0") : "", savings: financial ? String(p.savings ?? "0") : "", detail,
      });
    }
  }
  const order: Record<string, number> = { unlicensed: 0, under_licensed: 1, over_licensed: 2, compliant: 3, unlimited: 4, free: 5 };
  positions.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.delta - b.delta);
  const totals = positionTotals(positions.map((p) => ({ status: p.status, exposure: p.exposure || "0", savings: p.savings || "0" })));

  // true-ups and renewals within 180 days, projected from the history of positions
  const trueups: TrueUpRow[] = [];
  if (await holds(ctx, "software", "read")) {
    const horizon = addDays(today, 180);
    const ents = await list(ctx, "license_entitlement", { filter: { and: [{ f: "state", op: "eq", v: "active" }, { or: [{ f: "true_up_date", op: "between", v: [today, horizon] }, { f: "end_date", op: "between", v: [today, horizon] }] }] }, size: 200, total: false });
    for (const e of ents.rows) {
      const due = String(e.true_up_date && String(e.true_up_date) >= today ? e.true_up_date : e.end_date);
      const hist = await list(ctx, "license_position", { filter: { f: "software_model_id", op: "eq", v: e.software_model_id }, sort: "-created_at", size: 24, total: false, fields: ["consumed", "entitled", "unit_price", "created_at"] });
      const pts = hist.rows.map((h) => ({ at: String(h.created_at), consumed: Number(h.consumed ?? 0) }));
      const entitled = Number(hist.rows[0]?.entitled ?? e.quantity ?? 0);
      const price = financial ? String(hist.rows[0]?.unit_price ?? e.unit_cost ?? "0") : "0";
      const proj = trueUpProjection(pts, entitled, price, due);
      trueups.push({
        entitlement_id: String(e.id), number: (e.number as string) ?? null, name: String(e.name ?? ""), model: ents.display[String(e.software_model_id)] ?? "", due, days_left: diffDays(today, due),
        entitled, consumed: pts[0]?.consumed ?? 0, projected: proj.projected, shortfall: proj.shortfall, cost: financial ? proj.cost : null,
      });
    }
    trueups.sort((a, b) => a.days_left - b.days_left);
  }
  // discovered names no model matched, and restricted or prohibited software found installed
  const unmatchedAgg = await aggregate(ctx, "software_install", { filter: { and: [{ f: "active", op: "eq", v: true }, { f: "software_model_id", op: "empty" }] }, groupBy: ["raw_name"], metrics: [{ fn: "count" }], limit: 25 }).catch(() => null);
  const restrictedAgg = await aggregate(ctx, "software_install", { filter: { and: [{ f: "active", op: "eq", v: true }, { f: "software_model_id.status", op: "in", v: ["prohibited", "restricted"] }] }, groupBy: ["software_model_id"], metrics: [{ fn: "count" }], limit: 50 }).catch(() => null);
  const statusOf = new Map(positions.map((p) => [p.software_model_id, p.model_status]));
  return {
    run: run ? { id: String(run.id), number: (run.number as string) ?? null, finished_at: (run.finished_at as string) ?? null, status: String(run.status) } : null,
    positions,
    totals: { ...totals, exposure: financial ? totals.exposure : null, savings: financial ? totals.savings : null },
    trueups,
    unmatched: (unmatchedAgg?.rows ?? []).map((g) => ({ raw_name: String(g.keys[0] ?? ""), publisher: null, installs: Number(g.values.count ?? 0) })),
    restricted: (restrictedAgg?.rows ?? []).map((g) => ({ model: String(g.labels?.[0] ?? restrictedAgg?.display?.[String(g.keys[0])] ?? ""), status: String(statusOf.get(String(g.keys[0])) ?? "restricted"), installs: Number(g.values.count ?? 0) })),
    financial,
  };
}

/** Facts of the licence optimisation narrative (numbers from code; the model only narrates). */
export async function licenceFacts(ctx: Ctx): Promise<Record<string, unknown>> {
  const c = await compliance(ctx);
  return {
    run_at: c.run?.finished_at ?? null,
    totals: c.totals,
    shortfalls: c.positions.filter((p) => p.status === "under_licensed" || p.status === "unlicensed").slice(0, 10).map((p) => ({ product: p.model, metric: p.metric, entitled: p.entitled, consumed: p.consumed, shortfall: -p.delta, exposure: p.exposure || null })),
    surplus: c.positions.filter((p) => p.status === "over_licensed").slice(0, 10).map((p) => ({ product: p.model, surplus: p.delta, savings: p.savings || null })),
    unused: c.positions.filter((p) => p.unused_installs > 0).slice(0, 10).map((p) => ({ product: p.model, unused_installs: p.unused_installs, reclaimable: p.reclaimable })),
    trueups: c.trueups.slice(0, 5).map((t) => ({ name: t.name, due: t.due, projected_shortfall: t.shortfall, cost: t.cost })),
    restricted: c.restricted,
    financial: c.financial,
  };
}

export { liveRow };
