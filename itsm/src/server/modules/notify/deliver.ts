// From a record event to messages: the subscriber matches the organisation's rules (and the built-ins), resolves the
// recipients and queues one delivery job per person (`notify.send`) and per messenger/webhook channel
// (`notify.hook`) — all in one transaction, so a retried event never queues half. A delivery renders the message
// under the recipient's own access (render.ts: no access → nothing, hidden fields → «(محدود)»), honours their
// preferences (switched-off events, quiet hours, e-mail digests; mandatory rules excepted) and sends through the
// channels — in-app inbox rows, e-mail (SMTP), SMS — saving its progress so a retry never repeats a channel that
// already went out. Every outcome lands in the delivery log. Held e-mails and SMS go out with `notify.flush`.
import { mentionedIds } from "@ui/records/model/mentions";
import type { TableDef } from "@shared/model/types";
import { NOTIFY_TABLE_KEYS } from "@shared/tables/notify";
import {
  cleanPrefs, inboxKind, nextDigestAt, normalizeMobile, optedOut, quietUntil, type NotifyChannel, type NotifyEvent, type NotifyPrefs,
} from "@shared/notify";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { enqueue, PermanentJobError, registerJobHandler, type Job, type JobContext } from "../../jobs";
import { condEnv, createIn, defFor, list, removeIn, type RecordEvent } from "../../engine";
import { memberCtx, readersOf } from "../../access";
import { access } from "../../access/provider";
import { AppError } from "../../http/errors";
import { actsHere, errText, fullCfg, isUuid, recordUrl, sysCtx, systemRows, tzOf } from "./common";
import { logDelivery, settleHeld, type LogInput } from "./log";
import { candidateRules, COMMENT_KINDS, eventRows, ruleHolds, snapOf, walkPaths, type RuleSnap } from "./rules";
import { MAX_RECIPIENTS, eventUsersOf, resolveRecipients } from "./recipients";
import { defaultTemplate, renderFor, type EventSnap, type Rendered, type TemplateText } from "./render";
import { emailLayout, markdownToHtml, markdownToText, newMessageId, outboundChannel, rememberOutbound, sendMail, threadId, withNumber } from "./mail";
import { channelRows, sendOutside, sendSms, type ChannelRow } from "./channels";

export const JOB_SEND = "notify.send";
export const JOB_HOOK = "notify.hook";
export const JOB_FLUSH = "notify.flush";

/** A queued delivery to one person. */
export interface SendPayload {
  org: string;
  rule: RuleSnap & { inline?: TemplateText | null };
  ev: EventSnap;
  user: string;
  reasons: string[];
  /** channels already delivered (a retry skips them) */
  done?: string[];
  /** log rows of failed attempts, by channel (a retry updates them) */
  logs?: Record<string, string>;
}

export interface HookPayload {
  org: string;
  rule: RuleSnap & { inline?: TemplateText | null };
  ev: EventSnap;
  channel: string;
  log?: string | null;
}

// ----- the subscriber ---------------------------------------------------------------------------------------------

interface Entry {
  kind: string;
  visibility: string;
  body: string;
  author: string | null;
}

async function loadEntry(q: Queryable, org: string, table: string, record: string, id: string): Promise<Entry | null> {
  if (!isUuid(id)) return null;
  return q.one<Entry>(
    `select kind, visibility, body, author from sm_journal where id = $1 and org_id = $2 and table_key = $3 and record_id = $4 and deleted_at is null`,
    [id, org, table, record],
  );
}

/** The live record as the system reads it, with the values of the dot-walked paths a condition needs. */
async function systemRow(sys: Ctx, def: TableDef, id: string, walks: string[]): Promise<Record<string, unknown> | null> {
  const fields = def.fields.map((f) => f.name);
  const r = await list(sys, def.key, { ids: [id], fields: [...fields.slice(0, 80 - Math.min(walks.length, 20)), ...walks.slice(0, 20)], total: false, size: 1 });
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export function snapEvent(e: RecordEvent, event: NotifyEvent, custom: string | null): EventSnap {
  return {
    event,
    kind: e.kind,
    table: e.table,
    id: e.id,
    number: e.number ?? null,
    actor: e.actor,
    at: e.at,
    from: e.from ?? null,
    to: e.to ?? null,
    from_category: e.from_category ?? null,
    to_category: e.to_category ?? null,
    changes: e.changes,
    changed: e.changed,
    entry: e.entry ?? null,
    data: e.data,
    custom,
  };
}

interface QueuedJob {
  kind: string;
  payload: Record<string, unknown>;
}

/** Match the rules of a record event and queue its deliveries (one transaction). */
export async function dispatchEvent(e: RecordEvent, jctx: JobContext): Promise<number> {
  if (NOTIFY_TABLE_KEYS.has(e.table) || e.kind === "record.deleted") return 0;
  const sys = await sysCtx(jctx.cfg, e.org_id);
  const found = await defFor(sys, e.table).catch(() => null);
  const def = found?.def;
  if (!def || def.virtual) return 0;
  const rules = await candidateRules(sys, def, e);
  if (!rules.length) return 0;
  const walks = [...new Set(rules.flatMap((r) => walkPaths(r.condition)))];
  const row = await systemRow(sys, def, e.id, walks);
  if (!row) return 0;
  const rows = eventRows(def, row, e);
  const env = { ...(await condEnv(sys)), userId: e.actor };
  const entry = e.entry ? await loadEntry(jctx.db, e.org_id, e.table, e.id, e.entry.id) : null;
  const commentable = !!entry && COMMENT_KINDS.has(entry.kind);
  const mentions = commentable ? mentionedIds(entry!.body).filter((u) => u !== entry!.author) : [];
  const eventUsers = eventUsersOf(e.data);
  const jobs: QueuedJob[] = [];
  for (const rule of rules) {
    if ((rule.event === "commented" || rule.event === "mentioned") && !commentable) continue;
    if (rule.event === "mentioned" && !mentions.length) continue;
    if (!ruleHolds(rule, def, rows, env, entry?.kind ?? null)) continue;
    const ev = snapEvent(e, rule.event, rule.custom_event);
    const snap = snapOf(rule);
    const people = await resolveRecipients({ sys, def, row: rows.next, spec: rule.recipients, mentioned: mentions, eventUsers });
    if (!rule.notify_actor && e.actor) people.delete(e.actor.toLowerCase());
    const personal = rule.channels.filter((c) => c !== "webhook");
    if (personal.length) {
      const list = [...people].slice(0, MAX_RECIPIENTS);
      if (people.size > MAX_RECIPIENTS) jctx.log.warn("notification recipients truncated", { rule: rule.key, count: people.size });
      for (const [user, reasons] of list) jobs.push({ kind: JOB_SEND, payload: { org: e.org_id, rule: snap, ev, user, reasons: [...reasons] } satisfies SendPayload as unknown as Record<string, unknown> });
    }
    if (rule.channels.includes("webhook")) {
      for (const t of rule.targets) if (isUuid(t)) jobs.push({ kind: JOB_HOOK, payload: { org: e.org_id, rule: snap, ev, channel: t } satisfies HookPayload as unknown as Record<string, unknown> });
    }
    // an @mention of someone who cannot read the record (or this internal note): the author hears it, they do not
    if (rule.event === "mentioned" && entry?.author && rule.recipients.mentioned) {
      const denied = await mentionDenied(jctx, e, mentions, entry);
      if (denied.length) jobs.push({ kind: JOB_SEND, payload: mentionWarning(e, entry.author, denied) as unknown as Record<string, unknown> });
    }
  }
  if (!jobs.length) return 0;
  await jctx.db.tx(async (tx) => {
    for (const j of jobs) await enqueue(tx, { kind: j.kind, orgId: e.org_id, payload: j.payload, maxAttempts: 6 });
  });
  return jobs.length;
}

/** Mentioned people who may not read the record (or, for an internal note, internal notes). */
async function mentionDenied(jctx: JobContext, e: RecordEvent, mentions: string[], entry: Entry): Promise<string[]> {
  const cfg = fullCfg(jctx.cfg);
  const readers = new Set(await readersOf(cfg, e.org_id, e.table, e.id, mentions));
  const out: string[] = [];
  for (const u of mentions) {
    if (!readers.has(u)) {
      out.push(u);
      continue;
    }
    if (entry.visibility === "internal") {
      const rctx = await memberCtx(cfg, e.org_id, u).catch(() => null);
      if (!rctx || !access().hasFieldGroup(rctx, "internal")) out.push(u);
    }
  }
  return out;
}

function mentionWarning(e: RecordEvent, author: string, denied: string[]): SendPayload {
  return {
    org: e.org_id,
    rule: {
      key: "system:mention_denied",
      name: "نام بردن از کسی که دسترسی ندارد",
      event: "mentioned",
      channels: ["in_app"],
      targets: [],
      template_id: null,
      digest: false,
      mandatory: true,
      inline: {
        subject: "{{event.count}} نفر از نام بردن شما در {{record.display}} باخبر نشدند",
        body: "کسانی که از آنها نام بردید این رکورد{{#if event.internal}} یا یادداشت‌های داخلی آن{{/if}} را نمی‌بینند و اعلانی نگرفتند. اگر لازم است، رکورد را به آنها ارجاع دهید یا به فهرست پیگیری‌کنندگان بیفزایید.\n\n[مشاهدهٔ {{record.number}}]({{link}})",
        short_text: null,
      },
    },
    ev: { ...snapEvent(e, "mentioned", null), entry: null, data: { count: String(denied.length), users: denied, internal: e.entry?.visibility === "internal" ? "1" : "" } },
    user: author,
    reasons: ["system"],
  };
}

// ----- one person ---------------------------------------------------------------------------------------------------

/** The person's preferences (defaults when they have none). */
export async function prefsOf(sys: Ctx, user: string): Promise<NotifyPrefs & { id: string | null; read_before: string | null; version: number | null }> {
  const [row] = await systemRows<Record<string, any>>(sys, "notification_pref", "t.user_id = $1", [user], "limit 1");
  return { ...cleanPrefs(row), id: row?.id ?? null, read_before: row?.read_before ?? null, version: row?.version ?? null };
}

async function templateOf(sys: Ctx, rule: SendPayload["rule"]): Promise<TemplateText> {
  if (rule.inline) return rule.inline;
  if (rule.template_id && isUuid(rule.template_id)) {
    const [t] = await systemRows<Record<string, any>>(sys, "notification_template", "t.id = $1 and t.active", [rule.template_id]);
    if (t?.subject) return { subject: String(t.subject), body: String(t.body ?? ""), short_text: t.short_text ?? null };
  }
  return defaultTemplate(rule.event);
}

function logBase(p: { org: string; rule: RuleSnap; ev: EventSnap }): Omit<LogInput, "channel" | "status"> {
  return { org: p.org, rule_key: p.rule.key, rule_name: p.rule.name, event: p.rule.event, table_key: p.ev.table, record_id: p.ev.id, record_number: p.ev.number };
}

/** Record a failed attempt (one row per channel across retries); rethrow while attempts remain. */
async function failed(jctx: JobContext, job: Job, p: SendPayload | HookPayload, channel: string, e: unknown, extra: Partial<LogInput> = {}): Promise<never | void> {
  const error = errText(e);
  const logs = ("logs" in p ? p.logs : undefined) ?? {};
  const prev = "logs" in p ? logs[channel] : (p as HookPayload).log;
  if (prev) await jctx.db.query(`update sm_notification_log set error = $2, updated_at = now() where id = $1`, [prev, error]);
  else {
    const id = await logDelivery(jctx.db, { ...logBase(p), channel, status: "failed", error, ...extra });
    if ("user" in p) p.logs = { ...logs, [channel]: id };
    else (p as HookPayload).log = id;
  }
  await jctx.save(p as unknown as Record<string, unknown>);
  const permanent = e instanceof PermanentJobError || (e instanceof AppError && e.status < 500);
  if (!permanent && job.attempts < job.max_attempts) throw e;
}

/** A failed row of an earlier attempt becomes the outcome; or a new row. */
async function outcome(jctx: JobContext, p: SendPayload | HookPayload, channel: string, x: Partial<LogInput> & Pick<LogInput, "status">): Promise<void> {
  const prev = "user" in p ? p.logs?.[channel] : (p as HookPayload).log;
  if (prev) {
    await jctx.db.query(
      `update sm_notification_log set status = $2, reason = $3, error = $4, provider_id = $5, subject = coalesce($6, subject), target = coalesce($7, target), updated_at = now() where id = $1`,
      [prev, x.status, x.reason ?? null, x.error ?? null, x.provider_id ?? null, x.subject ? String(x.subject).slice(0, 300) : null, x.target ?? null],
    );
    return;
  }
  await logDelivery(jctx.db, { ...logBase(p), channel, ...x });
}

async function holdFor(jctx: JobContext, p: SendPayload, channel: "email" | "sms", until: Date, reason: "quiet" | "digest"): Promise<void> {
  await logDelivery(jctx.db, {
    ...logBase(p),
    channel,
    recipient_id: p.user,
    status: "held",
    reason,
    due_at: until,
    payload: { rule: p.rule, ev: p.ev, reasons: p.reasons },
  });
  const at = new Date(Math.ceil(until.getTime() / 60_000) * 60_000);
  await enqueue(jctx.db, { kind: JOB_FLUSH, orgId: p.org, payload: { org: p.org, user: p.user, channel }, runAt: at, dedupeKey: `notify.flush:${p.user}:${channel}:${at.toISOString()}` });
}

async function inApp(sys: Ctx, p: SendPayload, r: Rendered): Promise<string> {
  const row = await sys.write((tx) =>
    createIn(
      tx,
      sys,
      "notification",
      {
        user_id: p.user,
        title: r.title,
        body: r.body.slice(0, 8000),
        link: r.path,
        table_key: p.ev.table,
        record_id: p.ev.id,
        record_number: r.number,
        event: p.rule.event,
        kind: p.rule.key.startsWith("system:") ? "system" : inboxKind(p.rule.event, p.reasons),
        actor_id: p.ev.actor,
        rule_key: p.rule.key.slice(0, 80),
      },
      { trusted: true },
    ),
  );
  return String(row.id);
}

/** Compose and send one notification e-mail to `to`. */
async function email(jctx: JobContext, sys: Ctx, to: string, items: { r: Rendered; ev: EventSnap }[], digest: boolean): Promise<{ id: string; subject: string }> {
  const cfg = fullCfg(jctx.cfg);
  const ch = await outboundChannel(sys);
  if (!ch) throw new PermanentJobError("no_channel");
  const one = items.length === 1 && !digest ? items[0] : null;
  const title = one ? one.r.title : `خلاصهٔ اعلان‌ها: ${items.length.toLocaleString("fa-IR")} مورد`;
  const subject = one ? withNumber(one.r.title, one.r.number) : title;
  const sections = one
    ? one.r.body
    : items.map(({ r }) => `### ${r.title.replace(/[#*_[\]\\]/g, "")}\n\n${r.body}${/^https?:/.test(r.url) ? `\n\n[مشاهدهٔ ${r.number ?? r.tableLabel}](${r.url})` : ""}`).join("\n\n---\n\n");
  const url = one && /^https?:/.test(one.r.url) ? one.r.url : null;
  const html = emailLayout({
    title,
    bodyHtml: markdownToHtml(sections),
    orgName: sys.org.name,
    url,
    action: one ? `مشاهدهٔ ${one.r.number ?? one.r.tableLabel}` : null,
    signatureHtml: ch.signature ? markdownToHtml(ch.signature) : null,
    replies: !!one && ch.inbound,
  });
  const text = [title, markdownToText(sections), url ?? ""].filter(Boolean).join("\n\n");
  const messageId = newMessageId(ch.from_address);
  const record = one ? one.ev.id : null;
  const sent = await sendMail(cfg, sys.org.id, ch, {
    from: { name: ch.from_name || sys.org.name, address: ch.from_address },
    to,
    replyTo: ch.reply_to,
    subject,
    text,
    html,
    messageId,
    references: record ? [threadId(record, ch.from_address)] : [],
  });
  await rememberOutbound(jctx.db, { org: sys.org.id, channel: ch.id, messageId, to, subject, table: one?.ev.table ?? null, record, status: "sent" });
  return { id: sent.messageId, subject };
}

async function smsGateway(sys: Ctx, targets: string[]): Promise<ChannelRow | null> {
  const chosen = (await channelRows(sys, targets.filter(isUuid))).filter((c) => c.kind === "sms" && c.active);
  if (chosen.length) return chosen[0];
  return (await channelRows(sys)).find((c) => c.kind === "sms" && c.active) ?? null;
}

const smsText = (r: Rendered) => {
  const link = /^https?:/.test(r.url) ? ` ${r.url}` : "";
  return `${r.short.slice(0, 300 - link.length)}${link}`;
};

export async function runSend(job: Job, jctx: JobContext): Promise<void> {
  const p = job.payload as unknown as SendPayload;
  if (!actsHere(jctx.cfg)) return;
  const cfg = fullCfg(jctx.cfg);
  const done = new Set(p.done ?? []);
  const channels = p.rule.channels.filter((c): c is Exclude<NotifyChannel, "webhook"> => c !== "webhook" && !done.has(c));
  if (!channels.length) return;
  const sys = await sysCtx(jctx.cfg, p.org);
  const base = { ...logBase(p), recipient_id: p.user };
  const skipAll = async (reason: string) => {
    for (const c of channels) await outcome(jctx, p, c, { ...base, status: "skipped", reason });
  };
  const rctx = await memberCtx(cfg, p.org, p.user).catch(() => null);
  if (!rctx) return skipAll("inactive");
  const entry = p.ev.entry ? await loadEntry(jctx.db, p.org, p.ev.table, p.ev.id, p.ev.entry.id) : null;
  if (p.ev.entry && !entry) return skipAll("record_gone");
  const tpl = await templateOf(sys, p.rule);
  let r: Rendered | null;
  try {
    r = await renderFor(rctx, p.ev, tpl, { cfg, entry });
  } catch (e) {
    if (e instanceof AppError && e.status === 404) r = null;
    else throw e;
  }
  if (!r) return skipAll("no_access");
  const prefs = await prefsOf(sys, p.user);
  const tz = tzOf(sys.org);
  const now = new Date();
  for (const c of channels) {
    try {
      if (!p.rule.mandatory && optedOut(prefs, p.rule.event, c)) {
        await outcome(jctx, p, c, { ...base, status: "skipped", reason: "opted_out" });
      } else if (c === "in_app") {
        const id = await inApp(sys, p, r);
        await outcome(jctx, p, c, { ...base, status: "sent", provider_id: id, subject: r.title, body: r.body });
      } else {
        const target = c === "email" ? rctx.user.email : normalizeMobile(rctx.user.mobile);
        const quiet = p.rule.mandatory ? null : quietUntil(prefs, now, tz);
        if (!target) await outcome(jctx, p, c, { ...base, status: "skipped", reason: "no_address" });
        else if (quiet) await holdFor(jctx, p, c, quiet, "quiet");
        else if (c === "email" && !p.rule.mandatory && p.rule.digest && prefs.digest !== "none") await holdFor(jctx, p, c, nextDigestAt(prefs.digest, now, tz, prefs.digest_hour), "digest");
        else if (c === "email") {
          const sent = await email(jctx, sys, target, [{ r, ev: p.ev }], false);
          await outcome(jctx, p, c, { ...base, status: "sent", target, provider_id: sent.id, subject: sent.subject, body: r.body });
        } else {
          const gw = await smsGateway(sys, p.rule.targets);
          if (!gw) await outcome(jctx, p, c, { ...base, status: "skipped", reason: "no_channel", target });
          else {
            const answer = await sendSms(cfg, p.org, gw, { to: target, text: smsText(r) });
            await outcome(jctx, p, c, { ...base, status: "sent", target, provider_id: answer, subject: r.title });
          }
        }
      }
    } catch (e) {
      if (e instanceof PermanentJobError && e.message === "no_channel") await outcome(jctx, p, c, { ...base, status: "skipped", reason: "no_channel" });
      else {
        await failed(jctx, job, p, c, e, { recipient_id: p.user, subject: r.title });
        continue;
      }
    }
    done.add(c);
    p.done = [...done];
    await jctx.save(p as unknown as Record<string, unknown>);
  }
}

// ----- messengers and webhooks ----------------------------------------------------------------------------------

export async function runHook(job: Job, jctx: JobContext): Promise<void> {
  const p = job.payload as unknown as HookPayload;
  if (!actsHere(jctx.cfg)) return;
  const cfg = fullCfg(jctx.cfg);
  const sys = await sysCtx(jctx.cfg, p.org);
  const [ch] = await channelRows(sys, [p.channel]);
  const base = { ...logBase(p), target: ch?.name ?? p.channel };
  if (!ch || !ch.active || ch.kind === "sms") return void (await outcome(jctx, p, "webhook", { ...base, status: "skipped", reason: "channel_inactive" }));
  // what the channel may receive: what its principal may read
  const rctx = ch.principal_id ? await memberCtx(cfg, p.org, ch.principal_id).catch(() => null) : null;
  if (!rctx) return void (await outcome(jctx, p, "webhook", { ...base, status: "skipped", reason: "inactive" }));
  const entry = p.ev.entry ? await loadEntry(jctx.db, p.org, p.ev.table, p.ev.id, p.ev.entry.id) : null;
  let r: Rendered | null;
  try {
    r = await renderFor(rctx, p.ev, await templateOf(sys, p.rule), { cfg, entry });
  } catch (e) {
    if (e instanceof AppError && e.status === 404) r = null;
    else throw e;
  }
  if (!r) return void (await outcome(jctx, p, "webhook", { ...base, status: "skipped", reason: "no_access" }));
  try {
    const answer = await sendOutside(cfg, p.org, ch, {
      title: r.title,
      body: r.body,
      short: r.short,
      url: r.url,
      meta: { event: p.rule.event, table: p.ev.table, id: p.ev.id, number: r.number, rule: p.rule.name, at: p.ev.at },
    });
    await outcome(jctx, p, "webhook", { ...base, status: "sent", provider_id: answer, subject: r.title, body: r.body });
  } catch (e) {
    await failed(jctx, job, p, "webhook", e, { target: ch.name, subject: r.title });
  }
}

// ----- quiet hours and digests ----------------------------------------------------------------------------------------

interface HeldRow {
  id: string;
  channel: "email" | "sms";
  reason: string | null;
  due_at: string;
  payload: { rule: SendPayload["rule"]; ev: EventSnap; reasons: string[] } | null;
}

export async function runFlush(job: Job, jctx: JobContext): Promise<void> {
  const { org, user, channel } = job.payload as { org: string; user: string; channel: "email" | "sms" };
  if (!actsHere(jctx.cfg)) return;
  const cfg = fullCfg(jctx.cfg);
  const held = await jctx.db.query<HeldRow>(
    `select id, channel, reason, due_at, payload from sm_notification_log
     where org_id = $1 and recipient_id = $2 and channel = $3 and status = 'held' and due_at <= now() + interval '1 minute'
     order by created_at limit 200`,
    [org, user, channel],
  );
  if (!held.length) return;
  const sys = await sysCtx(jctx.cfg, org);
  const rctx = await memberCtx(cfg, org, user).catch(() => null);
  if (!rctx) {
    for (const h of held) await settleHeld(jctx.db, h.id, "skipped", { reason: "inactive" });
    return;
  }
  const items: { h: HeldRow; r: Rendered; ev: EventSnap }[] = [];
  for (const h of held) {
    if (!h.payload) {
      await settleHeld(jctx.db, h.id, "skipped", { reason: "record_gone" });
      continue;
    }
    const ev = h.payload.ev;
    const entry = ev.entry ? await loadEntry(jctx.db, org, ev.table, ev.id, ev.entry.id) : null;
    const r = ev.entry && !entry ? null : await renderFor(rctx, ev, await templateOf(sys, h.payload.rule), { cfg, entry }).catch(() => null);
    if (!r) await settleHeld(jctx.db, h.id, "skipped", { reason: "no_access" });
    else items.push({ h, r, ev });
  }
  if (!items.length) return;
  if (channel === "email") {
    const to = rctx.user.email;
    const digest = items.length > 1 || items.some((i) => i.h.reason === "digest");
    try {
      const sent = await email(jctx, sys, to, items.map(({ r, ev }) => ({ r, ev })), digest);
      for (const i of items) await settleHeld(jctx.db, i.h.id, "sent", { provider_id: sent.id });
    } catch (e) {
      if (job.attempts < job.max_attempts && !(e instanceof PermanentJobError)) throw e;
      for (const i of items) await settleHeld(jctx.db, i.h.id, e instanceof PermanentJobError ? "skipped" : "failed", { reason: e instanceof PermanentJobError ? e.message : null, error: errText(e) });
    }
    return;
  }
  const mobile = normalizeMobile(rctx.user.mobile);
  const p0 = items[0].h.payload!;
  const gw = await smsGateway(sys, p0.rule.targets ?? []);
  for (const i of items) {
    if (!mobile || !gw) {
      await settleHeld(jctx.db, i.h.id, "skipped", { reason: mobile ? "no_channel" : "no_address" });
      continue;
    }
    try {
      const answer = await sendSms(cfg, org, gw, { to: mobile, text: smsText(i.r) });
      await settleHeld(jctx.db, i.h.id, "sent", { provider_id: answer });
    } catch (e) {
      await settleHeld(jctx.db, i.h.id, "failed", { error: errText(e) });
    }
  }
}

// ----- notifications from other services (flows, approvals…) ---------------------------------------------------

export interface DirectNotify {
  table: string;
  id: string;
  /** people to notify (each still needs read access to the record) */
  users: string[];
  /** a notification event (default custom) and a label shown for custom ones */
  event?: NotifyEvent;
  label?: string;
  subject?: string;
  body?: string;
  short_text?: string;
  template_id?: string | null;
  channels?: NotifyChannel[];
  mandatory?: boolean;
  actor?: string | null;
  /** what to call the sender in the log («گردش‌کار …») */
  source?: string;
}

/**
 * Queue notifications to named people about a record (the flow designer's «اعلان» node, services that pick their own
 * recipients). Runs inside the caller's transaction when `q` is one; access is checked per person on delivery.
 */
export async function notifyPeople(q: Queryable, orgId: string, n: DirectNotify): Promise<number> {
  const event: NotifyEvent = n.event ?? "custom";
  const users = [...new Set(n.users.filter(isUuid).map((u) => u.toLowerCase()))].slice(0, MAX_RECIPIENTS);
  if (!users.length) return 0;
  const inline = n.subject ? { subject: n.subject, body: n.body ?? "", short_text: n.short_text ?? null } : null;
  const rule: SendPayload["rule"] = {
    key: `direct:${(n.source ?? "service").slice(0, 60)}`,
    name: n.source ?? "اعلان مستقیم",
    event,
    channels: n.channels?.length ? n.channels.filter((c) => c !== "webhook") : ["in_app"],
    targets: [],
    template_id: n.template_id ?? null,
    digest: !n.mandatory,
    mandatory: !!n.mandatory,
    inline,
  };
  const ev: EventSnap = { event, kind: "record.notify", table: n.table, id: n.id, number: null, actor: n.actor ?? null, at: new Date().toISOString(), entry: null, data: n.label ? { label: n.label } : undefined, custom: event === "custom" ? n.label ?? "notify" : null };
  for (const user of users) await enqueue(q, { kind: JOB_SEND, orgId, payload: { org: orgId, rule, ev, user, reasons: ["users"] } satisfies SendPayload as unknown as Record<string, unknown>, maxAttempts: 6 });
  return users.length;
}

// ----- housekeeping -------------------------------------------------------------------------------------------------

export const JOB_CLEANUP = "notify.cleanup";
const lastCleanup = new Map<string, number>();

/** Queue the daily clean-up of an organisation at most once a day per process. */
export async function scheduleCleanup(q: Queryable, orgId: string): Promise<void> {
  if (Date.now() - (lastCleanup.get(orgId) ?? 0) < 86_400_000) return;
  lastCleanup.set(orgId, Date.now());
  await enqueue(q, { kind: JOB_CLEANUP, orgId, payload: { org: orgId }, delayMs: 3600_000, dedupeKey: "notify.cleanup" });
}

/** Old log rows and e-mail records go; inbox items are removed (soft, so the Windows app follows) after a while. */
export async function runCleanup(job: Job, jctx: JobContext): Promise<void | { again: number }> {
  const org = String(job.payload.org);
  await jctx.db.query(`delete from sm_notification_log where org_id = $1 and created_at < now() - interval '180 days' and status <> 'held'`, [org]);
  await jctx.db.query(`delete from sm_email_messages where org_id = $1 and created_at < now() - interval '365 days'`, [org]);
  const sys = await sysCtx(jctx.cfg, org);
  const old = await systemRows<{ id: string }>(
    sys,
    "notification",
    `(t.read_at is not null and t.created_at < now() - interval '90 days') or t.created_at < now() - interval '180 days'`,
    [],
    "order by t.created_at limit 200",
  );
  for (const r of old) await sys.write((tx) => removeIn(tx, sys, "notification", r.id));
  if (old.length === 200 && Date.now() < jctx.deadline - 1000) return { again: 1000 };
}

export function registerDeliveryJobs(): void {
  registerJobHandler(JOB_SEND, runSend);
  registerJobHandler(JOB_HOOK, runHook);
  registerJobHandler(JOB_FLUSH, runFlush);
  registerJobHandler(JOB_CLEANUP, runCleanup);
}

export type { RuleSnap, EventSnap };
export const recordLink = recordUrl;
