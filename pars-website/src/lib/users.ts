import "server-only";
import { assertAdmin } from "@/lib/admin-auth";
import { PROFILE_COLUMNS, type Account } from "@/lib/auth";
import { db } from "@/lib/db";

export type UserRow = Account & { created_at: string; last_sign_in_at: string | null; tickets: number };

/** Admin: every account with its ticket count; `null` when the accounts table is missing. Throws on other errors. */
export async function listUsers(): Promise<UserRow[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  const [users, tickets] = await Promise.all([
    c.from("pars_profiles").select(`${PROFILE_COLUMNS}, created_at, last_sign_in_at`).order("created_at", { ascending: false }).limit(1000),
    c.from("pars_tickets").select("user_id").not("user_id", "is", null).limit(10000),
  ]);
  if (users.error) {
    if (["42P01", "PGRST205"].includes(users.error.code ?? "")) return null;
    throw new Error(users.error.message);
  }
  const count = new Map<string, number>();
  for (const t of (tickets.data as { user_id: string }[] | null) ?? []) count.set(t.user_id, (count.get(t.user_id) ?? 0) + 1);
  return ((users.data as Omit<UserRow, "tickets">[]) ?? []).map((u) => ({ ...u, tickets: count.get(u.id) ?? 0 }));
}
