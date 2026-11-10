// Outside channels: messengers and webhooks (Slack, Microsoft Teams, Mattermost, Telegram, Bale, generic JSON) and
// SMS through a generic HTTP gateway template (Kavenegar, Ghasedak or any other: URL, method, body and headers with
// {{to}} {{text}} {{sender}} {{token}}). Every call has a timeout and a Persian error naming the service; on the web
// version requests go through the SSRF guard (public hosts only, no redirects). Secrets (webhook URLs, bot tokens,
// API keys) are opened with this runtime's key only when a message is sent.
import { createHmac } from "node:crypto";
import { APP_NAME_EN } from "@shared/constants";
import { CHANNEL_KINDS, renderTemplate, type ChannelKind } from "@shared/notify";
import type { Ctx, ServerConfig } from "../../context";
import { pgArray } from "../../db";
import { fetchText, lanAllowed } from "../../net";
import { guardedFetch } from "../ai/net";
import { channelSecret } from "./mail";
import { systemRows } from "./common";
import { assertNotDemoOutbound } from "../../db/scope";

export interface ChannelRow {
  id: string;
  name: string;
  kind: ChannelKind;
  active: boolean;
  principal_id: string | null;
  endpoint: unknown;
  token: unknown;
  chat_id: string | null;
  sms_url: string | null;
  sms_method: "GET" | "POST" | null;
  sms_content_type: "form" | "json" | null;
  sms_sender: string | null;
  sms_body: string | null;
  sms_headers: Record<string, unknown> | null;
}

export async function channelRows(sys: Ctx, ids?: string[]): Promise<ChannelRow[]> {
  if (ids && !ids.length) return [];
  return ids
    ? systemRows<ChannelRow>(sys, "notification_channel", "t.id = any($1::uuid[])", [pgArray(ids)])
    : systemRows<ChannelRow>(sys, "notification_channel", "true", [], "order by t.created_at");
}

/** What a messenger or webhook receives. */
export interface OutsideMessage {
  title: string;
  /** Markdown (Mattermost, the generic webhook) */
  body: string;
  /** one line */
  short: string;
  url: string;
  /** structured facts for the generic webhook */
  meta: Record<string, unknown>;
}

export const TIMEOUT = 15_000;

/**
 * fetch for outside channels: guarded on the web version, the office network allowed on the Windows app and the server
 * edition (whose fetch enforces its air-gap allowlist).
 */
export function channelFetch(cfg: Partial<ServerConfig>): typeof fetch {
  const f = cfg.fetch ?? fetch;
  return lanAllowed(cfg) ? f : guardedFetch(f);
}

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slackEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The request a messenger or webhook channel makes for a message (exported for tests). */
export function outsideRequest(kind: Exclude<ChannelKind, "sms">, endpoint: string | null, token: string | null, chatId: string | null, m: OutsideMessage): { url: string; init: RequestInit } {
  const link = /^https?:\/\//.test(m.url) ? m.url : null;
  switch (kind) {
    case "slack":
      return { url: endpoint!, init: json({ text: `${link ? `<${link}|${slackEsc(m.title)}>` : slackEsc(m.title)}\n${slackEsc(m.short)}` }) };
    case "mattermost":
      return { url: endpoint!, init: json({ text: `**${m.title}**\n\n${m.body}${link ? `\n\n${link}` : ""}` }) };
    case "teams":
      return {
        url: endpoint!,
        init: json({
          type: "message",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: {
                $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                type: "AdaptiveCard",
                version: "1.4",
                rtl: true,
                body: [
                  { type: "TextBlock", text: m.title, weight: "Bolder", wrap: true },
                  { type: "TextBlock", text: m.short, wrap: true },
                ],
                actions: link ? [{ type: "Action.OpenUrl", title: "مشاهده", url: link }] : [],
              },
            },
          ],
        }),
      };
    case "telegram":
    case "bale": {
      const base = kind === "telegram" ? "https://api.telegram.org" : "https://tapi.bale.ai";
      const text = `<b>${htmlEsc(m.title)}</b>\n${htmlEsc(m.short)}${link ? `\n<a href="${htmlEsc(link)}">مشاهده</a>` : ""}`;
      return { url: `${base}/bot${token}/sendMessage`, init: json({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }) };
    }
    case "webhook": {
      const payload = JSON.stringify({ source: APP_NAME_EN, title: m.title, text: m.short, body: m.body, url: link ?? m.url, ...m.meta });
      const headers: Record<string, string> = { "content-type": "application/json", "user-agent": `${APP_NAME_EN}-notifications` };
      if (token) headers["x-signature-256"] = `sha256=${createHmac("sha256", token).update(payload).digest("hex")}`;
      return { url: endpoint!, init: { method: "POST", headers, body: payload } };
    }
  }
}

/** Post a message to a messenger or webhook channel. */
export async function sendOutside(cfg: Partial<ServerConfig> & Pick<ServerConfig, "secret">, orgId: string, ch: ChannelRow, m: OutsideMessage): Promise<string> {
  // nothing of the demo pack leaves the system (docs/DEMO_FA.md)
  assertNotDemoOutbound();
  if (ch.kind === "sms") throw new Error("کانال پیامک برای پیام گروهی نیست");
  const endpoint = channelSecret(cfg, orgId, "notification_channel", "endpoint", ch as unknown as { id: string } & Record<string, unknown>);
  const token = channelSecret(cfg, orgId, "notification_channel", "token", ch as unknown as { id: string } & Record<string, unknown>);
  const needs = CHANNEL_KINDS[ch.kind].needs;
  if (needs.includes("endpoint") && !endpoint) throw new Error(`نشانی وب‌هوک «${ch.name}» تنظیم نشده است`);
  if (needs.includes("token") && !token) throw new Error(`توکن «${ch.name}» تنظیم نشده است`);
  if (needs.includes("chat_id") && !ch.chat_id) throw new Error(`شناسهٔ گفتگوی «${ch.name}» تنظیم نشده است`);
  const req = outsideRequest(ch.kind, endpoint, token, ch.chat_id, m);
  if (!/^https?:\/\//i.test(req.url)) throw new Error(`نشانی «${ch.name}» معتبر نیست`);
  const text = await fetchText(channelFetch(cfg), req.url, `«${ch.name}»`, req.init, TIMEOUT);
  if (ch.kind === "telegram" || ch.kind === "bale") {
    try {
      const r = JSON.parse(text) as { ok?: boolean; description?: string; result?: { message_id?: number } };
      if (r.ok === false) throw new Error(`«${ch.name}»: ${r.description ?? "پیام پذیرفته نشد"}`);
      return String(r.result?.message_id ?? "ok");
    } catch (e) {
      if (e instanceof SyntaxError) return "ok";
      throw e;
    }
  }
  return text.slice(0, 120) || "ok";
}

// ----- SMS ---------------------------------------------------------------------------------------------------------

export interface SmsMessage {
  to: string;
  text: string;
}

/** The HTTP request an SMS gateway template makes (exported for tests). */
export function smsRequest(ch: Pick<ChannelRow, "sms_url" | "sms_method" | "sms_content_type" | "sms_sender" | "sms_body" | "sms_headers">, token: string | null, m: SmsMessage): { url: string; init: RequestInit } {
  const values: Record<string, string> = { to: m.to, text: m.text, sender: ch.sms_sender ?? "", token: token ?? "" };
  const fill = (tpl: string, enc: (s: string) => string) =>
    renderTemplate(tpl, { text: (p) => enc(values[p] ?? ""), raw: (p) => values[p] ?? null }, "plain");
  const url = fill(String(ch.sms_url ?? ""), encodeURIComponent);
  const method = ch.sms_method === "GET" ? "GET" : "POST";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(ch.sms_headers && typeof ch.sms_headers === "object" ? ch.sms_headers : {})) {
    if (/^[A-Za-z0-9-]{1,60}$/.test(k)) headers[k] = fill(String(v), (s) => s.replace(/[\r\n]/g, " "));
  }
  if (method === "GET") return { url, init: { method, headers } };
  const json = ch.sms_content_type === "json";
  const body = fill(String(ch.sms_body ?? ""), json ? (s) => JSON.stringify(s).slice(1, -1) : encodeURIComponent);
  headers["content-type"] = json ? "application/json" : "application/x-www-form-urlencoded";
  return { url, init: { method, headers, body } };
}

/** Send an SMS through a gateway channel; resolves with the gateway's answer (cut). */
export async function sendSms(cfg: Partial<ServerConfig> & Pick<ServerConfig, "secret">, orgId: string, ch: ChannelRow, m: SmsMessage): Promise<string> {
  assertNotDemoOutbound();
  if (!ch.sms_url) throw new Error(`نشانی درگاه پیامک «${ch.name}» تنظیم نشده است`);
  const token = channelSecret(cfg, orgId, "notification_channel", "token", ch as unknown as { id: string } & Record<string, unknown>);
  const req = smsRequest(ch, token, m);
  if (!/^https?:\/\//i.test(req.url)) throw new Error(`نشانی درگاه پیامک «${ch.name}» معتبر نیست`);
  const text = await fetchText(channelFetch(cfg), req.url, `درگاه پیامک «${ch.name}»`, req.init, TIMEOUT);
  return text.slice(0, 120) || "ok";
}

/** Problems of a channel row by field (a hook of notification_channel). */
export function channelProblems(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  const kind = row.kind as ChannelKind;
  if (!(kind in CHANNEL_KINDS)) return { kind: "نوع کانال معتبر نیست" };
  if (kind !== "sms" && !row.principal_id) out.principal_id = "عضوی را انتخاب کنید که پیام‌ها با دسترسی او ساخته شوند";
  if ((kind === "telegram" || kind === "bale") && !String(row.chat_id ?? "").trim()) out.chat_id = "شناسهٔ گفتگو را وارد کنید";
  if (kind === "sms") {
    const url = String(row.sms_url ?? "").trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) out.sms_url = "نشانی درگاه باید با https:// شروع شود";
    if (row.sms_headers !== null && row.sms_headers !== undefined && (typeof row.sms_headers !== "object" || Array.isArray(row.sms_headers))) out.sms_headers = "سرآیندها باید یک شیء JSON باشند";
  }
  return out;
}
