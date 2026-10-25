import "server-only";
import { env } from "@/lib/env";

/**
 * Sends a message to Taha's Telegram (or Bale, same Bot API) chat. The Bot API answers a wrong token or chat id
 * with an HTTP error and `{ ok: false, description }`, so both are checked. Never throws.
 */
export async function notifyOwner(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = env.telegramToken;
  const chat = env.telegramChatId;
  if (!token || !chat) return { ok: false, error: "not configured" };
  try {
    const res = await fetch(`${env.telegramApi}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || j?.ok === false) {
      const error = (j?.description || `HTTP ${res.status}`).slice(0, 200);
      console.error("[notify] rejected", error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    console.error("[notify] failed", String(e).replaceAll(token, "…"));
    return { ok: false, error: "network" };
  }
}
