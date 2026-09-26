import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { QueueClient } from "./queue-client";
import type { Job, ProviderState, Task } from "@/lib/types";

export const metadata = { title: "صف و اجرا" };

export default async function QueuePage() {
  // Page data loads in parallel with the session check; it is only rendered once the check passes.
  const [, [active, recent, providers, tasks]] = await Promise.all([
    requireAdmin(),
    Promise.all([
      db().from("jobs").select("*").in("status", ["running", "queued"]).order("priority", { ascending: false }).order("created_at"),
      db().from("jobs").select("*").in("status", ["done", "failed", "cancelled"]).order("finished_at", { ascending: false }).limit(40),
      db().from("provider_state").select("*"),
      db().from("tasks").select("id, code, title"),
    ]),
  ]);
  return (
    <QueueClient
      initialJobs={[...((active.data ?? []) as Job[]), ...((recent.data ?? []) as Job[])]}
      providers={(providers.data ?? []) as ProviderState[]}
      tasks={(tasks.data ?? []) as Pick<Task, "id" | "code" | "title">[]}
    />
  );
}
