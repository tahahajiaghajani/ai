// Tables of event management, AIOps light and on-call (docs/modules/event_FA.md, catalogue
// docs/catalog/g2_operations.md «Module: event»):
//   ingestion     event_source (one per monitoring tool, with its own key: generic JSON, Alertmanager, Grafana, Zabbix,
//                 Nagios/Icinga, Azure Monitor, CloudWatch, e-mail), event (the normalised raw events, short retention,
//                 local to the runtime that received them), event_rule (the ordered processing chain: ignore, enrich,
//                 threshold, suppress)
//   alerts        alert (one per fingerprint while open: count, first/last seen, severity history, flapping, noise
//                 label, escalation), alert_group (correlated alerts — «موقعیت»), correlation_rule, alert_incident_rule,
//                 alert_route (team routing to an escalation policy)
//   on-call       oncall_schedule, oncall_rotation (layers), oncall_override, escalation_policy, escalation_level, page
//   settings      event_config
// Behaviour lives in src/server/modules/event; pure logic (mapping, fingerprints, rules, flapping, noise, cause ranking,
// the rotation engine) in src/shared/event; the screens in src/ui/modules/event.
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { IMPACTS, PRIORITIES } from "../model/task";
import { registerLinkKind } from "../model/links";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists (static: the pipeline, the escalation engine and the reports depend on these values)

export const ALERT_SEVERITIES: Option[] = [
  { value: "critical", label: "بحرانی", color: "red", order: 1 },
  { value: "major", label: "شدید", color: "orange", order: 2 },
  { value: "minor", label: "متوسط", color: "gold", order: 3 },
  { value: "warning", label: "اخطار", color: "blue", order: 4 },
  { value: "info", label: "اطلاعی", color: "gray", order: 5 },
];
export type Severity = "critical" | "major" | "minor" | "warning" | "info";
export const SEVERITY_ORDER: Severity[] = ["critical", "major", "minor", "warning", "info"];

export const SOURCE_KINDS: Option[] = [
  { value: "generic", label: "JSON عمومی (وب‌هوک)", order: 1 },
  { value: "alertmanager", label: "Prometheus Alertmanager", order: 2 },
  { value: "grafana", label: "Grafana", order: 3 },
  { value: "zabbix", label: "Zabbix", order: 4 },
  { value: "nagios", label: "Nagios", order: 5 },
  { value: "icinga", label: "Icinga", order: 6 },
  { value: "azure_monitor", label: "Azure Monitor", order: 7 },
  { value: "cloudwatch", label: "Amazon CloudWatch (SNS)", order: 8 },
  { value: "email", label: "ایمیل (موضوع و متن)", order: 9 },
];

export const EVENT_STATUSES: Option[] = [
  { value: "firing", label: "فعال", color: "red", order: 1 },
  { value: "resolved", label: "رفع‌شده", color: "green", order: 2 },
];

export const EVENT_OUTCOMES: Option[] = [
  { value: "pending", label: "در صف پردازش", color: "gray", order: 1 },
  { value: "created", label: "هشدار تازه", color: "blue", order: 2 },
  { value: "updated", label: "تکرار هشدار باز", color: "teal", order: 3 },
  { value: "reopened", label: "بازگشایی هشدار", color: "orange", order: 4 },
  { value: "cleared", label: "رفع هشدار", color: "green", order: 5 },
  { value: "orphan_clear", label: "رفع بی‌هشدار", color: "gray", order: 6 },
  { value: "ignored", label: "نادیده گرفته شد", color: "gray", order: 7 },
  { value: "suppressed", label: "سرکوب شد", color: "purple", order: 8 },
  { value: "held", label: "زیر آستانه", color: "gold", order: 9 },
  { value: "error", label: "خطا", color: "red", order: 10 },
];

export const RULE_ACTIONS: Option[] = [
  { value: "set", label: "تغییر و غنی‌سازی", order: 1 },
  { value: "ignore", label: "نادیده گرفتن", order: 2 },
  { value: "suppress", label: "سرکوب (بی‌هشدار، با سابقه)", order: 3 },
  { value: "threshold", label: "آستانه (چند رویداد در بازه)", order: 4 },
];

export const CORRELATION_KINDS: Option[] = [
  { value: "ci", label: "یک پیکربندی", order: 1 },
  { value: "topology", label: "وابستگی پیکربندی‌ها (CMDB)", order: 2 },
  { value: "service", label: "یک خدمت", order: 3 },
  { value: "fields", label: "ویژگی‌های یکسان", order: 4 },
];
export const GROUP_REASONS: Option[] = [...CORRELATION_KINDS, { value: "manual", label: "دستی", order: 5 }];

export const MATCH_FIELDS: Option[] = [
  { value: "source_id", label: "منبع", order: 1 },
  { value: "node", label: "میزبان", order: 2 },
  { value: "resource", label: "منبع پایش‌شده", order: 3 },
  { value: "metric", label: "سنجه یا بررسی", order: 4 },
  { value: "service_id", label: "خدمت", order: 5 },
  { value: "assignment_group_id", label: "تیم", order: 6 },
];

export const NOISE_LABELS: Option[] = [
  { value: "signal", label: "سیگنال", color: "green", order: 1 },
  { value: "likely_noise", label: "احتمالاً نویز", color: "gold", order: 2 },
  { value: "noise", label: "نویز", color: "gray", order: 3 },
];

export const ESCALATION_STATES: Option[] = [
  { value: "none", label: "بدون ارتقا", color: "gray", order: 1 },
  { value: "running", label: "در جریان", color: "orange", order: 2 },
  { value: "acknowledged", label: "تأییدشده", color: "green", order: 3 },
  { value: "exhausted", label: "بی‌پاسخ پس از همهٔ سطح‌ها", color: "red", order: 4 },
  { value: "stopped", label: "متوقف", color: "gray", order: 5 },
];

export const ALERT_CLOSE_CODES: Option[] = [
  { value: "fixed", label: "رفع شد", color: "green", order: 1 },
  { value: "auto", label: "رفع خودکار از منبع", color: "teal", order: 2 },
  { value: "no_action", label: "بی‌نیاز به اقدام (نادرست)", color: "gray", order: 3 },
  { value: "duplicate", label: "تکراری", color: "gray", order: 4 },
  { value: "maintenance", label: "نگهداری برنامه‌ریزی‌شده", color: "teal", order: 5 },
  { value: "incident", label: "با رخداد پیگیری شد", color: "blue", order: 6 },
  { value: "expired", label: "بی‌پاسخ ماند و بسته شد", color: "orange", order: 7 },
];

export const ESCALATION_TARGETS: Option[] = [
  { value: "oncall", label: "کشیکِ برنامه", order: 1 },
  { value: "users", label: "افراد", order: 2 },
  { value: "group", label: "همهٔ اعضای گروه", order: 3 },
  { value: "manager", label: "مدیر گروه", order: 4 },
];

export const PAGE_CHANNELS: Option[] = [
  { value: "in_app", label: "درون برنامه", order: 1 },
  { value: "email", label: "ایمیل", order: 2 },
  { value: "sms", label: "پیامک", order: 3 },
];

export const ROTATION_TYPES: Option[] = [
  { value: "weekly", label: "هفتگی (از شنبه)", order: 1 },
  { value: "daily", label: "روزانه", order: 2 },
  { value: "custom", label: "دوره به ساعت", order: 3 },
];

export const RESTRICTIONS: Option[] = [
  { value: "none", label: "همهٔ ساعت‌ها", order: 1 },
  { value: "office", label: "فقط ساعات کاری تقویم", order: 2 },
  { value: "off_hours", label: "فقط بیرون از ساعات کاری (شب، جمعه و تعطیلات)", order: 3 },
  { value: "custom", label: "بازهٔ روزانهٔ دلخواه", order: 4 },
];

export const WEEKDAYS: Option[] = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"].map((label, i) => ({ value: String(i), label, order: i + 1 }));

export const ROUTE_TIMES: Option[] = [
  { value: "any", label: "همهٔ ساعت‌ها", order: 1 },
  { value: "office", label: "ساعات کاری", order: 2 },
  { value: "off_hours", label: "بیرون از ساعات کاری", order: 3 },
];

export const ACK_VIA: Option[] = [
  { value: "app", label: "برنامه", order: 1 },
  { value: "link", label: "پیوند فراخوان", order: 2 },
  { value: "auto", label: "با تأیید دیگری", order: 3 },
];

// ---------------------------------------------------------------------------------------------------------------
// State models

export const ALERT_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "red" },
    { value: "acknowledged", label: "تأییدشده", category: "active", color: "gold" },
    { value: "flapping", label: "نوسانی", category: "active", color: "purple" },
    { value: "snoozed", label: "به تعویق", category: "waiting", color: "gray" },
    { value: "maintenance", label: "در نگهداری", category: "waiting", color: "teal" },
    { value: "cleared", label: "رفع‌شده", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "suppressed", label: "سرکوب‌شده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open", "flapping", "snoozed", "maintenance"], to: "acknowledged", label: "تأیید هشدار" },
    { from: ["acknowledged", "snoozed", "maintenance", "flapping"], to: "open", label: "بازگشت به باز" },
    { from: ["open", "acknowledged", "flapping"], to: "snoozed", label: "تعویق", requires: ["snoozed_until"] },
    { from: ["open", "acknowledged", "snoozed"], to: "flapping", label: "نوسانی" },
    { from: ["open", "acknowledged", "snoozed", "flapping"], to: "maintenance", label: "در نگهداری" },
    { from: ["open", "acknowledged", "flapping", "snoozed", "maintenance"], to: "cleared", label: "رفع شد" },
    { from: ["cleared"], to: "open", label: "بازگشایی" },
    { from: ["open", "acknowledged", "flapping", "snoozed", "maintenance", "cleared"], to: "closed", label: "بستن", requires: ["close_code"] },
    { from: ["closed"], to: "acknowledged", label: "بازگشایی", roles: { area: "event", level: "edit" } },
    { from: ["open", "acknowledged", "flapping", "snoozed", "maintenance"], to: "suppressed", label: "سرکوب" },
    { from: ["suppressed"], to: "acknowledged", label: "بازگرداندن" },
  ],
  locked: ["closed", "canceled"],
};

/** Alert states in which it is still worked (open categories). */
export const ALERT_OPEN_STATES = ["open", "acknowledged", "flapping", "snoozed", "maintenance"];
/** Open alert states that page people (snoozed and maintenance mute; flapping pages once). */
export const ALERT_PAGING_STATES = ["open"];

export const GROUP_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "red" },
    { value: "acknowledged", label: "در رسیدگی", category: "active", color: "gold" },
    { value: "resolved", label: "رفع‌شده", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "acknowledged", label: "در رسیدگی" },
    { from: ["acknowledged", "resolved"], to: "open", label: "بازگشت به باز" },
    { from: ["open", "acknowledged"], to: "resolved", label: "رفع شد" },
    { from: ["open", "acknowledged", "resolved"], to: "closed", label: "بستن" },
    { from: ["closed"], to: "acknowledged", label: "بازگشایی", roles: { area: "event", level: "edit" } },
  ],
  locked: ["closed", "canceled"],
};

export const PAGE_STATES: StateModel = {
  field: "state",
  initial: "queued",
  states: [
    { value: "queued", label: "در صف", category: "new", color: "gray" },
    { value: "sent", label: "فرستاده‌شده", category: "active", color: "orange" },
    { value: "acknowledged", label: "تأییدشده", category: "resolved", color: "green" },
    { value: "expired", label: "بی‌پاسخ", category: "closed", color: "red" },
    { value: "failed", label: "ناموفق", category: "closed", color: "red" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["queued"], to: "sent", label: "فرستاده شد" },
    { from: ["queued", "sent"], to: "acknowledged", label: "تأیید شد" },
    { from: ["queued", "sent"], to: "expired", label: "بی‌پاسخ ماند" },
    { from: ["queued", "sent"], to: "failed", label: "ناموفق" },
    { from: ["queued", "sent"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled", "resolved"],
};

// ---------------------------------------------------------------------------------------------------------------
// Settings

export interface EventConfig {
  retention_days: number;
  flap_threshold: number;
  flap_window_minutes: number;
  reopen_minutes: number;
  auto_close_minutes: number;
  transient_seconds: number;
  ack_link_hours: number;
  incident_on_exhausted: boolean;
  default_policy_id: string | null;
}

export const EVENT_CONFIG_DEFAULTS: EventConfig = {
  retention_days: 14,
  flap_threshold: 4,
  flap_window_minutes: 30,
  reopen_minutes: 60,
  auto_close_minutes: 120,
  transient_seconds: 300,
  ack_link_hours: 24,
  incident_on_exhausted: true,
  default_policy_id: null,
};

const MAIN = "اصلی";
const SEEN = "تکرار و زمان‌ها";
const LINKS = "پیوندها";
const ESC = "ارتقا و فراخوان";
const AI = "نویز و تحلیل";
const MAPPING = "نگاشت";

// ---------------------------------------------------------------------------------------------------------------
// Ingestion

const eventSource: TableDef = {
  key: "event_source",
  table: "sm_event_sources",
  label: "منبع رویداد",
  plural: "منبع‌های رویداد",
  icon: "radio-tower",
  module: "event",
  area: "event",
  description: "ابزار پایشی که رویدادهایش با کلید ویژهٔ خود به سامانه می‌رسد، با نگاشت فیلدها و شدت",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "kind", label: "گونه", type: "choice", choices: SOURCE_KINDS, required: true, default: "generic", list: true, filter: true, span: 6, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "assignment_group_id", label: "تیم مالک هشدارها", type: "group", list: true, filter: true, span: 8, section: MAIN, help: "هشدارهایی که پیکربندی آن‌ها گروه پشتیبانی ندارد به این تیم می‌رسد" },
    { name: "service_id", label: "خدمت پیش‌فرض", type: "ref", ref: "service", filter: true, span: 8, section: MAIN },
    { name: "default_severity", label: "شدت پیش‌فرض", type: "choice", choices: ALERT_SEVERITIES, default: "minor", span: 8, section: MAIN },
    { name: "rate_limit", label: "سقف رویداد در دقیقه", type: "int", min: 1, max: 100000, default: 600, span: 8, section: MAIN, help: "بیش از آن پاسخ ۴۲۹ می‌گیرد و ابزار پایش دوباره می‌فرستد" },
    { name: "heartbeat_minutes", label: "ضربان هر چند دقیقه", type: "int", min: 0, max: 10080, default: 0, span: 8, section: MAIN, help: "اگر در این مدت رویدادی نرسد، هشدار «ضربان نرسید» باز می‌شود؛ صفر: خاموش" },
    { name: "token_hint", label: "کلید", type: "string", readonly: true, maxLength: 40, ltr: true, list: true, span: 8, section: MAIN, help: "کلید فقط یک بار هنگام ساخت نشان داده می‌شود" },
    { name: "token_hash", label: "چکیدهٔ کلید", type: "string", system: true, hidden: true, maxLength: 80, group: "admin", noSync: true, audit: false, index: true },
    { name: "token_rotated_at", label: "آخرین ساخت کلید", type: "datetime", readonly: true, span: 8, section: MAIN },
    { name: "mapping", label: "نگاشت فیلدها", type: "json", default: {}, span: 24, section: MAPPING, help: "برای JSON عمومی: مسیر هر فیلد، مانند { \"message\": \"$.title\", \"node\": \"$.host\" }؛ برای ایمیل: subject_regex و body_regex با گروه‌های نام‌دار" },
    { name: "severity_map", label: "نگاشت شدت", type: "json", default: {}, span: 24, section: MAPPING, help: "مقدار شدت در ابزار ← شدت سامانه، مانند { \"disaster\": \"critical\", \"high\": \"major\" }" },
    { name: "last_event_at", label: "آخرین رویداد", type: "datetime", readonly: true, audit: false, list: true, sort: true, span: 8, section: MAIN },
    { name: "event_count", label: "رویدادهای دریافتی", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8, section: MAIN },
    { name: "heartbeat_alert_id", label: "هشدار ضربان", type: "ref", ref: "alert", system: true, hidden: true, audit: false },
    { name: "description", label: "توضیح", type: "text", span: 24, section: MAIN },
  ],
  scope: { group: "assignment_group_id" },
  form: { sections: [MAIN, MAPPING] },
  list: { columns: ["name", "kind", "active", "assignment_group_id", "last_event_at", "event_count", "token_hint"], order: "name" },
};

const event: TableDef = {
  key: "event",
  table: "sm_events",
  label: "رویداد",
  plural: "رویدادها",
  icon: "activity",
  module: "event",
  area: "event",
  description: "رویداد یکسان‌شدهٔ یک ابزار پایش، با تصمیم زنجیرهٔ پردازش؛ چند روز نگه داشته می‌شود و فقط در نسخه‌ای که آن را دریافت کرده است می‌ماند",
  display: "message",
  fields: [
    { name: "message", label: "پیام", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "source_id", label: "منبع", type: "ref", ref: "event_source", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "status", label: "حالت", type: "choice", choices: EVENT_STATUSES, default: "firing", list: true, filter: true, span: 8 },
    { name: "severity", label: "شدت", type: "choice", choices: ALERT_SEVERITIES, default: "minor", list: true, filter: true, sort: true, span: 8 },
    { name: "node", label: "میزبان", type: "string", maxLength: 255, ltr: true, list: true, search: true, filter: true, span: 8 },
    { name: "resource", label: "منبع پایش‌شده", type: "string", maxLength: 255, ltr: true, search: true, filter: true, span: 8 },
    { name: "metric", label: "سنجه یا بررسی", type: "string", maxLength: 255, ltr: true, search: true, filter: true, span: 8 },
    { name: "value", label: "مقدار", type: "decimal", span: 8 },
    { name: "tags", label: "برچسب‌ها", type: "tags", filter: true, span: 16 },
    { name: "description", label: "شرح", type: "text", span: 24 },
    { name: "occurred_at", label: "زمان رخ‌دادن", type: "datetime", sort: true, filter: true, span: 8 },
    { name: "received_at", label: "زمان دریافت", type: "datetime", required: true, list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "processed_at", label: "زمان پردازش", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "fingerprint", label: "اثر انگشت", type: "string", maxLength: 120, ltr: true, filter: true, index: true, span: 12 },
    { name: "dedupe_key", label: "کلید یکتایی", type: "string", maxLength: 200, ltr: true, filter: true, index: true, span: 12, help: "رویداد تکراری با همین کلید یک بار ثبت می‌شود" },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
    { name: "assignment_group_id", label: "تیم", type: "group", filter: true, span: 8 },
    { name: "alert_id", label: "هشدار", type: "ref", ref: "alert", list: true, filter: true, index: true, span: 8 },
    { name: "outcome", label: "نتیجهٔ پردازش", type: "choice", choices: EVENT_OUTCOMES, default: "pending", list: true, filter: true, index: true, span: 8 },
    { name: "decision", label: "تصمیم‌ها", type: "json", readonly: true, span: 24, help: "قاعده‌هایی که اعمال شد (با نسخهٔ هر قاعده) و یادداشت‌های پردازش" },
    { name: "payload", label: "محتوای خام", type: "json", group: "internal", span: 24, help: "اسرار (گذرواژه، کلید، توکن) هنگام دریافت پاک می‌شوند" },
  ],
  scope: { group: "assignment_group_id" },
  features: { sync: false, history: false },
  list: { columns: ["received_at", "source_id", "severity", "status", "node", "message", "outcome", "alert_id"], order: "-received_at" },
};

const eventRule: TableDef = {
  key: "event_rule",
  table: "sm_event_rules",
  label: "قاعدهٔ پردازش رویداد",
  plural: "قاعده‌های پردازش رویداد",
  icon: "list-filter",
  module: "event",
  area: "event",
  description: "زنجیرهٔ ترتیبی پالایش، غنی‌سازی، آستانه و سرکوب رویدادها پیش از ساخت هشدار",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "action", label: "اقدام", type: "choice", choices: RULE_ACTIONS, required: true, default: "set", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, min: 0, max: 100000, list: true, sort: true, span: 6 },
    { name: "source_id", label: "فقط برای منبع", type: "ref", ref: "event_source", list: true, filter: true, span: 12 },
    { name: "stop", label: "پس از این قاعده، قاعدهٔ دیگری اجرا نشود", type: "bool", default: false, span: 6 },
    { name: "condition", label: "شرط", type: "conditions", condTable: "event", span: 24, help: "خالی: همهٔ رویدادها" },
    { name: "pattern", label: "الگوی پیام (عبارت منظم)", type: "string", maxLength: 300, ltr: true, span: 24, help: "گروه‌های نام‌دار (?<node>…) مقدار همان فیلد را می‌گذارند" },
    { name: "set_severity", label: "شدت تازه", type: "choice", choices: ALERT_SEVERITIES, span: 8 },
    { name: "set_group_id", label: "تیم تازه", type: "group", span: 8 },
    { name: "set_service_id", label: "خدمت", type: "ref", ref: "service", span: 8 },
    { name: "set_ci_id", label: "پیکربندی", type: "ref", ref: "ci", span: 8 },
    { name: "add_tags", label: "افزودن برچسب", type: "tags", span: 8 },
    { name: "message_prefix", label: "پیشوند پیام", type: "string", maxLength: 60, span: 8 },
    { name: "threshold_count", label: "حداقل تعداد رویداد", type: "int", min: 2, max: 10000, default: 3, span: 8 },
    { name: "threshold_minutes", label: "در بازهٔ (دقیقه)", type: "int", min: 1, max: 1440, default: 5, span: 8 },
    { name: "hits", label: "دفعات اعمال", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    { name: "last_hit_at", label: "آخرین اعمال", type: "datetime", readonly: true, audit: false, span: 8 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["sort_order", "name", "action", "source_id", "active", "hits"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Alerts

const alert: TableDef = {
  key: "alert",
  table: "sm_alerts",
  label: "هشدار",
  plural: "هشدارها",
  icon: "bell-ring",
  module: "event",
  area: "event",
  description: "هشداری که از رویدادهای یک اثر انگشت ساخته می‌شود: تکرارها، شدت، پیکربندی و خدمت‌های متأثر، چرخهٔ تأیید و رفع، ارتقا و رخداد",
  numbered: { prefix: "ALR", pad: 7 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "پیام", type: "string", required: true, maxLength: 300, list: true, search: true, sort: true, span: 24, section: MAIN, ai: { index: true } },
    { name: "description", label: "شرح", type: "markdown", span: 24, section: MAIN, ai: { index: true } },
    { name: "severity", label: "شدت", type: "choice", choices: ALERT_SEVERITIES, required: true, default: "minor", list: true, filter: true, sort: true, index: true, span: 8, section: MAIN },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, default: "3", list: true, filter: true, sort: true, span: 8, section: MAIN },
    { name: "impact", label: "اثر", type: "choice", choices: IMPACTS, default: "3", filter: true, span: 8, section: MAIN, help: "از اهمیت پیکربندی؛ با شدت، اولویت را در «ماتریس شدت هشدار» می‌سازد" },
    { name: "source_id", label: "منبع", type: "ref", ref: "event_source", list: true, filter: true, span: 8, section: MAIN },
    { name: "node", label: "میزبان", type: "string", maxLength: 255, ltr: true, list: true, search: true, filter: true, span: 8, section: MAIN },
    { name: "resource", label: "منبع پایش‌شده", type: "string", maxLength: 255, ltr: true, search: true, filter: true, span: 8, section: MAIN },
    { name: "metric", label: "سنجه یا بررسی", type: "string", maxLength: 255, ltr: true, search: true, filter: true, span: 8, section: MAIN },
    { name: "tags", label: "برچسب‌ها", type: "tags", filter: true, search: true, span: 16, section: MAIN },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", list: true, filter: true, index: true, span: 8, section: MAIN },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, index: true, span: 8, section: MAIN },
    { name: "affected_services", label: "خدمت‌های متأثر", type: "refs", ref: "service", filter: true, span: 16, section: MAIN, help: "از وابستگی‌های پیکربندی در CMDB" },
    { name: "assignment_group_id", label: "تیم", type: "group", list: true, filter: true, index: true, span: 8, section: MAIN },
    { name: "assigned_to", label: "مسئول", type: "user", list: true, filter: true, sort: true, index: true, span: 8, section: MAIN },
    { name: "responders", label: "پاسخ‌دهندگان", type: "users", span: 16, section: MAIN, help: "کسانی که برای این هشدار فراخوان شده‌اند یا افزوده شده‌اند" },

    { name: "event_count", label: "تعداد رویداد", type: "int", readonly: true, audit: false, default: 1, list: true, sort: true, span: 6, section: SEEN },
    { name: "first_seen_at", label: "نخستین مشاهده", type: "datetime", readonly: true, sort: true, filter: true, span: 6, section: SEEN },
    { name: "last_seen_at", label: "آخرین مشاهده", type: "datetime", readonly: true, audit: false, list: true, sort: true, filter: true, span: 6, section: SEEN },
    { name: "opened_at", label: "زمان باز شدن", type: "datetime", system: true, sort: true, filter: true, span: 6, section: SEEN },
    { name: "acknowledged_at", label: "زمان تأیید", type: "datetime", readonly: true, sort: true, filter: true, span: 6, section: SEEN },
    { name: "acknowledged_by", label: "تأییدکننده", type: "user", readonly: true, filter: true, span: 6, section: SEEN },
    { name: "resolved_at", label: "زمان رفع", type: "datetime", system: true, sort: true, filter: true, span: 6, section: SEEN },
    { name: "resolved_by", label: "رفع‌کننده", type: "user", system: true, span: 6, section: SEEN },
    { name: "closed_at", label: "زمان بستن", type: "datetime", system: true, sort: true, filter: true, span: 6, section: SEEN },
    { name: "closed_by", label: "بندنده", type: "user", system: true, span: 6, section: SEEN },
    { name: "snoozed_until", label: "تعویق تا", type: "datetime", sort: true, span: 6, section: SEEN },
    { name: "reopen_count", label: "دفعات بازگشایی", type: "int", system: true, default: 0, span: 6, section: SEEN },
    { name: "fingerprint", label: "اثر انگشت", type: "string", readonly: true, maxLength: 120, ltr: true, filter: true, index: true, span: 12, section: SEEN },
    { name: "severity_history", label: "تاریخچهٔ شدت", type: "json", readonly: true, audit: false, hidden: true },
    { name: "flips", label: "تغییرهای فعال و رفع", type: "json", readonly: true, audit: false, hidden: true },
    { name: "flap_count", label: "نوسان‌ها", type: "int", readonly: true, audit: false, default: 0, span: 6, section: SEEN },
    { name: "last_value", label: "آخرین مقدار", type: "decimal", readonly: true, audit: false, span: 6, section: SEEN },
    { name: "close_code", label: "نتیجهٔ بستن", type: "choice", choices: ALERT_CLOSE_CODES, filter: true, span: 8, section: SEEN },
    { name: "close_notes", label: "یادداشت بستن", type: "text", span: 24, section: SEEN },
    { name: "active", label: "باز", type: "bool", system: true, default: true, filter: true, span: 6, section: SEEN },
    { name: "sla_due", label: "موعد توافق سطح خدمت", type: "datetime", system: true, sort: true, filter: true, span: 6, section: SEEN },

    { name: "group_id", label: "گروه هم‌بسته", type: "ref", ref: "alert_group", list: true, filter: true, index: true, span: 8, section: LINKS },
    { name: "symptom", label: "نشانهٔ علتی دیگر", type: "bool", readonly: true, default: false, filter: true, span: 8, section: LINKS, help: "پیکربندی‌ای که این پیکربندی به آن وابسته است هم هشدار دارد" },
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", list: true, filter: true, index: true, span: 8, section: LINKS },
    { name: "incident_auto_resolve", label: "حل خودکار رخداد با رفع هشدارها", type: "bool", system: true, hidden: true, default: false, audit: false },
    { name: "change_id", label: "تغییر مرتبط", type: "ref", ref: "change_request", filter: true, span: 8, section: LINKS },
    { name: "maintenance_window_id", label: "پنجرهٔ نگهداری", type: "ref", ref: "change_window", filter: true, span: 8, section: LINKS },
    { name: "last_event_id", label: "آخرین رویداد", type: "ref", ref: "event", system: true, hidden: true, audit: false },

    { name: "escalation_policy_id", label: "سیاست ارتقا", type: "ref", ref: "escalation_policy", filter: true, span: 8, section: ESC },
    { name: "escalation_state", label: "وضعیت ارتقا", type: "choice", choices: ESCALATION_STATES, readonly: true, default: "none", list: true, filter: true, span: 8, section: ESC },
    { name: "escalation_level", label: "سطح ارتقا", type: "int", readonly: true, default: 0, span: 8, section: ESC },
    { name: "escalation_round", label: "دور ارتقا", type: "int", system: true, hidden: true, default: 0, audit: false },
    { name: "next_escalation_at", label: "سطح بعدی در", type: "datetime", system: true, sort: true, span: 8, section: ESC },
    { name: "pages_sent", label: "فراخوان‌ها", type: "int", readonly: true, audit: false, default: 0, span: 8, section: ESC },

    { name: "noise_label", label: "برچسب نویز", type: "choice", choices: NOISE_LABELS, readonly: true, list: true, filter: true, span: 8, section: AI },
    { name: "noise_reason", label: "دلیل برچسب", type: "string", readonly: true, maxLength: 300, span: 16, section: AI },
  ],
  states: ALERT_STATES,
  // anchored to the CI (not to a requester): the module's hook copies the CI's unit and domain, so the teams of a
  // company or a domain see the alerts of their CIs; responders read the alert they were paged for
  scope: { own: ["assigned_to"], requester: [], group: "assignment_group_id", watchers: "watch_list", readers: ["responders"] },
  features: { journal: true, attachments: true, watchers: true, links: true, sla: true, kanban: "state" },
  form: { sections: [MAIN, SEEN, LINKS, ESC, AI], related: [{ table: "event", field: "alert_id", label: "رویدادها", columns: ["received_at", "status", "severity", "message", "outcome"] }, { table: "page", field: "alert_id", label: "فراخوان‌ها", columns: ["number", "user_id", "level", "state", "sent_at", "acknowledged_at"] }] },
  list: { columns: ["number", "severity", "state", "short_description", "node", "ci_id", "event_count", "last_seen_at", "assignment_group_id", "assigned_to"], order: "-last_seen_at" },
  ai: { title: "short_description", text: ["description"] },
};

const alertGroup: TableDef = {
  key: "alert_group",
  table: "sm_alert_groups",
  label: "گروه هم‌بسته",
  plural: "گروه‌های هم‌بسته",
  icon: "layers",
  module: "event",
  area: "event",
  description: "هشدارهایی که با قاعده‌های هم‌بستگی (پیکربندی، وابستگی، خدمت، ویژگی‌ها و بازهٔ زمانی) یک موقعیت شمرده می‌شوند",
  numbered: { prefix: "SIT", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "severity", label: "شدت", type: "choice", choices: ALERT_SEVERITIES, default: "minor", list: true, filter: true, sort: true, span: 8 },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, default: "3", list: true, filter: true, sort: true, span: 8 },
    { name: "reason", label: "دلیل هم‌بستگی", type: "choice", choices: GROUP_REASONS, readonly: true, list: true, filter: true, span: 8 },
    { name: "rule_id", label: "قاعده", type: "ref", ref: "correlation_rule", readonly: true, filter: true, span: 8 },
    { name: "corr_key", label: "کلید هم‌بستگی", type: "string", system: true, hidden: true, maxLength: 300, index: true, audit: false },
    { name: "ci_id", label: "پیکربندی ریشه", type: "ref", ref: "ci", filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
    { name: "affected_services", label: "خدمت‌های متأثر", type: "refs", ref: "service", span: 16 },
    { name: "assignment_group_id", label: "تیم", type: "group", list: true, filter: true, index: true, span: 8 },
    { name: "assigned_to", label: "مسئول", type: "user", list: true, filter: true, span: 8 },
    { name: "alert_count", label: "هشدارها", type: "int", readonly: true, audit: false, default: 0, list: true, sort: true, span: 8 },
    { name: "open_count", label: "هشدارهای باز", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    { name: "first_seen_at", label: "نخستین مشاهده", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "last_seen_at", label: "آخرین مشاهده", type: "datetime", readonly: true, audit: false, list: true, sort: true, span: 8 },
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", list: true, filter: true, span: 8 },
    { name: "summary", label: "خلاصه", type: "markdown", readonly: true, audit: false, span: 24 },
    { name: "probable_causes", label: "علت‌های محتمل", type: "json", readonly: true, audit: false, hidden: true },
    { name: "active", label: "باز", type: "bool", system: true, default: true, filter: true, span: 8 },
    { name: "opened_at", label: "زمان باز شدن", type: "datetime", system: true, sort: true, span: 8 },
    { name: "resolved_at", label: "زمان رفع", type: "datetime", system: true, sort: true, span: 8 },
    { name: "closed_at", label: "زمان بستن", type: "datetime", system: true, sort: true, span: 8 },
  ],
  states: GROUP_STATES,
  scope: { own: ["assigned_to"], requester: [], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, watchers: true, links: true },
  form: { related: [{ table: "alert", field: "group_id", label: "هشدارها", columns: ["number", "severity", "state", "short_description", "ci_id", "event_count", "last_seen_at"] }] },
  list: { columns: ["number", "severity", "state", "title", "alert_count", "open_count", "assignment_group_id", "last_seen_at"], order: "-last_seen_at" },
};

const correlationRule: TableDef = {
  key: "correlation_rule",
  table: "sm_correlation_rules",
  label: "قاعدهٔ هم‌بستگی",
  plural: "قاعده‌های هم‌بستگی",
  icon: "git-merge",
  module: "event",
  area: "event",
  description: "هشدارهای هم‌زمانِ یک پیکربندی، پیکربندی‌های وابسته، یک خدمت یا ویژگی‌های یکسان را در یک گروه هم‌بسته جمع می‌کند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "kind", label: "روش", type: "choice", choices: CORRELATION_KINDS, required: true, default: "ci", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, min: 0, max: 100000, list: true, sort: true, span: 6 },
    { name: "window_minutes", label: "بازهٔ زمانی (دقیقه)", type: "int", min: 1, max: 1440, default: 15, list: true, span: 6 },
    { name: "max_hops", label: "حداکثر گام در CMDB", type: "int", min: 1, max: 6, default: 3, span: 6, help: "برای روش «وابستگی پیکربندی‌ها»" },
    { name: "match_fields", label: "ویژگی‌های یکسان", type: "multichoice", choices: MATCH_FIELDS, span: 12, help: "برای روش «ویژگی‌های یکسان»" },
    { name: "condition", label: "فقط برای هشدارهای", type: "conditions", condTable: "alert", span: 24, help: "خالی: همهٔ هشدارها" },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["sort_order", "name", "kind", "window_minutes", "active"], order: "sort_order,name" },
};

const alertIncidentRule: TableDef = {
  key: "alert_incident_rule",
  table: "sm_alert_incident_rules",
  label: "قاعدهٔ ساخت رخداد",
  plural: "قاعده‌های ساخت رخداد",
  icon: "siren",
  module: "event",
  area: "event",
  description: "هشدارهایی که رخداد می‌سازند یا رخداد باز را به‌روز می‌کنند، با تأخیر، یک رخداد برای هر گروه هم‌بسته و حل خودکار",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, min: 0, max: 100000, list: true, sort: true, span: 6 },
    { name: "min_severity", label: "از شدت", type: "choice", choices: ALERT_SEVERITIES, default: "major", list: true, span: 8 },
    { name: "delay_minutes", label: "تأخیر (دقیقه)", type: "int", min: 0, max: 1440, default: 0, list: true, span: 8, help: "اگر هشدار تا این مدت تأیید یا رفع نشود رخداد ساخته می‌شود؛ صفر: بی‌درنگ" },
    { name: "per_group", label: "یک رخداد برای هر گروه هم‌بسته", type: "bool", default: true, span: 8 },
    { name: "condition", label: "شرط", type: "conditions", condTable: "alert", span: 24, help: "خالی: همهٔ هشدارهای این شدت" },
    { name: "assignment_group_id", label: "گروه رخداد", type: "group", span: 8, help: "خالی: تیم هشدار" },
    { name: "category", label: "دستهٔ رخداد", type: "string", maxLength: 60, ltr: true, span: 8 },
    { name: "auto_resolve", label: "حل خودکار پس از رفع همهٔ هشدارها", type: "bool", default: true, span: 8 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["sort_order", "name", "min_severity", "delay_minutes", "per_group", "active"], order: "sort_order,name" },
};

const alertRoute: TableDef = {
  key: "alert_route",
  table: "sm_alert_routes",
  label: "قاعدهٔ مسیریابی هشدار",
  plural: "قاعده‌های مسیریابی هشدار",
  icon: "route",
  module: "event",
  area: "event",
  description: "هشدار را بر پایهٔ منبع، محتوا و زمان به تیم و سیاست ارتقای آن می‌فرستد؛ نخستین قاعدهٔ منطبق برنده است",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, min: 0, max: 100000, list: true, sort: true, span: 6 },
    { name: "condition", label: "شرط", type: "conditions", condTable: "alert", span: 24, help: "خالی: همهٔ هشدارها" },
    { name: "time", label: "زمان", type: "choice", choices: ROUTE_TIMES, default: "any", span: 8 },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 8, help: "خالی: تقویم پیش‌فرض سازمان" },
    { name: "assignment_group_id", label: "تیم", type: "group", list: true, span: 8 },
    { name: "escalation_policy_id", label: "سیاست ارتقا", type: "ref", ref: "escalation_policy", list: true, span: 12, help: "خالی: بی‌فراخوان (فقط ثبت در کنسول)" },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["sort_order", "name", "assignment_group_id", "escalation_policy_id", "time", "active"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// On-call (area oncall)

const oncallSchedule: TableDef = {
  key: "oncall_schedule",
  table: "sm_oncall_schedules",
  label: "برنامهٔ کشیک",
  plural: "برنامه‌های کشیک",
  icon: "calendar-clock",
  module: "event",
  area: "oncall",
  description: "برنامهٔ کشیک یک تیم: چرخش‌ها در چند لایه، جایگزینی‌ها و تقویم کاری با تعطیلات رسمی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "group_id", label: "تیم", type: "group", required: true, list: true, filter: true, span: 12 },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 12, help: "ساعات کاری و تعطیلات برای محدودیت‌های چرخش؛ خالی: تقویم پیش‌فرض" },
    { name: "timezone", label: "منطقهٔ زمانی", type: "string", maxLength: 60, default: "Asia/Tehran", ltr: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "notify_shifts", label: "اعلان آغاز شیفت", type: "bool", default: true, span: 8 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { group: "group_id" },
  form: {
    related: [
      { table: "oncall_rotation", field: "schedule_id", label: "چرخش‌ها", columns: ["layer", "name", "rotation_type", "restriction", "members", "active"] },
      { table: "oncall_override", field: "schedule_id", label: "جایگزینی‌ها", columns: ["user_id", "replaces_id", "start_at", "end_at", "reason"] },
    ],
  },
  list: { columns: ["name", "group_id", "active"], order: "name" },
};

const oncallRotation: TableDef = {
  key: "oncall_rotation",
  table: "sm_oncall_rotations",
  label: "چرخش کشیک",
  plural: "چرخش‌های کشیک",
  icon: "repeat",
  module: "event",
  area: "oncall",
  description: "یک لایهٔ برنامهٔ کشیک: افراد به نوبت، از زمان شروع، روزانه یا هفتگی یا هر چند ساعت، با محدودیت ساعات",
  display: "name",
  fields: [
    { name: "schedule_id", label: "برنامه", type: "ref", ref: "oncall_schedule", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "layer", label: "لایه", type: "int", min: 1, max: 20, default: 1, list: true, sort: true, span: 6, help: "لایهٔ بالاتر بر لایهٔ پایین‌تر مقدم است" },
    { name: "rotation_type", label: "نوبت", type: "choice", choices: ROTATION_TYPES, required: true, default: "weekly", list: true, span: 6 },
    { name: "length_hours", label: "طول هر نوبت (ساعت)", type: "int", min: 1, max: 2160, default: 12, span: 6, help: "برای «دوره به ساعت»" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "start_at", label: "آغاز (زمان نخستین تحویل)", type: "datetime", required: true, span: 12, help: "ساعت همین زمان، ساعت تحویل نوبت‌ها است" },
    { name: "end_at", label: "پایان", type: "datetime", span: 12 },
    { name: "members", label: "افراد به ترتیب نوبت", type: "users", required: true, list: true, span: 24 },
    { name: "restriction", label: "ساعات", type: "choice", choices: RESTRICTIONS, default: "none", list: true, span: 12 },
    { name: "restrict_days", label: "روزها", type: "multichoice", choices: WEEKDAYS, span: 12, help: "برای «بازهٔ روزانهٔ دلخواه»؛ خالی: همهٔ روزها" },
    { name: "restrict_from", label: "از ساعت", type: "string", maxLength: 5, ltr: true, placeholder: "۱۶:۰۰", span: 6 },
    { name: "restrict_to", label: "تا ساعت", type: "string", maxLength: 5, ltr: true, placeholder: "۰۸:۰۰", span: 6 },
    { name: "group_id", label: "تیم", type: "group", system: true, hidden: true, audit: false },
  ],
  scope: { group: "group_id" },
  list: { columns: ["schedule_id", "layer", "name", "rotation_type", "restriction", "members", "active"], order: "schedule_id,layer" },
};

const oncallOverride: TableDef = {
  key: "oncall_override",
  table: "sm_oncall_overrides",
  label: "جایگزینی کشیک",
  plural: "جایگزینی‌های کشیک",
  icon: "user-round-cog",
  module: "event",
  area: "oncall",
  description: "کسی که در بازه‌ای کشیک را به جای برنامه (یا به جای یک نفر) برعهده می‌گیرد: مرخصی، جابه‌جایی شیفت یا پوشش موقت",
  display: "reason",
  fields: [
    { name: "schedule_id", label: "برنامه", type: "ref", ref: "oncall_schedule", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "کشیک جایگزین", type: "user", required: true, list: true, filter: true, span: 12 },
    { name: "replaces_id", label: "به جای", type: "user", list: true, filter: true, span: 12, help: "خالی: همهٔ کشیک‌های این بازه" },
    { name: "start_at", label: "از", type: "datetime", required: true, list: true, sort: true, filter: true, span: 6 },
    { name: "end_at", label: "تا", type: "datetime", required: true, list: true, sort: true, span: 6 },
    { name: "reason", label: "دلیل", type: "string", required: true, default: "جایگزینی", maxLength: 200, list: true, span: 24 },
    { name: "group_id", label: "تیم", type: "group", system: true, hidden: true, audit: false },
  ],
  scope: { own: ["user_id", "replaces_id"], requester: [], group: "group_id" },
  features: { calendar: { start: "start_at", end: "end_at" } },
  list: { columns: ["schedule_id", "user_id", "replaces_id", "start_at", "end_at", "reason"], order: "-start_at" },
};

const escalationPolicy: TableDef = {
  key: "escalation_policy",
  table: "sm_escalation_policies",
  label: "سیاست ارتقا",
  plural: "سیاست‌های ارتقا",
  icon: "chevrons-up",
  module: "event",
  area: "oncall",
  description: "سطح‌های پی‌درپی فراخوان با تأخیر، هدف (کشیک برنامه، افراد، گروه یا مدیر) و تکرار؛ با تأیید هشدار می‌ایستد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "group_id", label: "تیم", type: "group", list: true, filter: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "is_default", label: "سیاست پیش‌فرض تیم", type: "bool", default: false, list: true, span: 6 },
    { name: "repeat_times", label: "تکرار همهٔ سطح‌ها", type: "int", min: 0, max: 5, default: 1, span: 6 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { group: "group_id" },
  form: { related: [{ table: "escalation_level", field: "policy_id", label: "سطح‌ها", columns: ["level", "delay_minutes", "target", "schedule_id", "users", "channels"] }] },
  list: { columns: ["name", "group_id", "is_default", "repeat_times", "active"], order: "name" },
};

const escalationLevel: TableDef = {
  key: "escalation_level",
  table: "sm_escalation_levels",
  label: "سطح ارتقا",
  plural: "سطح‌های ارتقا",
  icon: "chevron-up",
  module: "event",
  area: "oncall",
  description: "یک سطح سیاست ارتقا: چند دقیقه پس از سطح پیش، چه کسانی و از چه مجراهایی فراخوان می‌شوند",
  display: "description",
  fields: [
    { name: "policy_id", label: "سیاست", type: "ref", ref: "escalation_policy", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "level", label: "سطح", type: "int", min: 1, max: 20, default: 1, required: true, list: true, sort: true, span: 6 },
    { name: "delay_minutes", label: "پس از (دقیقه)", type: "int", min: 0, max: 1440, default: 0, list: true, span: 6, help: "سطح ۱: پس از باز شدن هشدار؛ سطح‌های بعد: پس از سطح پیش" },
    { name: "target", label: "هدف", type: "choice", choices: ESCALATION_TARGETS, required: true, default: "oncall", list: true, span: 8 },
    { name: "schedule_id", label: "برنامهٔ کشیک", type: "ref", ref: "oncall_schedule", list: true, span: 8 },
    { name: "users", label: "افراد", type: "users", list: true, span: 16 },
    { name: "target_group_id", label: "گروه", type: "group", span: 8 },
    { name: "channels", label: "مجراها", type: "multichoice", choices: PAGE_CHANNELS, default: ["in_app", "email", "sms"], list: true, span: 16 },
    { name: "description", label: "شرح", type: "string", maxLength: 200, default: "سطح ارتقا", span: 24 },
    { name: "group_id", label: "تیم", type: "group", system: true, hidden: true, audit: false },
  ],
  scope: { group: "group_id" },
  unique: [["policy_id", "level"]],
  list: { columns: ["policy_id", "level", "delay_minutes", "target", "schedule_id", "users", "channels"], order: "policy_id,level" },
};

const page: TableDef = {
  key: "page",
  table: "sm_pages",
  label: "فراخوان",
  plural: "فراخوان‌ها",
  icon: "bell-plus",
  module: "event",
  area: "oncall",
  description: "فراخوان یک نفر برای یک هشدار در یک سطح ارتقا، با پیوند تأیید و سرانجام آن",
  numbered: { prefix: "PG", pad: 7 },
  display: "summary",
  fields: [
    { name: "summary", label: "خلاصه", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "alert_id", label: "هشدار", type: "ref", ref: "alert", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "فراخوان‌شده", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "policy_id", label: "سیاست ارتقا", type: "ref", ref: "escalation_policy", filter: true, span: 12 },
    { name: "level", label: "سطح", type: "int", min: 0, max: 20, default: 1, list: true, span: 6 },
    { name: "round", label: "دور", type: "int", min: 0, max: 10, default: 0, span: 6 },
    { name: "channels", label: "مجراها", type: "multichoice", choices: PAGE_CHANNELS, span: 12 },
    { name: "sent_at", label: "زمان فرستادن", type: "datetime", readonly: true, list: true, sort: true, filter: true, span: 8 },
    { name: "acknowledged_at", label: "زمان تأیید", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "ack_via", label: "تأیید از راه", type: "choice", choices: ACK_VIA, readonly: true, span: 8 },
    { name: "expires_at", label: "اعتبار پیوند تا", type: "datetime", readonly: true, span: 8 },
    { name: "failure_reason", label: "علت ناکامی", type: "string", readonly: true, maxLength: 300, span: 16 },
    { name: "ack_token_hash", label: "چکیدهٔ پیوند", type: "string", system: true, hidden: true, maxLength: 80, group: "admin", noSync: true, audit: false, index: true },
    { name: "group_id", label: "تیم", type: "group", system: true, hidden: true, audit: false },
  ],
  states: PAGE_STATES,
  scope: { own: ["user_id"], requester: [], group: "group_id" },
  list: { columns: ["number", "alert_id", "user_id", "level", "state", "sent_at", "acknowledged_at"], order: "-sent_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings row

const eventConfig: TableDef = {
  key: "event_config",
  table: "sm_event_configs",
  label: "تنظیمات رویداد و کشیک",
  plural: "تنظیمات رویداد و کشیک",
  icon: "settings-2",
  module: "event",
  area: "settings",
  description: "نگهداشت رویدادها، نوسان، بازگشایی، بستن خودکار، رویدادهای گذرا و پیوندهای فراخوان",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات رویداد", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "retention_days", label: "نگهداشت رویدادها (روز)", type: "int", min: 1, max: 365, default: EVENT_CONFIG_DEFAULTS.retention_days, span: 8 },
    { name: "flap_threshold", label: "نوسان از چند بار", type: "int", min: 2, max: 50, default: EVENT_CONFIG_DEFAULTS.flap_threshold, span: 8, help: "بازگشایی پس از رفع در بازهٔ نوسان" },
    { name: "flap_window_minutes", label: "بازهٔ نوسان (دقیقه)", type: "int", min: 1, max: 1440, default: EVENT_CONFIG_DEFAULTS.flap_window_minutes, span: 8 },
    { name: "reopen_minutes", label: "بازگشایی هشدار رفع‌شده تا (دقیقه)", type: "int", min: 0, max: 10080, default: EVENT_CONFIG_DEFAULTS.reopen_minutes, span: 8, help: "پس از آن رویداد تازه هشدار تازه می‌سازد" },
    { name: "auto_close_minutes", label: "بستن خودکار رفع‌شده‌ها پس از (دقیقه)", type: "int", min: 0, max: 10080, default: EVENT_CONFIG_DEFAULTS.auto_close_minutes, span: 8, help: "صفر: هرگز" },
    { name: "transient_seconds", label: "رویداد گذرا تا (ثانیه)", type: "int", min: 0, max: 86400, default: EVENT_CONFIG_DEFAULTS.transient_seconds, span: 8, help: "هشداری که زودتر از این، بی‌تأیید رفع شود «احتمالاً نویز» است" },
    { name: "ack_link_hours", label: "اعتبار پیوند تأیید (ساعت)", type: "int", min: 1, max: 168, default: EVENT_CONFIG_DEFAULTS.ack_link_hours, span: 8 },
    { name: "incident_on_exhausted", label: "رخداد برای هشدار بی‌پاسخ پس از همهٔ سطح‌ها", type: "bool", default: true, span: 8 },
    { name: "default_policy_id", label: "سیاست ارتقای پیش‌فرض", type: "ref", ref: "escalation_policy", span: 12, help: "برای هشدارهایی که قاعدهٔ مسیریابی و سیاست تیم ندارند" },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "retention_days", "auto_close_minutes"], order: "name" },
};

/** An incident raised from an alert (stored once, alert → incident; listed on both). */
registerLinkKind("raised", { out: "رخدادِ ساخته‌شده", in: "برآمده از هشدار" });

export const EVENT_TABLES: TableDef[] = [
  eventSource,
  event,
  eventRule,
  alert,
  alertGroup,
  correlationRule,
  alertIncidentRule,
  alertRoute,
  oncallSchedule,
  oncallRotation,
  oncallOverride,
  escalationPolicy,
  escalationLevel,
  page,
  eventConfig,
];
