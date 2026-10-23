import "server-only";
import { decrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import type { NotifySettings } from "@/lib/settings-types";

/**
 * Sends a message to the team's Telegram or Bale chat (Bale uses the same Bot API).
 * The Bot API answers a wrong token or chat id with an HTTP error and `{ ok: false, description }`, so both are checked.
 */
export async function notifyTeam(text: string, n?: NotifySettings): Promise<{ ok: boolean; error?: string }> {
  const cfg = n ?? (await getSettings()).notify;
  if (cfg.channel === "none" || !cfg.chatId) return { ok: false, error: "not configured" };
  const token = decrypt(cfg.botTokenEnc);
  if (!token) return { ok: false, error: "not configured" };
  const base = cfg.channel === "bale" ? "https://tapi.bale.ai" : "https://api.telegram.org";
  try {
    const res = await fetch(`${base}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || j?.ok === false) {
      const error = (j?.description || `HTTP ${res.status}`).slice(0, 200);
      console.error("[notify] team message rejected", error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    console.error("[notify] team message failed", e);
    return { ok: false, error: String(e).replaceAll(token, "…").slice(0, 200) };
  }
}
