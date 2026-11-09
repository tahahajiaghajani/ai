// Messaging connectors (Telegram, Bale, the generic webhook) end to end: a delivery must prove the connector's secret,
// a retry is dropped, group chats are ignored, each chat has a per-minute budget; a chat user becomes a member only
// through a one-time code from the portal (never by name), wrong codes are limited, and a linked member talks to the
// virtual agent with THEIR access — their own tickets only — through numbered replies.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { aiNet } from "@server/modules/ai/net";
import { resetRateLimits } from "@server/http/ratelimit";
import { inputFromText, linkCommand, parseGenericMessage, parseTelegramUpdate, replyForText } from "@shared/portal/logic";
import { portalWorld, statusOf, type PortalWorld } from "./portal-helpers";

let w: PortalWorld;
const realLookup = aiNet.lookup;
const sent: { url: string; body: Record<string, any> }[] = [];
let channelId = "";
let key = "";
let secret = "";
let update = 1000;

const hookPath = () => `/public/portal/hooks/${key}`;

async function deliver(text: string, opts: { chat?: number; from?: number; name?: string; type?: string; secret?: string | null; id?: number } = {}): Promise<{ status: number; body: any }> {
  const id = opts.id ?? ++update;
  const from = opts.from ?? 555;
  const payload = { update_id: id, message: { message_id: id, date: 1, text, chat: { id: opts.chat ?? from, type: opts.type ?? "private" }, from: { id: from, first_name: opts.name ?? "علی", is_bot: false } } };
  const headers: Record<string, string> = { "content-type": "application/json" };
  const s = opts.secret === undefined ? secret : opts.secret;
  if (s) headers["x-telegram-bot-api-secret-token"] = s;
  const res = await w.e.app.fetch(new Request(`http://local.test/api${hookPath()}`, { method: "POST", headers, body: JSON.stringify(payload) }));
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

const lastTo = (chat: number) => [...sent].reverse().find((s) => String(s.body.chat_id) === String(chat));

beforeAll(async () => {
  aiNet.lookup = async () => ["93.184.216.34"];
  w = await portalWorld();
  w.e.cfg.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }) as typeof fetch;
  const ch = await w.o.post(`${w.P}/r/portal_channel`, { name: "ربات تلگرام سازمان", kind: "telegram", token: "123:abc", bot_username: "org_help_bot", auth_mode: "header", rate_per_minute: 6 });
  channelId = ch.row.id;
  const s = await w.o.post(`${w.P}/portal/channels/${channelId}/secret`, {});
  secret = s.secret;
  key = String(s.webhook_url).split("/").pop()!;
}, 120_000);

afterAll(() => {
  aiNet.lookup = realLookup;
});

describe("the pure parts", () => {
  it("reads Telegram updates and the generic webhook's JSON", () => {
    expect(parseTelegramUpdate({ update_id: 7, message: { message_id: 1, text: "سلام", chat: { id: 9, type: "private" }, from: { id: 9, first_name: "رضا", last_name: "کریمی" } } })).toEqual({ key: "7", chatId: "9", fromId: "9", fromName: "رضا کریمی", private: true, text: "سلام" });
    expect(parseTelegramUpdate({ update_id: 8, message: { message_id: 2, text: "x", chat: { id: -100, type: "group" }, from: { id: 9 } } })?.private).toBe(false);
    expect(parseTelegramUpdate({ update_id: 9 })).toBeNull();
    expect(parseGenericMessage({ id: "m1", from: { id: "+98912", name: "مریم" }, text: "وضعیت" })).toMatchObject({ key: "m1", chatId: "+98912", fromId: "+98912", private: true });
    expect(parseGenericMessage({ text: "x" })).toBeNull();
  });

  it("reads link commands and numbered picks", () => {
    expect(linkCommand("/link ABCD-EFGH")).toBe("ABCDEFGH");
    expect(linkCommand("/start abcdefgh")).toBe("ABCDEFGH");
    expect(linkCommand("اتصال ABCD EFGH")).toBe("ABCDEFGH");
    expect(linkCommand("ABCDEFGH")).toBeNull();
    expect(linkCommand("/link ABCD-EFG1")).toBeNull();
    const r = replyForText({ text: "**یکی** را برگزینید:", cards: [{ kind: "choices", options: [{ value: "status", label: "وضعیت" }, { value: "order", label: "سفارش" }] }], suggestions: [] });
    expect(r.text).toContain("۱. وضعیت");
    expect(r.text).not.toContain("**");
    expect(inputFromText("۲", r.options)).toEqual({ action: "choose", value: "order" });
    expect(inputFromText("وضعیت", r.options)).toEqual({ action: "choose", value: "status" });
    expect(inputFromText("چاپگر خراب است", r.options)).toEqual({ text: "چاپگر خراب است" });
  });
});

describe("receiving", () => {
  it("refuses deliveries that do not prove the secret, and unknown keys", async () => {
    expect((await deliver("سلام", { secret: null })).status).toBe(401);
    expect((await deliver("سلام", { secret: "wrong" })).status).toBe(401);
    const res = await w.e.app.fetch(new Request(`http://local.test/api/public/portal/hooks/${"x".repeat(24)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(404);
  });

  it("answers an unlinked chat with how to link, never as anyone", async () => {
    sent.length = 0;
    const r = await deliver("سلام، وضعیت درخواستم؟", { from: 555 });
    expect(r.body.status).toBe("queued");
    await w.drain();
    const out = lastTo(555)!;
    expect(out.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(out.body.text).toContain("/link");
    const log = await w.e.db.query<{ status: string }>(`select status from sm_portal_channel_log where org_id = $1 and direction = 'in' and external_id = '555' order by at`, [w.e.org]);
    expect(log.map((l) => l.status)).toEqual(["unlinked"]);
  });

  it("drops a messenger's retry and ignores group chats", async () => {
    const first = await deliver("تکرار", { id: 50_000, from: 777 });
    expect(first.body.status).toBe("queued");
    const again = await deliver("تکرار", { id: 50_000, from: 777 });
    expect(again.body.status).toBe("duplicate");
    const group = await deliver("سلام گروه", { chat: -100123, from: 778, type: "supergroup" });
    expect(group.body.status).toBe("ignored");
    await w.drain();
  });

  it("holds each chat to its per-minute budget", async () => {
    resetRateLimits();
    const statuses: string[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await deliver(`پیام ${i}`, { from: 888 })).body.status);
    expect(statuses.filter((s) => s === "queued")).toHaveLength(6);
    expect(statuses.slice(6)).toEqual(["rate_limited", "rate_limited"]);
    await w.drain();
  });
});

describe("linking and conversing", () => {
  it("links a chat to a member only through a fresh one-time code", async () => {
    resetRateLimits();
    // a code nobody issued
    await deliver("/link ABCD-EFGH", { from: 600 });
    await w.drain();
    expect(lastTo(600)!.body.text).toContain("درست نیست");
    const issued = await w.p.req.client.post(`${w.P}/portal/link-code`, {});
    expect(issued.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(issued.channels[0].deep_link).toBe(`https://t.me/org_help_bot?start=${issued.code.replace("-", "")}`);
    // a second code replaces the first
    const second = await w.p.req.client.post(`${w.P}/portal/link-code`, {});
    await deliver(`/link ${issued.code}`, { from: 600 });
    await w.drain();
    expect(lastTo(600)!.body.text).toContain("درست نیست");
    await deliver(`/link ${second.code}`, { from: 600, name: "علی" });
    await w.drain();
    expect(lastTo(600)!.body.text).toContain("وصل شد");
    const mine = await w.p.req.client.get(`${w.P}/portal/profile`);
    expect(mine.identities).toHaveLength(1);
    // the code is spent
    await deliver(`/link ${second.code}`, { from: 601 });
    await w.drain();
    expect(lastTo(601)!.body.text).toContain("درست نیست");
    // nobody else sees the identity
    const others = await w.p.req2.client.get(`${w.P}/portal/profile`);
    expect(others.identities).toHaveLength(0);
  });

  it("stops guessing after five wrong codes", async () => {
    for (let i = 0; i < 6; i++) await deliver("/link ZZZZ-ZZZZ", { from: 700 });
    await w.drain();
    expect(lastTo(700)!.body.text).toContain("پانزده دقیقه");
  });

  it("answers a linked member with their own tickets only, through the virtual agent", async () => {
    const mine = await w.incident(w.p.req.client, { short_description: "مانیتور سیاه است" });
    const theirs = await w.incident(w.p.req2.client, { short_description: "پرینتر واحد دیگر" });
    sent.length = 0;
    await deliver("وضعیت درخواست‌های من", { from: 600 });
    await w.drain();
    const out = lastTo(600)!;
    expect(out.body.text).toContain(String(mine.number));
    expect(out.body.text).not.toContain(String(theirs.number));
    const conv = await w.e.db.query<{ requester_id: string; channel: string }>(`select requester_id, channel from sm_va_conversations where org_id = $1 and channel = 'messenger'`, [w.e.org]);
    expect(conv.length).toBeGreaterThan(0);
    expect(conv.every((c) => c.requester_id === w.p.req.userId)).toBe(true);
  });

  it("unlinks on request", async () => {
    await deliver("/unlink", { from: 600 });
    await w.drain();
    expect(lastTo(600)!.body.text).toContain("برداشته شد");
    expect((await w.p.req.client.get(`${w.P}/portal/profile`)).identities).toHaveLength(0);
  });
});

describe("the generic webhook", () => {
  it("needs an HMAC of the body and replies to the configured address, signed", async () => {
    const ch = await w.o.post(`${w.P}/r/portal_channel`, { name: "درگاه پیامک", kind: "webhook", auth_mode: "hmac", outbound_url: "https://sms-gateway.example/send" });
    const s = await w.o.post(`${w.P}/portal/channels/${ch.row.id}/secret`, {});
    const k = String(s.webhook_url).split("/").pop()!;
    const body = JSON.stringify({ id: "sms-1", from: { id: "+989120000000", name: "مریم" }, text: "سلام" });
    const send = (sig: string | null) => w.e.app.fetch(new Request(`http://local.test/api/public/portal/hooks/${k}`, { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-signature-256": sig } : {}) }, body }));
    expect((await send(null)).status).toBe(401);
    expect((await send("sha256=" + "0".repeat(64))).status).toBe(401);
    const good = await send(`sha256=${createHmac("sha256", s.secret).update(body).digest("hex")}`);
    expect(good.status).toBe(200);
    sent.length = 0;
    await w.drain();
    const out = sent.find((x) => x.url === "https://sms-gateway.example/send")!;
    expect(out.body.chat_id).toBe("+989120000000");
    expect(out.body.text).toContain("/link");
  });

  it("is set up only by connector administrators", async () => {
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/portal/channels/${channelId}/secret`)).toBe(403);
    expect(await statusOf(w.p.agent.client, "GET", `${w.P}/portal/channels/${channelId}/log`)).toBe(403);
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/r/portal_channel`, { name: "x", kind: "telegram" })).toBe(403);
  });
});
