// Workflows «گردش‌کارها» (design F §3.5–3.6, package F4a): processes the administrator draws, and the cases people
// run through them. A process runs on the flows executor (trigger kind `process`, node `form_step`); its values live
// in one system field of the case (`data`), read through the pinned version's form snapshot.
//   · process «گردش‌کار» (area `process_design`) — the definition: key, name, icon, category, the autosaved `draft`
//     (graph, starters, title template, requester view, managers, confidentiality); `status`, `current_version_id`,
//     `version_no` and `published_*` are written by the publish service only (F4c).
//   · process_version «نسخهٔ گردش‌کار» (area `org`, reference data) — immutable, written by the publish service only:
//     the graph with its step settings, the form snapshot (@shared/forms/snapshot), starters, title template,
//     requester view, managers, manager groups and confidentiality as published. Everyone who reads the organisation
//     structure reads published versions: they show steps, roles and form layouts, never case data.
//   · process_case «پرونده» (area `process`, PRC0000001) — one run of a process: its state, people, progress and
//     values. Only the authority writes it (@shared/process/graph `CaseProgress`, §3.6.3).
//   · process_task «مرحله» (area `work`) — one row per person per step round, the decision record (never
//     `extends: "task"`: capacity, gamification and insights code that loops over task tables never meets it).
//   · process_submission «ثبت مرحله» (area `work`) — what a person did (start, step, cancel): people create their own;
//     the authority applies them (§3.6.4) and writes the result.
//   · process_draft (area `work`, never synchronised) — a person's unsent values of a step or a start.
// Access: §6 — designers and publishers hold `process_design`, never `process`, so they never read cases; cases are
// read by their requester, participants and managers (F4b's participant sources) and by area grants in `process`
// (auditor, tenant admin), and a confidential case only by the first three (`rowAccess.read` below). Tasks,
// submissions and drafts are rows of their own people (row rules). Every field the authority keeps is `system`, so
// the generic API never takes it from a caller; F4b adds the guards that refuse every other write (§6.4). Audit: the
// engine's history on the definition tables and the decision rows; none on cases (it would show values a step
// hides, §3.6.7), drafts or the timer columns. Sync: every table but process_draft is synced (SYNC_PROTOCOL 17 of
// the F release covers the new kinds); replicas create submissions, never cases, tasks or versions (§7). Demo data:
// nothing special — id and org_id, so the demo capture trigger records and purges the pack's rows.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { registerArea } from "../access/areas";
import { PROCESS_DESIGN_AREA } from "./fields";

/** «پرونده‌های گردش‌کار»: the cases of processes (definitions are in `process_design`, published versions in `org`). */
export const PROCESS_AREA = "process";
registerArea({ key: PROCESS_AREA, label: "پرونده‌های گردش‌کار", group: "business", module: "process" });

/** A process's key: a Latin identifier that never changes (links, imports and the hub name a process by it). */
export const PROCESS_KEY = /^[a-z][a-z0-9_]{1,39}$/;

export const PROCESS_STATUS: Option[] = [
  { value: "draft", label: "پیش‌نویس", color: "gray", order: 1 },
  { value: "published", label: "منتشرشده", color: "green", order: 2 },
  { value: "retired", label: "بازنشسته", color: "orange", order: 3 },
];

/** States of a case; only the authority moves them. */
export const CASE_STATES: Option[] = [
  { value: "active", label: "در جریان", color: "teal", order: 1 },
  { value: "waiting", label: "در انتظار", color: "gold", order: 2 },
  { value: "attention", label: "نیاز به بررسی", color: "orange", order: 3 },
  { value: "completed", label: "انجام‌شده", color: "green", order: 4 },
  { value: "rejected", label: "ردشده", color: "red", order: 5 },
  { value: "canceled", label: "لغوشده", color: "gray", order: 6 },
];
/** States in which a case is still open (linking a standalone app is refused while one is, §7.2). */
export const OPEN_CASE_STATES = ["active", "waiting", "attention"] as const;

/** How a case ended: the outcome of the «پایان» it reached. */
export const CASE_OUTCOMES: Option[] = [
  { value: "completed", label: "انجام‌شده", color: "green", order: 1 },
  { value: "rejected", label: "ردشده", color: "red", order: 2 },
  { value: "canceled", label: "لغوشده", color: "gray", order: 3 },
];

export const TASK_ACTIONS: Option[] = [
  { value: "fill", label: "تکمیل فرم", order: 1 },
  { value: "review", label: "بررسی", order: 2 },
  { value: "approve", label: "تأیید", order: 3 },
];

export const TASK_STATUS: Option[] = [
  { value: "open", label: "باز", color: "blue", order: 1 },
  { value: "done", label: "انجام‌شده", color: "green", order: 2 },
  { value: "not_needed", label: "دیگر لازم نیست", color: "gray", order: 3 },
  { value: "canceled", label: "لغو", color: "gray", order: 4 },
];

/** What a person decided in a step (fill and review: submitted; approve: approved or rejected; review and approve: returned). */
export const TASK_OUTCOMES: Option[] = [
  { value: "submitted", label: "ثبت شد", color: "green", order: 1 },
  { value: "approved", label: "تأیید شد", color: "green", order: 2 },
  { value: "rejected", label: "رد شد", color: "red", order: 3 },
  { value: "returned", label: "بازگشت برای اصلاح", color: "orange", order: 4 },
];

export const SUBMISSION_KINDS: Option[] = [
  { value: "start", label: "آغاز پرونده", order: 1 },
  { value: "step", label: "انجام مرحله", order: 2 },
  { value: "cancel", label: "لغو پرونده", order: 3 },
];

export const SUBMISSION_RESULTS: Option[] = [
  { value: "pending", label: "در صف", color: "gold", order: 1 },
  { value: "applied", label: "ثبت شد", color: "green", order: 2 },
  { value: "late", label: "دیرهنگام", color: "orange", order: 3 },
  { value: "refused", label: "پذیرفته نشد", color: "red", order: 4 },
];

const process: TableDef = {
  key: "process",
  table: "sm_processes",
  label: "گردش‌کار",
  plural: "گردش‌کارها",
  icon: "route",
  module: "process",
  area: PROCESS_DESIGN_AREA,
  description: "گردش‌کارهایی که مدیر سامانه با فرم‌ها و مرحله‌ها می‌سازد؛ هر انتشار نسخه‌ای تازه است",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 40, list: true, search: true, ltr: true, span: 12, help: "با حرف لاتین کوچک شروع می‌شود و پس از ساخت تغییر نمی‌کند" },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, span: 6 },
    { name: "category", label: "دسته", type: "string", maxLength: 80, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24 },
    // the designer's autosaved draft: graph (with each step's settings), starters, title template, requester view,
    // managers, manager groups, confidentiality — published into a version
    { name: "draft", label: "پیش‌نویس", type: "json", hidden: true, audit: false },
    { name: "status", label: "وضعیت", type: "choice", choices: PROCESS_STATUS, default: "draft", system: true, list: true, filter: true, span: 6 },
    { name: "version_no", label: "نسخه", type: "int", default: 0, system: true, list: true, sort: true, span: 6 },
    { name: "current_version_id", label: "نسخهٔ جاری", type: "ref", ref: "process_version", system: true, span: 12 },
    { name: "published_at", label: "آخرین انتشار", type: "datetime", system: true, sort: true, span: 12 },
    { name: "published_by", label: "منتشرکننده", type: "user", system: true, span: 12 },
  ],
  unique: [["key"], ["name"]],
  scope: {},
  list: { columns: ["name", "category", "status", "version_no", "published_at"], order: "name" },
};

const processVersion: TableDef = {
  key: "process_version",
  table: "sm_process_versions",
  label: "نسخهٔ گردش‌کار",
  plural: "نسخه‌های گردش‌کار",
  icon: "history",
  module: "process",
  area: "org",
  description: "نسخه‌های منتشرشدهٔ گردش‌کارها؛ هر پرونده با نسخه‌ای که با آن آغاز شده پیش می‌رود",
  display: "name",
  fields: [
    { name: "process_id", label: "گردش‌کار", type: "ref", ref: "process", required: true, system: true, list: true, filter: true, index: true, span: 12 },
    { name: "name", label: "نام", type: "string", maxLength: 120, system: true, list: true, search: true, span: 12 },
    { name: "version_no", label: "نسخه", type: "int", system: true, list: true, sort: true, span: 6 },
    { name: "graph", label: "طرح", type: "json", system: true, hidden: true, audit: false },
    // the settings of each step by node key (rights, people, SLA, notifications), taken from the graph at publish
    { name: "steps", label: "مرحله‌ها", type: "json", system: true, hidden: true, audit: false },
    { name: "forms", label: "فرم‌ها", type: "json", system: true, hidden: true, audit: false },
    { name: "starters", label: "آغازکنندگان", type: "json", system: true, hidden: true, audit: false },
    { name: "title_template", label: "الگوی عنوان", type: "string", maxLength: 300, system: true, span: 24 },
    { name: "requester_view", label: "آنچه درخواست‌دهنده می‌بیند", type: "tags", system: true, hidden: true, audit: false },
    { name: "managers", label: "مسئولان", type: "users", system: true, span: 12 },
    { name: "manager_groups", label: "گروه‌های مسئول", type: "refs", ref: "group", system: true, span: 12 },
    { name: "confidential", label: "محرمانه", type: "bool", default: false, system: true, list: true, span: 6 },
    { name: "published_by", label: "منتشرکننده", type: "user", system: true, list: true, span: 12 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", system: true, list: true, sort: true, span: 12 },
    { name: "note", label: "یادداشت انتشار", type: "string", maxLength: 300, system: true, list: true, span: 24 },
    { name: "diff", label: "خلاصهٔ تغییرها", type: "json", system: true, hidden: true, audit: false },
  ],
  unique: [["process_id", "version_no"]],
  scope: { public: true },
  list: { columns: ["name", "version_no", "note", "published_by", "published_at"], order: "-published_at" },
};

const processCase: TableDef = {
  key: "process_case",
  table: "sm_process_cases",
  label: "پرونده",
  plural: "پرونده‌ها",
  icon: "folder-kanban",
  module: "process",
  area: PROCESS_AREA,
  description: "پرونده‌های گردش‌کارها: هر درخواست، مرحله‌ها و تصمیم‌هایش",
  numbered: { prefix: "PRC", pad: 7 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", maxLength: 300, system: true, list: true, search: true, span: 24 },
    { name: "process_id", label: "گردش‌کار", type: "ref", ref: "process", system: true, list: true, filter: true, index: true, span: 12, section: "گردش‌کار" },
    { name: "process_name", label: "نام گردش‌کار", type: "string", maxLength: 120, system: true, span: 12, section: "گردش‌کار" },
    { name: "version_id", label: "نسخه", type: "ref", ref: "process_version", system: true, span: 12, section: "گردش‌کار" },
    { name: "version_no", label: "شمارهٔ نسخه", type: "int", system: true, span: 6, section: "گردش‌کار" },
    { name: "state", label: "وضعیت", type: "choice", choices: CASE_STATES, default: "active", system: true, list: true, filter: true, index: true, span: 8 },
    { name: "requested_by", label: "ثبت‌کننده", type: "user", system: true, list: true, filter: true, span: 8, section: "افراد" },
    { name: "requested_for", label: "درخواست برای", type: "user", system: true, filter: true, span: 8, section: "افراد" },
    // the people of open tasks (assignee, delegated from) and of done ones (actor, acted for) — kept by the authority
    { name: "participants", label: "مشارکت‌کنندگان", type: "users", system: true, hidden: true, audit: false, index: true, section: "افراد" },
    { name: "managers", label: "مسئولان", type: "users", system: true, hidden: true, audit: false, index: true, section: "افراد" },
    { name: "manager_groups", label: "گروه‌های مسئول", type: "refs", ref: "group", system: true, hidden: true, audit: false, index: true, section: "افراد" },
    // [{ key, label }] of the steps open now; open_rounds: { [step key]: round }; progress: `CaseProgress`
    { name: "current_steps", label: "مرحله‌های جاری", type: "json", system: true, hidden: true, audit: false, section: "پیشرفت" },
    { name: "open_rounds", label: "دورهای باز", type: "json", system: true, hidden: true, audit: false, section: "پیشرفت" },
    { name: "progress", label: "پیشرفت", type: "json", system: true, hidden: true, audit: false, section: "پیشرفت" },
    { name: "outcome", label: "نتیجه", type: "choice", choices: CASE_OUTCOMES, system: true, list: true, filter: true, span: 8, section: "پیشرفت" },
    { name: "started_at", label: "آغاز", type: "datetime", system: true, list: true, sort: true, filter: true, span: 8, section: "پیشرفت" },
    { name: "ended_at", label: "پایان", type: "datetime", system: true, sort: true, filter: true, span: 8, section: "پیشرفت" },
    { name: "run_ref", label: "اجرا", type: "string", maxLength: 36, system: true, hidden: true, ltr: true, audit: false },
    { name: "confidential", label: "محرمانه", type: "bool", default: false, system: true, filter: true, span: 6 },
    // the values, keyed by library field name, read through the pinned version's snapshot (never generic fields)
    { name: "data", label: "مقدارها", type: "json", system: true, hidden: true, audit: false },
  ],
  scope: { own: ["requested_by", "requested_for"], requester: ["requested_for", "requested_by"] },
  // a confidential case: only its requester, participants and managers — never an area grant (§6.2)
  rowAccess: {
    read: {
      or: [
        { f: "confidential", op: "eq", v: false },
        { f: "confidential", op: "empty" },
        { f: "requested_by", op: "is_me" },
        { f: "requested_for", op: "is_me" },
        { f: "participants", op: "is_me" },
        { f: "managers", op: "is_me" },
        { f: "manager_groups", op: "is_my_group" },
      ],
    },
  },
  features: { journal: true, attachments: true, links: true, history: false, rag: false },
  list: { columns: ["number", "title", "process_id", "state", "requested_by", "started_at"], order: "-started_at" },
  form: { sections: ["اصلی", "گردش‌کار", "افراد", "پیشرفت"] },
};

const processTask: TableDef = {
  key: "process_task",
  table: "sm_process_tasks",
  label: "مرحله",
  plural: "مرحله‌های گردش‌کار",
  icon: "list-checks",
  module: "process",
  area: "work",
  description: "مرحله‌هایی که گردش‌کارها به افراد می‌سپارند؛ هر ردیف کار یک نفر در یک دور از یک مرحله است",
  display: "step_label",
  fields: [
    { name: "case_id", label: "پرونده", type: "ref", ref: "process_case", system: true, index: true, span: 12 },
    { name: "case_number", label: "شمارهٔ پرونده", type: "string", maxLength: 40, system: true, list: true, search: true, ltr: true, span: 8 },
    { name: "case_title", label: "عنوان پرونده", type: "string", maxLength: 300, system: true, list: true, search: true, span: 16 },
    { name: "process_id", label: "گردش‌کار", type: "ref", ref: "process", system: true, filter: true, span: 12 },
    { name: "version_id", label: "نسخه", type: "ref", ref: "process_version", system: true, span: 12 },
    { name: "step_key", label: "کلید مرحله", type: "string", maxLength: 40, system: true, hidden: true, ltr: true },
    { name: "step_label", label: "مرحله", type: "string", maxLength: 120, system: true, list: true, search: true, span: 12 },
    { name: "action", label: "کار", type: "choice", choices: TASK_ACTIONS, system: true, list: true, filter: true, span: 6 },
    { name: "round", label: "دور", type: "int", default: 1, system: true, span: 6 },
    { name: "assigned_to", label: "انجام‌دهنده", type: "user", system: true, list: true, filter: true, span: 8 },
    { name: "delegated_from", label: "به جانشینی از", type: "user", system: true, filter: true, span: 8 },
    { name: "claimed_by", label: "برداشته به دست", type: "user", system: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: TASK_STATUS, default: "open", system: true, list: true, filter: true, index: true, span: 8 },
    { name: "outcome", label: "نتیجه", type: "choice", choices: TASK_OUTCOMES, system: true, list: true, filter: true, span: 8 },
    { name: "comment", label: "توضیح", type: "text", maxLength: 2000, system: true, span: 24 },
    { name: "acted_by", label: "انجام‌شده به دست", type: "user", system: true, filter: true, span: 8 },
    { name: "acted_for", label: "به نیابت از", type: "user", system: true, span: 8 },
    { name: "submission_id", label: "ثبت مرحله", type: "ref", ref: "process_submission", system: true, span: 8 },
    { name: "opened_at", label: "زمان ارجاع", type: "datetime", system: true, list: true, sort: true, filter: true, span: 8 },
    { name: "due_at", label: "مهلت", type: "datetime", system: true, list: true, sort: true, filter: true, span: 8 },
    { name: "closed_at", label: "زمان پایان", type: "datetime", system: true, sort: true, filter: true, span: 8 },
    { name: "reminded_at", label: "آخرین یادآوری", type: "datetime", system: true, audit: false, span: 8 },
    { name: "escalated_at", label: "زمان تشدید", type: "datetime", system: true, audit: false, span: 8 },
  ],
  // nobody reads another's task as its "requester" (the requester side stays empty)
  scope: { own: ["assigned_to", "delegated_from", "acted_by"], requester: [] },
  rowAccess: {
    read: { or: [{ f: "assigned_to", op: "is_me" }, { f: "delegated_from", op: "is_me" }, { f: "acted_by", op: "is_me" }] },
  },
  levels: { read: "view" },
  list: { columns: ["case_number", "case_title", "step_label", "action", "status", "due_at"], order: "-opened_at" },
};

const processSubmission: TableDef = {
  key: "process_submission",
  table: "sm_process_submissions",
  label: "ثبت مرحله",
  plural: "ثبت‌های مرحله",
  icon: "send",
  module: "process",
  area: "work",
  description: "آنچه هر نفر در گردش‌کارها ثبت کرده است: آغاز پرونده، انجام مرحله یا لغو؛ سامانه آن را در پرونده اعمال می‌کند",
  display: "step_key",
  fields: [
    { name: "kind", label: "نوع", type: "choice", choices: SUBMISSION_KINDS, required: true, default: "step", list: true, filter: true, span: 8 },
    { name: "process_id", label: "گردش‌کار", type: "ref", ref: "process", filter: true, span: 12 },
    { name: "version_id", label: "نسخه", type: "ref", ref: "process_version", span: 12 },
    // a start: the new case's id, chosen by the runtime that took it (a Windows app's case exists only once applied)
    { name: "case_id", label: "پرونده", type: "string", maxLength: 36, ltr: true, index: true, span: 12 },
    { name: "task_id", label: "مرحله", type: "ref", ref: "process_task", index: true, span: 12 },
    { name: "step_key", label: "کلید مرحله", type: "string", maxLength: 40, ltr: true, span: 6 },
    { name: "round", label: "دور", type: "int", span: 6 },
    { name: "outcome", label: "نتیجه", type: "choice", choices: TASK_OUTCOMES, list: true, span: 8 },
    { name: "return_to", label: "بازگشت به", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "comment", label: "توضیح", type: "text", maxLength: 2000, span: 24 },
    { name: "values", label: "مقدارها", type: "json", hidden: true, audit: false },
    { name: "requested_for", label: "درخواست برای", type: "user", span: 12 },
    { name: "submitted_by", label: "ثبت‌کننده", type: "user", required: true, default: "$me", list: true, filter: true, span: 12 },
    { name: "on_behalf_of", label: "به نیابت از", type: "user", span: 12 },
    { name: "submitted_at", label: "زمان ثبت", type: "datetime", default: "$now", list: true, sort: true, span: 12 },
    { name: "result", label: "نتیجهٔ اعمال", type: "choice", choices: SUBMISSION_RESULTS, default: "pending", system: true, list: true, filter: true, index: true, span: 8 },
    { name: "result_note", label: "توضیح نتیجه", type: "text", maxLength: 2000, system: true, span: 24 },
    { name: "applied_at", label: "زمان اعمال", type: "datetime", system: true, span: 12 },
  ],
  scope: { own: ["submitted_by"], requester: [] },
  rowAccess: {
    read: { or: [{ f: "submitted_by", op: "is_me" }, { f: "on_behalf_of", op: "is_me" }] },
    // people create their own (a pushed one starts pending); the upload of a standalone organisation (§7.2, F4b's
    // upload rule) brings settled ones in their submitters' names
    write: { or: [{ f: "submitted_by", op: "is_me" }, { f: "result", op: "in", v: ["applied", "late", "refused"] }] },
  },
  features: { attachments: true },
  list: { columns: ["kind", "step_key", "outcome", "submitted_by", "submitted_at", "result"], order: "-submitted_at" },
};

const processDraft: TableDef = {
  key: "process_draft",
  table: "sm_process_drafts",
  label: "پیش‌نویس مرحله",
  plural: "پیش‌نویس‌های مرحله",
  icon: "file-pen",
  module: "process",
  area: "work",
  description: "مقدارهایی که هنوز فرستاده نشده‌اند؛ روی همین نسخهٔ برنامه نگه داشته می‌شوند",
  display: "user_id",
  fields: [
    { name: "user_id", label: "کاربر", type: "user", required: true, default: "$me", index: true, span: 12 },
    { name: "task_id", label: "مرحله", type: "ref", ref: "process_task", index: true, span: 12 },
    { name: "process_id", label: "گردش‌کار (آغاز)", type: "ref", ref: "process", span: 12 },
    { name: "values", label: "مقدارها", type: "json", hidden: true, audit: false },
  ],
  scope: { own: ["user_id"], requester: [] },
  rowAccess: { read: { f: "user_id", op: "is_me" }, write: { f: "user_id", op: "is_me" } },
  levels: { read: "view", create: "view", write: "view", delete: "view" },
  features: { sync: false, history: false },
  list: { columns: ["user_id", "task_id", "process_id", "updated_at"], order: "-updated_at" },
};

export const PROCESS_TABLES: TableDef[] = [process, processVersion, processCase, processTask, processSubmission, processDraft];
