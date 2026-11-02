// The business's AI connections (provider, base URL, encrypted key, chosen models): CRUD for
// members with ai:full, the public view (never the key), decryption only for a call, model lists
// and «آزمایش اتصال». Connections and keys belong to this runtime (web or Windows app).
import { z } from "zod";
import type { Ctx, ServerConfig } from "../../context";
import { pgArray, type Queryable } from "../../db";
import type { AiConnectionPublic, AiErrorKind, AiProtocol, AiTestReport } from "@shared/ai/types";
import type { AiConnectionInput } from "@shared/ai/api";
import { AI_PRESETS, MODEL_ID_RE, presetById, presetsFor, type AiPreset } from "@shared/ai/presets";
import { aiErrorText } from "@shared/ai/errors";
import { uuidv7 } from "@shared/id";
import { bad, conflict, notFound } from "../../http/errors";
import { audit } from "../data/crud";
import { safeExternalUrl } from "../fx/net";
import { cleanKey, decryptKey, encryptKey, keyFingerprint, keyHint, keyReadable, KeyUnreadableError, scrubSecrets } from "./crypto";
import { createAdapter } from "./adapters";
import { fakeEnabled } from "./adapters/fake";
import { ProviderError, type AdapterEnv, type ResolvedConnection } from "./types";
import { recordUsage } from "./usage";
import { disabledByPlatform, loadPolicy } from "./settings";
import { AiUnavailableError } from "./errors";
import { guardedFetch } from "./net";
import { orgAiDisabled } from "../platform/org-admin";
import { securityEvent } from "../platform/security";

export interface ConnRow {
  id: string;
  org_id: string;
  label: string;
  preset: string;
  protocol: AiProtocol;
  base_url: string | null;
  secret_enc: string | null;
  key_hint: string | null;
  key_fp: string | null;
  models: { smart?: string[]; fast?: string[]; vision?: string[] } | null;
  available_models: string[] | null;
  models_at: string | null;
  status: AiConnectionPublic["status"];
  last_error: AiConnectionPublic["last_error"];
  checked_at: string | null;
  enabled: boolean;
  priority: number;
  created_by: string | null;
  updated_at: string;
}

/** Web version without APP_SECRET: the derived secret dies with a database URL change. */
export function appSecretMissing(cfg: ServerConfig): boolean {
  if (cfg.mode !== "cloud") return false;
  if (cfg.secretSource) return cfg.secretSource === "derived";
  return !process.env.APP_SECRET;
}

export const APP_SECRET_MESSAGE =
  "در نسخهٔ وب تا وقتی متغیر APP_SECRET در Vercel تنظیم نشده، کلیدها ذخیره نمی‌شوند: کلید رمزگذاری‌شده با جابه‌جایی پایگاه داده از دست می‌رود. APP_SECRET را بگذارید و برنامه را دوباره مستقر کنید.";

/** Provider calls on the web version go through the SSRF guard (public addresses only, no redirects). */
export function adapterEnv(cfg: ServerConfig): AdapterEnv {
  return { fetch: cfg.mode === "cloud" ? guardedFetch(cfg.fetch) : cfg.fetch, mode: cfg.mode, publicUrl: cfg.publicUrl };
}

/** Where a connection's key is sent: the preset and its effective base URL. */
function destination(presetId: string, baseUrl: string | null | undefined): string {
  const preset = presetById(presetId);
  return `${presetId} ${String(baseUrl ?? preset?.base_url ?? "").trim().replace(/\/+$/, "")}`;
}

/** The platform switched AI off for this business: no provider call at all, tests included. */
async function assertNotDisabled(ctx: Ctx): Promise<void> {
  const [policy, offByAdmin] = await Promise.all([loadPolicy(ctx.cfg), ctx.cfg.mode === "cloud" ? orgAiDisabled(ctx.db, ctx.org.id).catch(() => false) : false]);
  if (offByAdmin || disabledByPlatform(policy, ctx.org.id)) {
    const t = aiErrorText("disabled", { canManage: true, desktop: ctx.cfg.mode === "desktop", byPlatform: true });
    throw new AiUnavailableError("disabled", `${t.message} ${t.remedy}`);
  }
}

const modelList = z.array(z.string().trim().regex(MODEL_ID_RE, "شناسهٔ مدل معتبر نیست")).max(8);

export const connectionInputSchema = z.object({
  preset: z.string().max(40),
  label: z.string().trim().max(80).optional(),
  protocol: z.enum(["anthropic", "openai-responses", "openai-chat", "gemini"]).optional(),
  base_url: z.string().trim().max(500).nullish(),
  key: z.string().max(8000).optional(),
  models: z.object({ smart: modelList, fast: modelList, vision: modelList }).partial().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

export const connectionTestSchema = connectionInputSchema.extend({ connection_id: z.string().uuid().nullish() });

/** Presets this business may use here (runtime, test mode and the platform policy). */
export async function availablePresets(ctx: Ctx): Promise<AiPreset[]> {
  const policy = await loadPolicy(ctx.cfg);
  return presetsFor({ desktop: ctx.cfg.mode === "desktop", fake: fakeEnabled(), allowedPresets: policy.allowed_presets, allowedProtocols: policy.allowed_protocols });
}

async function usablePreset(ctx: Ctx, id: string): Promise<AiPreset> {
  const preset = presetById(id);
  if (!preset) throw bad("سرویس انتخاب‌شده شناخته نیست");
  const ok = (await availablePresets(ctx)).some((p) => p.id === id);
  if (!ok) {
    if (preset.runtimes.includes("desktop") && !preset.runtimes.includes("web") && ctx.cfg.mode === "cloud") throw bad("مدل‌های محلی فقط در نسخهٔ ویندوز در دسترس‌اند");
    throw bad("این سرویس در این نسخه یا طبق سیاست سامانه مجاز نیست");
  }
  return preset;
}

/** Normalised base URL: web version blocks internal addresses (SSRF); the Windows app may use LAN/loopback servers. */
export function checkBaseUrl(cfg: ServerConfig, preset: AiPreset, raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!s) {
    if (preset.base_url_required) throw bad("نشانی سرویس را وارد کنید");
    return null;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw bad("نشانی سرویس معتبر نیست");
  }
  if (u.username || u.password) throw bad("نشانی سرویس نباید نام کاربری یا گذرواژه داشته باشد");
  if (cfg.mode === "cloud") {
    const problem = safeExternalUrl(s);
    if (problem) throw bad(`نشانی سرویس: ${problem}`);
  } else if (u.protocol !== "https:" && u.protocol !== "http:") throw bad("نشانی سرویس باید با http:// یا https:// شروع شود");
  return s;
}

function modelsOf(row: Pick<ConnRow, "models">): { smart: string[]; fast: string[]; vision: string[] } {
  const m = row.models ?? {};
  return { smart: m.smart ?? [], fast: m.fast ?? [], vision: m.vision ?? [] };
}

export function binding(row: { org_id: string; id: string }) {
  return { orgId: row.org_id, connectionId: row.id };
}

export function toPublic(cfg: ServerConfig, row: ConnRow, pausedUntil: string | null, names?: Map<string, string>): AiConnectionPublic {
  return {
    id: row.id,
    label: row.label,
    preset: row.preset,
    protocol: row.protocol,
    base_url: row.base_url,
    has_key: !!row.secret_enc,
    key_hint: row.secret_enc ? row.key_hint : null,
    key_unreadable: row.secret_enc ? !keyReadable(cfg.secret, binding(row), row.secret_enc) : false,
    models: modelsOf(row),
    available_models: row.available_models ?? undefined,
    status: pausedUntil ? "paused" : row.status,
    last_error: row.last_error,
    checked_at: row.checked_at,
    paused_until: pausedUntil,
    enabled: row.enabled,
    priority: row.priority,
    created_by_name: row.created_by ? (names?.get(row.created_by) ?? null) : null,
    updated_at: row.updated_at,
  };
}

const COLS = `id, org_id, label, preset, protocol, base_url, secret_enc, key_hint, key_fp, models, available_models, models_at, status, last_error, checked_at, enabled, priority, created_by, updated_at`;

export async function connectionRows(q: Queryable, orgId: string): Promise<ConnRow[]> {
  return q.query<ConnRow>(`select ${COLS} from tz_ai_connections where org_id = $1 and deleted_at is null order by priority, created_at`, [orgId]);
}

export async function connectionRow(q: Queryable, orgId: string, id: string): Promise<ConnRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("اتصال پیدا نشد");
  const row = await q.one<ConnRow>(`select ${COLS} from tz_ai_connections where org_id = $1 and id = $2 and deleted_at is null`, [orgId, id]);
  if (!row) throw notFound("اتصال پیدا نشد");
  return row;
}

/** Connection-level holds (rate limits): connection id → until. */
export async function connectionHolds(q: Queryable, orgId: string): Promise<Map<string, string>> {
  const rows = await q.query<{ connection_id: string; until: string }>(
    `select connection_id, max(until) as until from tz_ai_holds where org_id = $1 and model = '' and until > now() group by connection_id`,
    [orgId],
  );
  return new Map(rows.map((r) => [r.connection_id, r.until]));
}

export async function listConnections(ctx: Ctx): Promise<AiConnectionPublic[]> {
  ctx.need("ai", "full");
  const [rows, holds] = await Promise.all([connectionRows(ctx.db, ctx.org.id), connectionHolds(ctx.db, ctx.org.id)]);
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const us = await ctx.db.query<{ id: string; full_name: string }>(`select id, full_name from tz_users where id = any($1::uuid[])`, [pgArray(ids)]);
    for (const u of us) names.set(u.id, u.full_name);
  }
  return rows.map((r) => toPublic(ctx.cfg, r, holds.get(r.id) ?? null, names));
}

export async function publicConnection(ctx: Ctx, id: string): Promise<AiConnectionPublic> {
  const row = await connectionRow(ctx.db, ctx.org.id, id);
  const holds = await connectionHolds(ctx.db, ctx.org.id);
  return toPublic(ctx.cfg, row, holds.get(id) ?? null);
}

/** Clean a pasted key; refuse storing it while the web version has no APP_SECRET. */
function sealKey(ctx: Ctx, connectionId: string, raw: string): { enc: string; hint: string; fp: string } {
  const key = cleanKey(raw);
  if (key.length < 8) throw bad("کلید واردشده کوتاه است");
  if (appSecretMissing(ctx.cfg)) throw bad(APP_SECRET_MESSAGE);
  return { enc: encryptKey(ctx.cfg.secret, { orgId: ctx.org.id, connectionId }, key), hint: keyHint(key), fp: keyFingerprint(ctx.cfg.secret, key) };
}

/** «رویدادهای امنیتی» of the platform: a key added, replaced or removed (never the key, only its hint). */
async function keyEvent(ctx: Ctx, conn: { id: string; label: string; preset: string }, action: "added" | "replaced" | "removed", hint: string | null, reason?: string) {
  await securityEvent(ctx.db, {
    kind: "ai_key",
    user_id: ctx.user.id,
    email: ctx.user.email,
    org_id: ctx.org.id,
    data: { connection_id: conn.id, label: conn.label, preset: conn.preset, action, key_hint: hint, ...(reason ? { reason } : {}), ...(ctx.actor === "support" ? { support: true } : {}) },
  });
}

async function duplicateWarning(q: Queryable, orgId: string, id: string, fp: string | null): Promise<string | null> {
  if (!fp) return null;
  const dup = await q.one<{ label: string }>(`select label from tz_ai_connections where org_id = $1 and key_fp = $2 and id <> $3 and deleted_at is null`, [orgId, fp, id]);
  return dup ? `همین کلید در اتصال «${dup.label}» هم ثبت شده است.` : null;
}

export async function createConnection(ctx: Ctx, input: AiConnectionInput): Promise<{ connection: AiConnectionPublic; warning: string | null }> {
  ctx.need("ai", "full");
  const preset = await usablePreset(ctx, input.preset);
  const protocol = input.protocol && (preset.protocols ?? [preset.protocol]).includes(input.protocol) ? input.protocol : preset.protocol;
  const baseUrl = checkBaseUrl(ctx.cfg, preset, input.base_url ?? preset.base_url);
  const id = uuidv7();
  const raw = cleanKey(input.key);
  if (!raw && preset.key_required) throw bad("کلید API را وارد کنید");
  const sealed = raw ? sealKey(ctx, id, raw) : null;
  const models = {
    smart: input.models?.smart ?? preset.models.smart,
    fast: input.models?.fast ?? preset.models.fast,
    vision: input.models?.vision ?? preset.models.vision,
  };
  const label = input.label?.trim() || preset.label;
  await ctx.write(async (tx) => {
    const pr = input.priority ?? (await tx.one<{ n: number }>(`select coalesce(max(priority) + 1, 0)::int as n from tz_ai_connections where org_id = $1 and deleted_at is null`, [ctx.org.id]))?.n ?? 0;
    await tx.query(
      `insert into tz_ai_connections (id, org_id, label, preset, protocol, base_url, secret_enc, key_hint, key_fp, models, enabled, priority, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $13)`,
      [id, ctx.org.id, label, preset.id, protocol, baseUrl, sealed?.enc ?? null, sealed?.hint ?? null, sealed?.fp ?? null, JSON.stringify(models), input.enabled ?? true, pr, ctx.user.id],
    );
    await audit(tx, ctx, "ai_connection_create", "ai_connection", id, `اتصال هوش مصنوعی «${label}» ساخته شد`, { preset: preset.id, key: sealed ? sealed.hint : null });
  });
  if (sealed) await keyEvent(ctx, { id, label, preset: preset.id }, "added", sealed.hint);
  return { connection: await publicConnection(ctx, id), warning: await duplicateWarning(ctx.db, ctx.org.id, id, sealed?.fp ?? null) };
}

export async function updateConnection(ctx: Ctx, id: string, patch: Partial<AiConnectionInput>): Promise<{ connection: AiConnectionPublic; warning: string | null }> {
  ctx.need("ai", "full");
  const row = await connectionRow(ctx.db, ctx.org.id, id);
  const preset = patch.preset && patch.preset !== row.preset ? await usablePreset(ctx, patch.preset) : (presetById(row.preset) ?? (await usablePreset(ctx, row.preset)));
  const protocol = patch.protocol && (preset.protocols ?? [preset.protocol]).includes(patch.protocol) ? patch.protocol : patch.preset ? preset.protocol : row.protocol;
  const baseUrl = patch.base_url !== undefined || patch.preset ? checkBaseUrl(ctx.cfg, preset, patch.base_url ?? preset.base_url) : row.base_url;
  // write-only key: blank keeps the stored one — but only while it goes to the same place: a new
  // service or base URL needs the key typed again, so a stored key is never sent to another host
  const raw = cleanKey(patch.key);
  const sealed = raw ? sealKey(ctx, id, raw) : null;
  const moved = destination(preset.id, baseUrl) !== destination(row.preset, row.base_url);
  const dropKey = moved && !sealed && !!row.secret_enc;
  if (dropKey && preset.key_required) throw bad("سرویس یا نشانی اتصال عوض شده است؛ کلید API را دوباره وارد کنید");
  const cur = modelsOf(row);
  const models = { smart: patch.models?.smart ?? cur.smart, fast: patch.models?.fast ?? cur.fast, vision: patch.models?.vision ?? cur.vision };
  const label = patch.label?.trim() || row.label;
  await ctx.write(async (tx) => {
    await tx.query(
      `update tz_ai_connections set label = $3, preset = $4, protocol = $5, base_url = $6, models = $7::jsonb, enabled = $8, priority = $9,
         secret_enc = case when $15 then null else coalesce($10, secret_enc) end, key_hint = case when $15 then null else coalesce($11, key_hint) end,
         key_fp = case when $15 then null else coalesce($12, key_fp) end,
         status = case when $10::text is not null or $13 then 'unchecked' else status end,
         last_error = case when $10::text is not null or $13 then null else last_error end,
         updated_by = $14, updated_at = now()
       where org_id = $1 and id = $2`,
      [ctx.org.id, id, label, preset.id, protocol, baseUrl, JSON.stringify(models), patch.enabled ?? row.enabled, patch.priority ?? row.priority, sealed?.enc ?? null, sealed?.hint ?? null, sealed?.fp ?? null, baseUrl !== row.base_url || protocol !== row.protocol || moved, ctx.user.id, dropKey],
    );
    if (sealed) await tx.query(`delete from tz_ai_holds where connection_id = $1`, [id]);
    await audit(tx, ctx, sealed ? "ai_connection_key" : "ai_connection_update", "ai_connection", id, sealed ? `کلید اتصال «${label}» عوض شد` : `اتصال هوش مصنوعی «${label}» ویرایش شد`, sealed ? { key: sealed.hint } : undefined);
  });
  if (sealed) await keyEvent(ctx, { id, label, preset: preset.id }, row.secret_enc ? "replaced" : "added", sealed.hint);
  else if (dropKey) await keyEvent(ctx, { id, label, preset: preset.id }, "removed", row.key_hint, "destination_changed");
  return { connection: await publicConnection(ctx, id), warning: await duplicateWarning(ctx.db, ctx.org.id, id, sealed?.fp ?? null) };
}

export async function setConnectionKey(ctx: Ctx, id: string, key: string): Promise<AiConnectionPublic> {
  if (!cleanKey(key)) throw bad("کلید API را وارد کنید");
  return (await updateConnection(ctx, id, { key })).connection;
}

export async function deleteConnection(ctx: Ctx, id: string): Promise<void> {
  ctx.need("ai", "full");
  const row = await connectionRow(ctx.db, ctx.org.id, id);
  await ctx.write(async (tx) => {
    // the key is dropped, not kept in a deleted row
    await tx.query(`update tz_ai_connections set deleted_at = now(), secret_enc = null, key_fp = null, enabled = false, updated_by = $3, updated_at = now() where org_id = $1 and id = $2`, [ctx.org.id, id, ctx.user.id]);
    await tx.query(`delete from tz_ai_holds where connection_id = $1`, [id]);
    await audit(tx, ctx, "ai_connection_delete", "ai_connection", id, `اتصال هوش مصنوعی «${row.label}» حذف شد`);
  });
  if (row.secret_enc) await keyEvent(ctx, row, "removed", row.key_hint);
}

/** A connection ready for a call. Throws ProviderError("auth") when the key is missing or unreadable. */
export function resolveConnection(cfg: ServerConfig, row: ConnRow): ResolvedConnection {
  const preset = presetById(row.preset) ?? AI_PRESETS.find((p) => p.id === "custom-openai")!;
  let key: string | null = null;
  if (row.secret_enc) {
    try {
      key = decryptKey(cfg.secret, binding(row), row.secret_enc);
    } catch (e) {
      if (e instanceof KeyUnreadableError) throw new ProviderError("auth", e.message);
      throw e;
    }
  } else if (preset.key_required) throw new ProviderError("auth", "کلید API این اتصال ثبت نشده است");
  const baseUrl = row.base_url ?? preset.base_url ?? "";
  if (!baseUrl && preset.id !== "fake") throw new ProviderError("not_configured", "نشانی سرویس ثبت نشده است");
  // a web address the guard refuses never gets a request (stored rows may predate a policy change)
  if (cfg.mode === "cloud" && preset.id !== "fake" && safeExternalUrl(baseUrl)) throw new ProviderError("network", "نشانی داخلی در نسخهٔ وب مجاز نیست");
  return { id: row.id, label: row.label, preset, protocol: row.protocol, baseUrl, key };
}

export async function markConnection(ctx: Ctx, id: string, outcome: { ok: true } | { ok: false; kind: AiErrorKind; detail: string }): Promise<void> {
  const err = outcome.ok ? null : { kind: outcome.kind, message: aiErrorText(outcome.kind, { canManage: true, desktop: ctx.cfg.mode === "desktop" }).message, at: new Date().toISOString(), detail: scrubSecrets(outcome.detail).slice(0, 500) };
  await ctx
    .write((tx) => tx.query(`update tz_ai_connections set status = $3, last_error = coalesce($4::jsonb, last_error), checked_at = now() where org_id = $1 and id = $2`, [ctx.org.id, id, outcome.ok ? "ok" : "error", err ? JSON.stringify(err) : null]), { internal: true })
    .catch(() => undefined);
}

const TEST_SYSTEM = "You check that an API connection works. Answer in Persian with at most five words.";
const TEST_PROMPT = "فقط بنویس: سلام";

/** «آزمایش اتصال»: read the model list, then one short real reply from each model. */
export async function testResolved(ctx: Ctx, conn: ResolvedConnection, models: string[], persistId: string | null): Promise<AiTestReport> {
  const started = Date.now();
  const adapter = createAdapter(conn, adapterEnv(ctx.cfg));
  let available: string[] | undefined;
  try {
    available = (await adapter.listModels(AbortSignal.timeout(20_000))).slice(0, 500);
  } catch {
    available = undefined; // some gateways have no model list; the replies below decide
  }
  const tryModels = [...new Set(models.filter(Boolean))].slice(0, 4);
  if (!tryModels.length && available?.length) tryModels.push(available[0]);
  const rows: AiTestReport["models"] = [];
  for (const model of tryModels) {
    const t0 = Date.now();
    try {
      const r = await adapter.turn({ model, system: TEST_SYSTEM, messages: [{ role: "user", parts: [{ type: "text", text: TEST_PROMPT }] }], maxTokens: 1024, effort: "low", signal: AbortSignal.timeout(60_000) });
      const ms = Date.now() - t0;
      await recordUsage(ctx, { feature: "test", connection_id: persistId, preset: conn.preset.id, model: r.model, usage: r.usage, provider_cost: r.providerCostUsd, local: conn.preset.region === "local", ms, ok: true });
      if (r.stop === "refusal") rows.push({ model, ok: false, ms, kind: "refusal", message_fa: aiErrorText("refusal").message });
      else if (!r.text.trim()) rows.push({ model, ok: false, ms, kind: "empty", message_fa: aiErrorText("empty").message });
      else rows.push({ model, ok: true, ms, reply: r.text.trim().slice(0, 200) });
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("other", String((e as Error)?.message ?? e));
      const ms = Date.now() - t0;
      await recordUsage(ctx, { feature: "test", connection_id: persistId, preset: conn.preset.id, model, ms, ok: false, error_kind: pe.kind });
      rows.push({ model, ok: false, ms, kind: pe.kind, message_fa: aiErrorText(pe.kind, { canManage: true, desktop: ctx.cfg.mode === "desktop" }).message, provider_message: scrubSecrets(pe.message, [conn.key]).slice(0, 400) });
    }
  }
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  if (persistId) {
    const failed = rows.find((r) => !r.ok);
    await ctx.write(
      (tx) =>
        tx.query(
          `update tz_ai_connections set status = $3, last_error = $4::jsonb, checked_at = now(),
             available_models = coalesce($5::jsonb, available_models), models_at = case when $5::jsonb is null then models_at else now() end
           where org_id = $1 and id = $2`,
          [
            ctx.org.id, persistId, ok ? "ok" : "error",
            failed ? JSON.stringify({ kind: failed.kind ?? "other", message: failed.message_fa ?? "", at: new Date().toISOString(), detail: failed.provider_message ?? null }) : rows.length ? null : JSON.stringify({ kind: "model", message: "مدلی برای آزمایش انتخاب نشده است", at: new Date().toISOString() }),
            available ? JSON.stringify(available) : null,
          ],
        ),
      { internal: true },
    );
  }
  return { ok, ms: Date.now() - started, models: rows, available_models: available, route: "direct" };
}

export async function testConnection(ctx: Ctx, id: string, models?: string[]): Promise<AiTestReport> {
  ctx.need("ai", "full");
  await assertNotDisabled(ctx);
  const row = await connectionRow(ctx.db, ctx.org.id, id);
  let conn: ResolvedConnection;
  try {
    conn = resolveConnection(ctx.cfg, row);
  } catch (e) {
    const pe = e as ProviderError;
    return { ok: false, ms: 0, models: [{ model: "", ok: false, ms: 0, kind: pe.kind ?? "other", message_fa: pe.message }], route: "direct" };
  }
  const m = modelsOf(row);
  return testResolved(ctx, conn, models?.length ? models : [...m.smart.slice(0, 1), ...m.fast.slice(0, 1), ...m.vision.slice(0, 1)], id);
}

/**
 * Test values typed in the form before saving. A blank key uses the saved connection's key only
 * when the service and base URL are the saved ones: the stored key never goes to another host.
 */
export async function testUnsaved(ctx: Ctx, input: AiConnectionInput & { connection_id?: string | null }): Promise<AiTestReport> {
  ctx.need("ai", "full");
  await assertNotDisabled(ctx);
  const preset = await usablePreset(ctx, input.preset);
  const protocol = input.protocol && (preset.protocols ?? [preset.protocol]).includes(input.protocol) ? input.protocol : preset.protocol;
  const baseUrl = checkBaseUrl(ctx.cfg, preset, input.base_url ?? preset.base_url) ?? preset.base_url ?? "";
  let key = cleanKey(input.key) || null;
  if (!key && input.connection_id) {
    const row = await connectionRow(ctx.db, ctx.org.id, input.connection_id);
    if (row.secret_enc && (destination(preset.id, baseUrl) !== destination(row.preset, row.base_url))) {
      throw bad("سرویس یا نشانی با اتصال ذخیره‌شده فرق دارد؛ برای آزمایش، کلید API را دوباره وارد کنید");
    }
    if (row.secret_enc) {
      try {
        key = decryptKey(ctx.cfg.secret, binding(row), row.secret_enc);
      } catch {
        throw bad("کلید ذخیره‌شده باز نمی‌شود؛ کلید را دوباره وارد کنید");
      }
    }
  }
  if (!key && preset.key_required) throw bad("کلید API را وارد کنید");
  const conn: ResolvedConnection = { id: input.connection_id ?? "unsaved", label: input.label ?? preset.label, preset, protocol, baseUrl, key };
  const models = [...(input.models?.smart ?? preset.models.smart).slice(0, 1), ...(input.models?.fast ?? preset.models.fast).slice(0, 1), ...(input.models?.vision ?? preset.models.vision).slice(0, 1)];
  return testResolved(ctx, conn, models, null);
}

export async function refreshModels(ctx: Ctx, id: string): Promise<{ models: string[]; connection: AiConnectionPublic }> {
  ctx.need("ai", "full");
  await assertNotDisabled(ctx);
  const row = await connectionRow(ctx.db, ctx.org.id, id);
  const conn = resolveConnection(ctx.cfg, row);
  let models: string[];
  try {
    models = (await createAdapter(conn, adapterEnv(ctx.cfg)).listModels(AbortSignal.timeout(20_000))).slice(0, 500);
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("other", String(e));
    throw conflict(`${aiErrorText(pe.kind, { canManage: true }).message} ${scrubSecrets(pe.message, [conn.key]).slice(0, 200)}`);
  }
  await ctx.write((tx) => tx.query(`update tz_ai_connections set available_models = $3::jsonb, models_at = now() where org_id = $1 and id = $2`, [ctx.org.id, id, JSON.stringify(models)]), { internal: true });
  return { models, connection: await publicConnection(ctx, id) };
}

export async function resumeConnection(ctx: Ctx, id: string): Promise<AiConnectionPublic> {
  ctx.need("ai", "full");
  await connectionRow(ctx.db, ctx.org.id, id);
  await ctx.write((tx) => tx.query(`delete from tz_ai_holds where org_id = $1 and connection_id = $2`, [ctx.org.id, id]), { internal: true });
  return publicConnection(ctx, id);
}
