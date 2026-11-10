// Outbound e-mail: the organisation's e-mail channel (SMTP through nodemailer, TLS, timeouts), the Persian RTL HTML
// layout with the product's name, a plain-text alternative, Message-IDs we remember (replies thread back to the
// record, our own messages coming back are dropped) and the headers that keep auto-responders quiet. Markdown is
// rendered here with a small, strict renderer: everything is escaped, links only to http(s)/mailto.
import nodemailer from "nodemailer";
import { uuidv7 } from "@shared/id";
import { APP_NAME } from "@shared/constants";
import type { Ctx, ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { openSecret } from "../../engine";
import { safeExternalUrl, lanAllowed, checkOutboundHost } from "../../net";
import { aiNet, internalAddress } from "../ai/net";
import { systemRows } from "./common";

// ----- channels -------------------------------------------------------------------------------------------------

export interface EmailChannelRow {
  id: string;
  name: string;
  active: boolean;
  is_default: boolean;
  from_name: string | null;
  from_address: string;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: "starttls" | "tls" | "none" | null;
  smtp_user: string | null;
  smtp_password: unknown;
  inbound: boolean;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: "starttls" | "tls" | "none" | null;
  imap_user: string | null;
  imap_password: unknown;
  imap_folder: string | null;
  target_table: string | null;
  allow_list: string[] | null;
  deny_list: string[] | null;
  signature: string | null;
  workspace_id: string | null;
}

/** The e-mail channels of the organisation (active ones first, the default first among them). */
export async function emailChannels(sys: Ctx, q: Queryable = sys.db): Promise<EmailChannelRow[]> {
  return systemRows<EmailChannelRow>(sys, "email_channel", "true", [], "order by t.active desc, t.is_default desc, t.created_at", q);
}

/** The channel notifications go out through: the active default, else the first active one with an SMTP server. */
export async function outboundChannel(sys: Ctx): Promise<EmailChannelRow | null> {
  const all = (await emailChannels(sys)).filter((c) => c.active && c.smtp_host);
  return all.find((c) => c.is_default) ?? all[0] ?? null;
}

/** A secret field of a channel, opened with this runtime's key (null when unset or sealed elsewhere). */
export function channelSecret(cfg: Pick<ServerConfig, "secret">, orgId: string, table: string, field: string, row: { id: string } & Record<string, unknown>): string | null {
  try {
    return openSecret(cfg.secret, orgId, table, field, row.id, row[field]);
  } catch {
    return null;
  }
}

/**
 * The web version talks only to public mail servers (the same rule as AI providers and webhooks): a host that is, or
 * resolves to, a loopback/private/link-local address is refused. The Windows app may use the office's own server.
 */
export async function checkMailHost(cfg: Partial<ServerConfig>, host: string): Promise<void> {
  // the server edition reaches its own network, and air-gapped only the hosts on its allowlist
  if (lanAllowed(cfg)) return checkOutboundHost(cfg.network, host, "سرور ایمیل");
  const h = host.trim().toLowerCase();
  if (!h) throw new Error("نشانی سرور را وارد کنید");
  if (safeExternalUrl(`https://${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}/`)) throw new Error("سرور داخلی در نسخهٔ وب مجاز نیست");
  let addresses: string[];
  try {
    addresses = await aiNet.lookup(h);
  } catch {
    throw new Error(`نشانی سرور پیدا نشد (${h})`);
  }
  if (!addresses.length || addresses.some(internalAddress)) throw new Error("نشانی سرور به یک نشانی داخلی می‌رسد و در نسخهٔ وب مجاز نیست");
}

// ----- transport (tests replace it) ---------------------------------------------------------------------------------

export interface SmtpConfig {
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  user: string | null;
  pass: string | null;
}

export interface MailInput {
  from: { name: string; address: string };
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
}

export interface Transport {
  sendMail(m: Record<string, unknown>): Promise<{ messageId?: string; response?: string; message?: unknown }>;
  close?(): void;
}

export type TransportFactory = (c: SmtpConfig) => Transport;

const smtpTransport: TransportFactory = (c) =>
  nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.security === "tls",
    requireTLS: c.security === "starttls",
    ignoreTLS: c.security === "none",
    auth: c.user ? { user: c.user, pass: c.pass ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    dnsTimeout: 10_000,
    tls: { minVersion: "TLSv1.2", servername: c.host },
  }) as unknown as Transport;

let factory: TransportFactory = smtpTransport;

/** Replace how messages are sent (tests: a stream transport that keeps the raw message). Null restores SMTP. */
export function setTransportFactory(f: TransportFactory | null): void {
  factory = f ?? smtpTransport;
}

export function smtpOf(cfg: Pick<ServerConfig, "secret">, orgId: string, ch: EmailChannelRow): SmtpConfig {
  return {
    host: String(ch.smtp_host ?? "").trim(),
    port: Number(ch.smtp_port) || (ch.smtp_security === "tls" ? 465 : 587),
    security: ch.smtp_security ?? "starttls",
    user: ch.smtp_user || null,
    pass: channelSecret(cfg, orgId, "email_channel", "smtp_password", ch as unknown as { id: string } & Record<string, unknown>),
  };
}

/** The domain of our Message-IDs: the sender's own. */
export const mailDomain = (address: string) => (address.split("@")[1] || "localhost").toLowerCase().replace(/[^a-z0-9.-]/g, "");

export const newMessageId = (address: string) => `<n.${uuidv7()}@${mailDomain(address)}>`;
/** The thread every notification about one record belongs to (mail clients group them). */
export const threadId = (recordId: string, address: string) => `<r.${recordId}@${mailDomain(address)}>`;

/** Headers of every message we send: an automatic message; out-of-office replies are not wanted. */
export const AUTO_HEADERS: Record<string, string> = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
  "X-ITSM-Notification": "1",
};

/** Send one message through a channel; resolves with the provider's answer (throws its error). */
export async function sendMail(cfg: Partial<ServerConfig> & Pick<ServerConfig, "secret">, orgId: string, ch: EmailChannelRow, m: MailInput): Promise<{ messageId: string; response: string; raw?: unknown }> {
  const smtp = smtpOf(cfg, orgId, ch);
  if (!smtp.host) throw new Error("سرور SMTP کانال ایمیل تنظیم نشده است");
  if (factory === smtpTransport) await checkMailHost(cfg, smtp.host);
  const t = factory(smtp);
  try {
    const info = await t.sendMail({
      from: { name: m.from.name, address: m.from.address },
      to: m.to,
      replyTo: m.replyTo || undefined,
      subject: m.subject,
      text: m.text,
      html: m.html,
      messageId: m.messageId,
      inReplyTo: m.inReplyTo || undefined,
      references: m.references?.length ? m.references : undefined,
      headers: { ...AUTO_HEADERS, ...(m.headers ?? {}) },
      textEncoding: "base64",
    });
    return { messageId: info.messageId ?? m.messageId, response: String(info.response ?? "ok"), raw: info.message };
  } finally {
    t.close?.();
  }
}

/** Remember a message we sent (threading and loop protection). */
export async function rememberOutbound(q: Queryable, x: { org: string; channel: string | null; messageId: string; to: string; subject: string; table?: string | null; record?: string | null; status: "sent" | "failed"; reason?: string | null }): Promise<void> {
  await q.query(
    `insert into sm_email_messages (id, org_id, channel_id, direction, message_id, to_addrs, subject, table_key, record_id, status, reason)
     values ($1, $2, $3, 'out', $4, $5, $6, $7, $8, $9, $10) on conflict (org_id, message_id, direction) do nothing`,
    [uuidv7(), x.org, x.channel, x.messageId, x.to.slice(0, 500), x.subject.slice(0, 500), x.table ?? null, x.record ?? null, x.status, x.reason ?? null],
  );
}

// ----- Markdown → HTML / text -----------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHref = (u: string) => /^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(u);

const FONT = "Vazirmatn, Tahoma, 'Segoe UI', Arial, sans-serif";
// E-mail clients ignore style sheets and CSS variables: the layout's few colours are literal here (the design system's
// neutral greys and its primary blue), nowhere else.
const C = { page: "#f4f5f7", card: "#ffffff", line: "#e5e7eb", text: "#1f2937", muted: "#6b7280", faint: "#9ca3af", accent: "#2b4c7e", code: "#f3f4f6" };

function inline(src: string): string {
  const stash: { html: string; raw: string }[] = [];
  const keep = (html: string, raw = "") => `\u0000${stash.push({ html, raw }) - 1}\u0000`;
  const restoreRaw = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)].raw);
  let s = src;
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => keep(`<code dir="ltr" style="background:${C.code};padding:1px 4px;border-radius:4px;font-family:Consolas,monospace;font-size:13px;">${esc(c)}</code>`, c));
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>=])/g, (_m, c: string) => keep(esc(c), c));
  s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (_m, u: string) => keep(`<a href="${esc(u)}" style="color:${C.accent};" dir="ltr">${esc(u)}</a>`, u));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const u = restoreRaw(url);
    if (!safeHref(u)) return text;
    return `${keep(`<a href="${esc(u)}" style="color:${C.accent};">`)}${text}${keep("</a>")}`;
  });
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?![\w*])/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w؀-ۿ])_(?=\S)([^_\n]+?)_(?![\w؀-ۿ])/g, "$1<em>$2</em>");
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (_m, pre: string, u: string) => `${pre}<a href="${u}" style="color:${C.accent};" dir="ltr">${u}</a>`);
  for (let i = 0; i < 3 && /\u0000\d+\u0000/.test(s); i++) s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => stash[Number(n)].html);
  return s;
}

/** Strict Markdown → HTML for e-mails: paragraphs, headings, lists, quotes, code, bold/italic, safe links. */
export function markdownToHtml(md: string): string {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const P = `margin:0 0 12px;`;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre dir="ltr" style="${P}background:${C.code};padding:8px 10px;border-radius:6px;overflow:auto;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;">${esc(body.join("\n"))}</pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = [0, 18, 16, 15][h[1].length];
      out.push(`<h${h[1].length} style="margin:4px 0 10px;font-size:${size}px;">${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(`<hr style="border:0;border-top:1px solid ${C.line};margin:12px 0;">`);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote style="${P}padding:4px 12px;border-inline-start:3px solid ${C.line};border-right:3px solid ${C.line};color:${C.muted};">${markdownToHtml(body.join("\n"))}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/;
    const ol = /^\s*\d+[.)]\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line) && !ul.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(`<li style="margin:2px 0;">${inline(re.exec(lines[i++])![1])}</li>`);
      out.push(`<${ordered ? "ol" : "ul"} style="${P}padding-inline-start:20px;padding-right:20px;">${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(`<p style="${P}">${para.map((l) => inline(l.replace(/\s{2,}$/, ""))).join("<br>")}</p>`);
  }
  return out.join("\n");
}

/** Markdown → readable plain text (the text/plain part, SMS bodies). */
export function markdownToText(md: string): string {
  return String(md ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^```.*$/gm, "")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => (t === u ? u : `${t} (${u})`))
    .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>=])/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface LayoutInput {
  title: string;
  bodyHtml: string;
  orgName: string;
  url?: string | null;
  action?: string | null;
  signatureHtml?: string | null;
  /** the footer says that replying adds the reply to the record */
  replies?: boolean;
}

/** The Persian, right-to-left HTML e-mail around a message (tables and inline styles: what mail clients render). */
export function emailLayout(x: LayoutInput): string {
  const cell = `font-family:${FONT};`;
  const button =
    x.url && safeHref(x.url)
      ? `<tr><td style="padding:4px 24px 20px;${cell}"><a href="${esc(x.url)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;${cell}">${esc(x.action || `مشاهده در ${APP_NAME}`)}</a></td></tr>`
      : "";
  const signature = x.signatureHtml ? `<tr><td style="padding:0 24px 12px;${cell}font-size:14px;color:${C.muted};line-height:1.9;">${x.signatureHtml}</td></tr>` : "";
  const footer = `این پیام را ${esc(APP_NAME)} فرستاده است.${x.replies ? " برای افزودن پاسخ به همین رکورد، به این ایمیل پاسخ دهید." : ""} اعلان‌هایی را که می‌گیرید در «اعلان‌های من» تغییر دهید.`;
  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(x.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};" dir="rtl"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:12px;text-align:right;">
<tr><td style="padding:18px 24px 4px;${cell}font-size:13px;color:${C.muted};">${esc(APP_NAME)} · ${esc(x.orgName)}</td></tr>
<tr><td style="padding:4px 24px 0;${cell}font-size:18px;font-weight:bold;color:${C.text};line-height:1.7;">${esc(x.title)}</td></tr>
<tr><td style="padding:12px 24px 4px;${cell}font-size:15px;color:${C.text};line-height:1.9;">${x.bodyHtml}</td></tr>
${button}
${signature}
<tr><td style="padding:12px 24px 18px;border-top:1px solid ${C.line};${cell}font-size:12px;color:${C.faint};line-height:1.8;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

/** The subject of a message about a record: its number in brackets, so a reply threads back to it. */
export function withNumber(subject: string, number: string | null): string {
  const s = subject.replace(/[\r\n]+/g, " ").trim();
  if (!number || s.includes(`[${number}]`)) return s.slice(0, 250);
  return `${s.slice(0, 230)} [${number}]`;
}
