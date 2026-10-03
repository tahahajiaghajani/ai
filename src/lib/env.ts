import { createHash } from "node:crypto";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

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
    return normalizeSupabaseUrl(read("NEXT_PUBLIC_SUPABASE_URL"));
  },
  get supabaseAnonKey() {
    return read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
  },
  get supabaseServiceKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY") ?? read("SUPABASE_SECRET_KEY") ?? "";
  },
  /** The app owner (manages Vercel/Supabase settings, users and upgrades). ADMIN_EMAIL is the old name. */
  get ownerEmail() {
    return (read("OWNER_EMAIL") ?? read("ADMIN_EMAIL") ?? "").toLowerCase();
  },
  /** Owner-only: token for the app repository itself (self-upgrade). Users connect their own GitHub in the app. */
  get githubToken() {
    return read("GITHUB_TOKEN") ?? read("GH_TOKEN") ?? "";
  },
  /** Key that encrypts users' API keys and tokens in the database (falls back to one derived from the service key). */
  get appSecretKey() {
    return read("APP_SECRET_KEY") ?? "";
  },
  /** Public page with the install guide ("full experience" link); defaults to the app repository on GitHub. */
  get guideUrl() {
    const explicit = read("APP_GUIDE_URL");
    if (explicit) return explicit;
    const owner = read("GITHUB_OWNER");
    return owner ? `https://github.com/${owner}/${read("GITHUB_APP_REPO") ?? "ai"}/blob/main/docs/SETUP_USER_FA.md` : "";
  },
  get githubOwner() {
    return read("GITHUB_OWNER") ?? "";
  },
  get githubAppRepo() {
    return read("GITHUB_APP_REPO") ?? "ai";
  },
  /** Default name of each user's own workspace repository (created in their GitHub account). */
  get workspaceRepoName() {
    return read("WORKSPACE_REPO_NAME") ?? "taskflow-workspace";
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
    // Vercel Hobby with Fluid compute allows 300s per function; keep a safety margin
    const s = Number(read("WORKER_BUDGET_SECONDS") ?? "240");
    return Math.max(15, Math.min(s, 780)) * 1000;
  },
};

export type EnvCheck = { key: string; label: string; ok: boolean; hint: string; optional?: boolean };

export function checkEnv(): EnvCheck[] {
  return [
    { key: "NEXT_PUBLIC_SUPABASE_URL", label: "آدرس Supabase", ok: !!env.supabaseUrl, hint: "Project URL — فقط https://<ref>.supabase.co (بدون ‎/rest/v1)" },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "کلید عمومی Supabase", ok: !!env.supabaseAnonKey, hint: "anon / publishable key" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", label: "کلید سرویس Supabase", ok: !!env.supabaseServiceKey, hint: "service_role / secret key" },
    { key: "OWNER_EMAIL", label: "ایمیل مالک اپ", ok: !!env.ownerEmail, hint: "ایمیلی که مالک اپ با آن وارد می‌شود (نام قدیمی: ADMIN_EMAIL)" },
    { key: "CRON_SECRET", label: "رمز زمان‌بند", ok: !!env.cronSecret, hint: "یک رشته‌ی تصادفی طولانی" },
    { key: "APP_SECRET_KEY", label: "کلید رمزنگاری کلیدهای کاربران", ok: !!env.appSecretKey, hint: "یک رشته‌ی تصادفی طولانی (۳۲+ کاراکتر)؛ بدون آن از کلید سرویس Supabase مشتق می‌شود", optional: true },
    { key: "GITHUB_TOKEN", label: "توکن GitHub مخزن اپ (فقط ارتقای خودکار)", ok: !!env.githubToken, hint: "اختیاری — فقط برای بخش «ارتقای اپلیکیشن» مالک", optional: true },
  ];
}
