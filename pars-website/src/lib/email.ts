import "server-only";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";

/** Resend key and sender: the admin panel value wins over RESEND_API_KEY / MAIL_FROM. */
export async function emailConfig(): Promise<{ key: string; from: string } | null> {
  const { email } = await getSettings();
  const key = decrypt(email.resendKeyEnc) || env.resendKey;
  const from = email.mailFrom || env.mailFrom;
  return key && from ? { key, from } : null;
}

/** Sends one e-mail through Resend (free tier: 3,000 a month). Never throws. */
export async function sendEmail(to: string, subject: string, html: string, config?: { key: string; from: string } | null): Promise<{ ok: boolean; error?: string }> {
  const cfg = config === undefined ? await emailConfig() : config;
  if (!cfg) return { ok: false, error: "not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ from: cfg.from, to: [to], subject, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    // e.g. 403 for a sender domain that is not verified in Resend
    const body = (await res.text().catch(() => "")).slice(0, 300);
    console.error("[email] rejected", res.status, body);
    let msg = body;
    try {
      msg = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {
      // keep the raw body
    }
    return { ok: false, error: `HTTP ${res.status} ${msg}`.slice(0, 240) };
  } catch (e) {
    console.error("[email] failed", e);
    return { ok: false, error: String(e).replaceAll(cfg.key, "…").slice(0, 200) };
  }
}
