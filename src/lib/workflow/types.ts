/**
 * Agents and workflows (shared by the server engine and the visual builder).
 * A workflow is a DAG of agent nodes; independent branches run in parallel and "router" agents
 * pick a branch (yes/no). Pre-work workflows run Gemini agents; main-work workflows can also run
 * Claude Code steps in GitHub Actions.
 */

export type Stage = "prework" | "main";
export type AgentType = "gemini" | "router" | "claude";
export type ThinkingLevel = "LOW" | "MEDIUM" | "HIGH";
export type Branch = "yes" | "no";

export interface AgentDef {
  /** stable id (latin); also the key of its prompt versions in agent_prompts */
  id: string;
  name: string;
  description: string;
  type: AgentType;
  /** instructions / system prompt; an active version in «یادگیری و پرامپت‌ها» overrides it */
  prompt: string;
  color?: string;
  builtin?: boolean;
  /** Gemini model chain ("auto" = newest free Flash); empty = Settings → pre-work models */
  models?: string[];
  thinking?: ThinkingLevel;
  useSearch?: boolean;
  /** give the task's attached files to the model */
  attachments?: boolean;
  /** give related items from the knowledge base (RAG) */
  knowledge?: boolean;
  /** gemini: one Markdown text, or several files (JSON list) */
  output?: "text" | "files";
  maxFiles?: number;
  /** claude: run options ("" = the choice made when sending / Settings) */
  claude?: { model?: string; effort?: string; thinking?: "" | "auto" | "on" | "off" };
}

export interface WorkflowNode {
  id: string;
  agentId: string;
  /** shown on the canvas instead of the agent name */
  label?: string;
  /** extra instructions for this step only */
  instructions?: string;
  /** save the text output as a file with this name (e.g. BRIEF.md) */
  saveAs?: string;
  /** append the inputs of this step (outputs of previous steps) to the saved file */
  appendInputs?: boolean;
  /** this output is the chat reply of the stage */
  reply?: boolean;
  /** pre-work: this output is the work order Claude reads first */
  brief?: boolean;
  x: number;
  y: number;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** only for edges leaving a router: followed when the router decided yes/no */
  when?: Branch;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  stage: Stage;
  isDefault?: boolean;
  builtin?: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt?: string;
}

export type NodeRunStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface NodeOutcome {
  status: NodeRunStatus;
  decision?: Branch;
}

/** Node ids used by the engine for its own steps (shown in the live mini workflow). */
export const SYSTEM_NODES = ["prepare", "publish"] as const;

export const STAGE_LABEL: Record<Stage, string> = { prework: "پیش‌کار", main: "کار اصلی" };

export const AGENT_TYPE_META: Record<AgentType, { label: string; hint: string; color: string }> = {
  gemini: { label: "ایجنت Gemini", hint: "متن یا چند فایل تولید می‌کند (رایگان)", color: "#8b5cf6" },
  router: { label: "شرط / مسیریاب", hint: "Gemini تصمیم می‌گیرد مسیر «بله» یا «خیر» ادامه یابد", color: "#0ea5e9" },
  claude: { label: "Claude Code", hint: "کار را در GitHub Actions انجام می‌دهد و فایل می‌سازد (فقط کار اصلی)", color: "#f97316" },
};

export function incoming(wf: Pick<WorkflowDef, "edges">, id: string): WorkflowEdge[] {
  return wf.edges.filter((e) => e.target === id);
}

export function outgoing(wf: Pick<WorkflowDef, "edges">, id: string): WorkflowEdge[] {
  return wf.edges.filter((e) => e.source === id);
}

/** A cycle as a list of node ids, or null for a proper DAG. */
export function findCycle(wf: Pick<WorkflowDef, "nodes" | "edges">): string[] | null {
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    color.set(id, 1);
    stack.push(id);
    for (const e of outgoing(wf, id)) {
      const c = color.get(e.target) ?? 0;
      if (c === 1) return [...stack.slice(stack.indexOf(e.target)), e.target];
      if (c === 0) {
        const found = visit(e.target);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };
  for (const n of wf.nodes) {
    if ((color.get(n.id) ?? 0) === 0) {
      const found = visit(n.id);
      if (found) return found;
    }
  }
  return null;
}

/** Topological layers: every node sits one layer after its latest input (for layout and display). */
export function layers(wf: Pick<WorkflowDef, "nodes" | "edges">): string[][] {
  const depth = new Map<string, number>();
  const ids = wf.nodes.map((n) => n.id);
  let changed = true;
  for (const id of ids) depth.set(id, 0);
  for (let guard = 0; changed && guard < ids.length + 1; guard++) {
    changed = false;
    for (const e of wf.edges) {
      const d = (depth.get(e.source) ?? 0) + 1;
      if (d > (depth.get(e.target) ?? 0)) {
        depth.set(e.target, d);
        changed = true;
      }
    }
  }
  const out: string[][] = [];
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    (out[d] ??= []).push(id);
  }
  return out.filter(Boolean);
}

/**
 * What can run now. A node runs once all of its inputs are finished and at least one of them is
 * "active" (done, and on the branch the router chose). Nodes that no active input can reach are
 * skipped, which also skips everything that depends only on them.
 */
export function schedule(wf: Pick<WorkflowDef, "nodes" | "edges">, outcomes: Record<string, NodeOutcome | undefined>): { ready: string[]; skip: string[]; finished: boolean } {
  const status = (id: string) => outcomes[id]?.status ?? "pending";
  const skipped = new Set<string>();
  const effective = (id: string): NodeRunStatus => (skipped.has(id) ? "skipped" : status(id));
  const active = (e: WorkflowEdge) => effective(e.source) === "done" && (!e.when || outcomes[e.source]?.decision === e.when);
  const resolved = (e: WorkflowEdge) => ["done", "skipped", "error"].includes(effective(e.source));

  // skipping can cascade: repeat until stable
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of wf.nodes) {
      if (effective(n.id) !== "pending") continue;
      const inc = incoming(wf, n.id);
      if (inc.length && inc.every(resolved) && !inc.some(active)) {
        skipped.add(n.id);
        changed = true;
      }
    }
  }
  const ready = wf.nodes
    .filter((n) => effective(n.id) === "pending")
    .filter((n) => {
      const inc = incoming(wf, n.id);
      return !inc.length || (inc.every(resolved) && inc.some(active));
    })
    .map((n) => n.id);
  const finished = wf.nodes.every((n) => ["done", "skipped", "error"].includes(effective(n.id)));
  return { ready, skip: [...skipped], finished };
}

/**
 * The next batch for the engine: Gemini/condition steps to run now (steps interrupted by the time
 * limit or a rate limit first, so they resume their partial output), or else the next Claude step.
 */
export function nextBatch(
  wf: Pick<WorkflowDef, "nodes" | "edges">,
  outcomes: Record<string, NodeOutcome | undefined>,
  isClaude: (id: string) => boolean,
  max = 3,
): { gemini: string[]; claude: string | null; skip: string[]; finished: boolean } {
  const { ready, skip, finished } = schedule(wf, outcomes);
  const interrupted = wf.nodes.filter((n) => outcomes[n.id]?.status === "running" && !isClaude(n.id)).map((n) => n.id);
  const gemini = [...new Set([...interrupted, ...ready.filter((id) => !isClaude(id))])].slice(0, max);
  return { gemini, claude: gemini.length ? null : (ready.find(isClaude) ?? null), skip, finished };
}

const SAFE_FILE = /^[^\\/:*?"<>|\u0000-\u001f]{1,80}\.[A-Za-z0-9]{1,10}$/;

/** Problems that make a workflow unusable, in Persian (empty = valid). */
export function validateWorkflow(wf: WorkflowDef, agents: Record<string, AgentDef | undefined>): string[] {
  const errors: string[] = [];
  if (!wf.name.trim()) errors.push("نام ورکفلو خالی است");
  if (!wf.nodes.length) errors.push("ورکفلو حداقل یک ایجنت لازم دارد");
  if (wf.nodes.length > 40) errors.push("حداکثر ۴۰ ایجنت در یک ورکفلو مجاز است");
  const ids = new Set<string>();
  for (const n of wf.nodes) {
    if (!/^[A-Za-z][\w-]{0,40}$/.test(n.id) || (SYSTEM_NODES as readonly string[]).includes(n.id)) errors.push(`شناسه‌ی گره «${n.id}» نامعتبر است`);
    if (ids.has(n.id)) errors.push(`شناسه‌ی گره «${n.id}» تکراری است`);
    ids.add(n.id);
    const a = agents[n.agentId];
    const name = n.label || a?.name || n.agentId;
    if (!a) {
      errors.push(`ایجنت گره «${name}» پیدا نشد`);
      continue;
    }
    if (wf.stage === "prework" && a.type === "claude") errors.push(`«${name}»: Claude فقط در ورکفلوی کار اصلی قابل استفاده است`);
    if (n.saveAs && !SAFE_FILE.test(n.saveAs)) errors.push(`«${name}»: نام فایل خروجی باید نام ساده با پسوند باشد (مثلاً BRIEF.md)`);
    if (n.saveAs && a.type !== "gemini") errors.push(`«${name}»: ذخیره به‌عنوان فایل فقط برای ایجنت‌های Gemini است`);
    if (n.brief && wf.stage !== "prework") errors.push(`«${name}»: «دستور کار برای Claude» فقط در پیش‌کار معنا دارد`);
  }
  const seen = new Set<string>();
  for (const e of wf.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push("یک اتصال به گره‌ای اشاره می‌کند که وجود ندارد");
    if (e.source === e.target) errors.push("اتصال یک گره به خودش مجاز نیست");
    const key = `${e.source}>${e.target}>${e.when ?? ""}`;
    if (seen.has(key)) errors.push("اتصال تکراری وجود دارد");
    seen.add(key);
    const src = agents[wf.nodes.find((n) => n.id === e.source)?.agentId ?? ""];
    if (src?.type === "router" && !e.when) errors.push(`اتصال‌های خروجی شرط «${src.name}» باید «بله» یا «خیر» باشند`);
    if (src && src.type !== "router" && e.when) errors.push("فقط اتصال‌های خروجی از «شرط» می‌توانند بله/خیر داشته باشند");
  }
  const cycle = findCycle(wf);
  if (cycle) errors.push(`حلقه در ورکفلو مجاز نیست: ${cycle.map((id) => wf.nodes.find((n) => n.id === id)?.label || id).join(" ← ")}`);
  return [...new Set(errors)];
}

/** Compact description of a workflow run for the live view (stored in jobs.state.flow). */
export interface FlowSummary {
  workflow: string;
  stage: Stage;
  nodes: { id: string; label: string; type: AgentType | "system"; deps: string[] }[];
}

export function flowSummary(wf: WorkflowDef, agents: Record<string, AgentDef | undefined>): FlowSummary {
  const roots = wf.nodes.filter((n) => !incoming(wf, n.id).length).map((n) => n.id);
  const sinks = wf.nodes.filter((n) => !outgoing(wf, n.id).length).map((n) => n.id);
  return {
    workflow: wf.name,
    stage: wf.stage,
    nodes: [
      { id: "prepare", label: "آماده‌سازی", type: "system", deps: [] },
      ...wf.nodes.map((n) => ({
        id: n.id,
        label: n.label || agents[n.agentId]?.name || n.agentId,
        type: agents[n.agentId]?.type ?? "gemini",
        deps: roots.includes(n.id) ? ["prepare", ...incoming(wf, n.id).map((e) => e.source)] : incoming(wf, n.id).map((e) => e.source),
      })),
      { id: "publish", label: wf.stage === "prework" ? "انتشار در GitHub" : "ثبت خروجی", type: "system", deps: sinks },
    ],
  };
}

/** Layers of a flow summary (for rendering the live mini workflow). */
export function summaryLayers(flow: FlowSummary): FlowSummary["nodes"][] {
  const wf = { nodes: flow.nodes.map((n) => ({ id: n.id })), edges: flow.nodes.flatMap((n) => n.deps.map((d) => ({ source: d, target: n.id }))) };
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  return layers(wf as unknown as Pick<WorkflowDef, "nodes" | "edges">).map((ids) => ids.map((id) => byId.get(id)!));
}

export function newId(prefix = "n"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}
