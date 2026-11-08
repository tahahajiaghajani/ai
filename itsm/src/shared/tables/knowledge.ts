// Tables of knowledge management (docs/modules/knowledge_FA.md, catalogue docs/catalog/g5_knowledge_ai.md «Module:
// knowledge»): knowledge bases with their audiences, the category tree, articles (the published content and its
// metadata) with their versions (drafts, reviews, the published version and the outdated ones), templates, feedback,
// knowledge tasks (flags, gaps, reviews, translations…), answer snippets, reusable blocks, the glossary, subscriptions,
// read-and-acknowledge campaigns, KCS licences, quality reviews (AQI), knowledge gaps, duplicate candidates, search
// rules, decision trees, knowledge domains and the module's settings row.
//
// Access (docs/spec/ACCESS.md, area `knowledge`) has three layers, all evaluated in SQL with the reader's context, so
// lists, search, reports, sync and AI retrieval see exactly the same rows:
//   · the access model: a read grant in `knowledge`, secure workspaces (a base's workspace), restricted owner groups,
//     and «فقط کارشناسان»: `confidential` rows with `scope.confidentialGroup = "internal"` are read only by holders of
//     the `internal` field group (agents), the row's own people, its owner group and its access list;
//   · audiences (row rules below): a base is read by its contributors, its audience («همه» or the people, groups and
//     units named — units with their sub-units, expanded into `r_units`) minus «هرگز نبینند» (deny wins); a category
//     narrows its base with the nearest audience along its parent chain (`c_*`, compiled); an article is read only
//     when its base (and category) is readable by the caller — the dot-walks carry their rules — and, when it narrows
//     its audience, by the people named; drafts, reviews and retired content of other people stay with contributors;
//   · field groups: the internal section (`internal_body`) is `internal`: stripped from payloads, exports, search and
//     AI answers of people who lack the group.
// Behaviour lives in src/server/modules/knowledge; screens in src/ui/modules/knowledge.
// Imported by the UI: keep it free of server imports.
import type { Cond } from "../model/conditions";
import type { FieldDef, Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES, PRIORITIES } from "../model/task";
import { hideTaskFields } from "./incident";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

export const ARTICLE_TYPES: Option[] = [
  { value: "how_to", label: "راهنمای انجام کار", color: "blue", order: 1 },
  { value: "faq", label: "پرسش متداول", color: "teal", order: 2 },
  { value: "troubleshooting", label: "عیب‌یابی", color: "orange", order: 3 },
  { value: "kcs", label: "راه‌حل (KCS)", color: "indigo", order: 4 },
  { value: "known_error", label: "خطای شناخته‌شده", color: "red", order: 5 },
  { value: "policy", label: "خط‌مشی، بخشنامه، دستورالعمل", color: "purple", order: 6 },
  { value: "reference", label: "مرجع", color: "gray", order: 7 },
  { value: "release_note", label: "یادداشت انتشار", color: "green", order: 8 },
  { value: "decision", label: "سابقهٔ تصمیم", color: "gold", order: 9 },
  { value: "procedure", label: "رویهٔ اجرایی (Runbook)", color: "magenta", order: 10 },
  { value: "link", label: "پیوند به منبع بیرونی", color: "teal", order: 11 },
];

export const KB_LANGS: Option[] = [
  { value: "fa", label: "فارسی", order: 1 },
  { value: "en", label: "انگلیسی", order: 2 },
  { value: "ar", label: "عربی", order: 3 },
  { value: "ckb", label: "کردی", order: 4 },
  { value: "azb", label: "ترکی آذربایجانی", order: 5 },
  { value: "other", label: "دیگر", order: 6 },
];

export const KB_CLASSES: Option[] = [
  { value: "public", label: "عمومی", color: "green" },
  { value: "internal", label: "داخلی", color: "blue" },
  { value: "confidential", label: "محرمانه", color: "orange" },
  { value: "secret", label: "سری", color: "red" },
];

export const BASE_KINDS: Option[] = [
  { value: "external", label: "بیرونی (درخواست‌کنندگان هم می‌خوانند)", color: "green" },
  { value: "internal", label: "داخلی (فقط کارشناسان)", color: "blue" },
];

export const READ_MODES: Option[] = [
  { value: "everyone", label: "همهٔ خوانندگان دانش", color: "green" },
  { value: "audience", label: "فقط افراد، گروه‌ها و واحدهای انتخاب‌شده", color: "orange" },
];

export const CATEGORY_READ_MODES: Option[] = [
  { value: "inherit", label: "مانند دستهٔ بالاتر یا پایگاه", color: "gray" },
  { value: "audience", label: "فقط افراد، گروه‌ها و واحدهای انتخاب‌شده", color: "orange" },
];

export const AUDIENCE_MODES: Option[] = [
  { value: "inherit", label: "همهٔ مخاطبان پایگاه و دسته", color: "gray" },
  { value: "narrow", label: "فقط افراد، گروه‌ها و واحدهای انتخاب‌شده", color: "orange" },
];

export const CONTRIB_MODES: Option[] = [
  { value: "agents", label: "همهٔ کارشناسانی که دانش می‌نویسند" },
  { value: "named", label: "فقط مشارکت‌کنندگان نام‌برده" },
];

export const VISIBILITIES: Option[] = [
  { value: "inherit", label: "مانند پایگاه", color: "gray" },
  { value: "internal", label: "فقط کارشناسان", color: "blue" },
];

export const APPROVAL_MODES: Option[] = [
  { value: "any", label: "یک تأییدکننده کافی است" },
  { value: "all", label: "همهٔ تأییدکنندگان" },
  { value: "majority", label: "بیشتر تأییدکنندگان" },
];

export const REVIEW_POLICIES: Option[] = [
  { value: "banner", label: "نمایش «ممکن است قدیمی باشد»" },
  { value: "retire", label: "بازنشستگی خودکار" },
  { value: "task", label: "فقط کار بازبینی برای مالک" },
];

export const PUBLISHING_MODELS: Option[] = [
  { value: "jit", label: "انتشار به‌موقع (با تأیید یا مجوز)" },
  { value: "reuse", label: "انتشار بیرونی پس از چند استفاده" },
  { value: "conveyor", label: "نوار نقاله: بیرونی پس از چند استفاده مگر کسی جلویش را بگیرد" },
];

export const KCS_CONFIDENCE: Option[] = [
  { value: "wip", label: "در حال کار", color: "gold" },
  { value: "not_validated", label: "تأییدنشده", color: "orange" },
  { value: "validated", label: "تأییدشده", color: "green" },
  { value: "archived", label: "بایگانی", color: "gray" },
];

export const GOVERNANCE: Option[] = [
  { value: "experience", label: "تجربه‌محور (همه بهبود می‌دهند)", color: "teal" },
  { value: "compliance", label: "انطباق‌محور (فقط مسئولان ویرایش می‌کنند)", color: "purple" },
];

export const AI_USES: Option[] = [
  { value: "answer", label: "در پاسخ‌ها، با نقل متن", color: "green" },
  { value: "link_only", label: "فقط ارجاع، بدون نقل متن", color: "gold" },
  { value: "none", label: "هرگز", color: "red" },
];

export const NEXT_ACTIONS: Option[] = [
  { value: "none", label: "—", color: "gray" },
  { value: "review", label: "بازبینی", color: "gold" },
  { value: "update", label: "به‌روزرسانی", color: "orange" },
  { value: "merge", label: "ادغام با مقالهٔ مشابه", color: "purple" },
  { value: "retire", label: "بازنشستگی", color: "red" },
  { value: "translate", label: "ترجمه", color: "blue" },
];

export const FEEDBACK_KINDS: Option[] = [
  { value: "helpful", label: "مفید بود", color: "green" },
  { value: "not_helpful", label: "مفید نبود", color: "orange" },
  { value: "rating", label: "امتیاز", color: "gold" },
  { value: "comment", label: "نظر", color: "blue" },
  { value: "flag", label: "گزارش ایراد", color: "red" },
];

export const FLAG_REASONS: Option[] = [
  { value: "incorrect", label: "نادرست است", order: 1 },
  { value: "outdated", label: "قدیمی شده است", order: 2 },
  { value: "unclear", label: "روشن نیست", order: 3 },
  { value: "duplicate", label: "تکراری است", order: 4 },
  { value: "missing_step", label: "گامی جا افتاده است", order: 5 },
  { value: "broken_link", label: "پیوند یا تصویر خراب", order: 6 },
  { value: "other", label: "دلیل دیگر", order: 7 },
];

export const FEEDBACK_STATES: Option[] = [
  { value: "open", label: "باز", color: "blue" },
  { value: "in_task", label: "در کار دانش", color: "gold" },
  { value: "addressed", label: "رسیدگی شد", color: "green" },
  { value: "dismissed", label: "کنار گذاشته شد", color: "gray" },
];

export const KB_CHANNELS: Option[] = [
  { value: "portal", label: "مرکز دانش" },
  { value: "record", label: "کنار رکورد" },
  { value: "search", label: "جست‌وجو" },
  { value: "chat", label: "گفتگو" },
  { value: "api", label: "API" },
];

export const TASK_KINDS: Option[] = [
  { value: "flag", label: "گزارش ایراد", color: "red", order: 1 },
  { value: "gap", label: "کمبود دانش", color: "orange", order: 2 },
  { value: "review", label: "بازبینی دوره‌ای", color: "gold", order: 3 },
  { value: "expiry", label: "پایان اعتبار", color: "gold", order: 4 },
  { value: "translation", label: "ترجمه", color: "blue", order: 5 },
  { value: "merge", label: "ادغام تکراری‌ها", color: "purple", order: 6 },
  { value: "retire", label: "پیشنهاد بازنشستگی", color: "gray", order: 7 },
  { value: "aqi", label: "ارزیابی کیفیت (AQI)", color: "indigo", order: 8 },
  { value: "attestation", label: "تأیید مطالعه", color: "teal", order: 9 },
  { value: "re_own", label: "تعیین مالک تازه", color: "magenta", order: 10 },
  { value: "capture", label: "نوشتن مقاله از رکورد", color: "green", order: 11 },
  { value: "integrity", label: "بررسی یکپارچگی", color: "teal", order: 12 },
  { value: "feedback", label: "بازخورد منفی", color: "orange", order: 13 },
  { value: "update", label: "به‌روزرسانی از منبع", color: "blue", order: 14 },
  { value: "external", label: "انتشار بیرونی خودکار", color: "green", order: 15 },
];

export const LICENCE_LEVELS: Option[] = [
  { value: "candidate", label: "نامزد", color: "gray", order: 1 },
  { value: "contributor", label: "مشارکت‌کننده", color: "blue", order: 2 },
  { value: "publisher", label: "منتشرکننده", color: "green", order: 3 },
  { value: "coach", label: "مربی", color: "purple", order: 4 },
  { value: "kde", label: "خبرهٔ حوزهٔ دانش", color: "gold", order: 5 },
];

export const SEARCH_RULE_KINDS: Option[] = [
  { value: "pin", label: "سنجاق در بالای نتایج", color: "green" },
  { value: "boost", label: "بالاتر بردن", color: "blue" },
  { value: "demote", label: "پایین‌تر بردن", color: "orange" },
  { value: "hide", label: "پنهان کردن", color: "red" },
];

export const GAP_KINDS: Option[] = [
  { value: "zero_result", label: "جست‌وجوی بی‌نتیجه", color: "orange" },
  { value: "no_article", label: "رکوردهای بی‌مقاله", color: "gold" },
  { value: "reported", label: "گزارش کارشناس یا کاربر", color: "blue" },
  { value: "ai_abstained", label: "پاسخ‌ندادن هوش مصنوعی", color: "purple" },
];

export const SUBSCRIPTION_TARGETS: Option[] = [
  { value: "kb_article", label: "مقاله" },
  { value: "kb_category", label: "دسته" },
  { value: "kb_base", label: "پایگاه دانش" },
];

export const SUBSCRIPTION_EVENTS: Option[] = [
  { value: "published", label: "انتشار نسخهٔ تازه" },
  { value: "major", label: "تغییر اساسی" },
  { value: "retired", label: "بازنشستگی" },
];

export const KNOWLEDGE_CHOICE_LISTS: Record<string, Option[]> = {
  "kb_task.close_code": [
    { value: "fixed", label: "مقاله اصلاح شد", order: 1 },
    { value: "created", label: "مقالهٔ تازه نوشته شد", order: 2 },
    { value: "confirmed", label: "مقاله درست است", order: 3 },
    { value: "retired", label: "مقاله بازنشسته شد", order: 4 },
    { value: "duplicate", label: "تکراری بود", order: 5 },
    { value: "not_needed", label: "لازم نبود", order: 6 },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Row rules (audiences). Each is pure condition language: the engine compiles it into the SQL of every read.

const me = (f: string): Cond => ({ f, op: "is_me" });
const inGroups = (f: string): Cond => ({ f, op: "in_my_groups" });
const myGroup = (f: string): Cond => ({ f, op: "is_my_group" });
const inUnit = (f: string): Cond => ({ f, op: "in_my_unit" });
const readable = (f: string): Cond => ({ f, op: "nempty" });

/** States in which readers (not only contributors) see an article. */
export const READER_STATES = ["published", "pending_retirement", "retired"];
/** States whose content readers find in browse, search, suggestions and AI answers. */
export const LIVE_STATES = ["published", "pending_retirement"];

const denied = (prefix = ""): Cond => ({ or: [me(`${prefix}deny_users`), inGroups(`${prefix}deny_groups`), inUnit(`${prefix}x_units`)] });

/** Who reads a knowledge base: its contributors and its audience, never the people it denies. */
export const BASE_READ: Cond = {
  and: [
    { not: denied() },
    {
      or: [
        me("owner_id"), myGroup("manager_group_id"), me("k_users"), inGroups("k_groups"),
        { f: "read_mode", op: "eq", v: "everyone" },
        me("read_users"), inGroups("read_groups"), inUnit("r_units"),
      ],
    },
  ],
};

/**
 * Contributors compiled onto the row itself (k_users / k_groups, kept by the module's contrib.ts): a category, snippet
 * or decision tree carries its base's contributors; an article the base's and its category chain's managed-by groups;
 * versions, feedback, knowledge tasks, attestations and acknowledgements everyone who works the article. Rules test
 * own columns only — no dot-walked group test (see engine_requests: a walk compiled to `false` keeps its parameters).
 */
const CONTRIBUTORS: Cond[] = [me("k_users"), inGroups("k_groups")];

/** A category: readable base, then the nearest audience on its chain (compiled into c_*) or a contributor. */
export const CATEGORY_READ: Cond = {
  and: [
    readable("base_id.name"),
    { or: [{ f: "c_all", op: "eq", v: true }, me("c_users"), inGroups("c_groups"), inUnit("c_units"), ...CONTRIBUTORS, inGroups("m_groups")] },
  ],
};

/** Contributors of an article: its author, owner and owner group, reviewers, the base's contributors, managed-by groups. */
const ARTICLE_CONTRIBUTOR: Cond[] = [me("author_id"), me("owner_id"), myGroup("owner_group_id"), me("reviewer_ids"), ...CONTRIBUTORS];

export const ARTICLE_READ: Cond = {
  and: [
    { not: denied() },
    readable("base_id.name"),
    {
      or: [
        ...ARTICLE_CONTRIBUTOR,
        {
          and: [
            { or: [{ f: "state", op: "in", v: READER_STATES }, { and: [{ f: "state", op: "eq", v: "draft" }, { f: "kcs_confidence", op: "eq", v: "wip" }] }] },
            { or: [{ f: "category_id", op: "empty" }, readable("category_id.name")] },
            { or: [{ f: "audience_mode", op: "ne", v: "narrow" }, me("read_users"), inGroups("read_groups"), inUnit("r_units")] },
          ],
        },
      ],
    },
  ],
};

/** Compliance-based articles are changed only by their people and the contributors of the base and category. */
export const ARTICLE_WRITE: Cond = { or: [{ f: "governance", op: "ne", v: "compliance" }, me("author_id"), me("owner_id"), myGroup("owner_group_id"), ...CONTRIBUTORS] };

export const VERSION_READ: Cond = { or: [me("author_id"), me("reviewer_ids"), ...CONTRIBUTORS] };
export const FEEDBACK_READ: Cond = { or: [me("user_id"), ...CONTRIBUTORS] };
export const TASK_READ: Cond = { or: [me("assigned_to"), myGroup("assignment_group_id"), me("watch_list"), ...CONTRIBUTORS] };

/** Snippets and decision trees follow their base; readers see the published ones. */
export const SNIPPET_READ: Cond = {
  and: [
    { or: [{ f: "base_id", op: "empty" }, readable("base_id.name")] },
    { or: [me("owner_id"), myGroup("owner_group_id"), ...CONTRIBUTORS, { f: "state", op: "eq", v: "published" }] },
  ],
};
export const BLOCK_READ: Cond = { or: [me("owner_id"), myGroup("owner_group_id"), { f: "state", op: "eq", v: "published" }] };
export const ATTESTATION_READ: Cond = { or: [me("owner_id"), ...CONTRIBUTORS] };
export const ACK_READ: Cond = { or: [me("user_id"), me("attestation_id.owner_id"), ...CONTRIBUTORS] };

// ---------------------------------------------------------------------------------------------------------------
// Knowledge bases

const MAIN = "اصلی";
const AUDIENCE = "مخاطبان";
const CONTRIB = "مشارکت و تأیید";
const POLICY = "اعتبار، بازبینی و KCS";
const AI = "هوش مصنوعی";

export const BASE_STATES: StateModel = {
  field: "state",
  initial: "active",
  states: [
    { value: "active", label: "فعال", category: "active", color: "green" },
    { value: "archived", label: "بایگانی", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["active"], to: "archived", label: "بایگانی" },
    { from: ["archived"], to: "active", label: "فعال‌سازی دوباره" },
  ],
  locked: [],
};

const sys = { readonly: true, hidden: true, audit: false } as const;

/** The compiled contributors of a row (see CONTRIBUTORS). */
const contribFields = (): FieldDef[] => [
  { name: "k_users", label: "افراد مشارکت‌کننده (محاسبه‌شده)", type: "users", ...sys, index: true },
  { name: "k_groups", label: "گروه‌های مشارکت‌کننده (محاسبه‌شده)", type: "refs", ref: "group", ...sys, index: true },
];

const base: TableDef = {
  key: "kb_base",
  table: "sm_kb_bases",
  label: "پایگاه دانش",
  plural: "پایگاه‌های دانش",
  icon: "library-big",
  module: "knowledge",
  area: "knowledge",
  description: "مجموعه‌ای از مقاله‌ها با مخاطبان، مشارکت‌کنندگان، تأییدکنندگان و قواعد اعتبار خودش",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "kind", label: "نوع", type: "choice", choices: BASE_KINDS, default: "external", required: true, list: true, filter: true, span: 12, section: MAIN, help: "پایگاه داخلی را درخواست‌کنندگان نمی‌بینند." },
    { name: "description", label: "شرح", type: "text", search: true, span: 24, section: MAIN },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, span: 8, section: MAIN, help: "نام یک نماد lucide، مثل book-open" },
    { name: "color", label: "رنگ", type: "color", span: 8, section: MAIN },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8, section: MAIN },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", list: true, filter: true, index: true, span: 12, section: MAIN },
    { name: "manager_group_id", label: "گروه مدیران", type: "group", filter: true, index: true, span: 12, section: MAIN },
    { name: "classification", label: "طبقه‌بندی", type: "choice", choices: KB_CLASSES, default: "internal", filter: true, span: 12, section: MAIN, help: "محتوای «سری» هرگز در پاسخ‌های هوش مصنوعی نمی‌آید." },
    { name: "languages", label: "زبان‌ها", type: "multichoice", choices: KB_LANGS, default: ["fa"], span: 12, section: MAIN },

    { name: "read_mode", label: "خوانندگان", type: "choice", choices: READ_MODES, default: "everyone", required: true, list: true, filter: true, span: 12, section: AUDIENCE },
    { name: "units_tree", label: "واحدها با زیرمجموعه‌ها", type: "bool", default: true, span: 12, section: AUDIENCE },
    { name: "read_users", label: "افراد", type: "users", span: 24, section: AUDIENCE },
    { name: "read_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12, section: AUDIENCE },
    { name: "read_units", label: "واحدهای سازمانی", type: "refs", ref: "org_unit", span: 12, section: AUDIENCE },
    { name: "deny_users", label: "هرگز نبینند: افراد", type: "users", span: 24, section: AUDIENCE },
    { name: "deny_groups", label: "هرگز نبینند: گروه‌ها", type: "refs", ref: "group", span: 12, section: AUDIENCE },
    { name: "deny_units", label: "هرگز نبینند: واحدها", type: "refs", ref: "org_unit", span: 12, section: AUDIENCE },

    { name: "contrib_mode", label: "چه کسانی می‌نویسند", type: "choice", choices: CONTRIB_MODES, default: "agents", required: true, span: 12, section: CONTRIB },
    { name: "contrib_users", label: "مشارکت‌کنندگان", type: "users", span: 12, section: CONTRIB },
    { name: "contrib_groups", label: "گروه‌های مشارکت‌کننده", type: "refs", ref: "group", span: 12, section: CONTRIB },
    { name: "nocontrib_users", label: "هرگز ننویسند: افراد", type: "users", span: 12, section: CONTRIB },
    { name: "nocontrib_groups", label: "هرگز ننویسند: گروه‌ها", type: "refs", ref: "group", span: 12, section: CONTRIB },
    { name: "publish_approval", label: "انتشار با تأیید", type: "bool", default: true, span: 8, section: CONTRIB },
    { name: "approval_mode", label: "روش تأیید", type: "choice", choices: APPROVAL_MODES, default: "any", span: 8, section: CONTRIB },
    { name: "retire_approval", label: "بازنشستگی با تأیید", type: "bool", default: false, span: 8, section: CONTRIB },
    { name: "approvers", label: "تأییدکنندگان", type: "users", span: 12, section: CONTRIB },
    { name: "approver_groups", label: "گروه‌های تأییدکننده", type: "refs", ref: "group", span: 12, section: CONTRIB, help: "خالی: گروه مدیران پایگاه" },
    { name: "allowed_templates", label: "قالب‌های مجاز", type: "refs", ref: "kb_template", span: 12, section: CONTRIB, help: "خالی: همهٔ قالب‌ها" },
    { name: "default_template_id", label: "قالب پیش‌فرض", type: "ref", ref: "kb_template", span: 12, section: CONTRIB },

    { name: "default_valid_days", label: "مدت اعتبار پیش‌فرض (روز)", type: "int", min: 0, max: 3650, default: 365, span: 8, section: POLICY, help: "صفر: بی‌پایان" },
    { name: "review_days", label: "بازبینی هر (روز)", type: "int", min: 0, max: 3650, default: 180, span: 8, section: POLICY },
    { name: "review_policy", label: "پس از گذشتن موعد بازبینی", type: "choice", choices: REVIEW_POLICIES, default: "banner", span: 8, section: POLICY },
    { name: "kcs_enabled", label: "روش KCS", type: "bool", default: false, span: 8, section: POLICY, help: "مقاله‌های تازه «در حال کار» شروع می‌شوند؛ تأییدنشده‌ها فقط برای کارشناسان‌اند." },
    { name: "publishing_model", label: "مدل انتشار", type: "choice", choices: PUBLISHING_MODELS, default: "jit", span: 8, section: POLICY },
    { name: "external_after_reuses", label: "انتشار بیرونی پس از چند استفاده", type: "int", min: 1, max: 100, default: 3, span: 8, section: POLICY },
    { name: "conveyor_days", label: "مهلت جلوگیری (روز)", type: "int", min: 1, max: 60, default: 5, span: 8, section: POLICY },
    { name: "allow_comments", label: "نظر خوانندگان", type: "bool", default: true, span: 8, section: POLICY },
    { name: "allow_ratings", label: "امتیاز و «مفید بود؟»", type: "bool", default: true, span: 8, section: POLICY },

    { name: "ai_enabled", label: "در پاسخ‌های هوش مصنوعی", type: "bool", default: true, list: true, filter: true, span: 12, section: AI },
    { name: "ai_requesters", label: "در پاسخ به درخواست‌کنندگان", type: "bool", default: true, span: 12, section: AI, help: "خاموش: فقط دستیار کارشناسان از این پایگاه پاسخ می‌دهد." },

    { name: "confidential", label: "فقط کارشناسان", type: "bool", ...sys, default: false, filter: true },
    { name: "k_users", label: "مشارکت‌کنندگان (محاسبه‌شده)", type: "users", ...sys, index: true },
    { name: "k_groups", label: "گروه‌های مشارکت‌کننده (محاسبه‌شده)", type: "refs", ref: "group", ...sys, index: true },
    { name: "r_units", label: "واحدهای خواننده (محاسبه‌شده)", type: "refs", ref: "org_unit", ...sys },
    { name: "x_units", label: "واحدهای منع‌شده (محاسبه‌شده)", type: "refs", ref: "org_unit", ...sys },
    { name: "article_count", label: "مقاله‌های منتشرشده", type: "int", readonly: true, audit: false, default: 0, list: true, sort: true },
  ],
  states: BASE_STATES,
  unique: [["name"]],
  scope: { own: ["owner_id"], requester: [], group: "manager_group_id", confidentialGroup: "internal" },
  features: { confidential: true },
  rowAccess: { read: BASE_READ },
  form: { sections: [MAIN, AUDIENCE, CONTRIB, POLICY, AI] },
  list: { columns: ["name", "kind", "read_mode", "owner_id", "article_count", "ai_enabled", "state"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Categories

const category: TableDef = {
  key: "kb_category",
  table: "sm_kb_categories",
  label: "دستهٔ دانش",
  plural: "دسته‌های دانش",
  icon: "folder-tree",
  module: "knowledge",
  area: "knowledge",
  description: "شاخه‌ای از درخت دسته‌های یک پایگاه با مقاله‌های ویژه، گروه‌های ویرایشگر و مخاطب محدودکنندهٔ اختیاری",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "base_id", label: "پایگاه دانش", type: "ref", ref: "kb_base", required: true, list: true, filter: true, index: true, span: 12, section: MAIN },
    { name: "parent_id", label: "دستهٔ بالاتر", type: "ref", ref: "$self", filter: true, index: true, span: 12, section: MAIN },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6, section: MAIN },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, span: 6, section: MAIN },
    { name: "description", label: "شرح", type: "text", search: true, span: 24, section: MAIN },
    { name: "featured", label: "مقاله‌های ویژه", type: "refs", ref: "kb_article", span: 24, section: MAIN },
    { name: "managed_by_groups", label: "گروه‌های ویرایشگر این شاخه", type: "refs", ref: "group", span: 24, section: MAIN },
    { name: "read_mode", label: "خوانندگان", type: "choice", choices: CATEGORY_READ_MODES, default: "inherit", required: true, filter: true, span: 12, section: AUDIENCE },
    { name: "units_tree", label: "واحدها با زیرمجموعه‌ها", type: "bool", default: true, span: 12, section: AUDIENCE },
    { name: "read_users", label: "افراد", type: "users", span: 24, section: AUDIENCE },
    { name: "read_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12, section: AUDIENCE },
    { name: "read_units", label: "واحدهای سازمانی", type: "refs", ref: "org_unit", span: 12, section: AUDIENCE },
    { name: "path", label: "مسیر", type: "string", maxLength: 2000, ...sys },
    { name: "depth", label: "عمق", type: "int", readonly: true, audit: false, default: 0 },
    { name: "c_all", label: "همهٔ خوانندگان پایگاه", type: "bool", ...sys, default: true },
    { name: "c_users", label: "افراد خواننده (محاسبه‌شده)", type: "users", ...sys },
    { name: "c_groups", label: "گروه‌های خواننده (محاسبه‌شده)", type: "refs", ref: "group", ...sys },
    { name: "c_units", label: "واحدهای خواننده (محاسبه‌شده)", type: "refs", ref: "org_unit", ...sys },
    { name: "m_groups", label: "گروه‌های ویرایشگر (محاسبه‌شده)", type: "refs", ref: "group", ...sys, index: true },
    { name: "article_count", label: "مقاله‌ها", type: "int", readonly: true, audit: false, default: 0, list: true, sort: true },
    ...contribFields(),
  ],
  states: BASE_STATES,
  scope: { own: [], requester: [] },
  rowAccess: { read: CATEGORY_READ },
  form: { sections: [MAIN, AUDIENCE] },
  list: { columns: ["name", "base_id", "parent_id", "article_count", "state"], order: "base_id,depth,sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Articles

/** Transitions only the module's services take (publication follows the versions). */
const SERVICE_ONLY = { area: "knowledge", level: "view" as const, roles: ["__knowledge_service__"] };

export const ARTICLE_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "waiting", color: "gold" },
    { value: "scheduled", label: "زمان‌بندی‌شده", category: "waiting", color: "indigo" },
    { value: "published", label: "منتشرشده", category: "active", color: "green" },
    { value: "pending_retirement", label: "در انتظار بازنشستگی", category: "waiting", color: "orange" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
    { value: "trashed", label: "در سطل بازیافت", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "in_review", label: "در بازبینی", roles: SERVICE_ONLY },
    { from: ["in_review", "scheduled"], to: "draft", label: "بازگشت به پیش‌نویس", roles: SERVICE_ONLY },
    { from: ["draft", "in_review"], to: "scheduled", label: "زمان‌بندی انتشار", roles: SERVICE_ONLY },
    { from: ["draft", "in_review", "scheduled"], to: "published", label: "انتشار", roles: SERVICE_ONLY },
    { from: ["published"], to: "pending_retirement", label: "درخواست بازنشستگی", requires: ["retire_reason"] },
    { from: ["pending_retirement"], to: "published", label: "لغو بازنشستگی" },
    { from: ["published", "pending_retirement"], to: "retired", label: "بازنشسته کردن", requires: ["retire_reason"], guard: "kb_can_retire" },
    { from: ["retired"], to: "published", label: "بازگرداندن به انتشار", roles: { area: "knowledge", level: "full" } },
    { from: ["draft", "retired"], to: "trashed", label: "انتقال به سطل بازیافت", guard: "kb_can_trash" },
    { from: ["trashed"], to: "draft", label: "بازگردانی پیش‌نویس", guard: "kb_restore_draft" },
    { from: ["trashed"], to: "retired", label: "بازگردانی", guard: "kb_restore_retired" },
  ],
  locked: ["canceled"],
};

const CONTENT = "محتوا";
const OWNERSHIP = "مالکیت و مخاطبان";
const LIFE = "اعتبار و بازبینی";
const RELATIONS = "پیوندها و ترجمه";
const STATS = "آمار و کیفیت";

const article: TableDef = {
  key: "kb_article",
  table: "sm_kb_articles",
  label: "مقالهٔ دانش",
  plural: "مقاله‌های دانش",
  icon: "book-open-text",
  module: "knowledge",
  area: "knowledge",
  description: "دانسته‌ای که خوانندگان پیدا و دوباره استفاده می‌کنند: محتوای منتشرشده، فرادادهٔ آن و چرخهٔ عمرش",
  numbered: { prefix: "KB", pad: 6 },
  display: "title",
  fields: [
    // the published content (copied from the published version; changed only through versions)
    { name: "title", label: "عنوان", type: "string", required: true, readonly: true, maxLength: 250, list: true, search: true, sort: true, span: 24, section: CONTENT },
    { name: "summary", label: "خلاصه", type: "text", readonly: true, maxLength: 1000, search: true, span: 24, section: CONTENT },
    { name: "body", label: "متن", type: "markdown", readonly: true, search: true, span: 24, section: CONTENT },
    { name: "internal_body", label: "بخش داخلی (فقط کارشناسان)", type: "markdown", readonly: true, group: "internal", span: 24, section: CONTENT },
    { name: "keywords", label: "کلیدواژه‌ها", type: "tags", readonly: true, search: true, span: 12, section: CONTENT, help: "جست‌وجو این واژه‌ها را مهم‌تر می‌شمارد" },
    { name: "tags", label: "برچسب‌ها", type: "tags", readonly: true, filter: true, span: 12, section: CONTENT },
    { name: "article_type", label: "نوع", type: "choice", choices: ARTICLE_TYPES, default: "how_to", list: true, filter: true, span: 8, section: CONTENT },
    { name: "template_id", label: "قالب", type: "ref", ref: "kb_template", filter: true, span: 8, section: CONTENT },
    { name: "language", label: "زبان", type: "choice", choices: KB_LANGS, default: "fa", filter: true, span: 8, section: CONTENT },
    { name: "external_url", label: "نشانی منبع بیرونی", type: "url", ltr: true, span: 24, section: CONTENT },

    { name: "base_id", label: "پایگاه دانش", type: "ref", ref: "kb_base", required: true, list: true, filter: true, index: true, span: 12, section: OWNERSHIP },
    { name: "category_id", label: "دسته", type: "ref", ref: "kb_category", filter: true, index: true, span: 12, section: OWNERSHIP },
    { name: "author_id", label: "نویسنده", type: "user", default: "$me", readonly: true, filter: true, index: true, span: 8, section: OWNERSHIP },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", list: true, filter: true, index: true, span: 8, section: OWNERSHIP },
    { name: "owner_group_id", label: "گروه مالک", type: "group", filter: true, index: true, span: 8, section: OWNERSHIP },
    { name: "visibility", label: "دید", type: "choice", choices: VISIBILITIES, default: "inherit", filter: true, span: 8, section: OWNERSHIP },
    { name: "confidential", label: "فقط کارشناسان", type: "bool", readonly: true, audit: false, default: false, filter: true, span: 8, section: OWNERSHIP },
    { name: "access_list", label: "خوانندگان ویژهٔ مقالهٔ داخلی", type: "users", span: 8, section: OWNERSHIP },
    { name: "audience_mode", label: "مخاطبان مقاله", type: "choice", choices: AUDIENCE_MODES, default: "inherit", span: 12, section: OWNERSHIP },
    { name: "units_tree", label: "واحدها با زیرمجموعه‌ها", type: "bool", default: true, span: 12, section: OWNERSHIP },
    { name: "read_users", label: "افراد", type: "users", span: 24, section: OWNERSHIP },
    { name: "read_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12, section: OWNERSHIP },
    { name: "read_units", label: "واحدها", type: "refs", ref: "org_unit", span: 12, section: OWNERSHIP },
    { name: "deny_users", label: "هرگز نبینند: افراد", type: "users", span: 24, section: OWNERSHIP },
    { name: "deny_groups", label: "هرگز نبینند: گروه‌ها", type: "refs", ref: "group", span: 12, section: OWNERSHIP },
    { name: "deny_units", label: "هرگز نبینند: واحدها", type: "refs", ref: "org_unit", span: 12, section: OWNERSHIP },
    { name: "kcs_confidence", label: "اعتماد (KCS)", type: "choice", choices: KCS_CONFIDENCE, default: "validated", list: true, filter: true, span: 8, section: OWNERSHIP },
    { name: "governance", label: "حاکمیت", type: "choice", choices: GOVERNANCE, default: "experience", filter: true, span: 8, section: OWNERSHIP },
    { name: "classification", label: "طبقه‌بندی", type: "choice", choices: KB_CLASSES, default: "internal", filter: true, span: 8, section: OWNERSHIP },

    { name: "valid_from", label: "معتبر از", type: "date", sort: true, filter: true, span: 8, section: LIFE },
    { name: "valid_to", label: "معتبر تا", type: "date", sort: true, filter: true, span: 8, section: LIFE },
    { name: "review_at", label: "بازبینی بعدی", type: "date", list: true, sort: true, filter: true, span: 8, section: LIFE },
    { name: "retire_at", label: "بازنشستگی در تاریخ", type: "date", sort: true, filter: true, span: 8, section: LIFE },
    { name: "retire_reason", label: "دلیل بازنشستگی", type: "text", maxLength: 2000, span: 16, section: LIFE },
    { name: "replaced_by", label: "جایگزین", type: "ref", ref: "$self", filter: true, span: 12, section: LIFE },
    { name: "doc_number", label: "شمارهٔ سند یا بخشنامه", type: "string", maxLength: 80, search: true, span: 12, section: LIFE },
    { name: "issuing_authority", label: "مرجع صادرکننده", type: "string", maxLength: 200, span: 12, section: LIFE },
    { name: "effective_date", label: "تاریخ اجرا", type: "date", sort: true, span: 12, section: LIFE },
    { name: "last_reviewed_at", label: "آخرین بازبینی", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: LIFE },
    { name: "last_reviewed_by", label: "بازبین", type: "user", readonly: true, span: 8, section: LIFE },
    { name: "review_due", label: "موعد بازبینی گذشته", type: "bool", readonly: true, audit: false, default: false, filter: true, span: 8, section: LIFE },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, list: true, sort: true, filter: true, span: 8, section: LIFE },
    { name: "published_by", label: "منتشرکننده", type: "user", readonly: true, span: 8, section: LIFE },
    { name: "first_published_at", label: "نخستین انتشار", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: LIFE },
    { name: "retired_at", label: "زمان بازنشستگی", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: LIFE },
    { name: "version_label", label: "نسخه", type: "string", readonly: true, maxLength: 20, ltr: true, list: true, span: 8, section: LIFE },
    { name: "major", label: "نسخهٔ اصلی", type: "int", readonly: true, audit: false, default: 0, span: 8, section: LIFE },
    { name: "minor", label: "نسخهٔ فرعی", type: "int", readonly: true, audit: false, default: 0, span: 8, section: LIFE },
    { name: "published_version_id", label: "نسخهٔ منتشرشده", type: "ref", ref: "kb_version", ...sys },
    { name: "draft_version_id", label: "پیش‌نویس جاری", type: "ref", ref: "kb_version", ...sys },
    { name: "has_draft", label: "پیش‌نویس تازه دارد", type: "bool", readonly: true, audit: false, default: false, filter: true, span: 8, section: LIFE },

    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8, section: RELATIONS },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, span: 8, section: RELATIONS },
    { name: "known_error_id", label: "خطای شناخته‌شده", type: "ref", ref: "known_error", filter: true, index: true, span: 8, section: RELATIONS },
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", filter: true, span: 8, section: RELATIONS },
    { name: "translation_of", label: "ترجمهٔ", type: "ref", ref: "$self", filter: true, index: true, span: 8, section: RELATIONS },
    { name: "master_version", label: "نسخهٔ اصلیِ ترجمه‌شده", type: "int", readonly: true, span: 8, section: RELATIONS },
    { name: "translation_stale", label: "ترجمه کهنه شده", type: "bool", readonly: true, audit: false, default: false, filter: true, span: 8, section: RELATIONS },
    { name: "machine_translated", label: "ترجمهٔ ماشینی", type: "bool", readonly: true, default: false, filter: true, span: 8, section: RELATIONS },
    { name: "source_table", label: "جدول منشأ", type: "string", maxLength: 60, readonly: true, hidden: true },
    { name: "source_id", label: "رکورد منشأ", type: "string", maxLength: 36, readonly: true, hidden: true, index: true },
    { name: "source_number", label: "رکورد منشأ", type: "string", maxLength: 40, readonly: true, ltr: true, span: 8, section: RELATIONS },

    { name: "ai_use", label: "استفادهٔ هوش مصنوعی", type: "choice", choices: AI_USES, default: "answer", filter: true, span: 12, section: AI },
    { name: "ai_requesters", label: "در پاسخ به درخواست‌کنندگان", type: "bool", default: true, span: 12, section: AI },
    { name: "ai_provenance", label: "منشأ هوش مصنوعی", type: "json", readonly: true, hidden: true },

    { name: "view_count", label: "بازدید", type: "int", readonly: true, audit: false, default: 0, list: true, sort: true, filter: true, span: 6, section: STATS },
    { name: "reuse_count", label: "استفادهٔ دوباره", type: "int", readonly: true, audit: false, default: 0, list: true, sort: true, filter: true, span: 6, section: STATS, help: "شمار رکوردهای متمایزی که با این مقاله حل یا پیوند شده‌اند" },
    { name: "helpful_yes", label: "مفید بود", type: "int", readonly: true, audit: false, default: 0, sort: true, span: 6, section: STATS },
    { name: "helpful_no", label: "مفید نبود", type: "int", readonly: true, audit: false, default: 0, sort: true, span: 6, section: STATS },
    { name: "rating_avg", label: "میانگین امتیاز", type: "decimal", readonly: true, audit: false, sort: true, span: 6, section: STATS },
    { name: "rating_count", label: "شمار امتیازها", type: "int", readonly: true, audit: false, default: 0, span: 6, section: STATS },
    { name: "open_flags", label: "ایرادهای باز", type: "int", readonly: true, audit: false, default: 0, sort: true, filter: true, span: 6, section: STATS },
    { name: "health_score", label: "سلامت", type: "int", readonly: true, audit: false, sort: true, filter: true, span: 6, section: STATS },
    { name: "quality_score", label: "کیفیت (AQI)", type: "int", readonly: true, audit: false, sort: true, filter: true, span: 6, section: STATS },
    { name: "next_action", label: "اقدام پیشنهادی", type: "choice", choices: NEXT_ACTIONS, readonly: true, audit: false, filter: true, span: 6, section: STATS },
    { name: "last_used_at", label: "آخرین استفاده", type: "datetime", readonly: true, audit: false, sort: true, span: 6, section: STATS },

    { name: "reviewer_ids", label: "بازبین‌ها", type: "users", readonly: true, hidden: true, audit: false, index: true },
    { name: "approval", label: "تأیید بازنشستگی", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8, section: LIFE },
    { name: "r_units", label: "واحدهای خواننده (محاسبه‌شده)", type: "refs", ref: "org_unit", ...sys },
    { name: "x_units", label: "واحدهای منع‌شده (محاسبه‌شده)", type: "refs", ref: "org_unit", ...sys },
    { name: "trashed_at", label: "زمان انتقال به سطل", type: "datetime", readonly: true, hidden: true, audit: false },
    ...contribFields(),
  ],
  states: ARTICLE_STATES,
  scope: { own: ["author_id", "owner_id"], requester: [], group: "owner_group_id", confidentialGroup: "internal" },
  features: { journal: true, attachments: true, links: true, confidential: true, rag: true },
  rowAccess: { read: ARTICLE_READ, write: ARTICLE_WRITE },
  form: {
    sections: [CONTENT, OWNERSHIP, LIFE, RELATIONS, AI, STATS],
    related: [
      { table: "kb_version", field: "article_id", label: "نسخه‌ها", columns: ["version_label", "state", "author_id", "change_note", "updated_at"] },
      { table: "kb_feedback", field: "article_id", label: "بازخوردها", columns: ["kind", "reason", "rating", "comment", "state", "created_at"] },
      { table: "kb_task", field: "article_id", label: "کارهای دانش", columns: ["number", "short_description", "kind", "state", "assigned_to"] },
      { table: "kb_article", field: "translation_of", label: "ترجمه‌ها", columns: ["number", "title", "language", "state", "translation_stale"] },
    ],
  },
  list: { columns: ["number", "title", "article_type", "base_id", "state", "version_label", "owner_id", "view_count", "reuse_count", "review_at"], order: "-updated_at" },
  ai: { title: "title", text: ["summary", "body", "internal_body"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Versions

export const VERSION_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "waiting", color: "gold" },
    { value: "scheduled", label: "زمان‌بندی‌شده", category: "waiting", color: "indigo" },
    { value: "published", label: "منتشرشده", category: "active", color: "green" },
    { value: "outdated", label: "منسوخ", category: "closed", color: "gray" },
    { value: "discarded", label: "کنار گذاشته", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "in_review", label: "ارسال برای بازبینی", guard: "kb_can_submit" },
    { from: ["in_review", "scheduled"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["draft", "in_review"], to: "scheduled", label: "زمان‌بندی انتشار", roles: SERVICE_ONLY },
    { from: ["draft", "in_review", "scheduled"], to: "published", label: "انتشار", roles: SERVICE_ONLY },
    { from: ["published"], to: "outdated", label: "منسوخ", roles: SERVICE_ONLY },
    { from: ["draft"], to: "discarded", label: "کنار گذاشتن پیش‌نویس" },
  ],
  locked: ["closed", "canceled"],
};

const version: TableDef = {
  key: "kb_version",
  table: "sm_kb_versions",
  label: "نسخهٔ مقاله",
  plural: "نسخه‌های مقاله",
  icon: "git-branch",
  module: "knowledge",
  area: "knowledge",
  description: "یک نسخه از محتوای مقاله: پیش‌نویس، در بازبینی، منتشرشده یا منسوخ؛ با تأیید، منشأ هوش مصنوعی و یادداشت تغییر",
  display: "title",
  fields: [
    { name: "article_id", label: "مقاله", type: "ref", ref: "kb_article", required: true, list: true, filter: true, index: true, span: 12, section: MAIN },
    { name: "version_label", label: "نسخه", type: "string", readonly: true, maxLength: 20, ltr: true, list: true, span: 6, section: MAIN },
    { name: "change_kind", label: "نوع تغییر", type: "choice", choices: [{ value: "minor", label: "ویرایش جزئی" }, { value: "major", label: "نسخهٔ اصلی تازه" }], default: "minor", span: 6, section: MAIN },
    { name: "major", label: "نسخهٔ اصلی", type: "int", readonly: true, audit: false, default: 1 },
    { name: "minor", label: "نسخهٔ فرعی", type: "int", readonly: true, audit: false, default: 0 },
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 250, list: true, search: true, span: 24, section: CONTENT },
    { name: "summary", label: "خلاصه", type: "text", maxLength: 1000, span: 24, section: CONTENT },
    { name: "body", label: "متن", type: "markdown", span: 24, section: CONTENT },
    { name: "internal_body", label: "بخش داخلی (فقط کارشناسان)", type: "markdown", group: "internal", span: 24, section: CONTENT },
    { name: "keywords", label: "کلیدواژه‌ها", type: "tags", span: 12, section: CONTENT },
    { name: "tags", label: "برچسب‌ها", type: "tags", span: 12, section: CONTENT },
    { name: "change_note", label: "شرح تغییر", type: "text", maxLength: 2000, list: true, span: 24, section: MAIN },
    { name: "author_id", label: "نویسنده", type: "user", default: "$me", readonly: true, list: true, filter: true, index: true, span: 8, section: MAIN },
    { name: "publish_at", label: "انتشار در", type: "datetime", sort: true, span: 8, section: MAIN, help: "خالی: پس از تأیید منتشر می‌شود" },
    { name: "submitted_at", label: "زمان ارسال برای بازبینی", type: "datetime", readonly: true, sort: true, span: 8, section: MAIN },
    { name: "submitted_by", label: "ارسال‌کننده", type: "user", readonly: true, span: 8, section: MAIN },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", readonly: true, span: 8, section: MAIN },
    { name: "approved_by", label: "تأییدکننده", type: "user", readonly: true, span: 8, section: MAIN },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, sort: true, span: 8, section: MAIN },
    { name: "published_by", label: "منتشرکننده", type: "user", readonly: true, span: 8, section: MAIN },
    { name: "approval", label: "تأیید انتشار", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, list: true, filter: true, span: 8, section: MAIN },
    { name: "needs_approval", label: "نیازمند تأیید", type: "bool", readonly: true, audit: false, default: false },
    { name: "approval_mode", label: "روش تأیید", type: "choice", choices: APPROVAL_MODES, readonly: true, audit: false },
    { name: "reviewer_ids", label: "بازبین‌ها", type: "users", readonly: true, list: false, index: true, span: 24, section: MAIN },
    { name: "ai_provenance", label: "منشأ هوش مصنوعی", type: "json", readonly: true, hidden: true },
    { name: "ai_validated_by", label: "تأیید انسانی متن هوش مصنوعی", type: "user", readonly: true, span: 8, section: MAIN },
    { name: "content_hash", label: "اثر محتوا", type: "string", maxLength: 80, ...sys },
    { name: "word_count", label: "شمار واژه‌ها", type: "int", readonly: true, audit: false, default: 0, span: 8, section: MAIN },
    { name: "checks", label: "بررسی‌ها", type: "json", readonly: true, hidden: true, audit: false },
    ...contribFields(),
  ],
  states: VERSION_STATES,
  scope: { own: ["author_id"], requester: ["author_id"] },
  features: { journal: true, history: true, attachments: true },
  rowAccess: { read: VERSION_READ },
  form: { sections: [MAIN, CONTENT] },
  list: { columns: ["version_label", "title", "state", "author_id", "approval", "change_note", "updated_at"], order: "-major,-minor,-created_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Templates

const template: TableDef = {
  key: "kb_template",
  table: "sm_kb_templates",
  label: "قالب مقاله",
  plural: "قالب‌های مقاله",
  icon: "layout-template",
  module: "knowledge",
  area: "knowledge",
  description: "بخش‌های از پیش تعریف‌شدهٔ یک نوع مقاله با راهنمای نوشتن، بخش‌های الزامی و بخش‌های فقط-داخلی",
  display: "name",
  fields: [
    { name: "name", label: "نام قالب", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "article_type", label: "نوع مقاله", type: "choice", choices: ARTICLE_TYPES, default: "how_to", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
    { name: "sections", label: "بخش‌ها", type: "json", default: [], span: 24, help: "[{ «key»: «issue», «label»: «مسئله», «guidance»: «…», «required»: true, «internal»: false }]" },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "builtin", label: "کلید قالب پیش‌فرض", type: "string", maxLength: 40, readonly: true, hidden: true },
  ],
  unique: [["name"]],
  scope: { public: true },
  list: { columns: ["name", "article_type", "active"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Feedback

const feedback: TableDef = {
  key: "kb_feedback",
  table: "sm_kb_feedback",
  label: "بازخورد مقاله",
  plural: "بازخوردهای مقاله",
  icon: "message-square-heart",
  module: "knowledge",
  area: "knowledge",
  description: "رأی «مفید بود؟»، امتیاز، نظر یا گزارش ایراد یک خواننده دربارهٔ یک مقاله",
  display: "kind",
  fields: [
    { name: "article_id", label: "مقاله", type: "ref", ref: "kb_article", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_label", label: "نسخه", type: "string", maxLength: 20, ltr: true, span: 6 },
    { name: "kind", label: "نوع", type: "choice", choices: FEEDBACK_KINDS, required: true, list: true, filter: true, span: 6 },
    { name: "user_id", label: "خواننده", type: "user", default: "$me", readonly: true, list: true, filter: true, index: true, span: 8 },
    { name: "reason", label: "دلیل", type: "choice", choices: FLAG_REASONS, list: true, filter: true, span: 8 },
    { name: "rating", label: "امتیاز", type: "rating", min: 1, max: 5, list: true, span: 8 },
    { name: "comment", label: "توضیح", type: "text", maxLength: 4000, list: true, span: 24 },
    { name: "channel", label: "مجرا", type: "choice", choices: KB_CHANNELS, default: "portal", filter: true, span: 8 },
    { name: "state", label: "وضعیت", type: "choice", choices: FEEDBACK_STATES, default: "open", list: true, filter: true, span: 8 },
    { name: "task_id", label: "کار دانش", type: "ref", ref: "kb_task", filter: true, span: 8 },
    ...contribFields(),
  ],
  scope: { own: ["user_id"], requester: [] },
  rowAccess: { read: FEEDBACK_READ },
  list: { columns: ["article_id", "kind", "reason", "rating", "user_id", "state", "created_at"], order: "-created_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Knowledge tasks

export const KB_TASK_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "waiting", label: "در انتظار", category: "waiting", color: "gold" },
    { value: "done", label: "انجام شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "dismissed", label: "کنار گذاشته شد", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new", "waiting"], to: "in_progress", label: "شروع" },
    { from: ["new", "in_progress"], to: "waiting", label: "در انتظار" },
    { from: ["new", "in_progress", "waiting"], to: "done", label: "انجام شد", requires: ["close_code"] },
    { from: ["done"], to: "in_progress", label: "بازگشایی" },
    { from: ["done"], to: "closed", label: "بستن" },
    { from: ["new", "in_progress", "waiting"], to: "dismissed", label: "کنار گذاشتن", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const kbTask: TableDef = {
  key: "kb_task",
  table: "sm_kb_tasks",
  label: "کار دانش",
  plural: "کارهای دانش",
  icon: "list-checks",
  module: "knowledge",
  area: "knowledge",
  description: "کار گروه مالک دانش: گزارش ایراد، کمبود دانش، بازبینی، ترجمه، ادغام، ارزیابی کیفیت و نوشتن مقاله از رکورد",
  extends: "task",
  numbered: { prefix: "KBT", pad: 6 },
  display: "short_description",
  fields: [
    { name: "kind", label: "نوع کار", type: "choice", choices: TASK_KINDS, required: true, default: "flag", list: true, filter: true, span: 8 },
    { name: "article_id", label: "مقاله", type: "ref", ref: "kb_article", list: true, filter: true, index: true, span: 8 },
    { name: "gap_id", label: "شکاف دانش", type: "ref", ref: "kb_gap", filter: true, span: 8 },
    { name: "feedback_count", label: "بازخوردهای جمع‌شده", type: "int", readonly: true, audit: false, default: 0, span: 8 },
    { name: "source_table", label: "جدول رکورد", type: "string", maxLength: 60, readonly: true, hidden: true },
    { name: "source_id", label: "رکورد", type: "string", maxLength: 36, readonly: true, hidden: true, index: true },
    { name: "source_number", label: "رکورد مرتبط", type: "string", maxLength: 40, readonly: true, ltr: true, span: 8 },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, default: "3" },
    { name: "close_code", label: "نتیجه", type: "choice", choices: "$table.close_code" },
    ...hideTaskFields(["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "approval", "escalation", "parent_id", "service_id", "ci_id", "location_id", "time_worked"]),
    ...contribFields(),
  ],
  states: KB_TASK_STATES,
  scope: {},
  rowAccess: { read: TASK_READ },
  list: { columns: ["number", "short_description", "kind", "article_id", "state", "priority", "assignment_group_id", "assigned_to", "sla_due"], order: "-opened_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Answer snippets, reusable blocks, the glossary

const CONTENT_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "published", label: "منتشرشده", category: "active", color: "green" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft", "retired"], to: "published", label: "انتشار" },
    { from: ["published"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["draft", "published"], to: "retired", label: "بازنشسته" },
  ],
  locked: [],
};

const snippet: TableDef = {
  key: "kb_snippet",
  table: "sm_kb_snippets",
  label: "پاسخ کوتاه",
  plural: "پاسخ‌های کوتاه",
  icon: "message-circle-question",
  module: "knowledge",
  area: "knowledge",
  description: "پرسش و پاسخی یک‌تا سه‌جمله‌ای با منبع، برای پاسخ فوری در مرکز دانش، گفتگو و پیام‌رسان‌ها",
  numbered: { prefix: "KBS", pad: 6 },
  display: "question",
  fields: [
    { name: "question", label: "پرسش", type: "string", required: true, maxLength: 300, list: true, search: true, sort: true, span: 24 },
    { name: "answer", label: "پاسخ", type: "text", required: true, maxLength: 2000, search: true, span: 24 },
    { name: "base_id", label: "پایگاه دانش", type: "ref", ref: "kb_base", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "source_article_id", label: "مقالهٔ منبع", type: "ref", ref: "kb_article", filter: true, span: 8 },
    { name: "language", label: "زبان", type: "choice", choices: KB_LANGS, default: "fa", filter: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", filter: true, index: true, span: 8 },
    { name: "owner_group_id", label: "گروه مالک", type: "group", filter: true, span: 8 },
    { name: "valid_to", label: "معتبر تا", type: "date", sort: true, filter: true, span: 8 },
    { name: "visibility", label: "دید", type: "choice", choices: VISIBILITIES, default: "inherit", span: 8 },
    { name: "confidential", label: "فقط کارشناسان", type: "bool", readonly: true, audit: false, default: false, filter: true, span: 8 },
    { name: "ai_generated", label: "نوشتهٔ هوش مصنوعی", type: "bool", default: false, readonly: true, filter: true, span: 8 },
    ...contribFields(),
  ],
  states: CONTENT_STATES,
  scope: { own: ["owner_id"], requester: [], group: "owner_group_id", confidentialGroup: "internal" },
  features: { confidential: true, rag: true },
  rowAccess: { read: SNIPPET_READ },
  list: { columns: ["number", "question", "base_id", "state", "language", "valid_to"], order: "-updated_at" },
  ai: { title: "question", text: ["answer"] },
};

const block: TableDef = {
  key: "kb_block",
  table: "sm_kb_blocks",
  label: "بلوک دانش",
  plural: "بلوک‌های دانش",
  icon: "blocks",
  module: "knowledge",
  area: "knowledge",
  description: "قطعهٔ محتوایی مشترک (مثلاً «نصب کلاینت VPN» یا جدول تماس) که با {{block:شماره}} در چند مقاله جاسازی می‌شود",
  numbered: { prefix: "KBB", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 16 },
    { name: "visibility", label: "دید", type: "choice", choices: VISIBILITIES, default: "inherit", list: true, span: 8, help: "«فقط کارشناسان»: در مقاله‌ها فقط برای کارشناسان نمایش داده می‌شود" },
    { name: "body", label: "متن", type: "markdown", required: true, span: 24 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", filter: true, index: true, span: 12 },
    { name: "owner_group_id", label: "گروه مالک", type: "group", filter: true, span: 12 },
    { name: "confidential", label: "فقط کارشناسان", type: "bool", readonly: true, audit: false, default: false, filter: true, span: 8 },
    { name: "used_in", label: "مقاله‌های میزبان", type: "refs", ref: "kb_article", readonly: true, audit: false, span: 24 },
  ],
  states: CONTENT_STATES,
  scope: { own: ["owner_id"], requester: [], group: "owner_group_id", confidentialGroup: "internal" },
  features: { confidential: true, history: true },
  rowAccess: { read: BLOCK_READ },
  list: { columns: ["number", "title", "visibility", "state", "updated_at"], order: "-updated_at" },
};

const glossary: TableDef = {
  key: "kb_glossary",
  table: "sm_kb_glossary",
  label: "واژهٔ واژه‌نامه",
  plural: "واژه‌نامهٔ سازمان",
  icon: "book-a",
  module: "knowledge",
  area: "knowledge",
  description: "اصطلاح‌ها، سرواژه‌ها و معادل‌های فارسی مصوب: در مقاله‌ها توضیح داده می‌شوند و جست‌وجو را گسترش می‌دهند",
  display: "term",
  fields: [
    { name: "term", label: "واژه", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "approved_fa", label: "معادل فارسی مصوب", type: "string", maxLength: 120, list: true, search: true, span: 12 },
    { name: "synonyms", label: "هم‌معنی‌ها و شکل‌های دیگر", type: "tags", search: true, span: 24, help: "هر کدام در جست‌وجو همین واژه شمرده می‌شود (مثلاً «وی‌پی‌ان، VPN، شبکهٔ خصوصی مجازی»)" },
    { name: "definition", label: "تعریف", type: "text", maxLength: 2000, search: true, span: 24 },
    { name: "language", label: "زبان", type: "choice", choices: KB_LANGS, default: "fa", filter: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
  ],
  unique: [["term"]],
  scope: { public: true },
  list: { columns: ["term", "approved_fa", "synonyms", "active"], order: "term" },
};

// ---------------------------------------------------------------------------------------------------------------
// Subscriptions, read-and-acknowledge campaigns, KCS licences, quality reviews

const subscription: TableDef = {
  key: "kb_subscription",
  table: "sm_kb_subscriptions",
  label: "اشتراک دانش",
  plural: "اشتراک‌های دانش",
  icon: "bell-plus",
  module: "knowledge",
  area: "knowledge",
  description: "دنبال کردن یک مقاله، دسته یا پایگاه دانش برای آگاهی از انتشار، تغییر اساسی یا بازنشستگی",
  display: "target_label",
  fields: [
    { name: "user_id", label: "عضو", type: "user", default: "$me", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "target_table", label: "دنبال‌شده", type: "choice", choices: SUBSCRIPTION_TARGETS, required: true, list: true, filter: true, span: 12 },
    { name: "target_id", label: "شناسه", type: "string", required: true, maxLength: 36, ltr: true, index: true, hidden: true },
    { name: "target_label", label: "عنوان", type: "string", maxLength: 250, list: true, search: true, span: 24 },
    { name: "events", label: "آگاهی از", type: "multichoice", choices: SUBSCRIPTION_EVENTS, default: ["published", "major", "retired"], span: 24 },
  ],
  unique: [["user_id", "target_table", "target_id"]],
  scope: { own: ["user_id"], requester: [] },
  rowAccess: { read: { f: "user_id", op: "is_me" } },
  list: { columns: ["target_label", "target_table", "events", "created_at"], order: "-created_at" },
};

const ATT_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "active", label: "در جریان", category: "active", color: "teal" },
    { value: "closed", label: "پایان‌یافته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "active", label: "آغاز کارزار" },
    { from: ["active"], to: "closed", label: "پایان کارزار" },
    { from: ["closed"], to: "active", label: "ادامهٔ کارزار" },
  ],
  locked: [],
};

const attestation: TableDef = {
  key: "kb_attestation",
  table: "sm_kb_attestations",
  label: "کارزار تأیید مطالعه",
  plural: "کارزارهای تأیید مطالعه",
  icon: "file-check-2",
  module: "knowledge",
  area: "knowledge",
  description: "«خواندم و می‌پذیرم» برای یک خط‌مشی یا بخشنامه: مخاطبان، موعد، یادآوری و فهرست تأییدها",
  numbered: { prefix: "ATT", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "article_id", label: "مقاله", type: "ref", ref: "kb_article", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_label", label: "نسخهٔ مقاله", type: "string", readonly: true, maxLength: 20, ltr: true, span: 6 },
    { name: "due_at", label: "موعد", type: "date", required: true, list: true, sort: true, filter: true, span: 6 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", list: true, filter: true, index: true, span: 8 },
    { name: "remind_every_days", label: "یادآوری هر (روز)", type: "int", min: 0, max: 60, default: 3, span: 8 },
    { name: "target_users", label: "افراد", type: "users", span: 24 },
    { name: "target_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12 },
    { name: "target_units", label: "واحدها (با زیرمجموعه‌ها)", type: "refs", ref: "org_unit", span: 12 },
    { name: "audience_count", label: "مخاطبان", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    { name: "ack_count", label: "تأییدها", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    { name: "reminded_at", label: "آخرین یادآوری", type: "datetime", readonly: true, audit: false, span: 8 },
    ...contribFields(),
  ],
  states: ATT_STATES,
  scope: { own: ["owner_id"], requester: [] },
  features: { journal: true },
  rowAccess: { read: ATTESTATION_READ },
  list: { columns: ["number", "title", "article_id", "state", "due_at", "audience_count", "ack_count"], order: "-created_at" },
};

const ack: TableDef = {
  key: "kb_ack",
  table: "sm_kb_acks",
  label: "تأیید مطالعه",
  plural: "تأییدهای مطالعه",
  icon: "check-check",
  module: "knowledge",
  area: "knowledge",
  description: "تأیید یک عضو که نسخهٔ مشخصی از یک خط‌مشی را خوانده و پذیرفته است",
  display: "version_label",
  fields: [
    { name: "attestation_id", label: "کارزار", type: "ref", ref: "kb_attestation", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "article_id", label: "مقاله", type: "ref", ref: "kb_article", required: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "عضو", type: "user", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_label", label: "نسخه", type: "string", maxLength: 20, ltr: true, list: true, span: 6 },
    { name: "acked_at", label: "زمان تأیید", type: "datetime", list: true, sort: true, span: 6 },
    ...contribFields(),
  ],
  unique: [["attestation_id", "user_id"]],
  scope: { own: ["user_id"], requester: [] },
  rowAccess: { read: ACK_READ },
  list: { columns: ["attestation_id", "user_id", "version_label", "acked_at"], order: "-acked_at" },
};

const LICENCE_STATES: StateModel = {
  field: "state",
  initial: "active",
  states: [
    { value: "active", label: "معتبر", category: "active", color: "green" },
    { value: "expired", label: "منقضی", category: "closed", color: "gray" },
    { value: "revoked", label: "لغوشده", category: "canceled", color: "red" },
  ],
  transitions: [
    { from: ["active"], to: "expired", label: "انقضا" },
    { from: ["active", "expired"], to: "revoked", label: "لغو", requires: ["evidence"] },
    { from: ["expired", "revoked"], to: "active", label: "تمدید" },
  ],
  locked: [],
};

const licence: TableDef = {
  key: "kb_licence",
  table: "sm_kb_licences",
  label: "مجوز KCS",
  plural: "مجوزهای KCS",
  icon: "badge-check",
  module: "knowledge",
  area: "knowledge",
  description: "سطح KCS یک عضو (نامزد، مشارکت‌کننده، منتشرکننده، مربی، خبره) در یک پایگاه یا همهٔ پایگاه‌ها، با تاریخ انقضا",
  display: "level",
  fields: [
    { name: "user_id", label: "عضو", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "level", label: "سطح", type: "choice", choices: LICENCE_LEVELS, required: true, default: "contributor", list: true, filter: true, span: 12 },
    { name: "base_id", label: "پایگاه دانش", type: "ref", ref: "kb_base", filter: true, span: 12, help: "خالی: همهٔ پایگاه‌ها" },
    { name: "coach_id", label: "مربی", type: "user", filter: true, span: 12 },
    { name: "granted_at", label: "تاریخ اعطا", type: "date", default: "$today", sort: true, span: 8 },
    { name: "expires_at", label: "انقضا", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "evidence", label: "شواهد و دلیل", type: "text", maxLength: 2000, span: 24 },
  ],
  states: LICENCE_STATES,
  scope: { public: true },
  list: { columns: ["user_id", "level", "base_id", "state", "expires_at"], order: "user_id" },
};

const QR_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "done", label: "انجام شد", category: "closed", color: "green" },
    { value: "skipped", label: "کنار گذاشته شد", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "done", label: "ثبت ارزیابی" },
    { from: ["open"], to: "skipped", label: "کنار گذاشتن" },
    { from: ["done"], to: "open", label: "ویرایش دوباره" },
  ],
  locked: [],
};

const qualityReview: TableDef = {
  key: "kb_quality_review",
  table: "sm_kb_quality_reviews",
  label: "ارزیابی کیفیت مقاله",
  plural: "ارزیابی‌های کیفیت (AQI)",
  icon: "clipboard-check",
  module: "knowledge",
  area: "knowledge",
  description: "بررسی یک مقالهٔ نمونه با چک‌لیست استاندارد محتوا؛ نتیجه را فقط نویسنده و مربی می‌بینند",
  display: "version_label",
  fields: [
    { name: "article_id", label: "مقاله", type: "ref", ref: "kb_article", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_label", label: "نسخه", type: "string", maxLength: 20, ltr: true, span: 6 },
    { name: "period", label: "دوره", type: "string", maxLength: 10, ltr: true, list: true, filter: true, span: 6 },
    { name: "author_id", label: "نویسنده", type: "user", list: true, filter: true, index: true, span: 12 },
    { name: "reviewer_id", label: "مربی", type: "user", list: true, filter: true, index: true, span: 12 },
    { name: "results", label: "نتیجهٔ چک‌لیست", type: "json", default: {}, span: 24 },
    { name: "score", label: "امتیاز", type: "int", readonly: true, list: true, sort: true, span: 8 },
    { name: "notes", label: "یادداشت مربی", type: "text", maxLength: 4000, span: 24 },
  ],
  states: QR_STATES,
  scope: { own: ["reviewer_id", "author_id"], requester: [] },
  rowAccess: { read: { or: [me("reviewer_id"), me("author_id")] } },
  list: { columns: ["article_id", "author_id", "reviewer_id", "period", "score", "state"], order: "-created_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Gaps, duplicates, search rules, decision trees, domains

const GAP_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "orange" },
    { value: "in_progress", label: "در حال پوشش", category: "active", color: "teal" },
    { value: "covered", label: "پوشش داده شد", category: "resolved", color: "green" },
    { value: "dismissed", label: "کنار گذاشته شد", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "in_progress", label: "شروع پوشش" },
    { from: ["open", "in_progress"], to: "covered", label: "پوشش داده شد" },
    { from: ["open", "in_progress"], to: "dismissed", label: "کنار گذاشتن" },
    { from: ["covered", "dismissed"], to: "open", label: "بازگشایی" },
  ],
  locked: [],
};

const gap: TableDef = {
  key: "kb_gap",
  table: "sm_kb_gaps",
  label: "شکاف دانش",
  plural: "شکاف‌های دانش",
  icon: "search-x",
  module: "knowledge",
  area: "knowledge",
  description: "موضوعی که جست‌وجو کرده‌اند یا با آن درخواست ثبت کرده‌اند اما مقاله‌ای برایش نیست",
  numbered: { prefix: "KGP", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "موضوع", type: "string", required: true, maxLength: 250, list: true, search: true, sort: true, span: 24 },
    { name: "kind", label: "نشانه", type: "choice", choices: GAP_KINDS, default: "zero_result", list: true, filter: true, span: 8 },
    { name: "signature", label: "نشانهٔ تکرار", type: "string", maxLength: 300, hidden: true, readonly: true, index: true },
    { name: "demand", label: "تقاضا", type: "int", default: 0, list: true, sort: true, filter: true, span: 8 },
    { name: "score", label: "امتیاز شکاف", type: "int", default: 0, list: true, sort: true, span: 8 },
    { name: "last_seen_at", label: "آخرین بار", type: "datetime", list: true, sort: true, span: 8 },
    { name: "samples", label: "نمونه‌ها", type: "json", default: [], span: 24 },
    { name: "outline", label: "طرح پیشنهادی مقاله", type: "markdown", span: 24 },
    { name: "base_id", label: "پایگاه پیشنهادی", type: "ref", ref: "kb_base", filter: true, span: 8 },
    { name: "group_id", label: "گروه مسئول", type: "group", filter: true, index: true, span: 8 },
    { name: "article_id", label: "مقالهٔ پوشش‌دهنده", type: "ref", ref: "kb_article", filter: true, span: 8 },
    { name: "confidential", label: "فقط کارشناسان", type: "bool", default: true, readonly: true, audit: false },
  ],
  states: GAP_STATES,
  scope: { own: [], requester: [], group: "group_id", confidentialGroup: "internal" },
  features: { confidential: true, journal: true },
  list: { columns: ["number", "title", "kind", "demand", "score", "state", "last_seen_at"], order: "-score,-last_seen_at" },
};

const DUP_STATES: StateModel = {
  field: "state",
  initial: "proposed",
  states: [
    { value: "proposed", label: "پیشنهادشده", category: "new", color: "orange" },
    { value: "merged", label: "ادغام شد", category: "resolved", color: "green" },
    { value: "dismissed", label: "متفاوت‌اند", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["proposed"], to: "merged", label: "ادغام شد" },
    { from: ["proposed"], to: "dismissed", label: "متفاوت‌اند" },
    { from: ["dismissed"], to: "proposed", label: "بررسی دوباره" },
  ],
  locked: [],
};

const duplicate: TableDef = {
  key: "kb_duplicate",
  table: "sm_kb_duplicates",
  label: "مقاله‌های احتمالاً تکراری",
  plural: "مقاله‌های احتمالاً تکراری",
  icon: "copy",
  module: "knowledge",
  area: "knowledge",
  description: "دو مقاله با متن بسیار شبیه؛ مدیر دانش آن‌ها را ادغام (یکی جایگزین دیگری) یا متفاوت اعلام می‌کند",
  display: "pair_key",
  fields: [
    { name: "article_a", label: "مقالهٔ یکم", type: "ref", ref: "kb_article", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "article_b", label: "مقالهٔ دوم", type: "ref", ref: "kb_article", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "similarity", label: "شباهت (درصد)", type: "int", list: true, sort: true, span: 8 },
    { name: "method", label: "روش", type: "choice", choices: [{ value: "shingles", label: "هم‌پوشانی متن" }, { value: "semantic", label: "معنایی" }], default: "shingles", span: 8 },
    { name: "pair_key", label: "جفت", type: "string", maxLength: 80, required: true, readonly: true, hidden: true },
    { name: "confidential", label: "فقط کارشناسان", type: "bool", default: true, readonly: true, audit: false },
  ],
  states: DUP_STATES,
  unique: [["pair_key"]],
  scope: { own: [], requester: [], confidentialGroup: "internal" },
  features: { confidential: true },
  list: { columns: ["article_a", "article_b", "similarity", "state", "updated_at"], order: "-similarity" },
};

const searchRule: TableDef = {
  key: "kb_search_rule",
  table: "sm_kb_search_rules",
  label: "قاعدهٔ جست‌وجوی دانش",
  plural: "قاعده‌های جست‌وجوی دانش",
  icon: "list-filter",
  module: "knowledge",
  area: "knowledge",
  description: "برای پرسش‌هایی که این عبارت را دارند، مقاله‌هایی را سنجاق، بالاتر، پایین‌تر یا پنهان کن",
  display: "query",
  fields: [
    { name: "query", label: "وقتی پرسش شامل این باشد", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "kind", label: "اقدام", type: "choice", choices: SEARCH_RULE_KINDS, required: true, default: "pin", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "articles", label: "مقاله‌ها", type: "refs", ref: "kb_article", required: true, span: 24 },
    { name: "note", label: "یادداشت", type: "text", maxLength: 1000, span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["query", "kind", "articles", "active"], order: "query" },
};

const tree: TableDef = {
  key: "kb_decision_tree",
  table: "sm_kb_decision_trees",
  label: "درخت تصمیم",
  plural: "درخت‌های تصمیم",
  icon: "git-fork",
  module: "knowledge",
  area: "knowledge",
  description: "پرسش‌وپاسخ گام‌به‌گام که کاربر یا کارشناس پشت تلفن را به پاسخ، مقاله یا ثبت درخواست می‌رساند",
  numbered: { prefix: "KDT", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 16 },
    { name: "base_id", label: "پایگاه دانش", type: "ref", ref: "kb_base", filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24 },
    { name: "nodes", label: "گره‌ها", type: "json", default: [], span: 24, help: "[{ «id»: «q1», «kind»: «question»، «text»: «…»، «options»: [{ «label»: «…»، «next»: «a1» }] }, { «id»: «a1», «kind»: «answer»، «text»: «…»، «article_id»: «…» }]" },
    { name: "start", label: "گره آغاز", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", filter: true, span: 8 },
    { name: "owner_group_id", label: "گروه مالک", type: "group", filter: true, span: 8 },
    { name: "visibility", label: "دید", type: "choice", choices: VISIBILITIES, default: "inherit", span: 8 },
    { name: "confidential", label: "فقط کارشناسان", type: "bool", readonly: true, audit: false, default: false },
    { name: "starts", label: "شروع‌ها", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    { name: "finishes", label: "به پاسخ رسید", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    ...contribFields(),
  ],
  states: CONTENT_STATES,
  scope: { own: ["owner_id"], requester: [], group: "owner_group_id", confidentialGroup: "internal" },
  features: { confidential: true, history: true },
  rowAccess: { read: SNIPPET_READ },
  list: { columns: ["number", "title", "base_id", "state", "starts", "finishes"], order: "title" },
};

const domain: TableDef = {
  key: "kb_domain",
  table: "sm_kb_domains",
  label: "حوزهٔ دانش",
  plural: "حوزه‌های دانش",
  icon: "network",
  module: "knowledge",
  area: "knowledge",
  description: "حوزه‌ای مثل «شبکه» یا «حقوق و دستمزد» با خبرهٔ مسئول، پایگاه‌ها و دسته‌هایش و هدف پوشش دانش",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "kde_id", label: "خبرهٔ حوزه", type: "user", list: true, filter: true, span: 12 },
    { name: "bases", label: "پایگاه‌ها", type: "refs", ref: "kb_base", span: 12 },
    { name: "categories", label: "دسته‌ها", type: "refs", ref: "kb_category", span: 12 },
    { name: "capture_days", label: "هدف: مقاله برای رخداد مهم حل‌شده تا (روز)", type: "int", min: 1, max: 90, default: 5, span: 12 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 12 },
  ],
  unique: [["name"]],
  scope: { public: true },
  list: { columns: ["name", "kde_id", "active"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings

export const KB_CONFIG_DEFAULTS = {
  review_remind_days: 14,
  negative_ratio: 40,
  negative_min_votes: 5,
  trash_days: 30,
  events_days: 400,
  deflection_hours: 72,
  aqi_per_author: 2,
  duplicate_threshold: 80,
  suggest_limit: 5,
  capture_on_resolve: true,
  ack_suggestions: false,
  stale_days: 365,
};
export type KbConfig = typeof KB_CONFIG_DEFAULTS & { default_group_id: string | null; aqi_items: AqiItem[] };

export interface AqiItem {
  key: string;
  label: string;
  weight: number;
}

/** The KCS content standard checklist (weights sum to 100). */
export const DEFAULT_AQI_ITEMS: AqiItem[] = [
  { key: "unique", label: "یکتا است (مقالهٔ تکراری نیست)", weight: 15 },
  { key: "complete", label: "کامل است (مسئله، محیط و راه‌حل)", weight: 15 },
  { key: "clear", label: "روشن و قابل اجراست", weight: 15 },
  { key: "title", label: "عنوان، مسئله را با واژه‌های کاربر می‌گوید", weight: 10 },
  { key: "environment", label: "محیط و علت آمده است", weight: 10 },
  { key: "metadata", label: "فراداده و مخاطب درست است", weight: 10 },
  { key: "links", label: "پیوندها و تصویرها کار می‌کنند", weight: 10 },
  { key: "content_standard", label: "قالب و سبک نگارش رعایت شده است", weight: 15 },
];

const RULES = "قاعده‌ها";

const config: TableDef = {
  key: "kb_config",
  table: "sm_kb_configs",
  label: "تنظیمات دانش",
  plural: "تنظیمات دانش",
  icon: "settings-2",
  module: "knowledge",
  area: "settings",
  description: "یادآوری بازبینی، آستانهٔ بازخورد منفی، سطل بازیافت، سنجش حل بدون درخواست، نمونه‌گیری کیفیت و پیشنهاد مقاله",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات دانش", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "default_group_id", label: "گروه مدیران دانش", type: "group", span: 12, section: RULES, help: "کارهای بدون مالک (کمبود دانش، مقاله‌های بی‌گروه) به این گروه می‌رسند" },
    { name: "review_remind_days", label: "یادآوری بازبینی پیش از موعد (روز)", type: "int", min: 0, max: 120, default: KB_CONFIG_DEFAULTS.review_remind_days, span: 8, section: RULES },
    { name: "negative_ratio", label: "آستانهٔ بازخورد منفی (درصد)", type: "int", min: 1, max: 100, default: KB_CONFIG_DEFAULTS.negative_ratio, span: 8, section: RULES },
    { name: "negative_min_votes", label: "حداقل رأی برای آستانه", type: "int", min: 1, max: 1000, default: KB_CONFIG_DEFAULTS.negative_min_votes, span: 8, section: RULES },
    { name: "trash_days", label: "نگهداری در سطل بازیافت (روز)", type: "int", min: 1, max: 365, default: KB_CONFIG_DEFAULTS.trash_days, span: 8, section: RULES },
    { name: "events_days", label: "نگهداری رویدادهای دانش (روز)", type: "int", min: 30, max: 3650, default: KB_CONFIG_DEFAULTS.events_days, span: 8, section: RULES },
    { name: "deflection_hours", label: "پنجرهٔ سنجش حل بدون درخواست (ساعت)", type: "int", min: 1, max: 336, default: KB_CONFIG_DEFAULTS.deflection_hours, span: 8, section: RULES },
    { name: "aqi_per_author", label: "نمونه‌های ارزیابی کیفیت هر نویسنده در ماه", type: "int", min: 0, max: 20, default: KB_CONFIG_DEFAULTS.aqi_per_author, span: 8, section: RULES, help: "صفر: نمونه‌گیری خودکار نمی‌شود" },
    { name: "aqi_items", label: "چک‌لیست کیفیت", type: "json", default: DEFAULT_AQI_ITEMS, span: 24, section: RULES },
    { name: "duplicate_threshold", label: "آستانهٔ شباهت تکراری (درصد)", type: "int", min: 50, max: 100, default: KB_CONFIG_DEFAULTS.duplicate_threshold, span: 8, section: RULES },
    { name: "suggest_limit", label: "پیشنهادهای کنار رکورد", type: "int", min: 1, max: 20, default: KB_CONFIG_DEFAULTS.suggest_limit, span: 8, section: RULES },
    { name: "stale_days", label: "مقالهٔ بی‌استفاده پس از (روز)", type: "int", min: 30, max: 3650, default: KB_CONFIG_DEFAULTS.stale_days, span: 8, section: RULES },
    { name: "capture_on_resolve", label: "کار نوشتن مقاله وقتی «ساخت مقالهٔ دانش» زده شده است", type: "bool", default: true, span: 12, section: RULES },
    { name: "ack_suggestions", label: "پیشنهاد مقاله در پاسخ خودکار رخداد تازه", type: "bool", default: false, span: 12, section: RULES },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  form: { sections: [MAIN, RULES] },
  list: { columns: ["name", "review_remind_days", "trash_days"], order: "name" },
};

export const KNOWLEDGE_TABLES: TableDef[] = [
  base, category, article, version, template, feedback, kbTask, snippet, block, glossary, subscription, attestation, ack, licence, qualityReview, gap, duplicate,
  searchRule, tree, domain, config,
];
