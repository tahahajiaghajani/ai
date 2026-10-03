import "server-only";
import { db } from "@/lib/supabase/admin";
import { logEvent, notify } from "@/lib/events";
import { dispatchExternal, watchExternal, type ExternalOptions } from "@/lib/queue/handlers/external";
import { engineStep } from "@/lib/workflow/engine";
import type { JobRun, StepResult } from "@/lib/queue/run";
import type { Task } from "@/lib/types";

const OPTS: ExternalOptions = { workflow: "claude-task.yml", leaseSeconds: 3 * 3600, label: "Claude Code" };

/**
 * run (the main-stage workflow: model steps and the in-app executor run here; a Claude Code step is
 * dispatched to the user's GitHub Actions and resumed here when the runner reports back) → done.
 */
export async function mainHandler(run: JobRun): Promise<StepResult> {
  const step = run.job.step ?? "start";
  if (step === "start") {
    const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
    if (!task) return { type: "fail", error: "تسک یافت نشد" };
    await db()
      .from("tasks")
      .update({ status: "main_running", progress: Math.max(task.progress, 60), main_started_at: task.main_started_at ?? new Date().toISOString() })
      .eq("id", task.id);
    await logEvent({ task_id: task.id, job_id: run.job.id, kind: "status", title: "وضعیت: در حال انجام کار اصلی", visibility: "requester" });
    return { type: "continue", step: "run" };
  }
  if (step === "run") {
    const r = await engineStep(run, "main");
    if (r.type === "fail") return { type: "fail", error: r.error };
    if (r.type === "done") return { type: "done", result: { workflow: true } };
    if (r.type === "external") return dispatchExternal(run, OPTS);
    return { type: "continue", step: "run" };
  }
  if (step === "dispatch") return dispatchExternal(run, OPTS);
  return watchExternal(run, OPTS);
}

export async function mainOnFail(run: JobRun, error: string) {
  if (!run.job.task_id) return;
  const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
  if (!task) return;
  await db().from("tasks").update({ status: "prework_done", progress: 50 }).eq("id", task.id);
  await logEvent({ task_id: task.id, job_id: run.job.id, source: "ai", kind: "error", title: "کار اصلی ناموفق بود؛ تسک به صف کار اصلی برگشت", detail: error });
  await notify(task.assignee_id, { title: `خطا در کار اصلی ${task.code}`, body: error.slice(0, 300), link: `/tasks/${task.id}`, task_id: task.id });
}
