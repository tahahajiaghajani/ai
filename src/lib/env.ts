import { createHash } from "node:crypto";

/**
 * All environment access goes through here so that a missing variable produces a
 * clear Persian message in the setup page instead of a crash at import time.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  get supabaseUrl() {
    return read("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  },
  get supabaseAnonKey() {
    return read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
  },
  get supabaseServiceKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY") ?? read("SUPABASE_SECRET_KEY") ?? "";
  },
  get adminEmail() {
    return (read("ADMIN_EMAIL") ?? "").toLowerCase();
  },
  get geminiApiKey() {
    return read("GEMINI_API_KEY") ?? read("GOOGLE_API_KEY") ?? "";
  },
  get githubToken() {
    return read("GITHUB_TOKEN") ?? read("GH_TOKEN") ?? "";
  },
  get githubOwner() {
    return read("GITHUB_OWNER") ?? "";
  },
  get githubAppRepo() {
    return read("GITHUB_APP_REPO") ?? "ai";
  },
  get githubWorkspaceRepo() {
    return read("GITHUB_WORKSPACE_REPO") ?? "ai-workspace";
  },
  get cronSecret() {
    return read("CRON_SECRET") ?? "";
  },
  /** Secret shared with GitHub Actions runners; derived so the user only manages CRON_SECRET. */
  get runnerSecret() {
    const explicit = read("RUNNER_SECRET");
    if (explicit) return explicit;
    const base = read("CRON_SECRET");
    return base ? createHash("sha256").update(`${base}:taskflow-runner`).digest("hex") : "";
  },
  get appUrl() {
    const explicit = read("APP_URL");
    if (explicit) return explicit.replace(/\/$/, "");
    const prod = read("VERCEL_PROJECT_PRODUCTION_URL");
    if (prod) return `https://${prod}`;
    const url = read("VERCEL_URL");
    return url ? `https://${url}` : "";
  },
  get workerBudgetMs() {
    const s = Number(read("WORKER_BUDGET_SECONDS") ?? "50");
    return Math.max(15, Math.min(s, 780)) * 1000;
  },
};

export type EnvCheck = { key: string; label: string; ok: boolean; hint: string };

export function checkEnv(): EnvCheck[] {
  return [
    { key: "NEXT_PUBLIC_SUPABASE_URL", label: "آدرس Supabase", ok: !!env.supabaseUrl, hint: "Project Settings → API → Project URL" },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "کلید عمومی Supabase", ok: !!env.supabaseAnonKey, hint: "anon / publishable key" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", label: "کلید سرویس Supabase", ok: !!env.supabaseServiceKey, hint: "service_role / secret key" },
    { key: "ADMIN_EMAIL", label: "ایمیل مدیر", ok: !!env.adminEmail, hint: "ایمیلی که با آن وارد اپ اصلی می‌شوید" },
    { key: "GEMINI_API_KEY", label: "کلید Google AI Studio", ok: !!env.geminiApiKey, hint: "aistudio.google.com → Get API key" },
    { key: "GITHUB_TOKEN", label: "توکن GitHub", ok: !!env.githubToken, hint: "Personal access token با دسترسی repo و workflow" },
    { key: "CRON_SECRET", label: "رمز زمان‌بند", ok: !!env.cronSecret, hint: "یک رشته‌ی تصادفی طولانی" },
  ];
}
