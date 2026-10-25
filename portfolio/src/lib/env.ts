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
  /** the hidden inbox at /admin */
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || "";
  },
  /** signs the admin session and ticket links; falls back to the service-role key */
  get appSecret() {
    return process.env.APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  },
  /** Google AI Studio key (free tier) for the assistant and ticket triage */
  get geminiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  },
  /** optional: models tried before the built-in free chain, comma separated */
  get geminiModels(): string[] {
    return (process.env.GEMINI_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  },
  /** AI calls per day shared by every visitor (chat + triage); default 1000 */
  get aiDailyLimit(): number {
    const n = Math.round(Number(process.env.AI_DAILY_LIMIT));
    return Number.isFinite(n) && n >= 1 ? n : 1000;
  },
  /** optional Telegram (or Bale) bot that receives every new request */
  get telegramToken() {
    return process.env.TELEGRAM_BOT_TOKEN || "";
  },
  get telegramChatId() {
    return process.env.TELEGRAM_CHAT_ID || "";
  },
  /** "bale" sends through Bale's Bot API (same protocol) instead of Telegram */
  get telegramApi() {
    return process.env.TELEGRAM_API === "bale" ? "https://tapi.bale.ai" : "https://api.telegram.org";
  },
  /** optional: protects the daily keep-alive cron (Vercel sends it as a Bearer token) */
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
};
