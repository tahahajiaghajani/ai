import "server-only";
import { getUserKV, setUserKV } from "@/lib/settings";
import { db } from "@/lib/supabase/admin";
import { BASE, CODER_PROMPT, clearPromptCache, getAgentPrompt } from "@/lib/ai/prompts";
import type { AgentDef, Stage, WorkflowDef } from "@/lib/workflow/types";

const AGENTS_KEY = "agents";
const WORKFLOWS_KEY = "workflows";

/** Built-in agents of every user: always available; settings can be changed and prompts versioned per user. */
export const DEFAULT_AGENTS: AgentDef[] = [
  {
    id: "analyze",
    name: "تحلیل‌گر درخواست و فایل‌ها",
    description: "درخواست، فایل‌های پیوست و (اگر پروژه انتخاب شده) فایل‌های مرتبط پروژه را می‌خواند: سازوکار، داده‌ها، نام دقیق فیلدها و کمبودها",
    type: "llm",
    builtin: true,
    output: "text",
    attachments: true,
    knowledge: true,
    tools: true,
    thinking: "HIGH",
    color: "#8b5cf6",
    prompt: `${BASE}

نقش تو: «تحلیل‌گر». هنوز راه‌حل نساز؛ فقط درخواست و مواد موجود را عمیق و دقیق بفهم.
اگر پروژه‌ای انتخاب شده، با ابزارها فایل‌های مرتبط با درخواست را پیدا کن و بخوان (نه همه‌ی پروژه را) و مسیر دقیقشان را بنویس.
خروجی (Markdown، فشرده ولی کامل):
# درک درخواست
خروجی نهایی مورد انتظار در یک تا سه خط (قالب، تعداد فایل، محل استفاده) + فهرست نیازمندی‌ها با شماره.
# فایل‌های مرتبط
برای هر فایل (پیوست یا فایل پروژه، با مسیر دقیق): چیست، چطور کار می‌کند (سازوکار اصلی، روش دریافت/پردازش داده، ساختار، وابستگی‌ها) و چه بخش‌هایی مستقیماً قابل استفاده‌ی مجدد است. نام‌ها، آدرس‌ها، شناسه‌ها و نام داخلی فیلدها را عیناً نقل کن.
# منابع و داده‌های موجود
فهرست منابع داده (مثلاً لیست/جدول/API) و فیلدهای مرتبط با درخواست، با نام دقیق.
# نگاشت نیازمندی‌ها
برای هر نیازمندی: از کدام منبع/فیلد به دست می‌آید، یا «کمبود» است.
# کمبودها و سوال‌ها
فقط موارد واقعی و لازم.
# ساده‌ترین رویکرد درست
چند خط: چطور با تکیه بر مواد موجود انجامش بدهیم.
اگر فایلی در کار نیست، همین را صریح بگو و تحلیل را بر درخواست بنا کن.`,
  },
  {
    id: "brief",
    name: "نویسنده‌ی دستور کار",
    description: "دستور کار کوتاه و کامل برای مجری: خروجی نهایی، فایل‌هایی که باید تغییر کنند یا ساخته شوند، نگاشت داده، کمبودها، مراحل",
    type: "llm",
    builtin: true,
    output: "text",
    attachments: true,
    knowledge: true,
    thinking: "HIGH",
    color: "#7c3aed",
    prompt: `${BASE}

نقش تو: «نویسنده‌ی دستور کار». بر اساس درخواست، فایل‌ها و خروجی مراحل قبل، یک «دستور کار» کوتاه و کامل برای مجری نهایی بنویس.
فقط خود دستور کار را برگردان (Markdown، بدون مقدمه و توضیح اضافه) با همین بخش‌ها و فقط همین‌ها:
# هدف و خروجی نهایی — دقیقاً چه چیزی تحویل شود (نام، قالب و تعداد فایل)
# فایل‌هایی که تغییر می‌کنند یا ساخته می‌شوند — مسیر دقیق در پروژه و اینکه در هر کدام چه تغییری لازم است
# آنچه از فایل‌های موجود استفاده می‌شود — بخش‌ها، توابع، الگوها و تنظیماتی که باید کپی یا تقلید شوند (با نام دقیق)
# نگاشت نیازمندی‌ها به داده — جدول: نیازمندی | منبع و نام دقیق فیلد | وضعیت (موجود/کمبود)
# کمبودها — و اینکه در خروجی چطور علامت‌گذاری شوند
# مراحل انجام — ۳ تا ۸ گام، هر گام حداکثر ۳ خط «چطور»
# معیار پذیرش — چند بند قابل بررسی`,
  },
  {
    id: "helpers",
    name: "سازنده‌ی فایل‌های کمکی",
    description: "فقط اگر لازم باشد چند فایل کوچک و آماده (نگاشت فیلدها، پیکربندی، داده‌ی نمونه) می‌سازد",
    type: "llm",
    builtin: true,
    output: "files",
    maxFiles: 3,
    attachments: true,
    thinking: "MEDIUM",
    color: "#a855f7",
    prompt: `${BASE}

نقش تو: «آماده‌ساز فایل‌های کمکی». فقط اگر یک فایل کوچک و آماده (مثلاً نگاشت فیلدها به JSON، پیکربندی، کوئری یا داده‌ی نمونه) کار مجری را واقعاً سریع‌تر و دقیق‌تر می‌کند، آن را کامل بساز؛ در غیر این صورت فهرست خالی برگردان.
هرگز خود خروجی نهایی را نساز؛ آن کار مجری است.
برای هر فایل: name (نام ساده با پسوند)، purpose (یک خط) و content (محتوای کامل، بدون بلوک کد).`,
  },
  {
    id: "summary",
    name: "گزارش کوتاه",
    description: "پاسخ چت کوتاه: چه فهمید، رویکرد، کمبودهای مهم و آنچه آماده شد",
    type: "llm",
    builtin: true,
    output: "text",
    thinking: "LOW",
    color: "#6366f1",
    prompt: `${BASE}

نقش تو: «گزارش کوتاه». بر اساس خروجی مراحل قبل، یک پیام کوتاه مثل پاسخ چت بنویس (۴ تا ۱۰ خط Markdown): چه فهمیدی، رویکرد، کمبودهای مهم و اینکه چه چیزی آماده شد.
بدون سلام و تعارف؛ مستقیم از نتیجه شروع کن.`,
  },
  {
    id: "reviewer",
    name: "بازبین (شرط)",
    description: "بررسی می‌کند خروجی مرحله‌ی قبل درخواست را کامل پوشش می‌دهد؛ مسیر «بله» یا «خیر» را انتخاب می‌کند",
    type: "router",
    builtin: true,
    thinking: "MEDIUM",
    color: "#0ea5e9",
    prompt: `${BASE}

نقش تو: «بازبین». بررسی کن خروجی مراحل قبل، درخواست را کامل و درست پوشش می‌دهد یا نه.
decision = yes اگر کامل و قابل تحویل است؛ no اگر ایراد مهمی دارد.
در reason کوتاه و دقیق بگو چرا و (اگر no) دقیقاً چه چیزی باید اصلاح شود.`,
  },
  {
    id: "coder",
    name: "مجری",
    description: "فایل‌های پروژه را پیدا، ویرایش یا ایجاد می‌کند (ایجنت داخل اپ با هر مدل، یا Claude Code در GitHub Actions — طبق تنظیمات)",
    type: "coder",
    builtin: true,
    color: "#f97316",
    knowledge: true,
    attachments: true,
    engine: "",
    claude: { model: "", effort: "", thinking: "" },
    prompt: CODER_PROMPT,
  },
];

export const DEFAULT_WORKFLOWS: WorkflowDef[] = [
  {
    id: "prework-standard",
    name: "پیش‌کار استاندارد",
    description: "تحلیل ← دستور کار ← (فایل‌های کمکی ‖ گزارش کوتاه، هم‌زمان)",
    stage: "prework",
    isDefault: true,
    builtin: true,
    nodes: [
      // the canvas reads right-to-left like the rest of the app
      { id: "analyze", agentId: "analyze", x: 640, y: 120 },
      { id: "brief", agentId: "brief", saveAs: "BRIEF.md", appendInputs: true, brief: true, x: 320, y: 120 },
      { id: "helpers", agentId: "helpers", x: 0, y: 20 },
      { id: "summary", agentId: "summary", reply: true, x: 0, y: 220 },
    ],
    edges: [
      { id: "e1", source: "analyze", target: "brief" },
      { id: "e2", source: "brief", target: "helpers" },
      { id: "e3", source: "brief", target: "summary" },
    ],
  },
  {
    id: "main-standard",
    name: "کار اصلی استاندارد",
    description: "مجری کار را کامل انجام می‌دهد و فایل‌ها را در جای خودشان ویرایش یا ایجاد می‌کند",
    stage: "main",
    isDefault: true,
    builtin: true,
    nodes: [{ id: "coder", agentId: "coder", reply: true, x: 0, y: 100 }],
    edges: [],
  },
];

export async function getAgents(userId: string): Promise<AgentDef[]> {
  const saved = await getUserKV<AgentDef[] | null>(userId, AGENTS_KEY, null);
  const list = Array.isArray(saved) ? saved : [];
  const byId = new Map(list.map((a) => [a.id, a]));
  // built-ins always exist (new ones appear after an update); saved copies keep the user's settings
  const merged: AgentDef[] = DEFAULT_AGENTS.map((d) => {
    const s = byId.get(d.id);
    return s ? { ...d, ...s, id: d.id, type: d.type, prompt: d.prompt, builtin: true } : d;
  });
  for (const a of list) if (!DEFAULT_AGENTS.some((d) => d.id === a.id)) merged.push({ ...a, builtin: false });
  return merged;
}

export async function saveAgents(userId: string, list: AgentDef[]) {
  // built-in prompts live in code (their edits are prompt versions), so don't store them
  await setUserKV(
    userId,
    AGENTS_KEY,
    list.map((a) => (a.builtin ? { ...a, prompt: "" } : a)),
  );
}

export async function agentMap(userId: string): Promise<Record<string, AgentDef>> {
  return Object.fromEntries((await getAgents(userId)).map((a) => [a.id, a]));
}

export async function getWorkflows(userId: string): Promise<WorkflowDef[]> {
  const saved = await getUserKV<WorkflowDef[] | null>(userId, WORKFLOWS_KEY, null);
  let list = Array.isArray(saved) && saved.length ? saved : DEFAULT_WORKFLOWS;
  for (const stage of ["prework", "main"] as Stage[]) {
    if (!list.some((w) => w.stage === stage)) list = [...list, DEFAULT_WORKFLOWS.find((w) => w.stage === stage)!];
    if (!list.some((w) => w.stage === stage && w.isDefault)) {
      const first = list.find((w) => w.stage === stage)!;
      list = list.map((w) => (w.id === first.id ? { ...w, isDefault: true } : w));
    }
  }
  return list;
}

export async function saveWorkflows(userId: string, list: WorkflowDef[]) {
  await setUserKV(userId, WORKFLOWS_KEY, list);
}

/** The workflow a job asked for, else the default of its stage. */
export async function resolveWorkflow(userId: string, stage: Stage, id?: unknown): Promise<WorkflowDef> {
  const list = (await getWorkflows(userId)).filter((w) => w.stage === stage);
  return (typeof id === "string" && list.find((w) => w.id === id)) || list.find((w) => w.isDefault) || list[0];
}

/** Effective prompt of an agent: the user's active version in «یادگیری و پرامپت‌ها», else its default. */
export async function agentPrompt(userId: string, agent: AgentDef): Promise<string> {
  return getAgentPrompt(userId, agent.id, agent.prompt);
}

/** Workflows offered in the send dialogs. */
export async function workflowChoices(userId: string): Promise<{ id: string; name: string; stage: Stage; isDefault: boolean }[]> {
  return (await getWorkflows(userId)).map((w) => ({ id: w.id, name: w.name, stage: w.stage, isDefault: !!w.isDefault }));
}

/** System agents that are not workflow steps but whose prompts are versioned too. */
export const SYSTEM_AGENT_LABELS: Record<string, string> = {
  knowledge: "دانش پروژه (سیستمی)",
  summarize: "خلاصه‌ی فایل‌های پروژه (سیستمی)",
  optimizer: "بهینه‌ساز پرامپت‌ها (سیستمی)",
};

/** Saves a prompt as a new version of the user's agent (keeping the default as version 1 for history). */
export async function savePromptVersion(userId: string, agent: string, content: string, activate: boolean, defaultContent: string, source: "human" | "ai" = "human") {
  const { data: last } = await db().from("agent_prompts").select("version").eq("user_id", userId).eq("agent", agent).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!last && defaultContent.trim()) {
    await db().from("agent_prompts").insert({ user_id: userId, agent, version: 1, content: defaultContent, is_active: false, source: "default" });
  }
  const version = (last?.version ?? (defaultContent.trim() ? 1 : 0)) + 1;
  if (activate) await db().from("agent_prompts").update({ is_active: false }).eq("user_id", userId).eq("agent", agent);
  const { error } = await db().from("agent_prompts").insert({ user_id: userId, agent, version, content, is_active: activate, source, created_by: userId });
  if (error) throw new Error(`ذخیره‌ی نسخه‌ی پرامپت: ${error.message}`);
  clearPromptCache(userId, agent);
  return version;
}
