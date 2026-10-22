import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { assertAdmin } from "@/lib/admin-auth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettingsFresh } from "@/lib/settings";
import { DEFAULT_SETTINGS, type ProviderId, type Settings } from "@/lib/settings-types";

export type Status = "ok" | "warn" | "error" | "off";

export interface DbObject {
  name: string;
  kind: "table" | "function";
  file: string;
  ok: boolean;
}

export interface ConnectionReport {
  checkedAt: string;
  supabase: { status: Status; urlSet: boolean; keySet: boolean; reachable: boolean; error: string; projectRef: string; objects: DbObject[]; missingFiles: string[] };
  security: { status: Status; appSecret: "own" | "fallback" | "missing"; previous: boolean };
  ai: { status: Status; enabled: boolean; provider: ProviderId; model: string; keySource: "panel" | "env" | "none"; keyHint: string };
  notify: { status: Status; channel: Settings["notify"]["channel"]; hasToken: boolean; chatId: boolean };
  email: { status: Status; source: "panel" | "env" | "none"; from: string; keyHint: string };
  site: { status: Status; configured: string; current: string; explicit: boolean };
  keepalive: { status: Status; lastAt: string | null; cronSecret: boolean };
}

const SITE = "20261022090000_pars_site.sql";
/** Every database object the site needs and the migration file that creates it. */
const OBJECTS: Omit<DbObject, "ok">[] = [
  { name: "pars_settings", kind: "table", file: SITE },
  { name: "pars_knowledge", kind: "table", file: SITE },
  { name: "pars_demos", kind: "table", file: SITE },
  { name: "pars_tickets", kind: "table", file: SITE },
  { name: "pars_ticket_messages", kind: "table", file: SITE },
  { name: "pars_chat_logs", kind: "table", file: SITE },
  { name: "pars_rate_limits", kind: "table", file: SITE },
  { name: "pars_hit_rate_limit", kind: "function", file: SITE },
  { name: "pars_admin_counts", kind: "function", file: "20261022120000_pars_admin_counts.sql" },
  { name: "pars_posts", kind: "table", file: "20261022140000_pars_posts.sql" },
  { name: "pars_profiles", kind: "table", file: "20261022160000_pars_accounts.sql" },
];

/** Project ref from https://<ref>.supabase.co (for the SQL editor link). */
function projectRef(url: string): string {
  return /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(url)?.[1] ?? "";
}

async function checkObject(o: Omit<DbObject, "ok">): Promise<DbObject> {
  const c = db()!;
  // GET, not HEAD: a HEAD 404 has no body, so postgrest-js reports a missing table as success
  const r =
    o.kind === "table"
      ? await c.from(o.name).select("*").limit(0)
      : o.name === "pars_admin_counts"
        ? await c.rpc("pars_admin_counts", { p_open: [] })
        : await c.rpc("pars_hit_rate_limit", { p_key: "probe:connections", p_window: 60, p_max: 1000000 });
  return { ...o, ok: !r.error };
}

async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

/** Live status of everything the site depends on (admin only). */
export async function connectionReport(): Promise<ConnectionReport> {
  await assertAdmin();
  const urlSet = Boolean(env.supabaseUrl);
  const keySet = Boolean(env.supabaseKey);
  const c = db();

  let reachable = false;
  let error = "";
  let objects: DbObject[] = OBJECTS.map((o) => ({ ...o, ok: false }));
  let s: Settings = DEFAULT_SETTINGS;
  let keepaliveAt: string | null = null;
  if (c) {
    const ping = await c.from("pars_settings").select("key, value");
    // a missing table still proves the URL and key work; a network/auth failure does not
    reachable = !ping.error || ["42P01", "PGRST205"].includes(ping.error.code ?? "");
    if (ping.error && !reachable) error = ping.error.message.slice(0, 200);
    if (reachable) objects = await Promise.all(OBJECTS.map(checkObject));
    if (!ping.error) {
      s = await getSettingsFresh().catch(() => DEFAULT_SETTINGS);
      const k = (ping.data as { key: string; value: { at?: string } }[]).find((r) => r.key === "keepalive");
      keepaliveAt = k?.value?.at ?? null;
    }
  }
  const missing = objects.filter((o) => !o.ok);
  const missingFiles = [...new Set(missing.map((o) => o.file))].sort();
  const supabaseStatus: Status = !urlSet || !keySet || !reachable ? "error" : missing.some((o) => o.file === SITE) ? "error" : missing.length ? "warn" : "ok";

  const appSecret = process.env.APP_SECRET ? "own" : env.supabaseKey ? "fallback" : "missing";

  const panelKey = Boolean(s.ai.apiKeyEnc && decrypt(s.ai.apiKeyEnc));
  // without a usable panel key the runtime falls back to GEMINI_API_KEY for any provider (runtime.ts)
  const keySource = panelKey ? "panel" : env.geminiKey ? "env" : "none";

  const n = s.notify;
  const hasToken = Boolean(n.botTokenEnc && decrypt(n.botTokenEnc));
  const notifyStatus: Status = n.channel === "none" ? "off" : hasToken && n.chatId ? "ok" : "warn";

  const panelMail = Boolean(s.email.resendKeyEnc && decrypt(s.email.resendKeyEnc));
  const emailSource = panelMail ? "panel" : env.resendKey ? "env" : "none";
  const from = s.email.mailFrom || env.mailFrom;

  const configured = env.siteUrl;
  const current = await currentOrigin();
  const explicit = Boolean(process.env.NEXT_PUBLIC_SITE_URL);

  const day = 86400_000;
  const age = keepaliveAt ? Date.now() - new Date(keepaliveAt).getTime() : Infinity;

  return {
    checkedAt: new Date().toISOString(),
    supabase: { status: supabaseStatus, urlSet, keySet, reachable, error, projectRef: projectRef(env.supabaseUrl), objects, missingFiles },
    security: { status: appSecret === "own" ? "ok" : appSecret === "fallback" ? "warn" : "error", appSecret, previous: Boolean(process.env.APP_SECRET_PREVIOUS) },
    ai: { status: !s.ai.enabled ? "off" : keySource === "none" ? "error" : "ok", enabled: s.ai.enabled, provider: s.ai.provider, model: s.ai.model, keySource, keyHint: panelKey ? (s.ai.apiKeyHint ?? "") : "" },
    notify: { status: notifyStatus, channel: n.channel, hasToken, chatId: Boolean(n.chatId) },
    email: { status: emailSource === "none" ? "off" : from ? "ok" : "warn", source: emailSource, from, keyHint: panelMail ? (s.email.resendKeyHint ?? "") : "" },
    site: { status: !explicit ? "warn" : current && new URL(configured).host !== new URL(current).host ? "warn" : "ok", configured, current, explicit },
    keepalive: { status: age < 2 * day ? "ok" : keepaliveAt ? "warn" : "off", lastAt: keepaliveAt, cronSecret: Boolean(env.cronSecret) },
  };
}

/** The SQL to paste into Supabase: the files that create missing objects, or every migration when nothing is missing. */
export async function migrationSql(files: string[]): Promise<{ name: string; sql: string }[]> {
  await assertAdmin();
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const all = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".sql")).sort();
  const wanted = files.length ? all.filter((f) => files.includes(f)) : all;
  return Promise.all(wanted.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), "utf8") })));
}
