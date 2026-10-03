import "server-only";
import { db } from "@/lib/supabase/admin";
import { logEvents, notify, notifyOwners, logEvent, type LogInput } from "@/lib/events";
import { mapClaudeEvent, type ClaudeStreamEvent } from "@/lib/claude/events";
import { detectClaudeLimit } from "@/lib/claude/limits";
import { getSystemSettings } from "@/lib/settings";
import { appRepo } from "@/lib/github/client";
import { formatJalali } from "@/lib/jalali";
import { completeExternalNode } from "@/lib/workflow/engine";
import type { Job, JobState, TodoItem, Upgrade } from "@/lib/types";

export type RunnerEvent =
  | { type: "run_started"; run_id: string | number; run_url?: string }
  | { type: "heartbeat" }
  | { type: "log"; level?: "info" | "warning" | "error"; title: string; detail?: string }
  | { type: "claude"; event: ClaudeStreamEvent }
  | {
      type: "result";
      status: "success" | "error" | "rate_limited";
      summary?: string;
      error?: string;
      session_id?: string | null;
      commit_sha?: string | null;
      commit_url?: string | null;
      branch?: string | null;
      pr_url?: string | null;
      pr_number?: number | null;
      files_changed?: string[];
    };

const SOURCE: Record<string, LogInput["source"]> = { main: "claude", upgrade: "claude", graphify: "graphify" };

/** Handle a batch of events posted by the GitHub Actions runner script. */
export async function ingestRunnerEvents(job: Job, events: RunnerEvent[]) {
  const source = SOURCE[job.kind] ?? "github";
  const logs: LogInput[] = [];
  let state: JobState = { ...(job.state ?? {}) };
  let stateDirty = false;
  const patch: Record<string, unknown> = { heartbeat_at: new Date().toISOString() };
  let sessionId: string | null = null;
  let lastResultText = "";

  const base = { task_id: job.task_id, upgrade_id: job.upgrade_id, job_id: job.id, source };

  for (const ev of events) {
    if (ev.type === "run_started") {
      patch.external_id = String(ev.run_id);
      patch.external_url = ev.run_url ?? null;
      state = { ...state, runner_status: "running", run_started_at: new Date().toISOString() };
      stateDirty = true;
      logs.push({ ...base, source: "github", kind: "log", title: "اجرا در GitHub Actions شروع شد", data: { url: ev.run_url } });
    } else if (ev.type === "log") {
      logs.push({ ...base, kind: ev.level === "error" ? "error" : ev.level === "warning" ? "warning" : "log", title: ev.title, detail: ev.detail ?? null });
    } else if (ev.type === "claude") {
      const m = mapClaudeEvent(ev.event);
      if (m.sessionId) sessionId = m.sessionId;
      if (m.todos) {
        state = { ...state, todos: m.todos as TodoItem[] };
        stateDirty = true;
      }
      if (m.model) {
        state = { ...state, live: { ...(state.live ?? {}), model: m.model } };
        stateDirty = true;
      }
      if (m.result) lastResultText = m.result.text;
      for (const l of m.logs) logs.push({ ...base, kind: l.kind, title: l.title, detail: l.detail ?? null, data: l.data ?? null });
      const lastTool = m.logs.filter((l) => l.kind === "tool" || l.kind === "file").pop();
      if (lastTool) {
        state = { ...state, live: { ...(state.live ?? {}), thought: lastTool.title, at: new Date().toISOString() } };
        stateDirty = true;
      }
    }
  }

  if (sessionId) state = { ...state, session_id: sessionId };
  if (stateDirty || sessionId) patch.state = state;
  // Keep the lease alive while the runner is talking to us.
  if (job.status === "running" && job.locked_by === "external") {
    patch.locked_until = new Date(Date.now() + 45 * 60_000).toISOString();
  }
  await db().from("jobs").update(patch).eq("id", job.id);
  job.state = state;
  await logEvents(logs);

  const result = events.find((e) => e.type === "result") as Extract<RunnerEvent, { type: "result" }> | undefined;
  if (result) await completeExternal(job, { ...result, session_id: result.session_id ?? sessionId ?? (state.session_id as string | undefined) ?? null, lastText: lastResultText });
}

async function finishJob(job: Job, status: "done" | "failed", result: Record<string, unknown>, error?: string) {
  await db()
    .from("jobs")
    .update({ status, result, error: error ?? null, finished_at: new Date().toISOString(), locked_by: null, locked_until: null })
    .eq("id", job.id);
}

export async function completeExternal(
  job: Job,
  r: Extract<RunnerEvent, { type: "result" }> & { lastText?: string },
) {
  const base = { task_id: job.task_id, upgrade_id: job.upgrade_id, job_id: job.id };

  // ---------------------------------------------------------------- rate limit
  const limit = r.status === "rate_limited" || r.status === "error" ? detectClaudeLimit(`${r.error ?? ""}\n${r.lastText ?? ""}\n${r.summary ?? ""}`) : null;
  if (job.kind !== "graphify" && (r.status === "rate_limited" || limit?.limited)) {
    const until = limit?.resetAt ?? new Date(Date.now() + 60 * 60_000);
    // the job waits (still holding the user's Actions slot) and resumes the same session
    await db()
      .from("jobs")
      .update({
        step: "dispatch",
        run_after: until.toISOString(),
        locked_by: null,
        locked_until: null,
        external_id: null,
        external_url: null,
        state: { ...(job.state ?? {}), runner_status: "rate_limited", session_id: r.session_id ?? job.state?.session_id ?? null },
      })
      .eq("id", job.id);
    if (r.session_id && job.task_id) await saveSession(job.task_id, r.session_id);
    await logEvent({
      ...base,
      source: "claude",
      kind: "warning",
      title: `⏸ Claude به سقف مصرف رسید؛ ادامه‌ی خودکار از همین نقطه در ${formatJalali(until, { withTime: true })}`,
      detail: limit?.message ?? r.error ?? null,
    });
    return;
  }

  // ---------------------------------------------------------------- per kind
  if (job.kind === "main") {
    if (r.status === "success") {
      const summary = r.lastText?.trim() || r.summary;
      // a workflow step: record it and let the queue run the rest of the workflow (and publish)
      if (r.session_id && job.task_id) await saveSession(job.task_id, r.session_id);
      if (await completeExternalNode(job, { ...r, summary })) {
        await logEvent({ ...base, source: "claude", kind: "result", title: "مرحله‌ی Claude Code تمام شد", detail: summary ?? null, data: { url: r.commit_url } });
        return;
      }
      await finishJob(job, "done", { summary: summary ?? null, commit_url: r.commit_url ?? null });
    } else {
      await handleExternalError(job, r.error ?? r.lastText ?? "خطای نامشخص");
    }
    return;
  }

  if (job.kind === "upgrade") {
    if (r.status === "success") {
      await finishJob(job, "done", { pr_url: r.pr_url, branch: r.branch, commit: r.commit_sha });
      const { data: up } = await db()
        .from("upgrades")
        .update({ status: r.pr_number ? "review" : "failed", pr_url: r.pr_url ?? null, pr_number: r.pr_number ?? null, branch: r.branch ?? null, summary: r.summary ?? null, files: r.files_changed ?? [] })
        .eq("id", job.upgrade_id)
        .select("*")
        .single<Upgrade>();
      await logEvent({ ...base, source: "claude", kind: "result", title: r.pr_number ? "ارتقا آماده‌ی بازبینی است (Pull Request ساخته شد)" : "ارتقا بدون تغییر تمام شد", detail: r.summary ?? null, data: { pr_url: r.pr_url } });
      const settings = await getSystemSettings();
      if (up && up.pr_number && (up.auto_merge || settings.upgrade.autoMerge)) {
        await mergeUpgrade(up);
      } else {
        await notifyOwners({ title: `ارتقای ${up?.code ?? ""} آماده‌ی بازبینی است`, body: r.summary?.slice(0, 200), link: "/upgrade" });
      }
    } else {
      await handleExternalError(job, r.error ?? r.lastText ?? "خطای نامشخص");
    }
    return;
  }

  if (job.kind === "graphify") {
    await finishJob(job, "done", { status: r.status, commit: r.commit_sha });
    if (r.status === "success" && job.project_id) await db().from("projects").update({ graph_at: new Date().toISOString() }).eq("id", job.project_id);
    await logEvent({
      ...base,
      source: "graphify",
      kind: r.status === "success" ? "result" : "warning",
      title: r.status === "success" ? "گراف فایل‌های پروژه (graphify) به‌روزرسانی شد" : "ساخت گراف graphify ناموفق بود",
      detail: r.summary ?? r.error ?? null,
    });
  }
}

async function saveSession(taskId: string, sessionId: string) {
  const { data: task } = await db().from("tasks").select("id, root_id").eq("id", taskId).single();
  const rootId = (task?.root_id as string) ?? taskId;
  await db().from("tasks").update({ claude_session_id: sessionId }).eq("id", rootId);
}

/** Watchdog saw a successful run without a callback. */
export async function finalizeFromWatchdog(job: Job) {
  if (job.kind === "main") await completeExternalNode(job, { summary: "اجرا در GitHub با موفقیت تمام شد (گزارش نهایی دریافت نشد)" });
  if (job.kind === "upgrade") await db().from("upgrades").update({ status: "review" }).eq("id", job.upgrade_id);
}

async function handleExternalError(job: Job, error: string) {
  const attempts = job.attempts + 1;
  const base = { task_id: job.task_id, upgrade_id: job.upgrade_id, job_id: job.id };
  if (attempts < Math.min(job.max_attempts, 3)) {
    await db()
      .from("jobs")
      .update({
        attempts,
        step: "dispatch",
        run_after: new Date(Date.now() + 3 * 60_000).toISOString(),
        locked_by: null,
        locked_until: null,
        external_id: null,
        external_url: null,
        error,
      })
      .eq("id", job.id);
    await logEvent({ ...base, source: "claude", kind: "warning", title: `اجرا با خطا تمام شد؛ تلاش دوباره (${attempts})`, detail: error.slice(0, 3000) });
    return;
  }
  await finishJob(job, "failed", {}, error);
  await logEvent({ ...base, source: "claude", kind: "error", title: "اجرا پس از چند تلاش ناموفق ماند", detail: error.slice(0, 3000) });
  if (job.kind === "main" && job.task_id) {
    await db().from("tasks").update({ status: "prework_done", progress: 50 }).eq("id", job.task_id);
    await notify(job.owner_id, { title: "خطا در کار اصلی (Claude Code)", body: error.slice(0, 200), link: `/tasks/${job.task_id}`, task_id: job.task_id });
  }
  if (job.kind === "upgrade") {
    await db().from("upgrades").update({ status: "failed", summary: error.slice(0, 2000) }).eq("id", job.upgrade_id);
    await notifyOwners({ title: "ارتقای اپ ناموفق بود", body: error.slice(0, 200), link: "/upgrade" });
  }
}

/** Merge an upgrade PR with the admin's token so Vercel deploys and migrations run. */
export async function mergeUpgrade(up: Upgrade) {
  if (!up.pr_number) throw new Error("Pull Request برای این ارتقا وجود ندارد");
  const app = await appRepo();
  await db().from("upgrades").update({ status: "merging" }).eq("id", up.id);
  try {
    await app.gh.rest.pulls.merge({ owner: app.owner, repo: app.repo, pull_number: up.pr_number, merge_method: "squash", commit_title: `${up.code}: ${up.title ?? "ارتقای خودکار"}` });
    await db().from("upgrades").update({ status: "merged", merged_at: new Date().toISOString() }).eq("id", up.id);
    await logEvent({ upgrade_id: up.id, source: "github", kind: "result", title: "ارتقا ادغام شد؛ Vercel نسخه‌ی جدید را منتشر می‌کند و migrationها اعمال می‌شوند" });
    await notifyOwners({ title: `ارتقای ${up.code} منتشر شد`, link: "/upgrade" });
  } catch (err) {
    await db().from("upgrades").update({ status: "review" }).eq("id", up.id);
    throw err;
  }
}
