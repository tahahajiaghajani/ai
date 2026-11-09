// Day-one defaults of the portal for an organisation (Persian, idempotent):
//   · the default portal (no workspace): its home page laid out and published, the privacy notice of forms and chat
//   · a CSAT survey («رضایت از رسیدگی»: a 1–5 rating, «حل شد؟», a comment) sent when an incident or a requested item is
//     resolved, and two switched-off templates: an XLA micro-survey (happiness, lost time, what mattered) and an NPS pulse
//   · feedback: the group «رسیدگی به بازخورد», its assignment rule, acknowledgement in one working day and a response in
//     five (SLA definitions on the office calendar), a notification to the group of a new complaint
//   · the virtual agent: its built-in topics (seeded by the brain) plus the portal's own — feedback, linking a
//     messenger, the service status page — answered with links into the portal
// Every item is created only when no live row with its natural key exists; once the defaults were added (the default
// portal's `seeded`), a second run adds nothing unless forced.
import { DEFAULT_LAYOUT } from "@shared/portal/logic";
import type { Cond } from "@shared/model/conditions";
import { VA_TOPIC } from "@shared/tables/ai-agents";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { seedTopics } from "../ai/va";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const PORTAL_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

const H = 3600;

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

export const PRIVACY_NOTICE =
  "آنچه این‌جا می‌نویسید فقط برای رسیدگی به درخواست شما و بهبود خدمت به کار می‌رود و کارشناسان مسئول آن را می‌بینند. اطلاعات حساس (گذرواژه، شمارهٔ کارت) ننویسید. برای دیدن، اصلاح یا پاک کردن داده‌های خود از «بازخورد › درخواست دربارهٔ داده‌های شخصی» استفاده کنید.";

const CSAT_QUESTIONS: Row[] = [
  { sort_order: 10, label: "چقدر از رسیدگی به درخواستتان راضی بودید؟", kind: "rating", metric: "csat", required: true },
  { sort_order: 20, label: "مشکل یا نیازتان کاملاً برطرف شد؟", kind: "yes_no", metric: "none", required: false },
  { sort_order: 30, label: "چه چیزی را بهتر کنیم؟", kind: "text", metric: "none", required: false },
];

const XLA_QUESTIONS: Row[] = [
  { sort_order: 10, label: "از تجربهٔ این خدمت چقدر خوشحال بودید؟ (۰ تا ۱۰)", kind: "scale10", metric: "happiness", required: true },
  { sort_order: 20, label: "به خاطر این مشکل حدوداً چند دقیقه از کارتان ماند؟", kind: "minutes", metric: "lost_time", required: false },
  { sort_order: 30, label: "چه چیزی بیش از همه بر تجربه‌تان اثر گذاشت؟", kind: "multi", metric: "none", required: false, options: ["سرعت", "مهارت کارشناس", "اطلاع‌رسانی", "آسانی ثبت درخواست", "نتیجهٔ کار"] },
  { sort_order: 40, label: "نکتهٔ دیگری دارید؟", kind: "text", metric: "none", required: false },
];

const NPS_QUESTIONS: Row[] = [
  { sort_order: 10, label: "چقدر احتمال دارد خدمات فناوری اطلاعات را به همکارانتان توصیه کنید؟ (۰ تا ۱۰)", kind: "nps", metric: "nps", required: true },
  { sort_order: 20, label: "مهم‌ترین دلیل امتیازتان چیست؟", kind: "text", metric: "none", required: false },
];

/** The portal's own virtual agent topics (answers with links into the portal). */
function portalTopics(orgId: string): Row[] {
  const p = (path: string) => `/${orgId}/portal/${path}`;
  return [
    {
      key: "portal_feedback", name: "شکایت، قدردانی یا پیشنهاد", kind: "answer", priority: 45,
      keywords: ["شکایت", "شکایت دارم", "انتقاد", "قدردانی", "تشکر", "پیشنهاد", "نارضایتی", "اعتراض"],
      examples: "از رفتار کارشناس شکایت دارم\nمی‌خواهم از همکار پشتیبانی تشکر کنم\nیک پیشنهاد برای بهتر شدن خدمت دارم",
      answer: `شکایت، قدردانی یا پیشنهادتان را در [بازخورد](${p("feedback")}) ثبت کنید؛ جدا از درخواست‌ها رسیدگی می‌شود و پاسخ رسمی آن را همان‌جا می‌بینید.`,
    },
    {
      key: "portal_messenger", name: "اتصال تلگرام یا بله", kind: "answer", priority: 50,
      keywords: ["تلگرام", "بله", "پیام‌رسان", "ربات", "اتصال حساب", "telegram"],
      examples: "چطور از تلگرام درخواست بدهم؟\nمی‌خواهم ربات بله را وصل کنم",
      answer: `در [نمایهٔ من](${p("profile")}) «کد اتصال» بگیرید و آن را برای ربات سازمان بفرستید (مثلاً «/link ABCD-EFGH»). پس از اتصال، با ربات هم می‌توانید بپرسید، سفارش بدهید و پیگیری کنید.`,
    },
    {
      key: "portal_status", name: "وضعیت خدمات", kind: "answer", priority: 40,
      keywords: ["وضعیت خدمات", "اطلاعیه", "قطعی سراسری", "همه قطع", "اختلال سراسری"],
      examples: "آیا ایمیل برای همه قطع است؟\nاطلاعیهٔ قطعی را کجا ببینم؟",
      answer: `وضعیت امروز خدمت‌ها و اطلاعیه‌های قطعی را در [وضعیت خدمات](${p("status")}) ببینید؛ می‌توانید مشترک شوید تا از اختلال‌ها خبر بگیرید.`,
    },
  ];
}

/** Add the defaults inside `tx` as the system. */
export async function seedPortalDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [existing] = await liveRows(tx, sys, "portal", { f: "workspace_id", op: "empty" }, { order: "t.created_at", limit: 1 });
  if (existing && Number(existing.seeded ?? 0) >= PORTAL_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const portal = existing ?? (await ensure(tx, sys, out, "portal", { name: "درگاه خدمات" }, {
    active: true, sort_order: 100, accent: "indigo", hero: "calm", privacy_notice: PRIVACY_NOTICE,
    layout: DEFAULT_LAYOUT, published_layout: DEFAULT_LAYOUT, layout_version: 1, published_at: new Date().toISOString(),
  }));

  // surveys
  const csat = await ensure(tx, sys, out, "survey", { name: "رضایت از رسیدگی" }, {
    kind: "csat", active: true, anonymous: false, expires_days: 14, satisfied_from: 4,
    intro: "رسیدگی به درخواست شما تمام شد. پاسخ به این سه پرسش کمتر از یک دقیقه وقت می‌گیرد.",
    thanks: "از نظرتان سپاسگزاریم؛ آن را به گروه رسیدگی‌کننده می‌رسانیم.",
  });
  for (const q of CSAT_QUESTIONS) await ensure(tx, sys, out, "survey_question", { survey_id: csat.id, sort_order: q.sort_order }, q);
  await ensure(tx, sys, out, "survey_trigger", { survey_id: csat.id, table_key: "incident" }, { name: "رخداد حل شد ← رضایت از رسیدگی", fire_on: "resolved", active: true, sample_pct: 100, cooldown_days: 7, channels: ["in_app", "email"] });
  await ensure(tx, sys, out, "survey_trigger", { survey_id: csat.id, table_key: "request_item" }, { name: "درخواست انجام شد ← رضایت از رسیدگی", fire_on: "resolved", active: true, sample_pct: 100, cooldown_days: 7, channels: ["in_app", "email"] });
  const xla = await ensure(tx, sys, out, "survey", { name: "تجربهٔ خدمت (XLA)" }, {
    kind: "xla", active: false, anonymous: false, expires_days: 7, satisfied_from: 4,
    intro: "دو دقیقه از وقتتان را می‌گیریم تا بدانیم این خدمت چه تجربه‌ای برایتان ساخت.",
    thanks: "سپاسگزاریم؛ پاسخ شما در شاخص‌های تجربهٔ کاربر حساب می‌شود.",
  });
  for (const q of XLA_QUESTIONS) await ensure(tx, sys, out, "survey_question", { survey_id: xla.id, sort_order: q.sort_order }, q);
  const nps = await ensure(tx, sys, out, "survey", { name: "نظرسنجی دوره‌ای خدمات فناوری اطلاعات" }, {
    kind: "pulse", active: false, anonymous: true, expires_days: 14, satisfied_from: 4,
    intro: "این نظرسنجی بی‌نام است: نه نام شما و نه درخواست‌هایتان با پاسخ ذخیره می‌شود.",
    thanks: "از وقتی که گذاشتید سپاسگزاریم.",
  });
  for (const q of NPS_QUESTIONS) await ensure(tx, sys, out, "survey_question", { survey_id: nps.id, sort_order: q.sort_order }, q);

  // feedback: the group, its routing, its clocks and the alert of a complaint
  const group = await ensure(tx, sys, out, "group", { name: "رسیدگی به بازخورد" }, { types: ["assignment"], description: "شکایت‌ها، قدردانی‌ها، پیشنهادها و درخواست‌های داده‌های شخصی ثبت‌شده در درگاه" });
  await ensure(tx, sys, out, "assignment_rule", { table_key: "portal_feedback", name: "بازخوردها ← رسیدگی به بازخورد" }, { group_id: group.id, method: "least_loaded", sort_order: 100 });
  const [office] = (await liveRows(tx, sys, "calendar", { and: [{ f: "is_default", op: "eq", v: true }, { f: "active", op: "ne", v: false }] }, { limit: 1 }));
  const canceled: Cond = { f: "state", op: "eq", v: "withdrawn" };
  const common = { table_key: "portal_feedback", type: "sla", duration_mode: "fixed", retroactive: true, retroactive_field: "opened_at", warn_percents: [50, 90], calendar_id: office?.id ?? null };
  await ensure(tx, sys, out, "sla_definition", { table_key: "portal_feedback", name: "اعلام دریافت بازخورد" }, {
    ...common, target: "response", duration: 8 * H, sort_order: 10,
    start_condition: { f: "state", op: "eq", v: "new" }, stop_condition: { f: "state", op: "ne", v: "new" }, cancel_condition: canceled,
    description: "بازخورد تازه تا یک روز کاری بررسی می‌شود (ISO 10002: اعلام دریافت)",
  });
  await ensure(tx, sys, out, "sla_definition", { table_key: "portal_feedback", name: "پاسخ به بازخورد" }, {
    ...common, target: "resolution", duration: 40 * H, sort_order: 20,
    start_condition: { f: "kind", op: "in", v: ["complaint", "privacy", "suggestion"] }, stop_condition: { f: "state", op: "in", v: ["responded", "closed"] },
    pause_condition: { f: "state", op: "eq", v: "awaiting_requester" }, cancel_condition: canceled,
    description: "پاسخ رسمی به شکایت، پیشنهاد یا درخواست داده‌ها تا پنج روز کاری",
  });
  await ensure(tx, sys, out, "notification_rule", { table_key: "portal_feedback", name: "شکایت یا درخواست داده‌های تازه" }, {
    event: "created", condition: { f: "kind", op: "in", v: ["complaint", "privacy"] }, recipients: { assignment_group: true, group_manager: true },
    channels: ["in_app", "email"], active: true, notify_actor: false, digest: false, mandatory: false,
  });

  // the virtual agent's topics: the brain's built-ins (it seeds them on first use) and the portal's own
  for (const t of portalTopics(sys.org.id)) {
    const exists = await tx.one(`select 1 from sm_va_topics where org_id = $1 and key = $2 and deleted_at is null`, [sys.org.id, t.key]);
    if (exists) continue;
    await createIn(tx, sys, VA_TOPIC, { ...t, enabled: true, builtin: false }, { trusted: true });
    out.created[VA_TOPIC] = (out.created[VA_TOPIC] ?? 0) + 1;
  }

  await updateIn(tx, sys, "portal", String(portal.id), { seeded: PORTAL_SEED_VERSION }, { trusted: true });
  return out;
}

/** Add the defaults (as the system; the virtual agent's built-in topics first, in their own transaction). */
export async function seedPortalDefaultsWith(sys: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  await seedTopics(sys).catch(() => undefined);
  return sys.write((tx) => seedPortalDefaultsIn(tx, sys, opts));
}
