import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { dispatchWorkflow, getRun, listWorkflowFiles, repoRef } from "@/lib/github/client";
import type { JobRun, StepResult } from "@/lib/queue/run";

export interface ExternalOptions {
  repo: "workspace" | "app";
  workflow: string;
  /** Lease while the GitHub Actions run is expected to be alive. */
  leaseSeconds: number;
  label: string;
}

/** Dispatch a GitHub Actions workflow for this job and wait for runner callbacks. */
export async function dispatchExternal(run: JobRun, opts: ExternalOptions): Promise<StepResult> {
  if (!env.appUrl) throw new Error("آدرس اپ (APP_URL) مشخص نیست؛ در Vercel متغیر APP_URL را تنظیم کنید");
  const ref = await repoRef(opts.repo);
  const workflows = await listWorkflowFiles(ref);
  if (!workflows.includes(opts.workflow)) {
    return {
      type: "fail",
      error:
        opts.repo === "workspace"
          ? `فایل ${opts.workflow} در مخزن ${ref.repo} نیست. در «تنظیمات» دکمه‌ی «راه‌اندازی مخزن کاری» را بزنید.`
          : `فایل ${opts.workflow} در مخزن اپ نیست. شاخه‌ی اصلی مخزن ${ref.repo} را به‌روز کنید.`,
    };
  }
  await dispatchWorkflow(ref, opts.workflow, { job_id: run.job.id, app_url: env.appUrl });
  await run.patchState({ dispatched_at: new Date().toISOString(), runner_status: "dispatched" });
  await run.log({ source: "github", kind: "log", title: `${opts.label}: اجرای GitHub Actions درخواست شد`, data: { workflow: opts.workflow } });
  return { type: "wait", step: "waiting", leaseSeconds: 20 * 60 };
}

/**
 * Called when an external job's lease expired without a final callback:
 * checks the GitHub run and decides to keep waiting, re-dispatch or give up.
 */
export async function watchExternal(run: JobRun, opts: ExternalOptions): Promise<StepResult> {
  const ref = await repoRef(opts.repo);
  const dispatchedAt = new Date(String(run.state.dispatched_at ?? run.job.updated_at)).getTime();

  if (!run.job.external_id) {
    if (Date.now() - dispatchedAt < 25 * 60_000) return { type: "wait", step: "waiting", leaseSeconds: 5 * 60 };
    await run.log({ source: "github", kind: "warning", title: `${opts.label}: اجرای GitHub شروع نشد؛ ارسال دوباره` });
    if (run.job.attempts + 1 >= run.job.max_attempts) return { type: "fail", error: "GitHub Actions اجرا را شروع نکرد (Actions یا secrets را بررسی کنید)" };
    await db().from("jobs").update({ attempts: run.job.attempts + 1 }).eq("id", run.job.id);
    return { type: "continue", step: "dispatch" };
  }

  const gr = await getRun(ref, Number(run.job.external_id));
  if (gr.status !== "completed") {
    return { type: "wait", step: "waiting", leaseSeconds: Math.min(opts.leaseSeconds, 30 * 60) };
  }
  // The run finished but we never got the final callback.
  if (gr.conclusion === "success") {
    await run.log({ source: "github", kind: "warning", title: `${opts.label}: اجرا تمام شد ولی گزارش نهایی نرسید`, detail: gr.html_url });
    return { type: "done", result: { conclusion: gr.conclusion, url: gr.html_url, missing_callback: true } };
  }
  await run.log({ source: "github", kind: "error", title: `${opts.label}: اجرای GitHub با وضعیت ${gr.conclusion} تمام شد`, detail: gr.html_url });
  if (run.job.attempts + 1 >= run.job.max_attempts) return { type: "fail", error: `اجرای GitHub ناموفق بود (${gr.conclusion})` };
  await db().from("jobs").update({ attempts: run.job.attempts + 1, external_id: null, external_url: null }).eq("id", run.job.id);
  run.job.external_id = null;
  return { type: "continue", step: "dispatch" };
}
