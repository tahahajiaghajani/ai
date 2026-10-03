import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { appRepo, dispatchWorkflow, getRun, listWorkflowFiles, userRepo, type Repo } from "@/lib/github/client";
import { ensureTemplate } from "@/lib/github/bootstrap";
import { errorMessage } from "@/lib/utils";
import type { JobRun, StepResult } from "@/lib/queue/run";

export interface ExternalOptions {
  workflow: string;
  /** the app's own repository (owner's self-upgrade) instead of the user's workspace */
  app?: boolean;
  /** Lease while the GitHub Actions run is expected to be alive. */
  leaseSeconds: number;
  label: string;
}

async function repoFor(run: JobRun, opts: ExternalOptions): Promise<Repo> {
  return opts.app ? appRepo() : userRepo(run.job.owner_id!);
}

/** Dispatch a GitHub Actions workflow in the user's repository and wait for runner callbacks. */
export async function dispatchExternal(run: JobRun, opts: ExternalOptions): Promise<StepResult> {
  if (!env.appUrl) throw new Error("آدرس اپ (APP_URL) مشخص نیست؛ مالک اپ باید APP_URL را در Vercel تنظیم کند");
  const repo = await repoFor(run, opts);
  if (!opts.app) {
    try {
      if ((await ensureTemplate(run.job.owner_id!)) === "synced") await run.log({ source: "github", kind: "log", title: "فایل‌های runner در مخزن شما با نسخه‌ی جدید اپ همگام شد" });
    } catch (err) {
      await run.log({ source: "github", kind: "warning", title: "همگام‌سازی خودکار قالب مخزن ناموفق بود", detail: errorMessage(err) });
    }
  }
  const workflows = await listWorkflowFiles(repo);
  if (!workflows.includes(opts.workflow)) {
    return {
      type: "fail",
      error: opts.app
        ? `فایل ${opts.workflow} در مخزن اپ نیست. شاخه‌ی اصلی مخزن ${repo.repo} را به‌روز کنید.`
        : `فایل ${opts.workflow} در مخزن ${repo.owner}/${repo.repo} نیست؛ در «تنظیمات ← اتصال‌ها» راه‌اندازی دوباره‌ی GitHub را بزنید.`,
    };
  }
  await dispatchWorkflow(repo, opts.workflow, { job_id: run.job.id, app_url: env.appUrl });
  await run.patchState({ dispatched_at: new Date().toISOString(), runner_status: "dispatched" });
  await run.log({ source: "github", kind: "log", title: `${opts.label}: اجرای GitHub Actions درخواست شد`, data: { workflow: opts.workflow } });
  return { type: "wait", step: "waiting", leaseSeconds: 20 * 60 };
}

/**
 * Called when an external job's lease expired without a final callback:
 * checks the GitHub run and decides to keep waiting, re-dispatch or give up.
 */
export async function watchExternal(run: JobRun, opts: ExternalOptions): Promise<StepResult> {
  const repo = await repoFor(run, opts);
  const dispatchedAt = new Date(String(run.state.dispatched_at ?? run.job.updated_at)).getTime();

  if (!run.job.external_id) {
    if (Date.now() - dispatchedAt < 25 * 60_000) return { type: "wait", step: "waiting", leaseSeconds: 5 * 60 };
    await run.log({ source: "github", kind: "warning", title: `${opts.label}: اجرای GitHub شروع نشد؛ ارسال دوباره` });
    if (run.job.attempts + 1 >= run.job.max_attempts) return { type: "fail", error: "GitHub Actions اجرا را شروع نکرد (Actions یا secrets مخزن را بررسی کنید)" };
    await db().from("jobs").update({ attempts: run.job.attempts + 1 }).eq("id", run.job.id);
    return { type: "continue", step: "dispatch" };
  }

  const gr = await getRun(repo, Number(run.job.external_id));
  if (gr.status !== "completed") return { type: "wait", step: "waiting", leaseSeconds: Math.min(opts.leaseSeconds, 30 * 60) };
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
