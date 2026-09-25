import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { InboxClient } from "./inbox-client";
import type { Job, Profile, Task } from "@/lib/types";

export const metadata = { title: "کارتابل" };

export default async function InboxPage() {
  const me = await requireAdmin();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [tasks, profiles, jobs, settings] = await Promise.all([
    db().from("tasks").select("*").or(`status.not.in.(closed,cancelled),closed_at.gte.${since}`).order("created_at", { ascending: false }).limit(600),
    db().from("profiles").select("*"),
    db().from("jobs").select("*").in("status", ["running", "queued"]),
    getSettings(),
  ]);
  return (
    <InboxClient
      userId={me.id}
      initial={(tasks.data ?? []) as Task[]}
      jobs={(jobs.data ?? []) as Job[]}
      profiles={(profiles.data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "org_unit" | "avatar_url">[]}
      defaults={{ prework: settings.prework.defaultPrompt, main: settings.claude.defaultPrompt }}
    />
  );
}
