// Tables of DevOps (docs/modules/devops_FA.md, catalogue docs/catalog/g3_change.md «Module: devops»): connections to
// repository and pipeline tools (GitHub, GitLab, Azure DevOps, Jenkins or any tool through the generic format) with a
// webhook secret sealed by the engine, repositories and pipelines mapped to services, the raw inbound events (signed,
// idempotent by delivery id; kept on the web version only), the normalised development data (commits, pull requests,
// builds — linked to records by the record numbers they mention), deployment gate requests (the pipeline asks before
// it deploys; evidence hash-chained), and the technical debt register. Deployments themselves are the release module's
// `deployment` table. Everything is in the access area `release`. Behaviour: src/server/modules/devops; pure logic
// (payload normalisation, DORA metrics): src/shared/devops/logic.ts; screens: src/ui/modules/devops.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { APPROVAL_STATES } from "../model/task";

export const CONNECTION_KINDS: Option[] = [
  { value: "github", label: "GitHub", order: 1 },
  { value: "gitlab", label: "GitLab", order: 2 },
  { value: "azure_devops", label: "Azure DevOps", order: 3 },
  { value: "jenkins", label: "Jenkins", order: 4 },
  { value: "generic", label: "قالب عمومی (هر ابزار)", order: 5 },
];

export const CONNECTION_HEALTH: Option[] = [
  { value: "unknown", label: "رویدادی نرسیده", color: "gray", order: 1 },
  { value: "ok", label: "سالم", color: "green", order: 2 },
  { value: "warning", label: "هشدار", color: "gold", order: 3 },
  { value: "error", label: "خطا", color: "red", order: 4 },
];

export const EVENT_KINDS: Option[] = [
  { value: "push", label: "ارسال کد (push)" },
  { value: "pull_request", label: "درخواست ادغام" },
  { value: "build", label: "اجرای خط لوله" },
  { value: "deployment", label: "استقرار" },
  { value: "test", label: "نتیجهٔ آزمون" },
  { value: "flag", label: "پرچم ویژگی" },
  { value: "ping", label: "آزمایش اتصال" },
  { value: "other", label: "دیگر" },
];

export const EVENT_STATUSES: Option[] = [
  { value: "received", label: "دریافت شد", color: "blue", order: 1 },
  { value: "processed", label: "پردازش شد", color: "green", order: 2 },
  { value: "ignored", label: "نادیده گرفته شد", color: "gray", order: 3 },
  { value: "failed", label: "ناموفق", color: "red", order: 4 },
];

export const VERIFIED_BY: Option[] = [
  { value: "hmac", label: "امضای HMAC" },
  { value: "token", label: "توکن مشترک" },
  { value: "basic", label: "احراز پایه" },
];

export const PR_STATES: Option[] = [
  { value: "open", label: "باز", color: "blue", order: 1 },
  { value: "merged", label: "ادغام‌شده", color: "purple", order: 2 },
  { value: "closed", label: "بسته", color: "gray", order: 3 },
];

export const BUILD_STATUSES: Option[] = [
  { value: "queued", label: "در صف", color: "gray", order: 1 },
  { value: "running", label: "در حال اجرا", color: "blue", order: 2 },
  { value: "succeeded", label: "موفق", color: "green", order: 3 },
  { value: "failed", label: "ناموفق", color: "red", order: 4 },
  { value: "canceled", label: "لغوشده", color: "gray", order: 5 },
];

export const VISIBILITIES: Option[] = [
  { value: "private", label: "خصوصی" },
  { value: "internal", label: "درون‌سازمانی" },
  { value: "public", label: "عمومی" },
];

export const DEBT_CAUSES: Option[] = [
  { value: "deliberate", label: "آگاهانه (برای سرعت)" },
  { value: "accidental", label: "ناآگاهانه" },
  { value: "bit_rot", label: "فرسودگی کد" },
  { value: "dependency", label: "وابستگی کهنه یا ناامن" },
  { value: "architecture", label: "معماری" },
  { value: "test", label: "کمبود آزمون" },
];

export const LEVELS: Option[] = [
  { value: "low", label: "کم", color: "green", order: 1 },
  { value: "medium", label: "متوسط", color: "gold", order: 2 },
  { value: "high", label: "زیاد", color: "red", order: 3 },
];

const MAIN = "اصلی";
const CHANGE = "تغییر و دروازه";
const STATUS = "وضعیت";

const connection: TableDef = {
  key: "devops_connection",
  table: "sm_devops_connections",
  label: "اتصال دواپس",
  plural: "اتصال‌های دواپس",
  icon: "plug",
  module: "devops",
  area: "release",
  description: "اتصال یک ابزار مخزن یا خط لوله: نشانی وب‌هوک با کلید عمومی و راز امضا، خدمت و تیم پیش‌فرض، و تغییر استاندارد خودکار",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "kind", label: "ابزار", type: "choice", choices: CONNECTION_KINDS, required: true, default: "github", list: true, filter: true, span: 6, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "base_url", label: "نشانی ابزار", type: "url", span: 12, section: MAIN },
    { name: "principal", label: "شناسهٔ ماشینی", type: "string", maxLength: 120, span: 12, section: MAIN, help: "نامی که در استقرارها به‌عنوان آغازگر ثبت می‌شود" },
    { name: "hook_key", label: "کلید نشانی وب‌هوک", type: "string", maxLength: 80, readonly: true, ltr: true, unique: true, span: 12, section: MAIN },
    { name: "secret", label: "راز امضا", type: "secret", span: 12, section: MAIN, help: "هنگام ساخت یا چرخش یک بار نمایش داده می‌شود" },
    { name: "secret_rotated_at", label: "آخرین چرخش راز", type: "datetime", readonly: true, span: 12, section: MAIN },
    { name: "service_id", label: "خدمت پیش‌فرض", type: "ref", ref: "service", span: 12, section: MAIN },
    { name: "assignment_group_id", label: "تیم پیش‌فرض", type: "group", span: 12, section: MAIN },
    { name: "description", label: "شرح", type: "text", span: 24, section: MAIN },

    { name: "auto_change", label: "تغییر استاندارد خودکار برای استقرار عملیاتی", type: "bool", default: true, span: 12, section: CHANGE },
    { name: "change_template_id", label: "الگوی تغییر استاندارد", type: "ref", ref: "change_template", refFilter: { f: "kind", op: "eq", v: "standard" }, span: 12, section: CHANGE, help: "خالی: الگوی پیش‌فرض تنظیمات انتشار" },
    { name: "close_changes", label: "بستن تغییر با پایان استقرار", type: "bool", default: true, span: 12, section: CHANGE },
    { name: "gate_timeout_minutes", label: "مهلت پاسخ دروازه (دقیقه)", type: "int", min: 5, max: 10080, default: 60, span: 12, section: CHANGE },
    { name: "env_map", label: "نگاشت نام محیط‌ها", type: "json", default: {}, span: 24, section: CHANGE, help: "{ \"production\": \"prod\" } — نام در ابزار ← کلید محیط" },

    { name: "health", label: "سلامت", type: "choice", choices: CONNECTION_HEALTH, readonly: true, default: "unknown", list: true, filter: true, span: 8, section: STATUS },
    { name: "last_event_at", label: "آخرین رویداد", type: "datetime", readonly: true, list: true, sort: true, audit: false, span: 8, section: STATUS },
    { name: "events_total", label: "رویدادها", type: "int", readonly: true, default: 0, audit: false, span: 8, section: STATUS },
    { name: "events_failed", label: "رویدادهای ناموفق", type: "int", readonly: true, default: 0, audit: false, span: 8, section: STATUS },
    { name: "last_error", label: "آخرین خطا", type: "text", readonly: true, audit: false, span: 16, section: STATUS },
  ],
  scope: { public: true },
  form: { sections: [MAIN, CHANGE, STATUS] },
  list: { columns: ["name", "kind", "health", "last_event_at", "active"], order: "name" },
};

const repository: TableDef = {
  key: "dev_repository",
  table: "sm_dev_repositories",
  label: "مخزن کد",
  plural: "مخزن‌های کد",
  icon: "git-branch",
  module: "devops",
  area: "release",
  description: "مخزن کد یک اتصال، نگاشته به خدمت و تیم مالک؛ با نخستین رویداد خودکار ساخته می‌شود",
  display: "name",
  fields: [
    { name: "name", label: "نام کامل", type: "string", required: true, maxLength: 200, ltr: true, list: true, search: true, sort: true, span: 12 },
    { name: "connection_id", label: "اتصال", type: "ref", ref: "devops_connection", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "url", label: "نشانی", type: "url", span: 12 },
    { name: "default_branch", label: "شاخهٔ اصلی", type: "string", maxLength: 120, ltr: true, span: 6 },
    { name: "visibility", label: "دسترسی", type: "choice", choices: VISIBILITIES, default: "private", span: 6 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, span: 12 },
    { name: "owner_group_id", label: "تیم مالک", type: "group", list: true, filter: true, span: 12 },
    { name: "external_id", label: "شناسهٔ بیرونی", type: "string", maxLength: 120, readonly: true, ltr: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 6 },
  ],
  unique: [["connection_id", "name"]],
  scope: { public: true, group: "owner_group_id" },
  list: { columns: ["name", "connection_id", "service_id", "owner_group_id"], order: "name" },
};

const pipeline: TableDef = {
  key: "dev_pipeline",
  table: "sm_dev_pipelines",
  label: "خط لوله",
  plural: "خط لوله‌ها",
  icon: "workflow",
  module: "devops",
  area: "release",
  description: "خط لولهٔ ساخت و استقرار یک مخزن: خدمت، محیط‌هایی که به آن‌ها مستقر می‌کند و الگوی تغییر استاندارد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 12 },
    { name: "connection_id", label: "اتصال", type: "ref", ref: "devops_connection", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "repository_id", label: "مخزن", type: "ref", ref: "dev_repository", list: true, filter: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, span: 12 },
    { name: "environments", label: "محیط‌ها", type: "refs", ref: "release_environment", span: 12 },
    { name: "change_template_id", label: "الگوی تغییر استاندارد", type: "ref", ref: "change_template", span: 12, help: "خالی: الگوی اتصال" },
    { name: "external_id", label: "شناسهٔ بیرونی", type: "string", maxLength: 120, readonly: true, ltr: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 6 },
  ],
  unique: [["connection_id", "name"]],
  scope: { public: true },
  list: { columns: ["name", "connection_id", "repository_id", "service_id"], order: "name" },
};

const event: TableDef = {
  key: "dev_event",
  table: "sm_dev_events",
  label: "رویداد دریافتی",
  plural: "رویدادهای دریافتی",
  icon: "inbox",
  module: "devops",
  area: "release",
  description: "رویدادی که ابزار فرستاده است: امضای بررسی‌شده، شناسهٔ تحویل (تکرار پذیرفته نمی‌شود)، نتیجهٔ پردازش",
  display: "delivery_id",
  fields: [
    { name: "connection_id", label: "اتصال", type: "ref", ref: "devops_connection", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "delivery_id", label: "شناسهٔ تحویل", type: "string", required: true, maxLength: 200, ltr: true, list: true, search: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: EVENT_KINDS, list: true, filter: true, span: 8 },
    { name: "provider_event", label: "رویداد ابزار", type: "string", maxLength: 120, ltr: true, list: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: EVENT_STATUSES, default: "received", list: true, filter: true, span: 8 },
    { name: "verified_by", label: "احراز با", type: "choice", choices: VERIFIED_BY, span: 8 },
    { name: "received_at", label: "زمان دریافت", type: "datetime", list: true, sort: true, index: true, span: 8 },
    { name: "processed_at", label: "زمان پردازش", type: "datetime", span: 8 },
    { name: "payload_hash", label: "چکیدهٔ بدنه", type: "string", maxLength: 80, ltr: true, index: true, span: 12 },
    { name: "error", label: "خطا", type: "text", span: 24 },
    { name: "result", label: "نتیجه", type: "json", default: {}, span: 24 },
    { name: "payload", label: "بدنه", type: "json", span: 24 },
  ],
  unique: [["connection_id", "delivery_id"]],
  scope: { public: true },
  features: { sync: false, history: false },
  list: { columns: ["received_at", "connection_id", "kind", "provider_event", "status", "delivery_id"], order: "-received_at" },
};

const commit: TableDef = {
  key: "dev_commit",
  table: "sm_dev_commits",
  label: "کامیت",
  plural: "کامیت‌ها",
  icon: "git-commit-horizontal",
  module: "devops",
  area: "release",
  description: "کامیتی که به مخزن رسیده است؛ شمارهٔ رکوردهایی که در پیامش آمده (INC…، CHG…، REL…) آن را به آن‌ها پیوند می‌دهد",
  display: "message",
  fields: [
    { name: "sha", label: "شناسه", type: "string", required: true, maxLength: 64, ltr: true, list: true, search: true, span: 12 },
    { name: "repository_id", label: "مخزن", type: "ref", ref: "dev_repository", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "message", label: "پیام", type: "text", search: true, list: true, span: 24 },
    { name: "author_name", label: "نویسنده", type: "string", maxLength: 160, list: true, span: 8 },
    { name: "author_email", label: "ایمیل نویسنده", type: "email", span: 8 },
    { name: "committed_at", label: "زمان", type: "datetime", list: true, sort: true, index: true, span: 8 },
    { name: "branch", label: "شاخه", type: "string", maxLength: 200, ltr: true, filter: true, span: 12 },
    { name: "url", label: "نشانی", type: "url", span: 12 },
    { name: "keys", label: "رکوردهای نام‌برده", type: "tags", filter: true, index: true, span: 24 },
  ],
  unique: [["repository_id", "sha"]],
  scope: { public: true },
  features: { sync: false, history: false },
  list: { columns: ["committed_at", "sha", "message", "author_name", "repository_id"], order: "-committed_at" },
};

const pullRequest: TableDef = {
  key: "dev_pull_request",
  table: "sm_dev_pull_requests",
  label: "درخواست ادغام",
  plural: "درخواست‌های ادغام",
  icon: "git-pull-request",
  module: "devops",
  area: "release",
  description: "درخواست ادغام (Pull/Merge Request) با وضعیت، شاخه‌ها و رکوردهایی که در عنوانش آمده‌اند",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 300, list: true, search: true, span: 16 },
    { name: "pr_number", label: "شماره", type: "int", list: true, span: 8 },
    { name: "repository_id", label: "مخزن", type: "ref", ref: "dev_repository", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "state", label: "وضعیت", type: "choice", choices: PR_STATES, default: "open", list: true, filter: true, span: 6 },
    { name: "author", label: "نویسنده", type: "string", maxLength: 160, list: true, span: 6 },
    { name: "source_branch", label: "از شاخه", type: "string", maxLength: 200, ltr: true, span: 12 },
    { name: "target_branch", label: "به شاخه", type: "string", maxLength: 200, ltr: true, span: 12 },
    { name: "opened_at", label: "زمان باز شدن", type: "datetime", sort: true, span: 8 },
    { name: "merged_at", label: "زمان ادغام", type: "datetime", sort: true, span: 8 },
    { name: "url", label: "نشانی", type: "url", span: 8 },
    { name: "keys", label: "رکوردهای نام‌برده", type: "tags", filter: true, index: true, span: 24 },
  ],
  unique: [["repository_id", "pr_number"]],
  scope: { public: true },
  features: { sync: false, history: false },
  list: { columns: ["pr_number", "title", "state", "author", "repository_id", "merged_at"], order: "-opened_at" },
};

const build: TableDef = {
  key: "dev_build",
  table: "sm_dev_builds",
  label: "اجرای خط لوله",
  plural: "اجراهای خط لوله",
  icon: "hammer",
  module: "devops",
  area: "release",
  description: "یک اجرای خط لوله (ساخت و آزمون): وضعیت، زمان‌ها، کامیت، نتیجهٔ آزمون‌ها و پوشش",
  display: "run_number",
  fields: [
    { name: "run_number", label: "اجرا", type: "string", required: true, maxLength: 80, ltr: true, list: true, search: true, span: 8 },
    { name: "pipeline_id", label: "خط لوله", type: "ref", ref: "dev_pipeline", list: true, filter: true, index: true, span: 8 },
    { name: "connection_id", label: "اتصال", type: "ref", ref: "devops_connection", required: true, filter: true, index: true, span: 8 },
    { name: "repository_id", label: "مخزن", type: "ref", ref: "dev_repository", filter: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: BUILD_STATUSES, default: "queued", list: true, filter: true, span: 8 },
    { name: "branch", label: "شاخه", type: "string", maxLength: 200, ltr: true, list: true, span: 8 },
    { name: "commit_sha", label: "کامیت", type: "string", maxLength: 64, ltr: true, search: true, span: 8 },
    { name: "started_at", label: "شروع", type: "datetime", list: true, sort: true, index: true, span: 8 },
    { name: "finished_at", label: "پایان", type: "datetime", sort: true, span: 8 },
    { name: "duration", label: "مدت", type: "duration", list: true, span: 8 },
    { name: "tests_total", label: "آزمون‌ها", type: "int", span: 8 },
    { name: "tests_failed", label: "آزمون‌های ناموفق", type: "int", filter: true, span: 8 },
    { name: "coverage", label: "پوشش آزمون", type: "percent", min: 0, max: 100, span: 8 },
    { name: "url", label: "نشانی", type: "url", span: 16 },
    { name: "on_behalf_of", label: "از طرف", type: "user", filter: true, span: 8 },
    { name: "external_id", label: "شناسهٔ بیرونی", type: "string", maxLength: 200, ltr: true, span: 12 },
    { name: "keys", label: "رکوردهای نام‌برده", type: "tags", filter: true, index: true, span: 12 },
  ],
  unique: [["connection_id", "external_id"]],
  scope: { public: true },
  features: { sync: false, history: false },
  list: { columns: ["started_at", "run_number", "pipeline_id", "status", "branch", "duration", "tests_failed"], order: "-started_at" },
};

const gate: TableDef = {
  key: "change_gate",
  table: "sm_change_gates",
  label: "دروازهٔ استقرار",
  plural: "دروازه‌های استقرار",
  icon: "shield-check",
  module: "devops",
  area: "release",
  description: "پرسش خط لوله پیش از استقرار: «مجاز است؟» — تصمیم خودکار با خط‌مشی یا با تأیید، با پروندهٔ شواهد زنجیره‌ای",
  numbered: { prefix: "GATE", pad: 7 },
  display: "summary",
  fields: [
    { name: "summary", label: "شرح", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "connection_id", label: "اتصال", type: "ref", ref: "devops_connection", readonly: true, list: true, filter: true, index: true, span: 8 },
    { name: "pipeline_id", label: "خط لوله", type: "ref", ref: "dev_pipeline", readonly: true, filter: true, span: 8 },
    { name: "environment_id", label: "محیط", type: "ref", ref: "release_environment", readonly: true, list: true, filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", readonly: true, filter: true, span: 8 },
    { name: "run_ref", label: "اجرای خط لوله", type: "string", maxLength: 200, readonly: true, ltr: true, span: 8 },
    { name: "artifact_version", label: "نسخه", type: "string", maxLength: 80, readonly: true, ltr: true, list: true, span: 8 },
    { name: "commit_sha", label: "کامیت", type: "string", maxLength: 64, readonly: true, ltr: true, span: 8 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", readonly: true, list: true, filter: true, span: 8 },
    { name: "deployment_id", label: "استقرار", type: "ref", ref: "deployment", readonly: true, span: 8 },
    { name: "rule", label: "قاعدهٔ تصمیم", type: "string", maxLength: 200, readonly: true, span: 12 },
    { name: "reason", label: "دلیل", type: "text", span: 24 },
    { name: "requested_at", label: "زمان درخواست", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "timeout_at", label: "مهلت", type: "datetime", readonly: true, span: 8 },
    { name: "decided_at", label: "زمان تصمیم", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "decided_by", label: "تصمیم‌گیرنده", type: "user", readonly: true, span: 8 },
    { name: "wait_seconds", label: "زمان انتظار", type: "duration", readonly: true, span: 8 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "evidence", label: "شواهد", type: "json", readonly: true, default: {}, span: 24 },
    { name: "evidence_hash", label: "چکیدهٔ شواهد", type: "string", maxLength: 80, readonly: true, ltr: true, span: 12 },
    { name: "prev_hash", label: "چکیدهٔ پیشین", type: "string", maxLength: 80, readonly: true, ltr: true, span: 12 },
  ],
  states: {
    field: "state",
    initial: "pending",
    states: [
      { value: "pending", label: "در انتظار", category: "waiting", color: "gold" },
      { value: "approved", label: "مجاز", category: "resolved", color: "green" },
      { value: "rejected", label: "رد", category: "resolved", color: "red" },
      { value: "overridden", label: "مجاز با استثنا", category: "resolved", color: "orange" },
      { value: "timed_out", label: "پایان مهلت", category: "closed", color: "gray" },
    ],
    transitions: [
      { from: ["pending"], to: "approved", label: "مجاز است", roles: { area: "release", level: "full" } },
      { from: ["pending"], to: "rejected", label: "رد", requires: ["reason"], roles: { area: "release", level: "full" } },
      { from: ["pending", "rejected"], to: "overridden", label: "مجاز با استثنا", requires: ["reason"], roles: { area: "release", level: "full" } },
      { from: ["pending"], to: "timed_out", label: "پایان مهلت", roles: { area: "release", level: "full" } },
    ],
    locked: ["closed"],
  },
  scope: { public: true },
  features: { approvals: true, journal: true },
  list: { columns: ["number", "summary", "environment_id", "state", "change_id", "requested_at"], order: "-requested_at" },
};

const techDebt: TableDef = {
  key: "tech_debt",
  table: "sm_tech_debts",
  label: "بدهی فنی",
  plural: "بدهی‌های فنی",
  icon: "landmark",
  module: "devops",
  area: "release",
  description: "بدهی فنی یک خدمت یا مخزن: علت، هزینهٔ جاری (بهره)، کار لازم (اصل)، مالک و برنامهٔ پرداخت",
  numbered: { prefix: "TD", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, span: 8 },
    { name: "repository_id", label: "مخزن", type: "ref", ref: "dev_repository", filter: true, span: 8 },
    { name: "cause", label: "علت", type: "choice", choices: DEBT_CAUSES, filter: true, span: 8 },
    { name: "interest", label: "هزینهٔ جاری (بهره)", type: "choice", choices: LEVELS, default: "medium", list: true, filter: true, sort: true, span: 8 },
    { name: "principal_hours", label: "کار لازم (ساعت)", type: "decimal", min: 0, list: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", list: true, filter: true, span: 8 },
    { name: "owner_group_id", label: "تیم مالک", type: "group", filter: true, span: 8 },
    { name: "known_error_id", label: "خطای شناخته‌شده", type: "ref", ref: "known_error", span: 8 },
    { name: "due_date", label: "موعد پرداخت", type: "date", sort: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
  ],
  states: {
    field: "state",
    initial: "identified",
    states: [
      { value: "identified", label: "شناسایی‌شده", category: "new", color: "blue" },
      { value: "accepted", label: "پذیرفته‌شده", category: "waiting", color: "gold" },
      { value: "planned", label: "برنامه‌ریزی‌شده", category: "active", color: "indigo" },
      { value: "in_progress", label: "در حال پرداخت", category: "active", color: "teal" },
      { value: "paid", label: "پرداخت‌شده", category: "closed", color: "green" },
      { value: "wont_fix", label: "رها شد", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["identified"], to: "accepted", label: "پذیرش" },
      { from: ["identified", "accepted"], to: "planned", label: "برنامه‌ریزی" },
      { from: ["planned", "accepted"], to: "in_progress", label: "شروع" },
      { from: ["in_progress", "planned"], to: "paid", label: "پرداخت شد" },
      { from: ["identified", "accepted", "planned"], to: "wont_fix", label: "رها کردن" },
    ],
  },
  scope: { own: ["owner_id"], requester: [], group: "owner_group_id" },
  features: { journal: true, links: true, kanban: "state" },
  list: { columns: ["number", "title", "service_id", "interest", "principal_hours", "state", "owner_id"], order: "-created_at" },
};

export const DEVOPS_TABLES: TableDef[] = [connection, repository, pipeline, event, commit, pullRequest, build, gate, techDebt];
