import "server-only";
import { StateGraph, Annotation, START, END, MemorySaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { Content } from "@google/genai";
import { db } from "@/lib/supabase/admin";
import { generate, generateJson } from "@/lib/ai/gemini";
import { getAgentPrompt, KNOWLEDGE_SCHEMA, PLAN_SCHEMA } from "@/lib/ai/prompts";
import { addKnowledge, formatKnowledgeContext, searchKnowledge, KNOWLEDGE_KINDS } from "@/lib/ai/knowledge";
import { fileRefsToParts, prepareFilesForGemini, downloadStorage, type FileRef } from "@/lib/ai/files";
import { getSettings } from "@/lib/settings";
import { DeadlineError, RateLimitError } from "@/lib/errors";
import { commitFiles, getFileText, repoRef, type CommitFile } from "@/lib/github/client";
import {
  emptyManifest,
  iterationFolder,
  mergeManifest,
  readmeMarkdown,
  requestMarkdown,
  rootFolder,
  type Manifest,
  type ManifestFile,
} from "@/lib/github/workspace";
import { helperFileName, stripCodeFence } from "@/lib/agents/parse";
import { registerOutputs, saveReply } from "@/lib/tasks/outputs";
import { PRIORITY_META, RELATION_META } from "@/lib/status";
import { formatJalali } from "@/lib/jalali";
import { errorMessage, slugify, truncate, wordCount } from "@/lib/utils";
import type { JobRun } from "@/lib/queue/run";
import type { Profile, Task, TaskFile } from "@/lib/types";

// ---------------------------------------------------------------------------
// State (every channel is "last value" so the snapshot can round-trip through the DB)
// ---------------------------------------------------------------------------
export interface HelperSpec {
  path: string;
  purpose: string;
  instructions: string;
}

const PreworkAnnotation = Annotation.Root({
  taskId: Annotation<string>(),
  prompt: Annotation<string>(),
  rootPath: Annotation<string>(),
  iterPath: Annotation<string>(),
  request: Annotation<string>(),
  isRelated: Annotation<boolean>(),
  context: Annotation<string>(),
  knowledgeHits: Annotation<number>(),
  history: Annotation<{ role: "user" | "model"; text: string }[]>(),
  fileRefs: Annotation<FileRef[]>(),
  inputs: Annotation<{ id: string; name: string; storage_path: string; size: number | null }[]>(),
  inputsCursor: Annotation<number>(),
  inputPaths: Annotation<string[]>(),
  analysis: Annotation<string>(),
  reply: Annotation<string>(),
  brief: Annotation<string>(),
  helperSpecs: Annotation<HelperSpec[]>(),
  helperCursor: Annotation<number>(),
  helperFiles: Annotation<{ path: string; purpose: string; content: string }[]>(),
  knowledgeItems: Annotation<{ kind: string; title: string; content: string; tags?: string[]; score?: number }[]>(),
  commit: Annotation<{ sha: string; url: string } | null>(),
  models: Annotation<string[]>(),
});

export type PreworkState = typeof PreworkAnnotation.State;

export const PREWORK_GRAPH_NODES = ["prepare", "upload_inputs", "agent_analyze", "agent_plan", "agent_helper", "extract_knowledge", "publish"] as const;

/** Graph node → mini-workflow display node */
export const DISPLAY_NODE: Record<string, string> = {
  prepare: "prepare",
  upload_inputs: "prepare",
  agent_analyze: "analyze",
  agent_plan: "plan",
  agent_helper: "helper",
  extract_knowledge: "knowledge",
  publish: "publish",
};

const NODE_PROGRESS: Record<string, number> = {
  prepare: 22,
  analyze: 32,
  plan: 42,
  helper: 46,
  knowledge: 48,
  publish: 50,
};

/** Text attachments are repeated for the planner/helper only when small enough to stay cheap. */
const REPEAT_FILES_MAX_CHARS = 150_000;

// The JobRun is looked up by thread id so it never ends up inside a checkpoint.
const RUNS = new Map<string, JobRun>();

function runOf(config: LangGraphRunnableConfig): JobRun {
  const id = config.configurable?.thread_id as string;
  const run = RUNS.get(id);
  if (!run) throw new Error("JobRun یافت نشد");
  return run;
}

async function loadTask(id: string): Promise<Task> {
  const { data, error } = await db().from("tasks").select("*").eq("id", id).single<Task>();
  if (error || !data) throw new Error(`تسک ${id} یافت نشد`);
  return data;
}

async function beginNode(run: JobRun, graphNode: string, title: string) {
  const key = DISPLAY_NODE[graphNode];
  const cur = run.state.nodes?.[key];
  if (cur?.status !== "running") {
    await run.setNode(key, { status: "running" });
    await run.log({ source: "gemini", kind: "node", title, data: { node: key } });
  }
}

async function finishNode(run: JobRun, graphNode: string, title: string, detail?: string, extra: Record<string, unknown> = {}) {
  const key = DISPLAY_NODE[graphNode];
  await run.setNode(key, { status: "done", detail, ...extra });
  await run.log({ source: "gemini", kind: "node", title, detail, data: { node: key, done: true } });
  const progress = NODE_PROGRESS[key];
  if (progress && run.job.task_id) {
    await db().from("tasks").update({ progress }).eq("id", run.job.task_id).lt("progress", progress);
  }
}

function historyContents(history: PreworkState["history"]): Content[] {
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

async function saveMessage(run: JobRun, state: PreworkState, agent: string, role: "user" | "model", content: string) {
  const task = await loadTask(state.taskId);
  await db()
    .from("ai_messages")
    .insert({ root_task_id: task.root_id ?? task.id, task_id: task.id, job_id: run.job.id, agent, role, content });
}

function requestBrief(state: PreworkState, max = 8000) {
  return truncate(state.request, max);
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

async function prepare(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  await beginNode(run, "prepare", "آماده‌سازی: خواندن تسک، بازیابی دانش و فایل‌ها");
  const settings = await getSettings();
  const task = await loadTask(state.taskId);
  const root = task.root_id && task.root_id !== task.id ? await loadTask(task.root_id) : task;
  const parent = task.parent_id ? await loadTask(task.parent_id) : null;
  const { data: requester } = await db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>();

  const rootPath = rootFolder(root);
  if (!root.github_path) {
    await db().from("tasks").update({ github_path: rootPath }).or(`id.eq.${root.id},root_id.eq.${root.id}`);
  }
  const iterPath = iterationFolder({ ...root, github_path: rootPath }, task);

  const isRelated = !!task.parent_id;
  const lines = [
    `# تسک: ${task.title} (${task.code})`,
    `- نوع: ${task.kind === "event" ? "رویداد" : "تسک"} | اولویت: ${PRIORITY_META[task.priority].label}`,
    task.kind === "event"
      ? `- زمان رویداد: ${formatJalali(task.event_at, { withTime: true })}`
      : `- بازه‌ی زمانی: ${formatJalali(task.start_date)} تا ${formatJalali(task.end_date)}`,
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
  const request = lines.join("\n");

  // Semantic search in the knowledge base (RAG) before doing anything.
  let context = "";
  let knowledgeHits = 0;
  try {
    const q = `${task.title}\n${task.description}\n${state.prompt}`;
    const [general, profileHits] = await Promise.all([
      searchKnowledge(q, settings.pipeline.ragResults),
      searchKnowledge(q, 3, { kind: "requester_profile", requester_id: task.requester_id }),
    ]);
    const seen = new Set<string>();
    const hits = [...profileHits, ...general].filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
    knowledgeHits = hits.length;
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

  // Previous iterations of the same root task = continuation of the same Gemini chat.
  let history: PreworkState["history"] = [];
  if (isRelated) {
    const { data: msgs } = await db()
      .from("ai_messages")
      .select("agent, role, content, task_id")
      .eq("root_task_id", root.id)
      .neq("task_id", task.id)
      .in("agent", ["request", "analysis", "brief", "reply"])
      .order("id", { ascending: true });
    let budget = settings.pipeline.historyChars;
    const picked: PreworkState["history"] = [];
    for (const m of [...(msgs ?? [])].reverse()) {
      if (budget <= 0) break;
      const text = m.content.length > budget ? `${m.content.slice(0, budget)}\n…` : m.content;
      budget -= text.length;
      picked.unshift({ role: m.role as "user" | "model", text });
    }
    history = picked;
    await run.log({ source: "gemini", kind: "log", title: `ادامه‌ی گفت‌وگوی پروژه ${root.code}: ${picked.length} پیام از تکرارهای قبلی بارگذاری شد` });
  }

  const { data: files } = await db()
    .from("task_files")
    .select("*")
    .eq("task_id", task.id)
    .in("context", ["request", "prework"])
    .order("created_at");
  const fileRefs = await prepareFilesForGemini((files ?? []) as TaskFile[], run.deadline, (msg) => run.log({ source: "gemini", kind: "file", title: msg }));

  await saveMessage(run, { ...state, taskId: task.id }, "request", "user", `${request}\n\n## دستور مدیر\n${state.prompt}`);
  await finishNode(run, "prepare", "آماده‌سازی انجام شد", `${knowledgeHits} مورد دانش، ${fileRefs.length} فایل، ${history.length} پیام سابقه`);

  return {
    rootPath,
    iterPath,
    request,
    isRelated,
    context,
    knowledgeHits,
    history,
    fileRefs,
    inputs: ((files ?? []) as TaskFile[]).map((f) => ({ id: f.id, name: f.name, storage_path: f.storage_path, size: f.size })),
    inputsCursor: 0,
    inputPaths: [],
  };
}

/** Commit attachments to GitHub incrementally (resumable across ticks). */
async function inputs(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const list = state.inputs ?? [];
  let cursor = state.inputsCursor ?? 0;
  if (cursor >= list.length) return { inputsCursor: cursor };
  const batch: CommitFile[] = [];
  const paths: string[] = [];
  const workspace = await repoRef("workspace");
  while (cursor < list.length && run.timeLeft() > 20_000) {
    const f = list[cursor];
    if ((f.size ?? 0) > 20 * 1024 * 1024) {
      await run.log({ source: "github", kind: "warning", title: `فایل «${f.name}» بزرگ‌تر از ۲۰ مگابایت است؛ Claude آن را مستقیماً از Storage دریافت می‌کند` });
      cursor++;
      continue;
    }
    const blob = await downloadStorage(f.storage_path);
    const path = `${state.iterPath}/inputs/${f.name.replace(/[\\/]/g, "_")}`;
    batch.push({ path, content: new Uint8Array(await blob.arrayBuffer()) });
    paths.push(path);
    await db().from("task_files").update({ github_path: path }).eq("id", f.id);
    cursor++;
  }
  if (batch.length) {
    const c = await commitFiles(workspace, batch, `[TaskFlow] پیوست‌های ${state.iterPath.split("/")[1] ?? "task"}`);
    await run.log({ source: "github", kind: "commit", title: `${batch.length} فایل پیوست در GitHub ذخیره شد`, data: { url: c?.url } });
  }
  return { inputsCursor: cursor, inputPaths: [...(state.inputPaths ?? []), ...paths] };
}

function textFilesSize(refs: FileRef[]) {
  return refs.reduce((n, r) => n + (r.text?.length ?? 0), 0);
}

/** Agent 1: understand the request and the attachments before planning anything. */
async function analyze(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  await beginNode(run, "agent_analyze", "ایجنت ۱: تحلیل درخواست و فایل‌های پیوست");
  const refs = state.fileRefs ?? [];
  const userText = [
    state.request,
    `\n## دستور مدیر\n${state.prompt || "—"}`,
    refs.length
      ? `\n## فایل‌های پیوست (${refs.length} فایل)\n${refs.map((r) => `- ${r.name}${r.note ? ` — ${r.note}` : ""}`).join("\n")}\nمحتوای فایل‌ها در ادامه آمده است؛ آن‌ها را کامل و دقیق بررسی کن.`
      : "\n## فایل‌های پیوست\nهیچ فایلی پیوست نشده است.",
    state.context ? `\n## دانش بازیابی‌شده از پایگاه دانش (فقط موارد مرتبط را به کار ببر)\n${truncate(state.context, 20000)}` : "",
  ].join("\n");
  const res = await generate({
    agent: "analyze",
    models: settings.models.prework,
    system: await getAgentPrompt("analyze"),
    history: historyContents(state.history),
    userParts: [{ text: userText }, ...fileRefsToParts(refs)],
    thinking: settings.pipeline.thinkingLevel,
    useSearch: settings.pipeline.useGoogleSearch,
    maxOutputTokens: 32000,
    deadline: run.deadline,
    partialKey: "analyze",
    ctx: run.genContext("analyze"),
  });
  run.commitUsage();
  await saveMessage(run, state, "analysis", "model", res.text);
  await finishNode(run, "agent_analyze", "تحلیل کامل شد", `${wordCount(res.text)} کلمه — مدل ${res.model}`, { model: res.model });
  return { analysis: res.text, models: [...(state.models ?? []), res.model] };
}

/** Agent 2: the work order for Claude, a chat reply for the admin and (rarely) helper files to prepare. */
async function plan(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  await beginNode(run, "agent_plan", "ایجنت ۲: برنامه‌ریزی و نوشتن دستور کار");
  const refs = state.fileRefs ?? [];
  const repeatFiles = textFilesSize(refs) <= REPEAT_FILES_MAX_CHARS;
  const { data, model } = await generateJson<{ reply?: string; brief?: string; helper_files?: HelperSpec[] }>({
    agent: "plan",
    models: settings.models.prework,
    system: await getAgentPrompt("plan"),
    history: historyContents(state.history),
    userParts: [
      { text: `${state.request}\n\n## دستور مدیر\n${state.prompt || "—"}\n\n## تحلیل (ایجنت ۱)\n${truncate(state.analysis, 40000)}` },
      ...(repeatFiles ? fileRefsToParts(refs.filter((r) => r.text)) : []),
    ],
    jsonSchema: PLAN_SCHEMA,
    thinking: settings.pipeline.thinkingLevel,
    maxOutputTokens: 32000,
    deadline: run.deadline,
    partialKey: "plan",
    ctx: run.genContext("plan"),
  });
  run.commitUsage();
  const brief = (data.brief ?? "").trim();
  if (!brief) throw new Error("ایجنت برنامه‌ریز دستور کار تولید نکرد");
  const helperSpecs = (data.helper_files ?? [])
    .filter((h) => h?.path && h.instructions)
    .slice(0, Math.max(0, settings.pipeline.maxHelperFiles))
    .map((h, i) => ({ ...h, path: helperFileName(h.path, i) }));
  const reply = (data.reply ?? "").trim() || "دستور کار آماده شد.";
  await saveMessage(run, state, "brief", "model", brief);
  if (!helperSpecs.length) await run.setNode("helper", { status: "skipped" });
  await finishNode(run, "agent_plan", "دستور کار آماده شد", `${wordCount(brief)} کلمه${helperSpecs.length ? ` — ${helperSpecs.length} فایل کمکی` : ""}`, { model });
  return { brief, reply, helperSpecs, helperCursor: 0, helperFiles: [], models: [...(state.models ?? []), model] };
}

/** Agent 3: one small helper file per step (only those the planner asked for). */
async function helper(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  const cursor = state.helperCursor ?? 0;
  const spec = state.helperSpecs?.[cursor];
  if (!spec) return { helperCursor: cursor };
  if (cursor === 0) await beginNode(run, "agent_helper", `ایجنت ۳: آماده‌سازی ${state.helperSpecs.length} فایل کمکی`);
  const refs = (state.fileRefs ?? []).filter((r) => r.text);
  const res = await generate({
    agent: "helper",
    models: settings.models.prework,
    system: await getAgentPrompt("helper"),
    userParts: [
      {
        text: `## فایل مورد نیاز\n- نام: ${spec.path}\n- هدف: ${spec.purpose}\n- دستور ساخت: ${spec.instructions}\n\n## دستور کار پروژه\n${truncate(state.brief, 20000)}\n\n## تحلیل\n${truncate(state.analysis, 20000)}`,
      },
      ...(textFilesSize(refs) <= REPEAT_FILES_MAX_CHARS ? fileRefsToParts(refs) : []),
    ],
    thinking: "MEDIUM",
    maxOutputTokens: 32000,
    deadline: run.deadline,
    partialKey: `helper:${cursor}`,
    ctx: run.genContext("helper"),
  });
  run.commitUsage();
  const files = [...(state.helperFiles ?? []).filter((f) => f.path !== spec.path), { path: spec.path, purpose: spec.purpose, content: stripCodeFence(res.text) }];
  const done = cursor + 1;
  await run.log({ source: "gemini", kind: "file", title: `ایجاد فایل کمکی ${spec.path}`, detail: spec.purpose });
  await run.setNode("helper", { status: done >= state.helperSpecs.length ? "done" : "running", done, total: state.helperSpecs.length, model: res.model });
  if (done >= state.helperSpecs.length) await finishNode(run, "agent_helper", "فایل‌های کمکی آماده شد", `${files.length} فایل`);
  return { helperFiles: files, helperCursor: done, models: [...(state.models ?? []), res.model] };
}

async function knowledge(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  if (!settings.knowledge.autoExtract) {
    await run.setNode("knowledge", { status: "skipped" });
    return { knowledgeItems: [] };
  }
  await beginNode(run, "extract_knowledge", "استخراج دانش قابل استفاده‌ی مجدد (برای RAG و NotebookLM)");
  const task = await loadTask(state.taskId);
  try {
    const { data } = await generateJson<{ items: PreworkState["knowledgeItems"] }>({
      agent: "knowledge",
      models: settings.models.knowledge,
      system: await getAgentPrompt("knowledge"),
      userParts: [
        {
          text: `${requestBrief(state, 4000)}\n\n## دستور مدیر\n${truncate(state.prompt, 3000)}\n\n## تحلیل\n${truncate(state.analysis, 14000)}\n\n## دستور کار\n${truncate(state.brief, 10000)}`,
        },
      ],
      jsonSchema: KNOWLEDGE_SCHEMA,
      thinking: "LOW",
      deadline: run.deadline,
      partialKey: "knowledge",
      ctx: run.genContext("knowledge"),
    });
    run.commitUsage();
    const items = (data.items ?? []).filter((i) => (i.score ?? 0) >= settings.knowledge.minScore && i.content?.trim());
    const stored = await addKnowledge(
      items.map((i) => ({
        ...i,
        task_id: task.id,
        task_code: task.code,
        requester_id: i.kind === "requester_profile" ? task.requester_id : null,
        source: "prework",
      })),
    );
    await finishNode(run, "extract_knowledge", `${items.length} مورد دانش استخراج و در پایگاه دانش ذخیره شد`, `${stored} قطعه‌ی برداری`);
    return { knowledgeItems: items };
  } catch (err) {
    if (err instanceof RateLimitError || err instanceof DeadlineError) throw err;
    await run.setNode("knowledge", { status: "error", detail: errorMessage(err) });
    await run.log({ source: "knowledge", kind: "warning", title: "استخراج دانش ناموفق بود (پیش‌کار ادامه می‌یابد)", detail: errorMessage(err) });
    return { knowledgeItems: [] };
  }
}

/** Work order + appendix in one document; the only pre-work file most tasks need. */
function briefDocument(task: Task, state: PreworkState): string {
  return [
    `# دستور کار — ${task.code}: ${task.title}`,
    "",
    state.brief.trim(),
    "",
    ...(state.helperFiles?.length ? ["## فایل‌های کمکی", "", ...state.helperFiles.map((f) => `- \`files/${f.path}\` — ${f.purpose}`), ""] : []),
    "---",
    "",
    "## پیوست: تحلیل کامل درخواست و فایل‌ها",
    "",
    state.analysis.trim(),
    "",
  ].join("\n");
}

async function publish(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  await beginNode(run, "publish", "انتشار دستور کار در GitHub");
  const task = await loadTask(state.taskId);
  const root = task.root_id && task.root_id !== task.id ? await loadTask(task.root_id) : task;
  const { data: requester } = await db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>();
  const workspace = await repoRef("workspace");
  const it = state.iterPath;
  const pw = `${it}/prework`;
  const now = new Date().toISOString();

  const files: CommitFile[] = [];
  const mf: ManifestFile[] = [];
  const add = (path: string, content: string, role: string, agent: string, description: string, extra: Partial<ManifestFile> = {}) => {
    files.push({ path, content });
    mf.push({ path, role, agent, iteration: task.seq_in_root, description, updated_at: now, ...extra });
  };

  add(`${it}/request.md`, requestMarkdown(task, requester, root), "request", "تسک‌دهنده", "درخواست و مشخصات تسک");
  add(`${it}/PROMPT-prework.md`, `# پرامپت پیش‌کار\n\n${state.prompt}\n`, "prompt", "مدیر", "دستور مدیر برای پیش‌کار");
  const briefPath = `${pw}/BRIEF.md`;
  add(briefPath, briefDocument(task, state), "brief", "Gemini", "دستور کار برای Claude (همراه تحلیل کامل)", { depends_on: [`${it}/request.md`, ...(state.inputPaths ?? [])] });
  for (const f of state.helperFiles ?? []) {
    add(`${pw}/files/${f.path}`, f.content, "helper", "Gemini", f.purpose, { depends_on: [briefPath] });
  }
  for (const p of state.inputPaths ?? []) mf.push({ path: p, role: "input", agent: "تسک‌دهنده", iteration: task.seq_in_root, description: "فایل پیوست", updated_at: now });

  for (const k of state.knowledgeItems ?? []) {
    const path = `knowledge/${k.kind}/${task.code}_${slugify(k.title, 40)}.md`;
    files.push({
      path,
      content: `# ${k.title}\n\n- نوع: ${KNOWLEDGE_KINDS[k.kind] ?? k.kind}\n- منبع: تسک ${task.code} «${task.title}»\n- برچسب‌ها: ${(k.tags ?? []).join("، ")}\n- ارزش استفاده‌ی مجدد: ${k.score ?? "—"}/5\n\n${k.content}\n`,
    });
  }

  const existing = await getFileText(workspace, `${state.rootPath}/manifest.json`);
  let manifest: Manifest = existing ? JSON.parse(existing) : emptyManifest(root, requester);
  manifest = mergeManifest(manifest, mf, {
    seq: task.seq_in_root,
    code: task.code,
    title: task.title,
    relation: task.relation_type,
    folder: it,
    prework: { job_id: run.job.id, completed_at: now, models: [...new Set(state.models ?? [])], files: 1 + (state.helperFiles?.length ?? 0) },
  });
  const { data: family } = await db().from("tasks").select("*").or(`id.eq.${root.id},root_id.eq.${root.id}`);
  files.push({ path: `${state.rootPath}/manifest.json`, content: JSON.stringify(manifest, null, 2) });
  files.push({ path: `${state.rootPath}/README.md`, content: readmeMarkdown(root, manifest, (family ?? []) as Task[]) });
  const history = (await getFileText(workspace, `${state.rootPath}/HISTORY.md`)) ?? `# تاریخچه‌ی ${root.code}\n`;
  files.push({
    path: `${state.rootPath}/HISTORY.md`,
    content: `${history.trim()}\n\n## ${formatJalali(now, { withTime: true })} — پیش‌کار تکرار ${String(task.seq_in_root).padStart(2, "0")} (${task.code})\n- ${task.title}\n- دستور کار: \`${briefPath.replace(`${state.rootPath}/`, "")}\`${state.helperFiles?.length ? `، ${state.helperFiles.length} فایل کمکی` : ""}\n`,
  });
  if (!(await getFileText(workspace, `${state.rootPath}/.graphifyignore`))) {
    files.push({ path: `${state.rootPath}/.graphifyignore`, content: ".claude-session/\ngraphify-out/cache/\n*.jsonl\n" });
  }

  const commit = await commitFiles(workspace, files, `[TaskFlow] پیش‌کار ${task.code}: ${task.title}`);
  await registerOutputs(task.id, run.job.id, [
    { path: briefPath, size: Buffer.byteLength(briefDocument(task, state)), name: "دستور کار (BRIEF.md)" },
    ...(state.helperFiles ?? []).map((f) => ({ path: `${pw}/files/${f.path}`, size: Buffer.byteLength(f.content) })),
  ]);
  await saveReply(task.id, run.job.id, state.reply);
  await run.log({
    source: "github",
    kind: "commit",
    title: `دستور کار${state.helperFiles?.length ? ` و ${state.helperFiles.length} فایل کمکی` : ""} در GitHub منتشر شد`,
    detail: commit?.url ?? null,
    data: { url: commit?.url, path: state.rootPath },
  });
  await finishNode(run, "publish", "خروجی پیش‌کار منتشر شد", commit?.sha.slice(0, 7));
  return { commit };
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------
export const preworkGraph = new StateGraph(PreworkAnnotation)
  .addNode("prepare", prepare)
  .addNode("upload_inputs", inputs)
  .addNode("agent_analyze", analyze)
  .addNode("agent_plan", plan)
  .addNode("agent_helper", helper)
  .addNode("extract_knowledge", knowledge)
  .addNode("publish", publish)
  .addEdge(START, "prepare")
  .addEdge("prepare", "upload_inputs")
  .addConditionalEdges("upload_inputs", (s) => ((s.inputsCursor ?? 0) < (s.inputs ?? []).length ? "upload_inputs" : "agent_analyze"), ["upload_inputs", "agent_analyze"])
  .addEdge("agent_analyze", "agent_plan")
  .addConditionalEdges("agent_plan", (s) => ((s.helperSpecs ?? []).length ? "agent_helper" : "extract_knowledge"), ["agent_helper", "extract_knowledge"])
  .addConditionalEdges("agent_helper", (s) => ((s.helperCursor ?? 0) < (s.helperSpecs ?? []).length ? "agent_helper" : "extract_knowledge"), ["agent_helper", "extract_knowledge"])
  .addEdge("extract_knowledge", "publish")
  .addEdge("publish", END);

/**
 * Executes exactly ONE graph node per call (serverless friendly): the snapshot is restored
 * from `job_data`, the next node runs, and the new snapshot is persisted.
 */
export async function runPreworkStep(run: JobRun, initial: Partial<PreworkState>): Promise<{ done: boolean; values: PreworkState; ran: string | null }> {
  const app = preworkGraph.compile({ checkpointer: new MemorySaver(), interruptAfter: [...PREWORK_GRAPH_NODES] });
  const threadId = run.job.id;
  const config = { configurable: { thread_id: threadId }, recursionLimit: 1000 };
  RUNS.set(threadId, run);
  try {
    let saved = run.data.graph;
    if (saved?.lastNode && !(PREWORK_GRAPH_NODES as readonly string[]).includes(saved.lastNode)) {
      // Snapshot from an older version of this pipeline: start the job over with the new agents.
      saved = null;
      run.data.graph = null;
      await run.log({ source: "gemini", kind: "warning", title: "پیش‌کار با ایجنت‌های جدید از ابتدا شروع می‌شود" });
    }
    let ran: string;
    if (!saved) {
      ran = "prepare";
      await app.invoke(initial as PreworkState, config);
    } else {
      if (!saved.next.length) return { done: true, values: saved.values as PreworkState, ran: null };
      await app.updateState(config, saved.values, saved.lastNode ?? undefined);
      const pre = await app.getState(config);
      if (!pre.next.length) return { done: true, values: pre.values as PreworkState, ran: null };
      ran = pre.next[0];
      await app.invoke(null, config);
    }
    const snap = await app.getState(config);
    run.data.graph = { values: snap.values as Record<string, unknown>, lastNode: ran, next: [...snap.next] };
    await run.saveData();
    return { done: snap.next.length === 0, values: snap.values as PreworkState, ran };
  } finally {
    RUNS.delete(threadId);
  }
}
