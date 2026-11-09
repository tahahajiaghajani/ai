// Day-one defaults of security operations, vulnerability response and GRC for an organisation (Persian, idempotent):
//   · the settings row and the secure workspace «امنیت»; the groups «مرکز عملیات امنیت» (restricted, in the secure
//     workspace, its members hold «تحلیل‌گر امنیت»), «مدیریت آسیب‌پذیری» and «ریسک و انطباق»
//   · the module's roles beside the built-ins: «مدیر امنیت اطلاعات», «مدیر آسیب‌پذیری», «مدیر ریسک و انطباق»,
//     «مالک ریسک و کنترل», «رفع‌کنندهٔ آسیب‌پذیری» (an organisation's row with the same key is kept as it is)
//   · playbooks for phishing, malware and data leak; the regulatory regimes (Iranian ones as placeholders)
//   · the frameworks (ISO/IEC 27001:2022 Annex A — the 93 controls in Persian —, NIST CSF 2.0, ISO/IEC 20000-1,
//     Iranian placeholders), the 5 × 5 risk matrix, appetite per category and a starter control library mapped across
//     frameworks with continuous-monitoring indicators
//   · SLA definitions (security incidents: response and containment by priority, 24 × 7; vulnerable items: remediation
//     by risk rating from first detection, in calendar days), approval rules (containment actions, vulnerability
//     exceptions, policy publication, policy waivers, risk acceptances), notification rules and a UI policy
// Every item is created only when no live row with its natural key exists; once added, a second run adds nothing
// unless forced («افزودن پیش‌فرض‌ها» re-adds what was deleted).
import { ANNEX_A, APPETITE, CONTROLS, FRAMEWORKS, IMPACT_LABELS, LIKELIHOOD_LABELS, MATRIX_5X5, PLAYBOOKS, REGIMES, REQUIREMENTS_OF } from "@shared/security/frameworks";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import type { SeedCounts } from "../incident";
import { ensureConfigRow, eqAll, liveRows, secureWorkspace, sysOf, type Row } from "./common";

export const SECURITY_SEED_VERSION = 1;

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

const FULL = { read: "all", create: true, write: "all", delete: "all", approve: true, admin: true };
const R = { read: "all" };

/** The module's roles (beside the built-ins; an organisation's own row with the key is left alone). */
export const SECURITY_ROLES: Row[] = [
  {
    key: "security_manager", name: "مدیر امنیت اطلاعات", persona: "agent",
    description: "مدیر ارشد امنیت (CISO): همهٔ رخدادهای امنیتی فضای امن، آسیب‌پذیری‌ها، ریسک و انطباق، با تأیید و تنظیمات",
    grants: { security: FULL, risk: FULL, compliance: FULL, audit: R, cmdb: R, change: R, incident: R, reports: R },
    field_groups: ["internal", "personal", "security"], contains: ["security_analyst"],
  },
  {
    key: "vulnerability_manager", name: "مدیر آسیب‌پذیری", persona: "agent",
    description: "ورود نتیجهٔ پویش، کتابخانهٔ آسیب‌پذیری، گروه‌های رفع، استثناها و تغییرهای رفع",
    grants: { security: { read: "all", create: true, write: "all", approve: true }, cmdb: R, change: { read: "all", create: true, write: "group" }, reports: R },
    field_groups: ["internal"], contains: ["agent"],
  },
  {
    key: "grc_manager", name: "مدیر ریسک و انطباق", persona: "agent",
    description: "چارچوب‌ها و بیانیهٔ کاربست‌پذیری، کنترل‌ها و آزمون‌ها، خط‌مشی‌ها، ممیزی‌ها و ثبت ریسک‌ها",
    grants: { risk: FULL, compliance: FULL, audit: R, reports: R },
    field_groups: ["internal", "personal"], contains: ["agent"],
  },
  {
    key: "risk_owner", name: "مالک ریسک و کنترل", persona: "agent",
    description: "ریسک‌ها و کنترل‌هایی که مالک آن‌هاست: ارزیابی، درمان، پذیرش و آزمون",
    grants: { risk: { read: "own", create: true, write: "own" }, compliance: { read: "all", create: true, write: "own" } },
    field_groups: [], contains: ["requester"],
  },
  {
    key: "vuln_remediator", name: "رفع‌کنندهٔ آسیب‌پذیری", persona: "agent",
    description: "برای گروه‌های پشتیبانی فناوری اطلاعات: موردهای آسیب‌پذیر و گروه‌های رفعی که به گروهشان رسیده است",
    grants: { security: { read: "group", write: "group" } },
    field_groups: [], contains: [],
  },
];

async function roles(tx: Tx, sys: Ctx, out: SeedCounts): Promise<void> {
  for (const r of SECURITY_ROLES) await ensure(tx, sys, out, "role", { key: r.key }, { ...r, workspaces: "member", domains: "own", active: true });
}

async function frameworks(tx: Tx, sys: Ctx, out: SeedCounts): Promise<Map<string, Map<string, string>>> {
  const reqIds = new Map<string, Map<string, string>>();
  for (const fw of FRAMEWORKS) {
    const row = await ensure(tx, sys, out, "grc_framework", { key: fw.key }, { name: fw.name, edition: fw.version, publisher: fw.publisher, kind: fw.kind, placeholder: !!fw.placeholder, description: fw.description, active: true });
    const ids = new Map<string, string>();
    const existing = await liveRows(tx, sys, "grc_requirement", eqAll({ framework_id: row.id }), { limit: 5000 });
    for (const r of existing) ids.set(String(r.code), r.id);
    for (const [i, r] of (REQUIREMENTS_OF[fw.key] ?? []).entries()) {
      if (ids.has(r.code)) continue;
      const made = await createIn(tx, sys, "grc_requirement", { framework_id: row.id, code: r.code, title: r.title, title_en: r.title_en, theme: r.theme, parent_code: r.parent ?? null, level: r.level, sort_order: (i + 1) * 10, applicable: true }, { trusted: true });
      ids.set(r.code, made.id);
      out.created.grc_requirement = (out.created.grc_requirement ?? 0) + 1;
    }
    reqIds.set(fw.key, ids);
  }
  return reqIds;
}

const prio = (v: string[]): Cond => ({ f: "priority", op: "in", v });
const H = 3600;
const D = 86_400;

function slaDefinitions(): Row[] {
  const done: Cond = { f: "state", op: "in", v: ["review", "closed", "canceled"] };
  const common = { type: "sla", duration_mode: "priority", priority_field: "priority", retroactive: true, warn_percents: [50, 75, 90], calendar_id: null };
  return [
    {
      ...common, table_key: "sec_incident", name: "پاسخ به رخداد امنیتی", target: "response", retroactive_field: "opened_at", sort_order: 10,
      durations: { "1": 15 * 60, "2": H, "3": 4 * H, "4": 8 * H, "5": 24 * H },
      start_condition: { f: "state", op: "eq", v: "draft" }, stop_condition: { f: "state", op: "ne", v: "draft" }, cancel_condition: { f: "state", op: "eq", v: "canceled" },
      description: "از ثبت تا شروع تحلیل، شبانه‌روزی",
    },
    {
      ...common, table_key: "sec_incident", name: "مهار رخداد امنیتی", target: "resolution", retroactive_field: "detected_at", sort_order: 20,
      durations: { "1": 4 * H, "2": 8 * H, "3": 24 * H, "4": 72 * H, "5": 120 * H },
      start_condition: { f: "state", op: "in", v: ["draft", "analysis", "contain"] }, stop_condition: { or: [{ f: "contained_at", op: "nempty" }, done] }, cancel_condition: { f: "state", op: "eq", v: "canceled" },
      breach_actions: [{ type: "escalate" }],
      description: "از کشف تا مهار، شبانه‌روزی: اولویت ۱ چهار ساعت",
    },
    {
      ...common, table_key: "sec_vuln_item", name: "رفع آسیب‌پذیری", target: "resolution", priority_field: "risk_rating", retroactive_field: "first_detected_at", sort_order: 10,
      durations: { critical: 15 * D, high: 30 * D, medium: 90 * D, low: 180 * D },
      start_condition: { f: "state", op: "in", v: ["open", "in_remediation"] }, pause_condition: { f: "state", op: "in", v: ["deferred", "exception"] },
      stop_condition: { f: "state", op: "in", v: ["fixed", "closed"] }, cancel_condition: { f: "state", op: "eq", v: "false_positive" },
      description: "روزهای تقویمی از نخستین کشف؛ موردی که دوباره دیده شود ساعت اصلی را ادامه می‌دهد (موعد KEV زودتر باشد، آن معتبر است)",
    },
  ];
}

function approvalRules(soc: string | null, vuln: string | null, grc: string | null): Row[] {
  const lv = (name: string, sources: Row[]) => [{ name, sources, rule: "any" }];
  return [
    { table_key: "sec_task", name: "تأیید اقدام مهار", condition: { and: [{ f: "requires_approval", op: "eq", v: true }, { f: "state", op: "eq", v: "in_progress" }] }, levels: lv("تأیید اقدام مهار", soc ? [{ kind: "groups", groups: [soc] }] : [{ kind: "manager" }]), mode: "sequential", allow_self_approval: false, sort_order: 10, description: "هر اقدام مهار (جداسازی، مسدودسازی، غیرفعال‌سازی…) پیش از انجام، تأیید یک عضو دیگر مرکز عملیات امنیت را می‌خواهد" },
    { table_key: "sec_vuln_exception", name: "تأیید استثنای آسیب‌پذیری (تأییدکنندهٔ نام‌برده)", condition: { and: [{ f: "state", op: "eq", v: "requested" }, { f: "approver_id", op: "nempty" }] }, levels: lv("تأییدکننده", [{ kind: "field", field: "approver_id" }]), mode: "sequential", allow_self_approval: false, sort_order: 10 },
    { table_key: "sec_vuln_exception", name: "تأیید استثنای آسیب‌پذیری (گروه)", condition: { and: [{ f: "state", op: "eq", v: "requested" }, { f: "approver_id", op: "empty" }] }, levels: lv("مدیریت آسیب‌پذیری", vuln ? [{ kind: "groups", groups: [vuln] }] : [{ kind: "manager" }]), mode: "sequential", allow_self_approval: false, sort_order: 20 },
    { table_key: "grc_policy", name: "تأیید انتشار خط‌مشی", condition: { f: "state", op: "eq", v: "review" }, levels: lv("تأییدکنندهٔ خط‌مشی", [{ kind: "field", field: "approver_id" }]), mode: "sequential", allow_self_approval: false, sort_order: 10 },
    { table_key: "grc_policy_exception", name: "تأیید استثنای خط‌مشی", condition: { f: "state", op: "eq", v: "requested" }, levels: lv("تأییدکننده", grc ? [{ kind: "field", field: "approver_id" }, { kind: "groups", groups: [grc] }] : [{ kind: "field", field: "approver_id" }]), mode: "sequential", allow_self_approval: false, sort_order: 10 },
    { table_key: "grc_risk_acceptance", name: "پذیرش ریسک به دست مالک آن", condition: { f: "state", op: "eq", v: "requested" }, levels: lv("مالک ریسک", [{ kind: "field", field: "accepted_by" }]), mode: "sequential", allow_self_approval: true, sort_order: 10 },
  ].map((r) => ({ active: true, expire_after: null, ...r }));
}

function notificationRules(): Row[] {
  const sev: Cond = { f: "severity", op: "in", v: ["1", "2"] };
  return [
    { table_key: "sec_incident", name: "رخداد امنیتی بحرانی یا بالا ثبت شد", event: "created", condition: sev, recipients: { assignment_group: true, group_manager: true, roles: ["security_manager"] }, channels: ["in_app", "email", "sms"], mandatory: true },
    { table_key: "sec_incident", name: "اعلام رخداد امنیتی عمده", event: "custom", custom_event: "security.major_declared", recipients: { event_users: true, assignment_group: true, roles: ["security_manager"] }, channels: ["in_app", "email", "sms"], mandatory: true },
    { table_key: "sec_incident", name: "نزدیک شدن به موعد مهار", event: "sla_warning", condition: sev, recipients: { assignee: true, group_manager: true }, channels: ["in_app"] },
    { table_key: "sec_incident", name: "نقض موعد مهار رخداد امنیتی", event: "sla_breach", recipients: { group_manager: true, roles: ["security_manager"] }, channels: ["in_app", "email"] },
    { table_key: "sec_reg_clock", name: "ساعت اطلاع‌رسانی الزامی شروع شد", event: "created", recipients: { fields: ["owner_id"], roles: ["security_manager"] }, channels: ["in_app", "email"], mandatory: true },
    { table_key: "sec_vuln_item", name: "نقض موعد رفع آسیب‌پذیری بحرانی یا بالا", event: "sla_breach", condition: { f: "risk_rating", op: "in", v: ["critical", "high"] }, recipients: { assignment_group: true, group_manager: true }, channels: ["in_app", "email"] },
    { table_key: "sec_review", name: "بازبینی امنیتی تازه", event: "created", recipients: { assignment_group: true }, channels: ["in_app"] },
    { table_key: "grc_issue", name: "مسئلهٔ حاکمیتی تازه برای مالک", event: "created", recipients: { fields: ["owner_id"] }, channels: ["in_app", "email"] },
    { table_key: "grc_finding", name: "یافتهٔ ممیزی تازه برای مالک اقدام", event: "created", recipients: { fields: ["owner_id"] }, channels: ["in_app", "email"] },
    { table_key: "grc_control_test", name: "آزمون کنترل برنامه‌ریزی شد", event: "created", recipients: { fields: ["tester_id"] }, channels: ["in_app"] },
    { table_key: "grc_risk", name: "ریسک بالا یا بحرانی ثبت شد", event: "created", condition: { f: "residual_rating", op: "in", v: ["high", "critical"] }, recipients: { fields: ["owner_id"], roles: ["grc_manager"] }, channels: ["in_app", "email"] },
  ].map((r) => ({ active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
}

/** Add the defaults inside `tx` as the system. */
export async function seedSecurityDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const config = await ensureConfigRow(tx, sys);
  if (Number(config.seeded ?? 0) >= SECURITY_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const ws = await secureWorkspace(tx, sys);

  await roles(tx, sys, out);
  const soc = await ensure(tx, sys, out, "group", { name: "مرکز عملیات امنیت" }, { types: ["assignment"], restricted: true, workspace_id: ws, roles: ["security_analyst"], description: "پاسخ به رخدادهای امنیتی؛ اعضا در فضای کاری امن «امنیت» کار می‌کنند و نقش تحلیل‌گر امنیت می‌گیرند" });
  const vuln = await ensure(tx, sys, out, "group", { name: "مدیریت آسیب‌پذیری" }, { types: ["assignment", "approval"], description: "ورود پویش‌ها، گروه‌های رفع و تأیید استثناها" });
  const grc = await ensure(tx, sys, out, "group", { name: "ریسک و انطباق" }, { types: ["assignment", "approval"], description: "چارچوب‌ها، کنترل‌ها، خط‌مشی‌ها، ممیزی و ریسک" });

  for (const pb of PLAYBOOKS) await ensure(tx, sys, out, "sec_playbook", { name: pb.name }, { category: pb.category, steps: pb.steps, description: pb.description, active: true, auto_apply: true });
  for (const r of REGIMES) await ensure(tx, sys, out, "sec_reg_regime", { key: r.key }, { name: r.name, authority: r.authority, stages: r.stages, personal_data: !!r.personal_data, placeholder: !!r.placeholder, description: r.description, active: true });

  const reqIds = await frameworks(tx, sys, out);
  await ensure(tx, sys, out, "grc_risk_matrix", { name: "ماتریس ۵ × ۵" }, { revision: 1, is_default: true, likelihood_labels: LIKELIHOOD_LABELS, impact_labels: IMPACT_LABELS, cells: MATRIX_5X5, description: "احتمال × اثر؛ امتیاز ۱ تا ۲۵: کم تا ۴، متوسط تا ۹، بالا تا ۱۴ و بحرانی بیش از آن" });
  for (const a of APPETITE) await ensure(tx, sys, out, "grc_risk_appetite", { category: a.category }, { appetite_score: a.appetite, tolerance_score: a.tolerance, statement: a.statement });
  for (const c of CONTROLS) {
    const requirements = Object.entries(c.maps).flatMap(([fw, codes]) => codes.map((code) => reqIds.get(fw)?.get(code)).filter(Boolean) as string[]);
    await ensure(tx, sys, out, "grc_control", { code: c.code }, {
      name: c.name, objective: c.objective, type: c.type, nature: c.nature, frequency: c.frequency, requirements, assignment_group_id: grc.id, implementation_status: "planned",
      indicator: c.indicator ?? "none", indicator_threshold: c.threshold !== undefined ? String(c.threshold) : null, active: true,
    });
  }

  for (const d of slaDefinitions()) await ensure(tx, sys, out, "sla_definition", { table_key: d.table_key, name: d.name }, d);
  for (const r of approvalRules(soc.id, vuln.id, grc.id)) await ensure(tx, sys, out, "approval_rule", { table_key: r.table_key, name: r.name }, r);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  await ensure(tx, sys, out, "ui_policy", { table_key: "sec_incident", name: "نقض دادهٔ شخصی دامنه می‌خواهد" }, {
    condition: { f: "personal_data_breach", op: "eq", v: true }, actions: [{ field: "affected_data", mandatory: true }, { field: "records_affected", mandatory: true }], sort_order: 100,
  });

  const patch: Row = { seeded: SECURITY_SEED_VERSION };
  if (!config.soc_group_id) patch.soc_group_id = soc.id;
  if (!config.vuln_group_id) patch.vuln_group_id = vuln.id;
  if (!config.grc_group_id) patch.grc_group_id = grc.id;
  await updateIn(tx, sys, "sec_config", config.id, patch, { trusted: true });
  // Annex A is ready to scope: the SoA starts as a draft for the ISMS owner
  void ANNEX_A;
  return out;
}
