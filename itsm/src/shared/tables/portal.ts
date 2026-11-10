// Tables of the self-service portal and its channels (docs/modules/portal_FA.md, catalogue
// docs/catalog/g4_requests.md «Module: portal»): what requesters see and use, and what feeds them.
//
//   · portal              a portal per workspace (the default one for everyone else): branding (title, accent, logo,
//                         footer), the privacy notice of forms and chat, the assistant switch and the home page's
//                         widgets — a draft layout and its published copy with a version (PTL-002/003/004)
//   · portal_link         quick links (the app launcher, PTL-049) with an audience
//   · portal_topic        the requester's topic tree (PTL-005): catalogue items, articles and links under a topic
//   · portal_pref         one row per person: favourite catalogue items (PTL-008)
//   · portal_kb_publication  knowledge bases published without sign-in (KB-031): a secret link per publication
//   · portal_feedback     complaints, compliments, suggestions and privacy requests (PTL-041/042), worked by the desk
//   · survey, survey_question, survey_trigger, survey_invitation, survey_response — CSAT/CES/NPS/XLA and pulse
//                         surveys (PTL-038…040): definitions, when they are sent, the invitations (signed, single-use
//                         links) and the answers, anonymous ones without respondent, invitation or record
//   · portal_channel, portal_channel_identity, portal_link_code — messaging connectors (Telegram, Bale, a generic
//                         webhook; PTL-019/022): web version only (the public endpoints live there), chat users mapped
//                         to members only through a one-time code
//   · portal_widget       the website widget (PTL-025): allowed origins, what guests may search
// The portal's analytics stream (searches, answers, deflections, widget and public pages; PTL-050) and the messaging
// connectors' delivery log are local runtime tables (migration 0067_portal: sm_portal_events, sm_portal_channel_log), and
// so are anonymous survey answers waiting to be written in a batch (0070_portal_surveys: sm_survey_held).
//
// Access (docs/spec/ACCESS.md): definitions live in the areas of what they are about — the portal's look and its
// content in `catalog` (requesters read the catalogue; the portal's routes read these rows as the system and filter
// them by audience), surveys in `survey` (requesters own their invitations and answers, agents read those of their
// group's records, the service desk manager all), feedback in `request` (the desk works it; complaints and privacy
// requests are confidential: the group, the submitter and the access list only), connectors and the widget in
// `integrations`, public knowledge in `knowledge`. Rows written only by the module (invitations, responses,
// identities, codes) are guarded by its hooks.
// Imported by the UI: keep it free of server imports.
import { NEVER } from "../model/conditions";
import { AUDIENCE_COND } from "../portal/logic";
import type { FieldDef, Option, StateModel, TableDef } from "../model/types";
import { TASK_SCOPE } from "../model/task";
import { hideTaskFields } from "./incident";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

export const HERO_STYLES: Option[] = [
  { value: "calm", label: "آرام (رنگ ملایم)", order: 1 },
  { value: "bold", label: "پررنگ (رنگ برند)", order: 2 },
  { value: "plain", label: "ساده (بدون پس‌زمینه)", order: 3 },
];

export const FEEDBACK_KINDS: Option[] = [
  { value: "complaint", label: "شکایت", color: "red", order: 1 },
  { value: "compliment", label: "قدردانی", color: "green", order: 2 },
  { value: "suggestion", label: "پیشنهاد", color: "blue", order: 3 },
  { value: "privacy", label: "درخواست دربارهٔ داده‌های شخصی", color: "purple", order: 4 },
];

/** Requests about personal data (GDPR Art. 15–21 style rights), for `privacy` feedback. */
export const PRIVACY_RIGHTS: Option[] = [
  { value: "access", label: "دریافت رونوشت داده‌های من", order: 1 },
  { value: "rectify", label: "اصلاح داده‌های نادرست", order: 2 },
  { value: "erase", label: "پاک کردن داده‌های من", order: 3 },
  { value: "object", label: "اعتراض به نحوهٔ استفاده", order: 4 },
];

export const SURVEY_KINDS: Option[] = [
  { value: "csat", label: "رضایت از رسیدگی (CSAT)", color: "green", order: 1 },
  { value: "ces", label: "آسانی کار (CES)", color: "teal", order: 2 },
  { value: "nps", label: "احتمال توصیه (NPS)", color: "blue", order: 3 },
  { value: "xla", label: "تجربهٔ کاربر (شادی و زمان ازدست‌رفته)", color: "purple", order: 4 },
  { value: "pulse", label: "نظرسنجی دوره‌ای سازمان", color: "gold", order: 5 },
  { value: "custom", label: "دلخواه", color: "gray", order: 6 },
];

export const QUESTION_KINDS: Option[] = [
  { value: "rating", label: "امتیاز ۱ تا ۵ (ستاره)", order: 1 },
  { value: "faces", label: "چهره‌ها (۱ تا ۵)", order: 2 },
  { value: "nps", label: "۰ تا ۱۰ (احتمال توصیه)", order: 3 },
  { value: "ces", label: "۱ تا ۷ (آسانی)", order: 4 },
  { value: "scale10", label: "۰ تا ۱۰ (دلخواه)", order: 5 },
  { value: "choice", label: "یک گزینه", order: 6 },
  { value: "multi", label: "چند گزینه", order: 7 },
  { value: "yes_no", label: "بله یا خیر", order: 8 },
  { value: "minutes", label: "زمان (دقیقه)", order: 9 },
  { value: "text", label: "متن آزاد", order: 10 },
];

export const QUESTION_METRICS: Option[] = [
  { value: "none", label: "—", order: 1 },
  { value: "csat", label: "رضایت (CSAT)", order: 2 },
  { value: "ces", label: "آسانی (CES)", order: 3 },
  { value: "nps", label: "توصیه (NPS)", order: 4 },
  { value: "happiness", label: "شادی (XLA)", order: 5 },
  { value: "lost_time", label: "زمان ازدست‌رفته (XLA)", order: 6 },
];

export const TRIGGER_MOMENTS: Option[] = [
  { value: "resolved", label: "وقتی حل شد", order: 1 },
  { value: "closed", label: "وقتی بسته شد", order: 2 },
];

export const INVITATION_STATES: Option[] = [
  { value: "pending", label: "در انتظار پاسخ", color: "gold", order: 1 },
  { value: "answered", label: "پاسخ داده شد", color: "green", order: 2 },
  { value: "expired", label: "منقضی شد", color: "gray", order: 3 },
  { value: "canceled", label: "لغو شد", color: "gray", order: 4 },
];

export const RESPONSE_CHANNELS: Option[] = [
  { value: "portal", label: "درگاه", order: 1 },
  { value: "email", label: "پیوند ایمیل", order: 2 },
  { value: "chat", label: "دستیار مجازی", order: 3 },
  { value: "messenger", label: "پیام‌رسان", order: 4 },
];

export const NOTIFY_WAYS: Option[] = [
  { value: "in_app", label: "اعلان درون‌برنامه", order: 1 },
  { value: "email", label: "ایمیل", order: 2 },
];

export const CHANNEL_KINDS: Option[] = [
  { value: "telegram", label: "ربات تلگرام", color: "blue", order: 1 },
  { value: "bale", label: "ربات بله", color: "green", order: 2 },
  { value: "webhook", label: "وب‌هوک عمومی (پیامک، ایتا، روبیکا…)", color: "gray", order: 3 },
];

export const CHANNEL_AUTH: Option[] = [
  { value: "header", label: "راز در سرآیند (X-Telegram-Bot-Api-Secret-Token)", order: 1 },
  { value: "hmac", label: "امضای HMAC-SHA256 بدنه (X-Signature-256)", order: 2 },
  { value: "path", label: "فقط کلید نشانی (کم‌امن‌تر)", order: 3 },
];

/** Outcomes of a messaging connector's deliveries (sm_portal_channel_log). */
export const MESSAGE_STATUSES: Option[] = [
  { value: "received", label: "دریافت شد", color: "blue", order: 1 },
  { value: "replied", label: "پاسخ داده شد", color: "green", order: 2 },
  { value: "linked", label: "حساب وصل شد", color: "green", order: 3 },
  { value: "unlinked", label: "حساب وصل نیست", color: "gold", order: 4 },
  { value: "ignored", label: "نادیده گرفته شد", color: "gray", order: 5 },
  { value: "rate_limited", label: "بیش از اندازه", color: "orange", order: 6 },
  { value: "duplicate", label: "تکراری", color: "gray", order: 7 },
  { value: "failed", label: "ناموفق", color: "red", order: 8 },
  { value: "sent", label: "ارسال شد", color: "teal", order: 9 },
];

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

const MAIN = "اصلی";
const AUDIENCE = "مخاطبان";
const LOOK = "ظاهر";
const BEHAVIOUR = "رفتار";
const sys = { system: true, hidden: true, audit: false } as const;

/** The audience of a piece of portal content: nobody named = everyone; units reach their sub-units, locations theirs. */
const audienceFields = (section = AUDIENCE): FieldDef[] => [
  { name: "aud_units", label: "واحدهای سازمانی (با زیرمجموعه‌ها)", type: "refs", ref: "org_unit", span: 12, section },
  { name: "aud_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12, section },
  { name: "aud_locations", label: "مکان‌ها", type: "refs", ref: "location", span: 12, section },
  { name: "aud_users", label: "افراد", type: "users", span: 12, section },
];

/** Fields of the audience (the portal's routes test them with the reader's context: `audienceCond`). */
export const AUDIENCE_FIELDS = ["aud_units", "aud_groups", "aud_locations", "aud_users"] as const;

// ---------------------------------------------------------------------------------------------------------------
// The portal: branding, behaviour and the home page of a workspace

const portal: TableDef = {
  key: "portal",
  table: "sm_portals",
  label: "درگاه",
  plural: "درگاه‌ها",
  icon: "store",
  module: "portal",
  area: "catalog",
  description: "ظاهر، صفحهٔ اول و رفتار درگاه سلف‌سرویس برای یک فضای کاری؛ درگاهِ بدون فضای کاری برای همهٔ کاربران است",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6, section: MAIN, help: "وقتی چند درگاه برای کسی هست، کوچک‌تر اول می‌آید" },
    { name: "title", label: "عنوان صفحهٔ اول", type: "string", maxLength: 120, default: "چه کمکی از ما برمی‌آید؟", span: 12, section: LOOK },
    { name: "subtitle", label: "زیرعنوان", type: "string", maxLength: 200, default: "پرسش، درخواست یا مشکلتان را بنویسید", span: 12, section: LOOK },
    { name: "brand_name", label: "نام کوتاه سربرگ", type: "string", maxLength: 60, span: 8, section: LOOK, help: "خالی: نام سازمان" },
    { name: "accent", label: "رنگ برند", type: "color", default: "indigo", span: 8, section: LOOK },
    { name: "hero", label: "سبک سربرگ", type: "choice", choices: HERO_STYLES, default: "calm", span: 8, section: LOOK },
    { name: "logo_id", label: "نشان (پیوست تصویر)", type: "string", maxLength: 36, ltr: true, hidden: true, span: 12, section: LOOK },
    { name: "footer", label: "پانویس (راه‌های تماس)", type: "markdown", span: 24, section: LOOK },
    { name: "privacy_notice", label: "متن حریم خصوصی فرم‌ها و گفتگو", type: "markdown", span: 24, section: BEHAVIOUR, help: "زیر فرم‌های ثبت مشکل، بازخورد و گفتگو نشان داده می‌شود" },
    { name: "chat_enabled", label: "دستیار مجازی در درگاه", type: "bool", default: true, span: 8, section: BEHAVIOUR },
    { name: "chat_name", label: "نام دستیار", type: "string", maxLength: 40, default: "دستیار", span: 8, section: BEHAVIOUR },
    { name: "ai_answers", label: "پاسخ هوشمند بالای نتیجه‌های جست‌وجو", type: "bool", default: true, span: 8, section: BEHAVIOUR },
    { name: "report_item_id", label: "قلم کاتالوگ «گزارش مشکل»", type: "ref", ref: "catalog_item", span: 12, section: BEHAVIOUR, help: "خالی: فرم سادهٔ گزارش مشکل درگاه (رخداد)" },
    { name: "layout", label: "چیدمان صفحهٔ اول (پیش‌نویس)", type: "json", hidden: true },
    { name: "published_layout", label: "چیدمان منتشرشده", type: "json", ...sys },
    { name: "layout_version", label: "نسخهٔ چیدمان", type: "int", default: 0, readonly: true, audit: false, span: 8, section: BEHAVIOUR },
    { name: "published_at", label: "زمان انتشار چیدمان", type: "datetime", readonly: true, audit: false, span: 8, section: BEHAVIOUR },
    { name: "published_by", label: "منتشرکنندهٔ چیدمان", type: "user", readonly: true, audit: false, span: 8, section: BEHAVIOUR },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, hidden: true, default: 0 },
  ],
  // read with the catalogue's grant and the workspace rule (a workspace's portal is its members'); the portal module
  // reads the portals itself, and the draft layout shows only to those who run the portal (hook redactRows)
  scope: {},
  features: { attachments: true },
  form: { sections: [MAIN, LOOK, BEHAVIOUR] },
  list: { columns: ["name", "workspace_id", "active", "accent", "layout_version", "updated_at"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Quick links and topics

const link: TableDef = {
  key: "portal_link",
  table: "sm_portal_links",
  label: "پیوند سریع",
  plural: "پیوندهای سریع",
  icon: "link",
  module: "portal",
  area: "catalog",
  description: "برنامه‌ها و سامانه‌هایی که کاربران از صفحهٔ اول درگاه با یک کلیک باز می‌کنند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "url", label: "نشانی", type: "url", required: true, ltr: true, list: true, span: 12, section: MAIN },
    { name: "description", label: "شرح کوتاه", type: "string", maxLength: 200, search: true, span: 24, section: MAIN },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, default: "link", span: 8, section: MAIN, help: "نام یک نماد lucide، مثل mail یا calendar" },
    { name: "section_name", label: "دسته", type: "string", maxLength: 60, list: true, filter: true, span: 8, section: MAIN },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8, section: MAIN },
    { name: "new_tab", label: "در زبانهٔ تازه", type: "bool", default: true, span: 8, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8, section: MAIN },
    ...audienceFields(),
  ],
  scope: { public: true },
  // the record API, search and Windows replicas hold to the audience too (the portal's routes test the same rule);
  // whoever manages the catalogue's content sees every link
  rowAccess: { read: AUDIENCE_COND, managersReadAll: true },
  form: { sections: [MAIN, AUDIENCE] },
  list: { columns: ["name", "url", "section_name", "active", "sort_order"], order: "sort_order,name" },
};

const topic: TableDef = {
  key: "portal_topic",
  table: "sm_portal_topics",
  label: "موضوع درگاه",
  plural: "موضوع‌های درگاه",
  icon: "folder-tree",
  module: "portal",
  area: "catalog",
  description: "درخت موضوع‌هایی که کاربر می‌شناسد (مثلاً «رایانه و چاپگر»)، با قلم‌های کاتالوگ، مقاله‌ها و پیوندهای هر موضوع",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "parent_id", label: "موضوع بالاتر", type: "ref", ref: "$self", list: true, filter: true, index: true, span: 12, section: MAIN },
    { name: "description", label: "شرح", type: "string", maxLength: 300, search: true, span: 24, section: MAIN },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, default: "folder", span: 8, section: MAIN },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8, section: MAIN },
    { name: "items", label: "قلم‌های کاتالوگ", type: "refs", ref: "catalog_item", span: 24, section: "محتوا" },
    { name: "articles", label: "مقاله‌های دانش", type: "refs", ref: "kb_article", span: 24, section: "محتوا" },
    { name: "links", label: "پیوندهای سریع", type: "refs", ref: "portal_link", span: 24, section: "محتوا" },
    ...audienceFields(),
  ],
  scope: { public: true },
  rowAccess: { read: AUDIENCE_COND, managersReadAll: true },
  form: { sections: [MAIN, "محتوا", AUDIENCE] },
  list: { columns: ["name", "parent_id", "active", "sort_order"], order: "sort_order,name" },
};

const pref: TableDef = {
  key: "portal_pref",
  table: "sm_portal_prefs",
  label: "ترجیح درگاه",
  plural: "ترجیح‌های درگاه",
  icon: "star",
  module: "portal",
  area: "work",
  description: "قلم‌های برگزیدهٔ هر کس در کاتالوگ درگاه",
  display: "user_id",
  fields: [
    { name: "user_id", label: "کاربر", type: "user", required: true, default: "$me", readonly: true, unique: true, list: true, index: true, span: 12 },
    { name: "favorites", label: "قلم‌های برگزیده", type: "refs", ref: "catalog_item", readonly: true, span: 24 },
    { name: "portal_id", label: "درگاه انتخابی", type: "ref", ref: "portal", readonly: true, span: 12 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"], requesterWritable: [] },
  rowAccess: { read: { f: "user_id", op: "is_me" }, write: { f: "user_id", op: "is_me" } },
  features: { history: false },
  list: { columns: ["user_id", "updated_at"], order: "-updated_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Public knowledge (KB-031)

const kbPublication: TableDef = {
  key: "portal_kb_publication",
  table: "sm_portal_kb_publications",
  label: "انتشار عمومی دانش",
  plural: "انتشارهای عمومی دانش",
  icon: "globe",
  module: "portal",
  area: "knowledge",
  description: "پایگاه‌های دانشی که بدون ورود با پیوند محرمانه خوانده می‌شوند: فقط مقاله‌های منتشرشده و «عمومی» بدون محدودیت مخاطب",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "active", label: "منتشرشده", type: "bool", default: false, readonly: true, list: true, filter: true, span: 6, section: MAIN, help: "با «انتشار عمومی» در صفحهٔ دانش عمومی روشن و خاموش می‌شود" },
    { name: "allow_feedback", label: "«مفید بود؟» برای خوانندگان", type: "bool", default: true, span: 6, section: MAIN },
    { name: "bases", label: "پایگاه‌های دانش", type: "refs", ref: "kb_base", required: true, span: 24, section: MAIN, help: "فقط پایگاه‌های بیرونی با خوانندگان «همه»؛ از هر پایگاه فقط مقاله‌های منتشرشده با طبقه‌بندی «عمومی»" },
    { name: "title", label: "عنوان صفحه", type: "string", maxLength: 120, default: "مرکز راهنما", span: 12, section: MAIN },
    { name: "intro", label: "متن آغاز صفحه", type: "markdown", span: 24, section: MAIN },
    { name: "token", label: "کلید پیوند", type: "string", maxLength: 80, ltr: true, ...sys, group: "admin", index: true },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, audit: false, list: true, span: 8, section: MAIN },
    { name: "published_by", label: "منتشرکننده", type: "user", readonly: true, audit: false, span: 8, section: MAIN },
  ],
  scope: {},
  list: { columns: ["name", "active", "published_at", "updated_at"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Complaints, compliments, suggestions and privacy requests (PTL-041, PTL-042)

export const FEEDBACK_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "تازه", category: "new", color: "blue" },
    { value: "in_review", label: "در حال بررسی", category: "active", color: "teal" },
    { value: "awaiting_requester", label: "منتظر ثبت‌کننده", category: "waiting", color: "gold" },
    { value: "responded", label: "پاسخ داده شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "withdrawn", label: "پس گرفته شد", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new", "awaiting_requester"], to: "in_review", label: "بررسی" },
    { from: ["new", "in_review"], to: "awaiting_requester", label: "پرسش از ثبت‌کننده" },
    { from: ["new", "in_review", "awaiting_requester"], to: "responded", label: "پاسخ داده شد", requires: ["response"] },
    { from: ["responded"], to: "closed", label: "بستن" },
    { from: ["responded"], to: "in_review", label: "بازگشایی" },
    { from: ["new", "in_review", "awaiting_requester"], to: "withdrawn", label: "پس گرفتن" },
  ],
  locked: ["closed", "canceled"],
};

const FEEDBACK_HIDDEN = ["impact", "urgency", "ci_id", "offering_id", "parent_id", "escalation", "approval", "knowledge", "time_worked", "close_code", "category", "subcategory"];

const feedback: TableDef = {
  key: "portal_feedback",
  table: "sm_portal_feedback",
  label: "بازخورد",
  plural: "بازخوردها",
  icon: "message-square-heart",
  module: "portal",
  area: "request",
  description: "شکایت، قدردانی، پیشنهاد یا درخواست دربارهٔ داده‌های شخصی؛ جدا از رخدادها و با پاسخ رسمی به ثبت‌کننده",
  extends: "task",
  numbered: { prefix: "FBK", pad: 6 },
  display: "short_description",
  fields: [
    ...hideTaskFields(FEEDBACK_HIDDEN),
    { name: "kind", label: "نوع", type: "choice", choices: FEEDBACK_KINDS, default: "complaint", required: true, list: true, filter: true, span: 8 },
    { name: "privacy_right", label: "درخواست دربارهٔ داده‌ها", type: "choice", choices: PRIVACY_RIGHTS, filter: true, span: 8 },
    { name: "channel", label: "مجرای دریافت", type: "choice", choices: "incident.channel", default: "portal", span: 8 },
    { name: "response", label: "پاسخ رسمی به ثبت‌کننده", type: "markdown", span: 24, help: "ثبت‌کننده آن را در درگاه می‌بیند" },
    { name: "acknowledged_at", label: "زمان اعلام دریافت", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "responded_at", label: "زمان پاسخ", type: "datetime", readonly: true, sort: true, span: 8 },
  ],
  states: FEEDBACK_STATES,
  scope: {
    ...TASK_SCOPE,
    requesterWritable: ["description", "watch_list"],
    requesterTransitions: [
      { from: ["new", "in_review", "awaiting_requester"], to: "withdrawn" },
      { from: ["responded"], to: "closed" },
      { from: ["responded"], to: "in_review" },
      { from: ["awaiting_requester"], to: "in_review" },
    ],
  },
  features: { sla: true, confidential: true },
  list: { columns: ["number", "short_description", "kind", "state", "caller_id", "assignment_group_id", "assigned_to", "opened_at"], order: "-opened_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Surveys (PTL-038…040)

const SURVEY_SECTION = "نظرسنجی";
const SEND = "ارسال";

const survey: TableDef = {
  key: "survey",
  table: "sm_surveys",
  label: "نظرسنجی",
  plural: "نظرسنجی‌ها",
  icon: "clipboard-check",
  module: "portal",
  area: "survey",
  description: "پرسش‌های یک نظرسنجی (رضایت، آسانی، توصیه، تجربه یا دوره‌ای) و اینکه پاسخ‌ها بی‌نام ذخیره شوند یا نه",
  numbered: { prefix: "SRV", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12, section: SURVEY_SECTION },
    { name: "kind", label: "نوع", type: "choice", choices: SURVEY_KINDS, default: "csat", required: true, list: true, filter: true, span: 6, section: SURVEY_SECTION },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: SURVEY_SECTION },
    { name: "intro", label: "متن آغاز", type: "markdown", span: 24, section: SURVEY_SECTION },
    { name: "thanks", label: "متن پایان", type: "string", maxLength: 300, default: "از وقتی که گذاشتید سپاسگزاریم.", span: 24, section: SURVEY_SECTION },
    { name: "anonymous", label: "پاسخ‌ها بی‌نام ذخیره شوند", type: "bool", default: false, filter: true, span: 8, section: SURVEY_SECTION, help: "پاسخ بی‌نام نه پاسخ‌دهنده را نگه می‌دارد نه رکورد و دعوت‌نامه را" },
    { name: "expires_days", label: "اعتبار دعوت (روز)", type: "int", min: 1, max: 365, default: 14, span: 8, section: SURVEY_SECTION },
    { name: "owner_group_id", label: "گروه مالک", type: "group", filter: true, index: true, span: 8, section: SURVEY_SECTION },
    { name: "satisfied_from", label: "راضی از امتیاز", type: "int", min: 1, max: 5, default: 4, span: 8, section: SURVEY_SECTION, help: "CSAT = پاسخ‌های با این امتیاز یا بیشتر ÷ همهٔ پاسخ‌ها" },
    ...audienceFields(SEND),
    { name: "sent_at", label: "آخرین ارسال به مخاطبان", type: "datetime", readonly: true, audit: false, span: 8, section: SEND },
    { name: "sent_count", label: "دعوت‌های ارسالی", type: "int", default: 0, readonly: true, audit: false, list: true, span: 8, section: SEND },
    { name: "response_count", label: "پاسخ‌ها", type: "int", default: 0, readonly: true, audit: false, list: true, span: 8, section: SEND },
  ],
  scope: { group: "owner_group_id" },
  form: {
    sections: [SURVEY_SECTION, SEND],
    related: [
      { table: "survey_question", field: "survey_id", label: "پرسش‌ها", columns: ["sort_order", "label", "kind", "metric", "required"] },
      { table: "survey_trigger", field: "survey_id", label: "زمان ارسال", columns: ["name", "table_key", "fire_on", "sample_pct", "active"] },
    ],
  },
  list: { columns: ["number", "name", "kind", "active", "anonymous", "sent_count", "response_count"], order: "name" },
};

const question: TableDef = {
  key: "survey_question",
  table: "sm_survey_questions",
  label: "پرسش نظرسنجی",
  plural: "پرسش‌های نظرسنجی",
  icon: "list-checks",
  module: "portal",
  area: "survey",
  display: "label",
  fields: [
    { name: "survey_id", label: "نظرسنجی", type: "ref", ref: "survey", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 10, list: true, sort: true, span: 6 },
    { name: "required", label: "اجباری", type: "bool", default: false, list: true, span: 6 },
    { name: "label", label: "پرسش", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "kind", label: "نوع پاسخ", type: "choice", choices: QUESTION_KINDS, default: "rating", required: true, list: true, filter: true, span: 12 },
    { name: "metric", label: "شاخص", type: "choice", choices: QUESTION_METRICS, default: "none", list: true, filter: true, span: 12, help: "هر نظرسنجی برای هر شاخص یک پرسش دارد" },
    { name: "options", label: "گزینه‌ها", type: "tags", span: 24, help: "برای «یک گزینه» و «چند گزینه»" },
    { name: "help", label: "راهنمای کوتاه", type: "string", maxLength: 200, span: 24 },
  ],
  // parent-scoped (ACCESS §7): read only by those who may read its survey
  scope: { parent: "survey_id" },
  list: { columns: ["survey_id", "sort_order", "label", "kind", "metric", "required"], order: "survey_id,sort_order" },
};

const trigger: TableDef = {
  key: "survey_trigger",
  table: "sm_survey_triggers",
  label: "زمان ارسال نظرسنجی",
  plural: "زمان‌های ارسال نظرسنجی",
  icon: "send",
  module: "portal",
  area: "survey",
  description: "کدام رکوردها، وقتی حل یا بسته شدند، برای درخواست‌کننده‌شان نظرسنجی می‌فرستند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "survey_id", label: "نظرسنجی", type: "ref", ref: "survey", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, ltr: true, list: true, filter: true, span: 8, help: "کلید جدول، مثل incident یا request_item" },
    { name: "fire_on", label: "زمان ارسال", type: "choice", choices: TRIGGER_MOMENTS, default: "resolved", required: true, list: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "condition", label: "فقط رکوردهایی که", type: "conditions", condTableField: "table_key", span: 24 },
    { name: "sample_pct", label: "درصد نمونه", type: "int", min: 1, max: 100, default: 100, list: true, span: 8, help: "از رکوردهای واجد شرط، این درصد نظرسنجی می‌گیرند" },
    { name: "cooldown_days", label: "فاصلهٔ دو نظرسنجی برای یک نفر (روز)", type: "int", min: 0, max: 365, default: 7, span: 8 },
    { name: "channels", label: "راه دعوت", type: "multichoice", choices: NOTIFY_WAYS, default: ["in_app", "email"], span: 8 },
  ],
  // parent-scoped (ACCESS §7): read only by those who may read its survey
  scope: { parent: "survey_id" },
  list: { columns: ["name", "survey_id", "table_key", "fire_on", "sample_pct", "active"], order: "name" },
};

const invitation: TableDef = {
  key: "survey_invitation",
  table: "sm_survey_invitations",
  label: "دعوت به نظرسنجی",
  plural: "دعوت‌های نظرسنجی",
  icon: "mail-question",
  module: "portal",
  area: "survey",
  description: "دعوت یک نفر به نظرسنجی دربارهٔ یک رکورد (یا در ارسال همگانی)، با پیوند امضاشدهٔ یک‌بارمصرف",
  numbered: { prefix: "SVI", pad: 7 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", maxLength: 250, readonly: true, list: true, search: true, span: 24 },
    { name: "survey_id", label: "نظرسنجی", type: "ref", ref: "survey", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "trigger_id", label: "زمان ارسال", type: "ref", ref: "survey_trigger", readonly: true, filter: true, span: 12 },
    { name: "user_id", label: "دعوت‌شده", type: "user", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "group_id", label: "گروه رکورد", type: "group", readonly: true, filter: true, index: true, span: 12 },
    { name: "table_key", label: "جدول رکورد", type: "string", maxLength: 60, ltr: true, readonly: true, filter: true, span: 8 },
    { name: "record_id", label: "رکورد", type: "string", maxLength: 36, ltr: true, readonly: true, index: true, hidden: true },
    { name: "record_number", label: "شمارهٔ رکورد", type: "string", maxLength: 40, ltr: true, readonly: true, list: true, search: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: INVITATION_STATES, default: "pending", readonly: true, list: true, filter: true, span: 8 },
    { name: "sent_at", label: "زمان دعوت", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "expires_at", label: "مهلت پاسخ", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "answered_at", label: "زمان پاسخ", type: "datetime", readonly: true, sort: true, span: 8 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"], group: "group_id", requesterWritable: [], requesterTransitions: [] },
  features: { history: false },
  list: { columns: ["number", "title", "user_id", "status", "sent_at", "answered_at"], order: "-sent_at" },
};

const response: TableDef = {
  key: "survey_response",
  table: "sm_survey_responses",
  label: "پاسخ نظرسنجی",
  plural: "پاسخ‌های نظرسنجی",
  icon: "message-square-quote",
  module: "portal",
  area: "survey",
  description: "پاسخ یک نفر به یک نظرسنجی با شاخص‌های محاسبه‌شده؛ پاسخ بی‌نام نه نام دارد نه رکورد",
  numbered: { prefix: "SVR", pad: 7 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", maxLength: 250, readonly: true, list: true, search: true, span: 24 },
    { name: "survey_id", label: "نظرسنجی", type: "ref", ref: "survey", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    // one response per invitation (also under concurrent answers); anonymous responses name none
    { name: "invitation_id", label: "دعوت", type: "ref", ref: "survey_invitation", readonly: true, unique: true, span: 12 },
    { name: "respondent_id", label: "پاسخ‌دهنده", type: "user", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "group_id", label: "گروه رکورد", type: "group", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "table_key", label: "جدول رکورد", type: "string", maxLength: 60, ltr: true, readonly: true, filter: true, span: 8 },
    { name: "record_id", label: "رکورد", type: "string", maxLength: 36, ltr: true, readonly: true, index: true, hidden: true },
    { name: "record_number", label: "شمارهٔ رکورد", type: "string", maxLength: 40, ltr: true, readonly: true, list: true, search: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", readonly: true, filter: true, span: 8 },
    { name: "channel", label: "مجرا", type: "choice", choices: RESPONSE_CHANNELS, readonly: true, filter: true, span: 8 },
    { name: "answers", label: "پاسخ‌ها", type: "json", readonly: true },
    { name: "csat", label: "رضایت (۱ تا ۵)", type: "int", min: 1, max: 5, readonly: true, list: true, filter: true, sort: true, span: 6 },
    { name: "satisfied", label: "راضی", type: "bool", readonly: true, default: false, filter: true, span: 6 },
    { name: "nps", label: "توصیه (۰ تا ۱۰)", type: "int", min: 0, max: 10, readonly: true, filter: true, sort: true, span: 6 },
    { name: "ces", label: "آسانی (۱ تا ۷)", type: "int", min: 1, max: 7, readonly: true, filter: true, sort: true, span: 6 },
    { name: "happiness", label: "شادی (۰ تا ۱۰)", type: "int", min: 0, max: 10, readonly: true, filter: true, sort: true, span: 6 },
    { name: "lost_minutes", label: "زمان ازدست‌رفته (دقیقه)", type: "int", min: 0, max: 100000, readonly: true, sort: true, span: 6 },
    { name: "score", label: "امتیاز (۰ تا ۱۰۰)", type: "int", min: 0, max: 100, readonly: true, list: true, sort: true, span: 6 },
    { name: "comment", label: "نظر", type: "text", maxLength: 4000, readonly: true, list: true, search: true, span: 24 },
    { name: "submitted_at", label: "زمان پاسخ", type: "datetime", readonly: true, list: true, sort: true, filter: true, span: 8 },
  ],
  scope: { own: ["respondent_id"], requester: ["respondent_id"], group: "group_id", requesterWritable: [], requesterTransitions: [] },
  features: { history: false },
  list: { columns: ["number", "title", "csat", "score", "comment", "submitted_at"], order: "-submitted_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Messaging connectors (web version only: their webhooks reach the web version's public address)

const CONNECT = "اتصال";

const channel: TableDef = {
  key: "portal_channel",
  table: "sm_portal_channels",
  label: "کانال پیام‌رسان",
  plural: "کانال‌های پیام‌رسان",
  icon: "send",
  module: "portal",
  area: "integrations",
  description: "ربات تلگرام یا بله یا وب‌هوک عمومی که پیام‌های کاربران را به دستیار مجازی و درخواست‌ها می‌رساند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "kind", label: "نوع", type: "choice", choices: CHANNEL_KINDS, default: "telegram", required: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "bot_username", label: "نام کاربری ربات", type: "string", maxLength: 64, ltr: true, span: 12, section: MAIN, help: "بدون @؛ برای پیوند مستقیم اتصال حساب" },
    { name: "welcome", label: "پیام خوش‌آمد", type: "text", maxLength: 1000, span: 24, section: MAIN },
    { name: "allow_groups", label: "پاسخ در گروه‌ها", type: "bool", default: false, span: 8, section: MAIN, help: "خاموش: پیام‌های گروه‌ها نادیده گرفته می‌شوند" },
    { name: "rate_per_minute", label: "سقف پیام هر گفتگو در دقیقه", type: "int", min: 1, max: 120, default: 12, span: 8, section: MAIN },
    { name: "token", label: "توکن ربات", type: "secret", span: 12, section: CONNECT, help: "برای پاسخ دادن؛ از BotFather تلگرام یا پنل بله" },
    { name: "outbound_url", label: "نشانی ارسال پاسخ (وب‌هوک عمومی)", type: "url", ltr: true, span: 12, section: CONNECT },
    { name: "auth_mode", label: "اثبات درخواست‌ها", type: "choice", choices: CHANNEL_AUTH, default: "header", required: true, span: 12, section: CONNECT },
    { name: "secret", label: "راز وب‌هوک", type: "secret", system: true, span: 12, section: CONNECT },
    { name: "hook_key", label: "کلید نشانی وب‌هوک", type: "string", maxLength: 80, ltr: true, ...sys, index: true },
    { name: "registered_at", label: "ثبت وب‌هوک نزد پیام‌رسان", type: "datetime", readonly: true, audit: false, span: 8, section: CONNECT },
    { name: "last_in_at", label: "آخرین پیام", type: "datetime", readonly: true, audit: false, list: true, span: 8, section: CONNECT },
    { name: "received_count", label: "پیام‌های دریافتی", type: "int", default: 0, readonly: true, audit: false, list: true, span: 8, section: CONNECT },
    { name: "failed_count", label: "خطاها", type: "int", default: 0, readonly: true, audit: false, span: 8, section: CONNECT },
    { name: "last_error", label: "آخرین خطا", type: "string", maxLength: 500, readonly: true, audit: false, span: 24, section: CONNECT },
  ],
  scope: {},
  features: { sync: false },
  form: { sections: [MAIN, CONNECT] },
  list: { columns: ["name", "kind", "active", "last_in_at", "received_count"], order: "name" },
};

const identity: TableDef = {
  key: "portal_channel_identity",
  table: "sm_portal_channel_identities",
  label: "حساب پیام‌رسان",
  plural: "حساب‌های پیام‌رسان",
  icon: "link-2",
  module: "portal",
  area: "integrations",
  description: "حساب پیام‌رسانی که کاربر با کد یک‌بارمصرف به حساب خودش وصل کرده است",
  display: "external_name",
  fields: [
    { name: "channel_id", label: "کانال", type: "ref", ref: "portal_channel", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "کاربر", type: "user", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "external_id", label: "شناسهٔ گفتگو", type: "string", required: true, maxLength: 80, ltr: true, readonly: true, index: true, span: 12 },
    { name: "external_name", label: "نام در پیام‌رسان", type: "string", maxLength: 120, readonly: true, list: true, span: 12 },
    { name: "linked_at", label: "زمان اتصال", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "conversation_id", label: "گفتگوی دستیار", type: "string", maxLength: 36, ltr: true, ...sys },
    { name: "options", label: "گزینه‌های پیام قبلی", type: "json", ...sys },
    { name: "active", label: "فعال", type: "bool", default: true, readonly: true, list: true, filter: true, span: 8 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"], requesterWritable: [], requesterTransitions: [] },
  rowAccess: { read: { f: "user_id", op: "is_me" } },
  features: { sync: false, history: false },
  list: { columns: ["channel_id", "user_id", "external_name", "linked_at", "active"], order: "-linked_at" },
};

const linkCode: TableDef = {
  key: "portal_link_code",
  table: "sm_portal_link_codes",
  label: "کد اتصال پیام‌رسان",
  plural: "کدهای اتصال پیام‌رسان",
  icon: "key-round",
  module: "portal",
  area: "integrations",
  display: "user_id",
  fields: [
    { name: "user_id", label: "کاربر", type: "user", required: true, readonly: true, index: true, span: 12 },
    { name: "code_hash", label: "چکیدهٔ کد", type: "string", required: true, maxLength: 64, ltr: true, ...sys, index: true },
    { name: "expires_at", label: "مهلت", type: "datetime", readonly: true, span: 8 },
    { name: "used_at", label: "زمان استفاده", type: "datetime", readonly: true, span: 8 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  // never through the record API: the codes are the module's (its routes and webhook handler)
  rowAccess: { read: NEVER },
  features: { sync: false, history: false },
  list: { columns: ["user_id", "expires_at", "used_at"], order: "-created_at" },
};

const widget: TableDef = {
  key: "portal_widget",
  table: "sm_portal_widgets",
  label: "ابزارک وب‌سایت",
  plural: "ابزارک‌های وب‌سایت",
  icon: "app-window",
  module: "portal",
  area: "integrations",
  description: "دکمهٔ کمک روی وب‌سایت‌های دیگر: جست‌وجو در دانش عمومی برای مهمان‌ها و گفتگو با دستیار پس از ورود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "accent", label: "رنگ", type: "color", default: "indigo", span: 6, section: MAIN },
    { name: "title", label: "عنوان", type: "string", maxLength: 80, default: "راهنما و پشتیبانی", span: 12, section: MAIN },
    { name: "greeting", label: "پیام آغاز", type: "string", maxLength: 300, default: "سلام! پرسشتان را بنویسید یا با دستیار گفتگو کنید.", span: 12, section: MAIN },
    { name: "allowed_origins", label: "وب‌سایت‌های مجاز", type: "tags", required: true, span: 24, section: MAIN, help: "نشانی کامل هر سایت، مثل https://www.example.com" },
    { name: "publication_id", label: "دانش عمومی برای مهمان‌ها", type: "ref", ref: "portal_kb_publication", span: 12, section: MAIN, help: "خالی: مهمان‌ها جست‌وجو ندارند" },
    { name: "chat", label: "دکمهٔ گفتگو با دستیار (پس از ورود)", type: "bool", default: true, span: 12, section: MAIN },
    { name: "consent", label: "متن رضایت و حریم خصوصی", type: "string", maxLength: 400, span: 24, section: MAIN },
    { name: "widget_key", label: "کلید ابزارک", type: "string", maxLength: 80, ltr: true, ...sys, index: true },
  ],
  scope: {},
  features: { sync: false },
  list: { columns: ["name", "active", "allowed_origins", "updated_at"], order: "name" },
};

export const PORTAL_TABLES: TableDef[] = [
  portal, link, topic, pref, kbPublication, feedback,
  survey, question, trigger, invitation, response,
  channel, identity, linkCode, widget,
];
