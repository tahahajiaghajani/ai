import "server-only";
import { db } from "@/lib/supabase/admin";
import { engineStep } from "@/lib/workflow/engine";
import { logEvent, notify } from "@/lib/events";
import type { JobRun, StepResult } from "@/lib/queue/run";
import type { Task } from "@/lib/types";

export async function preworkHandler(run: JobRun): Promise<StepResult> {
  const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
  if (!task) return { type: "fail", error: "تسک یافت نشد" };

  if (task.status !== "prework_running") {
    await db()
      .from("tasks")
      .update({ status: "prework_running", progress: Math.max(task.progress, 20), prework_started_at: task.prework_started_at ?? new Date().toISOString() })
      .eq("id", task.id);
    await logEvent({ task_id: task.id, job_id: run.job.id, kind: "status", title: "وضعیت: در حال انجام پیش‌کار", visibility: "requester" });
  }
  const step = await engineStep(run, "prework");
  if (step.type === "fail") return { type: "fail", error: step.error };
  if (step.type !== "done") return { type: "continue", step: "run" };

  const outputs = await db().from("task_files").select("id", { count: "exact", head: true }).eq("job_id", run.job.id).eq("context", "output");
  await db().from("tasks").update({ status: "prework_done", progress: 50, prework_done_at: new Date().toISOString() }).eq("id", task.id);
  await logEvent({ task_id: task.id, job_id: run.job.id, kind: "status", title: "وضعیت: پیش‌کار تمام شد — آماده‌ی کار اصلی", visibility: "requester" });
  await notify(task.assignee_id, {
    title: `پیش‌کار ${task.code} تمام شد`,
    body: `${task.title} — ${outputs.count ? `${outputs.count} فایل خروجی` : "پاسخ"} آماده است.`,
    link: `/tasks/${task.id}`,
    task_id: task.id,
  });
  return { type: "done", result: { files: outputs.count ?? 0 } };
}

export async function preworkOnFail(run: JobRun, error: string) {
  if (!run.job.task_id) return;
  const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
  if (!task) return;
  await db().from("tasks").update({ status: "approved", progress: 10 }).eq("id", task.id);
  await logEvent({ task_id: task.id, job_id: run.job.id, source: "ai", kind: "error", title: "پیش‌کار ناموفق بود؛ تسک به صف پیش‌کار برگشت", detail: error });
  await notify(task.assignee_id, { title: `خطا در پیش‌کار ${task.code}`, body: error.slice(0, 300), link: `/tasks/${task.id}`, task_id: task.id });
}
