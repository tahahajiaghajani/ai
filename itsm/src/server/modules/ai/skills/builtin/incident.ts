// Skills of incident and problem management and their implementation of the modules' extension points
// (`registerIncidentAi` / `registerProblemAi` in src/server/modules/incident/ai.ts; catalogue INC-011/019/038/049/067/068,
// PRB-018/021/027, AI-023/025/029/030/031): similar incidents (retrieval, no model), summary, triage suggestions,
// resolution notes, a KCS article draft, the requester's sentiment, stakeholder updates of a major incident, the shift
// handover summary; for problems the RCA draft (5 whys and fishbone), the known-error draft and the summary.
// Every implementation runs the skill as the person who asked (their ctx): the module's routes write what they accept.
import { z } from "zod";
import type { Ctx } from "../../../../context";
import { FISHBONE, type RcaCanvas } from "@shared/problem/logic";
import { get, list, orgSchema } from "../../../../engine";
import { registerIncidentAi, registerProblemAi } from "../../../incident/ai";
import { retrieve } from "../../rag";
import { defineSkill } from "../registry";
import { runForModule } from "../runtime";
import type { SkillDef } from "../types";
import { ruleSummary } from "./generic";

const CONF = z.number().min(0).max(1);

const groupsFacts = async (ctx: Ctx) => {
  const g = await list(ctx, "group", { filter: { f: "active", op: "eq", v: true }, size: 80, fields: ["name", "types", "description"], total: false }).catch(() => null);
  return (g?.rows ?? []).filter((r) => !Array.isArray(r.types) || (r.types as string[]).includes("assignment")).map((r) => ({ id: r.id, name: r.name, about: r.description ?? null }));
};

export const incidentSkills: SkillDef[] = [
  defineSkill({
    key: "incident.summary",
    name: "خلاصهٔ رخداد",
    description: "خلاصهٔ وضعیت‌محور: مسئله، اثر، کارهای انجام‌شده، راه‌حل یا گام بعدی",
    module: "incident",
    catalog: ["INC-067", "AI-023"],
    target: "record",
    tables: ["incident"],
    output: "text",
    tier: "fast",
    inputs: { journal: "all", journalLimit: 40, related: [{ table: "incident_task", field: "incident_id", label: "کارهای رخداد", fields: ["number", "short_description", "state", "assigned_to"], limit: 15 }] },
    surfaces: ["panel", "module"],
    order: 5,
    system: "کار تو: خلاصهٔ یک رخداد برای کارشناس یا مدیری که تازه به آن رسیده است، با این بخش‌ها: «مسئله»، «اثر و فوریت»، «کارهای انجام‌شده»، «وضعیت کنونی و گام بعدی»؛ اگر حل شده، «راه‌حل». کوتاه و دقیق.",
    template: "رخداد:\n{{record}}\n\nکارها:\n{{related}}\n\nیادداشت‌ها و پاسخ‌ها:\n{{journal}}\n\nپیوندها:\n{{links}}",
    fallback: async (_ctx, input) => ruleSummary(input),
  }),
  defineSkill({
    key: "incident.triage",
    name: "پیشنهاد دسته‌بندی و واگذاری",
    description: "دسته، اثر، فوریت و گروه پشتیبانی پیشنهادی با اطمینان و دلیل، از متن رخداد و رخدادهای مشابه",
    module: "incident",
    catalog: ["INC-011", "AI-041"],
    target: "record",
    tables: ["incident"],
    output: "fields",
    outputFields: ["category", "subcategory", "impact", "urgency", "assignment_group_id"],
    tier: "standard",
    grounding: { kind: "similar", k: 5 },
    inputs: { journal: "public", journalLimit: 10, links: false },
    roles: ["agent"],
    surfaces: ["panel"],
    order: 15,
    system: `کار تو: دسته‌بندی و واگذاری یک رخداد. از متن رخداد و رخدادهای مشابه (منابع) کمک بگیر. گروه پشتیبانی را فقط از فهرست groups انتخاب کن و نامش را دقیقاً همان‌طور بنویس؛ برای دسته، زیردسته، اثر و فوریت فقط از گزینه‌های options استفاده کن. برای هر پیشنهاد اطمینان واقعی بده و دلیلی کوتاه که به شاهدی در داده اشاره کند.`,
    template: "رخداد:\n{{record}}\n\nگروه‌های پشتیبانی:\n{{groups}}\n\nگزینه‌ها:\n{{options}}",
    factKeys: ["groups", "options"],
    facts: async (ctx) => ({ groups: await groupsFacts(ctx), options: await tableChoiceFacts(ctx, "incident", ["category", "subcategory", "impact", "urgency"]) }),
  }),
  defineSkill({
    key: "incident.triage_text",
    name: "پیشنهاد دسته‌بندی از متن",
    description: "پیش از ثبت رخداد: دسته، اثر، فوریت و گروه پیشنهادی از متنی که نوشته شده",
    module: "incident",
    catalog: ["INC-011"],
    target: "text",
    tables: ["incident"],
    output: "json",
    schema: z.object({ suggestions: z.array(z.object({ field: z.enum(["category", "subcategory", "impact", "urgency", "assignment_group_id"]), value: z.string(), confidence: CONF, reason: z.string().max(400).optional() })).max(6) }),
    tier: "fast",
    grounding: { kind: "similar", k: 5 },
    roles: ["agent"],
    surfaces: ["module"],
    system: `کار تو: پیشنهاد دسته، زیردسته، اثر، فوریت و گروه پشتیبانی برای رخدادی که هنوز ثبت نشده، از متن آن و رخدادهای مشابه. فقط مقدارهای فهرست‌های options و groups را به کار ببر (گروه با نامش).`,
    template: "متن رخداد:\n{{text}}\n\nگروه‌های پشتیبانی:\n{{groups}}\n\nگزینه‌ها:\n{{options}}",
    factKeys: ["groups", "options"],
    facts: async (ctx) => ({ groups: await groupsFacts(ctx), options: await tableChoiceFacts(ctx, "incident", ["category", "subcategory", "impact", "urgency"]) }),
  }),
  defineSkill({
    key: "incident.resolution",
    name: "پیش‌نویس یادداشت حل",
    description: "یادداشت حل (نشانه، علت، کارهای انجام‌شده، وارسی) و کد حل پیشنهادی برای پنجرهٔ حل",
    module: "incident",
    catalog: ["INC-068", "AI-025"],
    target: "record",
    tables: ["incident"],
    output: "fields",
    outputFields: ["close_notes", "close_code", "cause_code"],
    tier: "standard",
    inputs: { journal: "all", journalLimit: 40 },
    roles: ["agent"],
    fieldGroups: ["internal"],
    surfaces: ["panel"],
    order: 20,
    system: `کار تو: پیش‌نویس یادداشت حل یک رخداد از تاریخچهٔ آن: «نشانه»، «علت» (اگر معلوم است)، «کارهای انجام‌شده»، «وارسی» — کوتاه و فهرست‌وار در فیلد close_notes. کد حل و کد علت را فقط از گزینه‌ها پیشنهاد بده و فقط وقتی شاهدش هست.`,
    template: "رخداد:\n{{record}}\n\nیادداشت‌ها و پاسخ‌ها:\n{{journal}}\n\nگزینه‌ها:\n{{options}}",
    factKeys: ["options"],
    facts: async (ctx) => ({ options: await tableChoiceFacts(ctx, "incident", ["close_code", "cause_code"]) }),
  }),
  defineSkill({
    key: "incident.kb_draft",
    name: "پیش‌نویس مقالهٔ دانش (KCS)",
    description: "مقالهٔ دانش از رخداد حل‌شده: مسئله، محیط، راه‌حل گام‌به‌گام و علت — بی نام افراد",
    module: "incident",
    catalog: ["INC-038", "KB-066"],
    target: "record",
    tables: ["incident"],
    output: "json",
    schema: z.object({ title: z.string().max(250), body: z.string().max(40_000) }),
    tier: "standard",
    inputs: { journal: "public", journalLimit: 20, links: false },
    roles: ["agent"],
    surfaces: ["module"],
    system: `کار تو: نوشتن مقالهٔ دانش به روش KCS از یک رخداد حل‌شده. بخش‌ها با عنوان Markdown: «## مسئله»، «## محیط»، «## راه‌حل» (گام‌های شماره‌دار)، «## علت». فقط آنچه رخداد می‌گوید؛ بخشی را که داده ندارد خالی بگذار. هیچ نام، شمارهٔ تماس یا دادهٔ ویژهٔ این رخداد را ننویس.`,
    template: "رخداد:\n{{record}}\n\nپاسخ‌های عمومی:\n{{journal}}",
  }),
  defineSkill({
    key: "incident.sentiment",
    name: "حال درخواست‌کننده",
    description: "لحن و نگرانی درخواست‌کننده از پیام‌های عمومی او، با نشانه‌ها و پیشنهاد تشدید",
    module: "incident",
    catalog: ["AI-049"],
    target: "record",
    tables: ["incident"],
    output: "json",
    schema: z.object({
      sentiment: z.enum(["positive", "neutral", "concerned", "frustrated", "angry"]),
      score: z.number().min(-1).max(1),
      signals: z.array(z.string().max(200)).max(6),
      escalate: z.boolean(),
      advice: z.string().max(600).optional(),
    }),
    tier: "fast",
    inputs: { fields: ["short_description", "description", "priority", "state"], journal: "public", journalLimit: 20, links: false },
    roles: ["agent"],
    surfaces: ["panel"],
    order: 40,
    system: `کار تو: سنجش حال درخواست‌کننده از شرح رخداد و پاسخ‌های عمومی (نه یادداشت‌های داخلی). sentiment یکی از گزینه‌ها، score از ۱- تا ۱، چند نشانهٔ کوتاه با نقل از متن، escalate فقط وقتی خشم، تکرار پیگیری یا تهدید به شکایت هست، و یک توصیهٔ کوتاه برای پاسخ.`,
    template: "رخداد:\n{{record}}\n\nپاسخ‌ها و پیام‌ها:\n{{journal}}",
  }),
  defineSkill({
    key: "incident.stakeholder_update",
    name: "پیش‌نویس اطلاع‌رسانی رخداد عمده",
    description: "پیام برای مدیران، کاربران متأثر، تیم فنی یا صفحهٔ وضعیت: اثر، راه‌حل موقت، زمان تخمینی و زمان پیام بعدی",
    module: "incident",
    catalog: ["INC-049", "AI-030"],
    target: "record",
    tables: ["incident"],
    output: "json",
    schema: z.object({ subject: z.string().max(200), body: z.string().max(8000) }),
    tier: "standard",
    inputs: { journal: "all", journalLimit: 30 },
    params: [
      {
        name: "audience",
        label: "مخاطب",
        type: "choice",
        default: "stakeholders",
        choices: [
          { value: "stakeholders", label: "ذی‌نفعان" },
          { value: "executives", label: "مدیران ارشد" },
          { value: "users", label: "کاربران متأثر" },
          { value: "technical", label: "تیم‌های فنی" },
          { value: "status_page", label: "صفحهٔ وضعیت" },
        ],
      },
    ],
    roles: ["agent"],
    surfaces: ["panel", "module"],
    order: 50,
    system: `کار تو: پیش‌نویس پیام اطلاع‌رسانی یک رخداد عمده برای مخاطب خواسته‌شده: چه چیزی متأثر است، از کی، راه‌حل موقت، زمان تخمینی (فقط اگر در داده هست) و زمان پیام بعدی. برای مدیران و کاربران بی‌اصطلاح فنی و کوتاه؛ برای تیم فنی دقیق‌تر. پیام برای «صفحهٔ وضعیت» و «کاربران متأثر» هیچ جزئیات داخلی، نام کارشناس یا علت حدسی ندارد.`,
    template: "مخاطب: {{params.audience}}\n\nرخداد:\n{{record}}\n\nیادداشت‌ها و پاسخ‌ها:\n{{journal}}",
  }),
  defineSkill({
    key: "incident.handover",
    name: "خلاصهٔ تحویل شیفت",
    description: "رخدادهای باز گروه‌های شما: آنچه فوری است، آنچه منتظر است و آنچه شیفت بعد باید پیگیری کند",
    module: "incident",
    catalog: ["AI-024"],
    target: "none",
    tables: ["incident"],
    output: "text",
    tier: "standard",
    roles: ["agent"],
    surfaces: ["module"],
    system: `کار تو: خلاصهٔ تحویل شیفت از فهرست رخدادهای باز: «فوری» (اولویت بالا یا نزدیک به نقض توافق)، «در انتظار» (با دلیل)، «برای پیگیری شیفت بعد». هر مورد با شماره و یک خط. فقط رخدادهای فهرست.`,
    template: "امروز: {{today}}\n\nرخدادهای باز گروه‌های من:\n{{open}}",
    factKeys: ["open"],
    facts: async (ctx) => ({ open: await openIncidents(ctx) }),
    fallback: async (ctx) => {
      const open = await openIncidents(ctx);
      if (!open.length) return { text: "رخداد بازی در گروه‌های شما نیست." };
      return { text: open.map((x) => `- ${x["شماره"]} — ${x["عنوان"]} (${x["وضعیت"]}${x["دلیل_انتظار"] ? `، ${x["دلیل_انتظار"]}` : ""})`).join("\n") };
    },
  }),
];

export const problemSkills: SkillDef[] = [
  defineSkill({
    key: "problem.rca",
    name: "پیش‌نویس تحلیل علت ریشه‌ای",
    description: "پنج چرا، نمودار استخوان ماهی، فرضیه‌ها با شاهد و نتیجه‌گیری پیشنهادی — برای ادغام در بوم تحلیل",
    module: "problem",
    catalog: ["PRB-018", "AI-031"],
    target: "record",
    tables: ["problem"],
    output: "json",
    schema: z.object({
      whys: z.array(z.object({ question: z.string().max(500), answer: z.string().max(1000) })).max(7),
      fishbone: z.record(z.string(), z.array(z.string().max(300)).max(8)),
      hypotheses: z.array(z.object({ text: z.string().max(600), evidence: z.string().max(600).optional(), confidence: z.enum(["low", "medium", "high"]).optional() })).max(8),
      conclusion: z.string().max(2000),
    }),
    tier: "reasoning",
    grounding: { kind: "similar", k: 3 },
    inputs: { journal: "all", journalLimit: 40, related: [{ table: "problem_task", field: "problem_id", label: "کارهای مشکل", fields: ["number", "short_description", "state", "close_notes"], limit: 20 }] },
    roles: ["agent"],
    fieldGroups: ["internal"],
    surfaces: ["module", "panel"],
    system: `کار تو: پیش‌نویس تحلیل علت ریشه‌ای یک مشکل. «پنج چرا» با پرسش و پاسخ، استخوان ماهی با کلیدهای ${FISHBONE.map((f) => f.key).join("، ")}، فرضیه‌ها هر کدام با شاهد از داده و اطمینان، و نتیجه‌گیری. هر ادعایی باید به داده یا منبعی اشاره کند؛ اگر شاهد کافی نیست، همین را در نتیجه‌گیری بنویس («شاهد کافی نیست»).`,
    template: "مشکل:\n{{record}}\n\nکارها:\n{{related}}\n\nیادداشت‌ها:\n{{journal}}\n\nرخدادها و رکوردهای پیوندشده:\n{{links}}",
  }),
  defineSkill({
    key: "problem.known_error",
    name: "پیش‌نویس خطای شناخته‌شده",
    description: "عنوان، نشانه‌ها، علت و راه‌حل موقت برای ثبت خطای شناخته‌شده از این مشکل",
    module: "problem",
    catalog: ["PRB-021"],
    target: "record",
    tables: ["problem"],
    output: "json",
    schema: z.object({ short_description: z.string().max(200), symptoms: z.string().max(8000), workaround: z.string().max(8000), root_cause: z.string().max(8000).optional() }),
    tier: "standard",
    inputs: { journal: "all", journalLimit: 30 },
    roles: ["agent"],
    fieldGroups: ["internal"],
    surfaces: ["module"],
    system: `کار تو: پیش‌نویس خطای شناخته‌شده از یک مشکل: عنوانی که کارشناس میز خدمت جست‌وجو می‌کند، نشانه‌ها همان‌طور که کاربر می‌بیند، علت (اگر معلوم است) و راه‌حل موقت گام‌به‌گام. فقط از داده.`,
    template: "مشکل:\n{{record}}\n\nیادداشت‌ها:\n{{journal}}",
  }),
  defineSkill({
    key: "problem.summary",
    name: "خلاصهٔ مشکل",
    description: "خلاصهٔ مشکل، رخدادهای آن، تحلیل تاکنون و کارهای باز",
    module: "problem",
    catalog: ["PRB-027", "AI-023"],
    target: "record",
    tables: ["problem"],
    output: "text",
    tier: "fast",
    inputs: { journal: "all", journalLimit: 30, related: [{ table: "problem_task", field: "problem_id", label: "کارهای مشکل", fields: ["number", "short_description", "state"], limit: 20 }] },
    surfaces: ["panel", "module"],
    order: 5,
    system: `کار تو: خلاصهٔ یک مشکل با بخش‌های «مسئله و اثر»، «رخدادهای مرتبط»، «تحلیل تاکنون»، «کارهای باز و گام بعدی».`,
    template: "مشکل:\n{{record}}\n\nکارها:\n{{related}}\n\nیادداشت‌ها:\n{{journal}}\n\nپیوندها:\n{{links}}",
    fallback: async (_ctx, input) => ruleSummary(input),
  }),
];

/** The open incidents of the caller's groups and their own (their access), for the handover summary. */
async function openIncidents(ctx: Ctx): Promise<Record<string, unknown>[]> {
  const r = await list(ctx, "incident", {
    filter: { and: [{ f: "active", op: "eq", v: true }, { or: [{ f: "assignment_group_id", op: "in_my_groups" }, { f: "assigned_to", op: "is_me" }] }] },
    sort: "priority,sla_due",
    size: 40,
    fields: ["number", "short_description", "state", "priority", "assigned_to", "sla_due", "hold_reason"],
    total: false,
  }).catch(() => null);
  return (r?.rows ?? []).map((x) => ({ شماره: x.number, عنوان: x.short_description, وضعیت: x.state, اولویت: x.priority, کارشناس: x.assigned_to ? (r!.display[String(x.assigned_to)] ?? null) : null, موعد: x.sla_due ?? null, دلیل_انتظار: x.hold_reason ?? null }));
}

/** Options of choice fields of a table as the organisation configured them (the values a skill may suggest). */
export async function tableChoiceFacts(ctx: Ctx, table: string, names: string[]) {
  const schema = await orgSchema(ctx);
  const def = schema.def(table);
  const out: Record<string, { value: string; label: string }[]> = {};
  for (const n of names) {
    const f = def?.fields.find((x) => x.name === n);
    if (!f) continue;
    const opts = Array.isArray(f.choices) ? f.choices : typeof f.choices === "string" ? schema.choices(f.choices) : [];
    out[n] = opts.filter((o) => o.active !== false).map((o) => ({ value: o.value, label: o.label }));
  }
  return out;
}


/** The modules' extension points, implemented with the skills above (the caller's ctx throughout). */
export function installIncidentAi(): (() => void)[] {
  const offIncident = registerIncidentAi({
    async summarize(ctx, incidentId) {
      const r = await runForModule(ctx, "incident.summary", { table: "incident", id: incidentId });
      return { text: r.text ?? "", citations: [] };
    },
    async similar(ctx, incidentId, opts) {
      // retrieval with the caller's access (no model): the incident's own words against the index of incidents
      const inc = (await get(ctx, "incident", incidentId)).row;
      const q = `${String(inc.short_description ?? "")} ${String(inc.description ?? "").slice(0, 400)}`.trim();
      if (q.length < 3) return [];
      const r = await retrieve(ctx, q, { tables: ["incident"], k: Math.min(opts.limit + 1, 20) });
      const best = Math.max(...r.passages.map((p) => p.score), 1e-9);
      const seen = new Set<string>();
      return r.passages
        .filter((p) => p.citation.id !== incidentId && !seen.has(p.citation.id) && seen.add(p.citation.id))
        .slice(0, opts.limit)
        .map((p) => ({ id: p.citation.id, score: Math.max(0, Math.min(1, p.score / best)) }));
    },
    async triage(ctx, draft) {
      const text = [draft.short_description, draft.description].filter((x) => typeof x === "string" && x.trim()).join("\n");
      if (text.trim().length < 3) return [];
      const r = await runForModule(ctx, "incident.triage_text", { text });
      const out = ((r.json as { suggestions?: { field: string; value: string; confidence: number; reason?: string }[] } | null)?.suggestions ?? []).filter((s) => s.value);
      const groups = await groupsFacts(ctx);
      return out
        .map((s) => (s.field === "assignment_group_id" ? { ...s, value: groups.find((g) => g.name === s.value || g.id === s.value)?.id ?? null } : s))
        .filter((s) => s.value !== null);
    },
    async suggestResolution(ctx, incidentId) {
      const r = await runForModule(ctx, "incident.resolution", { table: "incident", id: incidentId });
      const by = (f: string) => r.suggestions.find((s) => s.field === f);
      const notes = by("close_notes");
      return { close_notes: String(notes?.value ?? ""), close_code: by("close_code") ? String(by("close_code")!.value) : undefined, confidence: notes?.confidence ?? undefined };
    },
    async draftKnowledge(ctx, incidentId) {
      const r = await runForModule(ctx, "incident.kb_draft", { table: "incident", id: incidentId });
      const j = (r.json ?? {}) as { title?: string; body?: string };
      return { title: String(j.title ?? ""), body: String(j.body ?? "") };
    },
    async draftUpdate(ctx, incidentId, audience) {
      const allowed = ["stakeholders", "executives", "users", "technical", "status_page"];
      const r = await runForModule(ctx, "incident.stakeholder_update", { table: "incident", id: incidentId, params: { audience: allowed.includes(audience) ? audience : "stakeholders" } });
      const j = (r.json ?? {}) as { subject?: string; body?: string };
      return { subject: String(j.subject ?? ""), body: String(j.body ?? "") };
    },
  });
  const offProblem = registerProblemAi({
    async draftRca(ctx, problemId): Promise<Partial<RcaCanvas>> {
      const r = await runForModule(ctx, "problem.rca", { table: "problem", id: problemId });
      const j = (r.json ?? {}) as { whys?: RcaCanvas["whys"]; fishbone?: Record<string, string[]>; hypotheses?: { text: string; evidence?: string; confidence?: "low" | "medium" | "high" }[]; conclusion?: string };
      const keys = new Set(FISHBONE.map((f) => f.key));
      return {
        whys: (j.whys ?? []).map((w) => ({ question: String(w.question ?? ""), answer: String(w.answer ?? "") })),
        fishbone: Object.fromEntries(Object.entries(j.fishbone ?? {}).filter(([k]) => keys.has(k)).map(([k, v]) => [k, (v ?? []).map(String)])),
        hypotheses: (j.hypotheses ?? []).map((h, i) => ({ id: `ai${i + 1}`, text: String(h.text ?? ""), evidence: h.evidence ? String(h.evidence) : undefined, status: "open" as const, confidence: h.confidence })),
        conclusion: String(j.conclusion ?? ""),
      };
    },
    // the module falls back to the problem's own fields when this throws (no model, no draft)
    async draftKnownError(ctx, problemId) {
      const r = await runForModule(ctx, "problem.known_error", { table: "problem", id: problemId });
      const j = (r.json ?? {}) as { short_description?: string; symptoms?: string; workaround?: string; root_cause?: string };
      return { short_description: String(j.short_description ?? ""), symptoms: String(j.symptoms ?? ""), workaround: String(j.workaround ?? ""), root_cause: j.root_cause ? String(j.root_cause) : undefined };
    },
    async summarize(ctx, problemId) {
      const r = await runForModule(ctx, "problem.summary", { table: "problem", id: problemId });
      return { text: r.text ?? "" };
    },
  });
  return [offIncident, offProblem];
}
