import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto";
import { providerPreset, type ProviderId } from "@/lib/ai/providers";

export type ConnectionKind = "ai" | "github";

export interface GithubConfig {
  login?: string;
  /** owner/repo of the user's workspace repository */
  owner?: string;
  repo?: string;
  scopes?: string[];
  /** runner files were copied into the repo (template version) */
  templateVersion?: string;
  /** Claude Code can run in the user's GitHub Actions (a Claude secret is set) */
  claudeCode?: boolean;
  /** graphify can use the user's Gemini key in Actions */
  geminiSecret?: boolean;
}

export interface AiConfig {
  /** models read from the provider (cached for the settings UI) */
  models?: string[];
  modelsAt?: string;
  /** extra models tried when the chosen one is busy or out of quota */
  fallbacks?: string[];
}

export interface ConnectionRow {
  id: string;
  user_id: string;
  kind: ConnectionKind;
  provider: string;
  label: string;
  base_url: string | null;
  secret_enc: string;
  secret_hint: string | null;
  config: Record<string, unknown>;
  status: "unchecked" | "ok" | "error";
  last_error: string | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What the UI may see (never the secret). */
export type PublicConnection = Omit<ConnectionRow, "secret_enc">;

/** A connection with its decrypted secret (server only). */
export interface Connection extends PublicConnection {
  secret: string;
}

const PUBLIC_COLUMNS = "id, user_id, kind, provider, label, base_url, secret_hint, config, status, last_error, checked_at, created_at, updated_at";

export async function listConnections(userId: string): Promise<PublicConnection[]> {
  const { data } = await db().from("user_connections").select(PUBLIC_COLUMNS).eq("user_id", userId).order("created_at");
  return (data ?? []) as PublicConnection[];
}

function open(row: ConnectionRow): Connection {
  const { secret_enc, ...rest } = row;
  return { ...rest, secret: decryptSecret(secret_enc) };
}

/** A connection by id (optionally checking that it belongs to the user). */
export async function getConnection(id: string, userId?: string): Promise<Connection> {
  let q = db().from("user_connections").select("*").eq("id", id);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q.maybeSingle<ConnectionRow>();
  if (!data) throw new Error("اتصال پیدا نشد (شاید حذف شده است)؛ در «تنظیمات ← اتصال‌ها» دوباره انتخاب کنید");
  return open(data);
}

export async function githubConnection(userId: string): Promise<Connection | null> {
  const { data } = await db().from("user_connections").select("*").eq("user_id", userId).eq("kind", "github").maybeSingle<ConnectionRow>();
  return data ? open(data) : null;
}

/** GitHub connection info without decrypting the token (cheap; for capability checks). */
export async function githubInfo(userId: string): Promise<(PublicConnection & { config: GithubConfig }) | null> {
  const { data } = await db().from("user_connections").select(PUBLIC_COLUMNS).eq("user_id", userId).eq("kind", "github").maybeSingle();
  return (data as (PublicConnection & { config: GithubConfig }) | null) ?? null;
}

export async function saveAiConnection(
  userId: string,
  input: { id?: string | null; provider: ProviderId; label?: string; baseUrl?: string | null; apiKey?: string; config?: AiConfig },
): Promise<PublicConnection> {
  const preset = providerPreset(input.provider);
  const baseUrl = (input.baseUrl?.trim() || preset.baseUrl || "").replace(/\/+$/, "") || null;
  if (preset.id === "custom" && !baseUrl) throw new Error("آدرس پایه‌ی API را وارد کنید");
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) throw new Error("آدرس پایه باید با https:// شروع شود");
  const key = input.apiKey?.trim();
  const row: Record<string, unknown> = {
    user_id: userId,
    kind: "ai",
    provider: preset.id,
    label: (input.label?.trim() || preset.label).slice(0, 80),
    base_url: baseUrl,
    status: "unchecked",
    last_error: null,
  };
  if (input.config) row.config = input.config;
  if (key) {
    if (key.length < 8 || /\s/.test(key)) throw new Error("کلید API نامعتبر به نظر می‌رسد");
    row.secret_enc = encryptSecret(key);
    row.secret_hint = secretHint(key);
  }
  if (input.id) {
    return must(
      await db().from("user_connections").update(row).eq("id", input.id).eq("user_id", userId).select(PUBLIC_COLUMNS).single(),
      "ذخیره‌ی اتصال",
    ) as PublicConnection;
  }
  if (!key) throw new Error("کلید API را وارد کنید");
  return must(await db().from("user_connections").insert(row).select(PUBLIC_COLUMNS).single(), "ثبت اتصال") as PublicConnection;
}

export async function saveGithubConnection(userId: string, token: string, config: GithubConfig): Promise<PublicConnection> {
  const existing = await githubInfo(userId);
  const row = {
    user_id: userId,
    kind: "github",
    provider: "github",
    label: config.login ? `GitHub (${config.login})` : "GitHub",
    secret_enc: encryptSecret(token.trim()),
    secret_hint: secretHint(token),
    config: { ...(existing?.config ?? {}), ...config },
    status: "ok",
    last_error: null,
    checked_at: new Date().toISOString(),
  };
  if (existing) {
    return must(await db().from("user_connections").update(row).eq("id", existing.id).select(PUBLIC_COLUMNS).single(), "ذخیره‌ی GitHub") as PublicConnection;
  }
  return must(await db().from("user_connections").insert(row).select(PUBLIC_COLUMNS).single(), "ثبت GitHub") as PublicConnection;
}

export async function patchConnectionConfig(id: string, patch: Record<string, unknown>) {
  const { data } = await db().from("user_connections").select("config").eq("id", id).maybeSingle();
  await db()
    .from("user_connections")
    .update({ config: { ...((data?.config as Record<string, unknown>) ?? {}), ...patch } })
    .eq("id", id);
}

export async function setConnectionStatus(id: string, ok: boolean, error?: string | null) {
  await db()
    .from("user_connections")
    .update({ status: ok ? "ok" : "error", last_error: ok ? null : (error ?? "").slice(0, 1000), checked_at: new Date().toISOString() })
    .eq("id", id);
}

export async function deleteConnection(userId: string, id: string) {
  must(await db().from("user_connections").delete().eq("id", id).eq("user_id", userId).select("id"), "حذف اتصال");
}

// ---------------------------------------------------------------------------
// runtime state: automatic pause on rate limits, models without quota (shown live)
// ---------------------------------------------------------------------------
export interface ConnectionState {
  connection_id: string;
  user_id: string;
  paused_until: string | null;
  pause_reason: string | null;
  manual_pause: boolean;
  models: Record<string, { blocked_until?: string; reason?: string }>;
  stats: Record<string, unknown>;
  updated_at: string;
}

export async function connectionState(id: string): Promise<ConnectionState | null> {
  const { data } = await db().from("connection_state").select("*").eq("connection_id", id).maybeSingle<ConnectionState>();
  return data;
}

async function upsertState(id: string, patch: Partial<ConnectionState>) {
  const current = await connectionState(id);
  let userId = current?.user_id;
  if (!userId) {
    const { data } = await db().from("user_connections").select("user_id").eq("id", id).maybeSingle();
    userId = data?.user_id as string | undefined;
    if (!userId) return;
  }
  await db()
    .from("connection_state")
    .upsert({ connection_id: id, user_id: userId, ...(current ?? {}), ...patch, updated_at: new Date().toISOString() });
}

export async function pauseConnection(id: string, until: Date, reason: string) {
  await upsertState(id, { paused_until: until.toISOString(), pause_reason: reason });
}

export async function setManualPause(id: string, paused: boolean) {
  await upsertState(id, paused ? { manual_pause: true } : { manual_pause: false, paused_until: null, pause_reason: null });
}

export async function blockModel(id: string, model: string, until: Date, reason: string) {
  const current = await connectionState(id);
  const models = { ...(current?.models ?? {}), [model]: { blocked_until: until.toISOString(), reason } };
  await upsertState(id, { models });
}

export async function clearModelBlocks(id: string) {
  await upsertState(id, { models: {}, paused_until: null, pause_reason: null });
}

export async function bumpConnectionStats(id: string, patch: Record<string, unknown>) {
  const current = await connectionState(id);
  await upsertState(id, { stats: { ...(current?.stats ?? {}), ...patch } });
}
