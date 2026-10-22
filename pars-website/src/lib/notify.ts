import "server-only";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { NotifySettings } from "@/lib/settings-types";

/** Sends a message to the team's Telegram or Bale chat (Bale uses the same Bot API). */
export async function notifyTeam(n: NotifySettings, text: string): Promise<void> {
  if (n.channel === "none" || !n.chatId) return;
  const token = decrypt(n.botTokenEnc);
  if (!token) return;
  const base = n.channel === "bale" ? "https://tapi.bale.ai" : "https://api.telegram.org";
  try {
    await fetch(`${base}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: n.chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("[notify] team message failed", e);
  }
}

export function canEmail(): boolean {
  return Boolean(env.resendKey && env.mailFrom);
}

/** Optional customer e-mail through Resend (free tier) when RESEND_API_KEY and MAIL_FROM are set. */
export async function emailCustomer(to: string, subject: string, html: string): Promise<void> {
  if (!canEmail()) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.resendKey}` },
      body: JSON.stringify({ from: env.mailFrom, to: [to], subject, html }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("[notify] e-mail failed", e);
  }
}
