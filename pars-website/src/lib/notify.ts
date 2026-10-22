import "server-only";
import { decrypt } from "@/lib/crypto";
import { emailConfig, sendEmail } from "@/lib/email";
import type { NotifySettings } from "@/lib/settings-types";

/**
 * Sends a message to the team's Telegram or Bale chat (Bale uses the same Bot API).
 * The Bot API answers a wrong token or chat id with an HTTP error and `{ ok: false, description }`, so both are checked.
 */
export async function notifyTeam(n: NotifySettings, text: string): Promise<{ ok: boolean; error?: string }> {
  if (n.channel === "none" || !n.chatId) return { ok: false, error: "not configured" };
  const token = decrypt(n.botTokenEnc);
  if (!token) return { ok: false, error: "not configured" };
  const base = n.channel === "bale" ? "https://tapi.bale.ai" : "https://api.telegram.org";
  try {
    const res = await fetch(`${base}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: n.chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
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

/** Customer e-mail is configured (Resend key and sender from Admin → Connections, or RESEND_API_KEY / MAIL_FROM). */
export async function canEmail(): Promise<boolean> {
  return Boolean(await emailConfig());
}

/** Optional customer e-mail through Resend (free tier). Failures are logged, never thrown. */
export async function emailCustomer(to: string, subject: string, html: string): Promise<void> {
  const cfg = await emailConfig();
  if (!cfg) return;
  const r = await sendEmail(to, subject, html, cfg);
  if (!r.ok) console.error("[notify] e-mail rejected", r.error);
}
