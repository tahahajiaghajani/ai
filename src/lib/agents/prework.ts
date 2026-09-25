import "server-only";
import { StateGraph, Annotation, START, END, MemorySaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { Content } from "@google/genai";
import { db } from "@/lib/supabase/admin";
import { generate, generateJson } from "@/lib/ai/gemini";
import { getAgentPrompt, KNOWLEDGE_SCHEMA, WBS_DETAIL_SCHEMA, WBS_OUTLINE_SCHEMA } from "@/lib/ai/prompts";
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
import { itemBrief, parseExecOutput, pickExecutionItems, renderWbsMarkdown, splitByItemHeadings, type ExecFile, type WbsItem, type WbsPhase } from "@/lib/agents/parse";
import { PRIORITY_META, RELATION_META } from "@/lib/status";
import { formatJalali } from "@/lib/jalali";
import { errorMessage, slugify, truncate, wordCount } from "@/lib/utils";
import type { JobRun } from "@/lib/queue/run";
import type { Profile, Task, TaskFile } from "@/lib/types";

// ---------------------------------------------------------------------------
// State (every channel is "last value" so the snapshot can round-trip through the DB)
// ---------------------------------------------------------------------------
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
  research: Annotation<string>(),
  wbsSummary: Annotation<string>(),
  phases: Annotation<WbsPhase[]>(),
  phaseCursor: Annotation<number>(),
  items: Annotation<WbsItem[]>(),
  methods: Annotation<Record<string, string>>(),
  methodsCursor: Annotation<number>(),
  execIds: Annotation<string[]>(),
  execCursor: Annotation<number>(),
  execFiles: Annotation<ExecFile[]>(),
  execReports: Annotation<Record<string, string>>(),
  report: Annotation<string>(),
  knowledgeItems: Annotation<{ kind: string; title: string; content: string; tags?: string[]; score?: number }[]>(),
  commit: Annotation<{ sha: string; url: string } | null>(),
  models: Annotation<string[]>(),
});

export type PreworkState = typeof PreworkAnnotation.State;

export const PREWORK_GRAPH_NODES = ["prepare", "upload_inputs", "agent_research", "wbs_outline", "wbs_detail", "agent_methods", "agent_execute", "agent_report", "extract_knowledge", "publish"] as const;

/** Graph node → mini-workflow display node */
export const DISPLAY_NODE: Record<string, string> = {
  prepare: "prepare",
  upload_inputs: "prepare",
  agent_research: "research",
  wbs_outline: "wbs",
  wbs_detail: "wbs",
  agent_methods: "methods",
  agent_execute: "execute",
  agent_report: "report",
  extract_knowledge: "knowledge",
  publish: "publish",
};

const NODE_PROGRESS: Record<string, number> = {
  prepare: 22,
  research: 28,
  wbs: 34,
  methods: 40,
  execute: 45,
  report: 47,
  knowledge: 48,
  publish: 50,
};

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
      .in("agent", ["request", "research", "wbs", "report"])
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

async function research(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  await beginNode(run, "agent_research", "ایجنت ۱: تحقیق درباره‌ی نحوه‌ی انجام تسک");
  const userText = [
    state.request,
    state.context ? `\n## دانش بازیابی‌شده از پایگاه دانش (اول از این‌ها استفاده کن)\n${state.context}` : "",
    `\n## دستور مدیر\n${state.prompt}`,
    "\nاین تسک باید انجام شود؛ درباره‌ی آن تحقیق کن و بگو چگونه می‌توان آن را به بهترین شکل انجام داد.",
  ].join("\n");
  const res = await generate({
    agent: "research",
    models: settings.models.research,
    system: await getAgentPrompt("research"),
    history: historyContents(state.history),
    userParts: [{ text: userText }, ...fileRefsToParts(state.fileRefs ?? [])],
    thinking: settings.pipeline.thinkingLevel,
    useSearch: settings.pipeline.useGoogleSearch,
    deadline: run.deadline,
    partialKey: "research",
    ctx: run.genContext("research"),
  });
  run.commitUsage();
  await saveMessage(run, state, "research", "model", res.text);
  await finishNode(run, "agent_research", "تحقیق کامل شد", `${wordCount(res.text)} کلمه — مدل ${res.model}`, { model: res.model });
  return { research: res.text, models: [...(state.models ?? []), res.model] };
}

async function wbsOutline(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  await beginNode(run, "wbs_outline", "ایجنت ۲: ساخت WBS — تعیین فازهای اصلی");
  const { data, model } = await generateJson<{ summary?: string; phases: WbsPhase[] }>({
    agent: "wbs_outline",
    models: settings.models.structure,
    system: await getAgentPrompt("wbs_outline"),
    history: historyContents(state.history),
    userParts: [{ text: `${requestBrief(state)}\n\n## دستور مدیر\n${state.prompt}\n\n## نتیجه‌ی تحقیق (ایجنت ۱)\n${truncate(state.research, 30000)}` }],
    jsonSchema: WBS_OUTLINE_SCHEMA,
    thinking: "LOW",
    deadline: run.deadline,
    partialKey: "wbs_outline",
    ctx: run.genContext("wbs"),
  });
  run.commitUsage();
  const phases = (data.phases ?? []).map((p, i) => ({ ...p, id: String(p.id ?? i + 1).replace(/\.$/, "") }));
  if (!phases.length) throw new Error("ایجنت WBS هیچ فازی تولید نکرد");
  await run.setNode("wbs", { status: "running", done: 0, total: phases.length, model });
  await run.log({ source: "gemini", kind: "log", title: `${phases.length} فاز اصلی تعیین شد`, detail: phases.map((p) => `${p.id}. ${p.title}`).join("\n") });
  return { phases, wbsSummary: data.summary ?? "", phaseCursor: 0, items: [], models: [...(state.models ?? []), model] };
}

async function wbsDetail(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  const cursor = state.phaseCursor ?? 0;
  const phase = state.phases[cursor];
  run.live({ node: "wbs", thought: `شکستن فاز ${phase.id}: ${phase.title}` });
  const { data } = await generateJson<{ items: Omit<WbsItem, "phase">[] }>({
    agent: "wbs_detail",
    models: settings.models.structure,
    system: await getAgentPrompt("wbs_detail"),
    userParts: [
      {
        text: `${requestBrief(state, 5000)}\n\n## خلاصه‌ی تحقیق\n${truncate(state.research, 18000)}\n\n## همه‌ی فازها\n${state.phases
          .map((p) => `${p.id}. ${p.title} — ${p.goal}`)
          .join("\n")}\n\n## فاز مورد نظر برای شکستن\nفاز ${phase.id}: ${phase.title}\nهدف: ${phase.goal}${phase.deliverable ? `\nخروجی: ${phase.deliverable}` : ""}\n\nشناسه‌ی فعالیت‌ها با «${phase.id}.» شروع شود.`,
      },
    ],
    jsonSchema: WBS_DETAIL_SCHEMA,
    thinking: "LOW",
    deadline: run.deadline,
    partialKey: `wbs_detail:${cursor}`,
    ctx: run.genContext("wbs"),
  });
  run.commitUsage();
  const newItems: WbsItem[] = (data.items ?? []).map((it, i) => {
    const id = String(it.id ?? "").startsWith(`${phase.id}.`) ? String(it.id) : `${phase.id}.${i + 1}`;
    const complexity = (["simple", "medium", "complex"].includes(it.complexity) ? it.complexity : "medium") as WbsItem["complexity"];
    return { ...it, id, complexity, phase: phase.id, depends_on: it.depends_on ?? [] };
  });
  const items = [...(state.items ?? []).filter((i) => i.phase !== phase.id), ...newItems];
  const done = cursor + 1;
  await run.setNode("wbs", { status: done >= state.phases.length ? "done" : "running", done, total: state.phases.length });
  await run.log({ source: "gemini", kind: "log", title: `فاز ${phase.id} «${phase.title}» به ${newItems.length} فعالیت شکسته شد` });

  if (done >= state.phases.length) {
    const md = renderWbsMarkdown(state.wbsSummary, state.phases, items);
    await saveMessage(run, state, "wbs", "model", md);
    await saveMessage(run, state, "wbs_json", "model", JSON.stringify({ phases: state.phases, items }));
    await finishNode(run, "wbs_detail", "WBS کامل شد", `${state.phases.length} فاز، ${items.length} فعالیت`, { done, total: state.phases.length });
    await run.patchState({ counts: { ...(run.state.counts ?? {}), phases: state.phases.length, items: items.length } });
  }
  return { items, phaseCursor: done, methods: state.methods ?? {}, methodsCursor: state.methodsCursor ?? 0 };
}

async function methods(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  const cursor = state.methodsCursor ?? 0;
  if (cursor === 0) await beginNode(run, "agent_methods", "ایجنت ۳: تحقیق و نوشتن روش انجام هر زیرفعالیت");
  const batch = state.items.slice(cursor, cursor + settings.pipeline.methodsBatch);
  if (!batch.length) {
    await run.setNode("methods", { status: "skipped" });
    return { methods: state.methods ?? {}, methodsCursor: state.items.length, execIds: [], execCursor: 0, execFiles: [], execReports: {} };
  }
  const res = await generate({
    agent: "methods",
    models: settings.models.methods,
    system: await getAgentPrompt("methods"),
    userParts: [
      {
        text: `${requestBrief(state, 4000)}\n\n## خلاصه‌ی راهکار (از تحقیق)\n${truncate(state.research, 12000)}\n\n## فهرست کل فعالیت‌ها (برای کانتکست)\n${state.items
          .map((i) => `${i.id} ${i.title}`)
          .join("\n")}\n\n## فعالیت‌هایی که باید روش انجامشان را بنویسی\n${batch.map(itemBrief).join("\n\n")}`,
      },
    ],
    thinking: settings.pipeline.thinkingLevel === "HIGH" ? "MEDIUM" : settings.pipeline.thinkingLevel,
    deadline: run.deadline,
    partialKey: `methods:${cursor}`,
    ctx: run.genContext("methods"),
  });
  run.commitUsage();
  const split = splitByItemHeadings(res.text);
  const merged = { ...(state.methods ?? {}) };
  for (const it of batch) merged[it.id] = split[it.id] ?? (batch.length === 1 ? res.text : merged[it.id] ?? "");
  if (batch.length > 1 && !Object.keys(split).length) merged[batch[0].id] = res.text;
  const done = Math.min(cursor + batch.length, state.items.length);
  await run.setNode("methods", { status: done >= state.items.length ? "done" : "running", done, total: state.items.length, model: res.model });
  await run.log({ source: "gemini", kind: "log", title: `روش انجام ${batch.map((b) => b.id).join("، ")} نوشته شد`, data: { model: res.model } });
  if (done >= state.items.length) {
    await finishNode(run, "agent_methods", "روش انجام همه‌ی زیرفعالیت‌ها نوشته شد", `${state.items.length} فعالیت`, { done, total: state.items.length });
  }
  return {
    methods: merged,
    methodsCursor: done,
    execIds: state.execIds ?? [],
    execCursor: state.execCursor ?? 0,
    execFiles: state.execFiles ?? [],
    execReports: state.execReports ?? {},
  };
}

async function execute(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  let execIds = state.execIds ?? [];
  if (!execIds.length) {
    execIds = pickExecutionItems(state.items, settings.pipeline.maxExecuteItems).map((i) => i.id);
    await beginNode(run, "agent_execute", `ایجنت ۴: انجام کارهای ساده و آماده‌سازی کارهای پیچیده (${execIds.length} فعالیت)`);
  }
  const cursor = state.execCursor ?? 0;
  if (cursor >= execIds.length) return { execIds, execCursor: cursor };
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const batch = execIds.slice(cursor, cursor + settings.pipeline.executeBatch).map((id) => byId.get(id)!).filter(Boolean);

  const res = await generate({
    agent: "execute",
    models: settings.models.execute,
    system: await getAgentPrompt("execute"),
    userParts: [
      {
        text: `${requestBrief(state, 4000)}\n\n## خلاصه‌ی راهکار\n${truncate(state.research, 8000)}\n${
          state.context ? `\n## دانش قابل استفاده‌ی مجدد\n${truncate(state.context, 6000)}\n` : ""
        }\n## فعالیت‌هایی که باید انجام/آماده‌سازی کنی\n${batch
          .map((it) => `${itemBrief(it)}\n\n#### روش انجام\n${truncate(state.methods?.[it.id] ?? "", 5000)}`)
          .join("\n\n---\n\n")}`,
      },
      ...fileRefsToParts((state.fileRefs ?? []).filter((f) => f.text)).slice(0, 6),
    ],
    thinking: settings.pipeline.thinkingLevel,
    maxOutputTokens: 60000,
    deadline: run.deadline,
    partialKey: `execute:${cursor}`,
    ctx: run.genContext("execute"),
  });
  run.commitUsage();

  const parsed = parseExecOutput(res.text);
  const files = parsed.files.map((f) => {
    if (f.wbs_id || batch.length !== 1) return f;
    return { ...f, path: `${batch[0].id}/${f.path}`, wbs_id: batch[0].id };
  });
  const reports = { ...(state.execReports ?? {}) };
  const sections = parsed.report.split(/^###\s*گزارش\s*\[([^\]]+)\][^\n]*$/m);
  if (sections.length > 1) {
    for (let i = 1; i < sections.length; i += 2) reports[sections[i].trim()] = sections[i + 1]?.trim() ?? "";
  } else {
    reports[batch[0].id] = parsed.report;
  }
  const done = Math.min(cursor + batch.length, execIds.length);
  const allFiles = [...(state.execFiles ?? []).filter((f) => !files.some((n) => n.path === f.path)), ...files];
  await run.setNode("execute", { status: done >= execIds.length ? "done" : "running", done, total: execIds.length, model: res.model });
  for (const f of files) {
    await run.log({ source: "gemini", kind: "file", title: `ایجاد فایل ${f.path}`, detail: f.desc || null });
  }
  await run.log({ source: "gemini", kind: "log", title: `فعالیت‌های ${batch.map((b) => b.id).join("، ")} انجام/آماده شد (${files.length} فایل)` });
  if (done >= execIds.length) {
    await finishNode(run, "agent_execute", "کارهای ساده انجام و کارهای پیچیده آماده شد", `${allFiles.length} فایل تولید شد`, { done, total: execIds.length });
    await run.patchState({ counts: { ...(run.state.counts ?? {}), files: allFiles.length } });
  }
  return { execIds, execCursor: done, execFiles: allFiles, execReports: reports };
}

async function report(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  const settings = await getSettings();
  await beginNode(run, "agent_report", "تهیه‌ی گزارش پیش‌کار برای Claude");
  const wbsMd = renderWbsMarkdown(state.wbsSummary, state.phases, state.items);
  const res = await generate({
    agent: "report",
    models: settings.models.report,
    system: await getAgentPrompt("report"),
    userParts: [
      {
        text: `${requestBrief(state, 5000)}\n\n## دستور مدیر\n${state.prompt}\n\n## تحقیق\n${truncate(state.research, 15000)}\n\n${truncate(wbsMd, 15000)}\n\n## گزارش اجرای فعالیت‌ها\n${Object.entries(
          state.execReports ?? {},
        )
          .map(([id, r]) => `### ${id}\n${truncate(r, 1500)}`)
          .join("\n\n")}\n\n## فایل‌های تولیدشده در پیش‌کار\n${(state.execFiles ?? [])
          .map((f) => `- prework/04-execution/${f.path} — ${f.desc}`)
          .join("\n")}\n\n## فعالیت‌هایی که اجرا/آماده نشدند\n${state.items
          .filter((i) => !(state.execIds ?? []).includes(i.id))
          .map((i) => `- ${i.id} ${i.title}`)
          .join("\n") || "—"}`,
      },
    ],
    thinking: "LOW",
    deadline: run.deadline,
    partialKey: "report",
    ctx: run.genContext("report"),
  });
  run.commitUsage();
  await saveMessage(run, state, "report", "model", res.text);
  await finishNode(run, "agent_report", "گزارش پیش‌کار آماده شد", `${wordCount(res.text)} کلمه`);
  return { report: res.text, knowledgeItems: state.knowledgeItems ?? [] };
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
          text: `${requestBrief(state, 4000)}\n\n## تحقیق\n${truncate(state.research, 12000)}\n\n## گزارش پیش‌کار\n${truncate(state.report, 10000)}\n\n## نمونه‌ی فایل‌های تولیدشده\n${(state.execFiles ?? [])
            .slice(0, 12)
            .map((f) => `### ${f.path}\n${truncate(f.content, 1500)}`)
            .join("\n\n")}`,
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

async function publish(state: PreworkState, config: LangGraphRunnableConfig): Promise<Partial<PreworkState>> {
  const run = runOf(config);
  await beginNode(run, "publish", "انتشار خروجی‌ها در GitHub با دیتا مپینگ دقیق");
  const task = await loadTask(state.taskId);
  const root = task.root_id && task.root_id !== task.id ? await loadTask(task.root_id) : task;
  const { data: requester } = await db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>();
  const workspace = await repoRef("workspace");
  const it = state.iterPath;
  const pw = `${it}/prework`;
  const agentName = "Gemini (پیش‌کار)";
  const now = new Date().toISOString();

  const files: CommitFile[] = [];
  const mf: ManifestFile[] = [];
  const add = (path: string, content: string, role: string, agent: string, description: string, extra: Partial<ManifestFile> = {}) => {
    files.push({ path, content });
    mf.push({ path, role, agent, iteration: task.seq_in_root, description, updated_at: now, ...extra });
  };

  add(`${it}/request.md`, requestMarkdown(task, requester, root), "request", "تسک‌دهنده", "درخواست و مشخصات تسک");
  add(`${it}/PROMPT-prework.md`, `# پرامپت پیش‌کار\n\n${state.prompt}\n`, "prompt", "مدیر", "دستور مدیر برای پیش‌کار");
  if (state.context) add(`${pw}/00-context.md`, `# دانش بازیابی‌شده (RAG)\n\n${state.context}\n`, "context", "RAG", "دانش مرتبط بازیابی‌شده از پایگاه دانش");
  add(`${pw}/01-research.md`, `# تحقیق و راهکار\n\n${state.research}\n`, "research", "ایجنت ۱", "تحقیق درباره‌ی نحوه‌ی انجام تسک", { depends_on: [`${it}/request.md`] });
  add(`${pw}/02-wbs.md`, renderWbsMarkdown(state.wbsSummary, state.phases, state.items), "wbs", "ایجنت ۲", "ساختار شکست کار", { depends_on: [`${pw}/01-research.md`] });
  add(`${pw}/02-wbs.json`, JSON.stringify({ summary: state.wbsSummary, phases: state.phases, items: state.items }, null, 2), "wbs", "ایجنت ۲", "WBS ماشینی", {
    depends_on: [`${pw}/01-research.md`],
  });
  const methodsMd = ["# روش انجام زیرفعالیت‌ها", "", ...state.items.map((i) => state.methods?.[i.id] || `### [${i.id}] ${i.title}\n\n—`)].join("\n\n");
  add(`${pw}/03-methods.md`, methodsMd, "methods", "ایجنت ۳", "روش انجام هر زیرفعالیت", { depends_on: [`${pw}/02-wbs.md`] });
  for (const f of state.execFiles ?? []) {
    add(`${pw}/04-execution/${f.path}`, f.content, "execution", "ایجنت ۴", f.desc || "خروجی اجرای پیش‌کار", {
      wbs_id: f.wbs_id,
      depends_on: [`${pw}/03-methods.md`],
    });
  }
  const logMd = ["# گزارش اجرای فعالیت‌ها", "", ...Object.entries(state.execReports ?? {}).map(([id, r]) => `## [${id}]\n\n${r}`)].join("\n\n");
  add(`${pw}/04-execution-log.md`, logMd, "execution-log", "ایجنت ۴", "گزارش اجرای کارهای ساده/آماده‌سازی", { depends_on: [`${pw}/03-methods.md`] });
  add(`${pw}/05-report.md`, `# گزارش پیش‌کار\n\n${state.report}\n`, "report", "گزارش", "خلاصه و برنامه‌ی پیشنهادی برای Claude", {
    depends_on: [`${pw}/01-research.md`, `${pw}/02-wbs.md`, `${pw}/04-execution-log.md`],
  });
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
    prework: { job_id: run.job.id, completed_at: now, models: [...new Set(state.models ?? [])], files: mf.length },
  });
  const { data: family } = await db().from("tasks").select("*").or(`id.eq.${root.id},root_id.eq.${root.id}`);
  files.push({ path: `${state.rootPath}/manifest.json`, content: JSON.stringify(manifest, null, 2) });
  files.push({ path: `${state.rootPath}/README.md`, content: readmeMarkdown(root, manifest, (family ?? []) as Task[]) });
  const history = (await getFileText(workspace, `${state.rootPath}/HISTORY.md`)) ?? `# تاریخچه‌ی ${root.code}\n`;
  files.push({
    path: `${state.rootPath}/HISTORY.md`,
    content: `${history.trim()}\n\n## ${formatJalali(now, { withTime: true })} — پیش‌کار تکرار ${String(task.seq_in_root).padStart(2, "0")} (${task.code})\n- ${task.title}\n- فعالیت‌ها: ${state.items.length}، فایل‌های تولیدی: ${(state.execFiles ?? []).length}\n- پوشه: \`${it.replace(`${state.rootPath}/`, "")}\`\n`,
  });
  if (!(await getFileText(workspace, `${state.rootPath}/.graphifyignore`))) {
    files.push({ path: `${state.rootPath}/.graphifyignore`, content: ".claude-session/\ngraphify-out/cache/\n*.jsonl\n" });
  }

  const commit = await commitFiles(workspace, files, `[TaskFlow] پیش‌کار ${task.code}: ${task.title}`);
  await run.log({
    source: "github",
    kind: "commit",
    title: `${files.length} فایل در GitHub منتشر شد`,
    detail: commit?.url ?? null,
    data: { url: commit?.url, path: state.rootPath },
  });
  await finishNode(run, "publish", "خروجی‌ها در GitHub منتشر شد", commit?.sha.slice(0, 7));
  return { commit };
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------
export const preworkGraph = new StateGraph(PreworkAnnotation)
  .addNode("prepare", prepare)
  .addNode("upload_inputs", inputs)
  .addNode("agent_research", research)
  .addNode("wbs_outline", wbsOutline)
  .addNode("wbs_detail", wbsDetail)
  .addNode("agent_methods", methods)
  .addNode("agent_execute", execute)
  .addNode("agent_report", report)
  .addNode("extract_knowledge", knowledge)
  .addNode("publish", publish)
  .addEdge(START, "prepare")
  .addEdge("prepare", "upload_inputs")
  .addConditionalEdges("upload_inputs", (s) => ((s.inputsCursor ?? 0) < (s.inputs ?? []).length ? "upload_inputs" : "agent_research"), ["upload_inputs", "agent_research"])
  .addEdge("agent_research", "wbs_outline")
  .addEdge("wbs_outline", "wbs_detail")
  .addConditionalEdges("wbs_detail", (s) => ((s.phaseCursor ?? 0) < (s.phases ?? []).length ? "wbs_detail" : "agent_methods"), ["wbs_detail", "agent_methods"])
  .addConditionalEdges("agent_methods", (s) => ((s.methodsCursor ?? 0) < (s.items ?? []).length ? "agent_methods" : "agent_execute"), ["agent_methods", "agent_execute"])
  .addConditionalEdges(
    "agent_execute",
    (s) => ((s.execIds ?? []).length && (s.execCursor ?? 0) < (s.execIds ?? []).length ? "agent_execute" : "agent_report"),
    ["agent_execute", "agent_report"],
  )
  .addEdge("agent_report", "extract_knowledge")
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
    const saved = run.data.graph;
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
