// Day-one defaults of knowledge management (Persian, idempotent like the incident module's):
//   · the settings row (it records that the defaults were added) and the group «مدیران دانش» that owns gaps and
//     unassigned knowledge work
//   · three bases: «راهنمای کاربران» (requesters read it; publication approved by the managers), «دانش کارشناسان»
//     (internal, KCS: agents publish just in time) and «خطاهای شناخته‌شده» (internal, the known-error articles)
//   · a category tree for the user guide and the agents' knowledge
//   · the built-in templates (how-to, FAQ, troubleshooting, KCS, known error, policy, reference, release note,
//     decision record, runbook)
//   · approval rules of the approvals service: publishing a version (one approver / all / the majority, as the base
//     says) and retiring an article
//   · the SLA of knowledge tasks (by priority, office hours) and notification rules (a version returned for changes or
//     published, an article retired)
//   · a few glossary terms and the welcome article of the knowledge centre
// Every item is created only when no live row with its natural key exists; once added, a second run adds nothing
// unless forced.
import { FULL_HOURS } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { ensureRow, type SeedCounts } from "../incident";
import { liveRows, sysOf, type Row } from "./common";
import { createArticleIn, publishIn } from "./versions";

export const KNOWLEDGE_SEED_VERSION = 1;

const S = (key: string, label: string, guidance: string, required = false, internal = false) => ({ key, label, guidance, required, internal });

export const BUILTIN_TEMPLATES: Row[] = [
  {
    builtin: "how_to", name: "راهنمای انجام کار", article_type: "how_to", sort_order: 10, description: "انجام یک کار گام‌به‌گام",
    sections: [S("goal", "کار", "این راهنما چه کاری را ممکن می‌کند؟", true), S("before", "پیش از شروع", "دسترسی‌ها و پیش‌نیازها"), S("steps", "گام‌ها", "گام‌های شماره‌دار و قابل بررسی", true), S("result", "نتیجه", "از کجا بفهمیم کار درست انجام شده است؟")],
  },
  { builtin: "faq", name: "پرسش متداول", article_type: "faq", sort_order: 20, description: "یک پرسش و پاسخ کوتاه", sections: [S("question", "پرسش", "پرسش را با واژه‌های کاربر بنویسید", true), S("answer", "پاسخ", "پاسخ کوتاه و دقیق", true)] },
  {
    builtin: "troubleshooting", name: "عیب‌یابی", article_type: "troubleshooting", sort_order: 30, description: "نشانه، بررسی‌ها و راه‌حل",
    sections: [S("symptom", "نشانه‌ها", "کاربر چه می‌بیند؟ پیام خطا را دقیق بنویسید", true), S("checks", "بررسی‌ها", "به ترتیب احتمال"), S("fix", "راه‌حل", "گام‌های شماره‌دار", true), S("escalate", "اگر حل نشد", "به چه گروهی ارجاع شود")],
  },
  {
    builtin: "kcs", name: "راه‌حل (KCS)", article_type: "kcs", sort_order: 40, description: "مسئله، محیط، راه‌حل و علت به روش KCS",
    sections: [S("issue", "مسئله", "با واژه‌های درخواست‌کننده", true), S("environment", "محیط", "خدمت، نرم‌افزار، نسخه، سخت‌افزار", true), S("resolution", "راه‌حل", "گام‌های شماره‌دار", true), S("cause", "علت", "اگر معلوم است"), S("internal", "یادداشت داخلی", "فقط کارشناسان: جزئیات فنی و دسترسی‌ها", false, true)],
  },
  {
    builtin: "known_error", name: "خطای شناخته‌شده", article_type: "known_error", sort_order: 50, description: "نشانه، علت، راه‌حل موقت و وضعیت رفع",
    sections: [S("symptom", "نشانه‌ها", "برای تطبیق رخدادها", true), S("cause", "علت", "علت ریشه‌ای"), S("workaround", "راه‌حل موقت", "گام‌هایی که تا رفع دائمی کمک می‌کند", true), S("fix", "وضعیت رفع", "زمان‌بندی یا تغییر مرتبط")],
  },
  {
    builtin: "policy", name: "خط‌مشی، بخشنامه، دستورالعمل", article_type: "policy", sort_order: 60, description: "سند کنترل‌شده با مرجع، تاریخ اجرا و دامنه",
    sections: [S("purpose", "هدف", "", true), S("scope", "دامنهٔ شمول", "چه کسانی و چه سامانه‌هایی", true), S("rules", "مفاد", "بندهای شماره‌دار", true), S("exceptions", "استثناها", ""), S("references", "مراجع", "قانون، آیین‌نامه یا بخشنامهٔ بالادستی")],
  },
  { builtin: "reference", name: "مرجع", article_type: "reference", sort_order: 70, description: "اطلاعات مرجع (جدول، فهرست، مشخصات)", sections: [S("overview", "شرح", "", true), S("details", "جزئیات", "")] },
  {
    builtin: "release_note", name: "یادداشت انتشار", article_type: "release_note", sort_order: 80, description: "تغییرات یک نسخه برای کاربران",
    sections: [S("what", "چه تغییر کرد", "", true), S("who", "برای چه کسانی", ""), S("action", "کاری که کاربران باید بکنند", ""), S("known", "مشکلات شناخته‌شده", "")],
  },
  { builtin: "decision", name: "سابقهٔ تصمیم", article_type: "decision", sort_order: 90, description: "تصمیم، گزینه‌ها و دلیل", sections: [S("context", "زمینه", "", true), S("decision", "تصمیم", "", true), S("options", "گزینه‌های بررسی‌شده", ""), S("consequences", "پیامدها", "")] },
  {
    builtin: "procedure", name: "رویهٔ اجرایی (Runbook)", article_type: "procedure", sort_order: 100, description: "رویهٔ کارشناسان و عامل‌های هوشمند؛ هرگز به درخواست‌کننده نشان داده نمی‌شود",
    sections: [S("when", "چه زمانی", "شرط به‌کار بستن", true), S("pre", "پیش‌شرط‌ها", "", false), S("steps", "گام‌ها", "گام‌های شماره‌دار با شرط‌های صریح", true), S("changes", "تغییر فیلد و وضعیت", "تغییرهای دقیق رکورد"), S("replies", "پاسخ‌های آماده", "")],
  },
];

const BASES: Row[] = [
  { name: "راهنمای کاربران", kind: "external", read_mode: "everyone", publish_approval: true, approval_mode: "any", kcs_enabled: false, review_days: 180, default_valid_days: 365, sort_order: 10, icon: "book-open", color: "blue", description: "راهنماهای خودیاری برای همهٔ همکاران: حساب کاربری، شبکه، ایمیل، چاپ و نرم‌افزارها" },
  { name: "دانش کارشناسان", kind: "internal", read_mode: "everyone", publish_approval: false, kcs_enabled: true, publishing_model: "conveyor", review_days: 180, default_valid_days: 0, sort_order: 20, icon: "wrench", color: "teal", description: "راه‌حل‌ها و رویه‌های کارشناسان به روش KCS؛ درخواست‌کنندگان آن را نمی‌بینند" },
  { name: "خطاهای شناخته‌شده", kind: "internal", read_mode: "everyone", publish_approval: true, approval_mode: "any", kcs_enabled: false, review_days: 90, default_valid_days: 0, sort_order: 30, icon: "book-alert", color: "red", description: "خطاهای شناخته‌شده با راه‌حل موقت برای کارشناسان میز خدمت" },
];

const CATEGORIES: Record<string, string[]> = {
  "راهنمای کاربران": ["حساب کاربری و گذرواژه", "شبکه و اینترنت", "ایمیل و تقویم", "چاپ و اسکن", "نرم‌افزارها", "سخت‌افزار و تجهیزات", "امنیت اطلاعات"],
  "دانش کارشناسان": ["عیب‌یابی", "رویه‌های اجرایی", "پیکربندی سامانه‌ها"],
};

const GLOSSARY: Row[] = [
  { term: "VPN", approved_fa: "شبکهٔ خصوصی مجازی", synonyms: ["وی‌پی‌ان", "وی پی ان", "فیلترشکن سازمانی"], definition: "اتصال امن رایانهٔ بیرون از سازمان به شبکهٔ داخلی." },
  { term: "MFA", approved_fa: "احراز هویت چندمرحله‌ای", synonyms: ["احراز هویت دومرحله‌ای", "رمز یکبار مصرف", "OTP", "2FA"], definition: "ورود با گذرواژه و یک عامل دوم مانند کد پیامکی یا برنامهٔ تولید رمز." },
  { term: "SSO", approved_fa: "ورود یکپارچه", synonyms: ["ورود یک‌باره", "تک‌ورود"], definition: "یک بار ورود برای چند سامانه." },
  { term: "گذرواژه", approved_fa: "گذرواژه", synonyms: ["رمز عبور", "پسورد", "password", "رمز"], definition: "رمز ورود به حساب کاربری." },
  { term: "چاپگر", approved_fa: "چاپگر", synonyms: ["پرینتر", "printer", "پرینت"], definition: "دستگاه چاپ." },
];

const WELCOME = {
  title: "راهنمای مرکز دانش",
  summary: "چطور پاسخ پرسش خود را پیدا کنید، مقاله‌ای را ارزیابی کنید یا ایراد آن را گزارش دهید.",
  body: [
    "## پیدا کردن پاسخ",
    "",
    "1. در کادر جست‌وجوی مرکز دانش، مشکل را با واژه‌های خودتان بنویسید؛ لازم نیست املای دقیق یا نیم‌فاصله را رعایت کنید.",
    "2. برای پرسش‌های کوتاه از «پرسش از دانش» کمک بگیرید؛ پاسخ فقط از مقاله‌هایی است که شما اجازهٔ خواندنشان را دارید و منبع هر جمله کنارش آمده است.",
    "3. اگر پاسخ را پیدا نکردید، درخواست تازه ثبت کنید؛ مقاله‌هایی که دیده‌اید به کارشناس کمک می‌کند.",
    "",
    "> [!TIP]",
    "> با «دنبال کردن» یک مقاله، از به‌روزرسانی‌های آن باخبر می‌شوید.",
    "",
    "## کمک به بهتر شدن دانش",
    "",
    "- پایین هر مقاله بگویید «مفید بود؟» و اگر نبود، دلیلش را بنویسید.",
    "- اگر مقاله نادرست یا قدیمی است، «گزارش ایراد» را بزنید تا به گروه مالک آن برسد.",
  ].join("\n"),
  keywords: ["راهنما", "جست‌وجو", "مرکز دانش"],
};

/** Add the defaults inside `tx` as the system. */
export async function seedKnowledgeDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "kb_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= KNOWLEDGE_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const managers = await ensureRow(tx, sys, out, "group", { name: "مدیران دانش" }, { types: ["assignment", "approval"], description: "مالک پایگاه‌های دانش، کارهای بی‌مالک دانش و شکاف‌ها؛ تأییدکنندهٔ انتشار" });
  const config = cfg ?? (await ensureRow(tx, sys, out, "kb_config", { config_key: "default" }, { name: "تنظیمات دانش", default_group_id: managers.id }));

  const templates = new Map<string, Row>();
  for (const t of BUILTIN_TEMPLATES) templates.set(t.builtin, await ensureRow(tx, sys, out, "kb_template", { name: t.name }, { ...t }));

  const bases = new Map<string, Row>();
  for (const b of BASES) {
    const tpl = b.name === "خطاهای شناخته‌شده" ? templates.get("known_error") : b.kcs_enabled ? templates.get("kcs") : templates.get("how_to");
    bases.set(b.name, await ensureRow(tx, sys, out, "kb_base", { name: b.name }, { ...b, manager_group_id: managers.id, default_template_id: tpl?.id ?? null }));
  }
  for (const [baseName, names] of Object.entries(CATEGORIES)) {
    const base = bases.get(baseName)!;
    for (const [i, name] of names.entries()) await ensureRow(tx, sys, out, "kb_category", { base_id: base.id, name }, { sort_order: (i + 1) * 10 });
  }

  // approvals service: publishing (as the base says) and retirement
  const field = [{ kind: "field", field: "reviewer_ids" }];
  const approvalRules: Row[] = [
    { name: "انتشار مقالهٔ دانش (یک تأییدکننده)", mode: "any", rule: "any" },
    { name: "انتشار مقالهٔ دانش (همهٔ تأییدکنندگان)", mode: "all", rule: "all" },
    { name: "انتشار مقالهٔ دانش (بیشتر تأییدکنندگان)", mode: "majority", rule: "percent", threshold: 51 },
  ];
  for (const [i, r] of approvalRules.entries()) {
    await ensureRow(tx, sys, out, "approval_rule", { table_key: "kb_version", name: r.name }, {
      condition: { and: [{ f: "state", op: "eq", v: "in_review" }, { f: "needs_approval", op: "eq", v: true }, { f: "approval_mode", op: "eq", v: r.mode }] },
      mode: "parallel", levels: [{ name: "تأییدکنندگان پایگاه", sources: field, rule: r.rule, ...(r.threshold ? { threshold: r.threshold } : {}) }],
      remind_every: 86_400, expire_after: 14 * 86_400, expire_action: "canceled", sort_order: (i + 1) * 10, active: true,
      description: "تأییدکنندگان را پایگاه دانش تعیین می‌کند؛ نویسنده هرگز نسخهٔ خودش را تأیید نمی‌کند",
    });
  }
  await ensureRow(tx, sys, out, "approval_rule", { table_key: "kb_article", name: "بازنشستگی مقالهٔ دانش" }, {
    condition: { f: "state", op: "eq", v: "pending_retirement" }, mode: "parallel", levels: [{ name: "تأییدکنندگان پایگاه", sources: field, rule: "any" }],
    remind_every: 86_400, expire_after: 14 * 86_400, expire_action: "rejected", sort_order: 40, active: true, description: "درخواست بازنشستگی در پایگاه‌هایی که بازنشستگی را با تأیید می‌خواهند",
  });

  // the SLA of knowledge tasks (office hours; the default calendar, else around the clock)
  let calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!calendars.length) {
    const r = await seedCalendarsIn(tx, sys, { years: [] });
    out.created.calendar = (out.created.calendar ?? 0) + r.calendars;
    calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  let office = calendars.find((c) => c.is_default && c.active !== false) ?? null;
  if (!office) office = await createIn(tx, sys, "calendar", { name: "شبانه‌روزی", timezone: orgTz(sys), hours: FULL_HOURS, holiday_sets: [] }, { trusted: true });
  const H = 3600;
  await ensureRow(tx, sys, out, "sla_definition", { table_key: "kb_task", name: "رسیدگی به کار دانش" }, {
    type: "sla", target: "resolution", duration_mode: "priority", priority_field: "priority", calendar_id: office?.id ?? null,
    durations: { "1": 8 * H, "2": 16 * H, "3": 40 * H, "4": 80 * H, "5": 160 * H },
    start_condition: { f: "state", op: "in", v: ["new", "in_progress", "waiting"] }, stop_condition: { f: "state", op: "in", v: ["done", "closed"] },
    cancel_condition: { f: "state", op: "eq", v: "dismissed" }, pause_condition: { f: "state", op: "eq", v: "waiting" },
    retroactive: true, retroactive_field: "opened_at", warn_percents: [75, 90], sort_order: 10,
    description: "گزارش ایراد و کارهای دانش: اولویت ۱ یک روز، ۲ دو روز، ۳ پنج روز، ۴ ده روز و ۵ بیست روز کاری",
  });

  // notifications (on top of the platform's built-ins: assignment, approvals, comments)
  const rules: Row[] = [
    { table_key: "kb_version", name: "نسخهٔ مقاله برای اصلاح برگشت", event: "state_changed", condition: { and: [{ f: "state", op: "changes_from", v: "in_review" }, { f: "state", op: "changes_to", v: "draft" }] }, recipients: { fields: ["author_id"] }, channels: ["in_app", "email"] },
    { table_key: "kb_version", name: "نسخهٔ مقالهٔ شما منتشر شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "published" }, recipients: { fields: ["author_id"] }, channels: ["in_app"] },
    { table_key: "kb_article", name: "مقالهٔ شما بازنشسته شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "retired" }, recipients: { fields: ["owner_id", "author_id"] }, channels: ["in_app"] },
  ];
  for (const r of rules) await ensureRow(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, { active: true, notify_actor: false, digest: false, mandatory: false, ...r });

  for (const g of GLOSSARY) await ensureRow(tx, sys, out, "kb_glossary", { term: g.term }, { ...g, language: "fa", active: true });

  // the welcome article of the knowledge centre
  const guide = bases.get("راهنمای کاربران")!;
  const [welcome] = await liveRows(tx, sys, "kb_article", { and: [{ f: "base_id", op: "eq", v: guide.id }, { f: "title", op: "eq", v: WELCOME.title }] }, { limit: 1 });
  if (!welcome) {
    const { version } = await createArticleIn(tx, sys, { base_id: guide.id, template_id: templates.get("how_to")?.id ?? null, article_type: "how_to", title: WELCOME.title, summary: WELCOME.summary, body: WELCOME.body, keywords: WELCOME.keywords });
    await publishIn(tx, sys, version.id, null);
    out.created.kb_article = (out.created.kb_article ?? 0) + 1;
  }

  const patch: Row = { seeded: KNOWLEDGE_SEED_VERSION };
  if (!config.default_group_id) patch.default_group_id = managers.id;
  await updateIn(tx, sys, "kb_config", config.id, patch, { trusted: true });
  return out;
}
