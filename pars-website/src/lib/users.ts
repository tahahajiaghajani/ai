import "server-only";
import { assertAdmin } from "@/lib/admin-auth";
import { PROFILE_COLUMNS, USERS, type Account } from "@/lib/auth";
import { db } from "@/lib/db";

export type UserRow = Account & { created_at: string; last_sign_in_at: string | null; tickets: number };

const PAGE = 1000; // Supabase returns at most this many rows per request

/** All rows of a query, page by page (up to `max`). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Admin: every account with its ticket count; `null` when the accounts table is missing. Throws on other errors. */
export async function listUsers(): Promise<UserRow[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  let users: Omit<UserRow, "tickets">[];
  try {
    users = await all((a, b) => c.from(USERS).select(`${PROFILE_COLUMNS}, created_at, last_sign_in_at`).order("created_at", { ascending: false }).range(a, b));
  } catch (e) {
    if (["42P01", "PGRST205"].includes((e as { code?: string }).code ?? "")) return null;
    throw e;
  }
  const tickets = await all<{ user_id: string }>((a, b) => c.from("pars_tickets").select("user_id").not("user_id", "is", null).order("created_at").range(a, b)).catch(() => []);
  const count = new Map<string, number>();
  for (const t of tickets) count.set(t.user_id, (count.get(t.user_id) ?? 0) + 1);
  return users.map((u) => ({ ...u, tickets: count.get(u.id) ?? 0 }));
}
