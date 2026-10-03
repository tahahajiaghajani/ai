import "server-only";
import { db } from "@/lib/supabase/admin";
import { guessMime } from "@/lib/ai/files";
import { slugify } from "@/lib/utils";

/** Storage path marker for files that live in the assignee's GitHub repo instead of Supabase Storage. */
export const GITHUB_PREFIX = "github:";

export interface OutputFile {
  /** path in the assignee's GitHub repository */
  path?: string;
  /** path in Supabase Storage (users without GitHub) */
  storage?: string;
  size?: number | null;
  /** shown in the file list instead of the bare file name */
  name?: string;
}

/**
 * Records AI-produced files as task outputs so the conversation and the file list offer them for
 * download. Re-running a job replaces its rows.
 */
export async function registerOutputs(taskId: string, jobId: string, files: OutputFile[]) {
  await db().from("task_files").delete().eq("job_id", jobId).eq("context", "output");
  if (!files.length) return;
  const rows = files.map((f) => {
    const name = f.name ?? (f.path ?? f.storage ?? "").split("/").pop() ?? "file";
    return {
      task_id: taskId,
      job_id: jobId,
      context: "output",
      storage_path: f.path ? `${GITHUB_PREFIX}${f.path}` : f.storage!,
      github_path: f.path ?? null,
      name: name.slice(0, 200),
      mime: guessMime(name, null),
      size: f.size ?? null,
    };
  });
  const { error } = await db().from("task_files").insert(rows);
  if (error) throw new Error(`ثبت فایل‌های خروجی: ${error.message}`);
}

/** Without GitHub, outputs are kept in Supabase Storage under the assignee's folder. */
export async function storeOutputs(ownerId: string, taskId: string, jobId: string, files: { path: string; content: string }[]): Promise<OutputFile[]> {
  const out: OutputFile[] = [];
  for (const f of files) {
    const safe = f.path
      .split("/")
      .map((s) => slugify(s.replace(/\.[^.]+$/, ""), 60) + (s.match(/\.[A-Za-z0-9]{1,10}$/)?.[0] ?? ""))
      .join("/");
    const storage = `${ownerId}/outputs/${taskId}/${jobId}/${safe}`;
    const { error } = await db().storage.from("task-files").upload(storage, new Blob([f.content], { type: guessMime(f.path, null) }), { upsert: true, contentType: guessMime(f.path, null) });
    if (error) throw new Error(`ذخیره‌ی خروجی ${f.path}: ${error.message}`);
    out.push({ storage, size: Buffer.byteLength(f.content), name: f.path.split("/").pop() });
  }
  return out;
}

/** The AI's answer for one job, shown as a chat message (agent "reply"). */
export async function saveReply(taskId: string, jobId: string, content: string) {
  const text = content.trim();
  if (!text) return;
  const { data: task } = await db().from("tasks").select("id, root_id").eq("id", taskId).single<{ id: string; root_id: string | null }>();
  await db().from("ai_messages").delete().eq("job_id", jobId).eq("agent", "reply");
  await db().from("ai_messages").insert({ root_task_id: task?.root_id ?? taskId, task_id: taskId, job_id: jobId, agent: "reply", role: "model", content: text });
}
