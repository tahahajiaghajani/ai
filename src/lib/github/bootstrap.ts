import "server-only";
import { env, checkEnv } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import {
  commitFiles,
  defaultBranch,
  ensureRepo,
  getFileText,
  gh,
  listSecretNames,
  listTree,
  listWorkflowFiles,
  repoExists,
  repoRef,
  setRepoSecret,
  tokenInfo,
  type CommitFile,
} from "@/lib/github/client";
import { genai } from "@/lib/ai/gemini";
import { getProvider } from "@/lib/queue/run";

/**
 * Version of `workspace-template/` (must equal `workspace-template/.github/taskflow-version`).
 * Bump it whenever the template changes: the workspace repo is re-synced before the next run.
 */
export const TEMPLATE_VERSION = "2026.09.26-1";

/** Re-sync the workspace repo when its runner files are older than this app version. */
export async function ensureWorkspaceTemplate(): Promise<"current" | "synced"> {
  const workspace = await repoRef("workspace");
  const current = (await getFileText(workspace, ".github/taskflow-version"))?.trim();
  if (current === TEMPLATE_VERSION) return "current";
  await syncWorkspaceTemplate();
  return "synced";
}

/** Copy `workspace-template/` from the app repo into the workspace repo (creating it if needed). */
export async function syncWorkspaceTemplate(): Promise<{ created: boolean; files: number; url: string }> {
  const app = await repoRef("app");
  const workspace = await repoRef("workspace");
  const created = await ensureRepo(workspace, "TaskFlow AI workspace — task outputs, knowledge base and Claude runners");

  const branch = process.env.VERCEL_GIT_COMMIT_REF || (await defaultBranch(app));
  let items = await listTree(app, "workspace-template", branch);
  if (!items.length && branch !== (await defaultBranch(app))) items = await listTree(app, "workspace-template");
  const blobs = items.filter((i) => i.type === "blob");
  if (!blobs.length) throw new Error(`پوشه‌ی workspace-template در مخزن ${app.repo} (شاخه‌ی ${branch}) پیدا نشد`);

  const files: CommitFile[] = [];
  for (const b of blobs) {
    const { data } = await gh().rest.git.getBlob({ ...app, file_sha: b.sha });
    files.push({ path: b.path.replace(/^workspace-template\//, ""), content: Buffer.from(data.content, "base64").toString("utf-8") });
  }
  files.push({ path: "tasks/.gitkeep", content: "" });
  const commit = await commitFiles(workspace, files, "[TaskFlow] همگام‌سازی قالب فضای کار");
  return { created, files: files.length, url: commit?.url ?? `https://github.com/${workspace.owner}/${workspace.repo}` };
}

export async function setWorkspaceSecrets(extra: { claudeToken?: string; anthropicKey?: string } = {}) {
  const ref = await repoRef("workspace");
  const set: string[] = [];
  if (!env.runnerSecret) throw new Error("CRON_SECRET تنظیم نشده است");
  await setRepoSecret(ref, "TASKFLOW_RUNNER_SECRET", env.runnerSecret);
  set.push("TASKFLOW_RUNNER_SECRET");
  if (env.appUrl) {
    await setRepoSecret(ref, "TASKFLOW_APP_URL", env.appUrl);
    set.push("TASKFLOW_APP_URL");
  }
  if (env.geminiApiKey) {
    await setRepoSecret(ref, "GEMINI_API_KEY", env.geminiApiKey);
    set.push("GEMINI_API_KEY");
  }
  if (extra.claudeToken?.trim()) {
    await setRepoSecret(ref, "CLAUDE_CODE_OAUTH_TOKEN", extra.claudeToken.trim());
    set.push("CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (extra.anthropicKey?.trim()) {
    await setRepoSecret(ref, "ANTHROPIC_API_KEY", extra.anthropicKey.trim());
    set.push("ANTHROPIC_API_KEY");
  }
  return set;
}

export async function setAppSecrets(extra: { claudeToken?: string; anthropicKey?: string; dbUrl?: string } = {}) {
  const ref = await repoRef("app");
  const set: string[] = [];
  await setRepoSecret(ref, "TASKFLOW_RUNNER_SECRET", env.runnerSecret);
  set.push("TASKFLOW_RUNNER_SECRET");
  if (extra.claudeToken?.trim()) {
    await setRepoSecret(ref, "CLAUDE_CODE_OAUTH_TOKEN", extra.claudeToken.trim());
    set.push("CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (extra.anthropicKey?.trim()) {
    await setRepoSecret(ref, "ANTHROPIC_API_KEY", extra.anthropicKey.trim());
    set.push("ANTHROPIC_API_KEY");
  }
  if (extra.dbUrl?.trim()) {
    await setRepoSecret(ref, "SUPABASE_DB_URL", extra.dbUrl.trim());
    set.push("SUPABASE_DB_URL");
  }
  return set;
}

export async function configureScheduler(interval = "30 seconds") {
  if (!env.appUrl) throw new Error("آدرس اپ مشخص نیست (APP_URL)");
  if (!env.cronSecret) throw new Error("CRON_SECRET تنظیم نشده است");
  const { error } = await db().rpc("configure_scheduler", { p_app_url: env.appUrl, p_secret: env.cronSecret, p_interval: interval });
  if (error) throw new Error(`تنظیم زمان‌بند: ${error.message}`);
}

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
  level?: "error" | "warning";
}

export async function integrationStatus(): Promise<{ checks: Check[]; env: ReturnType<typeof checkEnv> }> {
  const checks: Check[] = [];
  const envChecks = checkEnv();

  // Supabase
  try {
    const { error } = await db().from("provider_state").select("provider").limit(1);
    checks.push({ key: "supabase", label: "اتصال به Supabase و اسکیمای دیتابیس", ok: !error, detail: error?.message });
  } catch (err) {
    checks.push({ key: "supabase", label: "اتصال به Supabase و اسکیمای دیتابیس", ok: false, detail: (err as Error).message });
  }

  // Later migrations (run in the SQL Editor when SUPABASE_DB_URL is not set for automatic migrations)
  {
    const { error } = await db().from("profiles").select("avatar_url").limit(1);
    checks.push({
      key: "migration-avatars",
      label: "به‌روزرسانی دیتابیس: تصویر پروفایل",
      ok: !error,
      level: "warning",
      detail: error ? "فایل supabase/migrations/20260926000000_avatars.sql را یک بار در SQL Editor سوپابیس اجرا کنید" : undefined,
    });
  }

  // Scheduler
  try {
    const { data, error } = await db().rpc("scheduler_status");
    const tick = (data ?? []).find((j: { jobname: string }) => j.jobname === "taskflow-tick") as { active: boolean; last_status: string | null; last_run: string | null } | undefined;
    const sys = await getProvider("system");
    const lastTick = (sys?.stats?.last_tick_at as string | undefined) ?? null;
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

  // Gemini
  if (env.geminiApiKey) {
    try {
      const pager = await genai().models.list({ config: { pageSize: 5 } });
      checks.push({ key: "gemini", label: "کلید Google AI Studio (Gemini)", ok: !!pager.page.length });
    } catch (err) {
      checks.push({ key: "gemini", label: "کلید Google AI Studio (Gemini)", ok: false, detail: (err as Error).message.slice(0, 200) });
    }
  }

  // GitHub
  if (env.githubToken) {
    const info = await tokenInfo();
    checks.push({
      key: "github",
      label: "توکن GitHub",
      ok: !!info,
      detail: info ? `کاربر ${info.login}${info.scopes.length ? ` — دسترسی‌ها: ${info.scopes.join(", ")}` : ""}` : "توکن نامعتبر است",
    });
    if (info) {
      const ws = await repoRef("workspace");
      const exists = await repoExists(ws);
      const wf = exists ? await listWorkflowFiles(ws) : [];
      const secrets = exists ? await listSecretNames(ws) : [];
      checks.push({
        key: "workspace",
        label: `مخزن کاری ${ws.owner}/${ws.repo}`,
        ok: exists && wf.includes("claude-task.yml"),
        detail: !exists ? "ساخته نشده" : wf.includes("claude-task.yml") ? `ورکفلوها: ${wf.join("، ")}` : "قالب همگام نشده",
      });
      const hasClaude = secrets.includes("CLAUDE_CODE_OAUTH_TOKEN") || secrets.includes("ANTHROPIC_API_KEY");
      checks.push({
        key: "workspace-secrets",
        label: "secrets مخزن کاری (runner و Claude)",
        ok: secrets.includes("TASKFLOW_RUNNER_SECRET") && hasClaude,
        detail: secrets.length ? secrets.join("، ") : "هیچ secret تنظیم نشده",
      });
      const app = await repoRef("app");
      const appSecrets = await listSecretNames(app);
      const appWf = await listWorkflowFiles(app);
      checks.push({
        key: "app-repo",
        label: `مخزن اپ ${app.owner}/${app.repo} (ارتقای خودکار)`,
        ok: appWf.includes("self-upgrade.yml") && appSecrets.includes("TASKFLOW_RUNNER_SECRET") && (appSecrets.includes("CLAUDE_CODE_OAUTH_TOKEN") || appSecrets.includes("ANTHROPIC_API_KEY")),
        level: "warning",
        detail: `ورکفلوها: ${appWf.join("، ") || "—"} | secrets: ${appSecrets.join("، ") || "—"}`,
      });
    }
  }

  return { checks, env: envChecks };
}
