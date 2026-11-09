// The release risk score (REL-015) from what is stored: the release's tasks (overdue share), its readiness results
// (failed share), the risk of the changes it includes, the teams and services touched, freezes in its window and its
// failed deployments — computed by @shared/release/logic and stamped on the release (risk_score, risk_band,
// risk_factors) without moving its version. Recomputed by the sweep, on task and check changes (job
// `release.recalc`) and on demand. A deployment's own risk (for its narrative) is assembled here too.
import { releaseRisk, explainReleaseRisk, type RiskResult } from "@shared/release/logic";
import { DEPLOYMENT_FAILED, RELEASE_TASK_DONE } from "@shared/tables/release";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { updateIn } from "../../engine";
import { freezesFor, releaseChanges } from "./checks";
import { ids, liveRow, liveRows, msOf, sysOf, type Row, fa, faList, environmentOf, isProductionEnv } from "./common";

/** The risk of a release as stored now (as the system). */
export async function computeReleaseRisk(tx: Tx, ctx: Ctx, release: Row, now = Date.now()): Promise<RiskResult> {
  const sys = sysOf(ctx);
  const tasks = (await liveRows(tx, sys, "release_task", { f: "release_id", op: "eq", v: release.id })).filter((t) => t.state !== "canceled");
  const overdue = tasks.filter((t) => !RELEASE_TASK_DONE.includes(String(t.state)) && msOf(t.due_at) !== null && msOf(t.due_at)! < now);
  const results = (await liveRows(tx, sys, "release_check_result", { f: "release_id", op: "eq", v: release.id })).filter((r) => r.status !== "na");
  const changes = (await releaseChanges(tx, ctx, String(release.id))).filter((c) => c.state !== "canceled");
  const teams = new Set([...tasks, ...changes].map((x) => x.assignment_group_id).filter(Boolean));
  const services = new Set([...ids(release.service_id), ...ids(release.affected_services), ...ids(release.impacted_services), ...changes.flatMap((c) => [...ids(c.service_id), ...ids(c.affected_services)])]);
  const deployments = await liveRows(tx, sys, "deployment", { f: "release_id", op: "eq", v: release.id });
  return releaseRisk({
    type: String(release.type ?? "minor"),
    now,
    planned_start: release.planned_start ?? release.created_at,
    planned_end: release.planned_end,
    tasks: { total: tasks.length, overdue: overdue.length },
    checks: { total: results.length, failed: results.filter((r) => r.status === "fail").length },
    change_risks: changes.map((c) => c.risk),
    teams: teams.size,
    services: services.size,
    freeze: (await freezesFor(tx, ctx, release)).length > 0,
    failed_deployments: deployments.filter((d) => DEPLOYMENT_FAILED.includes(String(d.state))).length,
  });
}

/** Recompute and stamp a release's risk (no version move). */
export async function recalcRiskIn(tx: Tx, ctx: Ctx, releaseId: string): Promise<RiskResult | null> {
  const sys = sysOf(ctx);
  const release = await liveRow(tx, sys, "release", releaseId);
  if (!release || ["closed", "canceled"].includes(String(release.state))) return null;
  const r = await computeReleaseRisk(tx, ctx, release);
  const factors = r.factors.map((f) => ({ key: f.key, label: f.label, points: f.points, detail: f.detail }));
  if (release.risk_score !== r.score || release.risk_band !== r.band || JSON.stringify(release.risk_factors ?? []) !== JSON.stringify(factors)) {
    await updateIn(tx, sys, "release", releaseId, { risk_score: r.score, risk_band: r.band, risk_factors: factors }, { trusted: true, keepVersion: true });
  }
  return r;
}

/** The deterministic risk explanation of a release. */
export const releaseRiskText = (r: RiskResult): string => explainReleaseRisk(r);

/** Facts about a deployment's risk (numbers from code; the narrative skill only tells them). */
export async function deploymentRiskFacts(tx: Tx, ctx: Ctx, dep: Row): Promise<{ facts: Row; text: string; band: string }> {
  const sys = sysOf(ctx);
  const env = await environmentOf(tx, ctx, dep.environment_id);
  const prod = isProductionEnv(env);
  const lines: string[] = [];
  let points = 0;
  if (prod) {
    points += 1;
    lines.push("- استقرار در **محیط عملیاتی** است.");
  }
  const change = dep.change_id ? await liveRow(tx, sys, "change_request", dep.change_id) : null;
  if (prod && !change) {
    points += 2;
    lines.push("- تغییر مجازی به این استقرار پیوند نخورده است.");
  } else if (change) {
    if (["high", "very_high"].includes(String(change.risk))) {
      points += 1;
      lines.push(`- ریسک تغییر ${change.number} «${change.risk === "very_high" ? "بسیار زیاد" : "زیاد"}» است.`);
    } else lines.push(`- تغییر ${change.number} پیوند خورده است (ریسک ${String(change.risk ?? "نامعلوم")}).`);
  }
  const recent = dep.service_id ? await liveRows(tx, sys, "deployment", { and: [{ f: "service_id", op: "eq", v: dep.service_id }, { f: "environment_id", op: "eq", v: dep.environment_id }] }, { order: "t.actual_end desc nulls last", limit: 20 }) : [];
  const failed = recent.filter((d) => d.id !== dep.id && DEPLOYMENT_FAILED.includes(String(d.state)));
  if (failed.length) {
    points += Math.min(2, failed.length);
    lines.push(`- ${fa(failed.length)} استقرار اخیر همین خدمت در این محیط ناموفق بوده است (${faList(failed.slice(0, 3).map((d) => String(d.number)))}).`);
  }
  if (!String(dep.rollback_plan ?? "").trim()) {
    points += 1;
    lines.push("- برنامهٔ بازگشت نوشته نشده است.");
  }
  const start = msOf(dep.planned_start) ?? msOf(dep.actual_start);
  if (start !== null) {
    const wd = new Date(start + 3.5 * 3_600_000).getUTCDay();
    if (wd === 4 || wd === 5) {
      points += 0.5;
      lines.push("- زمان استقرار پنجشنبه یا جمعه است و پشتیبانی کمتری در دسترس است.");
    }
  }
  if (dep.approach === "big_bang" && prod) lines.push("- رویکرد یک‌باره است؛ عرضهٔ مرحله‌ای (قناری یا موج‌ها) ریسک را کم می‌کند.");
  const band = points < 1.5 ? "low" : points < 3 ? "medium" : points < 4.5 ? "high" : "very_high";
  const label = { low: "کم", medium: "متوسط", high: "زیاد", very_high: "بسیار زیاد" }[band];
  const text = [`ریسک استقرار ${dep.number ?? ""} «${label}» ارزیابی شد.`, "", ...(lines.length ? lines : ["- عامل ریسک‌زایی دیده نشد."])].join("\n");
  return { facts: { band, points, environment: env?.name ?? null, production: prod, change: change?.number ?? null, change_risk: change?.risk ?? null, recent_failures: failed.length, rollback_plan: !!String(dep.rollback_plan ?? "").trim() }, text, band };
}
