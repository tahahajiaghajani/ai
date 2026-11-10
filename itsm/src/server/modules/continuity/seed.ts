// Day-one defaults of availability and continuity (Persian, idempotent): the settings row (with the `seeded` marker),
// the BIA template «الگوی تحلیل اثر کسب‌وکار» (categories × time buckets with typical ratings, tolerance «زیاد»,
// guidance for respondents and an MBCO prompt) and a recovery-plan template «الگوی طرح بازیابی خدمت» with its
// steps — the starting point of a service's DR plan and of its exercises; and the custom role «مدیر تداوم و
// دسترس‌پذیری» (administrators give it) that approves analyses and plans.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const CONTINUITY_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

/** Typical ratings of the template (0 none … 4 critical), by category over 1 h, 4 h, 1 day, 3 days, 1 week. */
export const TEMPLATE_IMPACTS = {
  financial: { h1: 1, h4: 1, d1: 2, d3: 3, w1: 4 },
  operational: { h1: 1, h4: 2, d1: 3, d3: 4, w1: 4 },
  regulatory: { h1: 0, h4: 0, d1: 1, d3: 2, w1: 3 },
  reputational: { h1: 0, h4: 1, d1: 2, d3: 3, w1: 3 },
  customer: { h1: 1, h4: 2, d1: 3, d3: 3, w1: 4 },
  safety: { h1: 0, h4: 0, d1: 0, d3: 0, w1: 0 },
};

const STEPS: [number, string, string, number][] = [
  [1, "اعلام وضعیت و فعال‌سازی طرح", "مدیر بحران", 15],
  [2, "تماس با تیم بازیابی (زنجیرهٔ تماس)", "هماهنگ‌کنندهٔ بازیابی", 30],
  [3, "ارزیابی خسارت و انتخاب راهکار (سایت پشتیبان یا بازیابی در محل)", "سرپرست فنی", 60],
  [4, "بازیابی زیرساخت و داده از آخرین پشتیبان سالم", "کارشناس زیرساخت", 180],
  [5, "راه‌اندازی خدمت و آزمون پذیرش با مالک خدمت", "مالک خدمت", 240],
  [6, "اطلاع‌رسانی به کاربران و بازگشت به حالت عادی", "مدیر ارتباطات", 270],
];

export async function seedContinuityDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfgRow] = await liveRows(tx, sys, "continuity_config", null, { order: "t.created_at", limit: 1 });
  if (cfgRow && Number(cfgRow.seeded ?? 0) >= CONTINUITY_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfgRow ?? (await ensure(tx, sys, out, "continuity_config", { config_key: "default" }, { name: "تنظیمات تداوم" }));
  await ensure(tx, sys, out, "bia", { title: "الگوی تحلیل اثر کسب‌وکار", is_template: true }, {
    impacts: TEMPLATE_IMPACTS,
    tolerance: 3,
    mbco: "کمترین سطح خدمتی که باید در زمان اختلال حفظ شود (مثلاً: پاسخ به ۵۰٪ درخواست‌ها با تأخیر کمتر از ۵ ثانیه).",
    notes: [
      "**راهنمای پاسخ‌دهنده**",
      "",
      "- برای هر دسته، اثر از کار افتادن خدمت را در هر بازهٔ زمانی از ۰ (بی‌اثر) تا ۴ (بحرانی) امتیاز دهید.",
      "- نخستین بازه‌ای که امتیاز آن به «آستانهٔ تحمل» برسد، زمان هدف بازیابی (RTO) پیشنهادی است.",
      "- حداکثر زمان قابل تحمل (MTPD) را جایی بگذارید که پس از آن ادامهٔ کسب‌وکار ممکن نیست؛ RTO باید کوتاه‌تر باشد.",
      "- نقطهٔ هدف بازیابی (RPO): حداکثر دادهٔ قابل از دست دادن بر حسب زمان (فاصلهٔ پشتیبان‌گیری را با آن بسنجید).",
      "- وابستگی‌ها: پیکربندی‌ها، خدمت‌ها، افراد کلیدی، مکان‌ها، تأمین‌کنندگان و داده‌ها را نام ببرید.",
    ].join("\n"),
  });
  const plan = await ensure(tx, sys, out, "continuity_plan", { title: "الگوی طرح بازیابی خدمت" }, {
    plan_type: "drp",
    version_label: "1.0",
    invocation_criteria: "- از کار افتادن خدمت بیش از نیمی از RTO بدون راه‌حل موقت\n- از دست رفتن مرکز داده یا سایت اصلی\n- دستور مدیر بحران",
    return_to_normal: "- بازگشت داده‌ها و ترافیک به سایت اصلی پس از آزمون\n- بستن طرح، ثبت درس‌آموخته‌ها و به‌روزرسانی طرح",
    review_months: 12,
  });
  for (const [seq, title, role, offset] of STEPS) await ensure(tx, sys, out, "plan_step", { plan_id: plan.id, seq }, { title, role, rto_offset_minutes: offset });
  await ensure(tx, sys, out, "role", { key: "continuity_manager" }, {
    name: "مدیر تداوم و دسترس‌پذیری", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "قطعی‌ها، ظرفیت، تحلیل‌های اثر، طرح‌های تداوم و مانورها؛ تأیید تحلیل اثر و طرح",
    grants: { continuity: { read: "all", write: "all", delete: "all", create: true, approve: true, admin: true } },
    field_groups: ["internal", "personal"], contains: ["agent"],
  });
  await updateIn(tx, sys, "continuity_config", String(config.id), { seeded: CONTINUITY_SEED_VERSION }, { trusted: true });
  return out;
}
