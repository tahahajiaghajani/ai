// E-mail, messengers and SMS without the network: notification e-mails through a fake nodemailer transport (the real
// message composition: Persian subject encoding, RTL HTML, threading headers), quiet hours and digests, e-mail to
// record from fixture messages (new records, replies threaded by Message-ID, by the thread id and by the number in
// the subject, attachments, quoted text) with loop protection and allow/deny lists, the IMAP poll through a fixture
// mailbox, and Slack/Telegram/SMS requests through a stub fetch.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";
import { engineOrg, PNG, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { APP_NAME } from "@shared/constants";
import { systemCtx } from "@server/engine";
import { aiNet } from "@server/modules/ai/net";
import { setMailboxOpener, setTransportFactory, ingestMessage, type MailboxSession } from "@server/modules/notify";
import { emailChannels } from "@server/modules/notify/mail";
import { testChannel } from "@server/modules/notify/admin";
import { localMinutes } from "@shared/notify";

type Who = { client: Client; userId: string };
let e: EngineOrg;
let P = "";
let agent: Who;
let req: Who;
let req2: Who;
let channelId = "";
const sent: Buffer[] = [];
const calls: { url: string; init: RequestInit }[] = [];
const realLookup = aiNet.lookup;

/** The fixture mailbox the IMAP poll reads. */
const mailbox = { uidValidity: "7", messages: [] as { uid: number; source: Buffer }[], seen: [] as number[] };

async function drain() {
  for (let i = 0; i < 30; i++) {
    const r = await tick(e.cfg, { budgetMs: 20_000 });
    if (!r.more && r.ran + r.failed === 0) return;
  }
}

/** A raw message built by nodemailer's own composer. */
async function raw(o: { from: string; subject: string; text: string; messageId?: string; inReplyTo?: string; references?: string; headers?: Record<string, string>; attachments?: { filename: string; content: Buffer }[]; to?: string }): Promise<Buffer> {
  return new MailComposer({
    from: o.from,
    to: o.to ?? "support@itsm.example",
    subject: o.subject,
    text: o.text,
    messageId: o.messageId ?? `<${randomUUID()}@mail.example>`,
    inReplyTo: o.inReplyTo,
    references: o.references,
    headers: o.headers,
    attachments: o.attachments,
  })
    .compile()
    .build();
}

const items = async (w: Who) => (await w.client.get(`${P}/notify/inbox`)).items as { record_id: string; event: string }[];
const lastMail = async () => simpleParser(sent[sent.length - 1]);
const hhmm = (m: number) => `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m + 1440) % 1440) % 60).padStart(2, "0")}`;

async function ingest(source: Buffer) {
  const sys = await systemCtx(e.cfg, e.org);
  const ch = (await emailChannels(sys)).find((c) => c.id === channelId)!;
  return ingestMessage(e.cfg, sys, ch, source);
}

beforeAll(async () => {
  setTransportFactory(() => {
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
    return {
      async sendMail(m: Record<string, unknown>) {
        const info = await t.sendMail(m as never);
        sent.push(info.message as Buffer);
        return info as { messageId?: string; response?: string };
      },
    };
  });
  setMailboxOpener(async () => {
    const s: MailboxSession = {
      async fetch({ lastUid, uidValidity }) {
        const fresh = lastUid === null || uidValidity !== mailbox.uidValidity;
        const messages = mailbox.messages.filter((m) => (fresh ? !mailbox.seen.includes(m.uid) : m.uid > lastUid!));
        const uidNext = Math.max(0, ...mailbox.messages.map((m) => m.uid)) + 1;
        return { uidValidity: mailbox.uidValidity, uidNext, messages, skipped: [] };
      },
      async markSeen(_f, uids) {
        mailbox.seen.push(...uids);
      },
      async close() {},
    };
    return s;
  });
  aiNet.lookup = async () => ["93.184.216.34"];
  e = await engineOrg();
  P = `/o/${e.org}`;
  e.cfg.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const url = String(input);
    if (url.includes("/sendMessage")) return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 });
    if (url.includes("kavenegar")) return new Response(JSON.stringify({ return: { status: 200 }, entries: [{ messageid: 9 }] }), { status: 200 });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  agent = await e.member("member", "agent@example.com");
  req = await e.member("member", "req@example.com");
  req2 = await e.member("member", "req2@example.com");
  await e.owner.put(`${P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
  await e.owner.put(`${P}/access/members/${req2.userId}`, { roles: ["requester"], persona: "requester" });
  const ch = await e.owner.post(`${P}/r/email_channel`, {
    name: "میز خدمت",
    from_name: "میز خدمت فناوری",
    from_address: "support@itsm.example",
    is_default: true,
    smtp_host: "smtp.itsm.example",
    smtp_user: "support",
    smtp_password: "smtp-secret",
    inbound: true,
    imap_host: "imap.itsm.example",
    imap_user: "support",
    imap_password: "imap-secret",
    deny_list: ["@spam.example"],
    signature: "با سپاس، **میز خدمت**",
  });
  channelId = ch.row.id;
  expect(ch.row.smtp_password).toMatchObject({ secret: true });
  await drain();
});

afterAll(() => {
  setTransportFactory(null);
  setMailboxOpener(null);
  aiNet.lookup = realLookup;
});

describe("notification e-mails", () => {
  let outId = "";
  let recordId = "";
  let number = "";

  it("go out through SMTP with a Persian subject, the record number, RTL HTML and threading headers", async () => {
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "شبکهٔ طبقهٔ سوم قطع است", description: "از صبح **قطع** است" });
    await drain();
    sent.length = 0;
    await e.owner.patch(`${P}/r/todo/${row.id}`, { assigned_to: agent.userId });
    await drain();
    expect(sent).toHaveLength(1);
    const head = sent[0].toString("utf8").split("\r\n\r\n")[0];
    expect(head).toMatch(/^Subject: =\?UTF-8\?[BQ]\?/m);
    expect(head).toMatch(/^Auto-Submitted: auto-generated$/m);
    expect(head).toMatch(/^X-Auto-Response-Suppress: All$/m);
    const m = await lastMail();
    expect(m.subject).toBe(`ارجاع ${row.number} — شبکهٔ طبقهٔ سوم قطع است [${row.number}]`);
    expect(m.from?.value[0]).toEqual({ address: "support@itsm.example", name: "میز خدمت فناوری" });
    expect(m.to && !Array.isArray(m.to) ? m.to.value[0].address : "").toBe("agent@example.com");
    expect(String(m.html)).toContain('dir="rtl"');
    expect(String(m.html)).toContain(APP_NAME);
    expect(String(m.html)).toContain("<strong>میز خدمت</strong>");
    expect(m.text).toContain("شبکهٔ طبقهٔ سوم قطع است");
    expect(String(m.references)).toBe(`<r.${row.id}@itsm.example>`);
    const out = await e.db.one<{ message_id: string; record_id: string; status: string }>(`select message_id, record_id, status from sm_email_messages where org_id = $1 and direction = 'out' order by created_at desc limit 1`, [e.org]);
    expect(out).toMatchObject({ message_id: m.messageId, record_id: row.id, status: "sent" });
    const log = await e.db.one<{ status: string; target: string; provider_id: string }>(`select status, target, provider_id from sm_notification_log where record_id = $1 and channel = 'email'`, [row.id]);
    expect(log).toMatchObject({ status: "sent", target: "agent@example.com", provider_id: m.messageId });
    outId = m.messageId!;
    recordId = row.id;
    number = row.number;
  });

  it("wait for the end of the recipient's quiet hours", async () => {
    const now = localMinutes(new Date(), "Asia/Tehran");
    await agent.client.put(`${P}/notify/prefs`, { quiet_from: hhmm(now - 60), quiet_to: hhmm(now + 60) });
    sent.length = 0;
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "در ساعت سکوت", assigned_to: agent.userId });
    await drain();
    expect(sent).toHaveLength(0);
    expect((await items(agent)).some((x) => x.record_id === row.id)).toBe(true); // the inbox is not held
    const held = await e.db.one<{ status: string; reason: string; due_at: string }>(`select status, reason, due_at from sm_notification_log where record_id = $1 and channel = 'email'`, [row.id]);
    expect(held).toMatchObject({ status: "held", reason: "quiet" });
    expect(new Date(held!.due_at).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    // the quiet hour ends
    await e.db.query(`update sm_notification_log set due_at = now() where status = 'held'`);
    await e.db.query(`update sm_jobs set run_at = now() where kind = 'notify.flush' and status = 'queued'`);
    await drain();
    expect(sent).toHaveLength(1);
    expect((await lastMail()).subject).toContain("در ساعت سکوت");
    expect((await e.db.one<{ status: string }>(`select status from sm_notification_log where record_id = $1 and channel = 'email'`, [row.id]))!.status).toBe("sent");
    await agent.client.put(`${P}/notify/prefs`, { quiet_from: null, quiet_to: null });
  });

  it("collect into one digest for people who chose one", async () => {
    await agent.client.put(`${P}/notify/prefs`, { digest: "hourly" });
    sent.length = 0;
    await e.owner.post(`${P}/r/todo`, { short_description: "خلاصهٔ یک", assigned_to: agent.userId });
    await e.owner.post(`${P}/r/todo`, { short_description: "خلاصهٔ دو", assigned_to: agent.userId });
    await drain();
    expect(sent).toHaveLength(0);
    await e.db.query(`update sm_notification_log set due_at = now() where status = 'held'`);
    await e.db.query(`update sm_jobs set run_at = now() where kind = 'notify.flush' and status = 'queued'`);
    await drain();
    expect(sent).toHaveLength(1);
    const m = await lastMail();
    expect(m.subject).toBe("خلاصهٔ اعلان‌ها: ۲ مورد");
    expect(m.text).toContain("خلاصهٔ یک");
    expect(m.text).toContain("خلاصهٔ دو");
    await agent.client.put(`${P}/notify/prefs`, { digest: "none" });
  });

  it("e-mail to record: a reply to our message becomes an «ایمیل دریافتی» entry, quoted text cut", async () => {
    const source = await raw({ from: "Agent <agent@example.com>", subject: `Re: ارجاع ${number}`, text: "وصل شد، ممنون.\n\nOn Sat, 7 Nov 2026, میز خدمت wrote:\n> متن قبلی", inReplyTo: outId, references: outId });
    const r = await ingest(source);
    expect(r).toMatchObject({ status: "replied", table: "todo", id: recordId });
    const j = await e.owner.get(`${P}/r/todo/${recordId}/journal`);
    const entry = j.entries.find((x: { kind: string }) => x.kind === "email_in");
    expect(entry).toMatchObject({ visibility: "public", body: "وصل شد، ممنون.", author: agent.userId });
    expect(entry.data).toMatchObject({ from: "agent@example.com" });
    // the same message again is recognised
    expect((await ingest(source)).status).toBe("duplicate");
  });

  it("threads by the notification thread id and by the number in the subject", async () => {
    const byThread = await ingest(await raw({ from: "agent@example.com", subject: "بی‌شماره", text: "با شناسهٔ رشته", references: `<r.${recordId}@itsm.example>` }));
    expect(byThread).toMatchObject({ status: "replied", id: recordId });
    const own = await req.client.post(`${P}/r/todo`, { short_description: "چاپگر من" });
    const byNumber = await ingest(await raw({ from: "req@example.com", subject: `پاسخ: [${own.row.number}] چاپگر`, text: "هنوز کار نمی‌کند" }));
    expect(byNumber).toMatchObject({ status: "replied", id: own.row.id });
    // someone who may not read the record cannot add to it by e-mail, nor can a stranger
    expect(await ingest(await raw({ from: "req2@example.com", subject: `[${own.row.number}]`, text: "x" }))).toMatchObject({ status: "rejected", reason: "no_access" });
    expect(await ingest(await raw({ from: "stranger@else.example", subject: `[${own.row.number}]`, text: "x" }))).toMatchObject({ status: "rejected", reason: "unknown_sender" });
  });

  it("creates records from new mail, with the member as requester and the attachments", async () => {
    const r = await ingest(await raw({ from: "Req <req@example.com>", subject: "درخواست لپ‌تاپ", text: "یک لپ‌تاپ برای همکار تازه لازم است", attachments: [{ filename: "فرم.png", content: Buffer.from(PNG) }] }));
    expect(r.status).toBe("created");
    const rec = await e.owner.get(`${P}/r/todo/${r.id}`);
    expect(rec.row).toMatchObject({ short_description: "درخواست لپ‌تاپ", caller_id: req.userId, channel: "email", description: "یک لپ‌تاپ برای همکار تازه لازم است" });
    expect(rec.row.created_by).toBe(req.userId);
    const files = await e.owner.get(`${P}/r/todo/${r.id}/attachments`);
    expect(files.attachments.map((a: { name: string; mime: string }) => [a.name, a.mime])).toEqual([["فرم.png", "image/png"]]);
    // the requester reads their new record
    await req.client.get(`${P}/r/todo/${r.id}`);
    const stranger = await ingest(await raw({ from: "Guest <guest@partner.example>", subject: "سؤال", text: "سلام" }));
    const s = await e.owner.get(`${P}/r/todo/${stranger.id}`);
    expect(s.row.caller_id).toBeNull(); // a stranger is no member: the record has no requester, the address is in the text
    expect(s.row.description).toContain("guest@partner.example");
  });

  it("drops loops: auto-replies, bounces, bulk mail, our own messages and addresses, denied senders, floods", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ from: "agent@example.com", subject: "Automatic reply: x", text: "x" }, "auto_reply"],
      [{ from: "agent@example.com", subject: "x", text: "x", headers: { "Auto-Submitted": "auto-replied" } }, "auto_reply"],
      [{ from: "agent@example.com", subject: "خارج از دفتر هستم", text: "x" }, "auto_reply"],
      [{ from: "MAILER-DAEMON@mail.example", subject: "Undelivered Mail Returned to Sender", text: "x" }, "bounce"],
      [{ from: "news@example.com", subject: "خبرنامه", text: "x", headers: { Precedence: "bulk" } }, "bulk"],
      [{ from: "list@example.com", subject: "فهرست", text: "x", headers: { "List-Id": "<all.example.com>" } }, "bulk"],
      [{ from: "agent@example.com", subject: "x", text: "x", headers: { "X-ITSM-Notification": "1" } }, "own_message"],
      [{ from: "support@itsm.example", subject: "x", text: "x" }, "own_address"],
      [{ from: "bad@spam.example", subject: "x", text: "x" }, "denied"],
    ];
    for (const [o, reason] of cases) expect(await ingest(await raw(o as never))).toMatchObject({ status: "rejected", reason });
    // one sender sending too much in a few minutes
    for (let i = 0; i < 20; i++) {
      await e.db.query(`insert into sm_email_messages (id, org_id, channel_id, direction, message_id, from_addr, status) values ($1, $2, $3, 'in', $4, 'flood@example.com', 'processed')`, [randomUUID(), e.org, channelId, `<f${i}@x>`]);
    }
    expect(await ingest(await raw({ from: "flood@example.com", subject: "باز هم", text: "x" }))).toMatchObject({ status: "rejected", reason: "rate_limited" });
    const log = await e.owner.get(`${P}/notify/email-log?direction=in&status=rejected`);
    expect(log.messages.some((m: { reason_label: string }) => m.reason_label === "پاسخ خودکار (مثلاً «خارج از دفتر»)")).toBe(true);
  });

  it("reads the mailbox every minute (and on «بررسی صندوق اکنون»)", async () => {
    mailbox.messages.push({ uid: 11, source: await raw({ from: "req@example.com", subject: "از صندوق یک", text: "یک" }) });
    mailbox.messages.push({ uid: 12, source: await raw({ from: "req@example.com", subject: "از صندوق دو", text: "دو" }) });
    const r = await e.owner.post(`${P}/notify/email-channels/${channelId}/check`);
    expect(r.result).toMatchObject({ fetched: 2, created: 2 });
    expect(mailbox.seen).toEqual(expect.arrayContaining([11, 12]));
    const status = await e.owner.get(`${P}/notify/email-channels/${channelId}/status`);
    expect(status).toMatchObject({ last_error: null, last_result: { created: 2 } });
    // nothing new: nothing taken again
    expect((await e.owner.post(`${P}/notify/email-channels/${channelId}/check`)).result).toMatchObject({ fetched: 0 });
    mailbox.messages.push({ uid: 13, source: await raw({ from: "req@example.com", subject: "از صندوق سه", text: "سه" }) });
    // the poller job (queued when the channel was saved) takes it on its next run
    await e.db.query(`update sm_jobs set run_at = now() where kind = 'notify.imap' and status = 'queued'`);
    await drain();
    const mine = await req.client.get(`${P}/r/todo?q=${encodeURIComponent("از صندوق سه")}`);
    expect(mine.rows).toHaveLength(1);
    // members without the notification settings do not even see the channel
    await agent.client.post(`${P}/notify/email-channels/${channelId}/check`, {}, 404);
  });

  it("sends a test e-mail through a channel", async () => {
    sent.length = 0;
    const r = await e.owner.post(`${P}/notify/email-channels/${channelId}/test`, {});
    expect(r).toMatchObject({ ok: true, to: "owner@example.com" });
    expect((await lastMail()).subject).toBe(`ایمیل آزمایشی ${APP_NAME}`);
  });
});

describe("messengers, webhooks and SMS", () => {
  it("posts to Slack and Telegram as the channel's principal, and skips what the principal may not read", async () => {
    const slack = await e.owner.post(`${P}/r/notification_channel`, { name: "اسلک فنی", kind: "slack", endpoint: "https://hooks.slack.example/services/T/B/x", principal_id: agent.userId });
    const tg = await e.owner.post(`${P}/r/notification_channel`, { name: "گروه تلگرام", kind: "telegram", token: "123:abc", chat_id: "-100200", principal_id: agent.userId });
    const blind = await e.owner.post(`${P}/r/notification_channel`, { name: "کور", kind: "webhook", endpoint: "https://hooks.example/blind", principal_id: req2.userId });
    await e.owner.post(`${P}/r/notification_channel`, { name: "بی‌اصل", kind: "slack", endpoint: "https://hooks.slack.example/x" }, 400);
    await e.owner.post(`${P}/r/notification_rule`, { name: "به پیام‌رسان‌ها", table_key: "todo", event: "created", condition: { f: "category", op: "eq", v: "report" }, recipients: { assignee: true }, channels: ["webhook"], targets: [slack.row.id, tg.row.id, blind.row.id] });
    await drain();
    calls.length = 0;
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "گزارش ماهانه <آماده>", category: "report" });
    await drain();
    const s = calls.find((c) => c.url === "https://hooks.slack.example/services/T/B/x")!;
    expect(JSON.parse(String(s.init.body)).text).toContain(`${row.number} — گزارش ماهانه &lt;آماده&gt;`);
    const t = calls.find((c) => c.url === "https://api.telegram.org/bot123:abc/sendMessage")!;
    expect(JSON.parse(String(t.init.body))).toMatchObject({ chat_id: "-100200", parse_mode: "HTML" });
    expect(calls.some((c) => c.url.includes("blind"))).toBe(false);
    const log = await e.db.query<{ target: string; status: string; reason: string | null }>(`select target, status, reason from sm_notification_log where record_id = $1 and channel = 'webhook' order by target`, [row.id]);
    expect(log).toEqual([
      { target: "اسلک فنی", status: "sent", reason: null },
      { target: "کور", status: "skipped", reason: "no_access" },
      { target: "گروه تلگرام", status: "sent", reason: null },
    ]);
  });

  it("sends SMS through the generic gateway template to the recipient's mobile", async () => {
    await e.db.query(`update sm_users set mobile = '09121234567' where id = $1`, [agent.userId]);
    const sms = await e.owner.post(`${P}/r/notification_channel`, {
      name: "کاوه‌نگار",
      kind: "sms",
      token: "KAVE-KEY",
      sms_url: "https://api.kavenegar.com/v1/{{token}}/sms/send.json",
      sms_method: "POST",
      sms_content_type: "form",
      sms_sender: "10004346",
      sms_body: "receptor={{to}}&message={{text}}&sender={{sender}}",
    });
    await e.owner.post(`${P}/r/notification_rule`, { name: "پیامک فوری", table_key: "todo", event: "assigned", condition: { f: "priority", op: "eq", v: "1" }, recipients: { assignee: true }, channels: ["sms"], targets: [sms.row.id] });
    await drain();
    calls.length = 0;
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "سرور اصلی خاموش شد", priority: "1", assigned_to: agent.userId });
    await drain();
    const c = calls.find((x) => x.url.startsWith("https://api.kavenegar.com/"))!;
    expect(c.url).toBe("https://api.kavenegar.com/v1/KAVE-KEY/sms/send.json");
    const body = new URLSearchParams(String(c.init.body));
    expect(body.get("receptor")).toBe("989121234567");
    expect(body.get("sender")).toBe("10004346");
    expect(body.get("message")).toContain(row.number);
    // a test message through the channel (to the caller's own mobile or a number)
    calls.length = 0;
    const ctx = await e.ctxOf(e.ownerId);
    await testChannel(ctx, sms.row.id, "0912 765 4321");
    expect(new URLSearchParams(String(calls[0].init.body)).get("receptor")).toBe("989127654321");
  });
});
