import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { dispatchDefaults } from "@/lib/capabilities";
import { InboxClient } from "./inbox-client";
import type { Job, Profile, Task } from "@/lib/types";

export const metadata = { title: "کارتابل من" };

/** Tasks assigned to me: accept, return, send to pre-work / main work, close. */
export default async function InboxPage() {
  const me = await requireFull();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [tasks, profiles, jobs, defaults] = await Promise.all([
    db().from("tasks").select("*").eq("assignee_id", me.id).or(`status.not.in.(closed,cancelled),closed_at.gte.${since}`).order("created_at", { ascending: false }).limit(600),
    db().from("profiles").select("id, full_name, email, org_unit, avatar_url"),
    db().from("jobs").select("*").eq("owner_id", me.id).in("status", ["running", "queued"]),
    dispatchDefaults(me),
  ]);
  return (
    <InboxClient
      userId={me.id}
      initial={(tasks.data ?? []) as Task[]}
      jobs={(jobs.data ?? []) as Job[]}
      profiles={(profiles.data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "org_unit" | "avatar_url">[]}
      defaults={defaults}
    />
  );
}
