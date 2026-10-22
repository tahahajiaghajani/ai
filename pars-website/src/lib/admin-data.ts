import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hasSecret, decrypt } from "@/lib/crypto";
import { canEmail } from "@/lib/notify";
import { getSettingsFresh } from "@/lib/settings";
import { OPEN_STATUSES, type TicketPriority, type TicketStatus } from "@/lib/ticket-meta";
import type { TicketRow } from "@/lib/tickets";

export interface Health {
  db: "missing" | "no_tables" | "ok";
  ai: "settings" | "env" | "missing" | "disabled";
  secret: boolean;
  explicitSecret: boolean;
  notify: boolean;
  email: boolean;
  siteUrl: string;
}

export async function health(): Promise<Health> {
  const c = db();
  let dbState: Health["db"] = "missing";
  if (c) {
    const { error } = await c.from("pars_settings").select("key", { head: true, count: "exact" });
    dbState = error ? "no_tables" : "ok";
  }
  const s = await getSettingsFresh();
  const hasKey = Boolean(s.ai.apiKeyEnc && decrypt(s.ai.apiKeyEnc));
  return {
    db: dbState,
    ai: !s.ai.enabled ? "disabled" : hasKey ? "settings" : env.geminiKey ? "env" : "missing",
    secret: hasSecret(),
    explicitSecret: Boolean(process.env.APP_SECRET),
    notify: s.notify.channel !== "none" && Boolean(s.notify.chatId && s.notify.botTokenEnc),
    email: canEmail(),
    siteUrl: env.siteUrl,
  };
}

export async function ticketCounts(): Promise<{ byStatus: Record<TicketStatus, number>; overdue: number; week: number; avgRating: number | null }> {
  const c = db();
  const byStatus = { new: 0, in_progress: 0, answered: 0, resolved: 0, closed: 0 } as Record<TicketStatus, number>;
  if (!c) return { byStatus, overdue: 0, week: 0, avgRating: null };
  const { data } = await c.from("pars_tickets").select("status, due_at, first_response_at, created_at, rating").order("created_at", { ascending: false }).limit(2000);
  const rows = (data ?? []) as Pick<TicketRow, "status" | "due_at" | "first_response_at" | "created_at" | "rating">[];
  const now = Date.now();
  let overdue = 0;
  let week = 0;
  const ratings: number[] = [];
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (OPEN_STATUSES.includes(r.status) && !r.first_response_at && r.due_at && new Date(r.due_at).getTime() < now) overdue++;
    if (now - new Date(r.created_at).getTime() < 7 * 86400_000) week++;
    if (r.rating) ratings.push(r.rating);
  }
  return { byStatus, overdue, week, avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null };
}

export interface ChatRow {
  id: string;
  session_id: string;
  lang: string;
  question: string;
  answer: string;
  unknown: boolean;
  rating: number | null;
  reviewed: boolean;
  model: string;
  created_at: string;
}

export async function chatCounts(): Promise<{ today: number; week: number; unknown: number; negative: number; sessions: number }> {
  const c = db();
  if (!c) return { today: 0, week: 0, unknown: 0, negative: 0, sessions: 0 };
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await c.from("pars_chat_logs").select("session_id, unknown, rating, reviewed, created_at").gte("created_at", since).limit(5000);
  const rows = (data ?? []) as Pick<ChatRow, "session_id" | "unknown" | "rating" | "reviewed" | "created_at">[];
  const dayStart = Date.now() - 86400_000;
  return {
    today: rows.filter((r) => new Date(r.created_at).getTime() > dayStart).length,
    week: rows.length,
    unknown: rows.filter((r) => r.unknown && !r.reviewed).length,
    negative: rows.filter((r) => r.rating === -1 && !r.reviewed).length,
    sessions: new Set(rows.map((r) => r.session_id)).size,
  };
}

export async function listTickets(f: { status?: string; priority?: string; q?: string; limit?: number }): Promise<TicketRow[]> {
  const c = db();
  if (!c) return [];
  let q = c.from("pars_tickets").select("*").order("updated_at", { ascending: false }).limit(f.limit ?? 200);
  if (f.status === "open") q = q.in("status", OPEN_STATUSES);
  else if (f.status && f.status !== "all") q = q.eq("status", f.status);
  if (f.priority && f.priority !== "all") q = q.eq("priority", f.priority as TicketPriority);
  if (f.q) {
    const term = f.q.replace(/[%,()]/g, " ").trim();
    if (term) q = q.or(`code.ilike.%${term}%,subject.ilike.%${term}%,email.ilike.%${term}%,name.ilike.%${term}%,organization.ilike.%${term}%`);
  }
  const { data } = await q;
  return (data ?? []) as TicketRow[];
}

export async function listChats(filter: string, limit = 150): Promise<ChatRow[]> {
  const c = db();
  if (!c) return [];
  let q = c.from("pars_chat_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (filter === "unknown") q = q.eq("unknown", true).eq("reviewed", false);
  else if (filter === "negative") q = q.eq("rating", -1);
  else if (filter === "positive") q = q.eq("rating", 1);
  else if (filter === "unreviewed") q = q.eq("reviewed", false);
  const { data } = await q;
  return (data ?? []) as ChatRow[];
}
