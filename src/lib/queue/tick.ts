import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/events";
import { DeadlineError, RateLimitError, TransientError } from "@/lib/errors";
import { bumpProviderStats, JobRun, pauseProvider, type StepResult } from "@/lib/queue/run";
import { preworkHandler, preworkOnFail } from "@/lib/queue/handlers/prework";
import { mainHandler } from "@/lib/queue/handlers/main";
import { graphifyHandler, upgradeHandler } from "@/lib/queue/handlers/upgrade";
import { knowledgeHandler, optimizeHandler } from "@/lib/queue/handlers/knowledge";
import { finalizeFromWatchdog } from "@/lib/claude/ingest";
import { formatJalali } from "@/lib/jalali";
import { errorMessage, randomId } from "@/lib/utils";
import type { Job, JobKind, Provider } from "@/lib/types";

interface Handler {
  run: (r: JobRun) => Promise<StepResult>;
  onFail?: (r: JobRun, error: string) => Promise<void>;
  onDone?: (r: JobRun, result: Record<string, unknown>) => Promise<void>;
}

const HANDLERS: Record<JobKind, Handler> = {
  prework: { run: preworkHandler, onFail: preworkOnFail },
  main: {
    run: mainHandler,
    onDone: (r) => finalizeFromWatchdog(r.job),
    onFail: async (r, error) => {
      if (!r.job.task_id) return;
      await db().from("tasks").update({ status: "prework_done", progress: 50 }).eq("id", r.job.task_id);
      await logEvent({ task_id: r.job.task_id, job_id: r.job.id, source: "claude", kind: "error", title: "کار اصلی ناموفق بود؛ تسک به صف کار اصلی برگشت", detail: error });
    },
  },
  upgrade: {
    run: upgradeHandler,
    onDone: (r) => finalizeFromWatchdog(r.job),
    onFail: async (r, error) => {
      await db().from("upgrades").update({ status: "failed", summary: error.slice(0, 2000) }).eq("id", r.job.upgrade_id);
    },
  },
  graphify: { run: graphifyHandler },
  knowledge: { run: knowledgeHandler },
  optimize: { run: optimizeHandler },
};

type Outcome = "continue" | "wait" | "done" | "failed" | "paused" | "error";

async function claim(provider: Provider, workerId: string, leaseSeconds: number): Promise<Job | null> {
  const { data, error } = await db().rpc("claim_job", { p_provider: provider, p_worker: workerId, p_lease_seconds: leaseSeconds });
  if (error) throw new Error(`claim_job: ${error.message}`);
  const rows = (data ?? []) as Job[];
  return rows[0] ?? null;
}

async function release(run: JobRun, patch: Record<string, unknown>) {
  await db()
    .from("jobs")
    .update({ state: run.job.state, updated_at: new Date().toISOString(), ...patch })
    .eq("id", run.job.id)
    .eq("status", "running");
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
      await release(run, { status: "failed", error: res.error, finished_at: now.toISOString(), locked_by: null, locked_until: null });
      await run.log({ source: "system", kind: "error", title: "کار متوقف شد", detail: res.error });
      await h.onFail?.(run, res.error);
      return "failed";
  }
}

async function applyError(run: JobRun, h: Handler, err: unknown): Promise<Outcome> {
  if (err instanceof DeadlineError) {
    await release(run, { locked_by: null, locked_until: null });
    return "continue";
  }
  if (err instanceof RateLimitError) {
    if (err.scope === "provider") await pauseProvider(run.job.provider, err.until, err.reason);
    await release(run, { locked_by: null, locked_until: null, run_after: err.until.toISOString() });
    const live = run.state.live?.node;
    if (live) await run.setNode(live, { status: "paused", detail: `ادامه ${formatJalali(err.until, { withTime: true })}` });
    await run.log({
      source: run.job.provider === "claude" ? "claude" : "gemini",
      kind: "warning",
      title: `⏸ ${err.reason} — ادامه‌ی خودکار در ${formatJalali(err.until, { withTime: true })}`,
      data: { until: err.until.toISOString(), model: err.model },
    });
    return "paused";
  }

  const message = errorMessage(err);
  const attempts = run.job.attempts + 1;
  if (attempts >= run.job.max_attempts) {
    await release(run, { status: "failed", attempts, error: message, finished_at: new Date().toISOString(), locked_by: null, locked_until: null });
    await run.log({ source: "system", kind: "error", title: "کار پس از چند تلاش ناموفق ماند", detail: message });
    await h.onFail?.(run, message);
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
  await run.loadData();
  try {
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

/**
 * One worker invocation (called by pg_cron every ~30s and self-chained while work remains).
 * Claude/external jobs only need quick steps (dispatch / watchdog); Gemini jobs run one graph
 * node per step until the time budget is used.
 */
export async function runTick(): Promise<TickReport> {
  const started = Date.now();
  const deadline = started + env.workerBudgetMs;
  const workerId = `w-${randomId(6)}`;
  const outcomes: string[] = [];
  let more = false;

  await bumpProviderStats("system", { last_tick_at: new Date().toISOString() });

  for (let i = 0; i < 3 && Date.now() < deadline - 15_000; i++) {
    const job = await claim("claude", workerId, 90);
    if (!job) break;
    const o = await execute(job, workerId, Math.min(deadline, Date.now() + 45_000));
    outcomes.push(`${job.kind}:${o}`);
    if (o === "continue") more = true;
  }

  while (Date.now() < deadline - 12_000) {
    const lease = Math.ceil((deadline - Date.now()) / 1000) + 25;
    const job = await claim("gemini", workerId, lease);
    if (!job) {
      more = false;
      break;
    }
    const o = await execute(job, workerId, deadline);
    outcomes.push(`${job.kind}:${o}`);
    more = o === "continue";
    if (o === "paused" || o === "error") break;
  }

  await bumpProviderStats("gemini", { last_worker_at: new Date().toISOString() });
  return { worker: workerId, processed: outcomes.length, more, outcomes, ms: Date.now() - started };
}
