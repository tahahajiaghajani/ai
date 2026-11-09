// The event module's AI (docs/spec/AI.md §11), each skill with a rule-based answer when no model can answer:
//   event.cluster_summary  «خلاصهٔ گروه هم‌بسته» — what the correlated alerts say together (record: alert_group)
//   event.root_cause       «سرنخ‌های علت ریشه‌ای» — the deterministic ranking of probable causes (temporal precedence,
//                          upstream position in the CMDB, recent changes) narrated with evidence and next checks, or
//                          «شواهد کافی نیست» (record: alert_group)
//   event.noise_report     «گزارش نویز هشدارها» — the alert-quality review over the computed figures (no record)
// Facts are computed in code with the asking member's access (numbers and causes come from code; the model only
// narrates). Anomaly detection is left to the predictive work. Also here: the assistant's read-only tool «چه کسی
// کشیک است» and the notification template block `{{block.oncall}}`.
import { z } from "zod";
import { formatJalaliDateTime } from "@shared/jalali";
import { groupSummary, type Cause } from "@shared/event/logic";
import type { Ctx } from "../../context";
import { defFor, get, list } from "../../engine";
import { access } from "../../access/provider";
import { registerSkill, defineSkill, runSkill, isAiUnavailable } from "../ai/skills";
import type { SkillDef, SkillRuntimeInput } from "../ai/skills";
import { registerTool } from "../ai/tools";
import { defineTool } from "../ai/tools/registry";
import { registerTemplateBlock } from "../notify";
import { AppError } from "../../http/errors";
import { causesOf } from "./correlate";
import { onCallForGroup, onCallOfSchedule } from "./oncall";
import { noiseReport, noiseText } from "./reports";
import { isUuid, liveRows, orgTz, sysOf, type Row } from "./common";

/** The members of a group the caller may read, and the causes among what they may read. */
export async function groupFacts(ctx: Ctx, groupId: string): Promise<{ group: Row; members: Row[]; causes: Cause[]; services: string[] }> {
  const group = (await get(ctx, "alert_group", groupId)).row;
  const res = await list(ctx, "alert", { filter: { f: "group_id", op: "eq", v: groupId }, size: 100, sort: "first_seen_at", fields: ["number", "short_description", "severity", "state", "ci_id", "node", "first_seen_at", "last_seen_at", "event_count", "created_at"], total: false });
  const members = res.rows.map((r) => ({ ...r, ci_name: r.ci_id ? res.display[String(r.ci_id)] ?? null : null }));
  let causes = members.length ? await causesOf(ctx.db, sysOf(ctx), members) : [];
  // changes the caller may not read are left out (alerts already are: only readable members were ranked)
  const changeIds = causes.filter((c) => c.kind === "change").map((c) => c.id);
  if (changeIds.length) {
    const readable = await list(ctx, "change_request", { ids: changeIds, size: changeIds.length, fields: ["number"], total: false }).catch(() => ({ rows: [] as Row[] }));
    const ok = new Set(readable.rows.map((r) => String(r.id)));
    causes = causes.filter((c) => c.kind !== "change" || ok.has(c.id));
  }
  const services = (Array.isArray(group.affected_services) ? group.affected_services : []).map((s: string) => res.display[s] ?? null).filter(Boolean) as string[];
  return { group, members, causes, services };
}

/** The rule-based summary of a group (its stored text, recomputed for the caller's view). */
export function ruleSummary(f: Awaited<ReturnType<typeof groupFacts>>): string {
  return groupSummary({
    title: String(f.group.title ?? ""),
    alerts: f.members.map((m) => ({ number: m.number ?? null, title: String(m.short_description ?? ""), severity: String(m.severity ?? "minor"), state: String(m.state ?? ""), ci_name: (m.ci_name as string | null) ?? null })),
    services: f.services,
    causes: f.causes,
  });
}

/** Rule-based root-cause hints (Markdown): the ranking with its evidence and what to check next. */
export function ruleCauses(causes: Cause[]): string {
  if (!causes.length) return "شواهد کافی برای علت محتمل نیست: هشدارها پیکربندی مشترک، وابستگی در CMDB یا تغییر نزدیکی ندارند.";
  const lines = ["**سرنخ‌های علت (رتبه‌بندی با قاعده، نه قطعی)**", ""];
  for (const [i, c] of causes.entries()) {
    lines.push(`${(i + 1).toLocaleString("fa-IR")}. ${c.kind === "change" ? "تغییر" : "هشدار"} ${c.number ?? ""} «${c.title}» — امتیاز ${Math.round(c.score * 100).toLocaleString("fa-IR")}٪`);
    lines.push(`   شواهد: ${c.evidence.join("؛ ")}`);
    lines.push(c.kind === "change" ? "   بررسی بعدی: برنامهٔ بازگشت تغییر و زمان اجرای آن را با زمان نخستین هشدار مقایسه کنید." : "   بررسی بعدی: وضعیت همین پیکربندی و رویدادهای پیش از نخستین هشدار را ببینید.");
  }
  return lines.join("\n");
}

const membersFact = async (ctx: Ctx, input: SkillRuntimeInput) => {
  if (!input.id) return {};
  const f = await groupFacts(ctx, input.id);
  return {
    alerts: f.members.map((m) => ({ number: m.number, title: m.short_description, severity: m.severity, state: m.state, ci: m.ci_name ?? null, node: m.node ?? null, first_seen: m.first_seen_at, count: m.event_count })),
    causes: f.causes.map((c) => ({ kind: c.kind, number: c.number, title: c.title, score: c.score, evidence: c.evidence })),
    services: f.services,
  };
};

export const EVENT_SKILLS: SkillDef[] = [
  defineSkill({
    key: "event.cluster_summary",
    name: "خلاصهٔ گروه هم‌بسته",
    description: "آنچه هشدارهای یک گروه هم‌بسته با هم می‌گویند: کدام پیکربندی‌ها و خدمت‌ها، از کی، چه شدتی و احتمالاً چرا",
    module: "event",
    catalog: ["EVT-012", "EVT-014"],
    target: "record",
    tables: ["alert_group"],
    output: "text",
    tier: "fast",
    inputs: { journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["panel", "module"],
    order: 5,
    system: "کار تو: خلاصهٔ کوتاه یک گروه از هشدارهای هم‌بسته برای اپراتور مرکز عملیات: چه چیزی از کار افتاده یا افت کرده، کدام پیکربندی‌ها و خدمت‌ها، از چه زمانی، و علت محتمل فقط از بلوک causes (با «احتمالاً»). عددها و نام‌ها فقط از داده‌ها. اگر شواهد کم است بگو.",
    template: "گروه:\n{{record}}\n\nهشدارها:\n{{alerts}}\n\nخدمت‌های متأثر:\n{{services}}\n\nعلت‌های محتمل (محاسبه‌شده با قاعده):\n{{causes}}",
    factKeys: ["alerts", "services", "causes"],
    facts: membersFact,
    fallback: async (ctx, input) => (input.id ? { text: ruleSummary(await groupFacts(ctx, input.id)) } : { text: "" }),
  }),
  defineSkill({
    key: "event.root_cause",
    name: "سرنخ‌های علت ریشه‌ای",
    description: "روایت نامزدهای علت (هشدار نخست، پیکربندی بالادست، تغییر نزدیک) با شواهد و بررسی‌های بعدی — یا «شواهد کافی نیست»",
    module: "event",
    catalog: ["EVT-015"],
    target: "record",
    tables: ["alert_group"],
    output: "text",
    tier: "standard",
    inputs: { journal: "none", links: true },
    roles: ["agent"],
    surfaces: ["panel", "module"],
    order: 10,
    system: "کار تو: بر پایهٔ رتبه‌بندی محاسبه‌شدهٔ نامزدهای علت (بلوک causes) حداکثر سه فرضیه بنویس: هر کدام با شواهدش و یک یا دو بررسی بعدی. فرضیه‌ای بیرون از نامزدها نساز. اگر نامزدی نیست یا شواهد ضعیف است صریح بنویس «شواهد کافی نیست» و بگو چه داده‌ای کمک می‌کند.",
    template: "گروه:\n{{record}}\n\nهشدارها:\n{{alerts}}\n\nنامزدهای علت (رتبه‌بندی با قاعده):\n{{causes}}\n\nپیوندها:\n{{links}}",
    factKeys: ["alerts", "services", "causes"],
    facts: membersFact,
    fallback: async (ctx, input) => (input.id ? { text: ruleCauses((await groupFacts(ctx, input.id)).causes) } : { text: "" }),
  }),
  defineSkill({
    key: "event.noise_report",
    name: "گزارش نویز هشدارها",
    description: "بازبینی کیفیت هشدار: منبع‌ها و هشدارهای پرنویز، بی‌تأیید رفع‌شده، نوسانی و گذرا، با پیشنهاد قاعده",
    module: "event",
    catalog: ["EVT-013", "EVT-032"],
    target: "none",
    tables: ["alert"],
    output: "text",
    tier: "standard",
    params: [{ name: "days", label: "دوره (روز)", type: "choice", default: "30", choices: [{ value: "7", label: "۷ روز" }, { value: "30", label: "۳۰ روز" }, { value: "90", label: "۹۰ روز" }] }],
    roles: ["agent"],
    surfaces: ["module"],
    system: "کار تو: گزارش کوتاه کیفیت هشدار برای سرپرست عملیات از عددهای محاسبه‌شده (بلوک report): سهم نویز، پرتکرارترین هشدارها و منبع‌ها، و برای هر کدام یک قاعدهٔ پیشنهادی (آستانه، سرکوب، کاهش شدت یا ادغام) با دلیل. هیچ عددی نساز.",
    template: "دوره: {{params.days}} روز\n\nداده‌های محاسبه‌شده:\n{{report}}",
    factKeys: ["report"],
    facts: async (ctx, input) => ({ report: await noiseReport(ctx, Math.max(1, Math.min(90, Number(input.params.days ?? 30) || 30))) }),
    fallback: async (ctx, input) => ({ text: noiseText(await noiseReport(ctx, Math.max(1, Math.min(90, Number(input.params.days ?? 30) || 30)))) }),
  }),
];

/** A skill answer, or the module's rule-based one when no model can (or may) answer. */
export async function withAi(ctx: Ctx, key: string, req: { table?: string; id?: string; params?: Record<string, unknown> }, rules: () => Promise<string>): Promise<{ text: string; ai: boolean; label: string; model: string | null }> {
  const RULES = "بدون مدل هوش مصنوعی و با قاعده ساخته شد";
  if (ctx.actor === "system" || !ctx.can("ai", "view")) return { text: await rules(), ai: false, label: RULES, model: null };
  try {
    const r = await runSkill(ctx, key, { table: req.table ?? null, id: req.id ?? null, params: req.params ?? {} }, { propose: false });
    const text = r.text ?? "";
    if (!text.trim()) return { text: await rules(), ai: false, label: RULES, model: null };
    return { text, ai: !r.fallback, label: r.label, model: r.model };
  } catch (e) {
    if (isAiUnavailable(e) || (e instanceof AppError && e.status === 403)) return { text: await rules(), ai: false, label: RULES, model: null };
    throw e;
  }
}

const oncallTool = defineTool({
  name: "oncall_now",
  title_fa: "چه کسی کشیک است",
  description:
    "Who is on call right now for each on-call schedule the caller may read (or only schedules whose name or team matches `team`): the schedule, its team, the person on call and until when (Jalali, the organisation's zone). Use for «who is on call for the network team», «کشیک امشب کیست».",
  input: z.object({ team: z.string().max(120).optional() }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    const { def } = await defFor(ctx, "oncall_schedule");
    if (!access().canReadTable(ctx, def)) return { data: { allowed: false }, summary_fa: "به برنامه‌های کشیک دسترسی ندارید" };
    const res = await list(ctx, "oncall_schedule", { filter: { f: "active", op: "eq", v: true }, q: input.team || undefined, size: 20, fields: ["name", "group_id"], total: false });
    const tz = orgTz(ctx);
    const out: { schedule: string; team: string | null; on_call: string | null; until: string | null }[] = [];
    for (const s of res.rows) {
      const who = await onCallOfSchedule(ctx.db, ctx, s);
      const users = who.user ? await list(ctx, "user", { ids: [who.user], size: 1, total: false }).catch(() => ({ rows: [] as Row[] })) : { rows: [] as Row[] };
      out.push({ schedule: String(s.name), team: s.group_id ? res.display[String(s.group_id)] ?? null : null, on_call: users.rows[0] ? String(users.rows[0].name ?? "") : who.user ? "عضو" : null, until: who.until ? formatJalaliDateTime(new Date(who.until).toISOString(), tz) : null });
    }
    return { data: { schedules: out }, summary_fa: `${out.length.toLocaleString("fa-IR")} برنامهٔ کشیک` };
  },
});

/** Register the skills, the assistant tool and the template block (once per process). */
export function installEventAi(): (() => void)[] {
  return [
    ...EVENT_SKILLS.map((s) => registerSkill(s)),
    registerTool(oncallTool as never),
    registerTemplateBlock("oncall", {
      label: "کشیک فعلی گروه رکورد",
      description: "نام کسانی که اکنون برای گروه پشتیبانی رکورد کشیک‌اند",
      tables: (def) => !!def.scope?.group,
      fields: ["assignment_group_id"],
      async render({ ctx, def, row }) {
        const field = def.scope?.group;
        const group = field ? row[field] : null;
        if (!isUuid(group)) return null;
        // under the recipient's access: who is on call is told to those who may read the team's on-call schedules
        // (not to a requester of the record), and the names are the profiles they may read
        if (ctx.actor !== "system") {
          const [schedule] = await liveRows(ctx.db, ctx, "oncall_schedule", { f: "group_id", op: "eq", v: group }, { limit: 1 }).catch(() => [] as Row[]);
          if (!schedule) return null;
        }
        const people = await onCallForGroup(ctx.db, sysOf(ctx), group);
        if (!people.length) return null;
        const names = await liveRows(ctx.db, ctx, "member_profile", { f: "user_id", op: "in", v: people }, { limit: 10 }).catch(() => [] as Row[]);
        const label = people.map((u) => String(names.find((n) => n.user_id === u)?.name ?? "")).filter(Boolean);
        if (!label.length) return null;
        const esc = (s: string) => s.replace(/[\\`*_[\]<>#|]/g, (m) => `\\${m}`);
        return { markdown: `کشیک فعلی: ${label.map(esc).join("، ")}`, text: `کشیک: ${label.join("، ")}` };
      },
    }),
  ];
}
