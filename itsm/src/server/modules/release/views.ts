// Read models of the release screens, all read with the caller's context (the engine's `list`/`get`: what the
// caller could not read through /r never shows here):
//   roadmap     releases overlapping a range, the release windows (slots of the train, release freezes) and the
//               change module's freezes and blackouts as background bands (REL-008)
//   board       the readiness board: releases in test or readiness with their checks, blockers, risk and the
//               decision they wait for (REL-013/014)
//   overview    one release: its scope (changes, problems, known errors, work items, CIs and services), readiness,
//               deployments per environment, decisions, risk factors and the traceability matrix (REL-011/018)
//   dashboard   reporting of a period (REL-040): releases by type and outcome, on-time share, rollbacks, early life
//               support incidents, deployments per environment
import { DAY_MS, readinessOf } from "@shared/release/logic";
import { RELEASE_FAILED_CODES, RELEASE_LIVE } from "@shared/tables/release";
import type { Ctx } from "../../context";
import { addLinkIn, createIn, get, list, listAll, listLinks, orgTz } from "../../engine";
import { occurrences } from "@shared/change/logic";
import { deploymentOutcome } from "@shared/devops/logic";
import { occurrencesBetween } from "../change";
import { windowLike } from "./checks";
import { ids, isUuid, msOf, sysOf, type Row } from "./common";

const RELEASE_FIELDS = ["number", "short_description", "version_name", "type", "state", "service_id", "planned_start", "planned_end", "deployed_at", "released_at", "risk_band", "risk_score", "readiness_pct", "checks_failed", "checks_pending", "go_no_go", "release_manager_id", "window_id", "parent_release_id", "els_end_at", "rolled_back"];

export interface RoadmapBand {
  id: string;
  start: string;
  end: string;
  label: string;
  kind: string;
  title?: string;
}

/** Releases overlapping [from, to) and the windows behind them. */
export async function roadmap(ctx: Ctx, input: { from: string; to: string; service?: string | null; type?: string | null }): Promise<{ releases: Row[]; bands: RoadmapBand[]; display: Record<string, string>; timezone: string }> {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const range = [{ f: "planned_end", op: "gte", v: new Date(from).toISOString() }, { f: "planned_start", op: "lt", v: new Date(to).toISOString() }];
  const filter = {
    and: [
      { f: "state", op: "ne", v: "canceled" },
      { or: [{ and: range }, { and: [{ f: "planned_start", op: "empty" }, { f: "planned_end", op: "gte", v: new Date(from).toISOString() }, { f: "planned_end", op: "lt", v: new Date(to).toISOString() }] }] },
      ...(input.service ? [{ f: "service_id", op: "eq", v: input.service }] : []),
      ...(input.type ? [{ f: "type", op: "eq", v: input.type }] : []),
    ],
  };
  const r = await list(ctx, "release", { filter: filter as never, fields: RELEASE_FIELDS, sort: "planned_end", size: 500, total: false });
  const tz = orgTz(ctx);
  const bands: RoadmapBand[] = [];
  const sys = sysOf(ctx);
  // the module's windows are definitions everyone in the area reads (public scope)
  const windows = await list(ctx, "release_window", { filter: { f: "active", op: "eq", v: true }, size: 200, total: false, fields: ["name", "kind", "start_at", "end_at", "recurrence", "weekdays", "until", "capacity", "active", "types"] }).catch(() => ({ rows: [] as Row[] }));
  for (const w of windows.rows) {
    for (const o of occurrences(windowLike(w), from, to, tz, 200)) {
      bands.push({
        id: `rw:${w.id}:${o.start}`, start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString(), label: o.name,
        kind: w.kind === "release_freeze" ? "freeze" : "maintenance",
        title: w.kind === "release_freeze" ? `توقف انتشار: ${o.name}` : `پنجرهٔ انتشار: ${o.name}${w.capacity ? ` (ظرفیت ${Number(w.capacity).toLocaleString("fa-IR")})` : ""}`,
      });
    }
  }
  try {
    for (const o of await occurrencesBetween(ctx.db, sys, from, to)) {
      if (o.kind !== "freeze" && o.kind !== "blackout") continue;
      bands.push({ id: `cw:${o.window_id}:${o.start}`, start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString(), label: o.name, kind: o.kind, title: `${o.kind === "blackout" ? "ممنوعیت تغییر" : "انجماد تغییرات"}: ${o.name}` });
    }
  } catch {
    // change management not installed: no change windows
  }
  return { releases: r.rows, bands, display: r.display, timezone: tz };
}

/** The readiness board: releases being tested or waiting for their decision. */
export async function readinessBoard(ctx: Ctx): Promise<{ releases: Row[]; display: Record<string, string> }> {
  const r = await list(ctx, "release", { filter: { f: "state", op: "in", v: ["build", "test", "readiness"] }, fields: RELEASE_FIELDS, sort: "planned_end", size: 200, total: false });
  const releaseIds = r.rows.map((x) => String(x.id));
  const results = releaseIds.length
    ? (await list(ctx, "release_check_result", { filter: { f: "release_id", op: "in", v: releaseIds }, fields: ["release_id", "check_id", "name", "rule", "phase", "blocking", "status", "message", "evaluated_at", "waiver_reason"], sort: "phase,name", size: 500, total: false }).catch(() => ({ rows: [] as Row[] }))).rows
    : [];
  const byRelease = new Map<string, Row[]>();
  for (const x of results) {
    const k = String(x.release_id);
    if (!byRelease.has(k)) byRelease.set(k, []);
    byRelease.get(k)!.push(x);
  }
  return {
    releases: r.rows.map((rel) => {
      const checks = byRelease.get(String(rel.id)) ?? [];
      const readiness = readinessOf(checks as never);
      return { ...rel, checks, readiness };
    }),
    display: r.display,
  };
}

const LINK_TABLES: Record<string, string> = { change_request: "changes", problem: "problems", known_error: "known_errors", incident: "incidents", project_task: "work_items", dev_pull_request: "pull_requests" };

/** One release with everything around it (as the caller). */
export async function releaseOverview(ctx: Ctx, id: string): Promise<Row> {
  const { row, display } = await get(ctx, "release", id);
  const links = (await listLinks(ctx, "release", id).catch(() => ({ links: [] as Row[] }))).links as Row[];
  const scope: Record<string, Row[]> = { changes: [], problems: [], known_errors: [], incidents: [], work_items: [], pull_requests: [], other: [] };
  for (const l of links) {
    const other = l.other as Row;
    const bucket = LINK_TABLES[String(other?.table ?? "")] ?? "other";
    scope[bucket].push({ kind: l.kind, direction: l.direction, table: other.table, id: other.id, number: other.number ?? null, display: other.display ?? null, state: other.state ?? null });
  }
  const deployments = (await list(ctx, "deployment", { filter: { f: "release_id", op: "eq", v: id }, fields: ["number", "short_description", "environment_id", "state", "close_code", "artifact_version", "actual_start", "actual_end", "change_id", "approach", "verification", "change_failure", "is_production"], sort: "-actual_end", size: 200, total: false }).catch(() => ({ rows: [] as Row[], display: {} as Record<string, string> })));
  const checks = (await list(ctx, "release_check_result", { filter: { f: "release_id", op: "eq", v: id }, size: 200, total: false, sort: "phase,name" }).catch(() => ({ rows: [] as Row[] }))).rows;
  const decisions = (await list(ctx, "release_decision", { filter: { f: "release_id", op: "eq", v: id }, sort: "-decided_at", size: 50, total: false }).catch(() => ({ rows: [] as Row[] }))).rows;
  // the traceability matrix: each change of the scope with the deployments that carried it
  const trace = scope.changes.map((c) => ({
    change: c,
    deployments: deployments.rows.filter((d) => d.change_id === c.id).map((d) => ({ id: d.id, number: d.number, environment_id: d.environment_id, state: d.state })),
  }));
  return {
    release: row,
    display: { ...display, ...deployments.display },
    scope,
    deployments: deployments.rows,
    checks,
    readiness: readinessOf(checks as never),
    decisions,
    trace,
  };
}

/** Reporting of a period (REL-040), from the releases and deployments the caller reads. */
export async function releaseDashboard(ctx: Ctx, days: number): Promise<Row> {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const recent = await listAll(ctx, "release", {
    filter: { or: [{ f: "planned_end", op: "gte", v: since }, { f: "deployed_at", op: "gte", v: since }, { f: "state", op: "in", v: ["draft", "planning", "build", "test", "readiness", "deploying", "els", "review", "on_hold"] }] },
    fields: ["number", "short_description", "type", "state", "planned_end", "deployed_at", "close_code", "on_schedule", "rolled_back", "els_incidents", "risk_band", "service_id"],
  });
  const rows = recent.rows;
  const live = rows.filter((r) => RELEASE_LIVE.includes(String(r.state)) && r.deployed_at && String(r.deployed_at) >= since);
  const closed = rows.filter((r) => r.state === "closed" && r.close_code);
  const byType: Record<string, number> = {};
  for (const r of rows) byType[String(r.type ?? "minor")] = (byType[String(r.type ?? "minor")] ?? 0) + 1;
  const byState: Record<string, number> = {};
  for (const r of rows) if (!["closed", "canceled"].includes(String(r.state))) byState[String(r.state)] = (byState[String(r.state)] ?? 0) + 1;
  const timed = live.filter((r) => r.on_schedule !== null && r.on_schedule !== undefined);
  const deps = await listAll(ctx, "deployment", { filter: { f: "actual_end", op: "gte", v: since }, fields: ["environment_id", "state", "close_code", "is_production", "change_failure", "kind"], sort: "-actual_end" }).catch(() => ({ rows: [] as Row[], display: {} as Record<string, string>, truncated: false }));
  const perEnv: Record<string, { succeeded: number; failed: number; rolled_back: number }> = {};
  for (const d of deps.rows) {
    const k = String(d.environment_id ?? "");
    perEnv[k] ??= { succeeded: 0, failed: 0, rolled_back: 0 };
    // a closed deployment counts by the outcome it was closed with
    const outcome = deploymentOutcome(d);
    if (outcome === "ok") perEnv[k].succeeded++;
    else if (outcome === "failed" && (d.state === "rolled_back" || d.close_code === "rolled_back")) perEnv[k].rolled_back++;
    else if (outcome === "failed") perEnv[k].failed++;
  }
  const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
  return {
    days,
    kpis: {
      releases: rows.length,
      deployed: live.length,
      on_time_pct: pct(timed.filter((r) => r.on_schedule === true).length, timed.length),
      success_pct: pct(closed.filter((r) => !RELEASE_FAILED_CODES.includes(String(r.close_code))).length, closed.length),
      rolled_back: rows.filter((r) => r.rolled_back === true).length,
      els_incidents: live.reduce((s, r) => s + Number(r.els_incidents ?? 0), 0),
      high_risk_open: rows.filter((r) => ["high", "very_high"].includes(String(r.risk_band)) && !["closed", "canceled", "els", "review"].includes(String(r.state))).length,
    },
    by_type: byType,
    by_state: byState,
    per_environment: perEnv,
    upcoming: rows.filter((r) => ["planning", "build", "test", "readiness", "deploying"].includes(String(r.state))).sort((a, b) => (msOf(a.planned_end) ?? Infinity) - (msOf(b.planned_end) ?? Infinity)).slice(0, 10),
    truncated: recent.truncated || deps.truncated,
    display: { ...recent.display, ...deps.display },
  };
}

/** The ids of a release's included records of one table (for the AI facts and notes), as the caller. */
export async function scopeIds(ctx: Ctx, id: string, table: string): Promise<string[]> {
  const links = (await listLinks(ctx, "release", id).catch(() => ({ links: [] as Row[] }))).links as Row[];
  return ids(links.filter((l) => (l.other as Row)?.table === table).map((l) => (l.other as Row).id)).filter(isUuid);
}

/**
 * A normal change for a release (REL-006), created as the caller through the change module's own rules (model,
 * risk, authorization): the release's title, service, CIs, window and plans (deployment → implementation, rollback
 * → back-out, test plan), linked «شامل» to the release.
 */
export async function changeForRelease(ctx: Ctx, id: string): Promise<Row> {
  const { row: r } = await get(ctx, "release", id);
  const created = await ctx.write(async (tx) => {
    const change = await createIn(tx, ctx, "change_request", {
      type: "normal",
      short_description: `استقرار ${r.version_name ? `نسخهٔ ${r.version_name} ` : ""}${r.short_description ?? ""}`.slice(0, 160),
      description: [`تغییر استقرار انتشار ${r.number ?? ""}.`, typeof r.description === "string" ? r.description : ""].filter(Boolean).join("\n\n"),
      ...(isUuid(r.service_id) ? { service_id: r.service_id } : {}),
      ...(isUuid(r.ci_id) ? { ci_id: r.ci_id } : {}),
      ...(Array.isArray(r.affected_cis) && r.affected_cis.length ? { affected_cis: r.affected_cis } : {}),
      ...(isUuid(r.assignment_group_id) ? { assignment_group_id: r.assignment_group_id } : {}),
      ...(r.planned_end ? { planned_start: r.planned_start && msOf(r.planned_start)! > Date.now() ? r.planned_start : r.planned_end, planned_end: new Date((msOf(r.planned_end) ?? Date.now()) + 2 * 3_600_000).toISOString() } : {}),
      ...(r.deployment_plan ? { implementation_plan: r.deployment_plan } : {}),
      ...(r.rollback_plan ? { backout_plan: r.rollback_plan } : {}),
      ...(r.test_plan ? { test_plan: r.test_plan } : {}),
    });
    await addLinkIn(tx, ctx, "release", id, { kind: "release_includes", table: "change_request", id: String(change.id) });
    return change;
  });
  return (await get(ctx, "change_request", String(created.id))).row;
}
