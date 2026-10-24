import "server-only";
import { db, isMissingTable } from "@/lib/db";
import { formatDate, type Lang } from "@/lib/format";
import { CODE_COLUMNS, CODES, codeState, revealCode, type CodeRow } from "@/lib/pro";
import { getSettings } from "@/lib/settings";

/** The member's inbox on the site («پیام‌ها»): Pro decisions, codes, order updates. */

/**
 * Stands for one Pro code in a stored message: `{{pro-code:<id of that code>}}`. The code itself is never
 * written into the inbox (it also signs in): it is filled in when the member reads the message — only that
 * very code, only while it works (entered or waiting to be entered), and only while «نمایش کد در پیام‌های
 * حساب عضو» is on. A newer code never appears in an older message.
 */
export const codeMark = (codeId: string) => `{{pro-code:${codeId}}}`;
/** The placeholder of messages written before codes were named (see codeForLegacyMark). */
export const CODE_MARK = "{{pro-code}}";
const MARK_RE = /\{\{pro-code(?::([0-9a-f-]{36}))?\}\}/gi;
/**
 * Stands for the «اعتبار تا …» line of one code: `{{pro-until:<id>}}`, written right after the text it follows.
 * It is drawn from the code row when the member reads the message (a renewal, revoke or new expiry changes it),
 * and disappears while that code does not work or never expires.
 */
export const untilMark = (codeId: string) => `{{pro-until:${codeId}}}`;
const UNTIL_RE = /\{\{pro-until:([0-9a-f-]{36})\}\}/gi;
/** The validity line that messages written before untilMark stored as text (always their last line). */
const STORED_UNTIL: Record<Lang, RegExp> = { fa: /\nاعتبار تا [^\n]*$/, en: /\nValid until [^\n]*$/ };
const UNTIL = { fa: (d: string) => `اعتبار تا ${d}`, en: (d: string) => `Valid until ${d}` };

export interface Message {
  id: string;
  kind: "info" | "pro" | "order";
  title_fa: string;
  title_en: string;
  body_fa: string;
  body_en: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

export type NewMessage = Omit<Message, "id" | "read_at" | "created_at">;

const COLUMNS = "id, kind, title_fa, title_en, body_fa, body_en, link, read_at, created_at";

/** Writes a message; failures are logged, never thrown (the inbox is a courtesy, not the record). */
export async function postMessage(userId: string, m: NewMessage): Promise<void> {
  const c = db();
  if (!c) return;
  const { error } = await c.from("celin_messages").insert({ user_id: userId, ...m });
  if (error) console.error("[messages] insert", error.message);
}

export async function listMessages(userId: string, limit = 100): Promise<Message[]> {
  const c = db();
  if (!c) return [];
  const { data, error } = await c.from("celin_messages").select(COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (!isMissingTable(error)) console.error("[messages] list", error.message);
    return [];
  }
  const rows = (data ?? []) as Message[];
  if (!rows.some((m) => hasMark(m.body_fa) || hasMark(m.body_en))) return rows;
  const fill = await codeFiller(userId);
  return rows.map((m) => ({ ...m, body_fa: fill(m.body_fa, "fa", m.created_at), body_en: fill(m.body_en, "en", m.created_at) }));
}

const hasMark = (body: string) => body.includes("{{pro-code") || body.includes("{{pro-until");

const NOT_ACTIVE = { fa: "(این کد دیگر فعال نیست)", en: "(no longer active)" };
const NOT_SHOWN = { fa: "(کد در پیام‌ها نمایش داده نمی‌شود؛ از پیامک یا تماس فروشگاه به شما می‌رسد)", en: "(not shown in messages — it reaches you by text message or a call from the store)" };

/**
 * A placeholder written before codes were named ({{pro-code}}): the code issued for that message — the newest one
 * created at most a second after it (the code is stored a moment before its message) — never simply the newest.
 */
export function codeForLegacyMark<T extends Pick<CodeRow, "created_at">>(codes: T[], messageAt: string): T | null {
  const limit = Date.parse(messageAt) + 1000;
  let best: T | null = null;
  for (const c of codes) {
    const at = Date.parse(c.created_at);
    if (at <= limit && (!best || at > Date.parse(best.created_at))) best = c;
  }
  return best;
}

/** The validity line of a code as it stands now: "\n…" while the code works and has an expiry, "" otherwise. */
export function untilLine(row: Pick<CodeRow, "user_id" | "expires_at" | "redeemed_at" | "revoked_at"> | null | undefined, userId: string, lang: Lang, now = Date.now()): string {
  if (!row || row.user_id !== userId || !row.expires_at) return "";
  const state = codeState(row, now);
  return state === "active" || state === "issued" ? `\n${UNTIL[lang](formatDate(row.expires_at, lang))}` : "";
}

/** Replaces the code placeholders of one member's messages (see codeMark, untilMark). */
async function codeFiller(userId: string): Promise<(body: string, lang: Lang, messageAt: string) => string> {
  const show = (await getSettings()).pro.codeInInbox;
  // the validity line is drawn from the code row even while codes are not shown (the code itself is never decrypted then)
  const { data, error } = await db()!.from(CODES).select(CODE_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  if (error) console.error("[messages] codes", error.message);
  const codes = (data ?? []) as CodeRow[];
  const byId = new Map(codes.map((c) => [c.id.toLowerCase(), c]));
  return (body, lang, messageAt) => {
    const marked: (CodeRow | null)[] = [];
    let out = body.replace(MARK_RE, (_, id: string | undefined) => {
      const row = (id ? byId.get(id.toLowerCase()) : codeForLegacyMark(codes, messageAt)) ?? null;
      marked.push(row);
      if (!show) return NOT_SHOWN[lang];
      const state = row ? codeState(row) : null;
      const code = row && row.user_id === userId && (state === "active" || state === "issued") ? revealCode(row) : "";
      if (!code) return NOT_ACTIVE[lang];
      // inside Persian text the digit groups would be laid out right-to-left; a leading LRM keeps their order
      return lang === "fa" ? `\u200e${code}` : code;
    });
    // a message stored with the date as text: that line follows the code row now too (renewed, revoked, extended)
    if (marked.length && !out.includes("{{pro-until:")) out = out.replace(STORED_UNTIL[lang], () => untilLine(marked[marked.length - 1], userId, lang));
    return out.replace(UNTIL_RE, (_, id: string) => untilLine(byId.get(id.toLowerCase()), userId, lang));
  };
}

export async function unreadCount(userId: string): Promise<number> {
  const c = db();
  if (!c) return 0;
  const { count, error } = await c.from("celin_messages").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
  return error ? 0 : count ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  const c = db();
  if (!c) return;
  const { error } = await c.from("celin_messages").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
  if (error) console.error("[messages] mark read", error.message);
}
