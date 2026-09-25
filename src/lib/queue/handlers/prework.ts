import "server-only";
import { db } from "@/lib/supabase/admin";
import { runPreworkStep } from "@/lib/agents/prework";
import { enqueueJob } from "@/lib/queue/jobs";
import { getSettings } from "@/lib/settings";
import { logEvent, notifyAdmins } from "@/lib/events";
import { PREWORK_NODES } from "@/lib/status";
import type { JobRun, StepResult } from "@/lib/queue/run";
import type { NodeState, Task } from "@/lib/types";

export async function preworkHandler(run: JobRun): Promise<StepResult> {
  const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
  if (!task) return { type: "fail", error: "تسک یافت نشد" };

  if (!run.data.graph) {
    if (task.status !== "prework_running") {
      await db()
        .from("tasks")
        .update({ status: "prework_running", progress: 20, prework_started_at: new Date().toISOString() })
        .eq("id", task.id);
      await logEvent({ task_id: task.id, job_id: run.job.id, kind: "status", title: "وضعیت: در حال انجام پیش‌کار", visibility: "requester" });
    }
    if (!run.state.nodes) {
      const nodes: Record<string, NodeState> = {};
      for (const n of PREWORK_NODES) nodes[n.key] = { status: "pending" };
      await run.patchState({ nodes });
    }
  }

  const res = await runPreworkStep(run, { taskId: task.id, prompt: String(run.job.payload.prompt ?? "") });
  if (!res.done) return { type: "continue", step: res.ran ?? undefined };

  const v = res.values;
  await db()
    .from("tasks")
    .update({ status: "prework_done", progress: 50, prework_done_at: new Date().toISOString() })
    .eq("id", task.id);
  await logEvent({
    task_id: task.id,
    job_id: run.job.id,
    kind: "status",
    title: "وضعیت: پیش‌کار تمام شد — در صف انجام کار اصلی",
    visibility: "requester",
  });
  await notifyAdmins({
    title: `پیش‌کار ${task.code} تمام شد`,
    body: `${task.title} — ${v.items?.length ?? 0} فعالیت، ${v.execFiles?.length ?? 0} فایل آماده. آماده‌ی ارسال به Claude.`,
    link: `/tasks/${task.id}`,
    task_id: task.id,
  });

  const settings = await getSettings();
  if (settings.graphify.mode !== "off" && v.rootPath) {
    await enqueueJob({ kind: "graphify", task_id: task.id, payload: { path: v.rootPath }, priority: 40 });
  }
  return {
    type: "done",
    result: { commit: v.commit ?? null, items: v.items?.length ?? 0, files: v.execFiles?.length ?? 0, path: v.rootPath, models: v.models ?? [] },
  };
}

export async function preworkOnFail(run: JobRun, error: string) {
  if (!run.job.task_id) return;
  const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
  if (!task) return;
  await db().from("tasks").update({ status: "approved", progress: 10 }).eq("id", task.id);
  await logEvent({
    task_id: task.id,
    job_id: run.job.id,
    source: "gemini",
    kind: "error",
    title: "پیش‌کار ناموفق بود؛ تسک به صف پیش‌کار برگشت",
    detail: error,
  });
  await notifyAdmins({ title: `خطا در پیش‌کار ${task.code}`, body: error.slice(0, 300), link: `/tasks/${task.id}`, task_id: task.id });
}
