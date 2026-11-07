// What the notification settings pages do besides the generic record API: the rule list with the built-ins, a
// preview of a template on a sample record (rendered under the caller's OWN access — an admin never previews what they
// may not read), test messages through a channel, «بررسی صندوق اکنون», and the delivery and e-mail logs (the subject
// of a delivery about a record the caller may not read is not shown).
import { tableDef } from "@shared/tables";
import { NOTIFY_EVENTS, parseTemplate, type NotifyEvent } from "@shared/notify";
import { APP_NAME } from "@shared/constants";
import type { Ctx } from "../../context";
import { bad, forbidden, notFound } from "../../http/errors";
import { access } from "../../access/provider";
import { readableIds } from "../../access";
import { RefSet, condEnv, defFor, get, list, resolveDisplay } from "../../engine";
import { defOf, errText, isUuid, sysCtx } from "./common";
import { BUILTINS, builtinRule, rowRule, type RuleDef } from "./rules";
import { defaultTemplate, renderFor, type EventSnap, type TemplateText } from "./render";
import { emailLayout, markdownToHtml, markdownToText, newMessageId, rememberOutbound, sendMail, emailChannels, type EmailChannelRow } from "./mail";
import { channelRows, sendOutside, sendSms } from "./channels";
import { getState, pollChannel, type PollState } from "./inbound";
import { normalizeMobile } from "@shared/notify";
import { REJECT_REASONS } from "./inbound";
import { SKIP_REASONS, type LogRow } from "./log";

/** The caller may read the notification settings (area «اعلان‌ها»). */
export function needSettings(ctx: Ctx): void {
  if (!access().canReadTable(ctx, defOf("notification_rule"))) throw forbidden("به تنظیمات اعلان‌ها دسترسی ندارید");
}

export interface RuleView extends RuleDef {
  /** a built-in nobody replaced (no row yet) */
  is_builtin: boolean;
  /** the stored row replaces a built-in */
  replaces: string | null;
  version: number | null;
}

/** Built-ins (replaced or not) and the organisation's rules. */
export async function listRules(ctx: Ctx): Promise<{ rules: RuleView[] }> {
  needSettings(ctx);
  const r = await list(ctx, "notification_rule", { size: 500, total: false, fields: ["name", "active", "mandatory", "table_key", "event", "custom_event", "entry_kinds", "condition", "recipients", "notify_actor", "channels", "targets", "template_id", "digest", "builtin", "description"] });
  const rows = r.rows.map((x) => ({ ...rowRule(x), version: Number(x.version) }));
  const out: RuleView[] = [];
  for (const b of BUILTINS) {
    const row = rows.find((x) => x.builtin === b.rule.builtin);
    if (row) out.push({ ...row, is_builtin: false, replaces: b.rule.builtin!, description: row.description ?? b.rule.description ?? null });
    else out.push({ ...builtinRule(b), is_builtin: true, replaces: null, version: null });
  }
  for (const row of rows) if (!row.builtin) out.push({ ...row, is_builtin: false, replaces: null });
  return { rules: out };
}

export interface PreviewInput {
  table: string;
  record_id?: string | null;
  event: NotifyEvent;
  template_id?: string | null;
  subject?: string | null;
  body?: string | null;
  short_text?: string | null;
}

/** Render a template for the caller on a record they may read (the given one, or the latest one of the table). */
export async function preview(ctx: Ctx, x: PreviewInput) {
  needSettings(ctx);
  if (!(x.event in NOTIFY_EVENTS)) throw bad("رویداد معتبر نیست");
  const { def } = await defFor(ctx, x.table);
  if (def.virtual) throw bad("این جدول رکورد ندارد");
  let tpl: TemplateText = defaultTemplate(x.event);
  if (x.subject !== undefined && x.subject !== null) tpl = { subject: x.subject, body: x.body ?? "", short_text: x.short_text ?? null };
  else if (x.template_id && isUuid(x.template_id)) {
    const t = await get(ctx, "notification_template", x.template_id);
    tpl = { subject: String(t.row.subject ?? ""), body: String(t.row.body ?? ""), short_text: (t.row.short_text as string | null) ?? null };
  }
  const problems = [tpl.subject, tpl.body, tpl.short_text].map((s) => parseTemplate(s).error).filter(Boolean);
  let id = x.record_id && isUuid(x.record_id) ? x.record_id : null;
  if (!id) {
    const latest = await list(ctx, def.key, { size: 1, total: false, sort: "-updated_at", fields: [def.display] });
    id = latest.rows[0]?.id ?? null;
  }
  if (!id) return { record: null, problems, subject: null, body: null, html: null, short: null };
  const rec = await get(ctx, def.key, id);
  const sf = def.states?.field;
  const ev: EventSnap = {
    event: x.event,
    kind: "preview",
    table: def.key,
    id,
    number: (rec.row.number as string | null) ?? null,
    actor: ctx.user.id,
    at: new Date().toISOString(),
    from: sf ? String(def.states!.initial) : null,
    to: sf ? ((rec.row[sf] as string | null) ?? null) : null,
    changes: sf && rec.row[sf] !== def.states!.initial ? { [sf]: { from: def.states!.initial, to: rec.row[sf] } } : {},
    entry: null,
    data: { name: "نمونه", decision: "تأیید", label: "رویداد نمونه" },
    custom: x.event === "custom" ? "sample" : null,
  };
  const r = await renderFor(ctx, ev, tpl, { cfg: ctx.cfg, entry: x.event === "commented" || x.event === "mentioned" ? { body: "این یک **پاسخ نمونه** است.", kind: "comment", visibility: "public" } : null });
  if (!r) throw notFound(`${def.label} پیدا نشد`);
  return {
    record: { id, label: r.number ? `${r.number} — ${r.recordTitle}` : r.recordTitle },
    problems,
    subject: r.title,
    body: r.body,
    short: r.short,
    html: emailLayout({ title: r.title, bodyHtml: markdownToHtml(r.body), orgName: ctx.org.name, url: /^https?:/.test(r.url) ? r.url : null, action: `مشاهدهٔ ${r.number ?? r.tableLabel}` }),
  };
}

async function writableChannel(ctx: Ctx, table: "email_channel" | "notification_channel", id: string) {
  if (!isUuid(id)) throw notFound("کانال پیدا نشد");
  const rec = await get(ctx, table, id);
  if (!rec.meta.canWrite) throw forbidden("اجازهٔ آزمودن این کانال را ندارید");
  return rec;
}

/** A test e-mail through a channel to the caller (or an address they give). */
export async function testEmail(ctx: Ctx, id: string, to?: string | null) {
  await writableChannel(ctx, "email_channel", id);
  const [ch] = (await emailChannels(await sysOf(ctx))).filter((c) => c.id === id);
  if (!ch) throw notFound("کانال پیدا نشد");
  const address = (to || ctx.user.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw bad("نشانی ایمیل معتبر نیست");
  const title = `ایمیل آزمایشی ${APP_NAME}`;
  const body = `این ایمیل برای آزمودن کانال «${ch.name}» فرستاده شد.\n\nاگر آن را می‌بینید، ارسال اعلان‌ها با این کانال کار می‌کند.`;
  const messageId = newMessageId(ch.from_address);
  try {
    const sent = await sendMail(ctx.cfg, ctx.org.id, ch, {
      from: { name: ch.from_name || ctx.org.name, address: ch.from_address },
      to: address,
      replyTo: ch.reply_to,
      subject: title,
      text: `${title}\n\n${markdownToText(body)}`,
      html: emailLayout({ title, bodyHtml: markdownToHtml(body), orgName: ctx.org.name, signatureHtml: ch.signature ? markdownToHtml(ch.signature) : null }),
      messageId,
    });
    await rememberOutbound(ctx.db, { org: ctx.org.id, channel: ch.id, messageId, to: address, subject: title, status: "sent" });
    return { ok: true, to: address, message_id: sent.messageId, response: sent.response };
  } catch (e) {
    throw bad(`ارسال نشد: ${errText(e)}`);
  }
}

const sysOf = (ctx: Ctx) => sysCtx(ctx.cfg, ctx.org.id);

/** «بررسی صندوق اکنون»: read the channel's new mail right away. */
export async function checkInbox(ctx: Ctx, id: string) {
  await writableChannel(ctx, "email_channel", id);
  const sys = await sysOf(ctx);
  const ch = (await emailChannels(sys)).find((c) => c.id === id);
  if (!ch) throw notFound("کانال پیدا نشد");
  if (!ch.inbound) throw bad("دریافت ایمیل برای این کانال روشن نیست");
  try {
    return { ok: true, result: await pollChannel(ctx.cfg, sys, ch) };
  } catch (e) {
    throw bad(`صندوق خوانده نشد: ${errText(e)}`);
  }
}

/** The polling state of a channel (last check, last error, what the last poll did). */
export async function inboxStatus(ctx: Ctx, id: string): Promise<PollState & { inbound: boolean }> {
  const rec = await get(ctx, "email_channel", id);
  const s = await getState(ctx.db, ctx.org.id, `imap:${id}`);
  return { last_checked_at: s.last_checked_at ?? null, last_error: s.last_error ?? null, last_result: s.last_result ?? null, inbound: !!rec.row.inbound };
}

/** A test message through a messenger, webhook or SMS channel (SMS: to the caller's mobile or a number). */
export async function testChannel(ctx: Ctx, id: string, to?: string | null) {
  await writableChannel(ctx, "notification_channel", id);
  const sys = await sysOf(ctx);
  const [ch] = await channelRows(sys, [id]);
  if (!ch) throw notFound("کانال پیدا نشد");
  const title = `پیام آزمایشی ${APP_NAME}`;
  const text = `این پیام برای آزمودن کانال «${ch.name}» فرستاده شد.`;
  try {
    if (ch.kind === "sms") {
      const mobile = normalizeMobile(to || ctx.user.mobile);
      if (!mobile) throw bad("شمارهٔ همراه معتبر نیست");
      return { ok: true, response: await sendSms(ctx.cfg, ctx.org.id, ch, { to: mobile, text: `${title}: ${text}` }) };
    }
    return { ok: true, response: await sendOutside(ctx.cfg, ctx.org.id, ch, { title, body: text, short: text, url: "", meta: { event: "test" } }) };
  } catch (e) {
    throw bad(`ارسال نشد: ${errText(e)}`);
  }
}

/** Delivery log, newest first; subjects of records the caller may not read are withheld. */
export async function deliveryLog(ctx: Ctx, q: { status?: string | null; channel?: string | null; limit?: number; before?: string | null }) {
  needSettings(ctx);
  const params: unknown[] = [ctx.org.id];
  const where = ["org_id = $1"];
  if (q.status && ["sent", "failed", "skipped", "held"].includes(q.status)) {
    params.push(q.status);
    where.push(`status = $${params.length}`);
  }
  if (q.channel && ["in_app", "email", "sms", "webhook"].includes(q.channel)) {
    params.push(q.channel);
    where.push(`channel = $${params.length}`);
  }
  if (q.before) {
    params.push(new Date(q.before).toISOString());
    where.push(`created_at < $${params.length}::timestamptz`);
  }
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const rows = await ctx.db.query<LogRow>(
    `select id, created_at, updated_at, rule_key, rule_name, event, table_key, record_id, record_number, channel, recipient_id, target, status, reason, error, provider_id, subject, due_at
     from sm_notification_log where ${where.join(" and ")} order by created_at desc, id desc limit ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit);
  const allowed = await readable(ctx, page.map((r) => ({ table: r.table_key, id: r.record_id })));
  const env = await condEnv(ctx);
  const { schema } = await defFor(ctx, "notification_rule");
  const refs = new RefSet();
  for (const r of page) if (r.recipient_id) refs.add("user", r.recipient_id);
  const display = refs.size ? await resolveDisplay(ctx.db, ctx, env, schema, refs) : {};
  return {
    entries: page.map((r) => {
      const ok = !r.record_id || allowed.has(`${r.table_key}:${r.record_id}`);
      return {
        ...r,
        created_at: new Date(r.created_at).toISOString(),
        subject: ok ? r.subject : null,
        target: ok || r.channel === "webhook" ? r.target : null,
        reason_label: r.reason ? SKIP_REASONS[r.reason] ?? r.reason : null,
        event_label: NOTIFY_EVENTS[r.event as NotifyEvent]?.label ?? r.event,
        table_label: r.table_key ? tableDef(r.table_key)?.label ?? r.table_key : null,
      };
    }),
    display,
    more: rows.length > limit,
  };
}

/** Records the caller may read among `refs` (as "table:id"). */
async function readable(ctx: Ctx, refs: { table: string | null; id: string | null }[]): Promise<Set<string>> {
  const byTable = new Map<string, string[]>();
  for (const r of refs) if (r.table && r.id && tableDef(r.table)) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r.id]);
  const out = new Set<string>();
  for (const [table, ids] of byTable) {
    if (!access().canReadTable(ctx, tableDef(table)!)) continue;
    for (const id of await readableIds(ctx, table, ids)) out.add(`${table}:${id}`);
  }
  return out;
}

/** E-mails sent and received, newest first (subjects of records the caller may not read withheld). */
export async function emailLog(ctx: Ctx, q: { direction?: string | null; status?: string | null; limit?: number; before?: string | null }) {
  needSettings(ctx);
  const params: unknown[] = [ctx.org.id];
  const where = ["org_id = $1"];
  if (q.direction === "in" || q.direction === "out") {
    params.push(q.direction);
    where.push(`direction = $${params.length}`);
  }
  if (q.status) {
    params.push(String(q.status).slice(0, 20));
    where.push(`status = $${params.length}`);
  }
  if (q.before) {
    params.push(new Date(q.before).toISOString());
    where.push(`created_at < $${params.length}::timestamptz`);
  }
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const rows = await ctx.db.query<Record<string, any>>(
    `select id, channel_id, direction, message_id, from_addr, to_addrs, subject, table_key, record_id, status, reason, created_at
     from sm_email_messages where ${where.join(" and ")} order by created_at desc, id desc limit ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit);
  const allowed = await readable(ctx, page.map((r) => ({ table: r.table_key, id: r.record_id })));
  return {
    messages: page.map((r) => {
      const ok = !r.record_id || allowed.has(`${r.table_key}:${r.record_id}`);
      return {
        ...r,
        created_at: new Date(r.created_at).toISOString(),
        subject: ok ? r.subject : null,
        record_id: ok ? r.record_id : null,
        reason_label: r.reason ? REJECT_REASONS[r.reason] ?? r.reason : null,
      };
    }),
    more: rows.length > limit,
  };
}

export type { EmailChannelRow };
