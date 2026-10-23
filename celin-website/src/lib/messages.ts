import "server-only";
import { db, isMissingTable } from "@/lib/db";

/** The member's inbox on the site («پیام‌ها»): Pro decisions, codes, order updates. */

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
  return (data ?? []) as Message[];
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
