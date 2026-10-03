"use server";
import { assertActive, assertFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getUserConfig, saveUserConfig, type UserConfig } from "@/lib/settings";
import { deleteConnection, getConnection, listConnections, patchConnectionConfig, saveAiConnection, setConnectionStatus, type AiConfig } from "@/lib/connections";
import { adapterFor } from "@/lib/ai/llm";
import { errorInfo } from "@/lib/ai/llm";
import { providerPreset, suggestModel, type ProviderId } from "@/lib/ai/providers";
import { connectGithub, removeClaudeSecret, setClaudeSecret, setRunnerSecrets, syncTemplate, workspaceStatus } from "@/lib/github/bootstrap";
import { act, mutate } from "./_util";

/*
 * Each user's own settings: AI connections (any provider), GitHub, the model of each stage and the
 * app mode. Keys are encrypted before they reach the database and never sent back to the browser.
 */

const MODEL = /^[\w.:/@[\]-]{1,120}$/;

async function readModels(userId: string, id: string): Promise<string[]> {
  const conn = await getConnection(id, userId);
  try {
    const models = (await adapterFor(conn).listModels()).filter((m) => MODEL.test(m)).slice(0, 400);
    await setConnectionStatus(id, true);
    await patchConnectionConfig(id, { models, modelsAt: new Date().toISOString() } satisfies AiConfig);
    return models;
  } catch (err) {
    const info = errorInfo(conn.provider, err);
    const message = info.kind === "auth" ? "کلید API نامعتبر است یا دسترسی ندارد" : info.message.slice(0, 300);
    await setConnectionStatus(id, false, message);
    throw new Error(message);
  }
}

/** Adds or edits an AI connection, checks the key by reading the provider's model list. */
export async function saveAiConnectionAction(input: { id?: string | null; provider: ProviderId; label?: string; baseUrl?: string | null; apiKey?: string; fallbacks?: string[] }) {
  return mutate(async () => {
    const user = await assertActive();
    const fallbacks = (input.fallbacks ?? []).map((m) => m.trim()).filter((m) => MODEL.test(m)).slice(0, 6);
    const existing = input.id ? (await listConnections(user.id)).find((c) => c.id === input.id) : null;
    const conn = await saveAiConnection(user.id, {
      id: input.id ?? null,
      provider: input.provider,
      label: input.label,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      config: { ...((existing?.config as AiConfig | undefined) ?? {}), fallbacks },
    });
    let models: string[] = [];
    let warning: string | null = null;
    try {
      models = await readModels(user.id, conn.id);
    } catch (err) {
      warning = (err as Error).message;
    }
    // the first connection becomes the default of every stage
    const cfg = await getUserConfig(user.id, true);
    const patch: Record<string, unknown> = {};
    const model = providerPreset(conn.provider).protocol === "google" ? "auto" : suggestModel(conn.provider, models);
    if (!cfg.stages.prework.connectionId) patch.prework = { connectionId: conn.id, model };
    if (!cfg.stages.main.connectionId) patch.main = { connectionId: conn.id, model };
    if (Object.keys(patch).length) await saveUserConfig(user.id, { stages: patch });
    return { id: conn.id, models: models.length, warning };
  });
}

export async function refreshModelsAction(id: string) {
  return act(async () => {
    const user = await assertActive();
    return readModels(user.id, id);
  });
}

/** One short request to check that a connection and a model really answer. */
export async function testConnectionAction(id: string, model?: string) {
  return act(async () => {
    const user = await assertActive();
    const conn = await getConnection(id, user.id);
    const cfg = (conn.config ?? {}) as AiConfig;
    let m = model?.trim() || suggestModel(conn.provider, cfg.models ?? []);
    if (providerPreset(conn.provider).protocol === "google" && (!m || m.startsWith("auto"))) m = "gemini-flash-latest";
    if (!m) throw new Error("مدلی برای آزمایش انتخاب نشده است");
    const started = Date.now();
    try {
      const res = await adapterFor(conn).turn({ model: m, system: "Answer in one short Persian sentence.", messages: [{ role: "user", content: [{ type: "text", text: "سلام؛ فقط بگو آماده‌ای." }] }], maxOutputTokens: 200, signal: AbortSignal.timeout(45_000) });
      await setConnectionStatus(id, true);
      return { model: res.model, text: res.text.slice(0, 200), ms: Date.now() - started };
    } catch (err) {
      const info = errorInfo(conn.provider, err);
      await setConnectionStatus(id, false, info.message);
      throw new Error(info.kind === "auth" ? "کلید API نامعتبر است" : info.kind === "rate" || info.kind.startsWith("quota") ? `سقف مصرف: ${info.message.slice(0, 200)}` : info.message.slice(0, 300));
    }
  });
}

export async function deleteConnectionAction(id: string) {
  return mutate(async () => {
    const user = await assertActive();
    await deleteConnection(user.id, id);
    const cfg = await getUserConfig(user.id, true);
    const patch: Record<string, unknown> = {};
    for (const stage of ["prework", "main", "knowledge"] as const) if (cfg.stages[stage].connectionId === id) patch[stage] = { connectionId: null, model: "" };
    if (Object.keys(patch).length) await saveUserConfig(user.id, { stages: patch });
    return null;
  });
}

/** Saves the user's settings (stages, defaults, pipeline); only known keys are kept. */
export async function saveUserConfigAction(patch: Partial<UserConfig>) {
  return mutate(async () => {
    const user = await assertActive();
    const own = new Set((await listConnections(user.id)).filter((c) => c.kind === "ai").map((c) => c.id));
    const clean: Partial<UserConfig> = {};
    if (typeof patch.about === "string") clean.about = patch.about.slice(0, 4000);
    if (patch.stages) {
      const s: Record<string, unknown> = {};
      for (const k of ["prework", "main", "knowledge"] as const) {
        const v = patch.stages[k] as { connectionId?: string | null; model?: string; engine?: string } | undefined;
        if (!v) continue;
        if (v.connectionId && !own.has(v.connectionId)) throw new Error("اتصال انتخاب‌شده متعلق به شما نیست");
        s[k] = {
          connectionId: v.connectionId || null,
          model: typeof v.model === "string" && (v.model === "" || MODEL.test(v.model)) ? v.model : "",
          ...(k === "main" ? { engine: v.engine === "claude_code" ? "claude_code" : "agent" } : {}),
        };
      }
      clean.stages = s as UserConfig["stages"];
    }
    if (patch.pipeline) {
      const p = patch.pipeline;
      clean.pipeline = {
        maxHelperFiles: Math.max(0, Math.min(Number(p.maxHelperFiles ?? 3), 10)),
        useSearch: !!p.useSearch,
        thinking: (["LOW", "MEDIUM", "HIGH"] as const).includes(p.thinking) ? p.thinking : "HIGH",
        historyChars: Math.max(0, Math.min(Number(p.historyChars ?? 40000), 200000)),
        maxAgentTurns: Math.max(5, Math.min(Number(p.maxAgentTurns ?? 60), 200)),
      };
    }
    if (patch.prework?.defaultPrompt !== undefined) clean.prework = { defaultPrompt: String(patch.prework.defaultPrompt).slice(0, 8000) };
    if (patch.main?.defaultPrompt !== undefined) clean.main = { defaultPrompt: String(patch.main.defaultPrompt).slice(0, 8000) };
    if (patch.claude) {
      const c = patch.claude;
      clean.claude = {
        model: /^[\w.:[\]-]{0,80}$/.test(c.model ?? "") ? (c.model ?? "") : "",
        effort: ["", "low", "medium", "high", "xhigh", "max"].includes(c.effort ?? "") ? c.effort : "",
        thinking: ["auto", "on", "off"].includes(c.thinking ?? "") ? c.thinking : "auto",
        maxTurns: Math.max(10, Math.min(Number(c.maxTurns ?? 250), 1000)),
        resumeSessions: c.resumeSessions !== false,
      };
    }
    if (patch.graphify) clean.graphify = { mode: (["llm", "code-only", "off"] as const).includes(patch.graphify.mode) ? patch.graphify.mode : "llm" };
    if (patch.knowledge) clean.knowledge = { autoUpdate: patch.knowledge.autoUpdate !== false };
    return saveUserConfig(user.id, clean);
  });
}

/** Simple mode = give and track tasks only; full mode = the whole app. */
export async function setModeAction(mode: "simple" | "full") {
  return act(async () => {
    const user = await assertActive();
    if (user.isOwner && mode === "simple") throw new Error("مالک اپ همیشه در حالت کامل است");
    await db().from("profiles").update({ mode: mode === "full" ? "full" : "simple" }).eq("id", user.id);
    return { redirect: mode === "full" ? "/dashboard" : "/portal" };
  });
}

// ------------------------------------------------------------------ GitHub
export async function connectGithubAction(token: string, repo?: string) {
  return mutate(async () => {
    const user = await assertActive();
    if (!token.trim()) throw new Error("توکن GitHub را وارد کنید");
    return connectGithub(user.id, token, repo);
  });
}

export async function resyncWorkspaceAction() {
  return act(async () => {
    const user = await assertFull();
    const files = await syncTemplate(user.id);
    await setRunnerSecrets(user.id);
    return { files };
  });
}

export async function workspaceStatusAction() {
  return act(async () => {
    const user = await assertActive();
    return workspaceStatus(user.id);
  });
}

export async function disconnectGithubAction() {
  return mutate(async () => {
    const user = await assertActive();
    await db().from("user_connections").delete().eq("user_id", user.id).eq("kind", "github");
    return null;
  });
}

export async function setClaudeSecretAction(input: { oauthToken?: string; apiKey?: string; connectionId?: string }) {
  return mutate(async () => {
    const user = await assertFull();
    await setClaudeSecret(user.id, input);
    return null;
  });
}

export async function removeClaudeSecretAction() {
  return mutate(async () => {
    const user = await assertFull();
    await removeClaudeSecret(user.id);
    const cfg = await getUserConfig(user.id, true);
    if (cfg.stages.main.engine === "claude_code") await saveUserConfig(user.id, { stages: { main: { engine: "agent" } } });
    return null;
  });
}
