import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { background, logEvent, notify } from "@/lib/events";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { CLOSABLE, PRIORITY_META, REQUESTER_EDITABLE, STATUS_META } from "@/lib/status";
import { getUserConfig, stageModel, type ClaudeRunOptions, type MainEngine } from "@/lib/settings";
import { cancelRun, userRepoOrNull } from "@/lib/github/client";
import { githubInfo, type GithubConfig } from "@/lib/connections";
import { createProject, getProject } from "@/lib/projects/store";
import { safeProjectPath } from "@/lib/projects/paths";
import { agentMap, resolveWorkflow } from "@/lib/workflow/registry";
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
  if (input.kind === "task" && input.start_date && input.end_date && input.start_date > input.end_date) throw new Error("تاریخ پایان نباید قبل از تاریخ شروع باشد");
  return {
    title,
    description: (input.description ?? "").trim().slice(0, 20000),
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

// ---------------------------------------------------------------------------
// who may do what
// ---------------------------------------------------------------------------
export function canSee(user: SessionUser, task: Pick<Task, "requester_id" | "assignee_id">) {
  return user.isOwner || task.requester_id === user.id || task.assignee_id === user.id;
}

/** The assignee does the work (the app owner may step in). */
function assertAssignee(user: SessionUser, task: Task) {
  if (task.assignee_id !== user.id && !user.isOwner) throw new Error("فقط مسئول انجام این تسک می‌تواند این کار را بکند");
}

function assertRequester(user: SessionUser, task: Task) {
  if (task.requester_id !== user.id && !user.isOwner) throw new Error("فقط تسک‌دهنده می‌تواند این کار را بکند");
}

async function activePerson(id: string) {
  const { data } = await db().from("profiles").select("id, full_name, status").eq("id", id).maybeSingle<{ id: string; full_name: string | null; status: string }>();
  if (!data || data.status !== "active") throw new Error("مسئول انتخاب‌شده کاربر فعال اپ نیست");
  return data;
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
  background(() =>
    logEvent({
      task_id: task.id,
      source: actor ? "user" : "system",
      kind: "status",
      title: `وضعیت: ${STATUS_META[status].label}`,
      detail: note ?? null,
      visibility: "requester",
      actor_id: actor?.id ?? null,
      data: { from: task.status, to: status },
    }),
  );
  return updated;
}

export async function registerFiles(user: SessionUser, taskIds: string[], context: "request" | "prework" | "main", files: UploadedFile[], jobId?: string) {
  if (!files.length) return;
  for (const f of files) if (!f.storage_path.startsWith(`${user.id}/`)) throw new Error("مسیر فایل نامعتبر است");
  const rows = taskIds.flatMap((task_id) =>
    files.map((f) => ({ task_id, context, storage_path: f.storage_path, name: f.name.slice(0, 200), mime: f.mime ?? null, size: f.size ?? null, uploaded_by: user.id, job_id: jobId ?? null })),
  );
  must(await db().from("task_files").insert(rows).select("id"), "ثبت فایل‌ها");
}

// ---------------------------------------------------------------------------
// giving tasks
// ---------------------------------------------------------------------------
export async function createTask(
  user: SessionUser,
  input: TaskInput,
  files: UploadedFile[] = [],
  opts: { assigneeId?: string | null; parent?: { id: string; relation: RelationType } } = {},
) {
  const clean = cleanInput(input);
  let parentTask: Task | null = null;
  if (opts.parent) {
    parentTask = await getTask(opts.parent.id);
    if (!canSee(user, parentTask)) throw new Error("به این تسک دسترسی ندارید");
  }
  const assigneeId = opts.assigneeId || parentTask?.assignee_id || user.id;
  const assignee = await activePerson(assigneeId);
  const self = assigneeId === user.id;
  const task = must(
    await db()
      .from("tasks")
      .insert({
        ...clean,
        requester_id: parentTask && user.id === parentTask.assignee_id ? parentTask.requester_id : user.id,
        assignee_id: assigneeId,
        parent_id: parentTask?.id ?? null,
        relation_type: opts.parent?.relation ?? null,
        // a task you give yourself needs no approval
        ...(self ? { status: "approved", approved_at: new Date().toISOString(), progress: STATUS_META.approved.progress } : {}),
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
    title: parentTask ? `تسک مرتبط با ${parentTask.code} ثبت شد` : self ? "تسک ثبت شد" : `تسک برای ${assignee.full_name ?? "مسئول"} ارسال شد`,
    visibility: "requester",
    actor_id: user.id,
  });
  if (!self) {
    await notify(assigneeId, {
      title: parentTask ? `تسک مرتبط جدید: ${task.code}` : `تسک جدید برای شما: ${task.code}`,
      body: `${user.profile.full_name ?? user.email} — ${task.title} (اولویت ${PRIORITY_META[task.priority].label})`,
      link: `/t/${task.id}`,
      task_id: task.id,
    });
  }
  return task;
}

export async function updateTaskByRequester(user: SessionUser, id: string, input: TaskInput, files: UploadedFile[] = [], assigneeId?: string | null) {
  const task = await getTask(id);
  assertRequester(user, task);
  if (!REQUESTER_EDITABLE.includes(task.status)) throw new Error("این تسک در وضعیت فعلی قابل ویرایش نیست");
  const clean = cleanInput(input);
  const patch: Record<string, unknown> = { ...clean };
  if (assigneeId && assigneeId !== task.assignee_id) {
    await activePerson(assigneeId);
    patch.assignee_id = assigneeId;
  }
  must(await db().from("tasks").update(patch).eq("id", id).select("id"), "ویرایش تسک");
  await registerFiles(user, [id], "request", files);
  await logEvent({ task_id: id, source: "user", kind: "log", title: "تسک ویرایش شد", visibility: "requester", actor_id: user.id });
  if (patch.assignee_id) await notify(assigneeId!, { title: `تسک ${task.code} به شما سپرده شد`, body: task.title, link: `/t/${task.id}`, task_id: task.id });
}

export async function resubmitTask(user: SessionUser, id: string) {
  const task = await getTask(id);
  assertRequester(user, task);
  if (task.status !== "returned") throw new Error("فقط تسک برگشت‌خورده قابل ارسال مجدد است");
  await setStatus(task, "pending_approval", {}, user, "پس از اصلاح دوباره ارسال شد");
  await notify(task.assignee_id, { title: `ارسال مجدد: ${task.code}`, body: task.title, link: `/t/${task.id}`, task_id: task.id });
}

export async function confirmClosure(user: SessionUser, id: string) {
  const task = await getTask(id);
  assertRequester(user, task);
  if (task.status !== "closure_pending") throw new Error("این تسک منتظر تایید خاتمه نیست");
  await setStatus(task, "closed", { closed_at: new Date().toISOString(), progress: 100 }, user, "خاتمه توسط تسک‌دهنده تایید شد");
  await notify(task.assignee_id, { title: `خاتمه تایید شد: ${task.code}`, body: task.title, link: `/t/${task.id}`, task_id: task.id });
  // closing a "rejection" follow-up also closes the parent whose closure had been rejected
  if (task.parent_id && task.relation_type === "rejection") {
    const parent = await getTask(task.parent_id);
    if (parent.status === "closure_rejected") await setStatus(parent, "closed", { closed_at: new Date().toISOString(), progress: 100 }, user, `با تایید خاتمه‌ی ${task.code} بسته شد`);
  }
}

export async function rejectClosure(user: SessionUser, id: string, reason: string, files: UploadedFile[] = []) {
  const task = await getTask(id);
  assertRequester(user, task);
  if (task.status !== "closure_pending") throw new Error("این تسک منتظر تایید خاتمه نیست");
  if (!reason.trim()) throw new Error("لطفاً دلیل رد را بنویسید");
  await setStatus(task, "closure_rejected", { closure_reject_reason: reason.trim() }, user, reason.trim());
  // the explanation becomes a related task under the main task (not a brand-new task)
  return createTask(
    user,
    { title: `رد خاتمه: ${task.title}`.slice(0, 200), description: reason.trim(), kind: "task", priority: task.priority, start_date: null, end_date: task.end_date },
    files,
    { assigneeId: task.assignee_id, parent: { id: task.id, relation: "rejection" } },
  );
}

// ---------------------------------------------------------------------------
// doing tasks (assignee)
// ---------------------------------------------------------------------------
export async function approveTask(user: SessionUser, id: string, note?: string) {
  const task = await getTask(id);
  assertAssignee(user, task);
  if (!["pending_approval", "returned"].includes(task.status)) throw new Error("این تسک منتظر پذیرش نیست");
  await setStatus(task, "approved", { approved_at: new Date().toISOString(), return_reason: null, admin_note: note || task.admin_note }, user, note);
  if (task.requester_id !== user.id) await notify(task.requester_id, { title: `تسک ${task.code} پذیرفته شد`, body: "تسک شما در صف انجام قرار گرفت.", link: `/t/${task.id}`, task_id: task.id });
}

export async function returnTask(user: SessionUser, id: string, reason: string) {
  const task = await getTask(id);
  assertAssignee(user, task);
  if (!["pending_approval", "approved", "in_progress"].includes(task.status)) throw new Error("این تسک قابل برگشت نیست");
  if (!reason.trim()) throw new Error("توضیح برگشت الزامی است");
  await setStatus(task, "returned", { return_reason: reason.trim() }, user, reason.trim());
  await notify(task.requester_id, { title: `تسک ${task.code} برگشت خورد`, body: reason.trim(), link: `/t/${task.id}`, task_id: task.id });
}

/** Simple mode: the assignee marks the task as being worked on. */
export async function startTask(user: SessionUser, id: string, note?: string) {
  const task = await getTask(id);
  assertAssignee(user, task);
  if (!["approved", "pending_approval", "closure_rejected"].includes(task.status)) throw new Error("این تسک در وضعیت فعلی قابل شروع نیست");
  await setStatus(task, "in_progress", task.approved_at ? {} : { approved_at: new Date().toISOString() }, user, note || "مسئول کار را شروع کرد");
  if (task.requester_id !== user.id) await notify(task.requester_id, { title: `کار روی ${task.code} شروع شد`, body: note || task.title, link: `/t/${task.id}`, task_id: task.id });
}

/** Done: the giver confirms the closure (a task you gave yourself closes right away). */
export async function requestClosure(user: SessionUser, id: string, note: string) {
  const task = await getTask(id);
  assertAssignee(user, task);
  if (!CLOSABLE.includes(task.status)) throw new Error("این تسک در وضعیت فعلی قابل خاتمه نیست");
  await cancelActiveJobs(task.id, "مسئول تسک را خاتمه داد");
  if (task.requester_id === task.assignee_id) {
    await setStatus(task, "closed", { closed_at: new Date().toISOString(), progress: 100, closure_note: note.trim() || null }, user, note.trim() || "خاتمه یافت");
    return;
  }
  await setStatus(task, "closure_pending", { closure_note: note.trim() || null }, user, note.trim() || "مسئول کار را انجام‌شده اعلام کرد");
  await notify(task.requester_id, { title: `تسک ${task.code} انجام شد`, body: note.trim() || "لطفاً خاتمه‌ی تسک را تایید یا با توضیحات رد کنید.", link: `/t/${task.id}`, task_id: task.id });
}

export async function cancelTask(user: SessionUser, id: string, reason: string) {
  const task = await getTask(id);
  if (!canSee(user, task)) throw new Error("دسترسی ندارید");
  if (["closed", "cancelled"].includes(task.status)) throw new Error("این تسک قبلاً بسته شده است");
  await cancelActiveJobs(task.id, "تسک لغو شد");
  await setStatus(task, "cancelled", {}, user, reason || "لغو شد");
  const other = user.id === task.requester_id ? task.assignee_id : task.requester_id;
  if (other !== user.id) await notify(other, { title: `تسک ${task.code} لغو شد`, body: reason || undefined, link: `/t/${task.id}`, task_id: task.id });
}

/** Manual override: move a task to any status (e.g. back to a previous stage). */
export async function forceStatus(user: SessionUser, id: string, status: TaskStatus, note?: string) {
  const task = await getTask(id);
  assertAssignee(user, task);
  if (task.status === status) return;
  if (["prework_queued", "prework_running", "main_queued", "main_running"].includes(status)) throw new Error("برای شروع اجرا از دکمه‌های ارسال به پیش‌کار/کار اصلی استفاده کنید");
  await cancelActiveJobs(task.id, "تغییر دستی وضعیت");
  await setStatus(task, status, {}, user, note || "تغییر دستی وضعیت");
}

export async function reassignTask(user: SessionUser, id: string, assigneeId: string) {
  const task = await getTask(id);
  if (task.requester_id !== user.id && task.assignee_id !== user.id && !user.isOwner) throw new Error("دسترسی ندارید");
  if (["closed", "cancelled"].includes(task.status)) throw new Error("تسک بسته شده است");
  const person = await activePerson(assigneeId);
  await cancelActiveJobs(task.id, "مسئول تسک تغییر کرد");
  const self = assigneeId === task.requester_id;
  must(
    await db()
      .from("tasks")
      .update({ assignee_id: assigneeId, project_id: null, ...(self ? {} : { status: "pending_approval", progress: 0 }) })
      .eq("id", id)
      .select("id"),
    "تغییر مسئول",
  );
  await logEvent({ task_id: id, source: "user", kind: "status", title: `مسئول تسک: ${person.full_name ?? "—"}`, visibility: "requester", actor_id: user.id });
  if (assigneeId !== user.id) await notify(assigneeId, { title: `تسک ${task.code} به شما سپرده شد`, body: task.title, link: `/t/${task.id}`, task_id: task.id });
}

export async function updateTaskDetails(user: SessionUser, id: string, input: { title: string; description: string }) {
  const task = await getTask(id);
  assertAssignee(user, task);
  if (["closed", "cancelled"].includes(task.status)) throw new Error("تسک بسته یا لغو شده قابل ویرایش نیست");
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) throw new Error("عنوان تسک الزامی است");
  if (title.length > 200) throw new Error("عنوان حداکثر ۲۰۰ کاراکتر است");
  if (description.length > 20000) throw new Error("شرح تسک حداکثر ۲۰٬۰۰۰ کاراکتر است");
  if (title === task.title && description === task.description) return;
  must(await db().from("tasks").update({ title, description }).eq("id", id).select("id").single(), "ویرایش تسک");
  await logEvent({ task_id: id, source: "user", kind: "log", title: "عنوان/شرح تسک ویرایش شد", detail: title !== task.title ? `عنوان قبلی: ${task.title}` : null, visibility: "requester", actor_id: user.id });
}

export async function addTaskFiles(user: SessionUser, id: string, files: UploadedFile[]) {
  const task = await getTask(id);
  if (task.assignee_id !== user.id && task.requester_id !== user.id && !user.isOwner) throw new Error("دسترسی ندارید");
  if (["closed", "cancelled"].includes(task.status)) throw new Error("به تسک بسته یا لغو شده نمی‌توان فایل افزود");
  if (!files.length) return;
  await registerFiles(user, [id], "request", files);
  await logEvent({ task_id: id, source: "user", kind: "file", title: `${files.length} فایل به تسک افزوده شد`, detail: files.map((f) => f.name).join("، "), visibility: "requester", actor_id: user.id });
}

export async function deleteTaskFile(user: SessionUser, fileId: string) {
  const { data: file } = await db().from("task_files").select("*").eq("id", fileId).maybeSingle<TaskFile>();
  if (!file?.task_id) throw new Error("فایل پیدا نشد");
  const task = await getTask(file.task_id);
  assertAssignee(user, task);
  if (["closed", "cancelled"].includes(task.status)) throw new Error("فایل‌های تسک بسته یا لغو شده قابل حذف نیستند");
  if (["prework_running", "main_running"].includes(task.status)) throw new Error("تسک در حال اجراست؛ پس از پایان اجرا فایل را حذف کنید");
  if (file.context === "output") throw new Error("خروجی‌ها از اینجا حذف نمی‌شوند");
  must(await db().from("task_files").delete().eq("id", file.id).select("id"), "حذف فایل");
  const { count } = await db().from("task_files").select("id", { count: "exact", head: true }).eq("storage_path", file.storage_path);
  if (!count) await db().storage.from("task-files").remove([file.storage_path]);
  await logEvent({ task_id: task.id, source: "user", kind: "file", title: `فایل «${file.name}» حذف شد`, visibility: "requester", actor_id: user.id });
}

// ---------------------------------------------------------------------------
// AI work (full mode)
// ---------------------------------------------------------------------------
export interface DispatchOptions {
  workflowId?: string | null;
  /** an existing project of the user */
  projectId?: string | null;
  /** or a new project created with this name (knowledge starts from here) */
  newProject?: { name: string; description?: string } | null;
  /** files of the project the user pointed at (relative paths) */
  files?: string[];
  resumeFromJobId?: string;
}

/** Resolves (or creates) the project a send works on; null = no project, so no knowledge is searched. */
async function resolveProject(user: SessionUser, opts: DispatchOptions): Promise<string | null> {
  if (opts.newProject?.name?.trim()) {
    if (!(await githubInfo(user.id))) throw new Error("برای ساخت پروژه و دانش، اول GitHub را وصل کنید (تنظیمات ← اتصال‌ها)");
    return (await createProject(user.id, { name: opts.newProject.name, description: opts.newProject.description })).id;
  }
  if (!opts.projectId) return null;
  return (await getProject(opts.projectId, user.id)).id;
}

function selectedFiles(list?: string[]) {
  return [...new Set((list ?? []).map((p) => safeProjectPath(p)).filter((p): p is string => !!p))].slice(0, 40);
}

async function assertWorkable(user: SessionUser, ids: string[], allowed: TaskStatus[], stageLabel: string) {
  if (user.mode !== "full") throw new Error("ارسال به هوش مصنوعی در حالت کامل اپ در دسترس است");
  const tasks = await Promise.all(ids.map(getTask));
  for (const t of tasks) {
    if (t.assignee_id !== user.id) throw new Error(`تسک ${t.code} به شما سپرده نشده است؛ هوش مصنوعی فقط برای مسئول تسک اجرا می‌شود`);
    if (!allowed.includes(t.status)) throw new Error(`تسک ${t.code} در وضعیت «${STATUS_META[t.status].label}» قابل ارسال به ${stageLabel} نیست`);
  }
  return tasks;
}

export async function sendToPrework(user: SessionUser, ids: string[], prompt: string, files: UploadedFile[] = [], origin?: string, opts: DispatchOptions = {}) {
  const cfg = await getUserConfig(user.id);
  const conn = stageModel(cfg, "prework").connectionId;
  if (!conn) throw new Error("برای پیش‌کار هنوز هیچ اتصال هوش مصنوعی انتخاب نکرده‌اید (تنظیمات ← مدل هر مرحله)");
  const tasks = await assertWorkable(user, ids, ["approved", "in_progress", "prework_done", "main_done", "closure_rejected"], "پیش‌کار");
  const finalPrompt = prompt.trim() || cfg.prework.defaultPrompt;
  const projectId = await resolveProject(user, opts);
  for (const task of tasks) {
    const pid = projectId ?? task.project_id;
    if (pid !== task.project_id) await db().from("tasks").update({ project_id: pid }).or(`id.eq.${task.root_id ?? task.id},root_id.eq.${task.root_id ?? task.id}`);
    const job = await enqueueJob({
      kind: "prework",
      owner_id: user.id,
      connection_id: conn,
      task_id: task.id,
      project_id: pid,
      payload: { prompt: finalPrompt, user_prompt: prompt.trim(), workflow_id: opts.workflowId || null, files_selected: selectedFiles(opts.files), resumed_from: opts.resumeFromJobId ?? null },
      priority: PRIORITY_META[task.priority].weight,
      created_by: user.id,
    });
    await registerFiles(user, [task.id], "prework", files, job.id);
    if (opts.resumeFromJobId) await copyCheckpoint(opts.resumeFromJobId, job.id);
    await setStatus(task, "prework_queued", {}, user, opts.resumeFromJobId ? "ادامه‌ی پیش‌کار از آخرین مرحله‌ی موفق" : "در صف پیش‌کار قرار گرفت");
  }
  await kickWorker(origin);
}

/** Retrying a failed pre-work continues from its last saved workflow state (finished steps are not repeated). */
async function copyCheckpoint(fromJobId: string, toJobId: string) {
  const [{ data }, { data: old }] = await Promise.all([db().from("job_data").select("graph, partial").eq("job_id", fromJobId).maybeSingle(), db().from("jobs").select("state").eq("id", fromJobId).maybeSingle()]);
  if (data?.graph && Object.keys(data.graph).length) await db().from("job_data").upsert({ job_id: toJobId, graph: data.graph, partial: data.partial ?? null });
  if (old?.state) {
    const { nodes, counts, usage, flow } = old.state as Record<string, unknown>;
    await db().from("jobs").update({ state: { nodes, counts, usage, flow } }).eq("id", toJobId);
  }
}

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

/** Per-send Claude Code choices; a key that is present (even "") overrides the Settings default. */
export function pickClaudeOptions(o: Partial<ClaudeRunOptions> | null | undefined): Partial<ClaudeRunOptions> | null {
  const out: Partial<ClaudeRunOptions> = {};
  if (!o || typeof o !== "object") return null;
  if (typeof o.model === "string" && /^[\w.:\[\]-]{0,80}$/.test(o.model.trim())) out.model = o.model.trim();
  if (typeof o.effort === "string" && EFFORTS.includes(o.effort)) out.effort = o.effort as ClaudeRunOptions["effort"];
  if (typeof o.thinking === "string" && ["auto", "on", "off"].includes(o.thinking)) out.thinking = o.thinking;
  return Object.keys(out).length ? out : null;
}

export async function sendToMain(user: SessionUser, ids: string[], prompt: string, files: UploadedFile[] = [], origin?: string, claude: Partial<ClaudeRunOptions> = {}, opts: DispatchOptions & { engine?: MainEngine | null } = {}) {
  const cfg = await getUserConfig(user.id);
  const engine: MainEngine = opts.engine === "agent" || opts.engine === "claude_code" ? opts.engine : cfg.stages.main.engine;
  // the workflow's executor may pick its own engine; the lane follows the engine that will run
  const workflow = await resolveWorkflow(user.id, "main", opts.workflowId);
  const agents = await agentMap(user.id);
  const engines = workflow.nodes.map((n) => agents[n.agentId]).filter((a) => a?.type === "coder").map((a) => (a.engine === "agent" || a.engine === "claude_code" ? a.engine : engine));
  const usesClaudeCode = engines.includes("claude_code");
  if (usesClaudeCode && !((await githubInfo(user.id))?.config as GithubConfig | undefined)?.claudeCode) {
    throw new Error("Claude Code در GitHub Actions شما راه‌اندازی نشده است (تنظیمات ← اتصال‌ها)؛ یا مجری داخل اپ را انتخاب کنید");
  }
  const conn = cfg.stages.main.connectionId ?? stageModel(cfg, "prework").connectionId;
  if (engines.includes("agent") && !cfg.stages.main.connectionId) throw new Error("برای مجری کار اصلی هنوز هیچ اتصال هوش مصنوعی انتخاب نکرده‌اید (تنظیمات ← مدل هر مرحله)");
  const tasks = await assertWorkable(user, ids, ["approved", "in_progress", "prework_done", "main_done", "closure_rejected"], "کار اصلی");
  const finalPrompt = prompt.trim() || cfg.main.defaultPrompt;
  const projectId = await resolveProject(user, opts);
  const run = pickClaudeOptions(claude);
  for (const task of tasks) {
    const pid = projectId ?? task.project_id;
    if (pid !== task.project_id) await db().from("tasks").update({ project_id: pid }).or(`id.eq.${task.root_id ?? task.id},root_id.eq.${task.root_id ?? task.id}`);
    const job = await enqueueJob({
      kind: "main",
      owner_id: user.id,
      lane: usesClaudeCode ? "external" : "llm",
      connection_id: usesClaudeCode ? null : conn,
      task_id: task.id,
      project_id: pid,
      payload: {
        prompt: finalPrompt,
        user_prompt: prompt.trim(),
        followup: task.status === "main_done",
        workflow_id: opts.workflowId || null,
        files_selected: selectedFiles(opts.files),
        engine,
        ...(run ? { claude: run } : {}),
      },
      priority: PRIORITY_META[task.priority].weight,
      created_by: user.id,
    });
    await registerFiles(user, [task.id], "main", files, job.id);
    await setStatus(task, "main_queued", {}, user, "در صف کار اصلی قرار گرفت");
  }
  await kickWorker(origin);
}

export async function cancelActiveJobs(taskId: string, reason: string) {
  const { data: jobs } = await db().from("jobs").select("*").eq("task_id", taskId).in("status", ["queued", "running"]);
  for (const j of jobs ?? []) {
    await db().from("jobs").update({ status: "cancelled", error: reason, finished_at: new Date().toISOString(), locked_by: null, locked_until: null }).eq("id", j.id);
    if (j.external_id && j.lane === "external" && j.owner_id) {
      const repo = await userRepoOrNull(j.owner_id as string);
      if (repo) await cancelRun(repo, Number(j.external_id)).catch(() => undefined);
    }
  }
}
