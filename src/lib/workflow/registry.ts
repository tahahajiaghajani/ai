import "server-only";
import { getKV, setKV } from "@/lib/settings";
import { db } from "@/lib/supabase/admin";
import { BASE, clearPromptCache, getAgentPrompt } from "@/lib/ai/prompts";
import type { AgentDef, Stage, WorkflowDef } from "@/lib/workflow/types";

const AGENTS_KEY = "agents";
const WORKFLOWS_KEY = "workflows";

/** Built-in agents: always available, their settings can be changed and their prompts versioned. */
export const DEFAULT_AGENTS: AgentDef[] = [
  {
    id: "analyze",
    name: "تحلیل‌گر درخواست و فایل‌ها",
    description: "درخواست و محتوای کامل فایل‌های پیوست را می‌خواند: سازوکار، منابع داده، نام دقیق فیلدها و کمبودها",
    type: "gemini",
    builtin: true,
    output: "text",
    attachments: true,
    knowledge: true,
    thinking: "HIGH",
    color: "#8b5cf6",
    prompt: `${BASE}

نقش تو: «تحلیل‌گر». هنوز راه‌حل نساز؛ فقط درخواست و مواد موجود را عمیق و دقیق بفهم.
خروجی (Markdown، فشرده ولی کامل):
# درک درخواست
خروجی نهایی مورد انتظار در یک تا سه خط (قالب، تعداد فایل، محل استفاده) + فهرست نیازمندی‌ها با شماره.
# بررسی فایل‌های پیوست
برای هر فایل: چیست، چطور کار می‌کند (سازوکار اصلی، روش دریافت/پردازش داده، ساختار، وابستگی‌ها) و چه بخش‌هایی مستقیماً قابل استفاده‌ی مجدد است. نام‌ها، آدرس‌ها، شناسه‌ها و نام داخلی فیلدها را عیناً نقل کن.
# منابع و داده‌های موجود
فهرست منابع داده (مثلاً لیست/جدول/API) و فیلدهای مرتبط با درخواست، با نام دقیق.
# نگاشت نیازمندی‌ها
برای هر نیازمندی: از کدام منبع/فیلد به دست می‌آید، یا «کمبود» است.
# کمبودها و سوال‌ها
فقط موارد واقعی و لازم.
# ساده‌ترین رویکرد درست
چند خط: چطور با تکیه بر مواد موجود انجامش بدهیم.
اگر فایلی پیوست نشده، همین را صریح بگو و تحلیل را بر درخواست بنا کن.`,
  },
  {
    id: "brief",
    name: "نویسنده‌ی دستور کار",
    description: "دستور کار کوتاه و کامل برای Claude: خروجی نهایی، چه چیزی از فایل‌ها استفاده شود، نگاشت داده، کمبودها، مراحل",
    type: "gemini",
    builtin: true,
    output: "text",
    attachments: true,
    thinking: "HIGH",
    color: "#7c3aed",
    prompt: `${BASE}

نقش تو: «نویسنده‌ی دستور کار». بر اساس درخواست، دستور مدیر، فایل‌ها و خروجی مراحل قبل، یک «دستور کار» کوتاه و کامل برای مجری نهایی (Claude Code) بنویس.
فقط خود دستور کار را برگردان (Markdown، بدون مقدمه و توضیح اضافه) با همین بخش‌ها و فقط همین‌ها:
# هدف و خروجی نهایی — دقیقاً چه چیزی تحویل شود (نام، قالب و تعداد فایل)
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
    type: "gemini",
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
    name: "گزارش کوتاه به مدیر",
    description: "پاسخ چت کوتاه: چه فهمید، رویکرد، کمبودهای مهم و آنچه آماده شد",
    type: "gemini",
    builtin: true,
    output: "text",
    thinking: "LOW",
    color: "#6366f1",
    prompt: `${BASE}

نقش تو: «گزارش به مدیر». بر اساس خروجی مراحل قبل، یک پیام کوتاه مثل پاسخ چت بنویس (۴ تا ۱۰ خط Markdown): چه فهمیدی، رویکرد، کمبودهای مهم و اینکه چه چیزی آماده شد.
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

نقش تو: «بازبین». بررسی کن خروجی مراحل قبل، درخواست و دستور مدیر را کامل و درست پوشش می‌دهد یا نه.
decision = yes اگر کامل و قابل تحویل است؛ no اگر ایراد مهمی دارد.
در reason کوتاه و دقیق بگو چرا و (اگر no) دقیقاً چه چیزی باید اصلاح شود.`,
  },
  {
    id: "claude",
    name: "Claude Code — مجری",
    description: "کار را در GitHub Actions با Claude Code انجام می‌دهد و فایل‌های خروجی را می‌سازد",
    type: "claude",
    builtin: true,
    color: "#f97316",
    claude: { model: "", effort: "", thinking: "" },
    prompt: "",
  },
];

export const DEFAULT_WORKFLOWS: WorkflowDef[] = [
  {
    id: "prework-standard",
    name: "پیش‌کار استاندارد",
    description: "تحلیل ← دستور کار ← (فایل‌های کمکی ‖ گزارش به مدیر، هم‌زمان)",
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
    description: "Claude Code کار را کامل انجام می‌دهد",
    stage: "main",
    isDefault: true,
    builtin: true,
    nodes: [{ id: "claude", agentId: "claude", reply: true, x: 0, y: 100 }],
    edges: [],
  },
];

export async function getAgents(): Promise<AgentDef[]> {
  const saved = await getKV<AgentDef[] | null>(AGENTS_KEY, null);
  const list = Array.isArray(saved) ? saved : [];
  const byId = new Map(list.map((a) => [a.id, a]));
  // built-ins always exist (new ones appear after an update); saved copies keep the admin's settings
  const merged: AgentDef[] = DEFAULT_AGENTS.map((d) => {
    const s = byId.get(d.id);
    return s ? { ...d, ...s, id: d.id, type: d.type, prompt: d.prompt, builtin: true } : d;
  });
  for (const a of list) if (!DEFAULT_AGENTS.some((d) => d.id === a.id)) merged.push({ ...a, builtin: false });
  return merged;
}

export async function saveAgents(list: AgentDef[]) {
  // built-in prompts live in code (their edits are prompt versions), so don't store them
  await setKV(
    AGENTS_KEY,
    list.map((a) => (a.builtin ? { ...a, prompt: "" } : a)),
  );
}

export async function agentMap(): Promise<Record<string, AgentDef>> {
  return Object.fromEntries((await getAgents()).map((a) => [a.id, a]));
}

export async function getWorkflows(): Promise<WorkflowDef[]> {
  const saved = await getKV<WorkflowDef[] | null>(WORKFLOWS_KEY, null);
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

export async function saveWorkflows(list: WorkflowDef[]) {
  await setKV(WORKFLOWS_KEY, list);
}

/** The workflow a job asked for, else the default of its stage. */
export async function resolveWorkflow(stage: Stage, id?: unknown): Promise<WorkflowDef> {
  const list = (await getWorkflows()).filter((w) => w.stage === stage);
  return (typeof id === "string" && list.find((w) => w.id === id)) || list.find((w) => w.isDefault) || list[0];
}

/** Effective prompt of an agent: its active version in «یادگیری و پرامپت‌ها», else its default. */
export async function agentPrompt(agent: AgentDef): Promise<string> {
  return getAgentPrompt(agent.id, agent.prompt);
}

/** Workflows offered in the send dialogs. */
export async function workflowChoices(): Promise<{ id: string; name: string; stage: Stage; isDefault: boolean }[]> {
  return (await getWorkflows()).map((w) => ({ id: w.id, name: w.name, stage: w.stage, isDefault: !!w.isDefault }));
}

/** System agents that are not workflow steps but whose prompts are versioned too. */
export const SYSTEM_AGENT_LABELS: Record<string, string> = { knowledge: "استخراج دانش (سیستمی)", optimizer: "بهینه‌ساز پرامپت‌ها (سیستمی)" };

/** Saves a prompt as a new version (keeping the default as version 1 for history). */
export async function savePromptVersion(agent: string, content: string, activate: boolean, adminId: string | null, defaultContent: string, source: "human" | "ai" = "human") {
  const { data: last } = await db().from("agent_prompts").select("version").eq("agent", agent).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!last && defaultContent.trim()) {
    await db().from("agent_prompts").insert({ agent, version: 1, content: defaultContent, is_active: false, source: "default" });
  }
  const version = (last?.version ?? (defaultContent.trim() ? 1 : 0)) + 1;
  if (activate) await db().from("agent_prompts").update({ is_active: false }).eq("agent", agent);
  const { error } = await db().from("agent_prompts").insert({ agent, version, content, is_active: activate, source, created_by: adminId });
  if (error) throw new Error(`ذخیره‌ی نسخه‌ی پرامپت: ${error.message}`);
  clearPromptCache(agent);
  return version;
}
