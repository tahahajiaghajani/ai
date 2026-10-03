import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { logEvent, notify } from "@/lib/events";
import { pauseConnection } from "@/lib/connections";
import { DeadlineError, FatalError, RateLimitError, TransientError } from "@/lib/errors";
import { bumpLaneStats, JobRun, type StepResult } from "@/lib/queue/run";
import { preworkHandler, preworkOnFail } from "@/lib/queue/handlers/prework";
import { mainHandler, mainOnFail } from "@/lib/queue/handlers/main";
import { graphifyHandler, upgradeHandler } from "@/lib/queue/handlers/upgrade";
import { indexHandler, knowledgeHandler, optimizeHandler } from "@/lib/queue/handlers/knowledge";
import { importHandler, importOnFail } from "@/lib/queue/handlers/import";
import { finalizeFromWatchdog } from "@/lib/claude/ingest";
import { formatJalali } from "@/lib/jalali";
import { errorMessage, randomId } from "@/lib/utils";
import type { Job, JobKind, Lane } from "@/lib/types";

interface Handler {
  run: (r: JobRun) => Promise<StepResult>;
  onFail?: (r: JobRun, error: string) => Promise<void>;
  onDone?: (r: JobRun, result: Record<string, unknown>) => Promise<void>;
}

const HANDLERS: Record<JobKind, Handler> = {
  prework: { run: preworkHandler, onFail: preworkOnFail },
  main: { run: mainHandler, onDone: (r) => finalizeFromWatchdog(r.job), onFail: mainOnFail },
  upgrade: {
    run: upgradeHandler,
    onDone: (r) => finalizeFromWatchdog(r.job),
    onFail: async (r, error) => {
      await db().from("upgrades").update({ status: "failed", summary: error.slice(0, 2000) }).eq("id", r.job.upgrade_id);
    },
  },
  graphify: { run: graphifyHandler },
  knowledge: { run: knowledgeHandler },
  index: { run: indexHandler },
  optimize: { run: optimizeHandler },
  import: { run: importHandler, onFail: importOnFail },
};

/** Add actionable Persian hints to common integration errors. */
function humanizeError(message: string): string {
  if (/Bad credentials/i.test(message)) return `توکن GitHub نامعتبر یا منقضی است (تنظیمات ← اتصال‌ها). — ${message}`;
  if (/Resource not accessible by personal access token|Must have admin rights/i.test(message)) {
    return `توکن GitHub دسترسی کافی ندارد (Contents، Actions، Secrets و Workflows لازم است). — ${message}`;
  }
  if (/Not Found - https:\/\/docs\.github\.com/i.test(message)) return `مخزن یا فایل در GitHub پیدا نشد؛ در «تنظیمات ← اتصال‌ها» GitHub را دوباره راه‌اندازی کنید. — ${message}`;
  return message;
}

type Outcome = "continue" | "wait" | "done" | "failed" | "paused" | "error";

async function claim(lane: Lane, workerId: string, leaseSeconds: number): Promise<Job | null> {
  const { data, error } = await db().rpc("claim_job", { p_lane: lane, p_worker: workerId, p_lease_seconds: leaseSeconds });
  if (error) throw new Error(`claim_job: ${error.message}`);
  return ((data ?? []) as Job[])[0] ?? null;
}

async function release(run: JobRun, patch: Record<string, unknown>) {
  await db()
    .from("jobs")
    .update({ state: run.job.state, updated_at: new Date().toISOString(), ...patch })
    .eq("id", run.job.id)
    .eq("status", "running");
}

async function fail(run: JobRun, h: Handler, message: string, attempts?: number) {
  await release(run, { status: "failed", error: message, finished_at: new Date().toISOString(), locked_by: null, locked_until: null, ...(attempts ? { attempts } : {}) });
  await run.log({ source: "system", kind: "error", title: "کار متوقف شد", detail: message });
  await h.onFail?.(run, message);
}

async function applyResult(run: JobRun, h: Handler, res: StepResult): Promise<Outcome> {
  const now = new Date();
  switch (res.type) {
    case "continue":
      await release(run, { step: res.step ?? run.job.step, locked_by: null, locked_until: null, run_after: now.toISOString() });
      return "continue";
    case "wait":
      await release(run, { step: res.step, locked_by: "external", locked_until: new Date(now.getTime() + res.leaseSeconds * 1000).toISOString() });
      return "wait";
    case "done":
      await release(run, { status: "done", result: res.result ?? {}, finished_at: now.toISOString(), locked_by: null, locked_until: null, error: null });
      if (h.onDone && res.result?.missing_callback) await h.onDone(run, res.result);
      return "done";
    case "fail":
      await fail(run, h, res.error);
      return "failed";
  }
}

async function applyError(run: JobRun, h: Handler, err: unknown): Promise<Outcome> {
  if (err instanceof DeadlineError) {
    await release(run, { locked_by: null, locked_until: null });
    return "continue";
  }
  if (err instanceof RateLimitError) {
    if (err.scope === "connection" && err.connectionId) await pauseConnection(err.connectionId, err.until, err.reason);
    await release(run, { locked_by: null, locked_until: null, run_after: err.until.toISOString() });
    const live = run.state.live?.node;
    if (live) await run.setNode(live, { status: "paused", detail: `ادامه ${formatJalali(err.until, { withTime: true })}` });
    await run.log({ source: "ai", kind: "warning", title: `⏸ ${err.reason} — ادامه‌ی خودکار در ${formatJalali(err.until, { withTime: true })}`, data: { until: err.until.toISOString(), model: err.model } });
    return "paused";
  }
  if (err instanceof FatalError) {
    await fail(run, h, err.message);
    if (run.job.owner_id) await notify(run.job.owner_id, { title: "کار متوقف شد", body: err.message.slice(0, 240), link: run.job.task_id ? `/tasks/${run.job.task_id}` : "/queue", task_id: run.job.task_id });
    return "failed";
  }

  const message = humanizeError(errorMessage(err));
  const attempts = run.job.attempts + 1;
  if (attempts >= run.job.max_attempts) {
    await fail(run, h, message, attempts);
    return "failed";
  }
  const delay = err instanceof TransientError ? err.delayMs : Math.min(60_000 * 2 ** (attempts - 1), 30 * 60_000);
  await release(run, { attempts, error: message, locked_by: null, locked_until: null, run_after: new Date(Date.now() + delay).toISOString() });
  await run.log({ source: "system", kind: "warning", title: `خطا؛ تلاش دوباره (${attempts}/${run.job.max_attempts})`, detail: message });
  return "error";
}

async function execute(job: Job, workerId: string, deadline: number): Promise<Outcome> {
  const h = HANDLERS[job.kind];
  const run = new JobRun(job, workerId, deadline);
  try {
    await run.loadData();
    const res = await h.run(run);
    return await applyResult(run, h, res);
  } catch (err) {
    return applyError(run, h, err);
  }
}

export interface TickReport {
  worker: string;
  processed: number;
  more: boolean;
  outcomes: string[];
  ms: number;
}

/** AI jobs of different users run side by side in one invocation (each user has their own keys). */
const LLM_PARALLEL = 3;

/**
 * One worker invocation (called by pg_cron every ~30s and self-chained while work remains).
 * Several loops claim jobs at the same time; claim_job lets each user have one running AI job, so
 * one user's long job never blocks the others.
 */
export async function runTick(): Promise<TickReport> {
  const started = Date.now();
  const deadline = started + env.workerBudgetMs;
  const workerId = `w-${randomId(6)}`;
  const outcomes: string[] = [];
  let more = false;

  await bumpLaneStats("system", { last_tick_at: new Date().toISOString() });

  const loop = async (lane: Lane, maxJobs: number) => {
    for (let i = 0; i < maxJobs && Date.now() < deadline - 20_000; i++) {
      const lease = Math.ceil((deadline - Date.now()) / 1000) + 25;
      const job = await claim(lane, workerId, lease);
      if (!job) return;
      const o = await execute(job, workerId, deadline);
      outcomes.push(`${job.kind}:${o}`);
      if (o === "continue") more = true;
    }
    if (Date.now() >= deadline - 20_000) more = true;
  };

  await Promise.all([loop("external", 10), loop("system", 6), ...Array.from({ length: LLM_PARALLEL }, () => loop("llm", 50))]);
  return { worker: workerId, processed: outcomes.length, more, outcomes, ms: Date.now() - started };
}

/** Log line for a job that belongs to no task (project imports etc.) — shown in the project's activity. */
export async function projectLog(projectId: string, title: string, detail?: string) {
  await logEvent({ project_id: projectId, source: "project", kind: "log", title, detail: detail ?? null });
}
