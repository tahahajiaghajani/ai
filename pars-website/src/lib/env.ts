import "server-only";

/** Environment is read lazily so the build works without any variables. */
export const env = {
  get siteUrl(): string {
    const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    if (explicit) return explicit;
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return vercel ? `https://${vercel}` : "http://localhost:3000";
  },
  get supabaseUrl() {
    return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  },
  get supabaseKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || "";
  },
  /** signs sessions and encrypts stored API keys; falls back to the service-role key */
  get appSecret() {
    return process.env.APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  },
  get geminiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  },
  get resendKey() {
    return process.env.RESEND_API_KEY || "";
  },
  get mailFrom() {
    return process.env.MAIL_FROM || "";
  },
  /** optional: protects the daily keep-alive cron (Vercel sends it as a Bearer token) */
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
};
