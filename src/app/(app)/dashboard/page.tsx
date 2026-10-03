import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getUserConfig } from "@/lib/settings";
import { dispatchDefaults } from "@/lib/capabilities";
import { DashboardClient } from "./dashboard-client";
import type { ConnectionStateRow, Job, Profile, Task } from "@/lib/types";

export const metadata = { title: "ورکفلو زنده" };

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const me = await requireFull();
  const sp = await props.searchParams;
  // the owner can watch every user's workflow; everyone else sees the tasks assigned to them
  const all = me.isOwner && sp.scope === "all";
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  let tq = db().from("tasks").select("*").or(`status.not.in.(closed,cancelled),closed_at.gte.${since}`);
  let jq = db().from("jobs").select("*").in("status", ["running", "queued"]);
  if (!all) {
    tq = tq.eq("assignee_id", me.id);
    jq = jq.eq("owner_id", me.id);
  }
  const [tasks, jobs, profiles, states, cfg, defaults] = await Promise.all([
    tq.order("created_at", { ascending: false }).limit(500),
    jq.order("created_at"),
    db().from("profiles").select("id, full_name, email, org_unit, avatar_url").eq("status", "active"),
    db().from("connection_state").select("*").eq("user_id", me.id),
    getUserConfig(me.id),
    dispatchDefaults(me),
  ]);

  return (
    <DashboardClient
      userId={me.id}
      isOwner={me.isOwner}
      all={all}
      defaults={defaults}
      data={{
        tasks: (tasks.data ?? []) as Task[],
        jobs: (jobs.data ?? []) as Job[],
        profiles: (profiles.data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "org_unit" | "avatar_url">[],
        states: (states.data ?? []) as ConnectionStateRow[],
        stageConn: { prework: cfg.stages.prework.connectionId, main: cfg.stages.main.engine === "claude_code" ? null : cfg.stages.main.connectionId },
        userId: me.id,
        assignee: all ? null : me.id,
      }}
    />
  );
}
