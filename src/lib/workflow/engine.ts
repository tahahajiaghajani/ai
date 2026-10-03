import "server-only";
import { db } from "@/lib/supabase/admin";
import { generate, generateJson, type GenContext } from "@/lib/ai/generate";
import { runAgent, type AgentTranscript } from "@/lib/ai/agent";
import { inputBlocks, downloadStorage, type InputFile } from "@/lib/ai/files";
import { withAbout } from "@/lib/ai/prompts";
import { getConnection, githubInfo, type GithubConfig } from "@/lib/connections";
import { getUserConfig, stageModel, type MainEngine } from "@/lib/settings";
import { DeadlineError, FatalError, RateLimitError } from "@/lib/errors";
import { commitFiles, getFileText, userRepoOrNull, type CommitFile, type Repo } from "@/lib/github/client";
import { getProject, indexRow, projectContext, projectFiles, refreshStats, removeFromIndex, upsertIndex, writeIndexFile, type Project } from "@/lib/projects/store";
import { WorkFS, workTools, type Staged } from "@/lib/projects/fs";
import { mentionedFiles, metaPath } from "@/lib/projects/paths";
import { helperFileName, stripCodeFence } from "@/lib/agents/parse";
import { registerOutputs, saveReply, storeOutputs, type OutputFile } from "@/lib/tasks/outputs";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { logEvent, notify } from "@/lib/events";
import { errorMessage, slugify, truncate, wordCount } from "@/lib/utils";
import { agentMap, agentPrompt, resolveWorkflow, DEFAULT_WORKFLOWS } from "@/lib/workflow/registry";
import { flowSummary, incoming, nextBatch, validateWorkflow, type AgentDef, type Branch, type NodeRunStatus, type Stage, type WorkflowDef, type WorkflowNode } from "@/lib/workflow/types";
import type { Block, LlmMessage } from "@/lib/ai/llm/types";
import type { JobRun } from "@/lib/queue/run";
import type { Job, NodeState, Task } from "@/lib/types";

const STATE_VERSION = 2;
/** Parallel model calls per step. */
const MAX_PARALLEL = 3;
/** A node that failed this many times fails the whole job. */
const MAX_NODE_ATTEMPTS = 3;
/** Text of previous steps passed to the next agent. */
const MAX_INPUT_CHARS = 60_000;

export interface GenFile {
  name: string;
  purpose: string;
  content: string;
}

export interface NodeResult {
  status: NodeRunStatus;
  attempts: number;
  text?: string;
  files?: GenFile[];
  decision?: Branch;
  model?: string;
  error?: string;
  partial?: { key: string; text: string; model?: string } | null;
  /** coder: paths (inside the project, or output names) created/changed/deleted */
  changed?: string[];
  commitUrl?: string | null;
}

interface StageContext {
  taskId: string;
  ownerId: string;
  /** what the user asked (with the attached files, the only request text the models get) */
  prompt: string;
  projectId: string | null;
  selected: string[];
  /** run number of this stage within the task (records folder runs/NN-stage) */
  run: number;
  /** task records folder in the user's GitHub repo; null = no GitHub (outputs go to Storage) */
  recordsDir: string | null;
  runDir: string | null;
  history: { role: "user" | "model"; text: string }[];
  projectText: string;
  inputs: InputFile[];
  inputsCursor: number;
  inputPaths: string[];
  /** AI connections: model steps and the in-app executor */
  llmConn: string | null;
  coderConn: string | null;
  llmModel: string;
  coderModel: string;
  engine: MainEngine;
  claudeCode: boolean;
  about: string;
}

export interface EngineState {
  v: number;
  stage: Stage;
  workflow: WorkflowDef;
  agents: Record<string, AgentDef>;
  /** agent prompts resolved when the run started, so an edit mid-run does not mix versions */
  prompts: Record<string, string>;
  phase: "prepare" | "inputs" | "run" | "publish" | "done";
  ctx: StageContext;
  results: Record<string, NodeResult>;
  /** a coder step running in the user's GitHub Actions (Claude Code) */
  externalNode: string | null;
  /** pending file changes of in-app executor steps (committed in publish) */
  staged: Staged;
  transcripts: Record<string, AgentTranscript>;
  models: string[];
  maxAgentTurns: number;
}

export type EngineStep = { type: "continue" } | { type: "external" } | { type: "done" } | { type: "fail"; error: string };

// ---------------------------------------------------------------------------
// persistence (job_data.graph holds the engine state; jobs.state the light live view)
// ---------------------------------------------------------------------------
function load(run: JobRun): EngineState | null {
  const v = run.data.graph?.values as unknown as EngineState | undefined;
  return v && v.v === STATE_VERSION ? v : null;
}

async function save(run: JobRun, st: EngineState) {
  run.data.graph = { values: st as unknown as Record<string, unknown>, lastNode: st.phase, next: [] };
  await run.saveData();
}

export async function readEngine(jobId: string): Promise<EngineState | null> {
  const { data } = await db().from("job_data").select("graph").eq("job_id", jobId).maybeSingle();
  const v = (data?.graph as { values?: EngineState } | null)?.values;
  return v && v.v === STATE_VERSION ? v : null;
}

async function writeEngine(jobId: string, st: EngineState) {
  await db().from("job_data").upsert({ job_id: jobId, graph: { values: st, lastNode: st.phase, next: [] }, updated_at: new Date().toISOString() });
}

async function loadTask(id: string): Promise<Task> {
  const { data, error } = await db().from("tasks").select("*").eq("id", id).single<Task>();
  if (error || !data) throw new Error(`تسک ${id} یافت نشد`);
  return data;
}

function nodeLabel(st: EngineState, n: WorkflowNode) {
  return n.label || st.agents[n.agentId]?.name || n.agentId;
}

function isCoder(st: EngineState, id: string) {
  return st.agents[st.workflow.nodes.find((n) => n.id === id)?.agentId ?? ""]?.type === "coder";
}

function engineOf(st: EngineState, agent: AgentDef): MainEngine {
  return agent.engine === "agent" || agent.engine === "claude_code" ? agent.engine : st.ctx.engine;
}

function historyMessages(history: StageContext["history"]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const h of history ?? []) {
    const role = h.role === "model" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) (last.content[0] as { text: string }).text += `\n\n${h.text}`;
    else out.push({ role, content: [{ type: "text", text: h.text }] });
  }
  if (out.length && out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "سابقه‌ی همین کار:" }] });
  if (out.length && out[out.length - 1].role === "user") out.push({ role: "assistant", content: [{ type: "text", text: "متوجه شدم." }] });
  return out;
}

async function saveMessage(st: EngineState, jobId: string, agent: string, role: "user" | "model", content: string) {
  const task = await loadTask(st.ctx.taskId);
  await db().from("ai_messages").insert({ root_task_id: task.root_id ?? task.id, task_id: task.id, job_id: jobId, agent, role, content });
}

async function setProgress(run: JobRun, st: EngineState) {
  if (!run.job.task_id) return;
  const nodes = st.workflow.nodes.length || 1;
  const finished = Object.values(st.results).filter((r) => r.status === "done" || r.status === "skipped").length;
  const [from, span] = st.stage === "prework" ? [22, 26] : [62, 26];
  const progress = Math.round(from + (span * finished) / nodes);
  await db().from("tasks").update({ progress }).eq("id", run.job.task_id).lt("progress", progress);
}

/** Folder of a task's records: inside its project (`.taskflow/tasks/<code>`) or `tasks/<code>_<title>`. */
export function recordsFolder(root: Pick<Task, "code" | "title">, project: Pick<Project, "slug"> | null): string {
  return project ? metaPath(project.slug, `tasks/${root.code}`) : `tasks/${root.code}_${slugify(root.title)}`;
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------
async function start(run: JobRun, stage: Stage): Promise<EngineState> {
  const ownerId = run.job.owner_id!;
  const cfg = await getUserConfig(ownerId);
  const agents = await agentMap(ownerId);
  let workflow = await resolveWorkflow(ownerId, stage, run.job.payload.workflow_id);
  const problems = validateWorkflow(workflow, agents);
  if (problems.length) {
    await run.log({ source: "system", kind: "warning", title: `ورکفلوی «${workflow.name}» ایراد دارد؛ ورکفلوی استاندارد اجرا می‌شود`, detail: problems.join("\n") });
    workflow = DEFAULT_WORKFLOWS.find((w) => w.stage === stage)!;
  }
  const used: Record<string, AgentDef> = {};
  const prompts: Record<string, string> = {};
  for (const n of workflow.nodes) {
    const a = agents[n.agentId];
    used[a.id] = a;
    prompts[a.id] ??= await agentPrompt(ownerId, a);
  }
  const gh = await githubInfo(ownerId);
  const pre = stageModel(cfg, "prework");
  const main = cfg.stages.main;
  const llm = stage === "prework" ? pre : main.connectionId ? main : pre;
  const st: EngineState = {
    v: STATE_VERSION,
    stage,
    workflow,
    agents: used,
    prompts,
    phase: "prepare",
    ctx: {
      taskId: run.job.task_id!,
      ownerId,
      prompt: String(run.job.payload.prompt ?? ""),
      projectId: run.job.project_id ?? null,
      selected: Array.isArray(run.job.payload.files_selected) ? (run.job.payload.files_selected as string[]).slice(0, 40) : [],
      run: 1,
      recordsDir: null,
      runDir: null,
      history: [],
      projectText: "",
      inputs: [],
      inputsCursor: 0,
      inputPaths: [],
      llmConn: llm.connectionId,
      coderConn: main.connectionId,
      llmModel: llm.model,
      coderModel: main.model,
      engine: (run.job.payload.engine as MainEngine | undefined) ?? main.engine,
      claudeCode: !!(gh?.config as GithubConfig | undefined)?.claudeCode,
      about: cfg.about,
    },
    results: {},
    externalNode: null,
    staged: {},
    transcripts: {},
    models: [],
    maxAgentTurns: cfg.pipeline.maxAgentTurns,
  };
  const flow = flowSummary(workflow, used);
  const nodes: Record<string, NodeState> = {};
  for (const n of flow.nodes) nodes[n.id] = { status: "pending" };
  await run.patchState({ flow, nodes });
  await run.log({ source: "system", kind: "node", title: `ورکفلوی «${workflow.name}» با ${workflow.nodes.length} ایجنت شروع شد` });
  await save(run, st);
  return st;
}

/** Fails early with a clear message when a step has no AI connection to run on. */
function checkConnections(st: EngineState) {
  const needsLlm = st.workflow.nodes.some((n) => st.agents[n.agentId]?.type !== "coder");
  if (needsLlm && !st.ctx.llmConn) throw new FatalError(`برای ${st.stage === "prework" ? "پیش‌کار" : "کار اصلی"} هیچ اتصال هوش مصنوعی انتخاب نشده است (تنظیمات ← مدل هر مرحله)`);
  for (const n of st.workflow.nodes.filter((x) => st.agents[x.agentId]?.type === "coder")) {
    const engine = engineOf(st, st.agents[n.agentId]);
    if (engine === "agent" && !st.ctx.coderConn) throw new FatalError("برای مجری کار اصلی هیچ اتصال هوش مصنوعی انتخاب نشده است (تنظیمات ← مدل هر مرحله)");
    if (engine === "claude_code" && !st.ctx.claudeCode) throw new FatalError("اجرای Claude Code در GitHub Actions راه‌اندازی نشده است (تنظیمات ← اتصال‌ها ← Claude Code)؛ یا مجری داخل اپ را انتخاب کنید");
  }
}

// ---------------------------------------------------------------------------
// system steps
// ---------------------------------------------------------------------------
async function prepare(run: JobRun, st: EngineState) {
  await run.setNode("prepare", { status: "running" });
  checkConnections(st);
  const cfg = await getUserConfig(st.ctx.ownerId);
  const task = await loadTask(st.ctx.taskId);
  const root = task.root_id && task.root_id !== task.id ? await loadTask(task.root_id) : task;
  const project = st.ctx.projectId ? await getProject(st.ctx.projectId).catch(() => null) : null;
  const repo = await userRepoOrNull(st.ctx.ownerId);
  if (st.ctx.projectId && (!project || !repo)) throw new FatalError("پروژه‌ی انتخاب‌شده در دسترس نیست (GitHub وصل نیست یا پروژه حذف شده)");

  // run number of this stage within the task family (records folder runs/NN-stage)
  const { count } = await db()
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("kind", st.stage)
    .in("task_id", [...new Set([task.id, root.id])])
    .lt("created_at", run.job.created_at);
  st.ctx.run = (count ?? 0) + 1;
  if (repo) {
    st.ctx.recordsDir = recordsFolder(root, project);
    st.ctx.runDir = `${st.ctx.recordsDir}/runs/${String(st.ctx.run).padStart(2, "0")}-${st.stage}`;
    if (!project && !root.github_path) await db().from("tasks").update({ github_path: st.ctx.recordsDir }).or(`id.eq.${root.id},root_id.eq.${root.id}`);
  }

  // earlier prompts and answers of the same task continue the conversation
  const { data: msgs } = await db()
    .from("ai_messages")
    .select("agent, role, content, job_id")
    .eq("root_task_id", root.id)
    .in("agent", ["prompt", "brief", "reply"])
    .order("id", { ascending: true });
  let budget = cfg.pipeline.historyChars;
  const history: StageContext["history"] = [];
  for (const m of [...(msgs ?? [])].filter((m) => m.job_id !== run.job.id).reverse()) {
    if (budget <= 0) break;
    const text = m.content.length > budget ? `${m.content.slice(0, budget)}\n…` : m.content;
    budget -= text.length;
    history.unshift({ role: m.role as "user" | "model", text });
  }

  // files the prompt names ("فایل audit.cs …") are picked when none were chosen by hand
  if (project && !st.ctx.selected.length) {
    const named = mentionedFiles(st.ctx.prompt, (await projectFiles(project.id)).map((f) => f.path));
    if (named.length) {
      st.ctx.selected = named;
      await run.log({ source: "project", kind: "search", title: `فایل‌های نام‌برده در پرامپت پیدا شد: ${named.join("، ")}` });
    }
  }

  let projectText = "";
  if (project && Object.values(st.agents).some((a) => a.knowledge || a.type === "coder")) {
    const ctx = await projectContext(project, st.ctx.selected);
    projectText = ctx.text;
    await run.log({ source: "project", kind: "search", title: `پروژه‌ی «${project.name}»: نقشه و دانش پروژه${ctx.files.length ? ` + ${ctx.files.length} فایل انتخاب‌شده` : ""} آماده شد` });
  }

  // only the files of the request and of this send (never the task title or description)
  const { data: files } = await db()
    .from("task_files")
    .select("id, name, storage_path, mime, size, context, job_id")
    .eq("task_id", task.id)
    .or(`context.eq.request,job_id.eq.${run.job.id}`)
    .neq("context", "output")
    .order("created_at");
  const inputs = ((files ?? []) as InputFile[]).filter((f) => !f.storage_path.startsWith("github:"));

  st.ctx = { ...st.ctx, history, projectText, inputs, inputsCursor: 0, inputPaths: [] };
  await saveMessage(st, run.job.id, "prompt", "user", st.ctx.prompt);
  await run.setNode("prepare", { status: "done", detail: `${inputs.length} فایل${project ? ` · پروژه ${project.name}` : ""}${history.length ? ` · ${history.length} پیام سابقه` : ""}` });
}

/** Copy this run's attachments into the records folder in GitHub (resumable across ticks). */
async function uploadInputs(run: JobRun, st: EngineState): Promise<boolean> {
  const list = st.ctx.inputs;
  let cursor = st.ctx.inputsCursor;
  if (!st.ctx.runDir || cursor >= list.length) return true;
  const repo = await userRepoOrNull(st.ctx.ownerId);
  if (!repo) return true;
  const batch: CommitFile[] = [];
  const paths: string[] = [];
  while (cursor < list.length && run.timeLeft() > 25_000) {
    const f = list[cursor];
    cursor++;
    if ((f.size ?? 0) > 25 * 1024 * 1024) continue;
    const blob = await downloadStorage(f.storage_path);
    const path = `${st.ctx.runDir}/inputs/${f.name.replace(/[\\/]/g, "_")}`;
    batch.push({ path, content: new Uint8Array(await blob.arrayBuffer()) });
    paths.push(path);
    await db().from("task_files").update({ github_path: path }).eq("id", f.id);
  }
  if (batch.length) {
    const c = await commitFiles(repo, batch, `[TaskFlow] ورودی‌های ${st.ctx.runDir.split("/").slice(-3).join("/")}`);
    await run.log({ source: "github", kind: "commit", title: `${batch.length} فایل ورودی در GitHub ذخیره شد`, data: { url: c?.url } });
  }
  st.ctx.inputsCursor = cursor;
  st.ctx.inputPaths = [...st.ctx.inputPaths, ...paths];
  return cursor >= list.length;
}

// ---------------------------------------------------------------------------
// agent nodes
// ---------------------------------------------------------------------------
const ROUTER_SCHEMA = {
  type: "object",
  properties: { decision: { type: "string", enum: ["yes", "no"] }, reason: { type: "string" } },
  required: ["decision", "reason"],
};

function filesSchema(max: number) {
  return {
    type: "object",
    properties: {
      files: {
        type: "array",
        maxItems: max,
        items: {
          type: "object",
          properties: { name: { type: "string", description: "نام فایل با پسوند، بدون پوشه" }, purpose: { type: "string" }, content: { type: "string" } },
          required: ["name", "purpose", "content"],
        },
      },
    },
    required: ["files"],
  };
}

/** Outputs of the steps feeding this node (only the branches actually taken). */
function inputsOf(st: EngineState, nodeId: string): string {
  const parts: string[] = [];
  let budget = MAX_INPUT_CHARS;
  for (const e of incoming(st.workflow, nodeId)) {
    const r = st.results[e.source];
    if (r?.status !== "done" || (e.when && r.decision !== e.when)) continue;
    const src = st.workflow.nodes.find((n) => n.id === e.source)!;
    const agent = st.agents[src.agentId];
    const block: string[] = [`### ${nodeLabel(st, src)}`];
    if (agent?.type === "router") block.push(`تصمیم: ${r.decision === "yes" ? "بله" : "خیر"}`);
    if (r.text) block.push(r.text);
    for (const f of r.files ?? []) block.push(`#### فایل ${f.name} — ${f.purpose}\n${f.content}`);
    if (agent?.type === "coder" && r.changed?.length) block.push(`فایل‌های ساخته/تغییرداده‌شده: ${r.changed.map((p) => `\`${p}\``).join("، ")}`);
    const joined = block.join("\n\n");
    parts.push(truncate(joined, Math.max(2_000, budget)));
    budget -= joined.length;
  }
  return parts.join("\n\n");
}

function nodeGen(run: JobRun, st: EngineState, id: string, connId: string): GenContext {
  const base = run.genContext(id, connId);
  return {
    ...base,
    getPartial: () => st.results[id]?.partial ?? null,
    savePartial: async (p) => {
      st.results[id] = { ...(st.results[id] ?? { status: "running", attempts: 0 }), partial: p };
      await save(run, st);
    },
  };
}

/** The request as the models get it: the prompt, this step's instructions, earlier steps, project, files. */
async function userBlocks(run: JobRun, st: EngineState, node: WorkflowNode, agent: AgentDef): Promise<Block[]> {
  const inputs = inputsOf(st, node.id);
  const files = agent.attachments ? st.ctx.inputs : [];
  const text = [
    `## درخواست\n${st.ctx.prompt.trim() || "—"}`,
    node.instructions?.trim() ? `\n## دستور این مرحله\n${node.instructions.trim()}` : "",
    inputs ? `\n## خروجی مراحل قبل\n${inputs}` : "",
    (agent.knowledge || agent.type === "coder") && st.ctx.projectText ? `\n${st.ctx.projectText}` : "",
    files.length ? `\n## فایل‌های پیوست (${files.length} فایل)\n${files.map((f) => `- ${f.name}`).join("\n")}\nمحتوای فایل‌ها در ادامه آمده است؛ آن‌ها را کامل و دقیق بررسی کن.` : "",
  ].join("\n");
  const blocks: Block[] = [{ type: "text", text }];
  if (files.length) blocks.push(...(await inputBlocks(files, run.deadline)));
  return blocks;
}

function toolTitle(name: string, input: Record<string, unknown>): string {
  const p = String(input.path ?? "");
  switch (name) {
    case "list_files":
      return `فهرست فایل‌ها${input.query ? `: ${String(input.query)}` : p ? `: ${p}` : ""}`;
    case "search_code":
      return `جستجو: ${String(input.query ?? "")}`;
    case "read_file":
      return `خواندن ${p}`;
    case "write_file":
      return `نوشتن ${p}`;
    case "append_file":
      return `ادامه‌ی ${p}`;
    case "edit_file":
      return `ویرایش ${p}`;
    case "delete_file":
      return `حذف ${p}`;
    default:
      return name;
  }
}

async function runLlmNode(run: JobRun, st: EngineState, id: string) {
  const node = st.workflow.nodes.find((n) => n.id === id)!;
  const agent = st.agents[node.agentId];
  const label = nodeLabel(st, node);
  const prev = st.results[id];
  if (prev?.status !== "running") {
    st.results[id] = { status: "running", attempts: prev?.attempts ?? 0, partial: prev?.partial ?? null };
    await run.setNode(id, { status: "running" });
    await run.log({ source: "ai", kind: "node", title: `${label}: شروع`, data: { node: id } });
  }
  const conn = await getConnection(st.ctx.llmConn!, st.ctx.ownerId);
  const cfg = await getUserConfig(st.ctx.ownerId);
  const system = withAbout(st.prompts[agent.id] || agent.prompt, st.ctx.about);
  const ctx = nodeGen(run, st, id, conn.id);
  const model = agent.model?.trim() || st.ctx.llmModel;
  const effort = agent.thinking ?? cfg.pipeline.thinking;
  const history = historyMessages(st.ctx.history);
  const withTools = agent.tools && st.ctx.projectId && agent.type === "llm" && agent.output !== "files";

  let result: NodeResult;
  if (withTools) {
    // looks into the project's files itself before answering (read-only tools)
    const project = await getProject(st.ctx.projectId!);
    const fs = new WorkFS({}, await userRepoOrNull(st.ctx.ownerId), project);
    let transcript = st.transcripts[id];
    if (!transcript) {
      transcript = { messages: [...history, { role: "user", content: await userBlocks(run, st, node, agent) }], turns: 0 };
      st.transcripts[id] = transcript;
    }
    const res = await runAgent({
      agent: agent.id,
      conn,
      model,
      system: `${system}\n\nبرای پیدا کردن و خواندن فایل‌های مرتبط پروژه از ابزارها استفاده کن (فقط خواندنی) و در پایان پاسخ نهایی‌ات را بدون صدا زدن ابزار بنویس.`,
      tools: workTools(fs, { write: false }),
      transcript,
      effort,
      maxTurns: 30,
      deadline: run.deadline,
      ctx,
      save: async () => save(run, st),
      onTool: async (name, input) => run.live({ node: id, thought: toolTitle(name, input) }),
    });
    result = { status: "done", attempts: prev?.attempts ?? 0, text: res.summary, model: res.model };
  } else {
    const common = { agent: agent.id, conn, model, system, history, user: await userBlocks(run, st, node, agent), effort, maxOutputTokens: 32000, deadline: run.deadline, partialKey: `node:${id}`, ctx };
    if (agent.type === "router") {
      const { data, model: used } = await generateJson<{ decision?: string; reason?: string }>({ ...common, jsonSchema: ROUTER_SCHEMA, effort: agent.thinking ?? "MEDIUM" });
      result = { status: "done", attempts: prev?.attempts ?? 0, text: (data.reason ?? "").trim(), decision: data.decision === "no" ? "no" : "yes", model: used };
    } else if (agent.output === "files") {
      const max = Math.max(0, Math.min(agent.maxFiles ?? 3, 10));
      const { data, model: used } = await generateJson<{ files?: GenFile[] }>({ ...common, jsonSchema: filesSchema(max) });
      const files = (data.files ?? [])
        .filter((f) => f?.name && f.content?.trim())
        .slice(0, max)
        .map((f, i) => ({ name: helperFileName(f.name, i), purpose: (f.purpose ?? "").trim(), content: stripCodeFence(f.content) }));
      result = { status: "done", attempts: prev?.attempts ?? 0, files, text: files.length ? files.map((f) => `- \`${f.name}\` — ${f.purpose}`).join("\n") : "فایل کمکی لازم نبود.", model: used };
    } else {
      const res = await generate({ ...common, useSearch: agent.useSearch ?? false });
      result = { status: "done", attempts: prev?.attempts ?? 0, text: res.text.trim(), model: res.model };
    }
  }
  run.commitUsage();
  st.results[id] = result;
  delete st.transcripts[id];
  st.models = [...st.models, result.model ?? ""].filter(Boolean);
  if (node.brief && result.text) await saveMessage(st, run.job.id, "brief", "model", result.text);
  const detail =
    agent.type === "router" ? `تصمیم: ${result.decision === "yes" ? "بله" : "خیر"} — ${truncate(result.text ?? "", 600)}` : result.files ? `${result.files.length} فایل` : `${wordCount(result.text ?? "")} کلمه`;
  await run.setNode(id, { status: "done", model: result.model, detail });
  await run.log({ source: "ai", kind: "node", title: `${label}: انجام شد`, detail: `${detail} — مدل ${result.model}`, data: { node: id, done: true } });
}

/** The in-app executor: finds, reads, edits and creates files with tools (any provider). */
async function runCoderNode(run: JobRun, st: EngineState, id: string) {
  const node = st.workflow.nodes.find((n) => n.id === id)!;
  const agent = st.agents[node.agentId];
  const label = nodeLabel(st, node);
  const prev = st.results[id];
  if (prev?.status !== "running") {
    st.results[id] = { status: "running", attempts: prev?.attempts ?? 0 };
    await run.setNode(id, { status: "running", detail: "ایجنت مجری داخل اپ" });
    await run.log({ source: "ai", kind: "node", title: `${label}: شروع`, data: { node: id } });
  }
  const conn = await getConnection(st.ctx.coderConn!, st.ctx.ownerId);
  const cfg = await getUserConfig(st.ctx.ownerId);
  const project = st.ctx.projectId ? await getProject(st.ctx.projectId) : null;
  const fs = new WorkFS(st.staged, project ? await userRepoOrNull(st.ctx.ownerId) : null, project);
  let transcript = st.transcripts[id];
  if (!transcript) {
    const user = await userBlocks(run, st, node, agent);
    if (!project) user.push({ type: "text", text: "\n\n(پروژه‌ای انتخاب نشده: خروجی‌ها را به صورت فایل‌های کامل با نام گویا بساز؛ همین فایل‌ها به کاربر تحویل داده می‌شوند.)" });
    transcript = { messages: [...historyMessages(st.ctx.history), { role: "user", content: user }], turns: 0 };
    st.transcripts[id] = transcript;
  }
  const changed = new Set<string>(prev?.changed ?? []);
  const res = await runAgent({
    agent: agent.id,
    conn,
    model: agent.model?.trim() || st.ctx.coderModel,
    system: withAbout(st.prompts[agent.id] || agent.prompt, st.ctx.about),
    tools: workTools(fs, { write: true, onWrite: (p) => changed.add(p) }),
    transcript,
    effort: agent.thinking ?? cfg.pipeline.thinking,
    maxTurns: st.maxAgentTurns,
    deadline: run.deadline,
    ctx: nodeGen(run, st, id, conn.id),
    finishTool: "finish",
    save: async () => {
      st.results[id] = { ...(st.results[id] ?? { status: "running", attempts: 0 }), changed: [...changed] };
      await save(run, st);
    },
    onTool: async (name, input, r) => {
      run.live({ node: id, thought: toolTitle(name, input) });
      if (["write_file", "edit_file", "delete_file"].includes(name)) {
        await run.log({ source: "ai", kind: name === "delete_file" ? "file" : "tool", title: toolTitle(name, input), detail: r.ok ? null : r.text, data: { node: id } });
      }
    },
  });
  run.commitUsage();
  const files = [...changed].filter((p) => p in st.staged);
  st.results[id] = { status: "done", attempts: prev?.attempts ?? 0, text: res.summary, model: res.model, changed: files };
  delete st.transcripts[id];
  st.models = [...st.models, res.model ?? ""].filter(Boolean);
  const detail = `${files.length} فایل`;
  await run.setNode(id, { status: "done", model: res.model, detail });
  await run.log({ source: "ai", kind: "node", title: `${label}: انجام شد`, detail: `${detail}${res.model ? ` — مدل ${res.model}` : ""}`, data: { node: id, done: true } });
}

async function runStep(run: JobRun, st: EngineState): Promise<EngineStep> {
  const outcomes = Object.fromEntries(Object.entries(st.results).map(([id, r]) => [id, { status: r.status, decision: r.decision }]));
  const { llm, coder, skip, finished } = nextBatch(st.workflow, outcomes, (id) => isCoder(st, id), MAX_PARALLEL);
  for (const id of skip) {
    st.results[id] = { status: "skipped", attempts: 0 };
    await run.setNode(id, { status: "skipped", detail: "این مسیر انتخاب نشد" });
  }
  if (skip.length) await save(run, st);
  if (finished) {
    st.phase = "publish";
    await save(run, st);
    return { type: "continue" };
  }
  if (st.externalNode) return { type: "external" };

  if (coder && !llm.length && engineOf(st, st.agents[st.workflow.nodes.find((n) => n.id === coder)!.agentId]) === "claude_code") {
    const prev = st.results[coder];
    st.results[coder] = { status: "running", attempts: (prev?.attempts ?? 0) + 1 };
    st.externalNode = coder;
    await save(run, st);
    await run.setNode(coder, { status: "running", detail: "Claude Code در GitHub Actions" });
    return { type: "external" };
  }

  const batch = llm.length ? llm : coder ? [coder] : [];
  if (!batch.length) return { type: "continue" };
  const settled = await Promise.allSettled(batch.map((id) => (isCoder(st, id) ? runCoderNode(run, st, id) : runLlmNode(run, st, id))));
  await setProgress(run, st);
  let rate: RateLimitError | null = null;
  let deadline = false;
  for (const [i, s] of settled.entries()) {
    if (s.status === "fulfilled") continue;
    const id = batch[i];
    const err = s.reason;
    if (err instanceof DeadlineError) {
      deadline = true; // partial output / transcript saved; continues next step
      continue;
    }
    if (err instanceof RateLimitError) {
      rate ??= err;
      continue;
    }
    if (err instanceof FatalError) {
      await save(run, st);
      throw err;
    }
    const r = st.results[id] ?? { status: "pending", attempts: 0 };
    const attempts = r.attempts + 1;
    const label = nodeLabel(st, st.workflow.nodes.find((n) => n.id === id)!);
    if (attempts >= MAX_NODE_ATTEMPTS) {
      st.results[id] = { ...r, status: "error", attempts, error: errorMessage(err) };
      await run.setNode(id, { status: "error", detail: errorMessage(err) });
      await save(run, st);
      return { type: "fail", error: `«${label}»: ${errorMessage(err)}` };
    }
    st.results[id] = { ...r, status: "pending", attempts };
    await run.setNode(id, { status: "pending", detail: `خطا؛ تلاش دوباره (${attempts})` });
    await run.log({ source: "ai", kind: "warning", title: `${label}: خطا؛ تلاش دوباره (${attempts}/${MAX_NODE_ATTEMPTS})`, detail: errorMessage(err) });
  }
  await save(run, st);
  if (rate) throw rate;
  if (deadline) throw new DeadlineError();
  return { type: "continue" };
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------
/** Saved text of a node, optionally followed by the outputs it received. */
function fileContent(st: EngineState, n: WorkflowNode): string {
  const body = (st.results[n.id].text ?? "").trim();
  if (!n.appendInputs) return `${body}\n`;
  const inputs = inputsOf(st, n.id);
  return inputs ? `${body}\n\n---\n\n## پیوست: خروجی مراحل قبل\n\n${inputs}\n` : `${body}\n`;
}

function replyText(st: EngineState): string {
  const done = st.workflow.nodes.filter((n) => st.results[n.id]?.status === "done");
  const flagged = done.filter((n) => n.reply).map((n) => st.results[n.id].text ?? "").filter(Boolean);
  if (flagged.length) return flagged.join("\n\n");
  const last = done.filter((n) => st.agents[n.agentId]?.type !== "router").pop();
  return last ? truncate(st.results[last.id].text ?? "", 6000) : "";
}

/** Text outputs of model steps (saveAs / files) as record files of this run. */
function recordFiles(st: EngineState): { path: string; content: string; name?: string }[] {
  const out: { path: string; content: string; name?: string }[] = [];
  const ordered = [...st.workflow.nodes].sort((a, b) => Number(!!b.brief) - Number(!!a.brief));
  for (const n of ordered) {
    const r = st.results[n.id];
    if (r?.status !== "done" || st.agents[n.agentId]?.type === "coder") continue;
    if (n.saveAs && r.text) out.push({ path: helperFileName(n.saveAs, 0), content: fileContent(st, n), name: n.brief ? `دستور کار (${n.saveAs})` : n.saveAs });
    for (const f of r.files ?? []) out.push({ path: `files/${f.name}`, content: f.content });
  }
  return out;
}

interface Manifest {
  schema: "taskflow.task/v2";
  task: { code: string; title: string; project: string | null };
  runs: { n: number; stage: Stage; job_id: string; at: string; folder: string; workflow: string; models: string[]; outputs: string[]; changed?: string[] }[];
}

async function manifestFile(repo: Repo, st: EngineState, task: Task, project: Project | null, entry: Manifest["runs"][number]): Promise<CommitFile> {
  const path = `${st.ctx.recordsDir}/manifest.json`;
  const existing = await getFileText(repo, path).catch(() => null);
  let m: Manifest = { schema: "taskflow.task/v2", task: { code: task.code, title: task.title, project: project?.root_path ?? null }, runs: [] };
  try {
    if (existing) m = { ...m, ...(JSON.parse(existing) as Manifest) };
  } catch {
    /* rewrite a broken manifest */
  }
  m.runs = [...(m.runs ?? []).filter((r) => !(r.n === entry.n && r.stage === entry.stage)), entry].sort((a, b) => a.at.localeCompare(b.at));
  return { path, content: JSON.stringify(m, null, 2) };
}

async function publish(run: JobRun, st: EngineState) {
  await run.setNode("publish", { status: "running" });
  const task = await loadTask(st.ctx.taskId);
  const project = st.ctx.projectId ? await getProject(st.ctx.projectId).catch(() => null) : null;
  const repo = st.ctx.recordsDir ? await userRepoOrNull(st.ctx.ownerId) : null;
  const records = recordFiles(st);
  const reply = replyText(st) || (st.stage === "prework" ? "پیش‌کار انجام شد." : "کار انجام شد.");
  const outputs: OutputFile[] = [];
  let commitUrl: string | null = null;

  // files of in-app executor steps, and files Claude Code changed in GitHub Actions (already committed)
  const stagedEntries = Object.entries(st.staged);
  const external = st.workflow.nodes.flatMap((n) => (isCoder(st, n.id) && engineOf(st, st.agents[n.agentId]) === "claude_code" ? (st.results[n.id]?.changed ?? []) : []));

  if (repo && st.ctx.runDir) {
    const files: CommitFile[] = [{ path: `${st.ctx.runDir}/PROMPT.md`, content: `# پرامپت ${st.stage === "prework" ? "پیش‌کار" : "کار اصلی"}\n\n${st.ctx.prompt}\n` }];
    for (const f of records) {
      const path = `${st.ctx.runDir}/${f.path}`;
      files.push({ path, content: f.content });
      outputs.push({ path, size: Buffer.byteLength(f.content), name: f.name });
    }
    files.push({ path: `${st.ctx.runDir}/REPLY.md`, content: `${reply}\n` });
    for (const [p, content] of stagedEntries) {
      const path = project ? `${project.root_path}/${p}` : `${st.ctx.recordsDir}/final/${p}`;
      files.push({ path, content });
      if (content !== null) outputs.push({ path, size: Buffer.byteLength(content), name: p });
    }
    for (const p of external) outputs.push({ path: p });
    files.push(
      await manifestFile(repo, st, task, project, {
        n: st.ctx.run,
        stage: st.stage,
        job_id: run.job.id,
        at: new Date().toISOString(),
        folder: st.ctx.runDir,
        workflow: st.workflow.name,
        models: [...new Set(st.models)],
        outputs: outputs.map((o) => o.path ?? "").filter(Boolean),
        ...(stagedEntries.length || external.length ? { changed: [...stagedEntries.map(([p]) => p), ...external] } : {}),
      }),
    );
    const title = st.ctx.prompt.split("\n")[0].slice(0, 70) || task.title;
    const commit = await commitFiles(repo, files, `[TaskFlow] ${task.code} ${st.stage === "prework" ? "پیش‌کار" : "کار اصلی"}: ${title}`);
    commitUrl = commit?.url ?? null;
    await run.log({
      source: "github",
      kind: "commit",
      title: project && stagedEntries.length ? `${stagedEntries.length} فایل در پروژه‌ی «${project.name}» به‌روز شد` : `خروجی‌ها در GitHub ذخیره شد (${outputs.length} فایل)`,
      detail: commitUrl,
      data: { url: commitUrl },
    });
  } else {
    // no GitHub: outputs are kept in Supabase Storage
    const plain = [...records.map((r) => ({ path: r.path, content: r.content })), ...stagedEntries.filter(([, c]) => c !== null).map(([p, c]) => ({ path: p, content: c as string }))];
    outputs.push(...(await storeOutputs(st.ctx.ownerId, task.id, run.job.id, plain)));
    if (plain.length) await run.log({ source: "system", kind: "file", title: `${plain.length} فایل خروجی ذخیره شد` });
  }

  // keep the project's file map in step with what changed
  if (project) {
    const rows = stagedEntries.filter(([, c]) => c !== null).map(([p, c]) => indexRow(project.id, p, c as string));
    if (rows.length) await upsertIndex(rows);
    const removed = stagedEntries.filter(([, c]) => c === null).map(([p]) => p);
    if (removed.length) await removeFromIndex(project.id, removed);
    const ext = external.filter((p) => p.startsWith(`${project.root_path}/`) && !p.includes("/.taskflow/")).map((p) => p.slice(project.root_path.length + 1));
    for (const p of ext) {
      const text = repo ? await getFileText(repo, `${project.root_path}/${p}`).catch(() => null) : null;
      if (text === null) await removeFromIndex(project.id, [p]);
      else await upsertIndex([indexRow(project.id, p, text)]);
    }
    if (rows.length || removed.length || ext.length) {
      await refreshStats(project.id);
      await writeIndexFile(project, repo ?? undefined).catch(() => undefined);
    }
  }

  await registerOutputs(task.id, run.job.id, outputs);
  await saveReply(task.id, run.job.id, reply);
  await run.setNode("publish", { status: "done", detail: `${outputs.length} فایل` });

  const cfg = await getUserConfig(st.ctx.ownerId);
  const changedAll = [...stagedEntries.map(([p]) => p), ...external];
  if (project && cfg.knowledge.autoUpdate) {
    await enqueueJob({
      kind: "knowledge",
      owner_id: st.ctx.ownerId,
      connection_id: stageModel(cfg, "knowledge").connectionId,
      project_id: project.id,
      task_id: task.id,
      payload: { stage: st.stage, prompt: truncate(st.ctx.prompt, 6000), reply: truncate(reply, 8000), changed: changedAll.slice(0, 200) },
      priority: 35,
    });
  }
  if (project && st.stage === "main" && cfg.graphify.mode !== "off" && changedAll.length) {
    await enqueueJob({ kind: "graphify", owner_id: st.ctx.ownerId, project_id: project.id, payload: { project_id: project.id }, priority: 30 });
  }
  if (st.stage === "main") {
    await db().from("tasks").update({ status: "main_done", progress: 90, main_done_at: new Date().toISOString() }).eq("id", task.id);
    await logEvent({ task_id: task.id, job_id: run.job.id, kind: "status", title: "وضعیت: کار اصلی انجام شد — در حال نهایی‌سازی", visibility: "requester" });
    await logEvent({ task_id: task.id, job_id: run.job.id, source: "ai", kind: "result", title: `کار اصلی تمام شد${outputs.length ? ` (${outputs.length} فایل)` : ""}`, detail: reply, data: { url: commitUrl } });
    await notify(st.ctx.ownerId, { title: `کار اصلی ${task.code} تمام شد`, body: truncate(reply, 240), link: `/tasks/${task.id}`, task_id: task.id });
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
/**
 * Advances a stage's workflow by one step (serverless friendly: every step fits the worker budget
 * and the state lives in job_data). Returns "external" when a coder step must run in GitHub Actions.
 */
export async function engineStep(run: JobRun, stage: Stage): Promise<EngineStep> {
  let st = load(run);
  if (!st || st.stage !== stage) st = await start(run, stage);
  switch (st.phase) {
    case "prepare":
      await prepare(run, st);
      st.phase = st.ctx.runDir && st.ctx.inputs.length ? "inputs" : "run";
      await save(run, st);
      return { type: "continue" };
    case "inputs":
      if (await uploadInputs(run, st)) st.phase = "run";
      await save(run, st);
      return { type: "continue" };
    case "run":
      return runStep(run, st);
    case "publish":
      await publish(run, st);
      st.phase = "done";
      await save(run, st);
      return { type: "done" };
    default:
      return { type: "done" };
  }
}

/** Material for the Claude Code step running in GitHub Actions. */
export function externalStepPrompt(st: EngineState): { text: string; agent: AgentDef | null; node: WorkflowNode | null } {
  const id = st.externalNode;
  const node = id ? (st.workflow.nodes.find((n) => n.id === id) ?? null) : null;
  if (!node) return { text: "", agent: null, node: null };
  const lines: string[] = [];
  if (node.instructions?.trim()) lines.push("## دستور این مرحله", node.instructions.trim());
  const inputs = inputsOf(st, node.id);
  if (inputs) lines.push("## خروجی مراحل قبل همین ورکفلو", inputs);
  return { text: lines.join("\n\n"), agent: st.agents[node.agentId] ?? null, node };
}

/**
 * The GitHub runner finished a Claude Code step: record it and hand the job back to the queue so the
 * rest of the workflow (and publishing) runs. Returns false for jobs without a workflow.
 */
export async function completeExternalNode(job: Job, r: { summary?: string; files_changed?: string[]; commit_url?: string | null }): Promise<boolean> {
  const st = await readEngine(job.id);
  if (!st?.externalNode) return false;
  const id = st.externalNode;
  const project = st.ctx.projectId ? await getProject(st.ctx.projectId).catch(() => null) : null;
  const okPrefix = project ? `${project.root_path}/` : st.ctx.recordsDir ? `${st.ctx.recordsDir}/final/` : "";
  const changed = (r.files_changed ?? []).filter((p) => okPrefix && p.startsWith(okPrefix) && !p.includes("/.taskflow/") && !p.includes("/.claude-session/"));
  st.results[id] = { ...(st.results[id] ?? { attempts: 1 }), status: "done", text: (r.summary ?? "").trim(), changed, commitUrl: r.commit_url ?? null };
  st.externalNode = null;
  await writeEngine(job.id, st);
  const nodes = { ...(job.state?.nodes ?? {}) };
  nodes[id] = { ...(nodes[id] ?? {}), status: "done", finished_at: new Date().toISOString(), detail: `${changed.length} فایل` };
  await db()
    .from("jobs")
    .update({
      // the watchdog may already have marked the job done: the workflow is not finished yet
      status: "running",
      finished_at: null,
      step: "run",
      state: { ...(job.state ?? {}), nodes },
      locked_by: null,
      locked_until: null,
      run_after: new Date().toISOString(),
      external_id: null,
      external_url: null,
    })
    .eq("id", job.id);
  await kickWorker();
  return true;
}
