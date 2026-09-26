"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { assertActive, assertAdmin } from "@/lib/auth";
import * as svc from "@/lib/tasks/service";
import { db } from "@/lib/supabase/admin";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { deleteProject } from "@/lib/tasks/delete";
import { act, mutate } from "./_util";
import type { RelationType, TaskStatus } from "@/lib/types";
import type { ClaudeRunOptions } from "@/lib/settings";
import { defaultBranch, getFileText, repoRef, repoUrl } from "@/lib/github/client";
import { env } from "@/lib/env";
import type { Manifest } from "@/lib/github/workspace";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : undefined;
}

// ------------------------------------------------------------------ requester
export async function createTaskAction(input: svc.TaskInput, files: svc.UploadedFile[], parent?: { id: string; relation: RelationType }) {
  return act(async () => {
    const user = await assertActive();
    const task = await svc.createTask(user, input, files, parent);
    revalidatePath("/portal");
    return { id: task.id, code: task.code };
  });
}

export async function updateTaskAction(id: string, input: svc.TaskInput, files: svc.UploadedFile[]) {
  return act(async () => {
    const user = await assertActive();
    await svc.updateTaskByRequester(user, id, input, files);
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

// ------------------------------------------------------------------ admin
export async function approveTasksAction(ids: string[], note?: string) {
  return mutate(async () => {
    const admin = await assertAdmin();
    for (const id of ids) await svc.approveTask(admin, id, note);
    return null;
  });
}

export async function returnTaskAction(id: string, reason: string) {
  return mutate(async () => svc.returnTask(await assertAdmin(), id, reason).then(() => null));
}

export async function sendToPreworkAction(ids: string[], prompt: string, files: svc.UploadedFile[], workflowId?: string | null) {
  return mutate(async () => svc.sendToPrework(await assertAdmin(), ids, prompt, files, await origin(), { workflowId: cleanId(workflowId) }).then(() => null));
}

export async function sendToMainAction(ids: string[], prompt: string, files: svc.UploadedFile[], claude: Partial<ClaudeRunOptions> = {}, workflowId?: string | null) {
  return mutate(async () => svc.sendToMain(await assertAdmin(), ids, prompt, files, await origin(), claude, cleanId(workflowId)).then(() => null));
}

function cleanId(id: unknown): string | null {
  return typeof id === "string" && /^[\w-]{1,60}$/.test(id) ? id : null;
}

export async function updateTaskDetailsAction(id: string, title: string, description: string) {
  return mutate(async () => svc.updateTaskDetails(await assertAdmin(), id, { title, description }).then(() => null));
}

export async function addTaskFilesAction(id: string, files: svc.UploadedFile[]) {
  return act(async () => svc.addTaskFiles(await assertAdmin(), id, files).then(() => null));
}

export async function deleteTaskFileAction(fileId: string) {
  return act(async () => svc.deleteTaskFile(await assertAdmin(), fileId).then(() => null));
}

export async function requestClosureAction(id: string, note: string) {
  return mutate(async () => svc.requestClosure(await assertAdmin(), id, note).then(() => null));
}

export async function cancelTaskAction(id: string, reason: string) {
  return mutate(async () => svc.cancelTask(await assertAdmin(), id, reason).then(() => null));
}

export async function forceStatusAction(id: string, status: TaskStatus, note?: string) {
  return mutate(async () => svc.forceStatus(await assertAdmin(), id, status, note).then(() => null));
}

export async function saveAdminNoteAction(id: string, note: string) {
  return act(async () => {
    await assertAdmin();
    await db().from("tasks").update({ admin_note: note }).eq("id", id);
    return null;
  });
}

export async function feedbackAction(input: { task_id: string; job_id?: string | null; agent: string; rating: -1 | 0 | 1; comment?: string }) {
  return act(async () => {
    const admin = await assertAdmin();
    await db().from("feedback").insert({ ...input, job_id: input.job_id ?? null, comment: input.comment ?? null, created_by: admin.id });
    return null;
  });
}

// ------------------------------------------------------------------ queue
export async function cancelJobAction(jobId: string) {
  return mutate(async () => {
    await assertAdmin();
    const { data: job } = await db().from("jobs").select("*").eq("id", jobId).single();
    if (!job) throw new Error("کار یافت نشد");
    if (job.task_id) {
      await svc.cancelActiveJobs(job.task_id, "لغو دستی از صف");
      const { data: task } = await db().from("tasks").select("status").eq("id", job.task_id).single();
      const back: Record<string, TaskStatus> = { prework_queued: "approved", prework_running: "approved", main_queued: "prework_done", main_running: "prework_done" };
      if (task && back[task.status] && ["prework", "main"].includes(job.kind)) {
        await db().from("tasks").update({ status: back[task.status] }).eq("id", job.task_id);
      }
    } else {
      await db().from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), locked_by: null, locked_until: null }).eq("id", jobId);
    }
    return null;
  });
}

export async function retryJobAction(jobId: string) {
  return mutate(async () => {
    const admin = await assertAdmin();
    const { data: job } = await db().from("jobs").select("*").eq("id", jobId).single();
    if (!job) throw new Error("کار یافت نشد");
    if (!["failed", "cancelled"].includes(job.status)) throw new Error("فقط کارهای ناموفق/لغوشده قابل تکرارند");
    if (job.task_id && job.kind === "prework") {
      const { data: task } = await db().from("tasks").select("status").eq("id", job.task_id).single();
      if (task && task.status !== "approved") await db().from("tasks").update({ status: "approved" }).eq("id", job.task_id);
      await svc.sendToPrework(admin, [job.task_id], String(job.payload?.prompt ?? ""), [], await origin(), { resumeFromJobId: job.id });
    } else if (job.task_id && job.kind === "main") {
      await svc.sendToMain(admin, [job.task_id], String(job.payload?.prompt ?? ""), [], await origin());
    } else {
      await enqueueJob({ kind: job.kind, task_id: job.task_id, upgrade_id: job.upgrade_id, payload: job.payload, priority: job.priority, created_by: admin.id });
      if (job.upgrade_id) await db().from("upgrades").update({ status: "queued" }).eq("id", job.upgrade_id);
      await kickWorker(await origin());
    }
    return null;
  });
}

export async function bumpJobAction(jobId: string) {
  return mutate(async () => {
    await assertAdmin();
    const { data } = await db().from("jobs").select("priority").order("priority", { ascending: false }).limit(1).single();
    await db().from("jobs").update({ priority: (data?.priority ?? 50) + 1 }).eq("id", jobId);
    return null;
  });
}

export async function providerPauseAction(provider: "gemini" | "claude", paused: boolean) {
  return mutate(async () => {
    await assertAdmin();
    await svc.setProviderPause(provider, paused);
    if (!paused) await kickWorker(await origin());
    return null;
  });
}

export async function clearModelBlocksAction() {
  return mutate(async () => {
    await assertAdmin();
    await db().from("provider_state").update({ models: {}, paused_until: null, pause_reason: null }).eq("provider", "gemini");
    await kickWorker(await origin());
    return null;
  });
}

export async function kickWorkerAction() {
  return act(async () => {
    await assertAdmin();
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

/** GitHub folder link and data map (manifest.json) of a task; loaded lazily by the task page. */
export async function taskRepoInfoAction(taskId: string) {
  return act(async () => {
    await assertAdmin();
    const { data: task } = await db().from("tasks").select("github_path").eq("id", taskId).maybeSingle<{ github_path: string | null }>();
    if (!task?.github_path || !env.githubToken) return { manifest: null, github: null };
    const ref = await repoRef("workspace");
    const [branch, text] = await Promise.all([defaultBranch(ref), getFileText(ref, `${task.github_path}/manifest.json`).catch(() => null)]);
    let manifest: Manifest | null = null;
    try {
      manifest = text ? (JSON.parse(text) as Manifest) : null;
    } catch {
      manifest = null;
    }
    return { manifest, github: { folder: repoUrl(ref, task.github_path, branch), repo: repoUrl(ref) } };
  });
}

/** Deletes the whole project of a task (root task, related tasks, files, knowledge, GitHub folder). */
export async function deleteProjectAction(taskId: string, confirmCode: string) {
  return act(async () => {
    await assertAdmin();
    const { data: task } = await db().from("tasks").select("code, root_id").eq("id", taskId).maybeSingle<{ code: string; root_id: string | null }>();
    if (!task) throw new Error("تسک یافت نشد");
    const { data: root } = task.root_id ? await db().from("tasks").select("code").eq("id", task.root_id).maybeSingle<{ code: string }>() : { data: { code: task.code } };
    if (confirmCode.trim() !== root?.code) throw new Error("برای تایید، کد پروژه را دقیقاً وارد کنید");
    return deleteProject(taskId);
  });
}
