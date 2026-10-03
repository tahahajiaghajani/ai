"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { assertActive, assertFull } from "@/lib/auth";
import * as svc from "@/lib/tasks/service";
import { db } from "@/lib/supabase/admin";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { deleteTaskFamily } from "@/lib/tasks/delete";
import { act, mutate } from "./_util";
import type { RelationType, TaskStatus, Task } from "@/lib/types";
import type { ClaudeRunOptions, MainEngine } from "@/lib/settings";
import { defaultBranch, getFileText, repoUrl, userRepoOrNull } from "@/lib/github/client";
import { setManualPause, clearModelBlocks } from "@/lib/connections";
import { recordsFolder } from "@/lib/workflow/engine";
import { capabilities } from "@/lib/capabilities";
import { mentionedProject } from "@/lib/projects/paths";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : undefined;
}

function cleanId(id: unknown): string | null {
  return typeof id === "string" && /^[\w-]{1,60}$/.test(id) ? id : null;
}

// ------------------------------------------------------------------ giving tasks
export async function createTaskAction(input: svc.TaskInput, files: svc.UploadedFile[], opts: { assigneeId?: string | null; parent?: { id: string; relation: RelationType } } = {}) {
  return act(async () => {
    const user = await assertActive();
    const task = await svc.createTask(user, input, files, { assigneeId: cleanId(opts.assigneeId), parent: opts.parent });
    revalidatePath("/portal");
    return { id: task.id, code: task.code, self: task.assignee_id === user.id };
  });
}

export async function updateTaskAction(id: string, input: svc.TaskInput, files: svc.UploadedFile[], assigneeId?: string | null) {
  return act(async () => {
    const user = await assertActive();
    await svc.updateTaskByRequester(user, id, input, files, cleanId(assigneeId));
    revalidatePath(`/portal/tasks/${id}`);
    return null;
  });
}

export async function resubmitTaskAction(id: string) {
  return mutate(async () => svc.resubmitTask(await assertActive(), id).then(() => null));
}

export async function confirmClosureAction(id: string) {
  return mutate(async () => svc.confirmClosure(await assertActive(), id).then(() => null));
}

export async function rejectClosureAction(id: string, reason: string, files: svc.UploadedFile[] = []) {
  return mutate(async () => {
    const related = await svc.rejectClosure(await assertActive(), id, reason, files);
    return { id: related.id, code: related.code };
  });
}

export async function reassignTaskAction(id: string, assigneeId: string) {
  return mutate(async () => svc.reassignTask(await assertActive(), id, String(cleanId(assigneeId))).then(() => null));
}

// ------------------------------------------------------------------ doing tasks
export async function approveTasksAction(ids: string[], note?: string) {
  return mutate(async () => {
    const user = await assertActive();
    for (const id of ids) await svc.approveTask(user, id, note);
    return null;
  });
}

export async function returnTaskAction(id: string, reason: string) {
  return mutate(async () => svc.returnTask(await assertActive(), id, reason).then(() => null));
}

export async function startTaskAction(id: string, note?: string) {
  return mutate(async () => svc.startTask(await assertActive(), id, note).then(() => null));
}

export interface DispatchInput {
  workflowId?: string | null;
  projectId?: string | null;
  newProject?: { name: string; description?: string } | null;
  files?: string[];
}

function cleanDispatch(d: DispatchInput = {}): svc.DispatchOptions {
  return {
    workflowId: cleanId(d.workflowId),
    projectId: cleanId(d.projectId),
    newProject: d.newProject?.name?.trim() ? { name: d.newProject.name.trim().slice(0, 120), description: d.newProject.description?.slice(0, 5000) } : null,
    files: Array.isArray(d.files) ? d.files.filter((f) => typeof f === "string").slice(0, 40) : [],
  };
}

export async function sendToPreworkAction(ids: string[], prompt: string, files: svc.UploadedFile[], dispatch: DispatchInput = {}) {
  return mutate(async () => svc.sendToPrework(await assertFull(), ids, prompt, files, await origin(), cleanDispatch(dispatch)).then(() => null));
}

export async function sendToMainAction(ids: string[], prompt: string, files: svc.UploadedFile[], claude: Partial<ClaudeRunOptions> = {}, dispatch: DispatchInput & { engine?: MainEngine | null } = {}) {
  return mutate(async () =>
    svc
      .sendToMain(await assertFull(), ids, prompt, files, await origin(), claude, { ...cleanDispatch(dispatch), engine: dispatch.engine === "agent" || dispatch.engine === "claude_code" ? dispatch.engine : null })
      .then(() => null),
  );
}

/**
 * One prompt from anywhere (also from the phone): it becomes a task for yourself and goes straight
 * to the main work (or pre-work). The project and the files the prompt names are found by
 * themselves («در پروژه renew فایل audit.cs باگ دارد»), or can be picked by hand.
 */
export async function quickCommandAction(input: { prompt: string; projectId?: string | null; selected?: string[]; files?: svc.UploadedFile[]; stage?: "main" | "prework" }) {
  return act(async () => {
    const user = await assertFull();
    const prompt = String(input.prompt ?? "").trim().slice(0, 20000);
    if (!prompt) throw new Error("دستور را بنویسید");
    const stage = input.stage === "prework" ? "prework" : "main";
    const caps = await capabilities(user);
    if (stage === "prework" ? !caps.prework : !caps.main) throw new Error("برای این مرحله هنوز اتصال هوش مصنوعی آماده نیست (تنظیمات ← مدل هر مرحله)");
    let projectId = cleanId(input.projectId);
    let detected: string | null = null;
    if (!projectId) {
      const { data } = await db().from("projects").select("id, slug, name").eq("owner_id", user.id);
      const hit = mentionedProject(prompt, (data ?? []) as { id: string; slug: string; name: string }[]);
      if (hit) {
        projectId = hit.id;
        detected = hit.name;
      }
    }
    const title = prompt.split("\n").find((l) => l.trim())!.replace(/\s+/g, " ").trim().slice(0, 120);
    const task = await svc.createTask(user, { title, description: "", kind: "task", priority: "medium" }, [], { assigneeId: user.id });
    const dispatch: svc.DispatchOptions = { projectId, files: Array.isArray(input.selected) ? input.selected.filter((f) => typeof f === "string").slice(0, 40) : [] };
    try {
      if (stage === "prework") await svc.sendToPrework(user, [task.id], prompt, input.files ?? [], await origin(), dispatch);
      else await svc.sendToMain(user, [task.id], prompt, input.files ?? [], await origin(), {}, dispatch);
    } catch (err) {
      await db().from("tasks").delete().eq("id", task.id);
      throw err;
    }
    return { id: task.id, code: task.code, project: detected };
  });
}

export async function updateTaskDetailsAction(id: string, title: string, description: string) {
  return mutate(async () => svc.updateTaskDetails(await assertActive(), id, { title, description }).then(() => null));
}

export async function addTaskFilesAction(id: string, files: svc.UploadedFile[]) {
  return act(async () => svc.addTaskFiles(await assertActive(), id, files).then(() => null));
}

export async function deleteTaskFileAction(fileId: string) {
  return act(async () => svc.deleteTaskFile(await assertActive(), fileId).then(() => null));
}

export async function requestClosureAction(id: string, note: string) {
  return mutate(async () => svc.requestClosure(await assertActive(), id, note).then(() => null));
}

export async function cancelTaskAction(id: string, reason: string) {
  return mutate(async () => svc.cancelTask(await assertActive(), id, reason).then(() => null));
}

export async function forceStatusAction(id: string, status: TaskStatus, note?: string) {
  return mutate(async () => svc.forceStatus(await assertActive(), id, status, note).then(() => null));
}

export async function saveAdminNoteAction(id: string, note: string) {
  return act(async () => {
    const user = await assertActive();
    const task = await svc.getTask(id);
    if (task.assignee_id !== user.id && !user.isOwner) throw new Error("دسترسی ندارید");
    await db().from("tasks").update({ admin_note: note }).eq("id", id);
    return null;
  });
}

export async function feedbackAction(input: { task_id: string; job_id?: string | null; agent: string; rating: -1 | 0 | 1; comment?: string }) {
  return act(async () => {
    const user = await assertFull();
    const task = await svc.getTask(input.task_id);
    if (task.assignee_id !== user.id) throw new Error("دسترسی ندارید");
    await db().from("feedback").insert({ ...input, job_id: input.job_id ?? null, comment: input.comment ?? null, created_by: user.id });
    return null;
  });
}

// ------------------------------------------------------------------ queue (each user manages their own jobs)
async function ownJob(jobId: string) {
  const user = await assertFull();
  const { data: job } = await db().from("jobs").select("*").eq("id", jobId).single();
  if (!job || (job.owner_id !== user.id && !user.isOwner)) throw new Error("کار یافت نشد");
  return { user, job };
}

export async function cancelJobAction(jobId: string) {
  return mutate(async () => {
    const { job } = await ownJob(jobId);
    if (job.task_id) {
      await svc.cancelActiveJobs(job.task_id, "لغو دستی از صف");
      const { data: task } = await db().from("tasks").select("status").eq("id", job.task_id).single();
      const back: Record<string, TaskStatus> = { prework_queued: "approved", prework_running: "approved", main_queued: "prework_done", main_running: "prework_done" };
      if (task && back[task.status] && ["prework", "main"].includes(job.kind)) await db().from("tasks").update({ status: back[task.status] }).eq("id", job.task_id);
    } else {
      await db().from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), locked_by: null, locked_until: null }).eq("id", jobId);
    }
    return null;
  });
}

export async function retryJobAction(jobId: string) {
  return mutate(async () => {
    const { user, job } = await ownJob(jobId);
    if (!["failed", "cancelled"].includes(job.status)) throw new Error("فقط کارهای ناموفق/لغوشده قابل تکرارند");
    const dispatch = { workflowId: job.payload?.workflow_id ?? null, projectId: job.project_id ?? null, files: job.payload?.files_selected ?? [] };
    if (job.task_id && job.kind === "prework") {
      const { data: task } = await db().from("tasks").select("status").eq("id", job.task_id).single();
      if (task && task.status !== "approved") await db().from("tasks").update({ status: "approved" }).eq("id", job.task_id);
      await svc.sendToPrework(user, [job.task_id], String(job.payload?.prompt ?? ""), [], await origin(), { ...dispatch, resumeFromJobId: job.id });
    } else if (job.task_id && job.kind === "main") {
      const { data: task } = await db().from("tasks").select("status").eq("id", job.task_id).single();
      if (task && !["prework_done", "main_done", "approved", "in_progress", "closure_rejected"].includes(task.status)) await db().from("tasks").update({ status: "prework_done" }).eq("id", job.task_id);
      await svc.sendToMain(user, [job.task_id], String(job.payload?.prompt ?? ""), [], await origin(), (job.payload?.claude as Partial<ClaudeRunOptions>) ?? {}, { ...dispatch, engine: job.payload?.engine ?? null });
    } else {
      await enqueueJob({ kind: job.kind, owner_id: job.owner_id, lane: job.lane, connection_id: job.connection_id, task_id: job.task_id, upgrade_id: job.upgrade_id, project_id: job.project_id, payload: job.payload, priority: job.priority, created_by: user.id });
      if (job.upgrade_id) await db().from("upgrades").update({ status: "queued" }).eq("id", job.upgrade_id);
      await kickWorker(await origin());
    }
    return null;
  });
}

export async function bumpJobAction(jobId: string) {
  return mutate(async () => {
    const { job } = await ownJob(jobId);
    const { data } = await db().from("jobs").select("priority").eq("owner_id", job.owner_id).order("priority", { ascending: false }).limit(1).single();
    await db().from("jobs").update({ priority: (data?.priority ?? 50) + 1 }).eq("id", jobId);
    return null;
  });
}

/** Pause or resume one of the user's AI connections (their queued jobs wait meanwhile). */
export async function connectionPauseAction(connectionId: string, paused: boolean) {
  return mutate(async () => {
    const user = await assertFull();
    const { data } = await db().from("user_connections").select("user_id").eq("id", connectionId).maybeSingle();
    if (data?.user_id !== user.id) throw new Error("اتصال پیدا نشد");
    await setManualPause(connectionId, paused);
    if (!paused) await kickWorker(await origin());
    return null;
  });
}

export async function clearModelBlocksAction(connectionId: string) {
  return mutate(async () => {
    const user = await assertFull();
    const { data } = await db().from("user_connections").select("user_id").eq("id", connectionId).maybeSingle();
    if (data?.user_id !== user.id) throw new Error("اتصال پیدا نشد");
    await clearModelBlocks(connectionId);
    await kickWorker(await origin());
    return null;
  });
}

export async function kickWorkerAction() {
  return act(async () => {
    await assertActive();
    await kickWorker(await origin());
    return null;
  });
}

export async function markNotificationsReadAction() {
  return act(async () => {
    const user = await assertActive();
    await db().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
    return null;
  });
}

export interface RunManifest {
  runs: { n: number; stage: "prework" | "main"; job_id: string; at: string; folder: string; workflow: string; models: string[]; outputs: string[]; changed?: string[] }[];
}

/** GitHub records folder and run map (manifest.json) of a task; loaded lazily by the task page. */
export async function taskRepoInfoAction(taskId: string) {
  return act(async () => {
    const user = await assertActive();
    const task = await svc.getTask(taskId);
    if (!svc.canSee(user, task)) throw new Error("دسترسی ندارید");
    const repo = await userRepoOrNull(task.assignee_id);
    if (!repo) return { manifest: null, github: null };
    const root = task.root_id && task.root_id !== task.id ? await svc.getTask(task.root_id) : task;
    const { data: project } = task.project_id ? await db().from("projects").select("slug, root_path").eq("id", task.project_id).maybeSingle<{ slug: string; root_path: string }>() : { data: null };
    const folder = recordsFolder(root as Pick<Task, "code" | "title">, project);
    const [branch, text] = await Promise.all([defaultBranch(repo), getFileText(repo, `${folder}/manifest.json`).catch(() => null)]);
    let manifest: RunManifest | null = null;
    try {
      manifest = text ? (JSON.parse(text) as RunManifest) : null;
    } catch {
      manifest = null;
    }
    return {
      manifest,
      github: { folder: repoUrl(repo, folder, branch), repo: repoUrl(repo), project: project ? repoUrl(repo, project.root_path, branch) : null, blob: `${repoUrl(repo)}/blob/${branch}/` },
    };
  });
}

/** Deletes a whole task (root task, related tasks, files and their GitHub record folders). */
export async function deleteTaskAction(taskId: string, confirmCode: string) {
  return act(async () => {
    const user = await assertActive();
    const task = await svc.getTask(taskId);
    const root = task.root_id && task.root_id !== task.id ? await svc.getTask(task.root_id) : task;
    if (confirmCode.trim() !== root.code) throw new Error("برای تایید، کد تسک را دقیقاً وارد کنید");
    return deleteTaskFamily(user, taskId);
  });
}
