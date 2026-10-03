import "server-only";
import { env } from "@/lib/env";
import { runnerTokenFor } from "@/lib/crypto";
import { getConnection, githubConnection, listConnections, patchConnectionConfig, saveGithubConnection, type GithubConfig } from "@/lib/connections";
import {
  commitFiles,
  ensureRepo,
  getFileText,
  listSecretNames,
  listWorkflowFiles,
  octokitFor,
  repoExists,
  setRepoSecret,
  deleteRepoSecret,
  tokenInfo,
  userRepo,
  type CommitFile,
  type Repo,
} from "@/lib/github/client";
import { TEMPLATE_FILES } from "@/lib/github/template.generated";

/**
 * Version of `workspace-template/` (must equal `workspace-template/.github/taskflow-version`).
 * Bump it whenever the template changes: users' repos are re-synced before their next run.
 */
export const TEMPLATE_VERSION = "2026.10.03-2";

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Connects a user's GitHub: checks the token, creates (or reuses) their private workspace repository,
 * copies the runner template into it and sets the Actions secrets the runner needs.
 */
export async function connectGithub(userId: string, token: string, repoName?: string): Promise<{ repo: string; created: boolean; url: string }> {
  const info = await tokenInfo(token.trim());
  if (!info) throw new Error("توکن GitHub نامعتبر است یا منقضی شده");
  const name = (repoName?.trim() || env.workspaceRepoName).replace(/^.*\//, "");
  if (!REPO_NAME.test(name)) throw new Error("نام مخزن فقط می‌تواند حروف لاتین، عدد، نقطه، - و _ داشته باشد");
  const owner = repoName?.includes("/") ? repoName.split("/")[0].trim() : info.login;
  await saveGithubConnection(userId, token, { login: info.login, owner, repo: name, scopes: info.scopes });
  const r: Repo = { gh: octokitFor(token.trim()), owner, repo: name };
  let created = false;
  try {
    created = await ensureRepo(r, "Task Flow — فضای کار شخصی: پروژه‌ها، دانش و خروجی کارها");
  } catch (err) {
    throw new Error(`ساخت مخزن ${owner}/${name} ممکن نشد (${(err as Error).message}). یا به توکن دسترسی ساخت مخزن بدهید، یا خودتان یک مخزن خصوصی خالی با همین نام بسازید و دوباره وصل کنید.`);
  }
  await syncTemplate(userId);
  await setRunnerSecrets(userId);
  return { repo: `${owner}/${name}`, created, url: `https://github.com/${owner}/${name}` };
}

/** Copies the bundled template into the user's repository. */
export async function syncTemplate(userId: string): Promise<number> {
  const r = await userRepo(userId);
  const files: CommitFile[] = TEMPLATE_FILES.map((f) => ({ path: f.path, content: f.content }));
  await commitFiles(r, files, "[TaskFlow] همگام‌سازی قالب فضای کار");
  const conn = await githubConnection(userId);
  if (conn) await patchConnectionConfig(conn.id, { templateVersion: TEMPLATE_VERSION });
  return files.length;
}

/** Re-sync the template when the app has a newer version than the user's repository. */
export async function ensureTemplate(userId: string): Promise<"current" | "synced"> {
  const conn = await githubConnection(userId);
  if ((conn?.config as GithubConfig | undefined)?.templateVersion === TEMPLATE_VERSION) return "current";
  const r = await userRepo(userId);
  const current = (await getFileText(r, ".github/taskflow-version"))?.trim();
  if (current === TEMPLATE_VERSION) {
    if (conn) await patchConnectionConfig(conn.id, { templateVersion: TEMPLATE_VERSION });
    return "current";
  }
  await syncTemplate(userId);
  return "synced";
}

/** The runner's own token (bound to this user) and the app address. */
export async function setRunnerSecrets(userId: string) {
  const r = await userRepo(userId);
  await setRepoSecret(r, "TASKFLOW_RUNNER_SECRET", runnerTokenFor(userId));
  if (env.appUrl) await setRepoSecret(r, "TASKFLOW_APP_URL", env.appUrl);
}

/**
 * Lets Claude Code run in the user's GitHub Actions: a Claude subscription token
 * (`claude setup-token`), an Anthropic API key, or the key of one of their Anthropic connections.
 */
export async function setClaudeSecret(userId: string, input: { oauthToken?: string; apiKey?: string; connectionId?: string }) {
  const r = await userRepo(userId);
  let apiKey = input.apiKey?.trim();
  if (!apiKey && input.connectionId) {
    const c = await getConnection(input.connectionId, userId);
    if (c.provider !== "anthropic") throw new Error("فقط کلید Anthropic برای Claude Code قابل استفاده است");
    apiKey = c.secret;
  }
  const oauth = input.oauthToken?.trim();
  if (!oauth && !apiKey) throw new Error("توکن Claude یا کلید API را وارد کنید");
  if (oauth) {
    await setRepoSecret(r, "CLAUDE_CODE_OAUTH_TOKEN", oauth);
    await deleteRepoSecret(r, "ANTHROPIC_API_KEY");
  } else if (apiKey) {
    await setRepoSecret(r, "ANTHROPIC_API_KEY", apiKey);
    await deleteRepoSecret(r, "CLAUDE_CODE_OAUTH_TOKEN");
  }
  const conn = await githubConnection(userId);
  if (conn) await patchConnectionConfig(conn.id, { claudeCode: true });
}

export async function removeClaudeSecret(userId: string) {
  const r = await userRepo(userId);
  await deleteRepoSecret(r, "CLAUDE_CODE_OAUTH_TOKEN");
  await deleteRepoSecret(r, "ANTHROPIC_API_KEY");
  const conn = await githubConnection(userId);
  if (conn) await patchConnectionConfig(conn.id, { claudeCode: false });
}

/** graphify in Actions uses the user's Google key to map documents (code is mapped without a key). */
export async function setGraphifySecret(userId: string) {
  const r = await userRepo(userId);
  const google = (await listConnections(userId)).find((c) => c.kind === "ai" && c.provider === "google");
  if (!google) return false;
  const c = await getConnection(google.id, userId);
  await setRepoSecret(r, "GEMINI_API_KEY", c.secret);
  const conn = await githubConnection(userId);
  if (conn) await patchConnectionConfig(conn.id, { geminiSecret: true });
  return true;
}

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
  level?: "error" | "warning";
}

/** Health of a user's GitHub setup (settings page). */
export async function workspaceStatus(userId: string): Promise<Check[]> {
  const conn = await githubConnection(userId);
  if (!conn) return [{ key: "github", label: "GitHub", ok: false, detail: "وصل نیست", level: "warning" }];
  const cfg = conn.config as GithubConfig;
  const checks: Check[] = [];
  const info = await tokenInfo(conn.secret);
  checks.push({ key: "token", label: "توکن GitHub", ok: !!info, detail: info ? `کاربر ${info.login}${info.scopes.length ? ` — دسترسی‌ها: ${info.scopes.join(", ")}` : ""}` : "نامعتبر یا منقضی" });
  if (!info || !cfg.owner || !cfg.repo) return checks;
  const r: Repo = { gh: octokitFor(conn.secret), owner: cfg.owner, repo: cfg.repo };
  const exists = await repoExists(r);
  const workflows = exists ? await listWorkflowFiles(r) : [];
  checks.push({
    key: "repo",
    label: `مخزن ${cfg.owner}/${cfg.repo}`,
    ok: exists && workflows.includes("claude-task.yml"),
    detail: !exists ? "ساخته نشده" : workflows.length ? `ورکفلوها: ${workflows.join("، ")}` : "قالب همگام نشده",
  });
  const secrets = exists ? await listSecretNames(r) : [];
  checks.push({ key: "runner", label: "اتصال runner به اپ", ok: secrets.includes("TASKFLOW_RUNNER_SECRET"), detail: secrets.length ? secrets.join("، ") : "secretی تنظیم نشده" });
  checks.push({
    key: "claude",
    label: "Claude Code در GitHub Actions",
    ok: secrets.includes("CLAUDE_CODE_OAUTH_TOKEN") || secrets.includes("ANTHROPIC_API_KEY"),
    level: "warning",
    detail: "اختیاری — برای اجرای کار اصلی با Claude Code",
  });
  return checks;
}
