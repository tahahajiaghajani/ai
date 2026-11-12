// Messaging connectors (PTL-019 omnichannel intake, PTL-022 Iranian messengers): a Telegram or Bale bot, or a generic
// signed webhook (an SMS gateway, an Eitaa or Rubika bridge, any system), feeding the SAME virtual agent conversations
// and tickets as the portal.
//   · receiving — POST /api/public/portal/hooks/:key (public, rate limited per client and per connector): the key
//     finds the connector, the delivery must prove the connector's secret (Telegram/Bale: the X-Telegram-Bot-Api-
//     Secret-Token header set with setWebhook; the generic webhook: an HMAC-SHA256 of the raw body; «فقط کلید نشانی»
//     only when an administrator chose it), a messenger's retry is dropped by the log's unique key, group chats are
//     ignored unless allowed, each chat is held to its per-minute budget; the message is queued and the webhook
//     answers at once (`portal.channel.message` does the work).
//   · identity — a chat user is a member only after an explicit link: the member asks the portal for a one-time code
//     (8 characters, 10 minutes, stored as a hash, one live code per member) and sends «/link CODE» (or opens the bot's
//     deep link). Never by name or phone. Failed codes are counted per chat (5 in 15 minutes stop the attempts).
//     A member who leaves or is deactivated loses the link at their next message.
//   · conversing — the linked member's message runs through the virtual agent with THEIR context (`vaStart`/`vaSend`,
//     channel «messenger»): cited answers, the status of their own tickets, ordering, reporting, handoff. The reply is
//     plain text with numbered options (and a reply keyboard on Telegram and Bale); «۲» picks the second option.
//   · sending — through the runtime's guarded fetch (public hosts only on the web version), 15 s timeout.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CODE_ALPHABET, CODE_LENGTH, CODE_MINUTES, commandOf, formatCode, inputFromText, linkCommand, parseGenericMessage, parseTelegramUpdate, replyForText, replyKeyboard, type ChannelOption, type InboundMessage } from "@shared/portal/logic";
import type { IdentityView, LinkCodeView } from "@shared/portal/api";
import { uuidv7 } from "@shared/id";
import type { VaReply } from "@shared/ai/va";
import type { Ctx, ServerConfig } from "../../context";
import { createIn, defFor, readSecret, removeIn, systemCtx, updateIn } from "../../engine";
import { enqueue, registerJobHandler, type Job, type JobContext } from "../../jobs";
import { AppError, bad, forbidden, notFound, unauthorized } from "../../http/errors";
import { memberCtx } from "../../access";
import { fetchText } from "../../net";
import { channelFetch } from "../notify/channels";
import { vaHandoff, vaSend, vaStart } from "../ai/va";
import { isUuid, liveRow, liveRows, managesChannels, sysOf, type Row } from "./common";
import { demoPeople, demoScopeOrg } from "../../db/scope";

export const JOB_MESSAGE = "portal.channel.message";
const TIMEOUT = 15_000;
/** The largest delivery accepted (bytes of the raw body). */
export const MAX_HOOK_BYTES = 256_000;
const API_BASE: Record<string, string> = { telegram: "https://api.telegram.org", bale: "https://tapi.bale.ai" };

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const sameSecret = (a: string, b: string) => {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y) && a.length === b.length;
};
const codeHash = (orgId: string, code: string) => sha256(`portal.link:${orgId}:${code}`);
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------------------------
// The log (sm_portal_channel_log)

interface LogInput {
  channel: string;
  direction: "in" | "out";
  status: string;
  key?: string | null;
  external?: string | null;
  user?: string | null;
  text?: string | null;
  conversation?: string | null;
  error?: string | null;
}

/** Write a log row; for a received message, null when its key was seen already (a retry). */
async function logRow(q: Ctx["db"], orgId: string, e: LogInput): Promise<string | null> {
  const id = uuidv7();
  const r = await q.one<{ id: string }>(
    `insert into sm_portal_channel_log (id, org_id, channel_id, direction, status, message_key, external_id, user_id, text, conversation_id, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict do nothing returning id`,
    [id, orgId, e.channel, e.direction, e.status, e.key ? String(e.key).slice(0, 120) : null, e.external ? String(e.external).slice(0, 80) : null, isUuid(e.user) ? e.user : null, e.text ? String(e.text).slice(0, 4000) : null, isUuid(e.conversation) ? e.conversation : null, e.error ? String(e.error).slice(0, 500) : null],
  );
  return r?.id ?? null;
}

const setLog = (q: Ctx["db"], orgId: string, id: string, values: { status: string; user?: string | null; conversation?: string | null; error?: string | null }) =>
  q.query(`update sm_portal_channel_log set status = $3, user_id = coalesce($4, user_id), conversation_id = coalesce($5, conversation_id), error = $6 where org_id = $1 and id = $2`, [orgId, id, values.status, isUuid(values.user) ? values.user : null, isUuid(values.conversation) ? values.conversation : null, values.error ? values.error.slice(0, 500) : null]);

// ---------------------------------------------------------------------------------------------------------------
// Administration (connectors are web-version rows; integrations writers)

async function needAdmin(ctx: Ctx): Promise<void> {
  if (!(await managesChannels(ctx))) throw forbidden("کانال‌های پیام‌رسان را مدیران اتصال‌ها تنظیم می‌کنند");
}

/** The connector's webhook address (absolute when the web version's address is known). */
export function hookUrl(cfg: Partial<ServerConfig>, key: string): string {
  return `${(cfg.publicUrl ?? "").replace(/\/+$/, "")}/api/public/portal/hooks/${key}`;
}

/** A new webhook secret (shown once) and the webhook key when the connector has none. */
export async function newChannelSecret(ctx: Ctx, channelId: string): Promise<{ secret: string; webhook_url: string }> {
  await needAdmin(ctx);
  if (ctx.cfg.mode === "desktop") throw bad("کانال‌های پیام‌رسان فقط در نسخهٔ وب پیام می‌گیرند");
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, "portal_channel", channelId);
  if (!row) throw notFound("کانال پیدا نشد");
  const secret = randomBytes(24).toString("base64url");
  const key = typeof row.hook_key === "string" && row.hook_key ? row.hook_key : randomBytes(18).toString("base64url");
  await ctx.write((tx) => updateIn(tx, sys, "portal_channel", channelId, { secret, hook_key: key, registered_at: null }, { trusted: true }));
  return { secret, webhook_url: hookUrl(ctx.cfg, key) };
}

/** A new webhook address (the old one stops answering at once). */
export async function rotateChannelKey(ctx: Ctx, channelId: string): Promise<{ webhook_url: string }> {
  await needAdmin(ctx);
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, "portal_channel", channelId);
  if (!row) throw notFound("کانال پیدا نشد");
  const key = randomBytes(18).toString("base64url");
  await ctx.write((tx) => updateIn(tx, sys, "portal_channel", channelId, { hook_key: key, registered_at: null }, { trusted: true }));
  return { webhook_url: hookUrl(ctx.cfg, key) };
}

/** Telegram/Bale: tell the messenger where to deliver (setWebhook with the secret token). */
export async function registerChannelWebhook(ctx: Ctx, channelId: string): Promise<{ ok: boolean; message: string }> {
  await needAdmin(ctx);
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, "portal_channel", channelId);
  if (!row) throw notFound("کانال پیدا نشد");
  const base = API_BASE[String(row.kind)];
  if (!base) throw bad("وب‌هوک عمومی را سامانهٔ فرستنده با همین نشانی و راز تنظیم می‌کند");
  if (!ctx.cfg.publicUrl) throw bad("نشانی عمومی نسخهٔ وب (PUBLIC_URL) تنظیم نشده است");
  const { def } = await defFor(sys, "portal_channel");
  const token = await readSecret(ctx.db, sys, def, channelId, "token");
  const secret = await readSecret(ctx.db, sys, def, channelId, "secret");
  if (!token) throw bad("توکن ربات را وارد کنید");
  if (!secret || !row.hook_key) throw bad("نخست «ساخت راز وب‌هوک» را بزنید");
  const body = { url: hookUrl(ctx.cfg, String(row.hook_key)), secret_token: secret, allowed_updates: ["message", "edited_message", "callback_query"], drop_pending_updates: true };
  const text = await fetchText(channelFetch(ctx.cfg), `${base}/bot${token}/setWebhook`, `«${row.name}»`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, TIMEOUT);
  let ok = false;
  let message = "پاسخ پیام‌رسان خوانده نشد";
  try {
    const r = JSON.parse(text) as { ok?: boolean; description?: string };
    ok = r.ok === true;
    message = ok ? "وب‌هوک ثبت شد" : (r.description ?? "پیام‌رسان نپذیرفت");
  } catch {
    /* keep the message */
  }
  if (ok) await ctx.write((tx) => updateIn(tx, sys, "portal_channel", channelId, { registered_at: nowIso(), last_error: null }, { trusted: true }));
  return { ok, message };
}

/** The connector's recent deliveries (administrators; chat ids shown only by their last digits). */
export async function channelLog(ctx: Ctx, channelId: string, limit = 100): Promise<{ items: { at: string; direction: string; status: string; chat: string | null; user: string | null; text: string | null; error: string | null }[]; display: Record<string, string> }> {
  await needAdmin(ctx);
  const rows = await ctx.db.query<Row>(`select at, direction, status, external_id, user_id, text, error from sm_portal_channel_log where org_id = $1 and channel_id = $2 order by at desc limit $3`, [ctx.org.id, channelId, Math.min(500, Math.max(1, limit))]);
  const users = [...new Set(rows.map((r) => r.user_id).filter(isUuid))];
  const display: Record<string, string> = {};
  if (users.length) for (const u of await ctx.db.query<{ id: string; full_name: string | null; email: string }>(`select id, full_name, email from sm_users where id = any($1::uuid[])`, [users])) display[u.id] = u.full_name || u.email;
  return {
    items: rows.map((r) => ({ at: r.at instanceof Date ? r.at.toISOString() : String(r.at), direction: String(r.direction), status: String(r.status), chat: r.external_id ? `…${String(r.external_id).slice(-4)}` : null, user: r.user_id ?? null, text: r.text ? String(r.text).slice(0, 200) : null, error: r.error ?? null })),
    display,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Linking (the member's side)

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** The demo pack's accounts are never linked to a messenger: whatever the assistant tells them would leave the system. */
const DEMO_UNLINKED = "حساب‌های نمایشی به پیام‌رسان وصل نمی‌شوند.";

/** A fresh one-time code for the caller (their earlier unused codes stop working). */
export async function newLinkCode(ctx: Ctx): Promise<LinkCodeView> {
  if (ctx.actor === "system") throw forbidden();
  // nothing of the demo pack leaves the system (docs/DEMO_FA.md): a demo account gets no messenger
  if (demoScopeOrg() === ctx.org.id || ctx.user.prefs?.demo_org === ctx.org.id) throw forbidden(DEMO_UNLINKED);
  const sys = sysOf(ctx);
  const code = randomCode();
  const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  await ctx.write(async (tx) => {
    for (const old of await liveRows(tx, sys, "portal_link_code", { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { f: "used_at", op: "empty" }] }, { limit: 50 })) {
      await updateIn(tx, sys, "portal_link_code", String(old.id), { used_at: nowIso() }, { trusted: true });
    }
    await createIn(tx, sys, "portal_link_code", { user_id: ctx.user.id, code_hash: codeHash(ctx.org.id, code), expires_at: expires }, { trusted: true });
  }, { internal: true });
  const channels = await liveRows(ctx.db, sys, "portal_channel", { f: "active", op: "eq", v: true }, { order: "t.name", limit: 20 });
  return {
    code: formatCode(code),
    expires_at: expires,
    channels: channels.map((c) => ({
      id: String(c.id),
      name: String(c.name),
      kind: String(c.kind),
      deep_link: c.bot_username && /^[A-Za-z0-9_]{3,64}$/.test(String(c.bot_username)) ? (c.kind === "bale" ? `https://ble.ir/${c.bot_username}?start=${code}` : c.kind === "telegram" ? `https://t.me/${c.bot_username}?start=${code}` : null) : null,
    })),
  };
}

/** The caller's linked messenger accounts. */
export async function myIdentities(ctx: Ctx): Promise<IdentityView[]> {
  if (ctx.actor === "system") return [];
  const sys = sysOf(ctx);
  const rows = await liveRows(ctx.db, sys, "portal_channel_identity", { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { f: "active", op: "eq", v: true }] }, { order: "t.linked_at desc", limit: 20 });
  const channels = new Map((await liveRows(ctx.db, sys, "portal_channel", null, { limit: 50 })).map((c) => [String(c.id), c]));
  return rows.map((r) => ({ id: String(r.id), channel_name: String(channels.get(String(r.channel_id))?.name ?? "—"), kind: String(channels.get(String(r.channel_id))?.kind ?? ""), external_name: (r.external_name as string) ?? null, linked_at: (r.linked_at as string) ?? null }));
}

/** Unlink one of the caller's accounts (administrators may unlink anyone's). */
export async function unlinkIdentity(ctx: Ctx, id: string): Promise<void> {
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, "portal_channel_identity", id);
  if (!row || (row.user_id !== ctx.user.id && !(await managesChannels(ctx)))) throw notFound("حساب پیدا نشد");
  await ctx.write((tx) => updateIn(tx, sys, "portal_channel_identity", id, { active: false, conversation_id: null, options: null }, { trusted: true }), { internal: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Receiving (public)

export type HeaderFn = (name: string) => string | undefined;

/** The connector a webhook key names (web version rows, as the system). */
async function channelByKey(cfg: ServerConfig, key: string): Promise<{ sys: Ctx; channel: Row } | null> {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) return null;
  const hit = await cfg.db.one<{ id: string; org_id: string }>(`select id, org_id from sm_portal_channels where hook_key = $1 and deleted_at is null limit 1`, [key]);
  if (!hit) return null;
  const sys = await systemCtx(cfg, hit.org_id);
  const channel = await liveRow(sys.db, sys, "portal_channel", hit.id);
  return channel ? { sys, channel } : null;
}

/** Does the delivery prove the connector's secret? */
export function verifyHook(mode: string, secret: string | null, raw: string, h: HeaderFn): boolean {
  if (mode === "path") return true;
  if (!secret) return false;
  if (mode === "hmac") {
    const v = (h("x-signature-256") ?? h("x-itsm-signature") ?? "").trim();
    const sig = v.toLowerCase().startsWith("sha256=") ? v.slice(7) : v;
    return /^[0-9a-f]{64}$/i.test(sig) && sameSecret(sig.toLowerCase(), createHmac("sha256", secret).update(raw, "utf8").digest("hex"));
  }
  const token = (h("x-telegram-bot-api-secret-token") ?? "").trim();
  return !!token && sameSecret(token, secret);
}

/** Receive one delivery (see the file's head): verify, drop retries and group chats, budget per chat, queue. */
export async function receiveHook(cfg: ServerConfig, key: string, h: HeaderFn, raw: string): Promise<{ ok: true; status: string }> {
  if (Buffer.byteLength(raw, "utf8") > MAX_HOOK_BYTES) throw new AppError(413, "too_large", "حجم پیام بیش از اندازه است");
  const found = await channelByKey(cfg, key);
  if (!found) throw notFound("کانال پیدا نشد");
  const { sys, channel } = found;
  if (channel.active === false) throw new AppError(410, "gone", "این کانال غیرفعال است");
  const { def } = await defFor(sys, "portal_channel");
  const secret = await readSecret(sys.db, sys, def, String(channel.id), "secret");
  if (!verifyHook(String(channel.auth_mode ?? "header"), secret, raw, h)) throw unauthorized("امضای درخواست معتبر نیست");
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw bad("بدنهٔ درخواست JSON نیست");
  }
  const msg: InboundMessage | null = channel.kind === "webhook" ? parseGenericMessage(payload) : parseTelegramUpdate(payload);
  const channelId = String(channel.id);
  if (!msg || !msg.text.trim()) return { ok: true, status: "ignored" };
  if (!msg.private && channel.allow_groups !== true) {
    await logRow(sys.db, sys.org.id, { channel: channelId, direction: "in", status: "ignored", key: msg.key || null, external: msg.chatId, error: "گفتگوی گروهی" });
    return { ok: true, status: "ignored" };
  }
  const budget = Math.max(1, Number(channel.rate_per_minute ?? 12));
  const recent = await sys.db.one<{ n: string | number }>(`select count(*) as n from sm_portal_channel_log where org_id = $1 and channel_id = $2 and direction = 'in' and external_id = $3 and message_key is not null and status <> 'rate_limited' and at > now() - interval '1 minute'`, [sys.org.id, channelId, msg.fromId]);
  if (Number(recent?.n ?? 0) >= budget) {
    await logRow(sys.db, sys.org.id, { channel: channelId, direction: "in", status: "rate_limited", key: msg.key ? `${msg.key}:rl` : null, external: msg.fromId });
    return { ok: true, status: "rate_limited" };
  }
  // a delivery without an id of its own is never a duplicate, but still counts against the chat's budget
  const logId = await logRow(sys.db, sys.org.id, { channel: channelId, direction: "in", status: "received", key: msg.key || `nokey:${uuidv7()}`, external: msg.fromId, text: msg.text });
  if (!logId) return { ok: true, status: "duplicate" };
  await sys.write(async (tx) => {
    await updateIn(tx, sys, "portal_channel", channelId, { last_in_at: nowIso(), received_count: Number(channel.received_count ?? 0) + 1 }, { trusted: true, keepVersion: true });
    await enqueue(tx, { kind: JOB_MESSAGE, orgId: sys.org.id, payload: { channel: channelId, log: logId, chat: msg.chatId, from: msg.fromId, name: msg.fromName }, maxAttempts: 3, dedupeKey: `portal.msg:${logId}` });
  }, { internal: true });
  return { ok: true, status: "queued" };
}

// ---------------------------------------------------------------------------------------------------------------
// Sending

async function send(cfg: ServerConfig, sys: Ctx, channel: Row, chatId: string, text: string, options: ChannelOption[]): Promise<void> {
  const { def } = await defFor(sys, "portal_channel");
  const kind = String(channel.kind);
  const f = channelFetch(cfg);
  const label = `«${channel.name}»`;
  if (kind === "telegram" || kind === "bale") {
    const token = await readSecret(sys.db, sys, def, String(channel.id), "token");
    if (!token) throw new Error(`توکن ${label} تنظیم نشده است`);
    const body = { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true, reply_markup: replyKeyboard(options) };
    const res = await fetchText(f, `${API_BASE[kind]}/bot${token}/sendMessage`, label, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, TIMEOUT);
    try {
      const r = JSON.parse(res) as { ok?: boolean; description?: string };
      if (r.ok === false) throw new Error(`${label}: ${r.description ?? "پیام پذیرفته نشد"}`);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }
    return;
  }
  const url = String(channel.outbound_url ?? "");
  if (!/^https?:\/\//i.test(url)) throw new Error(`نشانی ارسال ${label} تنظیم نشده است`);
  const payload = JSON.stringify({ chat_id: chatId, text, options: options.map((o) => ({ n: o.n, label: o.label })) });
  const secret = await readSecret(sys.db, sys, def, String(channel.id), "secret");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers["x-signature-256"] = `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
  await fetchText(f, url, label, { method: "POST", headers, body: payload }, TIMEOUT);
}

async function reply(cfg: ServerConfig, sys: Ctx, channel: Row, chatId: string, user: string | null, text: string, options: ChannelOption[] = [], conversation: string | null = null): Promise<void> {
  try {
    await send(cfg, sys, channel, chatId, text, options);
    await logRow(sys.db, sys.org.id, { channel: String(channel.id), direction: "out", status: "sent", external: chatId, user, text: text.slice(0, 500), conversation });
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 500);
    await logRow(sys.db, sys.org.id, { channel: String(channel.id), direction: "out", status: "failed", external: chatId, user, error: message, conversation });
    await sys.write((tx) => updateIn(tx, sys, "portal_channel", String(channel.id), { failed_count: Number(channel.failed_count ?? 0) + 1, last_error: message }, { trusted: true, keepVersion: true }), { internal: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Processing one message (the job)

const LINK_HELP = "برای گفتگو با دستیار، نخست حسابتان را وصل کنید: در درگاه خدمات به «نمایهٔ من › اتصال پیام‌رسان» بروید، کد بگیرید و آن را این‌جا بفرستید، مثلاً: /link ABCD-EFGH";

async function linkWith(sys: Ctx, channel: Row, msg: { chat: string; from: string; name: string }, code: string): Promise<{ ok: boolean; text: string; user: string | null }> {
  const failed = await sys.db.one<{ n: string | number }>(`select count(*) as n from sm_portal_channel_log where org_id = $1 and channel_id = $2 and external_id = $3 and error = 'bad_code' and at > now() - interval '15 minutes'`, [sys.org.id, String(channel.id), msg.from]);
  if (Number(failed?.n ?? 0) >= 5) return { ok: false, text: "تلاش‌های نادرست زیادی شد؛ پانزده دقیقهٔ دیگر دوباره امتحان کنید.", user: null };
  const [row] = await liveRows(sys.db, sys, "portal_link_code", { and: [{ f: "code_hash", op: "eq", v: codeHash(sys.org.id, code) }, { f: "used_at", op: "empty" }, { f: "expires_at", op: "gt", v: nowIso() }] }, { limit: 1 });
  if (!row) {
    await logRow(sys.db, sys.org.id, { channel: String(channel.id), direction: "in", status: "ignored", external: msg.from, error: "bad_code" });
    return { ok: false, text: "این کد درست نیست یا مهلتش گذشته است. از درگاه کد تازه بگیرید.", user: null };
  }
  const user = String(row.user_id);
  if ((await demoPeople(sys.db, sys.org.id, [user])).size) {
    await logRow(sys.db, sys.org.id, { channel: String(channel.id), direction: "in", status: "ignored", external: msg.from, error: "demo" });
    return { ok: false, text: DEMO_UNLINKED, user: null };
  }
  const ctx = await memberCtx(sys.cfg as ServerConfig, sys.org.id, user).catch(() => null);
  if (!ctx) return { ok: false, text: "حساب شما در این سازمان فعال نیست.", user: null };
  await sys.write(async (tx) => {
    await updateIn(tx, sys, "portal_link_code", String(row.id), { used_at: nowIso() }, { trusted: true });
    // one member per chat and channel: an earlier link of this chat (to anyone) ends
    for (const old of await liveRows(tx, sys, "portal_channel_identity", { and: [{ f: "channel_id", op: "eq", v: channel.id }, { f: "external_id", op: "eq", v: msg.from }, { f: "active", op: "eq", v: true }] }, { limit: 10 })) {
      await updateIn(tx, sys, "portal_channel_identity", String(old.id), { active: false, conversation_id: null, options: null }, { trusted: true });
    }
    await createIn(tx, sys, "portal_channel_identity", { channel_id: channel.id, user_id: user, external_id: msg.from, external_name: msg.name || null, linked_at: nowIso(), active: true }, { trusted: true });
  }, { internal: true });
  const name = ctx.user.full_name?.split(" ")[0] ?? "";
  return { ok: true, text: `${name ? `${name} عزیز، ` : ""}حساب شما وصل شد. پرسش یا درخواستتان را بنویسید؛ «/new» گفتگوی تازه و «/unlink» قطع اتصال است.`, user };
}

/** Process one queued message (see the file's head). */
export async function processChannelMessage(job: Job, jctx: JobContext): Promise<void> {
  const cfg = jctx.cfg as ServerConfig;
  if (!job.org_id) return;
  const sys = await systemCtx(cfg, job.org_id);
  const p = job.payload as { channel: string; log: string; chat: string; from: string; name: string };
  const channel = await liveRow(sys.db, sys, "portal_channel", p.channel);
  if (!channel || channel.active === false) return;
  const log = await sys.db.one<{ text: string | null; status: string }>(`select text, status from sm_portal_channel_log where org_id = $1 and id = $2`, [sys.org.id, p.log]);
  if (!log || log.status !== "received") return;
  const text = String(log.text ?? "").trim();
  const msg = { chat: p.chat, from: p.from, name: p.name ?? "" };

  // linking comes first, whoever writes
  const code = linkCommand(text);
  if (code) {
    const r = await linkWith(sys, channel, msg, code);
    await setLog(sys.db, sys.org.id, p.log, { status: r.ok ? "linked" : "unlinked", user: r.user });
    await reply(cfg, sys, channel, msg.chat, r.user, r.text);
    return;
  }

  const [identity] = await liveRows(sys.db, sys, "portal_channel_identity", { and: [{ f: "channel_id", op: "eq", v: channel.id }, { f: "external_id", op: "eq", v: msg.from }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
  if (!identity) {
    await setLog(sys.db, sys.org.id, p.log, { status: "unlinked" });
    // the instructions at most every ten minutes per chat
    const told = await sys.db.one(`select 1 from sm_portal_channel_log where org_id = $1 and channel_id = $2 and external_id = $3 and direction = 'out' and at > now() - interval '10 minutes' limit 1`, [sys.org.id, String(channel.id), msg.chat]);
    if (!told) await reply(cfg, sys, channel, msg.chat, null, [String(channel.welcome ?? "").trim(), LINK_HELP].filter(Boolean).join("\n\n"));
    return;
  }

  const user = String(identity.user_id);
  // a demo account linked before the pack's rules: the link ends and the assistant answers nothing (its answers would
  // carry the demo records out of the system)
  if ((await demoPeople(sys.db, sys.org.id, [user])).size) {
    await sys.write((tx) => updateIn(tx, sys, "portal_channel_identity", String(identity.id), { active: false, conversation_id: null, options: null }, { trusted: true }), { internal: true });
    await setLog(sys.db, sys.org.id, p.log, { status: "unlinked", user, error: "demo" });
    await reply(cfg, sys, channel, msg.chat, null, `${DEMO_UNLINKED} اتصال این گفتگو برداشته شد.`);
    return;
  }
  const ctx = await memberCtx(cfg, sys.org.id, user).catch(() => null);
  if (!ctx) {
    await sys.write((tx) => updateIn(tx, sys, "portal_channel_identity", String(identity.id), { active: false, conversation_id: null, options: null }, { trusted: true }), { internal: true });
    await setLog(sys.db, sys.org.id, p.log, { status: "unlinked", user, error: "member_inactive" });
    await reply(cfg, sys, channel, msg.chat, null, "حساب شما در این سازمان دیگر فعال نیست؛ اتصال برداشته شد.");
    return;
  }
  // the assistant's answers go out to the messenger: it finds, cites and lists nothing of the demo pack (a real
  // member's question would otherwise carry the pack's articles out of the system)
  ctx.withoutDemo = true;

  const saveIdentity = (values: Row) => sys.write((tx) => updateIn(tx, sys, "portal_channel_identity", String(identity.id), values, { trusted: true, keepVersion: true }), { internal: true });
  const cmd = commandOf(text);
  if (cmd === "unlink") {
    await saveIdentity({ active: false, conversation_id: null, options: null });
    await setLog(sys.db, sys.org.id, p.log, { status: "replied", user });
    await reply(cfg, sys, channel, msg.chat, user, "اتصال این گفتگو به حساب شما برداشته شد.");
    return;
  }
  if (cmd === "help") {
    await setLog(sys.db, sys.org.id, p.log, { status: "replied", user });
    await reply(cfg, sys, channel, msg.chat, user, "پرسشتان را بنویسید یا بگویید چه لازم دارید. شمارهٔ گزینه‌ها را برای انتخاب بفرستید. «/new» گفتگوی تازه، «/agent» گفتگو با کارشناس و «/unlink» قطع اتصال است.");
    return;
  }

  const appUrl = cfg.publicUrl ? `${cfg.publicUrl.replace(/\/+$/, "")}/${sys.org.id}` : null;
  let conversation = isUuid(identity.conversation_id) ? String(identity.conversation_id) : null;
  let out: VaReply;
  try {
    if (cmd === "new" || cmd === "start") {
      out = await vaStart(ctx, { channel: "messenger" });
    } else if (!conversation) {
      out = await vaStart(ctx, { channel: "messenger", text: cmd === "handoff" ? null : text });
      if (cmd === "handoff") out = await vaHandoff(ctx, out.conversation_id, null);
    } else if (cmd === "handoff") {
      out = await vaHandoff(ctx, conversation, null);
    } else {
      const options = Array.isArray(identity.options) ? (identity.options as ChannelOption[]) : [];
      try {
        out = await vaSend(ctx, conversation, inputFromText(text, options));
      } catch (e) {
        // the conversation ended or is gone: a fresh one takes the message
        if (!(e instanceof AppError) || (e.status !== 400 && e.status !== 404)) throw e;
        const fresh = await vaStart(ctx, { channel: "messenger" });
        out = await vaSend(ctx, fresh.conversation_id, { text });
      }
    }
  } catch (e) {
    const message = e instanceof AppError ? e.message : "پاسخ آماده نشد؛ کمی بعد دوباره بفرستید.";
    await setLog(sys.db, sys.org.id, p.log, { status: "failed", user, conversation, error: String((e as Error)?.message ?? e) });
    await reply(cfg, sys, channel, msg.chat, user, message, [], conversation);
    if (!(e instanceof AppError)) jctx.log.warn?.("portal channel message failed", String((e as Error)?.stack ?? e));
    return;
  }
  conversation = out.conversation_id;
  const rendered = replyForText(out, { appUrl });
  await saveIdentity({ conversation_id: out.state === "ended" ? null : conversation, options: rendered.options });
  await setLog(sys.db, sys.org.id, p.log, { status: "replied", user, conversation });
  await reply(cfg, sys, channel, msg.chat, user, rendered.text, rendered.options, conversation);
}

/** Old deliveries and used or expired codes go (the sweep). */
export async function cleanChannels(sys: Ctx): Promise<void> {
  await sys.db.query(`delete from sm_portal_channel_log where org_id = $1 and at < now() - interval '30 days'`, [sys.org.id]);
  const old = await liveRows(sys.db, sys, "portal_link_code", { or: [{ f: "used_at", op: "nempty" }, { f: "expires_at", op: "lt", v: nowIso() }] }, { limit: 500 });
  if (old.length)
    await sys.write(async (tx) => {
      for (const r of old) await removeIn(tx, sys, "portal_link_code", String(r.id), { trusted: true });
    }, { internal: true });
}

let installed = false;
export function installChannels(): void {
  if (installed) return;
  installed = true;
  registerJobHandler(JOB_MESSAGE, processChannelMessage);
}
