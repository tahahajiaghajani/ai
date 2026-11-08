// Generic skills for any table (catalogue AI-023, AI-026, AI-027, AI-028): a state-aware summary of a record, an
// explanation of its history, a reply to the requester and an internal note drafted for the composer, and the writing
// tools of rich-text fields, the composer and the KB editor (improve, shorten, formal register, tone, fix, translate
// fa⇄en and the editor's other rewrites). Every one reads only what the caller may read (the runtime's rules).
import type { TableDef } from "@shared/model/types";
import { formatJalaliDateTime } from "@shared/jalali";
import { listHistory } from "../../../../engine";
import { orgTimeZone } from "../../usage";
import type { SkillDef, SkillRawOutput, SkillRuntimeInput } from "../types";
import { defineSkill } from "../registry";

const CONFIG_MODULES = new Set(["ai", "access", "core", "notify", "flows", "sla"]);

/** Records people work on (not configuration tables of the platform). */
export const workRecord = (t: TableDef) => !CONFIG_MODULES.has(t.module) && !t.virtual && !t.scope?.public;
/** Tables with a conversation: the composer's drafts. */
const conversational = (t: TableDef) => workRecord(t) && !!t.features?.journal;

/** A rule-based summary: the record's main fields and its latest entries (no model). */
export function ruleSummary(input: SkillRuntimeInput): SkillRawOutput {
  const r = input.record;
  if (!r) return { text: "" };
  const pick = ["state", "priority", "assignment_group_id", "assigned_to", "category", "caller_id", "due_at", "sla_due"];
  const lines = [`**${r.number ? `${r.number} — ` : ""}${r.title || r.table_label}**`, ""];
  for (const f of r.fields.filter((x) => pick.includes(x.name))) lines.push(`- ${f.label}: ${Array.isArray(f.value) ? f.value.join("، ") : String(f.value)}`);
  const desc = r.fields.find((f) => f.name === "description");
  if (desc) lines.push("", String(desc.value).slice(0, 400));
  const last = input.journal.slice(-3);
  if (last.length) {
    lines.push("", "**آخرین یادداشت‌ها**");
    for (const j of last) lines.push(`- ${j.kind_label}${j.author ? ` (${j.author})` : ""}: ${j.body.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return { text: lines.join("\n") };
}

const PERSIAN_FIX: [RegExp, string][] = [
  [/ي/g, "ی"],
  [/ك/g, "ک"],
  [/ى/g, "ی"],
  [/ ([،؛؟.!:])/g, "$1"],
  [/([،؛؟])(?=[^\s\d])/g, "$1 "],
  [/ +/g, " "],
  [/(\S) ?(ها|های|هایی|تر|ترین)(?=[\s.،؛؟!]|$)/g, "$1‌$2"],
  [/(^|\s)(ن?می) (?=\S)/g, "$1$2‌"],
];

/** Rule-based typography fixes of Persian text (no model): Arabic letters, spacing around punctuation, half-spaces. */
export function fixPersian(text: string): string {
  let t = text;
  for (const [re, to] of PERSIAN_FIX) t = t.replace(re, to);
  return t.trim();
}

const SUMMARY_SYSTEM = `کار تو: خلاصه‌ای کوتاه، دقیق و بخش‌بندی‌شده از یک رکورد برای همکاری که تازه به آن رسیده است.
بخش‌ها (هر کدام که داده دارد): «وضعیت کنونی»، «مسئله»، «کارهای انجام‌شده»، «گام بعدی». از عددها، تاریخ‌ها و نام‌ها فقط همان‌هایی را بیاور که در داده هست.`;

const REPLY_SYSTEM = `کار تو: پیش‌نویس پاسخی محترمانه و روشن به درخواست‌کننده، از زبان کارشناس پشتیبانی.
- فقط از شرح رکورد، پاسخ‌های عمومی و منابع دانش استفاده کن؛ هیچ جزئیات داخلی، نام همکاران دیگر، علت‌های حدسی یا تعهد زمانی‌ای که در داده نیست ننویس.
- اگر مقاله‌ای از منابع به کار درخواست‌کننده می‌آید، عنوانش را بیاور و ارجاع بده.
- کوتاه بنویس: سلام، پاسخ یا درخواست اطلاعات، گام بعدی، پایان مؤدبانه. امضا نگذار.`;

const NOTE_SYSTEM = `کار تو: پیش‌نویس یادداشت داخلی کارشناسان برای این رکورد: آنچه تاکنون انجام شده، یافته‌ها و گام بعدی، در چند خط فهرست‌وار.`;

const HISTORY_SYSTEM = `کار تو: توضیح ساده و زمانی تاریخچهٔ تغییرهای یک رکورد: چه کسی، کی، چه چیزی را عوض کرد و این تغییرها روی هم چه داستانی می‌گویند (واگذاری‌ها، تغییر اولویت، انتظارها، بازگشایی‌ها). بی‌حدس دربارهٔ انگیزه‌ها.`;

export const genericSkills: SkillDef[] = [
  defineSkill({
    key: "record.summary",
    name: "خلاصهٔ رکورد",
    description: "خلاصهٔ بخش‌بندی‌شده از وضعیت، مسئله، کارهای انجام‌شده و گام بعدی، از آنچه شما می‌بینید",
    module: "generic",
    catalog: ["AI-023"],
    target: "record",
    tables: "*",
    when: workRecord,
    output: "text",
    tier: "fast",
    inputs: { journal: "all", journalLimit: 30 },
    surfaces: ["panel"],
    icon: "list",
    order: 10,
    system: SUMMARY_SYSTEM,
    template: "رکورد:\n{{record}}\n\nیادداشت‌ها و پاسخ‌ها (قدیمی به تازه):\n{{journal}}\n\nرکوردهای پیوندشده:\n{{links}}\n\nخلاصه را بنویس.",
    fallback: async (_ctx, input) => ruleSummary(input),
  }),
  defineSkill({
    key: "record.history",
    name: "توضیح تاریخچه",
    description: "روایت زمانی تغییرهای فیلدهایی که می‌بینید: واگذاری‌ها، اولویت‌ها، انتظارها و بازگشایی‌ها",
    module: "generic",
    catalog: ["AI-023"],
    target: "record",
    tables: "*",
    when: (t) => workRecord(t) && t.features?.history !== false,
    output: "text",
    tier: "fast",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    icon: "history",
    order: 20,
    system: HISTORY_SYSTEM,
    template: "رکورد:\n{{record}}\n\nتغییرها (قدیمی به تازه):\n{{history}}\n\nتاریخچه را توضیح بده.",
    factKeys: ["history"],
    facts: async (ctx, input) => {
      if (!input.record) return { history: [] };
      const tz = orgTimeZone(ctx);
      // the engine leaves out fields the caller may not see
      const h = await listHistory(ctx, input.record.table, input.record.id, { limit: 60 }).catch(() => ({ entries: [], display: {} as Record<string, string> }));
      const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? ((h.display as Record<string, string>)[v] ?? v).slice(0, 300) : JSON.stringify(v).slice(0, 300));
      return {
        history: [...h.entries].reverse().map((e) => ({ فیلد: e.label, از: show(e.old), به: show(e.new), توسط: e.actor ? ((h.display as Record<string, string>)[e.actor] ?? "—") : "سامانه", زمان: formatJalaliDateTime(e.at, tz) })),
      };
    },
    fallback: async (ctx, input) => {
      if (!input.record) return { text: "" };
      const tz = orgTimeZone(ctx);
      const h = await listHistory(ctx, input.record.table, input.record.id, { limit: 30 }).catch(() => ({ entries: [], display: {} as Record<string, string> }));
      const d = h.display as Record<string, string>;
      const lines = [...h.entries].reverse().map((e) => `- ${formatJalaliDateTime(e.at, tz)} — ${e.actor ? (d[e.actor] ?? "—") : "سامانه"}: «${e.label}» ${e.old === null || e.old === undefined ? "" : `از ${typeof e.old === "string" ? (d[e.old] ?? e.old) : JSON.stringify(e.old)} `}به ${typeof e.new === "string" ? (d[e.new] ?? e.new) : JSON.stringify(e.new)}`);
      return { text: lines.length ? lines.join("\n") : "تغییری ثبت نشده است." };
    },
  }),
  defineSkill({
    key: "reply.draft",
    name: "پیش‌نویس پاسخ به درخواست‌کننده",
    description: "پاسخی محترمانه از شرح رکورد، پاسخ‌های عمومی و پایگاه دانش — بی یادداشت‌های داخلی؛ پیش از فرستادن بازبینی کنید",
    module: "generic",
    catalog: ["AI-026"],
    target: "record",
    tables: "*",
    when: conversational,
    output: "journal",
    journalKind: "comment",
    tier: "standard",
    grounding: { kind: "knowledge", k: 3 },
    // a reply goes to the requester: internal notes never reach its prompt, whoever drafts it
    inputs: { journal: "public", journalLimit: 20, links: false },
    params: [
      {
        name: "intent",
        label: "هدف پاسخ",
        type: "choice",
        default: "update",
        choices: [
          { value: "update", label: "گزارش پیشرفت" },
          { value: "acknowledge", label: "اعلام دریافت" },
          { value: "ask_info", label: "درخواست اطلاعات بیشتر" },
          { value: "propose_closure", label: "پیشنهاد بستن" },
          { value: "follow_up", label: "پیگیری" },
        ],
      },
      { name: "notes", label: "نکته‌ای برای پاسخ", type: "text", max: 1000 },
    ],
    roles: ["agent"],
    surfaces: ["composer", "panel"],
    composer: "comment",
    icon: "reply",
    order: 30,
    system: REPLY_SYSTEM,
    template: "رکورد:\n{{record}}\n\nپاسخ‌های عمومی تاکنون:\n{{journal}}\n\nهدف پاسخ: {{params.intent}}\nنکتهٔ کارشناس: {{params.notes}}\n\nپیش‌نویس پاسخ را بنویس.",
  }),
  defineSkill({
    key: "note.draft",
    name: "پیش‌نویس یادداشت داخلی",
    description: "یادداشت فهرست‌وار کارشناسان: کارهای انجام‌شده، یافته‌ها و گام بعدی",
    module: "generic",
    catalog: ["AI-023"],
    target: "record",
    tables: "*",
    when: conversational,
    output: "journal",
    journalKind: "work_note",
    tier: "fast",
    inputs: { journal: "all", journalLimit: 30 },
    roles: ["agent"],
    fieldGroups: ["internal"],
    surfaces: ["composer"],
    composer: "work_note",
    icon: "notebook-pen",
    order: 40,
    system: NOTE_SYSTEM,
    template: "رکورد:\n{{record}}\n\nیادداشت‌ها و پاسخ‌ها:\n{{journal}}\n\nیادداشت داخلی را بنویس.",
  }),
];

// ---------------------------------------------------------------- the writing tools

const WRITE_BASE = `کار تو: بازنویسی متنی که در بلوک text آمده است. هیچ واقعیت، نام، عدد، تنظیم یا دستور فنی تازه‌ای نیفزا و هیچ‌کدام را حذف نکن، مگر کار خواسته‌شده همین باشد. Markdown، بلوک‌های کد و دستورها را دست‌نخورده نگه دار. فقط متن نهایی را برگردان، بی‌مقدمه.`;

const HOUSE_STYLE = { name: "house_style", label: "سبک نگارش", type: "text" as const, max: 1000 };

function writeSkill(key: string, name: string, description: string, instruction: string, extra: Partial<SkillDef> = {}): SkillDef {
  return defineSkill({
    key,
    name,
    description,
    module: "generic",
    catalog: ["AI-027"],
    target: "text",
    tables: "*",
    output: "text",
    tier: "fast",
    inputs: { journal: "none", links: false },
    surfaces: ["composer", "field"],
    icon: "wand",
    order: 60,
    system: `${WRITE_BASE}\n${instruction}`,
    template: "سبک نگارش این سازمان یا پایگاه (اگر هست): {{params.house_style}}\n\nمتن:\n{{text}}",
    maxTokens: 6000,
    ...extra,
    params: [...(extra.params ?? []), ...(extra.params?.some((p) => p.name === "house_style") ? [] : [HOUSE_STYLE])],
  });
}

/** The KB editor's other rewrites (one skill, the action as a parameter). */
export const REWRITE_ACTIONS: Record<string, { label: string; instruction: string }> = {
  expand: { label: "کامل‌تر", instruction: "متن را کامل‌تر کن: توضیح کوتاهی که خواننده لازم دارد بیفزا، اما هیچ واقعیت، تنظیم یا دستوری نساز." },
  simplify: { label: "ساده‌تر", instruction: "متن را با زبان ساده و روزمره برای خوانندهٔ غیرفنی بازنویسی کن." },
  steps: { label: "گام‌های شماره‌دار", instruction: "روال متن را به فهرست شماره‌دار از گام‌های کوتاه و وارسی‌پذیر تبدیل کن؛ دستورها را در قالب کد نگه دار." },
  title: { label: "پیشنهاد عنوان", instruction: "یک عنوان (حداکثر ۱۲ واژه) بنویس که مسئله یا کار را همان‌طور بگوید که کاربر جست‌وجویش می‌کند. فقط عنوان را برگردان." },
  summary: { label: "پیشنهاد خلاصه", instruction: "یک یا دو جمله خلاصه برای کارت نتیجهٔ جست‌وجو بنویس. فقط خلاصه را برگردان." },
  portal: { label: "زبان کاربر", instruction: "اصطلاحات داخلی کارشناسان را با واژه‌هایی که کاربران می‌فهمند جایگزین کن و معنا را نگه دار." },
};

export const writingSkills: SkillDef[] = [
  writeSkill("text.improve", "بهتر نوشتن", "متن را روشن‌تر و منظم‌تر می‌کند و همهٔ واقعیت‌ها را نگه می‌دارد", "متن را روشن‌تر و منظم‌تر بنویس."),
  writeSkill("text.shorten", "کوتاه‌تر", "متن را کوتاه می‌کند بی‌آنکه گامی یا واقعیتی بیفتد", "متن را به‌طور محسوسی کوتاه‌تر کن، بی‌آنکه هیچ گام، دستور یا واقعیتی از دست برود."),
  writeSkill("text.formal", "رسمی‌تر", "بازنویسی به نثر رسمی اداری فارسی", "متن را به نثر رسمی و اداری بازنویسی کن."),
  writeSkill("text.tone", "تغییر لحن", "لحن دوستانه، همدلانه یا خنثی", "لحن متن را به لحن خواسته‌شده در پارامترها تغییر بده و معنا را نگه دار.", {
    params: [{ name: "tone", label: "لحن", type: "choice", default: "friendly", choices: [{ value: "friendly", label: "دوستانه" }, { value: "sympathetic", label: "همدلانه" }, { value: "neutral", label: "خنثی" }] }],
    template: "لحن خواسته‌شده: {{params.tone}}\nسبک نگارش: {{params.house_style}}\n\nمتن:\n{{text}}",
  }),
  writeSkill("text.fix", "درست کردن نگارش", "املا، دستور زبان، نشانه‌گذاری و نیم‌فاصله‌ها", "فقط املا، دستور زبان، نشانه‌گذاری و نگارش فارسی (نیم‌فاصله، «ی» و «ک») را درست کن و هیچ چیز دیگری را تغییر نده.", {
    fallback: async (_ctx, input) => ({ text: fixPersian(input.text ?? "") }),
  }),
  writeSkill("text.translate", "ترجمه", "ترجمهٔ فارسی ⇄ انگلیسی با نگه‌داشتن قالب، کد و دستورها", "متن را به زبان مقصد ترجمه کن؛ ساختار Markdown، کدها و دستورها را بی‌تغییر نگه دار و اصطلاحات فنی رایج را درست برگردان.", {
    catalog: ["AI-027", "AI-028"],
    params: [{ name: "language", label: "به زبان", type: "choice", default: "en", choices: [{ value: "en", label: "انگلیسی" }, { value: "fa", label: "فارسی" }] }],
    template: "زبان مقصد: {{language}}\n\nمتن:\n{{text}}",
    order: 70,
  }),
  writeSkill("text.rewrite", "بازنویسی", "کامل‌تر، ساده‌تر، گام‌به‌گام، عنوان، خلاصه یا زبان کاربر", "دستور ویژهٔ بازنویسی در بلوک instruction آمده است؛ همان را انجام بده.", {
    params: [
      { name: "action", label: "کار", type: "choice", required: true, default: "expand", choices: Object.entries(REWRITE_ACTIONS).map(([value, a]) => ({ value, label: a.label })) },
      { name: "house_style", label: "سبک نگارش پایگاه دانش", type: "text", max: 1000 },
    ],
    factKeys: ["instruction"],
    facts: async (_ctx, input) => ({ instruction: REWRITE_ACTIONS[String(input.params.action)]?.instruction ?? REWRITE_ACTIONS.expand.instruction }),
    template: "{{instruction}}\nسبک نگارش این پایگاه: {{params.house_style}}\n\nمتن:\n{{text}}",
    surfaces: ["field"],
    order: 80,
  }),
];
