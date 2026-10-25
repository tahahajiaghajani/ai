import "server-only";

/** Environment is read lazily so the build works without any variables. */
export const env = {
  get siteUrl(): string {
    const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    if (explicit) return explicit;
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return vercel ? `https://${vercel}` : "http://localhost:3000";
  },
  /** fine-grained token for the private data repository (requests, settings, extra knowledge) */
  get githubToken() {
    return (process.env.GITHUB_TOKEN || "").trim();
  },
  /** the private data repository as owner/name (a full github.com URL is accepted too) */
  get githubRepo() {
    return (process.env.GITHUB_REPO || "")
      .trim()
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
  },
  /** the GitHub API (GitHub Enterprise Server, or a local mock in tests); default https://api.github.com */
  get githubApi() {
    return (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  },
  /** the hidden inbox at /admin */
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || "";
  },
  /** encrypts the keys saved in the panel and signs the admin session and tracking links */
  get appSecret() {
    return process.env.APP_SECRET || "";
  },
  /** the secret before a rotation, so keys saved with it can still be read */
  get appSecretPrevious() {
    return process.env.APP_SECRET_PREVIOUS || "";
  },
  /** Google AI Studio key; a key saved in the panel (Connections) takes precedence */
  get geminiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  },
  /** optional: models tried before the built-in free chain, comma separated (the panel's list takes precedence) */
  get geminiModels(): string[] {
    return (process.env.GEMINI_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  },
  /** AI calls per day for each server instance (chat + triage); default 1000 */
  get aiDailyLimit(): number {
    const n = Math.round(Number(process.env.AI_DAILY_LIMIT));
    return Number.isFinite(n) && n >= 1 ? n : 1000;
  },
  /** optional Telegram (or Bale) bot; a bot saved in the panel takes precedence */
  get telegramToken() {
    return process.env.TELEGRAM_BOT_TOKEN || "";
  },
  get telegramChatId() {
    return process.env.TELEGRAM_CHAT_ID || "";
  },
  /** "bale" sends through Bale's Bot API (same protocol) instead of Telegram */
  get telegramChannel(): "telegram" | "bale" {
    return process.env.TELEGRAM_API === "bale" ? "bale" : "telegram";
  },
};
