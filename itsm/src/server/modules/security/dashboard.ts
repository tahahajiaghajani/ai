// «داشبورد امنیت و انطباق» (SEC-069): plain counts and rates over the records the caller may read — security
// operations (open by severity and state, MTTD / MTTC / MTTR, false positives, regulatory timeliness), vulnerabilities
// (open by rating, overdue, KEV, SLA %, mean time to remediate, ageing, exceptions, scan coverage), compliance
// (per framework, control pass rate and testing, failing indicators, issues, findings, attestation, policy reviews,
// CSF gap) and risk (by rating, above appetite, completeness, reviews, treatment on time, risk culture, expiring
// acceptances). A section is null when the caller does not read its area. The analytics module wires these as
// indicators at integration; until then they are counts the screens show as they are.
import { percent, sirTimes, VULN_RATING_LABELS, RISK_RATINGS } from "@shared/security/logic";
import { SIR_STATES, SEVERITIES, RISK_RATING_OPTIONS } from "@shared/tables/security";
import type { Count, SecurityDashboard } from "@shared/security/api";
import type { Ctx } from "../../context";
import { countRows, liveRows, readsTable, todayOf, addDays, type Row } from "./common";
import { scanCoverage } from "./vuln";
import { complianceByFramework } from "./grc";

const OPEN_SIR = SIR_STATES.states.filter((s) => ["new", "active", "waiting"].includes(s.category)).map((s) => s.value);
const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const by = (rows: Row[], field: string, options: { value: string; label: string }[]): Count[] =>
  options.map((o) => ({ key: o.value, label: o.label, count: rows.filter((r) => String(r[field] ?? "") === o.value).length })).filter((c) => c.count > 0);

export async function securityDashboard(ctx: Ctx): Promise<SecurityDashboard> {
  const q = ctx.db;
  const out: SecurityDashboard = { ops: null, vuln: null, compliance: null, risk: null };
  const today = todayOf(ctx);

  if (await readsTable(ctx, "sec_incident")) {
    const open = await liveRows(q, ctx, "sec_incident", { f: "state", op: "in", v: OPEN_SIR }, { limit: 10_000 });
    const closed = await liveRows(q, ctx, "sec_incident", { and: [{ f: "state", op: "in", v: ["review", "closed", "canceled"] }, { f: "updated_at", op: "gte", v: since(90) }] }, { limit: 10_000 });
    const fp = closed.filter((r) => r.close_code === "false_positive" || r.close_code === "benign").length;
    const clocks = (await readsTable(ctx, "sec_reg_clock")) ? await liveRows(q, ctx, "sec_reg_clock", { f: "state", op: "ne", v: "not_required" }, { limit: 5000 }) : [];
    let onTime = 0;
    let submitted = 0;
    for (const c of clocks) for (const d of (Array.isArray(c.deadlines) ? c.deadlines : []) as Row[]) {
      if (!d.submitted_at) continue;
      submitted++;
      if (Date.parse(String(d.submitted_at)) <= Date.parse(String(d.due_at))) onTime++;
    }
    out.ops = {
      open: open.length,
      by_severity: by(open, "severity", SEVERITIES),
      by_state: SIR_STATES.states.filter((s) => OPEN_SIR.includes(s.value)).map((s) => ({ key: s.value, label: s.label, count: open.filter((r) => r.state === s.value).length })),
      times: { ...sirTimes(closed), closed: closed.length, false_positive_rate: percent(fp, closed.filter((r) => r.close_code).length) },
      regulatory: { running: clocks.filter((c) => c.state === "running").length, overdue: clocks.filter((c) => c.state === "running" && c.overdue).length, submitted_on_time: onTime, submitted, timeliness: percent(onTime, submitted) },
    };
  }

  if (await readsTable(ctx, "sec_vuln_item")) {
    const open = await liveRows(q, ctx, "sec_vuln_item", { f: "state", op: "in", v: ["open", "in_remediation"] }, { limit: 50_000 });
    const fixed = await liveRows(q, ctx, "sec_vuln_item", { f: "fixed_at", op: "gte", v: since(90) }, { limit: 50_000 });
    const now = Date.now();
    const days = fixed.map((r) => (Date.parse(r.fixed_at) - Date.parse(r.first_detected_at)) / 86_400_000).filter((d) => Number.isFinite(d) && d >= 0);
    const age = (r: Row) => (now - Date.parse(String(r.first_detected_at))) / 86_400_000;
    const buckets: [string, string, (d: number) => boolean][] = [["d30", "کمتر از ۳۰ روز", (d) => d < 30], ["d90", "۳۰ تا ۹۰ روز", (d) => d >= 30 && d < 90], ["d180", "۹۰ تا ۱۸۰ روز", (d) => d >= 90 && d < 180], ["old", "بیش از ۱۸۰ روز", (d) => d >= 180]];
    const exc = (await readsTable(ctx, "sec_vuln_exception")) ? await liveRows(q, ctx, "sec_vuln_exception", { f: "state", op: "in", v: ["requested", "approved"] }, { limit: 5000 }) : [];
    const cov = await scanCoverage(q, ctx).catch(() => ({ in_scope: 0, scanned_7: 0, scanned_30: 0 }));
    out.vuln = {
      open: open.length,
      by_rating: (["critical", "high", "medium", "low"] as const).map((k) => ({ key: k, label: VULN_RATING_LABELS[k], count: open.filter((r) => r.risk_rating === k).length })),
      overdue: open.filter((r) => r.due_at && Date.parse(r.due_at) < now).length,
      kev_open: open.filter((r) => r.kev).length,
      kev_overdue: open.filter((r) => r.kev && r.due_at && Date.parse(r.due_at) < now).length,
      sla_percent: percent(fixed.filter((r) => r.due_at && Date.parse(r.fixed_at) <= Date.parse(r.due_at)).length, fixed.length),
      mttr_days: days.length ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : null,
      ageing: buckets.map(([key, label, f]) => ({ key, label, count: open.filter((r) => f(age(r))).length })),
      exceptions_open: exc.filter((e) => e.state === "approved" && String(e.expires_at) >= today).length + exc.filter((e) => e.state === "requested").length,
      exceptions_expired: exc.filter((e) => e.state === "approved" && String(e.expires_at) < today).length,
      coverage: { in_scope: cov.in_scope, scanned_7: cov.scanned_7, scanned_30: cov.scanned_30 },
    };
  }

  if (await readsTable(ctx, "grc_control")) {
    const controls = await liveRows(q, ctx, "grc_control", { f: "active", op: "eq", v: true }, { limit: 20_000 });
    const tests = (await readsTable(ctx, "grc_control_test")) ? await liveRows(q, ctx, "grc_control_test", { and: [{ f: "state", op: "eq", v: "completed" }, { f: "completed_at", op: "gte", v: since(182) }] }, { limit: 20_000 }) : [];
    const issues = (await readsTable(ctx, "grc_issue")) ? await liveRows(q, ctx, "grc_issue", { f: "state", op: "in", v: ["open", "in_progress", "accepted"] }, { limit: 20_000 }) : [];
    const findings = (await readsTable(ctx, "grc_finding")) ? await liveRows(q, ctx, "grc_finding", { f: "state", op: "in", v: ["open", "action_planned", "in_progress"] }, { limit: 20_000 }) : [];
    const camps = (await readsTable(ctx, "grc_policy_campaign")) ? await liveRows(q, ctx, "grc_policy_campaign", { f: "state", op: "eq", v: "active" }, { limit: 500 }) : [];
    const reviewDue = (await readsTable(ctx, "grc_policy")) ? await countRows(q, ctx, "grc_policy", { and: [{ f: "state", op: "eq", v: "published" }, { f: "next_review_at", op: "lte", v: addDays(today, 30) }] }) : 0;
    const profiles = (await readsTable(ctx, "grc_csf_profile")) ? await liveRows(q, ctx, "grc_csf_profile", { f: "kind", op: "eq", v: "current" }, { order: "t.updated_at desc", limit: 1 }) : [];
    out.compliance = {
      frameworks: await complianceByFramework(ctx),
      controls: controls.length,
      pass_rate: percent(tests.filter((t) => t.conclusion === "effective").length, tests.length),
      tested_6m: percent(controls.filter((c) => c.last_tested_at && Date.parse(c.last_tested_at) >= Date.parse(since(182))).length, controls.length),
      indicators_failing: controls.filter((c) => c.indicator_status === "fail").length,
      issues_open: issues.length,
      issues_overdue: issues.filter((i) => i.due_at && String(i.due_at) < today).length,
      findings_open: findings.length,
      findings_overdue: findings.filter((f) => f.due_at && String(f.due_at) < today).length,
      attestation_rate: percent(camps.reduce((s, c) => s + Number(c.ack_count ?? 0), 0), camps.reduce((s, c) => s + Number(c.audience_count ?? 0), 0)),
      policies_review_due: reviewDue,
      csf_gap: profiles[0] ? Number(profiles[0].gap_total ?? 0) : null,
    };
  }

  if (await readsTable(ctx, "grc_risk")) {
    const open = await liveRows(q, ctx, "grc_risk", { f: "state", op: "nin", v: ["closed", "retired"] }, { limit: 20_000 });
    const complete = open.filter((r) => r.owner_id && r.inherent_likelihood && r.inherent_impact && r.treatment && r.review_due).length;
    const actions = (await readsTable(ctx, "grc_risk_action")) ? await liveRows(q, ctx, "grc_risk_action", { f: "state", op: "in", v: ["open", "in_progress", "done"] }, { limit: 20_000 }) : [];
    const dueActions = actions.filter((a) => a.due_at && String(a.due_at) <= today);
    const acc = (await readsTable(ctx, "grc_risk_acceptance")) ? await countRows(q, ctx, "grc_risk_acceptance", { and: [{ f: "state", op: "eq", v: "active" }, { f: "expires_at", op: "lte", v: addDays(today, 30) }] }) : 0;
    const all = await liveRows(q, ctx, "grc_risk", null, { limit: 20_000 });
    out.risk = {
      open: open.length,
      by_rating: RISK_RATINGS.map((k) => ({ key: k, label: RISK_RATING_OPTIONS.find((o) => o.value === k)?.label ?? k, count: open.filter((r) => r.residual_rating === k).length })).reverse(),
      above_appetite: open.filter((r) => r.above_appetite).length,
      complete_percent: percent(complete, open.length),
      reviewed_6m: percent(open.filter((r) => r.last_reviewed_at && Date.parse(r.last_reviewed_at) >= Date.parse(since(182))).length, open.length),
      actions_on_time: percent(dueActions.filter((a) => a.state === "done" && !a.overdue).length, dueActions.length),
      culture_ratio: percent(all.filter((r) => r.reporter_role === "سایر کارکنان").length, all.length),
      acceptances_expiring: acc,
    };
  }
  return out;
}
