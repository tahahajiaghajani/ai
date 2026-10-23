import "server-only";
import { decrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import type { SmsSettings } from "@/lib/settings-types";

/**
 * Optional text messages to members (the Pro code, order status changes) through an Iranian SMS provider.
 * SMS.ir answers requests from servers abroad (Vercel); most others (Kavenegar included) reset them.
 * - SMS.ir with an approved template (recommended; works on the shared line):
 *   POST https://api.sms.ir/v1/send/verify, header X-API-KEY, { mobile, templateId, parameters: [{ name, value }] } → { status: 1 }
 * - SMS.ir free text (needs a dedicated line): POST /v1/send/bulk { lineNumber, messageText, mobiles } → { status: 1 }
 * - Kavenegar: POST https://api.kavenegar.com/v1/{key}/sms/send.json (receptor, message, sender?) → { return: { status: 200 } }
 * Never throws; the result says what happened (shown by the admin's "test" button).
 */

export type SmsMessage =
  | { kind: "code"; code: string; text: string }
  | { kind: "status"; order: string; status: string; text: string }
  | { kind: "test"; text: string };

type Out = { ok: boolean; error?: string };

async function smsir(key: string, path: string, body: unknown): Promise<Out> {
  const res = await fetch(`https://api.sms.ir/v1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const j = (await res.json().catch(() => null)) as { status?: number; message?: string } | null;
  if (res.ok && j?.status === 1) return { ok: true };
  return { ok: false, error: `${j?.status ?? res.status} ${j?.message ?? ""}`.trim().slice(0, 200) };
}

export async function sendSms(phone: string, msg: SmsMessage | string, s?: SmsSettings): Promise<Out> {
  const cfg = s ?? (await getSettings()).sms;
  const m: SmsMessage = typeof msg === "string" ? { kind: "test", text: msg } : msg;
  const key = decrypt(cfg.apiKeyEnc);
  if (cfg.provider === "none" || !key) return { ok: false, error: "not configured" };
  if (!/^09\d{9}$/.test(phone)) return { ok: false, error: "invalid number" };
  try {
    if (cfg.provider === "smsir") {
      const template = m.kind === "code" ? cfg.codeTemplate : m.kind === "status" ? cfg.statusTemplate : cfg.codeTemplate;
      if (template && /^\d+$/.test(template)) {
        const parameters =
          m.kind === "code" ? [{ name: "CODE", value: m.code }]
          : m.kind === "status" ? [{ name: "ORDER", value: m.order }, { name: "STATUS", value: m.status }]
          : [{ name: "CODE", value: "1234 5678 9012" }];
        return await smsir(key, "send/verify", { mobile: phone, templateId: Number(template), parameters });
      }
      if (!cfg.sender) return { ok: false, error: "no template id and no line number" };
      return await smsir(key, "send/bulk", { lineNumber: Number(cfg.sender) || cfg.sender, messageText: m.text.slice(0, 600), mobiles: [phone] });
    }
    const body = new URLSearchParams({ receptor: phone, message: m.text.slice(0, 600) });
    if (cfg.sender) body.set("sender", cfg.sender);
    const res = await fetch(`https://api.kavenegar.com/v1/${encodeURIComponent(key)}/sms/send.json`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const j = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
    if (res.ok && j?.return?.status === 200) return { ok: true };
    return { ok: false, error: `${j?.return?.status ?? res.status} ${j?.return?.message ?? ""}`.trim().slice(0, 200) };
  } catch (e) {
    console.error("[sms] failed", e);
    return { ok: false, error: String(e).replaceAll(key, "…").slice(0, 200) };
  }
}
