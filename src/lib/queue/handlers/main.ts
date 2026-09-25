import "server-only";
import { db } from "@/lib/supabase/admin";
import { commitFiles, repoRef, type CommitFile } from "@/lib/github/client";
import { iterationFolder, rootFolder } from "@/lib/github/workspace";
import { formatKnowledgeContext, searchKnowledge } from "@/lib/ai/knowledge";
import { downloadStorage } from "@/lib/ai/files";
import { logEvent } from "@/lib/events";
import { dispatchExternal, watchExternal, type ExternalOptions } from "@/lib/queue/handlers/external";
import { errorMessage } from "@/lib/utils";
import { RateLimitError, DeadlineError } from "@/lib/errors";
import type { JobRun, StepResult } from "@/lib/queue/run";
import type { Task, TaskFile } from "@/lib/types";

const OPTS: ExternalOptions = { repo: "workspace", workflow: "claude-task.yml", leaseSeconds: 3 * 3600, label: "Claude" };

export async function mainHandler(run: JobRun): Promise<StepResult> {
  const step = run.job.step ?? "prepare";
  if (step === "prepare") return prepareMain(run);
  if (step === "dispatch") return dispatchExternal(run, OPTS);
  return watchExternal(run, OPTS);
}

/** Put the prompt, fresh RAG context and main-stage attachments into the workspace repo. */
async function prepareMain(run: JobRun): Promise<StepResult> {
  const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
  if (!task) return { type: "fail", error: "تسک یافت نشد" };
  const root = task.root_id && task.root_id !== task.id ? (await db().from("tasks").select("*").eq("id", task.root_id).single<Task>()).data ?? task : task;
  const rootPath = rootFolder(root);
  if (!root.github_path) await db().from("tasks").update({ github_path: rootPath }).or(`id.eq.${root.id},root_id.eq.${root.id}`);
  const iterPath = iterationFolder({ ...root, github_path: rootPath }, task);

  await db()
    .from("tasks")
    .update({ status: "main_running", progress: 60, main_started_at: task.main_started_at ?? new Date().toISOString() })
    .eq("id", task.id);
  await logEvent({ task_id: task.id, job_id: run.job.id, kind: "status", title: "وضعیت: در حال انجام کار اصلی (Claude)", visibility: "requester" });

  const files: CommitFile[] = [];
  const prompt = String(run.job.payload.prompt ?? "");
  const n = Number(run.state.round ?? 0) + 1;
  files.push({ path: `${iterPath}/PROMPT-main-${String(n).padStart(2, "0")}.md`, content: `# پرامپت کار اصلی (Claude)\n\n${prompt}\n` });

  try {
    const hits = await searchKnowledge(`${task.title}\n${task.description}\n${prompt}`, 8);
    const ctx = formatKnowledgeContext(hits, 20_000);
    files.push({
      path: `${iterPath}/CONTEXT-main.md`,
      content: `# دانش بازیابی‌شده برای کار اصلی\n\n${ctx || "_موردی یافت نشد._"}\n`,
    });
    await run.log({ source: "knowledge", kind: "search", title: `${hits.length} مورد دانش مرتبط برای Claude آماده شد` });
  } catch (err) {
    if (err instanceof RateLimitError || err instanceof DeadlineError) throw err;
    await run.log({ source: "knowledge", kind: "warning", title: "جستجوی پایگاه دانش ناموفق بود", detail: errorMessage(err) });
  }

  const { data: mainFiles } = await db().from("task_files").select("*").eq("task_id", task.id).eq("context", "main").is("github_path", null);
  for (const f of (mainFiles ?? []) as TaskFile[]) {
    if ((f.size ?? 0) > 20 * 1024 * 1024 || run.timeLeft() < 20_000) continue; // runner downloads the rest via signed URLs
    const blob = await downloadStorage(f.storage_path);
    const path = `${iterPath}/inputs/main/${f.name.replace(/[\\/]/g, "_")}`;
    files.push({ path, content: new Uint8Array(await blob.arrayBuffer()) });
    await db().from("task_files").update({ github_path: path }).eq("id", f.id);
  }

  const commit = await commitFiles(await repoRef("workspace"), files, `[TaskFlow] آماده‌سازی کار اصلی ${task.code}`);
  await run.log({ source: "github", kind: "commit", title: `پرامپت و ورودی‌های Claude در GitHub ذخیره شد (${files.length} فایل)`, data: { url: commit?.url } });
  await run.patchState({ round: n, todos: [] });
  return { type: "continue", step: "dispatch" };
}
