import "server-only";
import type { Content, Part } from "@google/genai";
import { db } from "@/lib/supabase/admin";
import { generate, generateJson, type GenContext } from "@/lib/ai/gemini";
import { getAgentPrompt, KNOWLEDGE_SCHEMA } from "@/lib/ai/prompts";
import { addKnowledge, formatKnowledgeContext, searchKnowledge, KNOWLEDGE_KINDS } from "@/lib/ai/knowledge";
import { fileRefsToParts, prepareFilesForGemini, downloadStorage, type FileRef } from "@/lib/ai/files";
import { getSettings } from "@/lib/settings";
import { DeadlineError, RateLimitError } from "@/lib/errors";
import { commitFiles, getFileText, repoRef, type CommitFile } from "@/lib/github/client";
import { emptyManifest, iterationFolder, mergeManifest, readmeMarkdown, requestMarkdown, rootFolder, type Manifest, type ManifestFile } from "@/lib/github/workspace";
import { helperFileName, isDeliverablePath, stripCodeFence } from "@/lib/agents/parse";
import { registerOutputs, saveReply } from "@/lib/tasks/outputs";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { logEvent, notifyAdmins } from "@/lib/events";
import { PRIORITY_META, RELATION_META } from "@/lib/status";
import { formatJalali } from "@/lib/jalali";
import { errorMessage, slugify, truncate, wordCount } from "@/lib/utils";
import { agentMap, agentPrompt, resolveWorkflow, DEFAULT_WORKFLOWS } from "@/lib/workflow/registry";
import { flowSummary, incoming, nextBatch, validateWorkflow, type AgentDef, type Branch, type NodeRunStatus, type Stage, type WorkflowDef, type WorkflowNode } from "@/lib/workflow/types";
import type { JobRun } from "@/lib/queue/run";
import type { Job, NodeState, Profile, Task, TaskFile } from "@/lib/types";

const STATE_VERSION = 1;
/** Parallel Gemini calls per step (free-tier friendly). */
const MAX_PARALLEL = 3;
/** A node that failed this many times fails the whole job. */
const MAX_NODE_ATTEMPTS = 3;
/** Text of previous steps (and Claude's text deliverables) passed to the next agent. */
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
  /** claude: deliverable paths in the workspace repo */
  deliverables?: string[];
  commitUrl?: string | null;
}

interface StageContext {
  taskId: string;
  prompt: string;
  rootPath: string;
  iterPath: string;
  request: string;
  context: string;
  history: { role: "user" | "model"; text: string }[];
  fileRefs: FileRef[];
  inputs: { id: string; name: string; storage_path: string; size: number | null }[];
  inputsCursor: number;
  inputPaths: string[];
}

export interface EngineState {
  v: number;
  stage: Stage;
  workflow: WorkflowDef;
  agents: Record<string, AgentDef>;
  /** agent prompts resolved when the run started, so an edit mid-run does not mix versions */
  prompts: Record<string, string>;
  phase: "prepare" | "inputs" | "run" | "knowledge" | "publish" | "done";
  ctx: StageContext;
  results: Record<string, NodeResult>;
  /** main: the Claude node the GitHub runner is working on */
  claudeNode: string | null;
  knowledgeItems: { kind: string; title: string; content: string; tags?: string[]; score?: number }[];
  models: string[];
}

export type EngineStep = { type: "continue" } | { type: "claude" } | { type: "done" } | { type: "fail"; error: string };

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
  await db()
    .from("job_data")
    .upsert({ job_id: jobId, graph: { values: st, lastNode: st.phase, next: [] }, updated_at: new Date().toISOString() });
}

async function loadTask(id: string): Promise<Task> {
  const { data, error } = await db().from("tasks").select("*").eq("id", id).single<Task>();
  if (error || !data) throw new Error(`تسک ${id} یافت نشد`);
  return data;
}

function nodeLabel(st: EngineState, n: WorkflowNode) {
  return n.label || st.agents[n.agentId]?.name || n.agentId;
}

function historyContents(history: StageContext["history"]): Content[] {
  const out: Content[] = [];
  for (const h of history ?? []) {
    const last = out[out.length - 1];
    if (last && last.role === h.role) last.parts!.push({ text: `\n\n${h.text}` });
    else out.push({ role: h.role, parts: [{ text: h.text }] });
  }
  if (out.length && out[0].role !== "user") out.unshift({ role: "user", parts: [{ text: "سابقه‌ی گفت‌وگوی این پروژه:" }] });
  if (out.length && out[out.length - 1].role === "user") out.push({ role: "model", parts: [{ text: "متوجه شدم." }] });
  return out;
}

async function saveMessage(st: EngineState, jobId: string, agent: string, role: "user" | "model", content: string) {
  const task = await loadTask(st.ctx.taskId);
  await db()
    .from("ai_messages")
    .insert({ root_task_id: task.root_id ?? task.id, task_id: task.id, job_id: jobId, agent, role, content });
}

async function setProgress(run: JobRun, st: EngineState) {
  if (!run.job.task_id) return;
  const nodes = st.workflow.nodes.length || 1;
  const finished = Object.values(st.results).filter((r) => r.status === "done" || r.status === "skipped").length;
  const [from, span] = st.stage === "prework" ? [22, 26] : [62, 26];
  const progress = Math.round(from + (span * finished) / nodes);
  await db().from("tasks").update({ progress }).eq("id", run.job.task_id).lt("progress", progress);
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------
async function start(run: JobRun, stage: Stage): Promise<EngineState> {
  const agents = await agentMap();
  let workflow = await resolveWorkflow(stage, run.job.payload.workflow_id);
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
    prompts[a.id] ??= await agentPrompt(a);
  }
  const st: EngineState = {
    v: STATE_VERSION,
    stage,
    workflow,
    agents: used,
    prompts,
    phase: "prepare",
    ctx: { taskId: run.job.task_id!, prompt: String(run.job.payload.prompt ?? ""), rootPath: "", iterPath: "", request: "", context: "", history: [], fileRefs: [], inputs: [], inputsCursor: 0, inputPaths: [] },
    results: {},
    claudeNode: null,
    knowledgeItems: [],
    models: [],
  };
  const flow = flowSummary(workflow, used);
  const nodes: Record<string, NodeState> = {};
  for (const n of flow.nodes) nodes[n.id] = { status: "pending" };
  await run.patchState({ flow, nodes });
  await run.log({ source: "system", kind: "node", title: `ورکفلوی «${workflow.name}» با ${workflow.nodes.length} ایجنت شروع شد` });
  await save(run, st);
  return st;
}

// ---------------------------------------------------------------------------
// system steps
// ---------------------------------------------------------------------------
async function prepare(run: JobRun, st: EngineState) {
  await run.setNode("prepare", { status: "running" });
  const settings = await getSettings();
  const task = await loadTask(st.ctx.taskId);
  const root = task.root_id && task.root_id !== task.id ? await loadTask(task.root_id) : task;
  const parent = task.parent_id ? await loadTask(task.parent_id) : null;
  const { data: requester } = await db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>();

  const rootPath = rootFolder(root);
  if (!root.github_path) await db().from("tasks").update({ github_path: rootPath }).or(`id.eq.${root.id},root_id.eq.${root.id}`);
  const iterPath = iterationFolder({ ...root, github_path: rootPath }, task);

  const isRelated = !!task.parent_id;
  const lines = [
    `# تسک: ${task.title} (${task.code})`,
    `- نوع: ${task.kind === "event" ? "رویداد" : "تسک"} | اولویت: ${PRIORITY_META[task.priority].label}`,
    task.kind === "event" ? `- زمان رویداد: ${formatJalali(task.event_at, { withTime: true })}` : `- بازه‌ی زمانی: ${formatJalali(task.start_date)} تا ${formatJalali(task.end_date)}`,
    `- تسک‌دهنده: ${requester?.full_name ?? "—"}${requester?.org_unit ? ` (${requester.org_unit})` : ""}`,
    "",
    "## شرح تسک",
    task.description || "—",
  ];
  if (isRelated) {
    lines.push(
      "",
      "## ارتباط با تسک اصلی",
      `این یک «${RELATION_META[task.relation_type ?? "other"]}» برای تسک اصلی ${root.code} «${root.title}» است${parent && parent.id !== root.id ? ` (مستقیماً مرتبط با ${parent.code} «${parent.title}»)` : ""}.`,
      "این تسک جدید نیست؛ کار را در ادامه‌ی همان پروژه و بر اساس سابقه‌ی قبلی انجام بده و فقط آنچه لازم است تغییر/اضافه کن.",
    );
    if (parent?.closure_reject_reason) lines.push(`- دلیل رد خاتمه توسط تسک‌دهنده: ${parent.closure_reject_reason}`);
  }
  const agents = Object.values(st.agents).filter((a) => a.type !== "claude");

  // knowledge base search only when an agent of this workflow uses it
  let context = "";
  if (agents.some((a) => a.knowledge)) {
    try {
      const q = `${task.title}\n${task.description}\n${st.ctx.prompt}`;
      const [general, profileHits] = await Promise.all([
        searchKnowledge(q, settings.pipeline.ragResults),
        searchKnowledge(q, 3, { kind: "requester_profile", requester_id: task.requester_id }),
      ]);
      const seen = new Set<string>();
      const hits = [...profileHits, ...general].filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
      context = formatKnowledgeContext(hits);
      await run.log({
        source: "knowledge",
        kind: "search",
        title: hits.length ? `بازیابی ${hits.length} مورد دانش مرتبط از پایگاه دانش` : "دانش مرتبطی در پایگاه دانش یافت نشد",
        detail: hits.map((h) => `• ${h.title}`).join("\n") || null,
      });
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof DeadlineError) throw err;
      await run.log({ source: "knowledge", kind: "warning", title: "جستجوی پایگاه دانش ناموفق بود", detail: errorMessage(err) });
    }
  }

  // earlier iterations of the same project continue the same conversation
  let history: StageContext["history"] = [];
  if (isRelated && agents.length) {
    const { data: msgs } = await db()
      .from("ai_messages")
      .select("agent, role, content")
      .eq("root_task_id", root.id)
      .neq("task_id", task.id)
      .in("agent", ["request", "analyze", "analysis", "brief", "reply"])
      .order("id", { ascending: true });
    let budget = settings.pipeline.historyChars;
    for (const m of [...(msgs ?? [])].reverse()) {
      if (budget <= 0) break;
      const text = m.content.length > budget ? `${m.content.slice(0, budget)}\n…` : m.content;
      budget -= text.length;
      history.unshift({ role: m.role as "user" | "model", text });
    }
    if (history.length) await run.log({ source: "gemini", kind: "log", title: `ادامه‌ی گفت‌وگوی پروژه ${root.code}: ${history.length} پیام از تکرارهای قبلی بارگذاری شد` });
  } else history = [];

  const contexts = st.stage === "prework" ? ["request", "prework"] : ["request", "prework", "main"];
  const { data: files } = await db().from("task_files").select("*").eq("task_id", task.id).in("context", contexts).order("created_at");
  const all = (files ?? []) as TaskFile[];
  const fileRefs = agents.some((a) => a.attachments)
    ? await prepareFilesForGemini(all, run.deadline, (msg) => run.log({ source: "gemini", kind: "file", title: msg }))
    : [];

  st.ctx = {
    ...st.ctx,
    rootPath,
    iterPath,
    request: lines.join("\n"),
    context,
    history,
    fileRefs,
    // pre-work publishes the attachments to GitHub; the main stage already did in its own prepare step
    inputs: st.stage === "prework" ? all.map((f) => ({ id: f.id, name: f.name, storage_path: f.storage_path, size: f.size })) : [],
    inputsCursor: 0,
    inputPaths: [],
  };
  if (st.stage === "prework") await saveMessage(st, run.job.id, "request", "user", `${st.ctx.request}\n\n## دستور مدیر\n${st.ctx.prompt}`);
  await run.setNode("prepare", { status: "done", detail: `${fileRefs.length} فایل، ${history.length} پیام سابقه` });
}

/** Commit attachments to GitHub incrementally (resumable across ticks). */
async function uploadInputs(run: JobRun, st: EngineState): Promise<boolean> {
  const list = st.ctx.inputs;
  let cursor = st.ctx.inputsCursor;
  if (cursor >= list.length) return true;
  const batch: CommitFile[] = [];
  const paths: string[] = [];
  while (cursor < list.length && run.timeLeft() > 20_000) {
    const f = list[cursor];
    if ((f.size ?? 0) > 20 * 1024 * 1024) {
      await run.log({ source: "github", kind: "warning", title: `فایل «${f.name}» بزرگ‌تر از ۲۰ مگابایت است؛ Claude آن را مستقیماً از Storage دریافت می‌کند` });
      cursor++;
      continue;
    }
    const blob = await downloadStorage(f.storage_path);
    const path = `${st.ctx.iterPath}/inputs/${f.name.replace(/[\\/]/g, "_")}`;
    batch.push({ path, content: new Uint8Array(await blob.arrayBuffer()) });
    paths.push(path);
    await db().from("task_files").update({ github_path: path }).eq("id", f.id);
    cursor++;
  }
  if (batch.length) {
    const c = await commitFiles(await repoRef("workspace"), batch, `[TaskFlow] پیوست‌های ${st.ctx.iterPath.split("/")[1] ?? "task"}`);
    await run.log({ source: "github", kind: "commit", title: `${batch.length} فایل پیوست در GitHub ذخیره شد`, data: { url: c?.url } });
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
async function inputsOf(st: EngineState, nodeId: string): Promise<string> {
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
    if (agent?.type === "claude" && r.deliverables?.length) {
      block.push(`فایل‌های ساخته‌شده: ${r.deliverables.map((p) => `\`${p}\``).join("، ")}`);
      const ref = await repoRef("workspace");
      for (const p of r.deliverables) {
        if (budget < 5_000 || !/\.(html?|md|txt|json|csv|css|js|ts|tsx|jsx|sql|xml|ya?ml|py|cs|java)$/i.test(p)) continue;
        const text = await getFileText(ref, p).catch(() => null);
        if (text) block.push(`#### محتوای ${p}\n${truncate(text, Math.min(budget, 40_000))}`);
      }
    }
    const joined = block.join("\n\n");
    parts.push(truncate(joined, Math.max(2_000, budget)));
    budget -= joined.length;
  }
  return parts.join("\n\n");
}

function nodeGen(run: JobRun, st: EngineState, id: string): GenContext {
  const base = run.genContext(id);
  return {
    ...base,
    getPartial: () => st.results[id]?.partial ?? null,
    savePartial: async (p) => {
      st.results[id] = { ...(st.results[id] ?? { status: "running", attempts: 0 }), partial: p };
      await save(run, st);
    },
  };
}

async function runNode(run: JobRun, st: EngineState, id: string) {
  const node = st.workflow.nodes.find((n) => n.id === id)!;
  const agent = st.agents[node.agentId];
  const label = nodeLabel(st, node);
  const settings = await getSettings();
  const prev = st.results[id];
  if (prev?.status !== "running") {
    st.results[id] = { status: "running", attempts: prev?.attempts ?? 0, partial: prev?.partial ?? null };
    await run.setNode(id, { status: "running" });
    await run.log({ source: "gemini", kind: "node", title: `${label}: شروع`, data: { node: id } });
  }

  const inputs = await inputsOf(st, id);
  const refs = agent.attachments ? st.ctx.fileRefs : [];
  const text = [
    st.ctx.request,
    `\n## دستور مدیر\n${st.ctx.prompt || "—"}`,
    node.instructions?.trim() ? `\n## دستور این مرحله\n${node.instructions.trim()}` : "",
    inputs ? `\n## خروجی مراحل قبل\n${inputs}` : "",
    refs.length ? `\n## فایل‌های پیوست (${refs.length} فایل)\n${refs.map((r) => `- ${r.name}${r.note ? ` — ${r.note}` : ""}`).join("\n")}\nمحتوای فایل‌ها در ادامه آمده است؛ آن‌ها را کامل و دقیق بررسی کن.` : "",
    agent.knowledge && st.ctx.context ? `\n## دانش بازیابی‌شده از پایگاه دانش (فقط موارد مرتبط را به کار ببر)\n${truncate(st.ctx.context, 20_000)}` : "",
  ].join("\n");
  const userParts: Part[] = [{ text }, ...fileRefsToParts(refs)];
  const common = {
    agent: agent.id,
    models: agent.models?.length ? agent.models : settings.models.prework,
    system: st.prompts[agent.id] || agent.prompt,
    history: historyContents(st.ctx.history),
    userParts,
    thinking: agent.thinking ?? settings.pipeline.thinkingLevel,
    maxOutputTokens: 32000,
    deadline: run.deadline,
    partialKey: `node:${id}`,
    ctx: nodeGen(run, st, id),
  };

  let result: NodeResult;
  if (agent.type === "router") {
    const { data, model } = await generateJson<{ decision?: string; reason?: string }>({ ...common, jsonSchema: ROUTER_SCHEMA, thinking: agent.thinking ?? "MEDIUM" });
    const decision: Branch = data.decision === "no" ? "no" : "yes";
    result = { status: "done", attempts: prev?.attempts ?? 0, text: (data.reason ?? "").trim(), decision, model };
  } else if (agent.output === "files") {
    const max = Math.max(0, Math.min(agent.maxFiles ?? 3, 10));
    const { data, model } = await generateJson<{ files?: GenFile[] }>({ ...common, jsonSchema: filesSchema(max) });
    const files = (data.files ?? [])
      .filter((f) => f?.name && f.content?.trim())
      .slice(0, max)
      .map((f, i) => ({ name: helperFileName(f.name, i), purpose: (f.purpose ?? "").trim(), content: stripCodeFence(f.content) }));
    result = { status: "done", attempts: prev?.attempts ?? 0, files, text: files.length ? files.map((f) => `- \`${f.name}\` — ${f.purpose}`).join("\n") : "فایل کمکی لازم نبود.", model };
  } else {
    const res = await generate({ ...common, useSearch: agent.useSearch ?? false });
    result = { status: "done", attempts: prev?.attempts ?? 0, text: res.text.trim(), model: res.model };
  }
  run.commitUsage();
  st.results[id] = result;
  st.models = [...st.models, result.model ?? ""].filter(Boolean);

  const msgAgent = node.brief ? "brief" : node.reply ? null : agent.id;
  if (msgAgent && result.text) await saveMessage(st, run.job.id, msgAgent, "model", result.text);
  const detail =
    agent.type === "router"
      ? `تصمیم: ${result.decision === "yes" ? "بله" : "خیر"} — ${truncate(result.text ?? "", 600)}`
      : result.files
        ? `${result.files.length} فایل`
        : `${wordCount(result.text ?? "")} کلمه`;
  await run.setNode(id, { status: "done", model: result.model, detail });
  await run.log({ source: "gemini", kind: "node", title: `${label}: انجام شد`, detail: `${detail} — مدل ${result.model}`, data: { node: id, done: true } });
}

async function runStep(run: JobRun, st: EngineState): Promise<EngineStep> {
  const outcomes = Object.fromEntries(Object.entries(st.results).map(([id, r]) => [id, { status: r.status, decision: r.decision }]));
  const isClaude = (id: string) => st.agents[st.workflow.nodes.find((n) => n.id === id)!.agentId]?.type === "claude";
  const { gemini, claude, skip, finished } = nextBatch(st.workflow, outcomes, isClaude, MAX_PARALLEL);
  for (const id of skip) {
    st.results[id] = { status: "skipped", attempts: 0 };
    await run.setNode(id, { status: "skipped", detail: "این مسیر انتخاب نشد" });
  }
  if (skip.length) await save(run, st);
  if (finished) {
    const settings = await getSettings();
    st.phase = st.stage === "prework" && settings.knowledge.autoExtract ? "knowledge" : "publish";
    await save(run, st);
    return { type: "continue" };
  }
  if (st.claudeNode) return { type: "claude" };

  if (gemini.length) {
    const settled = await Promise.allSettled(gemini.map((id) => runNode(run, st, id)));
    await setProgress(run, st);
    let rate: RateLimitError | null = null;
    for (const [i, s] of settled.entries()) {
      if (s.status === "fulfilled") continue;
      const id = gemini[i];
      const err = s.reason;
      if (err instanceof DeadlineError) continue; // partial output saved; continues next step
      if (err instanceof RateLimitError) {
        rate ??= err;
        continue;
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
      await run.log({ source: "gemini", kind: "warning", title: `${label}: خطا؛ تلاش دوباره (${attempts}/${MAX_NODE_ATTEMPTS})`, detail: errorMessage(err) });
    }
    await save(run, st);
    if (rate) throw rate;
    return { type: "continue" };
  }

  if (claude) {
    const prev = st.results[claude];
    st.results[claude] = { status: "running", attempts: (prev?.attempts ?? 0) + 1 };
    st.claudeNode = claude;
    await save(run, st);
    await run.setNode(claude, { status: "running", detail: "اجرا در GitHub Actions" });
    return { type: "claude" };
  }
  return { type: "continue" };
}

// ---------------------------------------------------------------------------
// knowledge + publish
// ---------------------------------------------------------------------------
async function extractKnowledge(run: JobRun, st: EngineState) {
  await run.setNode("publish", { status: "running", detail: "استخراج دانش" });
  const settings = await getSettings();
  const task = await loadTask(st.ctx.taskId);
  const outputs = st.workflow.nodes
    .filter((n) => st.results[n.id]?.status === "done" && st.results[n.id]?.text)
    .map((n) => `## ${nodeLabel(st, n)}\n${truncate(st.results[n.id].text ?? "", 12_000)}`)
    .join("\n\n");
  try {
    const { data } = await generateJson<{ items: EngineState["knowledgeItems"] }>({
      agent: "knowledge",
      models: settings.models.knowledge,
      system: await getAgentPrompt("knowledge"),
      userParts: [{ text: `${truncate(st.ctx.request, 4000)}\n\n## دستور مدیر\n${truncate(st.ctx.prompt, 3000)}\n\n${truncate(outputs, 24_000)}` }],
      jsonSchema: KNOWLEDGE_SCHEMA,
      thinking: "LOW",
      deadline: run.deadline,
      partialKey: "knowledge",
      ctx: run.genContext("publish"),
    });
    run.commitUsage();
    const items = (data.items ?? []).filter((i) => (i.score ?? 0) >= settings.knowledge.minScore && i.content?.trim());
    const stored = await addKnowledge(
      items.map((i) => ({ ...i, task_id: task.id, task_code: task.code, requester_id: i.kind === "requester_profile" ? task.requester_id : null, source: "prework" })),
    );
    st.knowledgeItems = items;
    await run.log({ source: "knowledge", kind: "result", title: `${items.length} مورد دانش استخراج و در پایگاه دانش ذخیره شد`, detail: `${stored} قطعه‌ی برداری` });
  } catch (err) {
    if (err instanceof RateLimitError || err instanceof DeadlineError) throw err;
    await run.log({ source: "knowledge", kind: "warning", title: "استخراج دانش ناموفق بود (ادامه می‌یابد)", detail: errorMessage(err) });
  }
}

/** Saved text of a node, optionally followed by the outputs it received. */
async function fileContent(st: EngineState, n: WorkflowNode): Promise<string> {
  const body = (st.results[n.id].text ?? "").trim();
  if (!n.appendInputs) return `${body}\n`;
  const inputs = await inputsOf(st, n.id);
  return inputs ? `${body}\n\n---\n\n## پیوست: خروجی مراحل قبل\n\n${inputs}\n` : `${body}\n`;
}

function replyText(st: EngineState): string {
  const done = st.workflow.nodes.filter((n) => st.results[n.id]?.status === "done");
  const flagged = done.filter((n) => n.reply).map((n) => st.results[n.id].text ?? "").filter(Boolean);
  if (flagged.length) return flagged.join("\n\n");
  const last = done.filter((n) => st.agents[n.agentId]?.type !== "router").pop();
  return last ? truncate(st.results[last.id].text ?? "", 4000) : "";
}

async function publishPrework(run: JobRun, st: EngineState) {
  await run.setNode("publish", { status: "running" });
  const task = await loadTask(st.ctx.taskId);
  const root = task.root_id && task.root_id !== task.id ? await loadTask(task.root_id) : task;
  const { data: requester } = await db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>();
  const workspace = await repoRef("workspace");
  const it = st.ctx.iterPath;
  const pw = `${it}/prework`;
  const now = new Date().toISOString();

  const files: CommitFile[] = [];
  const mf: ManifestFile[] = [];
  const outputs: { path: string; size: number; name?: string }[] = [];
  const add = (path: string, content: string, role: string, agent: string, description: string, extra: Partial<ManifestFile> = {}) => {
    files.push({ path, content });
    mf.push({ path, role, agent, iteration: task.seq_in_root, description, updated_at: now, ...extra });
  };

  add(`${it}/request.md`, requestMarkdown(task, requester, root), "request", "تسک‌دهنده", "درخواست و مشخصات تسک");
  add(`${it}/PROMPT-prework.md`, `# پرامپت پیش‌کار\n\n${st.ctx.prompt}\n`, "prompt", "مدیر", "دستور مدیر برای پیش‌کار");
  const ordered = [...st.workflow.nodes].sort((a, b) => Number(!!b.brief) - Number(!!a.brief));
  const briefPaths: string[] = [];
  for (const n of ordered) {
    const r = st.results[n.id];
    if (r?.status !== "done") continue;
    const label = nodeLabel(st, n);
    if (n.saveAs && r.text) {
      const path = `${pw}/${helperFileName(n.saveAs, 0)}`;
      const content = await fileContent(st, n);
      add(path, content, n.brief ? "brief" : "prework", "Gemini", n.brief ? "دستور کار برای Claude" : label, { depends_on: [`${it}/request.md`, ...st.ctx.inputPaths] });
      outputs.push({ path, size: Buffer.byteLength(content), name: n.brief ? `دستور کار (${n.saveAs})` : n.saveAs });
      if (n.brief) briefPaths.push(path);
    }
    for (const f of r.files ?? []) {
      const path = `${pw}/files/${f.name}`;
      add(path, f.content, "helper", "Gemini", f.purpose || label, { depends_on: briefPaths });
      outputs.push({ path, size: Buffer.byteLength(f.content) });
    }
  }
  for (const p of st.ctx.inputPaths) mf.push({ path: p, role: "input", agent: "تسک‌دهنده", iteration: task.seq_in_root, description: "فایل پیوست", updated_at: now });
  for (const k of st.knowledgeItems) {
    files.push({
      path: `knowledge/${k.kind}/${task.code}_${slugify(k.title, 40)}.md`,
      content: `# ${k.title}\n\n- نوع: ${KNOWLEDGE_KINDS[k.kind] ?? k.kind}\n- منبع: تسک ${task.code} «${task.title}»\n- برچسب‌ها: ${(k.tags ?? []).join("، ")}\n- ارزش استفاده‌ی مجدد: ${k.score ?? "—"}/5\n\n${k.content}\n`,
    });
  }

  const existing = await getFileText(workspace, `${st.ctx.rootPath}/manifest.json`);
  let manifest: Manifest = existing ? JSON.parse(existing) : emptyManifest(root, requester);
  manifest = mergeManifest(manifest, mf, {
    seq: task.seq_in_root,
    code: task.code,
    title: task.title,
    relation: task.relation_type,
    folder: it,
    prework: { job_id: run.job.id, completed_at: now, models: [...new Set(st.models)], files: outputs.length },
  });
  const { data: family } = await db().from("tasks").select("*").or(`id.eq.${root.id},root_id.eq.${root.id}`);
  files.push({ path: `${st.ctx.rootPath}/manifest.json`, content: JSON.stringify(manifest, null, 2) });
  files.push({ path: `${st.ctx.rootPath}/README.md`, content: readmeMarkdown(root, manifest, (family ?? []) as Task[]) });
  const history = (await getFileText(workspace, `${st.ctx.rootPath}/HISTORY.md`)) ?? `# تاریخچه‌ی ${root.code}\n`;
  files.push({
    path: `${st.ctx.rootPath}/HISTORY.md`,
    content: `${history.trim()}\n\n## ${formatJalali(now, { withTime: true })} — پیش‌کار تکرار ${String(task.seq_in_root).padStart(2, "0")} (${task.code})\n- ${task.title}\n- ورکفلو: ${st.workflow.name}\n- خروجی‌ها: ${outputs.map((o) => `\`${o.path.replace(`${st.ctx.rootPath}/`, "")}\``).join("، ") || "—"}\n`,
  });
  if (!(await getFileText(workspace, `${st.ctx.rootPath}/.graphifyignore`))) {
    files.push({ path: `${st.ctx.rootPath}/.graphifyignore`, content: ".claude-session/\ngraphify-out/cache/\n*.jsonl\n" });
  }

  const commit = await commitFiles(workspace, files, `[TaskFlow] پیش‌کار ${task.code}: ${task.title}`);
  await registerOutputs(task.id, run.job.id, outputs);
  await saveReply(task.id, run.job.id, replyText(st) || "پیش‌کار انجام شد.");
  await run.log({ source: "github", kind: "commit", title: `خروجی پیش‌کار در GitHub منتشر شد (${outputs.length} فایل)`, detail: commit?.url ?? null, data: { url: commit?.url, path: st.ctx.rootPath } });
  await run.setNode("publish", { status: "done", detail: commit?.sha.slice(0, 7) });
}

async function publishMain(run: JobRun, st: EngineState) {
  await run.setNode("publish", { status: "running" });
  const task = await loadTask(st.ctx.taskId);
  const finalDir = `${st.ctx.rootPath}/final`;
  const files: CommitFile[] = [];
  const outputs: { path: string; size?: number | null; name?: string }[] = [];
  const seen = new Set<string>();
  for (const n of st.workflow.nodes) {
    const r = st.results[n.id];
    if (r?.status !== "done") continue;
    for (const p of r.deliverables ?? []) {
      if (!seen.has(p)) outputs.push({ path: p });
      seen.add(p);
    }
    // Gemini steps of the main stage deliver into final/ as well
    if (n.saveAs && r.text) {
      const path = `${finalDir}/${helperFileName(n.saveAs, 0)}`;
      const content = await fileContent(st, n);
      files.push({ path, content });
      outputs.push({ path, size: Buffer.byteLength(content), name: n.saveAs });
    }
    for (const f of r.files ?? []) {
      const path = `${finalDir}/${f.name}`;
      files.push({ path, content: f.content });
      outputs.push({ path, size: Buffer.byteLength(f.content) });
    }
  }
  let commitUrl: string | null = null;
  if (files.length) commitUrl = (await commitFiles(await repoRef("workspace"), files, `[TaskFlow] خروجی کار اصلی ${task.code}`))?.url ?? null;
  await registerOutputs(task.id, run.job.id, outputs);
  const reply = replyText(st);
  await saveReply(task.id, run.job.id, reply || "کار اصلی انجام شد.");
  await db().from("tasks").update({ status: "main_done", progress: 90, main_done_at: new Date().toISOString() }).eq("id", task.id);
  await logEvent({ task_id: task.id, job_id: run.job.id, kind: "status", title: "وضعیت: کار اصلی انجام شد — در حال نهایی‌سازی", visibility: "requester" });
  await logEvent({
    task_id: task.id,
    job_id: run.job.id,
    source: "claude",
    kind: "result",
    title: `خروجی نهایی در GitHub ذخیره شد${outputs.length ? ` (${outputs.length} فایل)` : ""}`,
    detail: reply || null,
    data: { url: commitUrl ?? st.workflow.nodes.map((n) => st.results[n.id]?.commitUrl).filter(Boolean).pop() ?? null },
  });
  await notifyAdmins({ title: `کار اصلی ${task.code} تمام شد`, body: (reply || task.title).slice(0, 240), link: `/tasks/${task.id}`, task_id: task.id });
  const settings = await getSettings();
  const path = task.github_path;
  if (settings.knowledge.autoExtract && path) await enqueueJob({ kind: "knowledge", task_id: task.id, payload: { path, source: "main" }, priority: 35 });
  if (settings.graphify.mode !== "off" && path) await enqueueJob({ kind: "graphify", task_id: task.id, payload: { path }, priority: 30 });
  await run.setNode("publish", { status: "done", detail: `${outputs.length} فایل` });
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
/**
 * Advances a stage's workflow by one step (serverless friendly: every step fits the worker budget
 * and the state lives in job_data). Returns "claude" when a Claude node must run in GitHub Actions.
 */
export async function engineStep(run: JobRun, stage: Stage): Promise<EngineStep> {
  let st = load(run);
  if (!st || st.stage !== stage) {
    if (run.data.graph?.values && !st) await run.log({ source: "system", kind: "warning", title: "این اجرا با موتور ورکفلوی جدید از ابتدا شروع می‌شود" });
    st = await start(run, stage);
  }
  switch (st.phase) {
    case "prepare":
      await prepare(run, st);
      st.phase = stage === "prework" ? "inputs" : "run";
      await save(run, st);
      return { type: "continue" };
    case "inputs":
      if (await uploadInputs(run, st)) st.phase = "run";
      await save(run, st);
      return { type: "continue" };
    case "run":
      return runStep(run, st);
    case "knowledge":
      await extractKnowledge(run, st);
      st.phase = "publish";
      await save(run, st);
      return { type: "continue" };
    case "publish":
      if (stage === "prework") await publishPrework(run, st);
      else await publishMain(run, st);
      st.phase = "done";
      await save(run, st);
      return { type: "done" };
    default:
      return { type: "done" };
  }
}

/** The part of Claude's prompt that belongs to the current workflow step (its instructions and inputs). */
export async function claudeStepPrompt(st: EngineState): Promise<{ text: string; agent: AgentDef | null }> {
  const id = st.claudeNode;
  const node = id ? st.workflow.nodes.find((n) => n.id === id) : null;
  if (!node) return { text: "", agent: null };
  const agent = st.agents[node.agentId] ?? null;
  const claudeSteps = st.workflow.nodes.filter((n) => st.agents[n.agentId]?.type === "claude");
  const lines: string[] = [];
  const own = [st.prompts[node.agentId], node.instructions].map((s) => s?.trim()).filter((s): s is string => !!s);
  if (claudeSteps.length > 1 || own.length) lines.push(`## این مرحله: ${nodeLabel(st, node)}`, ...own);
  const inputs = await inputsOf(st, node.id);
  if (inputs) lines.push("## خروجی مراحل قبل همین ورکفلو", inputs);
  return { text: lines.join("\n\n"), agent };
}

/**
 * The GitHub runner finished a Claude node: record its result and hand the job back to the queue so
 * the rest of the workflow (or the final publish step) runs. Returns false for jobs without a workflow.
 */
export async function completeClaudeNode(job: Job, r: { summary?: string; files_changed?: string[]; commit_url?: string | null }): Promise<boolean> {
  const st = await readEngine(job.id);
  if (!st?.claudeNode) return false;
  const id = st.claudeNode;
  const { data: task } = await db().from("tasks").select("github_path").eq("id", job.task_id).maybeSingle<{ github_path: string | null }>();
  const deliverables = task?.github_path ? (r.files_changed ?? []).filter((p) => isDeliverablePath(task.github_path!, p)) : [];
  st.results[id] = { ...(st.results[id] ?? { attempts: 1 }), status: "done", text: (r.summary ?? "").trim(), deliverables, commitUrl: r.commit_url ?? null };
  st.claudeNode = null;
  await writeEngine(job.id, st);
  const nodes = { ...(job.state?.nodes ?? {}) };
  nodes[id] = { ...(nodes[id] ?? {}), status: "done", finished_at: new Date().toISOString(), detail: `${deliverables.length} فایل` };
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
