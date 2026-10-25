import "server-only";
import { env } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import type { NotifyChannel } from "@/lib/settings-types";

export interface Bot {
  channel: Exclude<NotifyChannel, "none">;
  token: string;
  chatId: string;
}

const API: Record<Bot["channel"], string> = { telegram: "https://api.telegram.org", bale: "https://tapi.bale.ai" };

/** The bot that receives new requests: the one saved in the panel, else TELEGRAM_* from Vercel; null when off or unset. */
export async function getBot(): Promise<Bot | null> {
  const n = (await getSettings()).notify;
  if (n.channel === "none") return null;
  const token = decrypt(n.tokenEnc);
  if (token && n.chatId) return { channel: n.channel, token, chatId: n.chatId };
  if (env.telegramToken && env.telegramChatId) return { channel: env.telegramChannel, token: env.telegramToken, chatId: env.telegramChatId };
  return null;
}

/**
 * Sends a message to Taha's Telegram (or Bale, same Bot API) chat. The Bot API answers a wrong token or chat id
 * with an HTTP error and `{ ok: false, description }`, so both are checked. Never throws.
 */
export async function sendBot(bot: Bot, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API[bot.channel]}/bot${bot.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: bot.chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || j?.ok === false) {
      const error = (j?.description || `HTTP ${res.status}`).replaceAll(bot.token, "…").slice(0, 200);
      console.error("[notify] rejected", error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    console.error("[notify] failed", String(e).replaceAll(bot.token, "…"));
    return { ok: false, error: "network" };
  }
}

export async function notifyOwner(text: string): Promise<{ ok: boolean; error?: string }> {
  const bot = await getBot();
  if (!bot) return { ok: false, error: "not configured" };
  return sendBot(bot, text);
}
