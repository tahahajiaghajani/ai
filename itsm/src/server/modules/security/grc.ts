// Governance, risk and compliance services (SEC-028 … SEC-049): requirement and framework status from the control
// library («test once, comply many»), the Statement of Applicability and its approval by the ISMS owner, crosswalks,
// continuous control monitoring over the platform's own data (changes, vulnerabilities, policies, incidents, risks,
// controls) with indicators, KRIs and issues for failures, policy acknowledgement campaigns (audience, «خواندم و
// می‌پذیرم», reminders, the member's own list), the risk heat map and planned control tests.
import { frameworkCompliance, heatMap, indicatorDef, indicatorStatus, kriStatus, percent, requirementStatus, riskRating } from "@shared/security/logic";
import { IMPACT_LABELS, LIKELIHOOD_LABELS, MATRIX_5X5 } from "@shared/security/frameworks";
import type { FrameworkCompliance, MyPolicy, RiskHeatmap, SoaRow } from "@shared/security/api";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { condEnv, createIn, get, orgSchema, RefSet, resolveDisplay, updateIn } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { notifyPeople } from "../notify";
import { activeMembers, expandUnits, groupMembers, unitMembers } from "../knowledge/common";
import { addDays, countRows, eqAll, ids, isUuid, liveRow, liveRows, managesArea, readsArea, sysOf, todayOf, type Row } from "./common";

// ---------------------------------------------------------------------------------------------------------------
// Requirements, frameworks and the SoA

/** Implementation and compliance of requirements from their mapped controls (as the system; stored when changed). */
export async function recomputeRequirements(tx: Tx, ctx: Ctx, reqIds: string[]): Promise<void> {
  const sys = sysOf(ctx);
  const frameworks = new Set<string>();
  for (const id of reqIds.filter(isUuid)) {
    const req = await liveRow(tx, sys, "grc_requirement", id);
    if (!req) continue;
    const ctls = await liveRows(tx, sys, "grc_control", { f: "requirements", op: "eq", v: id }, { limit: 500 });
    const s = requirementStatus(req.applicable !== false, ctls);
    const patch: Row = {};
    if (req.implementation !== s.implementation) patch.implementation = s.implementation;
    if (req.compliance !== s.compliance) patch.compliance = s.compliance;
    if (Number(req.control_count ?? 0) !== ctls.length) patch.control_count = ctls.length;
    if (Object.keys(patch).length) await updateIn(tx, sys, "grc_requirement", id, patch, { trusted: true, keepVersion: true });
    if (isUuid(req.framework_id)) frameworks.add(req.framework_id);
  }
  for (const f of frameworks) await recomputeFramework(tx, ctx, f);
}

/** A framework's requirement count and compliance percentage. */
export async function recomputeFramework(tx: Tx, ctx: Ctx, frameworkId: string): Promise<void> {
  const sys = sysOf(ctx);
  const fw = await liveRow(tx, sys, "grc_framework", frameworkId);
  if (!fw) return;
  const reqs = await liveRows(tx, sys, "grc_requirement", eqAll({ framework_id: frameworkId }), { limit: 5000 });
  const c = frameworkCompliance(reqs);
  const pct = c.percent === null ? null : String(c.percent);
  if (Number(fw.requirement_count ?? 0) !== reqs.length || String(fw.compliance_pct ?? "") !== String(pct ?? "")) {
    await updateIn(tx, sys, "grc_framework", frameworkId, { requirement_count: reqs.length, compliance_pct: pct }, { trusted: true, keepVersion: true });
  }
}

/** Compliance per framework (readable frameworks and requirements only). */
export async function complianceByFramework(ctx: Ctx): Promise<FrameworkCompliance[]> {
  const fws = await liveRows(ctx.db, ctx, "grc_framework", { f: "active", op: "eq", v: true }, { order: "t.name", limit: 100 });
  const out: FrameworkCompliance[] = [];
  for (const fw of fws) {
    const reqs = await liveRows(ctx.db, ctx, "grc_requirement", eqAll({ framework_id: fw.id }), { limit: 5000 });
    const c = frameworkCompliance(reqs);
    out.push({ id: fw.id, key: fw.key, name: fw.name, placeholder: !!fw.placeholder, ...c, soa_approved: reqs.filter((r) => r.soa_state === "approved").length });
  }
  return out;
}

/** The Statement of Applicability of a framework (default ISO 27001 Annex A) with each requirement's controls. */
export async function soaView(ctx: Ctx, frameworkId?: string | null): Promise<{ framework: Row | null; rows: SoaRow[]; display: Record<string, string> }> {
  let fw: Row | null = null;
  if (isUuid(frameworkId)) fw = (await get(ctx, "grc_framework", frameworkId)).row as Row;
  else [fw] = await liveRows(ctx.db, ctx, "grc_framework", eqAll({ key: "iso27001_2022" }), { limit: 1 });
  if (!fw) return { framework: null, rows: [], display: {} };
  const reqs = await liveRows(ctx.db, ctx, "grc_requirement", eqAll({ framework_id: fw.id }), { order: "t.sort_order, t.code", limit: 5000 });
  const ctls = reqs.length ? await liveRows(ctx.db, ctx, "grc_control", { f: "requirements", op: "in", v: reqs.map((r) => r.id).slice(0, 500) }, { limit: 2000 }) : [];
  const refs = new RefSet();
  for (const r of reqs) if (isUuid(r.owner_id)) refs.add("user", r.owner_id);
  const display = await resolveDisplay(ctx.db, ctx, await condEnv(ctx), await orgSchema(ctx), refs);
  return {
    framework: { id: fw.id, key: fw.key, name: fw.name, compliance_pct: fw.compliance_pct ?? null },
    rows: reqs.map((r) => ({
      id: r.id, code: r.code, title: r.title, theme: r.theme ?? null, applicable: r.applicable !== false, justification: r.justification ?? null, implementation: r.implementation ?? "not_assessed",
      compliance: r.compliance ?? "not_assessed", soa_state: r.soa_state ?? "draft", owner_id: r.owner_id ?? null,
      controls: ctls.filter((c) => ids(c.requirements).includes(r.id)).map((c) => ({ id: c.id, number: c.number ?? null, name: c.name, effectiveness: c.effectiveness ?? "not_tested", indicator_status: c.indicator_status ?? "unknown" })),
    })),
    display,
  };
}

/** «تأیید بیانیهٔ کاربست‌پذیری»: the ISMS owner (compliance approve right) approves requirements' applicability. */
export async function approveSoa(ctx: Ctx, reqIds: string[]): Promise<{ approved: number }> {
  if (!(await managesArea(ctx, "compliance"))) throw forbidden("تأیید بیانیهٔ کاربست‌پذیری با مالک سامانهٔ مدیریت امنیت اطلاعات است");
  const list = [...new Set(reqIds.filter(isUuid))].slice(0, 500);
  if (!list.length) throw bad("الزامی انتخاب نشده است");
  const rows = await liveRows(ctx.db, ctx, "grc_requirement", { and: [{ f: "id", op: "in", v: list }, { f: "soa_state", op: "ne", v: "approved" }] }, { limit: 500 });
  const missing = rows.filter((r) => r.applicable === false && !String(r.justification ?? "").trim());
  if (missing.length) throw bad(`برای کنارگذاشتن این الزام‌ها توجیه لازم است: ${missing.slice(0, 5).map((r) => r.code).join("، ")}`);
  const sys = sysOf(ctx, ctx.user.id);
  const now = new Date().toISOString();
  await ctx.write(async (tx) => {
    for (const r of rows) await updateIn(tx, sys, "grc_requirement", r.id, { soa_state: "approved", soa_approved_by: ctx.user.id, soa_approved_at: now }, { trusted: true });
  });
  return { approved: rows.length };
}

/** A control's requirements grouped by framework (the crosswalk of «یک بار آزمون، چند بار انطباق»). */
export async function crosswalk(ctx: Ctx, controlId: string) {
  const ctl = (await get(ctx, "grc_control", controlId)).row as Row;
  const reqs = ids(ctl.requirements).length ? await liveRows(ctx.db, ctx, "grc_requirement", { f: "id", op: "in", v: ids(ctl.requirements) }, { order: "t.sort_order, t.code", limit: 500 }) : [];
  const fws = new Map<string, Row>();
  for (const r of reqs) if (isUuid(r.framework_id) && !fws.has(r.framework_id)) fws.set(r.framework_id, (await liveRow(ctx.db, ctx, "grc_framework", r.framework_id)) ?? { id: r.framework_id, name: "—" });
  return [...fws.values()].map((fw) => ({ framework_id: fw.id, framework: fw.name, requirements: reqs.filter((r) => r.framework_id === fw.id).map((r) => ({ id: r.id, code: r.code, title: r.title, compliance: r.compliance })) }));
}

// ---------------------------------------------------------------------------------------------------------------
// Continuous control monitoring (SEC-038) and KRIs (SEC-045)

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const has = (table: string) => !!tableDef(table);

/** The value of a built-in indicator, measured over the organisation's own records (as the system). */
export async function indicatorValue(sys: Ctx, key: string): Promise<number | null> {
  const q = sys.db;
  const today = todayOf(sys);
  switch (key) {
    case "vuln_sla": {
      const fixed = await liveRows(q, sys, "sec_vuln_item", { and: [{ f: "fixed_at", op: "gte", v: since(90) }] }, { limit: 20_000 });
      return percent(fixed.filter((r) => r.due_at && Date.parse(r.fixed_at) <= Date.parse(r.due_at)).length, fixed.length);
    }
    case "kev_overdue":
      return countRows(q, sys, "sec_vuln_item", { and: [{ f: "kev", op: "eq", v: true }, { f: "state", op: "in", v: ["open", "in_remediation"] }, { f: "due_at", op: "lt", v: new Date().toISOString() }] });
    case "critical_open_overdue":
      return countRows(q, sys, "sec_vuln_item", { and: [{ f: "risk_rating", op: "eq", v: "critical" }, { f: "state", op: "in", v: ["open", "in_remediation"] }, { f: "due_at", op: "lt", v: new Date().toISOString() }] });
    case "change_approved": {
      if (!has("change_request")) return null;
      const done = await liveRows(q, sys, "change_request", { and: [{ f: "state", op: "in", v: ["review", "closed"] }, { f: "updated_at", op: "gte", v: since(90) }, { f: "type", op: "ne", v: "standard" }] }, { limit: 20_000 });
      return percent(done.filter((c) => c.approval === "approved" || c.type === "latent").length, done.length);
    }
    case "policy_ack": {
      const camps = await liveRows(q, sys, "grc_policy_campaign", { f: "state", op: "eq", v: "active" }, { limit: 200 });
      const aud = camps.reduce((s, c) => s + Number(c.audience_count ?? 0), 0);
      return percent(camps.reduce((s, c) => s + Number(c.ack_count ?? 0), 0), aud);
    }
    case "sir_contained": {
      const rows = await liveRows(q, sys, "sec_incident", { and: [{ f: "contained_at", op: "gte", v: since(90) }] }, { limit: 5000 });
      return percent(rows.filter((r) => !r.sla_due || Date.parse(r.contained_at) <= Date.parse(r.sla_due)).length, rows.length);
    }
    case "sir_lessons": {
      const rows = await liveRows(q, sys, "sec_incident", { and: [{ f: "state", op: "eq", v: "closed" }, { f: "close_code", op: "eq", v: "true_positive" }, { f: "closed_at", op: "gte", v: since(90) }] }, { limit: 5000 });
      return percent(rows.filter((r) => String(r.lessons ?? "").trim()).length, rows.length);
    }
    case "risk_reviewed": {
      const rows = await liveRows(q, sys, "grc_risk", { f: "state", op: "nin", v: ["closed", "retired"] }, { limit: 20_000 });
      return percent(rows.filter((r) => r.last_reviewed_at && Date.parse(r.last_reviewed_at) >= Date.parse(since(182))).length, rows.length);
    }
    case "risk_above_appetite":
      return countRows(q, sys, "grc_risk", { and: [{ f: "above_appetite", op: "eq", v: true }, { f: "state", op: "nin", v: ["closed", "retired"] }] });
    case "controls_tested": {
      const rows = await liveRows(q, sys, "grc_control", { f: "active", op: "eq", v: true }, { limit: 20_000 });
      return percent(rows.filter((r) => r.last_tested_at && Date.parse(r.last_tested_at) >= Date.parse(since(182))).length, rows.length);
    }
    case "exceptions_expired": {
      const a = await countRows(q, sys, "sec_vuln_exception", { and: [{ f: "state", op: "eq", v: "approved" }, { f: "expires_at", op: "lt", v: today }] });
      const b = await countRows(q, sys, "grc_policy_exception", { and: [{ f: "state", op: "eq", v: "approved" }, { f: "expires_at", op: "lt", v: today }] });
      return a + b;
    }
    case "findings_overdue":
      return countRows(q, sys, "grc_finding", { and: [{ f: "state", op: "in", v: ["open", "action_planned", "in_progress"] }, { f: "due_at", op: "lt", v: today }] });
    default:
      return null;
  }
}

/**
 * Measure every indicator the controls and KRIs use (once each), store the values and statuses, and open an issue for
 * a control whose indicator fails (one open issue per control).
 */
export async function measureIndicators(sys: Ctx): Promise<{ measured: number; failing: number; issues: number }> {
  const q = sys.db;
  const controls = await liveRows(q, sys, "grc_control", { and: [{ f: "indicator", op: "nempty" }, { f: "indicator", op: "ne", v: "none" }, { f: "active", op: "eq", v: true }] }, { limit: 2000 });
  const kris = await liveRows(q, sys, "grc_kri", null, { limit: 2000 });
  const keys = new Set([...controls.map((c) => String(c.indicator)), ...kris.map((k) => String(k.indicator))]);
  const values = new Map<string, number | null>();
  for (const k of keys) values.set(k, await indicatorValue(sys, k).catch(() => null));
  const now = new Date().toISOString();
  let failing = 0;
  let issues = 0;
  await sys.write(async (tx) => {
    for (const c of controls) {
      const def = indicatorDef(c.indicator);
      if (!def) continue;
      const v = values.get(def.key) ?? null;
      const threshold = c.indicator_threshold !== null && c.indicator_threshold !== undefined && c.indicator_threshold !== "" ? Number(c.indicator_threshold) : def.threshold;
      const status = indicatorStatus(v, threshold, def.direction);
      if (status === "fail") failing++;
      await updateIn(tx, sys, "grc_control", c.id, { indicator_value: v === null ? null : String(v), indicator_status: status, indicator_at: now }, { trusted: true, keepVersion: true });
      if (status === "fail") {
        const [open] = await liveRows(tx, sys, "grc_issue", { and: [{ f: "control_id", op: "eq", v: c.id }, { f: "source", op: "eq", v: "indicator" }, { f: "state", op: "in", v: ["open", "in_progress", "accepted"] }] }, { limit: 1 });
        if (!open) {
          await createIn(tx, sys, "grc_issue", {
            title: `پایش خودکار: «${def.label}» برای کنترل «${String(c.name).slice(0, 120)}» برقرار نیست`, source: "indicator", severity: "medium", control_id: c.id,
            owner_id: c.owner_id ?? null, assignment_group_id: c.assignment_group_id ?? null, due_at: addDays(todayOf(sys), 30),
            description: `مقدار سنجیده: ${v ?? "—"} — آستانه: ${threshold}${def.unit === "percent" ? "٪" : ""}. ${def.description}`,
          }, { trusted: true });
          issues++;
        }
      }
    }
    for (const k of kris) {
      const v = values.get(String(k.indicator)) ?? null;
      const status = kriStatus(v, k.warn_at, k.breach_at, k.direction === "lower_worse" ? "lower_worse" : "higher_worse");
      if (String(k.last_value ?? "") !== String(v ?? "") || k.status !== status) await updateIn(tx, sys, "grc_kri", k.id, { last_value: v === null ? null : String(v), status, measured_at: now }, { trusted: true });
    }
  });
  return { measured: keys.size, failing, issues };
}

/** Plan the next test of controls due within two weeks that have no open test (SEC-037). */
export async function planControlTests(sys: Ctx): Promise<number> {
  const horizon = addDays(todayOf(sys), 14);
  const due = await liveRows(sys.db, sys, "grc_control", { and: [{ f: "active", op: "eq", v: true }, { f: "next_test_due", op: "lte", v: horizon }] }, { limit: 500 });
  let made = 0;
  for (const c of due) {
    const [open] = await liveRows(sys.db, sys, "grc_control_test", { and: [{ f: "control_id", op: "eq", v: c.id }, { f: "state", op: "in", v: ["planned", "in_progress"] }] }, { limit: 1 });
    if (open) continue;
    await sys.write((tx) => createIn(tx, sys, "grc_control_test", { control_id: c.id, kind: c.nature === "automated" ? "operating" : "self_assessment", planned_for: c.next_test_due, tester_id: c.owner_id ?? null }, { trusted: true }));
    made++;
  }
  return made;
}

// ---------------------------------------------------------------------------------------------------------------
// Policy acknowledgement campaigns (SEC-032)

/** Everyone a campaign addresses (active members): all, or its people, groups and units with their sub-units. */
export async function campaignAudience(q: Queryable, ctx: Ctx, camp: Row): Promise<string[]> {
  const sys = sysOf(ctx);
  if (camp.target_all) {
    const rows = await q.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and is_active and deleted_at is null`, [ctx.org.id]);
    return rows.map((r) => r.user_id);
  }
  const units = await expandUnits(q, sys, camp.target_units, true);
  const people = [...new Set([...ids(camp.target_users), ...(await groupMembers(q, sys, camp.target_groups)), ...(await unitMembers(q, sys, units))])];
  const active = await activeMembers(q, ctx.org.id, people);
  return people.filter((p) => active.has(p));
}

async function ackedBy(q: Queryable, ctx: Ctx, campId: string): Promise<Set<string>> {
  const rows = await liveRows(q, sysOf(ctx), "grc_policy_ack", eqAll({ campaign_id: campId }), { limit: 100_000 });
  return new Set(rows.map((r) => String(r.user_id)));
}

/** The member's running campaigns (and those of the last months they answered), with the policy's published text. */
export async function myPolicies(ctx: Ctx): Promise<MyPolicy[]> {
  if (ctx.actor === "system") return [];
  const sys = sysOf(ctx);
  const camps = await liveRows(ctx.db, sys, "grc_policy_campaign", { f: "state", op: "eq", v: "active" }, { order: "t.due_at", limit: 200 });
  const today = todayOf(ctx);
  const out: MyPolicy[] = [];
  for (const c of camps) {
    if (!(await campaignAudience(ctx.db, ctx, c)).includes(ctx.user.id)) continue;
    const pol = await liveRow(ctx.db, sys, "grc_policy", c.policy_id);
    if (!pol || pol.state !== "published") continue;
    const [ack] = await liveRows(ctx.db, sys, "grc_policy_ack", eqAll({ campaign_id: c.id, user_id: ctx.user.id }), { limit: 1 });
    out.push({
      campaign_id: c.id, campaign_number: c.number ?? null, title: c.title, policy_id: pol.id, policy_title: pol.title, version_label: c.version_label ?? pol.version_label ?? null,
      summary: pol.summary ?? null, body: pol.body ?? null, due_at: c.due_at ?? null, acked_at: ack?.acked_at ?? null, overdue: !ack && String(c.due_at ?? "") < today,
    });
  }
  return out;
}

/** «خواندم و می‌پذیرم» for the version in force (the member must be addressed by the running campaign). */
export async function acknowledgePolicy(ctx: Ctx, campaignId: string): Promise<{ ok: true; acked_at: string }> {
  if (ctx.actor === "system") throw bad("پذیرش خط‌مشی با خود عضو است");
  const sys = sysOf(ctx);
  const camp = await liveRow(ctx.db, sys, "grc_policy_campaign", campaignId);
  if (!camp || camp.state !== "active") throw bad("این کارزار در جریان نیست");
  const aud = await campaignAudience(ctx.db, ctx, camp);
  if (!aud.includes(ctx.user.id)) throw forbidden("این کارزار شما را در بر نمی‌گیرد");
  const done = await ackedBy(ctx.db, ctx, campaignId);
  const at = new Date().toISOString();
  if (done.has(ctx.user.id)) return { ok: true, acked_at: at };
  const by = sysOf(ctx, ctx.user.id);
  await by.write(async (tx) => {
    await createIn(tx, by, "grc_policy_ack", { campaign_id: campaignId, policy_id: camp.policy_id, user_id: ctx.user.id, version_label: camp.version_label ?? null, acked_at: at }, { trusted: true });
    await updateIn(tx, by, "grc_policy_campaign", campaignId, { ack_count: done.size + 1, audience_count: aud.length }, { trusted: true, keepVersion: true });
  });
  return { ok: true, acked_at: at };
}

/** Who has and has not acknowledged (for those who read the campaign); the counts are refreshed. */
export async function campaignStatus(ctx: Ctx, campaignId: string) {
  const camp = (await get(ctx, "grc_policy_campaign", campaignId)).row as Row;
  const aud = await campaignAudience(ctx.db, ctx, camp);
  const done = await ackedBy(ctx.db, ctx, campaignId);
  const pending = aud.filter((u) => !done.has(u));
  if (Number(camp.audience_count) !== aud.length || Number(camp.ack_count) !== done.size) {
    const sys = sysOf(ctx);
    await sys.write((tx) => updateIn(tx, sys, "grc_policy_campaign", campaignId, { audience_count: aud.length, ack_count: aud.filter((u) => done.has(u)).length }, { trusted: true, keepVersion: true }));
  }
  const refs = new RefSet();
  for (const u of pending.slice(0, 200)) refs.add("user", u);
  const display = await resolveDisplay(ctx.db, ctx, await condEnv(ctx), await orgSchema(ctx), refs);
  return { audience: aud.length, acknowledged: aud.filter((u) => done.has(u)).length, rate: percent(aud.filter((u) => done.has(u)).length, aud.length), pending: pending.slice(0, 200), display };
}

/** Reminders of running campaigns to those who have not answered, every `remind_every_days` (the sweep). */
export async function remindCampaigns(sys: Ctx): Promise<number> {
  const camps = await liveRows(sys.db, sys, "grc_policy_campaign", { f: "state", op: "eq", v: "active" }, { limit: 200 });
  let sent = 0;
  for (const c of camps) {
    const every = Number(c.remind_every_days ?? 0);
    if (every <= 0 || (c.reminded_at && Date.now() - Date.parse(c.reminded_at) < every * 86_400_000)) continue;
    const aud = await campaignAudience(sys.db, sys, c);
    const done = await ackedBy(sys.db, sys, c.id);
    const pending = aud.filter((u) => !done.has(u));
    await sys.write(async (tx) => {
      if (pending.length) {
        // the campaign record is compliance's: the reminder names the policy and points to «خط‌مشی‌های من»
        sent += await notifyPeople(tx, sys.org.id, { table: "grc_policy_campaign", id: c.id, users: pending, event: "custom", label: "پذیرش خط‌مشی", subject: `لطفاً «${String(c.title).slice(0, 120)}» را بخوانید و بپذیرید`, body: `موعد: ${c.due_at}. از «خط‌مشی‌های من» متن را بخوانید و «خواندم و می‌پذیرم» را بزنید.`, channels: ["in_app", "email"], source: "امنیت و انطباق" });
      }
      await updateIn(tx, sys, "grc_policy_campaign", c.id, { reminded_at: new Date().toISOString(), audience_count: aud.length, ack_count: aud.filter((u) => done.has(u)).length }, { trusted: true, keepVersion: true });
    });
  }
  return sent;
}

// ---------------------------------------------------------------------------------------------------------------
// Risk heat map (SEC-043)

export async function riskHeatmap(ctx: Ctx): Promise<RiskHeatmap> {
  if (!(await readsArea(ctx, "risk"))) throw forbidden("به ثبت ریسک‌ها دسترسی ندارید");
  const rows = await liveRows(ctx.db, ctx, "grc_risk", { f: "state", op: "nin", v: ["closed", "retired"] }, { limit: 20_000 });
  const [matrix] = await liveRows(ctx.db, sysOf(ctx), "grc_risk_matrix", { f: "is_default", op: "eq", v: true }, { order: "t.created_at", limit: 1 });
  const cells = (matrix?.cells as string[][] | undefined) ?? MATRIX_5X5;
  const toCells = (grid: number[][]) => grid.flatMap((row, l) => row.map((count, i) => ({ likelihood: l + 1, impact: i + 1, count, rating: riskRating(cells, l + 1, i + 1) })));
  const above = rows.filter((r) => r.above_appetite === true).sort((a, b) => Number(b.residual_score ?? 0) - Number(a.residual_score ?? 0));
  const refs = new RefSet();
  for (const r of above.slice(0, 50)) if (isUuid(r.owner_id)) refs.add("user", r.owner_id);
  const display = await resolveDisplay(ctx.db, ctx, await condEnv(ctx), await orgSchema(ctx), refs);
  const cats = new Map<string, number>();
  for (const r of rows) cats.set(String(r.category ?? "—"), (cats.get(String(r.category ?? "—")) ?? 0) + 1);
  return {
    likelihood_labels: Array.isArray(matrix?.likelihood_labels) ? matrix!.likelihood_labels : LIKELIHOOD_LABELS,
    impact_labels: Array.isArray(matrix?.impact_labels) ? matrix!.impact_labels : IMPACT_LABELS,
    inherent: toCells(heatMap(rows.map((r) => ({ likelihood: r.inherent_likelihood, impact: r.inherent_impact })))),
    residual: toCells(heatMap(rows.map((r) => ({ likelihood: r.residual_likelihood, impact: r.residual_impact })))),
    above_appetite: above.slice(0, 50).map((r) => ({ id: r.id, number: r.number ?? null, title: r.title, residual_score: r.residual_score ?? null, appetite_score: r.appetite_score ?? null, owner_id: r.owner_id ?? null })),
    by_category: [...cats.entries()].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count),
    display,
  };
}
