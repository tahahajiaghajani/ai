import "server-only";
import { db } from "@/lib/supabase/admin";
import { guessMime } from "@/lib/ai/files";

/** Storage path marker for files that live in the GitHub workspace repo instead of Supabase Storage. */
export const GITHUB_PREFIX = "github:";

export interface OutputFile {
  path: string;
  size?: number | null;
  /** shown in the file list instead of the bare file name */
  name?: string;
}

/**
 * Records AI-produced files (already committed to the workspace repo) as task outputs, so the
 * conversation and file list can offer them for download. Re-running a job replaces its rows.
 */
export async function registerOutputs(taskId: string, jobId: string, files: OutputFile[]) {
  await db().from("task_files").delete().eq("job_id", jobId).eq("context", "output");
  if (!files.length) return;
  const rows = files.map((f) => {
    const name = f.name ?? f.path.split("/").pop() ?? f.path;
    return {
      task_id: taskId,
      job_id: jobId,
      context: "output",
      storage_path: `${GITHUB_PREFIX}${f.path}`,
      github_path: f.path,
      name: name.slice(0, 200),
      mime: guessMime(name, null),
      size: f.size ?? null,
    };
  });
  const { error } = await db().from("task_files").insert(rows);
  if (error) throw new Error(`ثبت فایل‌های خروجی: ${error.message}`);
}

/** The AI's answer for one job, shown as a chat message (agent "reply"). */
export async function saveReply(taskId: string, jobId: string, content: string) {
  const text = content.trim();
  if (!text) return;
  const { data: task } = await db().from("tasks").select("id, root_id").eq("id", taskId).single<{ id: string; root_id: string | null }>();
  await db().from("ai_messages").delete().eq("job_id", jobId).eq("agent", "reply");
  await db()
    .from("ai_messages")
    .insert({ root_task_id: task?.root_id ?? taskId, task_id: taskId, job_id: jobId, agent: "reply", role: "model", content: text });
}
