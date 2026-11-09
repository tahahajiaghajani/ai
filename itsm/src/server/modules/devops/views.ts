// Read models of the DevOps screens, read with the caller's context:
//   dora         the DORA metrics of production deployments in a period (DEV-015), overall and per service, with
//                weekly series and the organisation's thresholds; the change velocity (deployments that came with an
//                automatic standard change versus manual ones)
//   pipeline     the pipeline view per environment: for each service, the latest deployment in every environment
//                (version, state, when, change) and versions waiting to be promoted
//   development  the development panel of a record (DEV-004): commits, pull requests and builds that mention its
//                number, and the deployments of a change or a release
import { deploymentOutcome, doraMetrics, thresholdsOf, DORA_DEFINITIONS, type DoraDeployment } from "@shared/devops/logic";
import type { Ctx } from "../../context";
import { get, list, listAll } from "../../engine";
import { releaseConfig, msOf, sysOf, type Row } from "./common";

const DAY = 86_400_000;
const DEP_FIELDS = ["number", "service_id", "environment_id", "state", "close_code", "actual_end", "first_commit_at", "restored_at", "change_failure", "kind", "connection_id", "change_id", "artifact_version", "is_production", "release_id", "short_description"];

const toDora = (d: Row): DoraDeployment => ({
  id: String(d.id), at: msOf(d.actual_end) ?? 0, state: String(d.state), close_code: d.close_code ?? null, first_commit_at: msOf(d.first_commit_at), restored_at: msOf(d.restored_at),
  change_failure: d.change_failure === true, kind: d.kind ?? null, service_id: d.service_id ?? null,
});

/** DORA metrics of a period (`days` up to now), overall and per service. */
export async function doraView(ctx: Ctx, input: { days: number; service?: string | null; now?: number }): Promise<Row> {
  const now = input.now ?? Date.now();
  const from = now - input.days * DAY;
  const filter = { and: [{ f: "is_production", op: "eq", v: true }, { f: "actual_end", op: "gte", v: new Date(from).toISOString() }, ...(input.service ? [{ f: "service_id", op: "eq", v: input.service }] : [])] };
  // every production deployment of the period (newest first should a very large organisation reach the cap)
  const r = await listAll(ctx, "deployment", { filter: filter as never, fields: DEP_FIELDS, sort: "-actual_end" });
  const cfg = await releaseConfig(ctx.db, sysOf(ctx));
  const t = thresholdsOf(cfg.dora_definitions);
  const deps = r.rows.map(toDora);
  const overall = doraMetrics(deps, { from, to: now }, t);
  const byService = new Map<string, DoraDeployment[]>();
  for (const d of deps) {
    const k = String(d.service_id ?? "");
    if (!byService.has(k)) byService.set(k, []);
    byService.get(k)!.push(d);
  }
  const services = [...byService.entries()].map(([service, ds]) => ({ service: service || null, ...doraMetrics(ds, { from, to: now }, t), weekly: undefined })).sort((a, b) => b.deployments - a.deployments).slice(0, 30);
  const automated = r.rows.filter((d) => d.connection_id).length;
  const withChange = r.rows.filter((d) => d.change_id).length;
  return {
    days: input.days,
    overall,
    services,
    velocity: { deployments: r.rows.length, from_pipelines: automated, with_change: withChange, manual: r.rows.length - automated },
    definitions: cfg.dora_definitions ?? DORA_DEFINITIONS,
    thresholds: t,
    truncated: r.truncated,
    display: r.display,
  };
}

/** The pipeline view: services × environments with the latest deployment in each cell. */
export async function pipelineView(ctx: Ctx, input: { days: number; service?: string | null }): Promise<Row> {
  const envs = (await list(ctx, "release_environment", { filter: { f: "active", op: "eq", v: true }, sort: "sort_order,name", size: 50, total: false, fields: ["name", "key", "kind", "protection", "sort_order", "color"] })).rows;
  const since = new Date(Date.now() - input.days * DAY).toISOString();
  const filter = { and: [{ or: [{ f: "actual_end", op: "gte", v: since }, { f: "state", op: "in", v: ["planned", "pending_approval", "in_progress"] }] }, ...(input.service ? [{ f: "service_id", op: "eq", v: input.service }] : [])] };
  const r = await listAll(ctx, "deployment", { filter: filter as never, fields: [...DEP_FIELDS, "actual_start", "planned_start", "pipeline_id", "verification"], sort: "-updated_at" });
  const rows = new Map<string, { key: string; service_id: string | null; pipeline_id: string | null; cells: Record<string, Row>; history: Record<string, number> }>();
  for (const d of r.rows) {
    const key = String(d.service_id ?? d.pipeline_id ?? "none");
    if (!rows.has(key)) rows.set(key, { key, service_id: d.service_id ?? null, pipeline_id: d.service_id ? null : (d.pipeline_id ?? null), cells: {}, history: {} });
    const row = rows.get(key)!;
    const env = String(d.environment_id ?? "");
    row.history[env] = (row.history[env] ?? 0) + 1;
    const cur = row.cells[env];
    const when = (x: Row) => msOf(x.actual_end) ?? msOf(x.actual_start) ?? msOf(x.planned_start) ?? 0;
    if (!cur || when(d) > when(cur)) row.cells[env] = d;
  }
  const order = envs.map((e) => String(e.id));
  const out = [...rows.values()].map((row) => {
    // versions that reached a lower environment but not the next one up (waiting for promotion)
    const waiting: { from: string; to: string; version: string }[] = [];
    for (let i = 0; i < order.length - 1; i++) {
      const lo = row.cells[order[i]];
      const hi = row.cells[order[i + 1]];
      if (lo && deploymentOutcome(lo) === "ok" && lo.artifact_version && (!hi || hi.artifact_version !== lo.artifact_version)) waiting.push({ from: order[i], to: order[i + 1], version: String(lo.artifact_version) });
    }
    return { ...row, waiting };
  });
  return { environments: envs, rows: out, truncated: r.truncated, display: r.display };
}

/** The development panel of a record: work mentioning its number and its deployments. */
export async function developmentOf(ctx: Ctx, table: string, id: string): Promise<Row> {
  const { row } = await get(ctx, table, id);
  const no = typeof row.number === "string" ? row.number : null;
  const safe = async (t: string, filter: unknown, fields: string[], sort: string) => (await list(ctx, t, { filter: filter as never, fields, sort, size: 50, total: false }).catch(() => ({ rows: [] as Row[], display: {} as Record<string, string> })));
  const byKey = { f: "keys", op: "eq", v: no ?? "—" };
  const commits = no ? await safe("dev_commit", byKey, ["sha", "message", "author_name", "committed_at", "branch", "url", "repository_id"], "-committed_at") : { rows: [], display: {} };
  const prs = no ? await safe("dev_pull_request", byKey, ["pr_number", "title", "state", "author", "merged_at", "url", "repository_id"], "-opened_at") : { rows: [], display: {} };
  const builds = no ? await safe("dev_build", byKey, ["run_number", "status", "branch", "started_at", "duration", "url", "pipeline_id", "tests_failed"], "-started_at") : { rows: [], display: {} };
  const depField = table === "change_request" ? "change_id" : table === "release" ? "release_id" : null;
  const deployments = depField ? await safe("deployment", { f: depField, op: "eq", v: id }, ["number", "environment_id", "state", "close_code", "artifact_version", "actual_end", "external_url"], "-actual_end") : { rows: [], display: {} };
  return {
    number: no,
    commits: commits.rows,
    pull_requests: prs.rows,
    builds: builds.rows,
    deployments: deployments.rows,
    display: { ...commits.display, ...prs.display, ...builds.display, ...deployments.display },
  };
}
