import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { UsersClient, type UserStats } from "./users-client";
import type { Profile } from "@/lib/types";

export const metadata = { title: "کاربران" };

/** Owner only: approve sign-ups, roles, passwords, delete; and what each user is set up with. */
export default async function UsersPage() {
  const me = await requireOwner();
  const [profiles, tasks, conns, projects] = await Promise.all([
    db().from("profiles").select("*").order("created_at", { ascending: false }),
    db().from("tasks").select("requester_id, assignee_id, status"),
    db().from("user_connections").select("user_id, kind, provider"),
    db().from("projects").select("owner_id"),
  ]);
  const stats: Record<string, UserStats> = {};
  const get = (id: string) => (stats[id] ??= { given: 0, assigned: 0, open: 0, ai: [], github: false, projects: 0 });
  for (const t of tasks.data ?? []) {
    const open = !["closed", "cancelled"].includes(t.status as string);
    get(t.requester_id as string).given++;
    const a = get(t.assignee_id as string);
    a.assigned++;
    if (open) a.open++;
  }
  for (const c of conns.data ?? []) {
    const s = get(c.user_id as string);
    if (c.kind === "github") s.github = true;
    else if (!s.ai.includes(c.provider as string)) s.ai.push(c.provider as string);
  }
  for (const p of projects.data ?? []) get(p.owner_id as string).projects++;
  return <UsersClient me={me.id} profiles={(profiles.data ?? []) as Profile[]} stats={stats} />;
}
