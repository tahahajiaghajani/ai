import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { DashboardClient } from "./dashboard-client";
import type { Job, Profile, ProviderState, Task } from "@/lib/types";

export const metadata = { title: "ورکفلو زنده" };

export default async function DashboardPage() {
  const me = await requireAdmin();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [tasks, jobs, profiles, providers, settings] = await Promise.all([
    db().from("tasks").select("*").or(`status.not.in.(closed,cancelled),closed_at.gte.${since}`).order("created_at", { ascending: false }).limit(500),
    db().from("jobs").select("*").in("status", ["running", "queued"]).order("created_at"),
    db().from("profiles").select("*"),
    db().from("provider_state").select("*"),
    getSettings(),
  ]);

  return (
    <DashboardClient
      userId={me.id}
      defaults={{ prework: settings.prework.defaultPrompt, main: settings.claude.defaultPrompt }}
      data={{
        tasks: (tasks.data ?? []) as Task[],
        jobs: (jobs.data ?? []) as Job[],
        profiles: (profiles.data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "org_unit" | "avatar_url">[],
        providers: (providers.data ?? []) as ProviderState[],
      }}
    />
  );
}
