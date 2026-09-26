import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { commitFiles, listTree, repoRef } from "@/lib/github/client";
import { cancelActiveJobs } from "@/lib/tasks/service";
import { GITHUB_PREFIX } from "@/lib/tasks/outputs";
import { errorMessage } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth";
import type { Task } from "@/lib/types";

const FILES_BUCKET = "task-files";

export interface DeleteReport {
  tasks: number;
  files: number;
  knowledge: number;
  github: number;
  warnings: string[];
}

type FamilyTask = Pick<Task, "id" | "code" | "title" | "github_path" | "root_id" | "requester_id">;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Every task of the given projects (root tasks and their related tasks). */
async function familyOf(rootIds: string[]): Promise<FamilyTask[]> {
  if (!rootIds.length) return [];
  const cols = "id, code, title, github_path, root_id, requester_id";
  const [roots, children] = await Promise.all([
    db().from("tasks").select(cols).in("id", rootIds),
    db().from("tasks").select(cols).in("root_id", rootIds),
  ]);
  const seen = new Map<string, FamilyTask>();
  for (const t of [...(roots.data ?? []), ...(children.data ?? [])] as FamilyTask[]) seen.set(t.id, t);
  return [...seen.values()];
}

/** Storage objects of these tasks that no other task still uses (the same upload can be shared). */
async function removeStorage(taskIds: string[]): Promise<number> {
  const { data } = await db().from("task_files").select("storage_path").in("task_id", taskIds);
  const paths = [...new Set((data ?? []).map((f) => f.storage_path as string).filter((p) => p && !p.startsWith(GITHUB_PREFIX)))];
  if (!paths.length) return 0;
  const shared = new Set<string>();
  for (const part of chunks(paths, 100)) {
    const { data: others } = await db().from("task_files").select("storage_path, task_id").in("storage_path", part);
    for (const o of others ?? []) if (!taskIds.includes(o.task_id as string)) shared.add(o.storage_path as string);
  }
  const doomed = paths.filter((p) => !shared.has(p));
  for (const part of chunks(doomed, 100)) await db().storage.from(FILES_BUCKET).remove(part);
  return doomed.length;
}

/**
 * Knowledge notes of these tasks in the workspace repo (and, for whole projects, their folders),
 * removed in one commit. Related tasks share the project folder, so a lone related task keeps it.
 */
async function removeFromGithub(tasks: FamilyTask[], label: string, folders: boolean): Promise<number> {
  if (!env.githubToken) return 0;
  const ref = await repoRef("workspace");
  const tree = (await listTree(ref)).filter((t) => t.type === "blob");
  const dirs = folders ? [...new Set(tasks.map((t) => t.github_path).filter((p): p is string => !!p))] : [];
  const codes = tasks.map((t) => `${t.code}_`);
  const paths = tree
    .map((t) => t.path)
    .filter((p) => dirs.some((f) => p.startsWith(`${f}/`)) || (p.startsWith("knowledge/") && codes.some((c) => (p.split("/").pop() ?? "").startsWith(c))));
  if (!paths.length) return 0;
  await commitFiles(
    ref,
    paths.map((path) => ({ path, content: null })),
    `[TaskFlow] حذف ${label}`,
  );
  return paths.length;
}

/** Cancels work and removes everything that belongs to these tasks, then the task rows themselves. */
async function purge(tasks: FamilyTask[], label: string, folders: boolean): Promise<DeleteReport> {
  const report: DeleteReport = { tasks: tasks.length, files: 0, knowledge: 0, github: 0, warnings: [] };
  if (!tasks.length) return report;
  const ids = tasks.map((t) => t.id);

  // stop Gemini/Claude work first so nothing writes into tasks that are going away
  await Promise.all(ids.map((id) => cancelActiveJobs(id, "حذف شد")));

  try {
    report.files = await removeStorage(ids);
  } catch (err) {
    report.warnings.push(`حذف فایل‌ها از Storage: ${errorMessage(err)}`);
  }

  for (const part of chunks(ids, 100)) {
    const { data, error } = await db().from("knowledge_items").delete().in("metadata->>task_id", part).select("id");
    if (error) report.warnings.push(`حذف دانش: ${error.message}`);
    report.knowledge += data?.length ?? 0;
  }

  try {
    report.github = await removeFromGithub(tasks, label, folders);
  } catch (err) {
    report.warnings.push(`حذف از GitHub: ${errorMessage(err)}`);
  }

  // jobs (+job_data), events, files, AI messages, feedback, notifications and child tasks cascade
  for (const part of chunks(ids, 100)) {
    const { error } = await db().from("tasks").delete().in("id", part);
    if (error) throw new Error(`حذف تسک‌ها: ${error.message}`);
  }
  return report;
}

/**
 * Deletes whole projects: every related task, their jobs, logs, AI messages and outputs (DB
 * cascades), uploaded files in Storage, knowledge items extracted from them, and their folders
 * and knowledge notes in the GitHub workspace repo. Irreversible.
 */
export async function deleteProjects(rootIds: string[], label: string): Promise<DeleteReport> {
  return purge(await familyOf(rootIds), label, true);
}

/** Deletes the project a task belongs to (its root task and every related task). */
export async function deleteProject(taskId: string): Promise<DeleteReport & { code: string }> {
  const { data: task } = await db().from("tasks").select("id, code, title, root_id").eq("id", taskId).maybeSingle<Pick<Task, "id" | "code" | "title" | "root_id">>();
  if (!task) throw new Error("تسک یافت نشد");
  const rootId = task.root_id ?? task.id;
  const { data: root } = await db().from("tasks").select("code, title").eq("id", rootId).maybeSingle<Pick<Task, "code" | "title">>();
  const code = root?.code ?? task.code;
  return { ...(await deleteProjects([rootId], `پروژه ${code} «${root?.title ?? task.title}»`)), code };
}

async function removeUserUploads(userId: string): Promise<number> {
  // uploads that never got attached to a task (e.g. a dialog closed before sending)
  const bucket = db().storage.from(FILES_BUCKET);
  const { data: months } = await bucket.list(userId, { limit: 1000 });
  let removed = 0;
  for (const m of months ?? []) {
    const { data: files } = await bucket.list(`${userId}/${m.name}`, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${userId}/${m.name}/${f.name}`);
    for (const part of chunks(paths, 100)) {
      const { data: used } = await db().from("task_files").select("storage_path").in("storage_path", part);
      const keep = new Set((used ?? []).map((u) => u.storage_path as string));
      const doomed = part.filter((p) => !keep.has(p));
      if (doomed.length) {
        await bucket.remove(doomed);
        removed += doomed.length;
      }
    }
  }
  const avatars = db().storage.from("avatars");
  const { data: pics } = await avatars.list(userId, { limit: 100 });
  if (pics?.length) await avatars.remove(pics.map((p) => `${userId}/${p.name}`));
  return removed;
}

/**
 * Deletes a user account. Their projects are either deleted with everything in them ("delete") or
 * handed over to the admin doing the deletion ("transfer"). Knowledge about the user (requester
 * profile) and their unattached uploads are removed; authorship fields elsewhere are cleared.
 */
export async function deleteUser(actor: SessionUser, userId: string, mode: "delete" | "transfer"): Promise<DeleteReport & { name: string }> {
  if (userId === actor.id) throw new Error("نمی‌توانید حساب خودتان را حذف کنید");
  const { data: target } = await db().from("profiles").select("id, full_name, email").eq("id", userId).maybeSingle<{ id: string; full_name: string | null; email: string | null }>();
  if (!target) throw new Error("کاربر یافت نشد");
  const name = target.full_name || target.email || "کاربر";

  let report: DeleteReport = { tasks: 0, files: 0, knowledge: 0, github: 0, warnings: [] };
  const { data: own } = await db().from("tasks").select("id, root_id").eq("requester_id", userId);
  if (mode === "delete") {
    // whole projects the user started, plus their own related tasks inside other people's projects
    const rootIds = (own ?? []).filter((t) => !t.root_id).map((t) => t.id as string);
    report = await deleteProjects(rootIds, `پروژه‌های ${name}`);
    const { data: rest } = await db().from("tasks").select("id, code, title, github_path, root_id, requester_id").eq("requester_id", userId);
    if (rest?.length) {
      const more = await purge(rest as FamilyTask[], `تسک‌های ${name}`, false);
      report = { ...report, tasks: report.tasks + more.tasks, files: report.files + more.files, knowledge: report.knowledge + more.knowledge, github: report.github + more.github, warnings: [...report.warnings, ...more.warnings] };
    }
  } else if (own?.length) {
    const { error } = await db().from("tasks").update({ requester_id: actor.id }).eq("requester_id", userId);
    if (error) throw new Error(`انتقال پروژه‌ها: ${error.message}`);
  }

  const { data: kn } = await db().from("knowledge_items").delete().eq("metadata->>requester_id", userId).select("id");
  report.knowledge += kn?.length ?? 0;

  // authorship columns reference the profile without ON DELETE: clear them so the account can go
  await Promise.all([
    db().from("jobs").update({ created_by: null }).eq("created_by", userId),
    db().from("task_files").update({ uploaded_by: null }).eq("uploaded_by", userId),
    db().from("upgrades").update({ created_by: null }).eq("created_by", userId),
    db().from("feedback").update({ created_by: null }).eq("created_by", userId),
    db().from("agent_prompts").update({ created_by: null }).eq("created_by", userId),
  ]);

  try {
    report.files += await removeUserUploads(userId);
  } catch (err) {
    report.warnings.push(`حذف فایل‌های کاربر: ${errorMessage(err)}`);
  }

  const { error } = await db().auth.admin.deleteUser(userId);
  if (error && !/not found/i.test(error.message)) throw new Error(`حذف حساب: ${error.message}`);
  // profiles cascade from auth.users; remove it directly too in case the auth user was already gone
  await db().from("profiles").delete().eq("id", userId);
  return { ...report, name };
}
