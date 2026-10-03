import "server-only";
import { env, checkEnv } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { appRepo, listSecretNames, listWorkflowFiles, setRepoSecret } from "@/lib/github/client";
import type { Check } from "@/lib/github/bootstrap";

/** Owner: pg_cron calls the worker every few seconds and runs the daily maintenance. */
export async function configureScheduler(interval = "30 seconds") {
  if (!env.appUrl) throw new Error("آدرس اپ مشخص نیست (APP_URL)");
  if (!env.cronSecret) throw new Error("CRON_SECRET تنظیم نشده است");
  const { error } = await db().rpc("configure_scheduler", { p_app_url: env.appUrl, p_secret: env.cronSecret, p_interval: interval });
  if (error) throw new Error(`تنظیم زمان‌بند: ${error.message}`);
}

/** Owner: secrets of the app repository's self-upgrade runner (never stored by the app). */
export async function setAppSecrets(extra: { claudeToken?: string; anthropicKey?: string; dbUrl?: string } = {}) {
  const repo = await appRepo();
  const set: string[] = [];
  await setRepoSecret(repo, "TASKFLOW_RUNNER_SECRET", env.runnerSecret);
  set.push("TASKFLOW_RUNNER_SECRET");
  if (extra.claudeToken?.trim()) {
    await setRepoSecret(repo, "CLAUDE_CODE_OAUTH_TOKEN", extra.claudeToken.trim());
    set.push("CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (extra.anthropicKey?.trim()) {
    await setRepoSecret(repo, "ANTHROPIC_API_KEY", extra.anthropicKey.trim());
    set.push("ANTHROPIC_API_KEY");
  }
  if (extra.dbUrl?.trim()) {
    await setRepoSecret(repo, "SUPABASE_DB_URL", extra.dbUrl.trim());
    set.push("SUPABASE_DB_URL");
  }
  return set;
}

/** Owner: health of the shared parts (database, migrations, scheduler, app repository). */
export async function systemStatus(): Promise<{ checks: Check[]; env: ReturnType<typeof checkEnv> }> {
  const checks: Check[] = [];
  try {
    const { error } = await db().from("worker_lanes").select("lane").limit(1);
    checks.push({
      key: "supabase",
      label: "اتصال به Supabase و اسکیمای چندکاربره",
      ok: !error,
      detail: error ? `${error.message} — فایل supabase/migrations/20261003000000_multi_tenant.sql را در SQL Editor اجرا کنید` : undefined,
    });
  } catch (err) {
    checks.push({ key: "supabase", label: "اتصال به Supabase", ok: false, detail: (err as Error).message });
  }
  {
    const { error } = await db().from("profiles").select("avatar_url").limit(1);
    checks.push({ key: "migration-avatars", label: "به‌روزرسانی دیتابیس: تصویر پروفایل", ok: !error, level: "warning", detail: error ? "فایل supabase/migrations/20260926000000_avatars.sql را اجرا کنید" : undefined });
  }
  try {
    const { data, error } = await db().rpc("scheduler_status");
    const tick = (data ?? []).find((j: { jobname: string }) => j.jobname === "taskflow-tick") as { active: boolean } | undefined;
    const { data: lane } = await db().from("worker_lanes").select("stats").eq("lane", "system").maybeSingle();
    const lastTick = ((lane?.stats as Record<string, unknown> | undefined)?.last_tick_at as string | undefined) ?? null;
    const fresh = lastTick ? Date.now() - new Date(lastTick).getTime() < 5 * 60_000 : false;
    checks.push({
      key: "scheduler",
      label: "زمان‌بند (pg_cron) و ورکر",
      ok: !error && !!tick?.active && fresh,
      level: tick?.active ? "warning" : "error",
      detail: error?.message ?? (tick ? `آخرین اجرای ورکر: ${lastTick ?? "هنوز اجرا نشده"}` : "هنوز فعال نشده است"),
    });
  } catch (err) {
    checks.push({ key: "scheduler", label: "زمان‌بند (pg_cron) و ورکر", ok: false, detail: (err as Error).message });
  }
  if (env.githubToken) {
    try {
      const repo = await appRepo();
      const [wf, secrets] = await Promise.all([listWorkflowFiles(repo), listSecretNames(repo)]);
      checks.push({
        key: "app-repo",
        label: `مخزن اپ ${repo.owner}/${repo.repo} (ارتقای خودکار)`,
        ok: wf.includes("self-upgrade.yml") && secrets.includes("TASKFLOW_RUNNER_SECRET") && (secrets.includes("CLAUDE_CODE_OAUTH_TOKEN") || secrets.includes("ANTHROPIC_API_KEY")),
        level: "warning",
        detail: `ورکفلوها: ${wf.join("، ") || "—"} | secrets: ${secrets.join("، ") || "—"}`,
      });
    } catch (err) {
      checks.push({ key: "app-repo", label: "مخزن اپ (ارتقای خودکار)", ok: false, level: "warning", detail: (err as Error).message });
    }
  }
  return { checks, env: checkEnv() };
}
