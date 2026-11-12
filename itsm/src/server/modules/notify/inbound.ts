// E-mail to record: every active e-mail channel with «دریافت ایمیل» is read every minute (IMAP through imapflow,
// parsed by mailparser). A new message creates a record of the channel's table (default «کار») with the sender as
// its requester when they are a member; a reply — found by In-Reply-To/References against the messages we sent or
// received, or by the «[TODO0000012]» number in the subject — becomes a public «ایمیل دریافتی» entry on that record
// (only from a member who may read it). Attachments are saved through the engine with the record or entry, in the
// same transaction as the message's log row, so a message is processed exactly once. Loop protection: our own
// messages and addresses, auto-replies and bounces, bulk and list mail, and a sender rate limit; plus the channel's
// allow and deny lists.
import type { ParsedMail } from "mailparser";
import { uuidv7 } from "@shared/id";
import { physicalTables, tableDef } from "@shared/tables";
import { NOTIFY_TABLE_KEYS } from "@shared/tables/notify";
import { addressMatches, subjectNumbers } from "@shared/notify";
import type { TableDef } from "@shared/model/types";
import type { Ctx, ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { enqueue, registerJobHandler, type Job, type JobContext } from "../../jobs";
import { addAttachmentIn, addJournalIn, createIn, maxAttachmentBytes, systemCtx } from "../../engine";
import { readersOf } from "../../access";
import { actsHere, errText, fullCfg, isUuid, sysCtx, systemRows } from "./common";
import { channelSecret, checkMailHost, emailChannels, type EmailChannelRow } from "./mail";

// ----- the mailbox (tests replace it) -----------------------------------------------------------------------------------

export interface ImapConfig {
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  user: string;
  pass: string;
}

export interface FetchResult {
  uidValidity: string;
  uidNext: number;
  messages: { uid: number; source: Buffer }[];
  /** too large to read */
  skipped: { uid: number; size: number }[];
}

export interface MailboxSession {
  /**
   * New messages of a folder: UIDs above `lastUid`; on the first look (or when the folder's UIDVALIDITY changed)
   * the unseen messages of the last three days. At most `max`, oldest first.
   */
  fetch(o: { folder: string; lastUid: number | null; uidValidity: string | null; max: number; maxBytes: number }): Promise<FetchResult>;
  markSeen(folder: string, uids: number[]): Promise<void>;
  close(): Promise<void>;
}

export type MailboxOpener = (c: ImapConfig) => Promise<MailboxSession>;

const imapflowOpener: MailboxOpener = async (c) => {
  // loaded when a mailbox is polled (a cold start of the web version does not pay for imapflow)
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.security === "tls",
    doSTARTTLS: c.security === "starttls" ? true : c.security === "none" ? false : undefined,
    auth: { user: c.user, pass: c.pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    tls: { minVersion: "TLSv1.2", servername: c.host },
  });
  await client.connect();
  return {
    async fetch({ folder, lastUid, uidValidity, max, maxBytes }) {
      const lock = await client.getMailboxLock(folder);
      try {
        const mb = client.mailbox;
        if (!mb) throw new Error(`پوشهٔ «${folder}» باز نشد`);
        const validity = String(mb.uidValidity);
        const fresh = lastUid === null || validity !== uidValidity;
        const found = fresh
          ? await client.search({ seen: false, since: new Date(Date.now() - 3 * 86_400_000) }, { uid: true })
          : await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).filter((u) => fresh || u > lastUid!).sort((a, b) => a - b).slice(0, max);
        const messages: FetchResult["messages"] = [];
        const skipped: FetchResult["skipped"] = [];
        if (uids.length) {
          const sizes = new Map<number, number>();
          for await (const m of client.fetch(uids.join(","), { uid: true, size: true }, { uid: true })) sizes.set(m.uid, m.size ?? 0);
          const small = uids.filter((u) => (sizes.get(u) ?? 0) <= maxBytes);
          for (const u of uids) if (!small.includes(u)) skipped.push({ uid: u, size: sizes.get(u) ?? 0 });
          if (small.length) for await (const m of client.fetch(small.join(","), { uid: true, source: true }, { uid: true })) if (m.source) messages.push({ uid: m.uid, source: m.source });
        }
        messages.sort((a, b) => a.uid - b.uid);
        return { uidValidity: validity, uidNext: Number(mb.uidNext), messages, skipped };
      } finally {
        lock.release();
      }
    },
    async markSeen(folder, uids) {
      if (!uids.length) return;
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    },
    async close() {
      await client.logout().catch(() => client.close());
    },
  };
};

let opener: MailboxOpener = imapflowOpener;

/** Replace how mailboxes are opened (tests: a fixture mailbox). Null restores IMAP. */
export function setMailboxOpener(fn: MailboxOpener | null): void {
  opener = fn ?? imapflowOpener;
}

// ----- state of a folder (sm_notify_state) ------------------------------------------------------------------------------

export interface PollState {
  uidValidity?: string | null;
  lastUid?: number | null;
  poller?: string | null;
  last_checked_at?: string | null;
  last_error?: string | null;
  last_result?: PollResult | null;
}

export async function getState(q: Queryable, org: string, key: string): Promise<PollState> {
  const r = await q.one<{ data: PollState }>(`select data from sm_notify_state where org_id = $1 and key = $2`, [org, key]);
  return r?.data ?? {};
}

export async function setState(q: Queryable, org: string, key: string, patch: Partial<PollState>): Promise<void> {
  await q.query(
    `insert into sm_notify_state (org_id, key, data) values ($1, $2, $3::jsonb)
     on conflict (org_id, key) do update set data = sm_notify_state.data || excluded.data, updated_at = now()`,
    [org, key, JSON.stringify(patch)],
  );
}

const stateKey = (channel: string) => `imap:${channel}`;

// ----- one message ------------------------------------------------------------------------------------------------------

export type IngestStatus = "created" | "replied" | "rejected" | "duplicate";

export interface IngestResult {
  status: IngestStatus;
  reason?: string;
  table?: string;
  id?: string;
  number?: string | null;
  message_id: string;
}

/** Why a message was not taken (Persian labels for the e-mail log). */
export const REJECT_REASONS: Record<string, string> = {
  own_message: "پیام خود سامانه برگشته است",
  own_address: "فرستنده نشانی خود سامانه است",
  auto_reply: "پاسخ خودکار (مثلاً «خارج از دفتر»)",
  bounce: "گزارش تحویل نشدن",
  bulk: "ایمیل انبوه یا فهرست پستی",
  rate_limited: "ایمیل‌های پیاپی بیش از اندازه از یک فرستنده",
  denied: "فرستنده در فهرست مسدود است",
  not_allowed: "فرستنده در فهرست مجاز نیست",
  unknown_sender: "پاسخ از کسی که عضو سازمان نیست",
  no_access: "فرستنده به رکورد دسترسی ندارد",
  no_table: "جدول رکوردهای تازه تنظیم نشده است",
  empty: "ایمیل بی‌متن و بی‌پیوست",
  too_large: "ایمیل بیش از اندازه بزرگ است",
  failed: "خطا در پردازش",
};

const header = (p: ParsedMail, name: string): string => {
  const v = p.headers.get(name);
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (v instanceof Date) return v.toISOString();
  const o = v as { value?: unknown; text?: string };
  if (typeof o.text === "string") return o.text;
  return typeof o.value === "string" ? o.value : JSON.stringify(o.value ?? "");
};

const AUTO_SUBJECT = /^(auto(matic)? ?(reply|response)|out of (the )?office|ooo\b|undeliverable|undelivered mail|delivery status notification|mail delivery (failed|subsystem)|returned mail|پاسخ خودکار|خارج از دفتر|در مرخصی)/i;

/** The loop-protection verdict of a parsed message (null: take it). */
export function loopReason(p: ParsedMail, ownAddresses: string[]): string | null {
  if (header(p, "x-itsm-notification")) return "own_message";
  const from = p.from?.value?.[0]?.address?.toLowerCase() ?? "";
  if (from && ownAddresses.includes(from)) return "own_address";
  const ct = p.headers.get("content-type") as { value?: string } | string | undefined;
  const ctype = typeof ct === "string" ? ct : ct?.value ?? "";
  if (/multipart\/report/i.test(ctype) || /^(mailer-daemon|postmaster)@/i.test(from)) return "bounce";
  const returnPath = header(p, "return-path").trim();
  if (returnPath === "<>" || (p.headers.has("return-path") && returnPath === "")) return "bounce";
  const auto = header(p, "auto-submitted").trim().toLowerCase();
  if (auto && auto !== "no") return "auto_reply";
  if (header(p, "x-autoreply") || header(p, "x-autorespond") || header(p, "x-auto-reply")) return "auto_reply";
  const precedence = header(p, "precedence").trim().toLowerCase();
  if (precedence === "auto_reply") return "auto_reply";
  // mailparser gathers List-Id, List-Unsubscribe… under "list"
  if (["bulk", "list", "junk"].includes(precedence) || p.headers.has("list") || p.headers.has("list-id") || p.headers.has("list-unsubscribe")) return "bulk";
  if (AUTO_SUBJECT.test((p.subject ?? "").trim())) return "auto_reply";
  return null;
}

/** The new text of a reply: quoted history and the signature cut off. */
export function stripQuoted(text: string): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (/^-{2,}\s*(original message|پیام اصلی)\s*-{2,}$/i.test(t)) break;
    if (/^_{10,}$/.test(t)) break;
    if (/^(on|در)\s.+(wrote|نوشت)\s*:?\s*$/i.test(t)) break;
    if (/^(on|در)\s.+/i.test(t) && /(wrote|نوشت)\s*:?\s*$/i.test(lines[i + 1]?.trim() ?? "")) break;
    if (/^(from|از)\s*:\s*.+/i.test(t) && lines.slice(i + 1, i + 4).some((x) => /^(sent|date|to|subject|تاریخ|به|موضوع)\s*:/i.test(x.trim()))) break;
    if (t === "--" || l === "-- ") break;
    if (/^>/.test(t)) {
      // a quoted block that runs to the end is the history; inline quotes inside a message stay
      if (lines.slice(i).every((x) => !x.trim() || /^>/.test(x.trim()))) break;
    }
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const normId = (s: string) => {
  const t = s.trim();
  if (!t) return "";
  return t.startsWith("<") ? t : `<${t}>`;
};

/** The record a reply belongs to: through the Message-IDs it answers, else the number in its subject. */
async function threadOf(sys: Ctx, p: ParsedMail): Promise<{ def: TableDef; id: string } | null> {
  const refs = [p.inReplyTo ?? "", ...(Array.isArray(p.references) ? p.references : p.references ? [p.references] : [])]
    .flatMap((s) => String(s).split(/\s+/))
    .map(normId)
    .filter(Boolean)
    .slice(0, 50);
  if (refs.length) {
    const hit = await sys.db.one<{ table_key: string; record_id: string }>(
      `select table_key, record_id from sm_email_messages where org_id = $1 and message_id = any($2::text[]) and record_id is not null order by created_at desc limit 1`,
      [sys.org.id, pgArray(refs)],
    );
    if (hit) {
      const def = tableDef(hit.table_key);
      if (def && (await live(sys, def, hit.record_id))) return { def, id: hit.record_id };
    }
    // the thread id of our notifications: <r.<record id>@domain>
    for (const r of refs) {
      const m = /^<r\.([0-9a-f-]{36})@/i.exec(r);
      if (!m) continue;
      const known = await sys.db.one<{ table_key: string }>(`select table_key from sm_email_messages where org_id = $1 and record_id = $2 and table_key is not null limit 1`, [sys.org.id, m[1]]);
      const def = known ? tableDef(known.table_key) : undefined;
      if (def && (await live(sys, def, m[1]))) return { def, id: m[1] };
    }
  }
  for (const token of subjectNumbers(p.subject ?? "")) {
    const m = /^(.*?)(\d+)$/.exec(token);
    if (!m) continue;
    for (const def of physicalTables()) {
      if (!def.numbered || def.numbered.prefix !== m[1] || NOTIFY_TABLE_KEYS.has(def.key)) continue;
      const [row] = await systemRows<{ id: string }>(sys, def.key, "t.no = $1", [Number(m[2])], "limit 1");
      if (row) return { def, id: String(row.id) };
    }
  }
  return null;
}

async function live(sys: Ctx, def: TableDef, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [row] = await systemRows<{ id: string }>(sys, def.key, "t.id = $1", [id], "limit 1");
  return !!row;
}

/** The active member with this e-mail address (null: none). */
async function memberByEmail(q: Queryable, org: string, address: string): Promise<string | null> {
  if (!address) return null;
  const r = await q.one<{ id: string }>(
    `select u.id from sm_users u join sm_org_members m on m.user_id = u.id
     where lower(u.email) = $2 and m.org_id = $1 and m.deleted_at is null and m.is_active and not u.disabled limit 1`,
    [org, address.toLowerCase()],
  );
  return r?.id ?? null;
}

/**
 * Log an inbound message (once per Message-ID: the unique index refuses a second row). Returns the new row's id, or
 * null when the message was logged already — inside a write it claims the message first: a second process ingesting
 * the same e-mail waits for the first one's commit here and then gets null (a duplicate), never a second record.
 */
async function logInbound(q: Queryable, org: string, ch: EmailChannelRow, p: ParsedMail | null, x: { messageId: string; uid?: number | null; size?: number; status: string; reason?: string | null; table?: string | null; record?: string | null; data?: Record<string, unknown> }): Promise<string | null> {
  const refs = p ? [...(Array.isArray(p.references) ? p.references : p.references ? [p.references] : [])].slice(0, 50) : [];
  const row = await q.one<{ id: string }>(
    `insert into sm_email_messages (id, org_id, channel_id, direction, message_id, in_reply_to, refs, from_addr, to_addrs, subject, table_key, record_id, status, reason, uid, size, data)
     values ($1, $2, $3, 'in', $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
     on conflict (org_id, message_id, direction) do nothing
     returning id`,
    [
      uuidv7(), org, ch.id, x.messageId, p?.inReplyTo ?? null, JSON.stringify(refs), p?.from?.value?.[0]?.address?.toLowerCase() ?? null,
      p ? [p.to].flat().filter(Boolean).map((a) => a!.text).join(", ").slice(0, 500) : null, (p?.subject ?? "").slice(0, 500), x.table ?? null, x.record ?? null,
      x.status, x.reason ?? null, x.uid ?? null, x.size ?? null, x.data ? JSON.stringify(x.data) : null,
    ],
  );
  return row?.id ?? null;
}

const MAX_ATTACHMENTS = 20;
const BODY_MAX = 50_000;

/** Process one raw message of a channel (the IMAP poll, «بررسی صندوق اکنون», tests with fixture e-mails). */
export async function ingestMessage(cfg: ServerConfig, sys: Ctx, ch: EmailChannelRow, raw: Buffer | Uint8Array | string, opts: { uid?: number | null } = {}): Promise<IngestResult> {
  const buf = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);
  const { simpleParser } = await import("mailparser");
  const p = await simpleParser(buf, { skipTextLinks: true, maxHtmlLengthToParse: 2_000_000 });
  const messageId = normId(p.messageId ?? "") || `<uid.${opts.uid ?? uuidv7()}.${ch.id}@inbound.local>`;
  const org = sys.org.id;
  const seen = await sys.db.one(`select 1 from sm_email_messages where org_id = $1 and message_id = $2`, [org, messageId]);
  if (seen) return { status: "duplicate", message_id: messageId };
  const reject = async (reason: string): Promise<IngestResult> => {
    await logInbound(sys.db, org, ch, p, { messageId, uid: opts.uid, size: buf.byteLength, status: "rejected", reason });
    return { status: "rejected", reason, message_id: messageId };
  };
  const own = (await emailChannels(sys)).map((c) => c.from_address.toLowerCase());
  const loop = loopReason(p, own);
  if (loop) return reject(loop);
  const from = p.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const fromName = p.from?.value?.[0]?.name ?? "";
  if (!from) return reject("unknown_sender");
  if (addressMatches(from, ch.deny_list ?? [])) return reject("denied");
  if ((ch.allow_list ?? []).length && !addressMatches(from, ch.allow_list ?? [])) return reject("not_allowed");
  const recent = await sys.db.one<{ n: number }>(
    `select count(*)::int as n from sm_email_messages where org_id = $1 and direction = 'in' and from_addr = $2 and created_at > now() - interval '10 minutes'`,
    [org, from],
  );
  if ((recent?.n ?? 0) >= 20) return reject("rate_limited");

  const member = await memberByEmail(sys.db, org, from);
  const actx = member ? await systemCtx(cfg, org, { onBehalfOf: member }) : sys;
  const max = maxAttachmentBytes(actx);
  const files = (p.attachments ?? [])
    .filter((a) => !a.related || a.contentDisposition === "attachment")
    .filter((a) => a.size > 0 && a.size <= max)
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => ({ name: a.filename || "پیوست", type: a.contentType, data: new Uint8Array(a.content) }));
  const dropped = (p.attachments ?? []).filter((a) => a.size > max).map((a) => a.filename ?? "");
  const meta = { from, from_name: fromName, subject: p.subject ?? "", date: p.date?.toISOString() ?? null, ...(dropped.length ? { dropped } : {}) };

  const thread = await threadOf(sys, p);
  if (thread) {
    if (!member) return reject("unknown_sender");
    const readers = await readersOf(cfg, org, thread.def.key, thread.id, [member]);
    if (!readers.length) return reject("no_access");
    const text = stripQuoted(p.text ?? "").slice(0, BODY_MAX);
    if (!text && !files.length) return reject("empty");
    const out = await actx.write(async (tx) => {
      // the message claimed first (its log row, unique per Message-ID): the IMAP job and «بررسی صندوق اکنون» on two
      // processes fetching the same reply — the second waits here for the first's commit and adds nothing
      if (!(await logInbound(tx, org, ch, p, { messageId, uid: opts.uid, size: buf.byteLength, status: "processed", table: thread.def.key, record: thread.id, data: meta }))) return null;
      const [row] = await systemRows<Record<string, any>>(sys, thread.def.key, "t.id = $1", [thread.id], "for update of t", tx);
      const ids: string[] = [];
      if (thread.def.features?.attachments) for (const f of files) ids.push((await addAttachmentIn(tx, actx, thread.def, thread.id, f)).id);
      await addJournalIn(tx, actx, thread.def, row, { kind: "email_in", visibility: "public", body: text || "(پیوست)", data: { ...meta, message_id: messageId }, attachments: ids }, { trusted: true, author: member });
      return { number: (row.number as string | null) ?? null };
    });
    if (!out) return { status: "duplicate", message_id: messageId };
    return { status: "replied", table: thread.def.key, id: thread.id, number: out.number, message_id: messageId };
  }

  const def = tableDef(String(ch.target_table || "todo"));
  if (!def || def.virtual || NOTIFY_TABLE_KEYS.has(def.key)) return reject("no_table");
  const text = String(p.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, BODY_MAX);
  const subject = (p.subject ?? "").replace(/\s+/g, " ").trim();
  if (!subject && !text && !files.length) return reject("empty");
  const field = (n: string) => def.fields.find((f) => f.name === n);
  const displayMax = field(def.display)?.maxLength ?? 200;
  const data: Record<string, unknown> = { [def.display]: (subject || text.split("\n")[0] || "ایمیل بی‌موضوع").slice(0, Math.min(displayMax, 200)) };
  const desc = field("description");
  if (desc && (desc.type === "markdown" || desc.type === "text")) {
    const who = member ? "" : `از: ${fromName ? `${fromName} ` : ""}<${from}>\n\n`;
    data.description = `${who}${text}`.slice(0, desc.type === "text" ? 20_000 : BODY_MAX);
  }
  const channelField = field("channel");
  if (channelField?.type === "choice") data.channel = "email";
  if (member) {
    for (const n of ["caller_id", "requested_for"]) if (field(n)?.type === "user") data[n] = member;
  }
  if (ch.workspace_id) data.workspace_id = ch.workspace_id;
  const created = await actx.write(async (tx) => {
    // the message claimed first (see the reply above): one e-mail, one record, however many processes fetch it
    const logId = await logInbound(tx, org, ch, p, { messageId, uid: opts.uid, size: buf.byteLength, status: "processed", table: def.key, record: null, data: meta });
    if (!logId) return null;
    const row = await createIn(tx, actx, def.key, data, { trusted: true });
    if (def.features?.attachments) for (const f of files) await addAttachmentIn(tx, actx, def, String(row.id), f);
    await tx.query(`update sm_email_messages set record_id = $2 where id = $1`, [logId, String(row.id)]);
    return row;
  });
  if (!created) return { status: "duplicate", message_id: messageId };
  return { status: "created", table: def.key, id: String(created.id), number: (created.number as string | null) ?? null, message_id: messageId };
}

// ----- polling ------------------------------------------------------------------------------------------------------------

export interface PollResult {
  fetched: number;
  created: number;
  replied: number;
  rejected: number;
  duplicate: number;
  failed: number;
}

const polling = new Set<string>();
const MAX_PER_POLL = 50;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** Read a channel's new mail now. */
export async function pollChannel(cfg: ServerConfig, sys: Ctx, ch: EmailChannelRow): Promise<PollResult> {
  const key = `${sys.org.id}:${ch.id}`;
  if (polling.has(key)) throw new Error("خواندن این صندوق هم‌اکنون در جریان است");
  polling.add(key);
  const result: PollResult = { fetched: 0, created: 0, replied: 0, rejected: 0, duplicate: 0, failed: 0 };
  const sk = stateKey(ch.id);
  try {
    const host = String(ch.imap_host ?? "").trim();
    if (!host || !ch.imap_user) throw new Error("سرور یا نام کاربری IMAP تنظیم نشده است");
    if (opener === imapflowOpener) await checkMailHost(cfg, host);
    const pass = channelSecret(cfg, sys.org.id, "email_channel", "imap_password", ch as unknown as { id: string } & Record<string, unknown>) ?? "";
    const security = ch.imap_security ?? "tls";
    const state = await getState(sys.db, sys.org.id, sk);
    const session = await opener({ host, port: Number(ch.imap_port) || (security === "tls" ? 993 : 143), security, user: String(ch.imap_user), pass });
    const folder = ch.imap_folder || "INBOX";
    const taken: number[] = [];
    try {
      const fresh = state.lastUid === null || state.lastUid === undefined;
      const r = await session.fetch({ folder, lastUid: fresh ? null : Number(state.lastUid), uidValidity: state.uidValidity ?? null, max: MAX_PER_POLL, maxBytes: MAX_MESSAGE_BYTES });
      // a first look (or a recreated folder) takes the recent unseen mail and then starts after the newest message;
      // if it stops half-way the next look is a first look again (what was taken is recognised by its Message-ID)
      const reset = fresh || r.uidValidity !== state.uidValidity;
      let lastUid = reset ? 0 : Number(state.lastUid);
      const advance = async (uid: number) => {
        lastUid = Math.max(lastUid, uid);
        if (!reset) await setState(sys.db, sys.org.id, sk, { uidValidity: r.uidValidity, lastUid });
      };
      for (const s of r.skipped) {
        await logInbound(sys.db, sys.org.id, ch, null, { messageId: `<uid.${s.uid}.${r.uidValidity}.${ch.id}@inbound.local>`, uid: s.uid, size: s.size, status: "rejected", reason: "too_large" });
        result.rejected++;
        await advance(s.uid);
      }
      for (const m of r.messages) {
        result.fetched++;
        try {
          const out = await ingestMessage(cfg, sys, ch, m.source, { uid: m.uid });
          result[out.status === "created" ? "created" : out.status === "replied" ? "replied" : out.status === "duplicate" ? "duplicate" : "rejected"]++;
          taken.push(m.uid);
        } catch (e) {
          result.failed++;
          cfg.log.warn("inbound e-mail failed", { channel: ch.id, uid: m.uid, error: errText(e) });
          await logInbound(sys.db, sys.org.id, ch, null, { messageId: `<uid.${m.uid}.${r.uidValidity}.${ch.id}@inbound.local>`, uid: m.uid, status: "rejected", reason: "failed", data: { error: errText(e) } }).catch(() => undefined);
        }
        await advance(m.uid);
      }
      await setState(sys.db, sys.org.id, sk, { uidValidity: r.uidValidity, lastUid: reset ? Math.max(lastUid, r.uidNext - 1) : lastUid });
      await session.markSeen(folder, taken).catch(() => undefined);
    } finally {
      await session.close().catch(() => undefined);
    }
    await setState(sys.db, sys.org.id, sk, { last_checked_at: new Date().toISOString(), last_error: null, last_result: result });
    return result;
  } catch (e) {
    await setState(sys.db, sys.org.id, sk, { last_checked_at: new Date().toISOString(), last_error: errText(e) }).catch(() => undefined);
    throw e;
  } finally {
    polling.delete(key);
  }
}

export const JOB_IMAP = "notify.imap";
const POLL_EVERY = 60_000;

/** Make sure an inbound channel has its poller (after a channel row changed, on any runtime that delivers). */
export async function ensurePoller(q: Queryable, org: string, channel: string, delayMs = 0): Promise<void> {
  const id = await enqueue(q, { kind: JOB_IMAP, orgId: org, payload: { org, channel }, delayMs, dedupeKey: `notify.imap:${channel}`, maxAttempts: 3 });
  await setState(q, org, stateKey(channel), { poller: id });
}

async function runPoll(job: Job, jctx: JobContext): Promise<void | { again: number }> {
  const { org, channel } = job.payload as { org: string; channel: string };
  if (!actsHere(jctx.cfg)) return { again: 5 * POLL_EVERY };
  const state = await getState(jctx.db, org, stateKey(channel));
  if (state.poller && state.poller !== job.id) return; // another poller owns this channel
  const sys = await sysCtx(jctx.cfg, org).catch(() => null);
  if (!sys) return;
  const ch = (await emailChannels(sys)).find((c) => c.id === channel);
  if (!ch || !ch.active || !ch.inbound) return;
  try {
    await pollChannel(fullCfg(jctx.cfg), sys, ch);
  } catch (e) {
    jctx.log.warn("mailbox poll failed", { channel, error: errText(e) });
    return { again: 5 * POLL_EVERY };
  }
  return { again: POLL_EVERY };
}

export function registerInboundJobs(): void {
  registerJobHandler(JOB_IMAP, runPoll);
}
