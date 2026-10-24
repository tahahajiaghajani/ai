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
    return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  },
  get supabaseKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  },
  /** storage bucket of the uploaded pictures (created by the migration) */
  get bucket() {
    return process.env.SUPABASE_BUCKET || "celin-media";
  },
  /** optional break-glass login for /admin (the usual way in is an admin account, see ADMIN_PHONES) */
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || "";
  },
  /** mobile numbers (comma / space separated) whose accounts are admins: promoted on sign-up and sign-in */
  get adminPhones() {
    return process.env.ADMIN_PHONES || "";
  },
  /** self-hosted only: the header a trusted proxy puts the visitor's IP in (e.g. ar-real-ip behind ArvanCloud) */
  get trustedIpHeader() {
    return (process.env.TRUSTED_IP_HEADER || "").trim().toLowerCase();
  },
  /** signs sessions, hashes Pro codes and encrypts stored secrets; falls back to the service-role key */
  get appSecret() {
    return process.env.APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  },
  /** optional: the secret used before a rotation, so values encrypted with it stay readable */
  get appSecretPrevious() {
    return process.env.APP_SECRET_PREVIOUS || "";
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
