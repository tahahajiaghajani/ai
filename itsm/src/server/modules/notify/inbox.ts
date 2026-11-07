// The person's own side: the in-app inbox (the bell and the notification center) and their preferences. Both are
// personal engine rows (`notification`, `notification_pref`: the row rule lets only their owner read or change them,
// whatever the person's roles); reads start from the engine's `readable` predicate, writes go through the engine with
// the owner checked here — so history-free rows still move `rev` and reach the person's Windows app.
// «همه را خواندم» moves one watermark (`read_before`) instead of touching every row. «بعداً یادآوری کن» (snooze)
// hides an item until a time; it then comes back unread at the top (its `shown_at` is the end of the snooze).
import type { Cond } from "@shared/model/conditions";
import { cleanPrefs, INBOX_KINDS, NOTIFY_EVENTS, type InboxKind, type NotifyPrefs } from "@shared/notify";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { bad } from "../../http/errors";
import { RefSet, condEnv, createIn, readable, resolveDisplay, defFor, updateIn } from "../../engine";
import { defOf, isUuid } from "./common";

export interface InboxItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  table_key: string | null;
  record_id: string | null;
  record_number: string | null;
  event: string | null;
  kind: InboxKind;
  actor_id: string | null;
  created_at: string;
  /** when it (re)appeared: the end of a snooze, else created_at — the list's order and its `before` cursor */
  shown_at: string;
  snoozed_until: string | null;
  read: boolean;
}

interface PrefRow {
  id: string;
  version: number;
  user_id: string;
  optouts: unknown;
  digest: string | null;
  digest_hour: number | null;
  quiet_from: string | null;
  quiet_to: string | null;
  read_before: string | null;
}

/** The caller's preference row (through the read rule: only their own). */
async function myPrefRow(ctx: Ctx): Promise<PrefRow | null> {
  const def = defOf("notification_pref");
  const env = await condEnv(ctx);
  const params: unknown[] = [ctx.user.id];
  const where = readable(ctx, def, "t", params, env);
  return ctx.db.one<PrefRow>(`select t.* from ${def.table} t where t.user_id = $1 and ${where} limit 1`, params);
}

/** When an item (re)appeared: the end of its snooze, else its creation. */
const shownSql = (alias: string) => `greatest(${alias}.created_at, coalesce(${alias}.snoozed_until, ${alias}.created_at))`;
/** Snoozed now (hidden from the list and the count until the time comes). */
const snoozedSql = (alias: string) => `(${alias}.snoozed_until is not null and ${alias}.snoozed_until > now())`;
const unreadSql = (alias: string, watermarkParam: string) =>
  `${alias}.read_at is null and not ${snoozedSql(alias)} and ${shownSql(alias)} > coalesce(${watermarkParam}::timestamptz, '-infinity'::timestamptz)`;

/** Unread inbox items of the caller. */
export async function unreadCount(ctx: Ctx): Promise<number> {
  const def = defOf("notification");
  const pref = await myPrefRow(ctx);
  const env = await condEnv(ctx);
  const params: unknown[] = [ctx.user.id, pref?.read_before ?? null];
  const where = readable(ctx, def, "t", params, env);
  const r = await ctx.db.one<{ n: number }>(`select count(*)::int as n from ${def.table} t where t.user_id = $1 and ${unreadSql("t", "$2")} and ${where}`, params);
  return r?.n ?? 0;
}

export interface InboxQuery {
  kind?: InboxKind | null;
  unread?: boolean;
  /** only the items snoozed now (otherwise they are left out until their time comes) */
  snoozed?: boolean;
  limit?: number;
  /** shown_at of the last item already shown (older ones come next) */
  before?: string | null;
}

export async function listInbox(ctx: Ctx, q: InboxQuery = {}): Promise<{ items: InboxItem[]; unread: number; display: Record<string, string>; more: boolean }> {
  const def = defOf("notification");
  const { schema } = await defFor(ctx, "notification");
  const pref = await myPrefRow(ctx);
  const env = await condEnv(ctx);
  const params: unknown[] = [ctx.user.id, pref?.read_before ?? null];
  const where = [`t.user_id = $1`];
  if (q.kind && q.kind in INBOX_KINDS) {
    params.push(q.kind);
    where.push(`t.kind = $${params.length}`);
  }
  if (q.unread) where.push(unreadSql("t", "$2"));
  where.push(q.snoozed ? snoozedSql("t") : `not ${snoozedSql("t")}`);
  if (q.before) {
    const d = new Date(q.before);
    if (Number.isNaN(d.getTime())) throw bad("زمان معتبر نیست");
    params.push(d.toISOString());
    where.push(`${shownSql("t")} < $${params.length}::timestamptz`);
  }
  where.push(readable(ctx, def, "t", params, env));
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
  const rows = await ctx.db.query<Record<string, any>>(
    `select t.id, t.title, t.body, t.link, t.table_key, t.record_id, t.record_number, t.event, t.kind, t.actor_id, t.created_at, t.read_at,
            t.snoozed_until, ${shownSql("t")} as shown_at, (${unreadSql("t", "$2")}) as unread
     from ${def.table} t where ${where.join(" and ")} order by ${shownSql("t")} desc, t.id desc limit ${limit + 1}`,
    params,
  );
  const more = rows.length > limit;
  const items: InboxItem[] = rows.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    table_key: r.table_key ?? null,
    record_id: r.record_id ?? null,
    record_number: r.record_number ?? null,
    event: r.event ?? null,
    kind: (r.kind in INBOX_KINDS ? r.kind : "direct") as InboxKind,
    actor_id: r.actor_id ?? null,
    created_at: new Date(r.created_at).toISOString(),
    shown_at: new Date(r.shown_at).toISOString(),
    snoozed_until: r.snoozed_until ? new Date(r.snoozed_until).toISOString() : null,
    read: !r.unread,
  }));
  const refs = new RefSet();
  for (const i of items) if (i.actor_id) refs.add("user", i.actor_id);
  const display = refs.size ? await resolveDisplay(ctx.db, ctx, env, schema, refs) : {};
  return { items, unread: await unreadCount(ctx), display, more };
}

/** Mark some of the caller's items read (others' ids are ignored). */
export async function markRead(ctx: Ctx, ids: string[]): Promise<number> {
  const clean = [...new Set(ids.filter(isUuid).map((x) => x.toLowerCase()))].slice(0, 200);
  if (!clean.length) return 0;
  const def = defOf("notification");
  const env = await condEnv(ctx);
  const params: unknown[] = [ctx.user.id, pgArray(clean)];
  const where = readable(ctx, def, "t", params, env);
  const mine = await ctx.db.query<{ id: string }>(`select t.id from ${def.table} t where t.user_id = $1 and t.id = any($2::uuid[]) and t.read_at is null and ${where}`, params);
  if (!mine.length) return 0;
  await ctx.write(
    async (tx) => {
      for (const r of mine) await updateIn(tx, ctx, "notification", r.id, { read_at: new Date().toISOString() }, { trusted: true, skipAccess: true });
    },
    { internal: true },
  );
  return mine.length;
}

/** The longest snooze (a month): longer than that is a reason to turn the notification off. */
export const MAX_SNOOZE_MS = 30 * 24 * 3600_000;

/**
 * «بعداً یادآوری کن»: hide some of the caller's items until `until` (they come back unread at the top); `null`
 * brings the snoozed ones among them back now. Others' ids are ignored. Returns how many items changed.
 */
export async function snooze(ctx: Ctx, ids: string[], until: Date | null): Promise<number> {
  const clean = [...new Set(ids.filter(isUuid).map((x) => x.toLowerCase()))].slice(0, 200);
  if (!clean.length) return 0;
  if (until) {
    if (Number.isNaN(until.getTime())) throw bad("زمان معتبر نیست");
    const ms = until.getTime() - Date.now();
    if (ms < 60_000) throw bad("زمان یادآوری باید در آینده باشد");
    if (ms > MAX_SNOOZE_MS) throw bad("بیش از یک ماه نمی‌توان اعلان را به تعویق انداخت");
  }
  const def = defOf("notification");
  const env = await condEnv(ctx);
  const params: unknown[] = [ctx.user.id, pgArray(clean)];
  const where = readable(ctx, def, "t", params, env);
  const mine = await ctx.db.query<{ id: string }>(
    `select t.id from ${def.table} t where t.user_id = $1 and t.id = any($2::uuid[]) and ${until ? "true" : snoozedSql("t")} and ${where}`,
    params,
  );
  if (!mine.length) return 0;
  // the item comes back unread when the snooze ends («now» ends it at once)
  const data = { snoozed_until: (until ?? new Date()).toISOString(), read_at: null };
  await ctx.write(
    async (tx) => {
      for (const r of mine) await updateIn(tx, ctx, "notification", r.id, data, { trusted: true, skipAccess: true });
    },
    { internal: true },
  );
  return mine.length;
}

/** «همه را خواندم»: everything up to now counts as read (one row changes, however many items there are). */
export async function markAllRead(ctx: Ctx): Promise<void> {
  await savePrefRow(ctx, { read_before: new Date().toISOString() });
}

async function savePrefRow(ctx: Ctx, data: Record<string, unknown>): Promise<PrefRow> {
  const pref = await myPrefRow(ctx);
  await ctx.write(
    async (tx) => {
      if (pref) await updateIn(tx, ctx, "notification_pref", pref.id, data, { trusted: true, skipAccess: true });
      else await createIn(tx, ctx, "notification_pref", { user_id: ctx.user.id, ...data }, { trusted: true, skipAccess: true });
    },
    { internal: true },
  );
  return (await myPrefRow(ctx))!;
}

export async function getPrefs(ctx: Ctx): Promise<NotifyPrefs> {
  return cleanPrefs((await myPrefRow(ctx)) as unknown as Record<string, unknown> | null);
}

/** Save the caller's preferences (validated: known events and channels, HH:MM quiet times, digest hour 0–23). */
export async function savePrefs(ctx: Ctx, input: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
  const current = await getPrefs(ctx);
  const next = cleanPrefs({ ...current, ...input });
  for (const k of next.optouts) {
    const [event] = k.split(":");
    if (event !== "*" && !(event in NOTIFY_EVENTS)) throw bad(`رویداد «${event}» شناخته نیست`);
  }
  if ((input.quiet_from && !next.quiet_from) || (input.quiet_to && !next.quiet_to)) throw bad("ساعت سکوت را به شکل ۲۲:۰۰ وارد کنید");
  if (!!next.quiet_from !== !!next.quiet_to) throw bad("آغاز و پایان ساعت سکوت هر دو لازم است");
  const row = await savePrefRow(ctx, { optouts: next.optouts, digest: next.digest, digest_hour: next.digest_hour, quiet_from: next.quiet_from, quiet_to: next.quiet_to });
  return cleanPrefs(row as unknown as Record<string, unknown>);
}

/** Filter for the caller's unread items (the generic list of `notification` uses it for «خوانده‌نشده»). */
export const UNREAD_FILTER: Cond = { f: "read_at", op: "empty" };
