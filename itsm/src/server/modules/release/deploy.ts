// What a deployment's progress does to the records around it (job `release.deployment`, as the system, after the
// write committed — each effect in its own savepoint so one refusal never undoes the others):
//   · its change follows it (DEV-007): started → «در حال اجرا», succeeded → «بازبینی» with a successful outcome and,
//     when the connection closes changes, «بسته»; failed or rolled back → «بازبینی» with the failed outcome — through
//     the change module's own transitions and guards
//   · a production success restores the failures before it in the same environment and service (DORA recovery
//     time), stamps the release's deployed_at (and released_at unless feature flags hold it back), moves a deploying
//     release on to early life support, and records the deployed version on the target CIs (REL-022)
//   · a production rollback marks the release rolled back
// Also: the counts a release and a deployment keep from their links (changes, problems fixed, incidents) and the
// tagging of new incidents (early life support of a release; suspects after a production deployment).
import { DEPLOYMENT_FAILED } from "@shared/tables/release";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, addLinkIn, orgSchema, savepoint, transitionIn, updateIn } from "../../engine";
import { ids, isUuid, liveRow, liveRows, msOf, releaseConfig, sysOf, type Row } from "./common";
import { linkedIds } from "./checks";

const OK = ["succeeded", "closed"];

async function note(tx: Tx, ctx: Ctx, table: string, row: Row, body: string): Promise<void> {
  const schema = await orgSchema(ctx, tx);
  const def = schema.def(table);
  if (def?.features?.journal || def?.extends === "task") await addJournalIn(tx, ctx, def!, row, { kind: "work_note", body }, { trusted: true }).catch(() => undefined);
}

/** Move a change one step, swallowing (and noting) a refusal of the change module's guards. */
async function step(tx: Tx, ctx: Ctx, dep: Row, change: Row, to: string, data: Row = {}): Promise<Row> {
  try {
    return await savepoint(tx, () => transitionIn(tx, ctx, "change_request", String(change.id), to, data, { trusted: true }));
  } catch (e) {
    await note(tx, ctx, "deployment", dep, `تغییر ${change.number} به وضعیت «${to}» نرفت: ${(e as Error).message}`);
    return change;
  }
}

/** The change of a deployment follows the deployment (DEV-007). */
export async function moveChange(tx: Tx, ctx: Ctx, dep: Row): Promise<void> {
  const sys = sysOf(ctx);
  let change = isUuid(dep.change_id) ? await liveRow(tx, sys, "change_request", dep.change_id) : null;
  if (!change || ["closed", "canceled"].includes(String(change.state))) return;
  const state = String(dep.state);
  if (["in_progress", "succeeded", "failed", "rolled_back"].includes(state) && change.state === "scheduled") change = await step(tx, sys, dep, change, "implement");
  if (change.state !== "implement") return;
  if (OK.includes(state)) {
    change = await step(tx, sys, dep, change, "review", { close_code: "successful" });
    const conn = isUuid(dep.connection_id) ? await liveRow(tx, sys, "devops_connection", dep.connection_id) : null;
    const closes = conn ? conn.close_changes !== false : String(change.external_ref ?? "").startsWith("deploy:");
    if (change.state === "review" && closes) await step(tx, sys, dep, change, "closed", { close_code: "successful", close_notes: `با پایان موفق استقرار ${dep.number ?? ""} بسته شد.` });
  } else if (DEPLOYMENT_FAILED.includes(state)) {
    await step(tx, sys, dep, change, "review", { close_code: state === "rolled_back" ? "backed_out" : "unsuccessful" });
  }
}

/** Earlier failures in the same environment and service are restored by a success (DORA recovery). */
async function restoreFailures(tx: Tx, ctx: Ctx, dep: Row): Promise<void> {
  const sys = sysOf(ctx);
  const at = msOf(dep.actual_end);
  if (at === null) return;
  // the same thing deployed again: the service, else the pipeline, the release or the connection it came from
  const by = (["service_id", "pipeline_id", "release_id", "connection_id"] as const).find((f) => isUuid(dep[f]));
  if (!by) return;
  const scope = { f: by, op: "eq", v: dep[by] };
  const failed = await liveRows(tx, sys, "deployment", { and: [scope as never, { f: "environment_id", op: "eq", v: dep.environment_id }, { f: "state", op: "in", v: DEPLOYMENT_FAILED }, { f: "restored_at", op: "empty" }] });
  for (const f of failed) {
    if (f.id === dep.id || (msOf(f.actual_end) ?? Infinity) > at) continue;
    await updateIn(tx, sys, "deployment", String(f.id), { restored_at: dep.actual_end }, { trusted: true, keepVersion: true, allowLocked: true });
  }
}

/** A production success moves its release on and records the version on the target CIs. */
async function productionSuccess(tx: Tx, ctx: Ctx, dep: Row): Promise<void> {
  const sys = sysOf(ctx);
  const cfg = await releaseConfig(tx, ctx);
  if (isUuid(dep.release_id)) {
    let rel = await liveRow(tx, sys, "release", dep.release_id);
    if (rel && !["closed", "canceled"].includes(String(rel.state))) {
      const patch: Row = {};
      if (!rel.deployed_at) patch.deployed_at = dep.actual_end;
      if (!rel.released_at && cfg.release_on_production) {
        const flags = await liveRows(tx, sys, "feature_flag", { f: "release_id", op: "eq", v: rel.id });
        if (!flags.some((f) => f.state !== "on")) patch.released_at = dep.actual_end;
      }
      if (Object.keys(patch).length) rel = await updateIn(tx, sys, "release", String(rel.id), patch, { trusted: true, keepVersion: true });
      if (cfg.auto_advance && rel.state === "deploying") {
        const to = Number(rel.els_days ?? 0) > 0 ? "els" : "review";
        await savepoint(tx, () => transitionIn(tx, sys, "release", String(rel!.id), to, {}, { trusted: true })).catch((e) => note(tx, sys, "release", rel!, `انتشار خودکار به مرحلهٔ بعد نرفت: ${(e as Error).message}`));
      }
    }
  }
  if (cfg.update_cmdb_versions && dep.artifact_version) {
    for (const ci of ids(dep.targets)) {
      await savepoint(tx, () => updateIn(tx, sys, "ci", ci, { sw_version: String(dep.artifact_version).slice(0, 80) }, { trusted: true })).catch(() => undefined);
    }
  }
}

/** Everything a deployment's new state does around it (one transaction). */
export async function deploymentEffects(sys: Ctx, id: string): Promise<void> {
  await sys.write(async (tx) => {
    const dep = await liveRow(tx, sys, "deployment", id);
    if (!dep) return;
    if (isUuid(dep.change_id)) await moveChange(tx, sys, dep);
    if (OK.includes(String(dep.state))) await restoreFailures(tx, sys, dep);
    if (dep.is_production && dep.state === "succeeded") await productionSuccess(tx, sys, dep);
    if (dep.is_production && dep.state === "rolled_back" && isUuid(dep.release_id)) {
      const rel = await liveRow(tx, sys, "release", dep.release_id);
      if (rel && !rel.rolled_back) await updateIn(tx, sys, "release", String(rel.id), { rolled_back: true }, { trusted: true, keepVersion: true, allowLocked: true });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Counts kept from links

/** A release's counts of changes (all, open), problems fixed and incidents of its early life support. */
export async function recountRelease(tx: Tx, ctx: Ctx, releaseId: string): Promise<void> {
  const sys = sysOf(ctx);
  const rel = await liveRow(tx, sys, "release", releaseId);
  if (!rel) return;
  const changeIds = await linkedIds(tx, ctx, releaseId, "release_includes", "change_request");
  const changes = changeIds.length ? await liveRows(tx, sys, "change_request", { f: "id", op: "in", v: changeIds }) : [];
  const fixes = [...await linkedIds(tx, ctx, releaseId, "fixes", "problem"), ...await linkedIds(tx, ctx, releaseId, "fixes", "known_error")];
  const els = await linkedIds(tx, ctx, releaseId, "els_incident", "incident");
  const patch: Row = {
    changes_total: changes.length,
    changes_open: changes.filter((c) => !["closed", "canceled"].includes(String(c.state))).length,
    problems_fixed: fixes.length,
    els_incidents: els.length,
  };
  if (Object.entries(patch).some(([k, v]) => Number(rel[k] ?? 0) !== v)) await updateIn(tx, sys, "release", releaseId, patch, { trusted: true, keepVersion: true, allowLocked: true });
}

/** A deployment's incidents (caused_by, or the change's) and whether it counts as a failed change. */
export async function recountDeployment(tx: Tx, ctx: Ctx, depId: string): Promise<void> {
  const sys = sysOf(ctx);
  const dep = await liveRow(tx, sys, "deployment", depId);
  if (!dep) return;
  const caused = await tx.query<{ n: string }>(
    `select count(distinct l.from_id) as n from sm_links l where l.org_id = $1 and l.deleted_at is null and l.kind = 'caused_by' and l.to_table = 'deployment' and l.to_id = $2 and l.from_table = 'incident'`,
    [ctx.org.id, depId],
  );
  let n = Number(caused[0]?.n ?? 0);
  if (isUuid(dep.change_id)) {
    const change = await liveRow(tx, sys, "change_request", dep.change_id);
    n += Number(change?.incidents_caused ?? 0);
  }
  if (Number(dep.incidents_caused ?? 0) !== n) await updateIn(tx, sys, "deployment", depId, { incidents_caused: n }, { trusted: true, keepVersion: true, allowLocked: true });
}

/** Releases and deployments that link a record (to recount them). */
export async function linkedReleases(tx: Tx, ctx: Ctx, table: string, id: string): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `select case when l.from_table = 'release' then l.from_id else l.to_id end as id from sm_links l
      where l.org_id = $1 and l.deleted_at is null and ((l.from_table = 'release' and l.to_table = $2 and l.to_id = $3) or (l.to_table = 'release' and l.from_table = $2 and l.from_id = $3))`,
    [ctx.org.id, table, id],
  );
  return [...new Set(rows.map((r) => String(r.id)))];
}

// ---------------------------------------------------------------------------------------------------------------
// New incidents: early life support and suspects after a production deployment

/** Tag a new incident: releases in early life support on its service or CI, production deployments before it. */
export async function tagIncident(tx: Tx, ctx: Ctx, incident: Row): Promise<{ els: string[]; suspects: string[] }> {
  const sys = sysOf(ctx);
  const cfg = await releaseConfig(tx, ctx);
  const service = isUuid(incident.service_id) ? String(incident.service_id) : null;
  const ci = isUuid(incident.ci_id) ? String(incident.ci_id) : null;
  if (!service && !ci) return { els: [], suspects: [] };
  const at = msOf(incident.opened_at) ?? msOf(incident.created_at) ?? Date.now();
  const els: string[] = [];
  if (cfg.tag_els_incidents) {
    for (const r of await liveRows(tx, sys, "release", { f: "state", op: "eq", v: "els" })) {
      const end = msOf(r.els_end_at);
      if (end !== null && end < at) continue;
      const services = ids([r.service_id, ...(r.affected_services ?? []), ...(r.impacted_services ?? [])]);
      const cis = ids([r.ci_id, ...(r.affected_cis ?? [])]);
      if ((service && services.includes(service)) || (ci && cis.includes(ci))) {
        await savepoint(tx, () => addLinkIn(tx, sys, "incident", String(incident.id), { kind: "els_incident", table: "release", id: String(r.id) })).then(() => els.push(String(r.id))).catch(() => undefined);
      }
    }
  }
  const suspects: string[] = [];
  const since = new Date(at - cfg.failure_window_hours * 3_600_000).toISOString();
  const recent = await liveRows(tx, sys, "deployment", { and: [{ f: "is_production", op: "eq", v: true }, { f: "state", op: "in", v: ["succeeded", "closed"] }, { f: "actual_end", op: "gte", v: since }] }, { limit: 200 });
  for (const d of recent) {
    if ((msOf(d.actual_end) ?? Infinity) > at) continue;
    const hit = (service && d.service_id === service) || (ci && ids(d.targets).includes(ci));
    if (!hit) continue;
    await savepoint(tx, () => addLinkIn(tx, sys, "incident", String(incident.id), { kind: "after_deployment", table: "deployment", id: String(d.id) })).then(() => suspects.push(String(d.id))).catch(() => undefined);
  }
  return { els, suspects };
}
