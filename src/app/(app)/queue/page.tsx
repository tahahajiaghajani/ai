import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { listConnections, type GithubConfig } from "@/lib/connections";
import { QueueClient, type QueueConnection } from "./queue-client";
import type { ConnectionStateRow, Job, Task } from "@/lib/types";

export const metadata = { title: "صف و اجرا" };

export default async function QueuePage(props: PageProps<"/queue">) {
  const me = await requireFull();
  const sp = await props.searchParams;
  const all = me.isOwner && sp.scope === "all";
  let active = db().from("jobs").select("*").in("status", ["running", "queued"]);
  let recent = db().from("jobs").select("*").in("status", ["done", "failed", "cancelled"]);
  if (!all) {
    active = active.eq("owner_id", me.id);
    recent = recent.eq("owner_id", me.id);
  }
  const [a, r, conns, states, lane] = await Promise.all([
    active.order("priority", { ascending: false }).order("created_at"),
    recent.order("finished_at", { ascending: false }).limit(40),
    listConnections(me.id),
    db().from("connection_state").select("*").eq("user_id", me.id),
    db().from("worker_lanes").select("stats").eq("lane", "system").maybeSingle(),
  ]);
  const jobs = [...((a.data ?? []) as Job[]), ...((r.data ?? []) as Job[])];
  const taskIds = [...new Set(jobs.map((j) => j.task_id).filter(Boolean))] as string[];
  const ownerIds = [...new Set(jobs.map((j) => j.owner_id).filter(Boolean))] as string[];
  const [tasks, owners] = await Promise.all([
    taskIds.length ? db().from("tasks").select("id, code, title").in("id", taskIds) : Promise.resolve({ data: [] }),
    all && ownerIds.length ? db().from("profiles").select("id, full_name").in("id", ownerIds) : Promise.resolve({ data: [] }),
  ]);
  const gh = conns.find((c) => c.kind === "github");
  const connections: QueueConnection[] = conns.filter((c) => c.kind === "ai").map((c) => ({ id: c.id, label: c.label, provider: c.provider, status: c.status }));
  return (
    <QueueClient
      userId={me.id}
      isOwner={me.isOwner}
      all={all}
      initialJobs={jobs}
      connections={connections}
      states={(states.data ?? []) as ConnectionStateRow[]}
      claudeCode={!!(gh?.config as GithubConfig | undefined)?.claudeCode}
      tasks={(tasks.data ?? []) as Pick<Task, "id" | "code" | "title">[]}
      owners={Object.fromEntries(((owners.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]))}
      lastTick={((lane.data?.stats as Record<string, unknown> | undefined)?.last_tick_at as string | undefined) ?? null}
    />
  );
}
