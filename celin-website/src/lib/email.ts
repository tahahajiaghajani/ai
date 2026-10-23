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

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** A short branded e-mail (RTL for Persian). */
export function mailHtml(lang: "fa" | "en", paragraphs: string[], link?: { href: string; label: string }): string {
  const dir = lang === "fa" ? "rtl" : "ltr";
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join("");
  const btn = link
    ? `<p style="margin:22px 0"><a href="${escapeHtml(link.href)}" style="display:inline-block;background:#0b0a09;color:#f4ede1;padding:12px 22px;text-decoration:none;letter-spacing:.04em">${escapeHtml(link.label)}</a></p>`
    : "";
  return `<div dir="${dir}" style="background:#f4ede1;padding:32px 16px;font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#1c1916">
<div style="max-width:520px;margin:0 auto;background:#fbf8f2;border:1px solid #e3d9c8;padding:28px">
<p style="margin:0 0 20px;font-family:Georgia,serif;letter-spacing:.3em;color:#9c5e34">CELIN</p>${body}${btn}
<p style="margin:24px 0 0;color:#8a8073;font-size:12px">${lang === "fa" ? "سلین — گالری اعتماد" : "CELIN — Etemad Gallery"}</p></div></div>`;
}
