/**
 * Supabase clients need the bare project URL (https://<ref>.supabase.co) and append
 * /auth/v1, /rest/v1… themselves. Pasting the REST endpoint (…/rest/v1) or a dashboard
 * link makes every call fail with "Invalid path specified in request URL", so the value
 * from the environment is normalized before use. Safe for server, proxy and browser.
 */
export function normalizeSupabaseUrl(raw: string | null | undefined): string {
  let v = (raw ?? "").trim().replace(/^['"]+|['"]+$/g, "").trim();
  if (!v) return "";
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(v)) v = `https://${v}`;

  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return v.replace(/\/+$/, "");
  }

  // Dashboard link: https://supabase.com/dashboard/project/<ref>/settings/api
  const dash = /^(?:app\.)?supabase\.com$/i.test(u.hostname) ? u.pathname.match(/\/project\/([a-z0-9]{20})(?:\/|$)/i) : null;
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;

  // Hosted projects never have a path.
  if (/\.supabase\.co$/i.test(u.hostname)) return u.origin;

  // Self-hosted (possibly behind a path prefix): drop only service endpoints and trailing slashes.
  const path = u.pathname.replace(/\/(?:rest|auth|storage|realtime|functions|graphql)\/v1(?:\/.*)?$/i, "").replace(/\/+$/, "");
  return `${u.origin}${path}`;
}
