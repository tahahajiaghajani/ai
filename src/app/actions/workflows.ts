"use server";
import { assertAdmin } from "@/lib/auth";
import { agentMap, agentPrompt, getAgents, getWorkflows, saveAgents, savePromptVersion, saveWorkflows, DEFAULT_WORKFLOWS } from "@/lib/workflow/registry";
import { validateWorkflow, type AgentDef, type AgentType, type Stage, type WorkflowDef } from "@/lib/workflow/types";
import { act } from "./_util";

const TYPES: AgentType[] = ["gemini", "router", "claude"];
const THINKING = ["LOW", "MEDIUM", "HIGH"];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const CLAUDE_THINKING = ["", "auto", "on", "off"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v: unknown) => v === true;

function cleanAgent(input: AgentDef, existing?: AgentDef): AgentDef {
  const type = existing?.builtin ? existing.type : TYPES.includes(input.type) ? input.type : "gemini";
  const models = Array.isArray(input.models) ? input.models.map((m) => str(m, 60)).filter((m) => /^[\w.:-]+$/.test(m)).slice(0, 10) : [];
  const agent: AgentDef = {
    id: input.id,
    name: str(input.name, 60) || "ایجنت بدون نام",
    description: str(input.description, 300),
    type,
    prompt: typeof input.prompt === "string" ? input.prompt.slice(0, 40_000) : "",
    color: /^#[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color : undefined,
    builtin: !!existing?.builtin,
  };
  if (type !== "claude") {
    Object.assign(agent, {
      models,
      thinking: THINKING.includes(input.thinking ?? "") ? input.thinking : undefined,
      useSearch: bool(input.useSearch),
      attachments: bool(input.attachments),
      knowledge: bool(input.knowledge),
    });
  }
  if (type === "gemini") {
    agent.output = input.output === "files" ? "files" : "text";
    agent.maxFiles = Math.max(1, Math.min(Number(input.maxFiles) || 3, 10));
  }
  if (type === "claude") {
    const c = input.claude ?? {};
    agent.claude = {
      model: /^[\w.:[\]-]{0,80}$/.test(c.model ?? "") ? c.model ?? "" : "",
      effort: EFFORTS.includes(c.effort ?? "") ? c.effort ?? "" : "",
      thinking: CLAUDE_THINKING.includes(c.thinking ?? "") ? c.thinking ?? "" : "",
    };
  }
  return agent;
}

function cleanWorkflow(input: WorkflowDef): WorkflowDef {
  const stage: Stage = input.stage === "main" ? "main" : "prework";
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
  return {
    id: /^[\w-]{1,60}$/.test(input.id) ? input.id : `wf-${Date.now().toString(36)}`,
    name: str(input.name, 80),
    description: str(input.description, 300),
    stage,
    isDefault: bool(input.isDefault),
    builtin: false,
    nodes: (input.nodes ?? []).slice(0, 40).map((n) => ({
      id: str(n.id, 41),
      agentId: str(n.agentId, 60),
      label: str(n.label, 60) || undefined,
      instructions: str(n.instructions, 6000) || undefined,
      saveAs: str(n.saveAs, 80) || undefined,
      appendInputs: bool(n.appendInputs) || undefined,
      reply: bool(n.reply) || undefined,
      brief: stage === "prework" && bool(n.brief) ? true : undefined,
      x: num(n.x),
      y: num(n.y),
    })),
    edges: (input.edges ?? []).slice(0, 200).map((e) => ({
      id: str(e.id, 60) || `e${Math.random().toString(36).slice(2, 8)}`,
      source: str(e.source, 41),
      target: str(e.target, 41),
      when: e.when === "yes" || e.when === "no" ? e.when : undefined,
    })),
    updatedAt: new Date().toISOString(),
  };
}

/** Everything the agents & workflows page needs (with each agent's effective prompt). */
export async function studioDataAction() {
  return act(async () => {
    await assertAdmin();
    const [agents, workflows] = await Promise.all([getAgents(), getWorkflows()]);
    const prompts = Object.fromEntries(await Promise.all(agents.map(async (a) => [a.id, await agentPrompt(a)] as const)));
    return { agents, workflows, prompts };
  });
}

export async function saveWorkflowAction(input: WorkflowDef) {
  return act(async () => {
    await assertAdmin();
    const wf = cleanWorkflow(input);
    const problems = validateWorkflow(wf, await agentMap());
    if (problems.length) throw new Error(problems.join("\n"));
    let list = await getWorkflows();
    const prev = list.find((w) => w.id === wf.id);
    if (prev?.builtin) wf.builtin = true;
    list = prev ? list.map((w) => (w.id === wf.id ? wf : w)) : [...list, wf];
    if (wf.isDefault) list = list.map((w) => (w.stage === wf.stage && w.id !== wf.id ? { ...w, isDefault: false } : w));
    await saveWorkflows(list);
    return { workflows: await getWorkflows(), id: wf.id };
  });
}

export async function setDefaultWorkflowAction(id: string) {
  return act(async () => {
    await assertAdmin();
    const list = await getWorkflows();
    const wf = list.find((w) => w.id === id);
    if (!wf) throw new Error("ورکفلو یافت نشد");
    await saveWorkflows(list.map((w) => (w.stage === wf.stage ? { ...w, isDefault: w.id === id } : w)));
    return { workflows: await getWorkflows() };
  });
}

export async function deleteWorkflowAction(id: string) {
  return act(async () => {
    await assertAdmin();
    const list = await getWorkflows();
    const wf = list.find((w) => w.id === id);
    if (!wf) throw new Error("ورکفلو یافت نشد");
    if (list.filter((w) => w.stage === wf.stage).length <= 1) throw new Error("هر مرحله حداقل یک ورکفلو لازم دارد");
    await saveWorkflows(list.filter((w) => w.id !== id));
    return { workflows: await getWorkflows() };
  });
}

/** Brings back the built-in workflows (if deleted) without touching the others. */
export async function restoreDefaultWorkflowsAction() {
  return act(async () => {
    await assertAdmin();
    const list = await getWorkflows();
    const missing = DEFAULT_WORKFLOWS.filter((d) => !list.some((w) => w.id === d.id)).map((d) => ({ ...d, isDefault: false }));
    await saveWorkflows([...list, ...missing]);
    return { workflows: await getWorkflows() };
  });
}

/** Creates or updates an agent; a changed prompt becomes a new active prompt version. */
export async function saveAgentAction(input: AgentDef, prompt: string) {
  return act(async () => {
    const admin = await assertAdmin();
    const list = await getAgents();
    const isNew = !input.id || !list.some((a) => a.id === input.id);
    let id = input.id;
    if (isNew) {
      id = /^[a-z][a-z0-9_-]{1,40}$/.test(input.id ?? "") ? input.id : `agent-${Date.now().toString(36)}`;
      if (list.some((a) => a.id === id)) throw new Error("شناسه‌ی ایجنت تکراری است");
    }
    const existing = list.find((a) => a.id === id);
    const agent = cleanAgent({ ...input, id, prompt: isNew ? prompt : existing?.prompt ?? "" }, existing);
    await saveAgents(isNew ? [...list, agent] : list.map((a) => (a.id === id ? agent : a)));
    if (!isNew && prompt.trim() && prompt !== (await agentPrompt(existing!))) {
      await savePromptVersion(id, prompt, true, admin.id, existing!.prompt);
    }
    const agents = await getAgents();
    const prompts = Object.fromEntries(await Promise.all(agents.map(async (a) => [a.id, await agentPrompt(a)] as const)));
    return { agents, prompts, id };
  });
}

export async function deleteAgentAction(id: string) {
  return act(async () => {
    await assertAdmin();
    const list = await getAgents();
    const agent = list.find((a) => a.id === id);
    if (!agent) throw new Error("ایجنت یافت نشد");
    if (agent.builtin) throw new Error("ایجنت‌های پیش‌فرض حذف نمی‌شوند (می‌توانید از ورکفلوها حذفشان کنید)");
    const users = (await getWorkflows()).filter((w) => w.nodes.some((n) => n.agentId === id));
    if (users.length) throw new Error(`این ایجنت در ورکفلوهای ${users.map((w) => `«${w.name}»`).join("، ")} استفاده شده؛ اول از آن‌ها حذفش کنید`);
    await saveAgents(list.filter((a) => a.id !== id));
    return { agents: await getAgents() };
  });
}
