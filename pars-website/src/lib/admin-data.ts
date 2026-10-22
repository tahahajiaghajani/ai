import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hasSecret, decrypt } from "@/lib/crypto";
import { canEmail } from "@/lib/notify";
import { getSettingsFresh } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";
import { OPEN_STATUSES, STATUSES, type TicketPriority, type TicketStatus } from "@/lib/ticket-meta";
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

// Admin-only reads: each one checks the session itself, so a page that forgets requireAdminPage() still leaks nothing.

export async function health(): Promise<Health> {
  await assertAdmin();
  const c = db();
  let dbState: Health["db"] = "missing";
  if (c) {
    // GET, not HEAD: postgrest-js reports a HEAD request on a missing table as success
    const { error } = await c.from("pars_settings").select("key").limit(1);
    dbState = error ? "no_tables" : "ok";
  }
  // Read-only diagnostic: a settings read error must not take the dashboard down (the DB check above already shows it).
  const s = await getSettingsFresh().catch((e) => {
    console.error("[health]", e);
    return DEFAULT_SETTINGS;
  });
  const hasKey = Boolean(s.ai.apiKeyEnc && decrypt(s.ai.apiKeyEnc));
  return {
    db: dbState,
    ai: !s.ai.enabled ? "disabled" : hasKey ? "settings" : env.geminiKey ? "env" : "missing",
    secret: hasSecret(),
    explicitSecret: Boolean(process.env.APP_SECRET),
    notify: s.notify.channel !== "none" && Boolean(s.notify.chatId && s.notify.botTokenEnc),
    email: await canEmail(),
    siteUrl: env.siteUrl,
  };
}

export interface TicketCounts {
  byStatus: Record<TicketStatus, number>;
  overdue: number;
  week: number;
  avgRating: number | null;
}

export interface ChatCounts {
  today: number;
  week: number;
  unknown: number;
  negative: number;
  sessions: number;
}

const DAY = 86400_000;

function emptyStatus(): Record<TicketStatus, number> {
  return Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
}

const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);

/** Until pars_admin_counts() is installed: exact head counts; sessions and the rating come from the newest 1000 rows. */
async function countWithQueries(c: SupabaseClient): Promise<{ tickets: TicketCounts; chats: ChatCounts }> {
  const now = Date.now();
  const since = new Date(now - 7 * DAY).toISOString();
  const tickets = () => c.from("pars_tickets").select("id", { count: "exact", head: true });
  const chats = () => c.from("pars_chat_logs").select("id", { count: "exact", head: true }).gte("created_at", since);
  const [byStatus, overdue, week, rated, today, chatWeek, unknown, negative, sample] = await Promise.all([
    Promise.all(STATUSES.map((s) => count(tickets().eq("status", s)))),
    count(tickets().in("status", OPEN_STATUSES).is("first_response_at", null).lt("due_at", new Date(now).toISOString())),
    count(tickets().gte("created_at", since)),
    c.from("pars_tickets").select("rating").not("rating", "is", null).order("created_at", { ascending: false }).limit(1000),
    count(chats().gte("created_at", new Date(now - DAY).toISOString())),
    count(chats()),
    count(chats().eq("unknown", true).eq("reviewed", false)),
    count(chats().eq("rating", -1).eq("reviewed", false)),
    c.from("pars_chat_logs").select("session_id").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
  ]);
  const ratings = ((rated.data ?? []) as { rating: number }[]).map((r) => r.rating);
  return {
    tickets: {
      byStatus: Object.fromEntries(STATUSES.map((s, i) => [s, byStatus[i]])) as Record<TicketStatus, number>,
      overdue,
      week,
      avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    },
    chats: { today, week: chatWeek, unknown, negative, sessions: new Set(((sample.data ?? []) as { session_id: string }[]).map((r) => r.session_id)).size },
  };
}

/**
 * Counted in the database (PostgREST returns at most 1000 rows per read): one call to
 * pars_admin_counts() from migration 20261022120000, or head counts while it is missing.
 * Memoised per request, since the panel layout and the dashboard both ask.
 */
const loadCounts = cache(async (): Promise<{ tickets: TicketCounts; chats: ChatCounts } | null> => {
  const c = db();
  if (!c) return null;
  const { data, error } = await c.rpc("pars_admin_counts", { p_open: OPEN_STATUSES });
  if (error || !data) return countWithQueries(c);
  const r = data as { tickets: TicketCounts; chats: ChatCounts };
  return { tickets: { ...r.tickets, byStatus: { ...emptyStatus(), ...r.tickets.byStatus } }, chats: r.chats };
});

export async function ticketCounts(): Promise<TicketCounts> {
  await assertAdmin();
  return (await loadCounts())?.tickets ?? { byStatus: emptyStatus(), overdue: 0, week: 0, avgRating: null };
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

export async function chatCounts(): Promise<ChatCounts> {
  await assertAdmin();
  return (await loadCounts())?.chats ?? { today: 0, week: 0, unknown: 0, negative: 0, sessions: 0 };
}

export async function listTickets(f: { status?: string; priority?: string; q?: string; limit?: number }): Promise<TicketRow[]> {
  await assertAdmin();
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
  await assertAdmin();
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
