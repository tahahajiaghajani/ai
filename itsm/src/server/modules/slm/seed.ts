// Day-one defaults of service level management (Persian, idempotent, as the system):
//   · the settings row (slm_config) — it also records that the defaults were added (`seeded`)
//   · the organisation role «مدیر سطح خدمت» (service_level_manager: agreements in the portfolio's area, targets,
//     reviews, the improvement register and credits)
//   · agreement templates: SLA gold / silver / bronze for IT services, an OLA for support teams, an underpinning
//     contract for suppliers — each with its document skeleton and targets
//   · XLA policies for incidents and requested items (when those tables exist)
//   · the continual improvement register: a plan for the current Jalali year with three starter items
//   · the approval rule of agreements (the service's owner), notification rules (at risk, review due, expiry, active,
//     review scheduled and pack ready, low experience, credits), the SLA of improvement proposals, a flow template
//     (a missed agreement → an improvement item and a message to its owner) and the module's analytics indicators
// Every item is created only when no live row with its natural key exists; once added, a second run adds nothing
// unless forced.
import { currentJalaliYear, todayISO, jalaliYearRange } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, savepoint, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { eqAll, liveRows, slmConfig, sysOf, type Row } from "./common";

/** 1: templates, XLA policies, CSI plan, role, rules, SLA, flow, indicators. */
export const SLM_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Row, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

const H = 3600;

export const SLM_ROLES: Row[] = [
  {
    key: "service_level_manager", name: "مدیر سطح خدمت", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "توافق‌های سطح خدمت، عملیات و پشتیبان: اهداف، سنجش، بازبینی با مشتری، ثبت بهبود مستمر و جریمه‌ها",
    grants: {
      sla: { read: "all", create: true, write: "all", delete: "all", approve: true, admin: true },
      service: { read: "all", create: true, write: "all", approve: true },
      survey: { read: "all" },
      reports: { read: "all", create: true, write: "own" },
    },
    field_groups: ["financial", "internal", "personal"], contains: ["agent"],
  },
];

const DOC = {
  hours: "ساعات اداری شنبه تا چهارشنبه ۸:۰۰ تا ۱۶:۰۰ و پنجشنبه ۸:۰۰ تا ۱۲:۰۰، به‌جز تعطیلات رسمی. رخدادهای بحرانی شبانه‌روزی پاسخ داده می‌شوند.",
  responsibilities: "**ارائه‌دهنده:** پاسخ و حل در موعدهای این توافق، اطلاع‌رسانی قطعی‌ها و تغییرهای برنامه‌ریزی‌شده، گزارش دوره‌ای.\n\n**مشتری:** ثبت درخواست‌ها از درگاه یا میز خدمت، در دسترس بودن برای پاسخ به پرسش‌ها، معرفی نماینده برای بازبینی‌ها.",
  escalation: "سطح ۱: کارشناس میز خدمت · سطح ۲: سرپرست گروه پشتیبانی · سطح ۳: مدیر سطح خدمت · سطح ۴: مدیر فناوری اطلاعات",
  exclusions: "قطعی‌های برنامه‌ریزی‌شدهٔ اعلام‌شده، رویدادهای قهری، مشکل‌های ناشی از تغییرهای بی‌هماهنگی مشتری و زمان انتظار برای پاسخ مشتری از سنجش بیرون است.",
};

interface TemplateSeed {
  name: string;
  kind: string;
  level: string;
  description: string;
  compliance: number;
  atRisk: number;
  period: string;
  review: number;
  targets: Row[];
  terms: string;
}

const timer = (name: string, target: "response" | "resolution", hours: number[], goal: number, extra: Row = {}): Row => ({
  name, kind: "timer", metric_category: "warranty", table_key: "incident", timer_target: target, goal,
  p1_hours: hours[0] ?? null, p2_hours: hours[1] ?? null, p3_hours: hours[2] ?? null, p4_hours: hours[3] ?? null, p5_hours: hours[4] ?? null, ...extra,
});

export function templates(): TemplateSeed[] {
  return [
    {
      name: "توافق سطح خدمت طلایی — خدمات فناوری اطلاعات", kind: "sla", level: "gold", compliance: 97, atRisk: 98.5, period: "month", review: 1,
      description: "خدمت‌های حیاتی: پاسخ و حل سریع، دسترس‌پذیری بالا و هدف تجربه",
      terms: "این توافق سطح خدمت پاسخ و حل رخدادها و درخواست‌های خدمت را با سطح «طلایی» تضمین می‌کند.",
      targets: [
        timer("پاسخ نخست به رخداد", "response", [0.25, 0.5, 2, 4], 97, { sort_order: 10 }),
        timer("حل رخداد", "resolution", [4, 8, 24, 48], 95, { sort_order: 20 }),
        { name: "دسترس‌پذیری خدمت", kind: "availability", metric_category: "warranty", goal: 99.9, sort_order: 30 },
        { name: "امتیاز تجربهٔ کاربران (XLA)", kind: "experience", metric_category: "experience", goal: 80, xla_clause: "target", sort_order: 40 },
      ],
    },
    {
      name: "توافق سطح خدمت نقره‌ای — خدمات فناوری اطلاعات", kind: "sla", level: "silver", compliance: 95, atRisk: 97, period: "month", review: 3,
      description: "خدمت‌های مهم کسب‌وکار در ساعات اداری",
      terms: "این توافق سطح خدمت پاسخ و حل رخدادها را با سطح «نقره‌ای» در ساعات اداری تضمین می‌کند.",
      targets: [
        timer("پاسخ نخست به رخداد", "response", [0.5, 1, 4, 8], 95, { sort_order: 10 }),
        timer("حل رخداد", "resolution", [8, 16, 40, 80], 92, { sort_order: 20 }),
        { name: "دسترس‌پذیری خدمت", kind: "availability", metric_category: "warranty", goal: 99.5, sort_order: 30 },
        { name: "رضایت درخواست‌کنندگان", kind: "satisfaction", metric_category: "experience", goal: 85, sort_order: 40 },
      ],
    },
    {
      name: "توافق سطح خدمت برنزی — خدمات فناوری اطلاعات", kind: "sla", level: "bronze", compliance: 90, atRisk: 93, period: "quarter", review: 6,
      description: "خدمت‌های پشتیبان با موعدهای بلندتر",
      terms: "این توافق سطح خدمت پاسخ و حل رخدادها را با سطح «برنزی» در ساعات اداری تضمین می‌کند.",
      targets: [timer("پاسخ نخست به رخداد", "response", [1, 4, 8, 16], 90, { sort_order: 10 }), timer("حل رخداد", "resolution", [16, 40, 80, 160], 88, { sort_order: 20 })],
    },
    {
      name: "توافق سطح عملیات (OLA) — گروه پشتیبانی", kind: "ola", level: "standard", compliance: 95, atRisk: 97, period: "month", review: 3,
      description: "زمان رسیدگی یک گروه پشتیبانی به کارهای ارجاع‌شده به آن، در خدمت توافق‌های مشتری",
      terms: "گروه ارائه‌دهنده کارهای ارجاع‌شده به خود را در موعدهای این توافق برمی‌دارد و حل می‌کند؛ زمان‌سنج‌ها با ارجاع به گروه آغاز و با ارجاع به گروه دیگر یا حل، متوقف می‌شوند.",
      targets: [
        timer("پذیرش کار ارجاع‌شده", "response", [0.25, 0.5, 2, 4], 95, { sort_order: 10, customer_facing: false }),
        timer("حل در گروه", "resolution", [3, 6, 16, 32], 92, { sort_order: 20, customer_facing: false }),
      ],
    },
    {
      name: "قرارداد پشتیبان (UC) — پیمانکار", kind: "uc", level: "standard", compliance: 95, atRisk: 97, period: "month", review: 3,
      description: "تعهدهای تأمین‌کنندهٔ بیرونی که توافق‌های مشتری بر آن تکیه دارند",
      terms: "تأمین‌کننده کارهای ارجاع‌شده به گروه پیمانکار را در موعدهای این قرارداد حل می‌کند؛ نقض‌ها در بازبینی تأمین‌کننده و محاسبهٔ جریمه به کار می‌روند.",
      targets: [timer("حل توسط پیمانکار", "resolution", [4, 8, 24, 72], 95, { sort_order: 10, customer_facing: false, credit_tiers: [{ below: 95, pct: 5 }, { below: 90, pct: 10 }] })],
    },
  ];
}

export function xlaPolicies(): Row[] {
  const out: Row[] = [];
  if (tableDef("incident")) {
    out.push({ name: "تجربهٔ رخدادها", table_key: "incident", sort_order: 10, threshold: 50, description: "اطمینان (نقض و بازگشایی)، کیفیت (ارجاع دوباره و پاسخ نخست) و زحمت درخواست‌کننده (پیگیری‌ها یا پاسخ نظرسنجی)" });
  }
  if (tableDef("request_item")) {
    out.push({ name: "تجربهٔ درخواست‌های خدمت", table_key: "request_item", sort_order: 10, threshold: 50, response_hours: "8", p_late_response: 10, description: "تجربهٔ درخواست‌کنندگان از انجام درخواست‌های خدمت" });
  }
  return out;
}

export function approvalRules(): Row[] {
  return [{
    table_key: "service_agreement", name: "تأیید توافق ← مالک خدمت", sort_order: 10, mode: "sequential", expire_after: 7 * 24 * H, remind_every: 24 * H, expire_action: "reject",
    condition: { f: "state", op: "eq", v: "awaiting_approval" }, active: true, allow_self_approval: false,
    levels: [{ name: "مالک خدمت", sources: [{ kind: "owner", of: "service_owner" }], rule: "any" }],
    description: "مالک خدمتِ توافق نسخهٔ تازه را تأیید می‌کند؛ تأیید، توافق را به «ابلاغ و آماده‌سازی» و رد، به «مذاکره» برمی‌گرداند.",
  }];
}

export function notificationRules(): Row[] {
  const custom = (custom_event: string) => ({ event: "custom", custom_event });
  const rules: Row[] = [
    { table_key: "service_agreement", name: "انطباق توافق در خطر است", ...custom("slm.at_risk"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "service_agreement", name: "موعد بازبینی توافق نزدیک است", ...custom("slm.review_due"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "service_agreement", name: "اعتبار توافق رو به پایان است", ...custom("slm.expiring"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "service_agreement", name: "توافق اجرا شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "active" }, recipients: { fields: ["manager_id", "customer_contact_id"] }, channels: ["in_app", "email"] },
    { table_key: "slm_review", name: "بازبینی خدمت برنامه‌ریزی شد", event: "created", recipients: { fields: ["chair_id", "attendees"] }, channels: ["in_app", "email"] },
    { table_key: "slm_review", name: "بستهٔ بازبینی خدمت آماده است", event: "state_changed", condition: { f: "state", op: "changes_to", v: "prepared" }, recipients: { fields: ["chair_id", "attendees"] }, channels: ["in_app", "email"] },
    { table_key: "slm_credit", name: "جریمهٔ خدمت محاسبه شد", event: "created", recipients: { fields: ["manager_id"] }, channels: ["in_app", "email"] },
  ];
  for (const t of ["incident", "request_item"]) if (tableDef(t)) rules.push({ table_key: t, name: "تجربهٔ درخواست‌کننده از این رکورد پایین است", ...custom("slm.xla_low"), recipients: { event_users: true }, channels: ["in_app"] });
  return rules;
}

/** The flow template: a missed agreement opens an improvement item and tells its owner (inactive until published). */
export const MISSED_AGREEMENT_FLOW = (): Row => ({
  name: "توافق برآورده نشد ← قلم بهبود و خبر به مالک",
  active: false,
  description: "الگو: وقتی انطباق دورهٔ جاری یک توافق «برآورده نشد» می‌شود، یک قلم بهبود در ثبت بهبود مستمر ساخته و مالک توافق خبردار می‌شود. پیش از استفاده منتشر و فعال کنید.",
  trigger: "record",
  trigger_table: "service_agreement",
  trigger_events: ["updated"],
  trigger_fields: ["compliance_status"],
  trigger_condition: { f: "compliance_status", op: "eq", v: "missed" },
  run_as: "trigger_user",
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } },
      {
        id: "create1", type: "create_record", label: "قلم بهبود", position: { x: 0, y: 140 },
        config: { table: "slm_improvement", values: { short_description: "بازگرداندن توافق {{trigger.record.number}} به هدف", source: "breach", agreement_id: "{{trigger.record.id}}" } },
      },
      {
        id: "notify1", type: "notify", label: "خبر به مالک توافق", position: { x: 0, y: 280 },
        config: { to: { fields: ["manager_id"] }, subject: "توافق {{trigger.record.number}} در این دوره برآورده نشد", body: "انطباق دورهٔ جاری توافق «{{trigger.record.name}}» زیر هدف است؛ یک قلم بهبود برای آن ساخته شد." },
      },
    ],
    edges: [{ id: "trigger-out-create1", source: "trigger", target: "create1" }, { id: "create1-out-notify1", source: "create1", target: "notify1" }],
    layout: { direction: "TB" },
  },
});

/** The module's indicators for analytics (SLM KPIs over the SLA service's timers and the module's tables). */
export function indicators(): Row[] {
  const readers = ["service_level_manager", "service_desk_manager", "tenant_admin"].map((id) => ({ kind: "role", id, right: "view" }));
  const timerParts = (type: string | null) => {
    const scope = type ? [{ f: "type", op: "eq", v: type }] : [];
    return [
      { name: "met", table: "task_sla", fn: "count", date_field: "stop_at", filter: { and: [...scope, { f: "stage", op: "eq", v: "achieved" }] } },
      { name: "finished", table: "task_sla", fn: "count", date_field: "stop_at", filter: { and: [...scope, { f: "stage", op: "in", v: ["achieved", "breached"] }] } },
    ];
  };
  return [
    { key: "slm.attainment", name: "دستیابی به اهداف سطح خدمت (همهٔ زمان‌سنج‌ها)", practice: "sla", unit: "percent", direction: "up", grain: "month", formula: "met / finished * 100", parts: timerParts(null), target: 95, warn: 92, crit: 88, breakdowns: ["table_key", "type"], description: "سهم زمان‌سنج‌های پایان‌یافتهٔ دوره که در موعد انجام شدند (SLA، OLA و UC)." },
    { key: "slm.ola_attainment", name: "دستیابی به توافق‌های سطح عملیات (OLA)", practice: "sla", unit: "percent", direction: "up", grain: "month", formula: "met / finished * 100", parts: timerParts("ola"), target: 95, warn: 92, crit: 88, breakdowns: ["table_key"], description: "سهم زمان‌سنج‌های OLA پایان‌یافته که در موعد انجام شدند." },
    { key: "slm.uc_attainment", name: "دستیابی به قراردادهای پشتیبان (UC)", practice: "sla", unit: "percent", direction: "up", grain: "month", formula: "met / finished * 100", parts: timerParts("uc"), target: 95, warn: 92, crit: 88, breakdowns: ["table_key"], description: "سهم زمان‌سنج‌های قراردادهای پشتیبان که در موعد انجام شدند." },
    { key: "slm.compliance", name: "میانگین انطباق توافق‌ها در دوره‌های بسته", practice: "sla", unit: "percent", direction: "up", grain: "month", formula: "mean", parts: [{ name: "mean", table: "slm_compliance", fn: "avg", field: "value", date_field: "period_start", filter: { f: "final", op: "eq", v: true } }], target: 95, warn: 92, crit: 88, description: "میانگین مقدار اهداف توافق‌ها در دوره‌هایی که بسته شده‌اند." },
    { key: "slm.review_overdue", name: "توافق‌های عقب‌افتاده از بازبینی", practice: "sla", unit: "count", direction: "down", grain: "day", formula: "overdue", parts: [{ name: "overdue", table: "service_agreement", fn: "count", filter: { f: "review_overdue", op: "eq", v: true } }], target: 0, warn: 1, crit: 3, description: "توافق‌های در جریانی که موعد بازبینی‌شان گذشته است." },
    { key: "slm.improvements_done", name: "اقدام‌های بهبود انجام‌شده", practice: "sla", unit: "count", direction: "up", grain: "month", formula: "done", parts: [{ name: "done", table: "slm_improvement", fn: "count", date_field: "resolved_at", filter: { f: "state", op: "in", v: ["done", "closed"] } }], description: "اقلام ثبت بهبود مستمر که در دوره انجام شدند." },
    { key: "slm.xla_score", name: "میانگین امتیاز تجربه (XLA)", practice: "sla", unit: "number", direction: "up", grain: "month", formula: "mean", parts: [{ name: "mean", table: "slm_xla_score", fn: "avg", field: "score", date_field: "computed_at" }], target: 80, warn: 70, crit: 50, breakdowns: ["table_key", "assignment_group_id"], description: "میانگین امتیاز تجربهٔ رکوردهایی که در دوره سنجیده شدند (۰ تا ۱۰۰)." },
  ].map((i) => ({ ...i, owner_id: null, collect: true, score_shares: readers, library_key: i.key }));
}

/** Add the defaults inside `tx` as the system. */
export async function seedSlmDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const cfg = await slmConfig(tx, sys);
  if (cfg.seeded >= SLM_SEED_VERSION && !opts.force) return { skipped: true, created: {} };
  const config = cfg.id ? { id: cfg.id } : await ensure(tx, sys, out, "slm_config", { config_key: "default" }, { name: "تنظیمات سطح خدمت" });

  for (const r of SLM_ROLES) await ensure(tx, sys, out, "role", { key: r.key }, r);

  for (const t of templates()) {
    const tpl = await ensure(tx, sys, out, "slm_template", { name: t.name }, {
      kind: t.kind, level: t.level, description: t.description, compliance_target: String(t.compliance), at_risk_target: String(t.atRisk), review_period: t.period, review_months: t.review,
      terms: t.terms, service_hours: DOC.hours, responsibilities: DOC.responsibilities, escalation: DOC.escalation, exclusions: DOC.exclusions, active: true,
    });
    for (const line of t.targets) await ensure(tx, sys, out, "slm_template_target", { template_id: tpl.id, name: line.name }, line);
  }

  for (const p of xlaPolicies()) await ensure(tx, sys, out, "slm_xla_policy", { table_key: p.table_key, name: p.name }, p);

  const tz = orgTz(sys);
  const year = currentJalaliYear(todayISO(tz));
  const range = jalaliYearRange(year);
  const plan = await ensure(tx, sys, out, "slm_csi_plan", { name: `برنامهٔ بهبود مستمر ${year}` }, {
    owner_id: null, period_from: range.start, period_to: range.end, state: "active",
    objective: "بهبود پیوستهٔ خدمت‌ها از بازبینی‌ها، نقض‌ها، نظرسنجی‌ها و پیشنهاد کارکنان؛ هر قلم با سنجهٔ اثر و موعد.",
  });
  const starters = [
    { short_description: "کاهش ارجاع‌های دوباره میان گروه‌ها", description: "نمونه: علت‌های پرتکرار ارجاع دوباره را بیابید و دسته‌بندی یا قاعدهٔ ارجاع را اصلاح کنید.", value: 4, effort: 2, kpi_name: "نرخ ارجاع دوباره (٪)" },
    { short_description: "افزودن هدف تجربه به توافق‌های مشتری", description: "نمونه: کنار اهداف زمانی، هدف امتیاز تجربه یا رضایت بگذارید تا توافق سبز با تجربهٔ قرمز پنهان نماند.", value: 4, effort: 1, kpi_name: "توافق‌های دارای هدف تجربه (٪)" },
    { short_description: "کوتاه‌کردن زمان پاسخ نخست", description: "نمونه: صف «در خطر» خانهٔ کارشناس و پاسخ‌های آماده را برای پاسخ نخست سریع‌تر به کار ببرید.", value: 3, effort: 2, kpi_name: "میانهٔ زمان پاسخ نخست (دقیقه)" },
  ];
  for (const s of starters) await ensure(tx, sys, out, "slm_improvement", { plan_id: plan.id, short_description: s.short_description }, { ...s, source: "idea", caller_id: null, opened_by: null, priority: "4" });

  for (const r of approvalRules()) await ensure(tx, sys, out, "approval_rule", { table_key: r.table_key, name: r.name }, r);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);

  let calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!calendars.length) {
    await seedCalendarsIn(tx, sys, { years: [] });
    calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  const office = (calendars.find((c) => c.active !== false && c.is_default) ?? calendars[0])?.id ?? null;
  await ensure(tx, sys, out, "sla_definition", { table_key: "slm_improvement", name: "تصمیم دربارهٔ پیشنهاد بهبود" }, {
    type: "ola", target: "response", duration_mode: "fixed", duration: 80 * H, calendar_id: office, sort_order: 10, warn_percents: [50, 80],
    start_condition: { f: "state", op: "eq", v: "proposed" },
    stop_condition: { f: "state", op: "ne", v: "proposed" },
    breach_actions: [{ type: "notify", roles: ["service_level_manager"] }],
    description: "هر پیشنهاد بهبود در ده روز کاری (۸۰ ساعت کاری) تأیید یا رد شود.",
  });

  const flow = MISSED_AGREEMENT_FLOW();
  await savepoint(tx, () => ensure(tx, sys, out, "flow", { name: flow.name }, flow)).catch(() => undefined);

  if (tableDef("analytics_indicator")) {
    for (const i of indicators()) await savepoint(tx, () => ensure(tx, sys, out, "analytics_indicator", { key: i.key }, i)).catch(() => undefined);
  }

  await updateIn(tx, sys, "slm_config", String(config.id), { seeded: SLM_SEED_VERSION }, { trusted: true });
  return out;
}
