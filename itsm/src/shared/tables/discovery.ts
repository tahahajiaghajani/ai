// Tables of the discovery module (design A §5, docs/modules/discovery_FA.md): the configured tools («منبع‌های داده»),
// what each tool reported (one item per tool id — the identity map onto CIs and assets), status and contact per CI or
// asset, the open problems tools report, every pass of a connector, pushed batches and staged software.
//
// Every table is local to its runtime (`sync: false`, listed in LOCAL_ONLY of tests/sync-registry.test.ts): the
// Windows app neither runs connectors nor shows their status, and no synced table gains a column, so SYNC_PROTOCOL
// does not move (§19). The connector is the only table people write (CMDB administrators, under the module's write
// hook, §14.5); every other table is the module's bookkeeping, written with set-based SQL in `internal` transactions
// that take no write-admission slot (§7.1) — `rowAccess.write: NEVER` keeps the record API, AI tools and Windows pushes
// out of them. Items, problems, runs, batches and staged software are read only by readers of their connector
// (`scope.parent`); the status rows by whoever reads the CMDB (ids, states and times only); the item's normalised
// record is in field group `internal`. Area `cmdb`, module `discovery`.
// Imported by the UI: keep it free of server imports.
import type { TableDef } from "../model/types";
import { NEVER } from "../model/conditions";
import {
  API_KEY_HEADER_OPTIONS, AUTH_OPTIONS, BATCH_STATES, COLLECT_OPTIONS, CREATE_POLICIES, ITEM_KINDS, ITEM_STATES, MISMATCH_STATES, MISSING_ACTIONS, RUN_LANES,
  RUN_STATES, RUN_TRIGGERS, STATUS_WORDS,
} from "../discovery/types";
import { KIND_OPTIONS, RELAY_KIND_OPTIONS } from "../discovery/kinds";
import { DEVICE_STATUS } from "./itam";
import { ALERT_SEVERITIES } from "./event";

const CONNECT = "اتصال";
const COLLECT = "چه بیاید";
const SCHEDULE = "زمان‌بندی و آشتی";
const CONTACT = "تماس و کهنگی";
const ATM = "خودپردازها";
const FEEDS = "دارایی و نرم‌افزار";

// ---------------------------------------------------------------------------------------------------------------
// The configured tool (§5.1)

const connector: TableDef = {
  key: "discovery_connector",
  table: "sm_discovery_connectors",
  label: "منبع داده",
  plural: "منبع‌های داده",
  icon: "radar",
  module: "discovery",
  area: "cmdb",
  description: "یک ابزار پایش، کشف یا مدیریت رایانه که دارایی‌ها و وضعیت آن‌ها را به کاریز می‌رساند؛ هر منبع یک منبع دادهٔ پیکربندی دارد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, unique: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: CONNECT },
    { name: "kind", label: "نوع ابزار", type: "choice", choices: KIND_OPTIONS, required: true, list: true, filter: true, span: 12, section: CONNECT, help: "پس از ساخت تغییر نمی‌کند" },
    { name: "relay_kind", label: "ابزار پشت رله", type: "choice", choices: RELAY_KIND_OPTIONS, filter: true, span: 12, section: CONNECT, help: "برای منبع «ارسال از ابزار» که رلهٔ کاریز داده‌اش را می‌فرستد" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: CONNECT },
    { name: "source_id", label: "منبع دادهٔ پیکربندی", type: "ref", ref: "cmdb_data_source", readonly: true, span: 12, section: CONNECT },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", list: true, filter: true, span: 12, section: CONNECT },
    { name: "base_url", label: "نشانی ابزار", type: "url", maxLength: 500, ltr: true, span: 24, section: CONNECT },
    { name: "hosts", label: "میزبان‌های مجاز دیگر", type: "tags", span: 24, section: CONNECT, help: "نام دیگر همان ابزار، مانند میزبان رابط وب برای پیوندها" },
    { name: "plain_http", label: "اتصال بدون رمزنگاری (فقط شبکهٔ داخلی)", type: "bool", default: false, span: 12, section: CONNECT },
    { name: "auth", label: "روش ورود", type: "choice", choices: AUTH_OPTIONS, span: 12, section: CONNECT },
    { name: "username", label: "نام کاربری", type: "string", maxLength: 200, ltr: true, span: 12, section: CONNECT },
    { name: "secret", label: "کلید یا گذرواژه", type: "secret", hint: false, span: 12, section: CONNECT },
    { name: "secret2", label: "کلید دوم", type: "secret", hint: false, span: 12, section: CONNECT, help: "برای ابزاری که دو کلید می‌خواهد، مانند App-Token در GLPI یا رمز برنامه در OAuth" },
    { name: "api_key_header", label: "سرآیند کلید", type: "choice", choices: API_KEY_HEADER_OPTIONS, span: 12, section: CONNECT },
    { name: "directory_source_id", label: "منبع فهرست کاربران", type: "ref", ref: "directory_source", span: 12, section: CONNECT },
    { name: "directory_approved_by", label: "تأییدکنندهٔ استفاده از فهرست", type: "user", system: true, span: 6, section: CONNECT },
    { name: "directory_approved_at", label: "زمان تأیید فهرست", type: "datetime", system: true, span: 6, section: CONNECT },
    { name: "ca_cert", label: "گواهی ریشهٔ ابزار (PEM)", type: "text", ltr: true, span: 24, section: CONNECT, help: "خالی: گواهی‌های مورد اعتماد سرور" },
    { name: "push_user_id", label: "کاربر یکپارچه‌سازیِ ارسال‌کننده", type: "user", span: 12, section: CONNECT },
    { name: "description", label: "شرح", type: "text", span: 24, section: CONNECT },

    { name: "collect", label: "چه بیاید", type: "multichoice", choices: COLLECT_OPTIONS, span: 24, section: COLLECT },
    { name: "options", label: "تنظیمات ابزار", type: "json", default: {}, span: 24, section: COLLECT },
    { name: "mapping", label: "نگاشت فیلدها", type: "json", default: {}, span: 24, section: COLLECT },
    { name: "create_policy", label: "سیاست ساخت", type: "choice", choices: CREATE_POLICIES, default: "create", span: 12, section: COLLECT },
    { name: "default_class", label: "کلاس پیش‌فرض", type: "choice", choices: "ci.class", span: 12, section: COLLECT },
    { name: "event_source_id", label: "منبع رویداد", type: "ref", ref: "event_source", readonly: true, span: 12, section: COLLECT },

    { name: "every_minutes", label: "فهرست هر چند دقیقه", type: "int", min: 0, max: 10080, default: 60, span: 8, section: SCHEDULE, help: "صفر: فقط دستی" },
    { name: "status_every_minutes", label: "وضعیت هر چند دقیقه", type: "int", min: 0, max: 1440, default: 0, span: 8, section: SCHEDULE, help: "صفر: همراه فهرست" },
    { name: "rate_per_second", label: "سقف درخواست در ثانیه", type: "int", min: 1, max: 100, default: 5, span: 8, section: SCHEDULE },
    { name: "refresh_days", label: "بازآشتی موارد پیوسته هر چند روز", type: "int", min: 1, max: 365, default: 7, span: 8, section: SCHEDULE },
    { name: "retry_hours", label: "تلاش دوباره برای موارد بی‌همتا هر چند ساعت", type: "int", min: 1, max: 720, default: 24, span: 8, section: SCHEDULE },
    { name: "over_manual", label: "معتبرتر از ویرایش دستی", type: "bool", default: false, span: 8, section: SCHEDULE },
    { name: "config_version", label: "نسخهٔ پیکربندی", type: "int", system: true, default: 1, audit: false, span: 8, section: SCHEDULE },

    { name: "stale_days", label: "کهنه پس از چند روز بی‌تماس", type: "int", min: 1, max: 3650, default: 14, span: 8, section: CONTACT },
    { name: "missing_days", label: "مفقود پس از چند روز بی‌تماس", type: "int", min: 1, max: 3650, default: 45, span: 8, section: CONTACT },
    { name: "missing_action", label: "دارایی بی‌تماس", type: "choice", choices: MISSING_ACTIONS, default: "task", span: 8, section: CONTACT },
    { name: "retire_days", label: "بازنشستگی پیکربندی پس از چند روز بی‌تماس", type: "int", min: 0, max: 3650, default: 0, span: 8, section: CONTACT, help: "صفر: خاموش" },

    { name: "device_status_map", label: "نگاشت وضعیت خودپرداز", type: "json", default: {}, span: 24, section: ATM },
    { name: "device_hold_minutes", label: "درنگ پیش از ثبت وضعیت (دقیقه)", type: "int", min: 0, max: 1440, default: 10, span: 8, section: ATM },
    { name: "manual_hold_hours", label: "احترام به اصلاح دستی (ساعت)", type: "int", min: 0, max: 720, default: 24, span: 8, section: ATM },

    { name: "make_assets", label: "ساخت دارایی برای دستگاه‌های تازه", type: "bool", default: false, span: 12, section: FEEDS },
    { name: "make_assets_daily", label: "سقف روزانهٔ ساخت دارایی", type: "int", min: 0, max: 100000, default: 5000, span: 12, section: FEEDS },
  ],
  scope: { own: ["owner_id"] },
  features: { sync: false, history: true, journal: true },
  form: { sections: [CONNECT, COLLECT, SCHEDULE, CONTACT, ATM, FEEDS] },
  list: { columns: ["name", "kind", "active", "owner_id", "every_minutes", "updated_at"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// What a tool reported (§5.2)

const item: TableDef = {
  key: "discovery_item",
  table: "sm_discovery_items",
  label: "مورد منبع داده",
  plural: "موارد منبع داده",
  icon: "scan-line",
  module: "discovery",
  area: "cmdb",
  description: "آنچه یک منبع داده گزارش کرده است، با پیکربندی یا دارایی‌ای که با آن یکی دانسته شد؛ فقط خود ماژول آن را می‌نویسد",
  display: "name",
  fields: [
    { name: "connector_id", label: "منبع داده", type: "ref", ref: "discovery_connector", required: true, readonly: true, list: true, filter: true, span: 12 },
    { name: "external_id", label: "شناسه در ابزار", type: "string", required: true, readonly: true, maxLength: 200, ltr: true, search: true, filter: true, span: 12 },
    { name: "kind", label: "گونه", type: "choice", choices: ITEM_KINDS, readonly: true, list: true, filter: true, span: 8 },
    { name: "name", label: "نام", type: "string", readonly: true, maxLength: 200, list: true, search: true, sort: true, span: 16 },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", readonly: true, filter: true, index: true, span: 12 },
    { name: "state", label: "وضعیت آشتی", type: "choice", choices: ITEM_STATES, readonly: true, list: true, filter: true, span: 8, help: "خالی: هنوز آشتی نشده" },
    { name: "matched_by", label: "شناسایی با", type: "string", readonly: true, maxLength: 200, span: 8 },
    { name: "message", label: "پیام آخرین آشتی", type: "string", readonly: true, maxLength: 500, span: 24 },
    { name: "hash", label: "چکیدهٔ داده", type: "string", system: true, hidden: true, maxLength: 64, audit: false },
    { name: "reconciled_at", label: "آخرین آشتی", type: "datetime", readonly: true, sort: true, filter: true, span: 8 },
    { name: "retry_at", label: "تلاش دوباره", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "first_seen_at", label: "نخستین گزارش", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "listed_at", label: "آخرین فهرست", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "last_contact_at", label: "آخرین تماس ابزار با دستگاه", type: "datetime", readonly: true, list: true, sort: true, filter: true, span: 8 },
    { name: "seen_generation", label: "نسل فهرست", type: "int", system: true, hidden: true, audit: false },
    { name: "status", label: "وضعیت پایش", type: "choice", choices: STATUS_WORDS, readonly: true, list: true, filter: true, span: 8 },
    { name: "status_since", label: "وضعیت از", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "status_message", label: "پیام وضعیت", type: "string", readonly: true, maxLength: 500, span: 24 },
    { name: "link_url", label: "پیوند در ابزار", type: "url", readonly: true, maxLength: 1000, ltr: true, span: 24 },
    { name: "data", label: "دادهٔ گزارش‌شده", type: "json", readonly: true, group: "internal", span: 24 },
    { name: "mismatch", label: "ناهمخوانی‌ها", type: "json", readonly: true, span: 24 },
    { name: "mismatch_state", label: "ناهمخوانی", type: "choice", choices: MISMATCH_STATES, readonly: true, filter: true, span: 8 },
    { name: "dedup_task_id", label: "بررسی تکراری", type: "ref", ref: "cmdb_dedup_task", readonly: true, span: 8 },
    { name: "software_hash", label: "چکیدهٔ نرم‌افزارها", type: "string", system: true, hidden: true, maxLength: 64, audit: false },
  ],
  scope: { parent: "connector_id" },
  rowAccess: { write: NEVER },
  features: { sync: false, history: false },
  unique: [["connector_id", "external_id"]],
  indexes: [
    { name: "conn_state_idx", cols: ["connector_id", "state"] },
    { name: "conn_refresh_idx", cols: ["connector_id", "reconciled_at"], where: "state = 'linked'" },
    { name: "conn_retry_idx", cols: ["connector_id", "retry_at"], where: "state in ('unmatched', 'duplicate', 'error')" },
    { name: "conn_listed_idx", cols: ["connector_id", "listed_at"] },
    // items waiting for the reconciliation engine (new, changed, listed again): the runner's work list (§7.3)
    { name: "conn_pending_idx", cols: ["connector_id", "id"], where: "reconciled_at is null" },
    // a closed de-duplication task re-queues the items that name it (§7.4)
    { name: "dedup_idx", cols: ["dedup_task_id"], where: "dedup_task_id is not null" },
  ],
  list: { columns: ["name", "connector_id", "kind", "state", "ci_id", "status", "last_contact_at"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Status and contact per CI or asset (§5.3)

const state: TableDef = {
  key: "discovery_state",
  table: "sm_discovery_states",
  label: "وضعیت پایش",
  plural: "وضعیت‌های پایش",
  icon: "heart-pulse",
  module: "discovery",
  area: "cmdb",
  description: "وضعیت پایش و آخرین تماس هر پیکربندی یا دارایی از همهٔ منبع‌ها؛ بیرون از رکوردهای همگام‌شونده نگه داشته می‌شود",
  display: "monitor_status",
  fields: [
    { name: "target_table", label: "جدول", type: "choice", choices: [{ value: "ci", label: "پیکربندی" }, { value: "asset", label: "دارایی" }], required: true, readonly: true, filter: true, span: 8 },
    { name: "target_id", label: "شناسهٔ رکورد", type: "string", required: true, readonly: true, maxLength: 36, ltr: true, span: 16 },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "monitor_status", label: "وضعیت پایش", type: "choice", choices: STATUS_WORDS, readonly: true, list: true, filter: true, index: true, span: 8 },
    { name: "monitor_since", label: "از", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "monitor_message", label: "پیام", type: "string", readonly: true, maxLength: 500, span: 24 },
    { name: "sources", label: "منبع‌های تازه", type: "int", readonly: true, list: true, span: 6 },
    { name: "signals", label: "نشانه‌های هشدار", type: "json", readonly: true, span: 24 },
    { name: "last_contact_at", label: "آخرین تماس", type: "datetime", readonly: true, list: true, sort: true, filter: true, span: 8 },
    { name: "contact_item_id", label: "منبع آخرین تماس", type: "ref", ref: "discovery_item", readonly: true, span: 8 },
    { name: "last_listed_at", label: "آخرین فهرست", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "stale_since", label: "کهنه از", type: "datetime", readonly: true, filter: true, span: 8 },
    { name: "missing_since", label: "بی‌تماس طولانی از", type: "datetime", readonly: true, filter: true, span: 8 },
    { name: "missing_todo_id", label: "کار پیگیری", type: "ref", ref: "todo", readonly: true, span: 8 },
    { name: "device_reported", label: "وضعیت گزارش‌شدهٔ خودپرداز", type: "choice", choices: DEVICE_STATUS, readonly: true, span: 8 },
    { name: "device_reported_since", label: "گزارش‌شده از", type: "datetime", readonly: true, span: 8 },
    { name: "device_pending", label: "وضعیت در انتظار درنگ", type: "choice", choices: DEVICE_STATUS, readonly: true, span: 8 },
    { name: "device_pending_since", label: "در انتظار از", type: "datetime", readonly: true, span: 8 },
    { name: "device_pending_polls", label: "گزارش‌های پیاپی", type: "int", readonly: true, span: 8 },
    { name: "device_applied", label: "وضعیت ثبت‌شده به دست کاریز", type: "choice", choices: DEVICE_STATUS, readonly: true, span: 8 },
    { name: "device_applied_at", label: "زمان ثبت", type: "datetime", readonly: true, span: 8 },
  ],
  // ids, states and times only: whoever reads the CMDB may list them; others see them through the module's routes,
  // which check the CI or asset with the engine's read rules (§14.5)
  scope: { public: true },
  rowAccess: { write: NEVER },
  features: { sync: false, history: false },
  unique: [["target_table", "target_id"]],
  list: { columns: ["target_table", "ci_id", "asset_id", "monitor_status", "monitor_since", "last_contact_at", "sources"], order: "-updated_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Open problems a tool reports (§5.4)

const problem: TableDef = {
  key: "discovery_problem",
  table: "sm_discovery_problems",
  label: "مشکل گزارش‌شدهٔ ابزار",
  plural: "مشکل‌های گزارش‌شدهٔ ابزارها",
  icon: "triangle-alert",
  module: "discovery",
  area: "cmdb",
  description: "مشکل‌های باز هر منبع داده و آنچه از آن‌ها به مدیریت رویداد رسیده است",
  display: "problem_key",
  fields: [
    { name: "connector_id", label: "منبع داده", type: "ref", ref: "discovery_connector", required: true, readonly: true, list: true, filter: true, span: 12 },
    { name: "item_id", label: "مورد", type: "ref", ref: "discovery_item", readonly: true, filter: true, span: 12 },
    { name: "problem_key", label: "شناسهٔ مشکل در ابزار", type: "string", required: true, readonly: true, maxLength: 200, ltr: true, span: 12 },
    { name: "fingerprint", label: "اثر انگشت", type: "string", readonly: true, maxLength: 300, ltr: true, span: 12 },
    { name: "severity", label: "شدت", type: "choice", choices: ALERT_SEVERITIES, readonly: true, list: true, filter: true, span: 8 },
    { name: "availability", label: "از دسترس خارج است", type: "bool", readonly: true, default: false, filter: true, span: 8 },
    { name: "message", label: "پیام", type: "string", readonly: true, maxLength: 500, list: true, span: 24 },
    { name: "opened_at", label: "باز شده", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "last_seen_at", label: "آخرین گزارش", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "cleared_at", label: "برطرف شده", type: "datetime", readonly: true, filter: true, span: 8 },
    { name: "sent_firing", label: "هشدار فرستاده شد", type: "bool", readonly: true, default: false, span: 8 },
    { name: "sent_clear", label: "رفع فرستاده شد", type: "bool", readonly: true, default: false, span: 8 },
    { name: "sent_seq", label: "شمارهٔ ارسال", type: "int", readonly: true, default: 0, span: 8 },
  ],
  scope: { parent: "connector_id" },
  rowAccess: { write: NEVER },
  features: { sync: false, history: false },
  unique: [["connector_id", "problem_key"]],
  indexes: [{ name: "open_idx", cols: ["connector_id", "opened_at"], where: "cleared_at is null" }],
  list: { columns: ["connector_id", "severity", "message", "opened_at", "cleared_at"], order: "-opened_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Every pass (§5.5)

const counter = (name: string, label: string) => ({ name, label, type: "int" as const, readonly: true, default: 0, span: 6 as const });

const run: TableDef = {
  key: "discovery_run",
  table: "sm_discovery_runs",
  label: "اجرای منبع داده",
  plural: "اجراهای منبع داده",
  icon: "history",
  module: "discovery",
  area: "cmdb",
  description: "هر گذر یک منبع داده — فهرست، وضعیت، دستهٔ ارسالی یا پیش‌نمایش — با شمارش‌ها، مدت و جای ادامه",
  display: "lane",
  fields: [
    { name: "connector_id", label: "منبع داده", type: "ref", ref: "discovery_connector", required: true, readonly: true, list: true, filter: true, span: 12 },
    { name: "lane", label: "گذر", type: "choice", choices: RUN_LANES, required: true, readonly: true, list: true, filter: true, span: 6 },
    { name: "trigger", label: "آغاز به سبب", type: "choice", choices: RUN_TRIGGERS, readonly: true, list: true, filter: true, span: 6 },
    { name: "state", label: "وضعیت", type: "choice", choices: RUN_STATES, default: "running", readonly: true, list: true, filter: true, span: 6 },
    { name: "started_at", label: "آغاز", type: "datetime", readonly: true, list: true, sort: true, span: 6 },
    { name: "finished_at", label: "پایان", type: "datetime", readonly: true, sort: true, span: 6 },
    { name: "duration_ms", label: "مدت (میلی‌ثانیه)", type: "int", readonly: true, span: 6 },
    { name: "cursor", label: "جای ادامه", type: "json", system: true, hidden: true, audit: false },
    { name: "generation", label: "نسل فهرست", type: "int", readonly: true, span: 6 },
    counter("pages", "صفحه‌ها"),
    counter("fetched", "خوانده‌شده"),
    counter("staged", "ثبت‌شده"),
    counter("skipped_unchanged", "بی‌تغییر"),
    counter("refreshed", "بازآشتی"),
    counter("retried", "تلاش دوباره"),
    counter("created", "ساخته‌شده"),
    counter("updated", "به‌روزشده"),
    counter("unmatched", "بی‌همتا"),
    counter("duplicates", "تکراری"),
    counter("failed", "ناموفق"),
    counter("stale_marked", "کهنه‌شده"),
    counter("problems_opened", "مشکل تازه"),
    counter("problems_cleared", "مشکل برطرف‌شده"),
    { name: "complete", label: "فهرست کامل", type: "bool", readonly: true, default: false, span: 6 },
    { name: "items_total", label: "کل موارد", type: "int", readonly: true, span: 6 },
    { name: "warnings", label: "هشدارها", type: "json", readonly: true, span: 24 },
    { name: "error", label: "خطا", type: "text", readonly: true, span: 24 },
    { name: "import_run_id", label: "اجرای ورود داده", type: "ref", ref: "cmdb_import_run", readonly: true, span: 12 },
    // the worker that holds the pass (two ticks of one connector never work one pass at once, §17)
    { name: "lease_by", label: "کارگزار", type: "string", system: true, hidden: true, maxLength: 80, audit: false },
    { name: "lease_until", label: "در دست تا", type: "datetime", system: true, hidden: true, audit: false },
  ],
  scope: { parent: "connector_id" },
  rowAccess: { write: NEVER },
  features: { sync: false, history: false },
  indexes: [
    // one running pass per connector and lane (§5.5)
    { name: "running_uk", cols: ["connector_id", "lane"], where: "state = 'running'", unique: true },
    { name: "conn_lane_idx", cols: ["connector_id", "lane", "started_at desc"] },
  ],
  list: { columns: ["connector_id", "lane", "trigger", "state", "started_at", "fetched", "created", "updated", "failed"], order: "-started_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Pushed batches (§5.6)

const batch: TableDef = {
  key: "discovery_batch",
  table: "sm_discovery_batches",
  label: "دستهٔ ارسالی",
  plural: "دسته‌های ارسالی",
  icon: "package",
  module: "discovery",
  area: "cmdb",
  description: "هر دسته‌ای که ابزاری از راه API فرستاده است، با نتیجه‌اش؛ همان شناسهٔ دسته دو بار پردازش نمی‌شود",
  display: "batch_id",
  fields: [
    { name: "connector_id", label: "منبع داده", type: "ref", ref: "discovery_connector", required: true, readonly: true, list: true, filter: true, span: 12 },
    { name: "batch_id", label: "شناسهٔ دسته", type: "string", required: true, readonly: true, maxLength: 200, ltr: true, list: true, search: true, span: 12 },
    { name: "received_at", label: "دریافت", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "key_id", label: "کلید API", type: "string", readonly: true, maxLength: 64, ltr: true, span: 8 },
    { name: "records", label: "رکوردها", type: "int", readonly: true, list: true, span: 8 },
    { name: "state", label: "وضعیت", type: "choice", choices: BATCH_STATES, default: "queued", readonly: true, list: true, filter: true, span: 8 },
    { name: "result", label: "نتیجه", type: "json", readonly: true, span: 24 },
    { name: "snapshot_id", label: "تصویر کامل", type: "string", readonly: true, maxLength: 200, ltr: true, filter: true, span: 8 },
    { name: "part", label: "بخش", type: "int", readonly: true, span: 8 },
    { name: "parts", label: "از چند بخش", type: "int", readonly: true, span: 8 },
  ],
  scope: { parent: "connector_id" },
  rowAccess: { write: NEVER },
  features: { sync: false, history: false },
  unique: [["connector_id", "batch_id"]],
  indexes: [{ name: "snapshot_idx", cols: ["connector_id", "snapshot_id"], where: "snapshot_id is not null" }],
  list: { columns: ["connector_id", "batch_id", "received_at", "records", "state"], order: "-received_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Staged software (§5.7; DA7)

const software: TableDef = {
  key: "discovery_software",
  table: "sm_discovery_software",
  label: "نرم‌افزار گزارش‌شده",
  plural: "نرم‌افزارهای گزارش‌شده",
  icon: "app-window",
  module: "discovery",
  area: "cmdb",
  description: "نرم‌افزارهای نصب‌شدهٔ هر دستگاه به گزارش ابزار، پیش از رسیدن به مدیریت دارایی نرم‌افزار؛ هرگز پیکربندی نمی‌شوند",
  display: "raw_name",
  fields: [
    { name: "connector_id", label: "منبع داده", type: "ref", ref: "discovery_connector", required: true, readonly: true, filter: true, span: 12 },
    { name: "item_id", label: "مورد", type: "ref", ref: "discovery_item", required: true, readonly: true, filter: true, span: 12 },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", readonly: true, filter: true, index: true, span: 12 },
    { name: "name_key", label: "نام یکسان‌شده", type: "string", required: true, readonly: true, maxLength: 300, filter: true, index: true, span: 12 },
    // the design's `version` (a base column of every engine table); empty, never null, when the tool tells none: it is
    // part of the unique key
    { name: "sw_version", label: "نسخه", type: "string", readonly: true, maxLength: 120, ltr: true, span: 8 },
    { name: "raw_name", label: "نام در ابزار", type: "string", readonly: true, maxLength: 300, list: true, search: true, span: 16 },
    { name: "publisher", label: "ناشر", type: "string", readonly: true, maxLength: 200, list: true, span: 12 },
    { name: "first_seen_at", label: "نخستین گزارش", type: "datetime", readonly: true, sort: true, span: 6 },
    { name: "last_seen_at", label: "آخرین گزارش", type: "datetime", readonly: true, sort: true, span: 6 },
    { name: "software_model_id", label: "مدل نرم‌افزار", type: "ref", ref: "software_model", readonly: true, filter: true, span: 12 },
    { name: "install_id", label: "نصب ثبت‌شده", type: "ref", ref: "software_install", readonly: true, span: 12 },
  ],
  scope: { parent: "connector_id" },
  rowAccess: { write: NEVER },
  features: { sync: false, history: false },
  unique: [["item_id", "name_key", "sw_version"]],
  list: { columns: ["raw_name", "sw_version", "publisher", "ci_id", "software_model_id", "last_seen_at"], order: "raw_name" },
};

export const DISCOVERY_TABLES: TableDef[] = [connector, item, state, problem, run, batch, software];
