import "server-only";
import { db, isMissingTable } from "@/lib/db";
import { CODE_COLUMNS, CODES, codeState, revealCode, type CodeRow } from "@/lib/pro";

/** The member's inbox on the site («پیام‌ها»): Pro decisions, codes, order updates. */

/**
 * Stands for the member's Pro code in a stored message. The code itself is never written into the inbox
 * (it also signs in): it is filled in when the member reads the message — their current code while it
 * works, «no longer active» once it was revoked, replaced or has expired.
 */
export const CODE_MARK = "{{pro-code}}";

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
  if (!rows.some((m) => m.body_fa.includes(CODE_MARK) || m.body_en.includes(CODE_MARK))) return rows;
  const code = await currentCode(userId);
  const fill = (body: string, lang: "fa" | "en") =>
    body.split(CODE_MARK).join(code ? (lang === "fa" ? `\u200e${code}` : code) : lang === "fa" ? "(این کد دیگر فعال نیست)" : "(no longer active)");
  return rows.map((m) => ({ ...m, body_fa: fill(m.body_fa, "fa"), body_en: fill(m.body_en, "en") }));
}

/** The member's working code (entered or waiting to be entered), decrypted; "" when there is none. */
async function currentCode(userId: string): Promise<string> {
  const { data, error } = await db()!.from(CODES).select(CODE_COLUMNS).eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const row = data as CodeRow | null;
  if (error || !row) return "";
  const state = codeState(row);
  return state === "active" || state === "issued" ? revealCode(row) : "";
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
