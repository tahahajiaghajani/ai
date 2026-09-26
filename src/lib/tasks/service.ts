import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { background, logEvent, notify, notifyAdmins } from "@/lib/events";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { CLOSABLE, PRIORITY_META, REQUESTER_EDITABLE, STATUS_META } from "@/lib/status";
import { getSettings, type ClaudeRunOptions } from "@/lib/settings";
import { gh, repoRef } from "@/lib/github/client";
import type { SessionUser } from "@/lib/auth";
import type { Priority, RelationType, Task, TaskFile, TaskStatus } from "@/lib/types";

export interface TaskInput {
  title: string;
  description: string;
  kind: "task" | "event";
  start_date?: string | null;
  end_date?: string | null;
  event_at?: string | null;
  priority: Priority;
}

export interface UploadedFile {
  storage_path: string;
  name: string;
  mime?: string | null;
  size?: number | null;
}

function cleanInput(input: TaskInput) {
  const title = input.title?.trim();
  if (!title) throw new Error("عنوان تسک الزامی است");
  if (title.length > 200) throw new Error("عنوان حداکثر ۲۰۰ کاراکتر است");
  if (!["low", "medium", "high", "critical"].includes(input.priority)) throw new Error("اولویت نامعتبر است");
  if (input.kind === "event" && !input.event_at) throw new Error("برای رویداد، تاریخ رویداد الزامی است");
  if (input.kind === "task" && input.start_date && input.end_date && input.start_date > input.end_date) {
    throw new Error("تاریخ پایان نباید قبل از تاریخ شروع باشد");
  }
  return {
    title,
    description: (input.description ?? "").trim(),
    kind: input.kind,
    priority: input.priority,
    start_date: input.kind === "task" ? input.start_date || null : null,
    end_date: input.kind === "task" ? input.end_date || null : null,
    event_at: input.kind === "event" ? input.event_at || null : null,
  };
}

export async function getTask(id: string): Promise<Task> {
  return must(await db().from("tasks").select("*").eq("id", id).single<Task>(), "خواندن تسک");
}

async function setStatus(task: Task, status: TaskStatus, patch: Partial<Task> = {}, actor?: SessionUser, note?: string) {
  const progress = patch.progress ?? STATUS_META[status].progress;
  const updated = must(
    await db()
      .from("tasks")
      .update({ status, progress: status === "closure_rejected" ? task.progress : progress, ...patch })
      .eq("id", task.id)
      .select("*")
      .single<Task>(),
    "تغییر وضعیت",
  );
  // The status is already saved; the log line can be written after the response.
  background(() => logEvent({
    task_id: task.id,
    source: actor ? "user" : "system",
    kind: "status",
    title: `وضعیت: ${STATUS_META[status].label}`,
    detail: note ?? null,
    visibility: "requester",
    actor_id: actor?.id ?? null,
    data: { from: task.status, to: status },
  }));
  return updated;
}

export async function registerFiles(user: SessionUser, taskIds: string[], context: "request" | "prework" | "main", files: UploadedFile[], jobId?: string) {
  if (!files.length) return;
  for (const f of files) {
    if (!f.storage_path.startsWith(`${user.id}/`)) throw new Error("مسیر فایل نامعتبر است");
  }
  const rows = taskIds.flatMap((task_id) =>
    files.map((f) => ({
      task_id,
      context,
      storage_path: f.storage_path,
      name: f.name.slice(0, 200),
      mime: f.mime ?? null,
      size: f.size ?? null,
      uploaded_by: user.id,
      job_id: jobId ?? null,
    })),
  );
  must(await db().from("task_files").insert(rows).select("id"), "ثبت فایل‌ها");
}

// ---------------------------------------------------------------------------
// Requester actions
// ---------------------------------------------------------------------------

export async function createTask(user: SessionUser, input: TaskInput, files: UploadedFile[] = [], parent?: { id: string; relation: RelationType }) {
  const clean = cleanInput(input);
  let parentTask: Task | null = null;
  if (parent) {
    parentTask = await getTask(parent.id);
    if (!user.isAdmin && parentTask.requester_id !== user.id) throw new Error("این تسک متعلق به شما نیست");
  }
  const task = must(
    await db()
      .from("tasks")
      .insert({
        ...clean,
        requester_id: parentTask && user.isAdmin ? parentTask.requester_id : user.id,
        parent_id: parentTask?.id ?? null,
        relation_type: parent?.relation ?? null,
      })
      .select("*")
      .single<Task>(),
    "ثبت تسک",
  );
  await registerFiles(user, [task.id], "request", files);
  await logEvent({
    task_id: task.id,
    source: "user",
    kind: "status",
    title: parentTask ? `تسک مرتبط با ${parentTask.code} ثبت شد` : "تسک ثبت و برای تایید ارسال شد",
    visibility: "requester",
    actor_id: user.id,
  });
  await notifyAdmins({
    title: parentTask ? `تسک مرتبط جدید: ${task.code}` : `تسک جدید: ${task.code}`,
    body: `${user.profile.full_name ?? user.email} — ${task.title} (اولویت ${PRIORITY_META[task.priority].label})`,
    link: `/tasks/${task.id}`,
    task_id: task.id,
  });
  return task;
}

export async function updateTaskByRequester(user: SessionUser, id: string, input: TaskInput, files: UploadedFile[] = []) {
  const task = await getTask(id);
  if (task.requester_id !== user.id && !user.isAdmin) throw new Error("دسترسی ندارید");
  if (!REQUESTER_EDITABLE.includes(task.status)) throw new Error("این تسک در وضعیت فعلی قابل ویرایش نیست");
  const clean = cleanInput(input);
  must(await db().from("tasks").update(clean).eq("id", id).select("id"), "ویرایش تسک");
  await registerFiles(user, [id], "request", files);
  await logEvent({ task_id: id, source: "user", kind: "log", title: "تسک ویرایش شد", visibility: "requester", actor_id: user.id });
}

export async function resubmitTask(user: SessionUser, id: string) {
  const task = await getTask(id);
  if (task.requester_id !== user.id) throw new Error("دسترسی ندارید");
  if (task.status !== "returned") throw new Error("فقط تسک برگشت‌خورده قابل ارسال مجدد است");
  await setStatus(task, "pending_approval", {}, user, "پس از اصلاح دوباره ارسال شد");
  await notifyAdmins({ title: `ارسال مجدد: ${task.code}`, body: task.title, link: `/tasks/${task.id}`, task_id: task.id });
}

export async function confirmClosure(user: SessionUser, id: string) {
  const task = await getTask(id);
  if (task.requester_id !== user.id) throw new Error("دسترسی ندارید");
  if (task.status !== "closure_pending") throw new Error("این تسک منتظر تایید خاتمه نیست");
  await setStatus(task, "closed", { closed_at: new Date().toISOString(), progress: 100 }, user, "خاتمه توسط تسک‌دهنده تایید شد");
  await notifyAdmins({ title: `خاتمه تایید شد: ${task.code}`, body: task.title, link: `/tasks/${task.id}`, task_id: task.id });

  // Closing a "rejection" follow-up also closes the parent whose closure had been rejected.
  if (task.parent_id && task.relation_type === "rejection") {
    const parent = await getTask(task.parent_id);
    if (parent.status === "closure_rejected") {
      await setStatus(parent, "closed", { closed_at: new Date().toISOString(), progress: 100 }, user, `با تایید خاتمه‌ی ${task.code} بسته شد`);
    }
  }
}

export async function rejectClosure(user: SessionUser, id: string, reason: string, files: UploadedFile[] = []) {
  const task = await getTask(id);
  if (task.requester_id !== user.id) throw new Error("دسترسی ندارید");
  if (task.status !== "closure_pending") throw new Error("این تسک منتظر تایید خاتمه نیست");
  if (!reason.trim()) throw new Error("لطفاً دلیل رد را بنویسید");
  await setStatus(task, "closure_rejected", { closure_reject_reason: reason.trim() }, user, reason.trim());
  // The explanation becomes a related task under the main task (not a brand-new task).
  const related = await createTask(
    user,
    {
      title: `رد خاتمه: ${task.title}`.slice(0, 200),
      description: reason.trim(),
      kind: "task",
      priority: task.priority,
      start_date: null,
      end_date: task.end_date,
    },
    files,
    { id: task.id, relation: "rejection" },
  );
  return related;
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export async function approveTask(admin: SessionUser, id: string, note?: string) {
  const task = await getTask(id);
  if (!["pending_approval", "returned"].includes(task.status)) throw new Error("این تسک در انتظار تایید نیست");
  await setStatus(task, "approved", { approved_at: new Date().toISOString(), return_reason: null, admin_note: note || task.admin_note }, admin, note);
  await notify(task.requester_id, { title: `تسک ${task.code} تایید شد`, body: "تسک شما در صف انجام قرار گرفت.", link: `/portal/tasks/${task.id}`, task_id: task.id });
}

export async function returnTask(admin: SessionUser, id: string, reason: string) {
  const task = await getTask(id);
  if (!["pending_approval", "approved"].includes(task.status)) throw new Error("این تسک قابل برگشت نیست");
  if (!reason.trim()) throw new Error("توضیح برگشت الزامی است");
  await setStatus(task, "returned", { return_reason: reason.trim() }, admin, reason.trim());
  await notify(task.requester_id, {
    title: `تسک ${task.code} برگشت خورد`,
    body: reason.trim(),
    link: `/portal/tasks/${task.id}`,
    task_id: task.id,
  });
}

const LOCKED: TaskStatus[] = ["closed", "cancelled"];
const RUNNING: TaskStatus[] = ["prework_running", "main_running"];

/** Admin edit of the request itself (title/description), e.g. right before sending it to pre-work or Claude. */
export async function updateTaskDetails(admin: SessionUser, id: string, input: { title: string; description: string }) {
  const task = await getTask(id);
  if (LOCKED.includes(task.status)) throw new Error("تسک بسته یا لغو شده قابل ویرایش نیست");
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) throw new Error("عنوان تسک الزامی است");
  if (title.length > 200) throw new Error("عنوان حداکثر ۲۰۰ کاراکتر است");
  if (description.length > 20000) throw new Error("شرح تسک حداکثر ۲۰٬۰۰۰ کاراکتر است");
  if (title === task.title && description === task.description) return;
  must(await db().from("tasks").update({ title, description }).eq("id", id).select("id").single(), "ویرایش تسک");
  const changed = [title !== task.title ? "عنوان" : null, description !== task.description ? "شرح" : null].filter(Boolean).join(" و ");
  await logEvent({
    task_id: id,
    source: "user",
    kind: "log",
    title: `مدیر ${changed} تسک را ویرایش کرد`,
    detail: title !== task.title ? `عنوان قبلی: ${task.title}` : null,
    visibility: "requester",
    actor_id: admin.id,
  });
}

/** Admin adds attachments to the task itself (they travel with the request to pre-work and Claude). */
export async function addTaskFiles(admin: SessionUser, id: string, files: UploadedFile[]) {
  const task = await getTask(id);
  if (LOCKED.includes(task.status)) throw new Error("به تسک بسته یا لغو شده نمی‌توان فایل افزود");
  if (!files.length) return;
  await registerFiles(admin, [id], "request", files);
  await logEvent({
    task_id: id,
    source: "user",
    kind: "file",
    title: `مدیر ${files.length} فایل به تسک افزود`,
    detail: files.map((f) => f.name).join("، "),
    visibility: "requester",
    actor_id: admin.id,
  });
}

/** Removes an attachment (row + stored object when no other task still references it). */
export async function deleteTaskFile(admin: SessionUser, fileId: string) {
  const { data: file } = await db().from("task_files").select("*").eq("id", fileId).maybeSingle<TaskFile>();
  if (!file?.task_id) throw new Error("فایل پیدا نشد");
  const task = await getTask(file.task_id);
  if (LOCKED.includes(task.status)) throw new Error("فایل‌های تسک بسته یا لغو شده قابل حذف نیستند");
  if (RUNNING.includes(task.status)) throw new Error("تسک در حال اجراست؛ پس از پایان اجرا فایل را حذف کنید");
  if (file.context === "output") throw new Error("خروجی‌های نهایی از اینجا حذف نمی‌شوند");
  must(await db().from("task_files").delete().eq("id", file.id).select("id"), "حذف فایل");
  const { count } = await db().from("task_files").select("id", { count: "exact", head: true }).eq("storage_path", file.storage_path);
  if (!count) await db().storage.from("task-files").remove([file.storage_path]);
  await logEvent({
    task_id: task.id,
    source: "user",
    kind: "file",
    title: `مدیر فایل «${file.name}» را حذف کرد`,
    detail: file.github_path ? `نسخه‌ی قبلاً منتشرشده در GitHub باقی می‌ماند: ${file.github_path}` : null,
    visibility: "requester",
    actor_id: admin.id,
  });
}

export async function sendToPrework(
  admin: SessionUser,
  ids: string[],
  prompt: string,
  files: UploadedFile[] = [],
  origin?: string,
  opts: { resumeFromJobId?: string; workflowId?: string | null } = {},
) {
  const settings = await getSettings();
  const finalPrompt = prompt.trim() || settings.prework.defaultPrompt;
  const tasks = await Promise.all(ids.map(getTask));
  for (const task of tasks) {
    if (!["approved", "prework_done", "main_done", "closure_rejected"].includes(task.status)) {
      throw new Error(`تسک ${task.code} در وضعیت «${STATUS_META[task.status].label}» قابل ارسال به پیش‌کار نیست`);
    }
  }
  for (const task of tasks) {
    const id = task.id;
    const job = await enqueueJob({
      kind: "prework",
      task_id: id,
      // user_prompt = what the admin typed (empty = default prompt), shown in the conversation
      payload: { prompt: finalPrompt, user_prompt: prompt.trim(), resumed_from: opts.resumeFromJobId ?? null, workflow_id: opts.workflowId || null },
      priority: PRIORITY_META[task.priority].weight,
      created_by: admin.id,
    });
    await registerFiles(admin, [id], "prework", files, job.id);
    if (opts.resumeFromJobId) await copyCheckpoint(opts.resumeFromJobId, job.id);
    await setStatus(task, "prework_queued", {}, admin, opts.resumeFromJobId ? "ادامه‌ی پیش‌کار از آخرین مرحله‌ی موفق" : "در صف پیش‌کار Gemini قرار گرفت");
  }
  await kickWorker(origin);
}

/** Retrying a failed pre-work continues from its last saved workflow state (finished steps are not repeated). */
async function copyCheckpoint(fromJobId: string, toJobId: string) {
  const [{ data: data }, { data: old }] = await Promise.all([
    db().from("job_data").select("graph, partial").eq("job_id", fromJobId).maybeSingle(),
    db().from("jobs").select("state").eq("id", fromJobId).maybeSingle(),
  ]);
  if (data?.graph && Object.keys(data.graph).length) {
    await db().from("job_data").upsert({ job_id: toJobId, graph: data.graph, partial: data.partial ?? null });
  }
  if (old?.state) {
    const { nodes, counts, usage, flow } = old.state as Record<string, unknown>;
    await db().from("jobs").update({ state: { nodes, counts, usage, flow } }).eq("id", toJobId);
  }
}

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

/** Only the per-send Claude choices that differ from "use the Settings default". */
/** Per-send Claude choices; a key that is present (even "") overrides the Settings default. */
export function pickClaudeOptions(o: Partial<ClaudeRunOptions> | null | undefined): Partial<ClaudeRunOptions> | null {
  const out: Partial<ClaudeRunOptions> = {};
  if (!o || typeof o !== "object") return null;
  if (typeof o.model === "string" && /^[\w.:\[\]-]{0,80}$/.test(o.model.trim())) out.model = o.model.trim();
  if (typeof o.effort === "string" && EFFORTS.includes(o.effort)) out.effort = o.effort;
  if (typeof o.thinking === "string" && ["auto", "on", "off"].includes(o.thinking)) out.thinking = o.thinking;
  return Object.keys(out).length ? out : null;
}

export async function sendToMain(
  admin: SessionUser,
  ids: string[],
  prompt: string,
  files: UploadedFile[] = [],
  origin?: string,
  claude: Partial<ClaudeRunOptions> = {},
  workflowId?: string | null,
) {
  const settings = await getSettings();
  const finalPrompt = prompt.trim() || settings.claude.defaultPrompt;
  const tasks = await Promise.all(ids.map(getTask));
  for (const task of tasks) {
    if (!["prework_done", "main_done", "closure_rejected", "approved"].includes(task.status)) {
      throw new Error(`تسک ${task.code} در وضعیت «${STATUS_META[task.status].label}» قابل ارسال به Claude نیست`);
    }
  }
  const run = pickClaudeOptions(claude);
  for (const task of tasks) {
    const id = task.id;
    const job = await enqueueJob({
      kind: "main",
      task_id: id,
      payload: { prompt: finalPrompt, user_prompt: prompt.trim(), followup: task.status === "main_done", workflow_id: workflowId || null, ...(run ? { claude: run } : {}) },
      priority: PRIORITY_META[task.priority].weight,
      created_by: admin.id,
    });
    await registerFiles(admin, [id], "main", files, job.id);
    await setStatus(task, "main_queued", {}, admin, "در صف انجام کار اصلی (Claude) قرار گرفت");
  }
  await kickWorker(origin);
}

export async function requestClosure(admin: SessionUser, id: string, note: string) {
  const task = await getTask(id);
  if (!CLOSABLE.includes(task.status)) throw new Error("این تسک در وضعیت فعلی قابل خاتمه نیست");
  await cancelActiveJobs(task.id, "مدیر تسک را خاتمه داد");
  await setStatus(task, "closure_pending", { closure_note: note.trim() || null }, admin, note.trim() || "مدیر کار را خاتمه‌یافته اعلام کرد");
  await notify(task.requester_id, {
    title: `تسک ${task.code} انجام شد`,
    body: "لطفاً خاتمه‌ی تسک را تایید یا با توضیحات رد کنید.",
    link: `/portal/tasks/${task.id}`,
    task_id: task.id,
  });
}

export async function cancelTask(admin: SessionUser, id: string, reason: string) {
  const task = await getTask(id);
  await cancelActiveJobs(task.id, "تسک لغو شد");
  await setStatus(task, "cancelled", {}, admin, reason || "لغو توسط مدیر");
  await notify(task.requester_id, { title: `تسک ${task.code} لغو شد`, body: reason || undefined, link: `/portal/tasks/${task.id}`, task_id: task.id });
}

/** Manual override: move a task to any status (e.g. back to a previous stage). */
export async function forceStatus(admin: SessionUser, id: string, status: TaskStatus, note?: string) {
  const task = await getTask(id);
  if (task.status === status) return;
  if (["prework_queued", "prework_running", "main_queued", "main_running"].includes(status)) {
    throw new Error("برای شروع اجرا از دکمه‌های ارسال به پیش‌کار/کار اصلی استفاده کنید");
  }
  await cancelActiveJobs(task.id, "تغییر دستی وضعیت");
  await setStatus(task, status, {}, admin, note || "تغییر دستی وضعیت توسط مدیر");
}

export async function cancelActiveJobs(taskId: string, reason: string) {
  const { data: jobs } = await db().from("jobs").select("*").eq("task_id", taskId).in("status", ["queued", "running"]);
  for (const j of jobs ?? []) {
    await db()
      .from("jobs")
      .update({ status: "cancelled", error: reason, finished_at: new Date().toISOString(), locked_by: null, locked_until: null })
      .eq("id", j.id);
    if (j.external_id && j.kind !== "prework") {
      try {
        const ref = await repoRef(j.kind === "upgrade" ? "app" : "workspace");
        await gh().rest.actions.cancelWorkflowRun({ ...ref, run_id: Number(j.external_id) });
      } catch {
        /* run may already be finished */
      }
    }
  }
}

export async function setProviderPause(provider: "gemini" | "claude", paused: boolean) {
  await db()
    .from("provider_state")
    .update({ manual_pause: paused, ...(paused ? {} : { paused_until: null, pause_reason: null }), updated_at: new Date().toISOString() })
    .eq("provider", provider);
}
