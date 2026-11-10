// AI skills of customer service management (docs/spec/AI.md §11; catalogue CSM-039/040):
//   · `csm.case_reply` — a reply to the customer, drafted for the agent to review before sending: it reads the
//     case and the PUBLIC conversation only (internal work notes never reach a customer-facing prompt — CSM-014),
//     the customer-safe facts of the entitlement (support level, targets) and knowledge passages the agent may read;
//     the rule-based fallback writes the same kinds of reply from templates
//   · `csm.case_triage` — case type, priority and the complaint flag suggested from the customer's words, with the
//     keyword rules of @shared/csm/logic as the fallback (the agent applies a suggestion; nothing changes by itself)
import { customerStatusOf, triageText } from "@shared/csm/logic";
import type { Ctx } from "../../context";
import { get } from "../../engine";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import type { SkillDef, SkillRuntimeInput } from "../ai/skills/types";

/** What a reply may tell the customer about their entitlement (no money, no internal routing). */
async function replyFacts(ctx: Ctx, input: SkillRuntimeInput): Promise<Record<string, unknown>> {
  if (!input.id) return {};
  const { row } = await get(ctx, "customer_case", input.id);
  const snap = (row.entitlement_snapshot as Record<string, unknown> | null) ?? null;
  return {
    customer_status: customerStatusOf(row.state),
    entitlement: snap ? { support_level: snap.support_level ?? null, response_hours: snap.response_hours ?? null, resolution_hours: snap.resolution_hours ?? null } : null,
  };
}

const field = (input: SkillRuntimeInput, name: string): string => {
  const f = input.record?.fields.find((x) => x.name === name);
  return f && f.value !== null && f.value !== undefined ? String(f.value) : "";
};

/** The rule-based reply (no model): an acknowledgement, a progress update, a question or a closing proposal. */
function replyFallback(input: SkillRuntimeInput): string {
  const intent = String(input.params.intent ?? "update");
  const number = input.record?.number ?? "";
  const subject = field(input, "short_description");
  const notes = String(input.params.notes ?? "").trim();
  const open = "مشتری گرامی، سلام.";
  const close = "با سپاس از شکیبایی شما\nپشتیبانی مشتریان";
  const body: Record<string, string> = {
    acknowledge: `درخواست شما با شمارهٔ ${number} («${subject}») دریافت شد و کارشناسان ما بررسی آن را آغاز کرده‌اند. نتیجه را از همین‌جا به شما اطلاع می‌دهیم.`,
    update: `بررسی درخواست ${number} («${subject}») ادامه دارد.${notes ? ` ${notes}` : ""} به محض پیشرفت تازه، به شما خبر می‌دهیم.`,
    ask_info: `برای ادامهٔ بررسی درخواست ${number} به اطلاعات بیشتری نیاز داریم.${notes ? ` ${notes}` : " لطفاً جزئیات بیشتر، زمان رخ دادن و تصویر خطا (اگر دارید) را بفرستید."}`,
    propose_closure: `درخواست ${number} («${subject}») حل شده است.${notes ? ` ${notes}` : ""} اگر مشکل برطرف شده، لطفاً راه‌حل را بپذیرید؛ در غیر این صورت همین‌جا پاسخ دهید تا بررسی ادامه یابد.`,
  };
  return `${open}\n\n${body[intent] ?? body.update}\n\n${close}`;
}

export const csmSkills: SkillDef[] = [
  defineSkill({
    key: "csm.case_reply",
    name: "پیش‌نویس پاسخ به مشتری",
    description: "پاسخ محترمانه به مشتری از شرح پرونده، گفت‌وگوی عمومی و دانش — بی یادداشت‌های داخلی؛ پیش از فرستادن بازبینی کنید",
    module: "csm",
    catalog: ["CSM-039", "CSM-014"],
    target: "record",
    tables: ["customer_case"],
    output: "journal",
    journalKind: "comment",
    tier: "standard",
    grounding: { kind: "knowledge", k: 3 },
    // a customer-facing prompt: public replies only, whoever drafts it
    inputs: { journal: "public", journalLimit: 20, links: false, fields: ["number", "short_description", "description", "case_type", "state", "priority", "product_id", "complaint"] },
    params: [
      {
        name: "intent", label: "هدف پاسخ", type: "choice", default: "update",
        choices: [{ value: "acknowledge", label: "اعلام دریافت" }, { value: "update", label: "گزارش پیشرفت" }, { value: "ask_info", label: "درخواست اطلاعات" }, { value: "propose_closure", label: "پیشنهاد بستن" }],
      },
      { name: "notes", label: "نکته‌ای برای پاسخ", type: "text", max: 1000 },
    ],
    roles: ["csm_agent"],
    surfaces: ["composer", "panel"],
    composer: "comment",
    icon: "reply",
    order: 10,
    system: "کار تو: پیش‌نویس پاسخی محترمانه، روشن و کوتاه به مشتری بیرونی به فارسی رسمی. فقط از پرونده، پاسخ‌های عمومی، بلوک facts و منابع داده‌شده استفاده کن؛ دربارهٔ کارهای داخلی، نام کارشناسان، سامانه‌ها یا علت‌های فنی حدسی چیزی نگو؛ زمانی را وعده نده مگر از هدف‌های استحقاق در facts. اگر مشتری ناراضی است، همدلی کن و قدم بعدی را روشن بگو.",
    template: "پرونده:\n{{record}}\n\nوضعیت از نگاه مشتری و استحقاق:\n{{facts}}\n\nگفت‌وگوی عمومی تاکنون:\n{{journal}}\n\nمنابع دانش:\n{{passages}}\n\nهدف پاسخ: {{params.intent}}\nنکتهٔ کارشناس: {{params.notes}}\n\nپیش‌نویس پاسخ را بنویس.",
    factKeys: ["facts"],
    facts: async (ctx, input) => ({ facts: await replyFacts(ctx, input) }),
    fallback: async (_ctx, input) => ({ journal: { kind: "comment", body: replyFallback(input) } }),
  }),
  defineSkill({
    key: "csm.case_triage",
    name: "دسته‌بندی و اولویت پروندهٔ مشتری",
    description: "نوع پرونده (پرسش، اشکال، درخواست، پیشنهاد، شکایت)، اولویت و نشانهٔ شکایت از متن مشتری",
    module: "csm",
    catalog: ["CSM-040", "CSM-019"],
    target: "record",
    tables: ["customer_case"],
    output: "fields",
    outputFields: ["case_type", "priority", "complaint"],
    tier: "fast",
    inputs: { journal: "public", journalLimit: 5, links: false, fields: ["short_description", "description", "case_type", "priority", "complaint", "channel"] },
    roles: ["csm_agent"],
    surfaces: ["panel"],
    icon: "tags",
    order: 20,
    system: "کار تو: از متن مشتری، نوع پرونده (پرسش، اشکال، درخواست، پیشنهاد، شکایت)، اولویت (۲ فوری، ۳ عادی، ۴ کم) و اینکه شکایت است یا نه را پیشنهاد کن، هر کدام با دلیل کوتاه. اگر مطمئن نیستی، اطمینان کم بده.",
    template: "پرونده:\n{{record}}\n\nپاسخ‌های عمومی:\n{{journal}}\n\nگزینه‌ها:\n{{options}}",
    factKeys: ["options"],
    facts: async () => ({ options: { case_type: ["question", "problem", "request", "suggestion", "complaint"], priority: ["2", "3", "4"], complaint: [true, false] } }),
    fallback: async (_ctx, input) => {
      const t = triageText(`${field(input, "short_description")} ${field(input, "description")}`);
      const why = t.reasons.join("؛ ") || "قاعدهٔ واژه‌ها";
      return { suggestions: [{ field: "case_type", value: t.case_type, confidence: 0.6, reason: why }, { field: "priority", value: t.priority, confidence: 0.5, reason: why }, { field: "complaint", value: t.complaint, confidence: 0.6, reason: why }] };
    },
  }),
];

let installed = false;
export function installCsmSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return csmSkills.map((s) => registerSkill(s));
}
