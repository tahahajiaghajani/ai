import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { UsersClient } from "./users-client";
import type { Profile } from "@/lib/types";

export const metadata = { title: "کاربران" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const [profiles, tasks] = await Promise.all([
    db().from("profiles").select("*").order("created_at", { ascending: false }),
    db().from("tasks").select("requester_id, status"),
  ]);
  const stats = new Map<string, { total: number; open: number }>();
  for (const t of tasks.data ?? []) {
    const s = stats.get(t.requester_id as string) ?? { total: 0, open: 0 };
    s.total++;
    if (!["closed", "cancelled"].includes(t.status as string)) s.open++;
    stats.set(t.requester_id as string, s);
  }
  return <UsersClient me={me.id} profiles={(profiles.data ?? []) as Profile[]} stats={Object.fromEntries(stats)} />;
}
