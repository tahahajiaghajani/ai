import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getSettings, dispatchDefaults } from "@/lib/settings";
import { workflowChoices } from "@/lib/workflow/registry";
import { TaskDetailClient } from "./task-detail-client";
import type { Job, Profile, Task, TaskEvent, TaskFile } from "@/lib/types";

export const metadata = { title: "جزئیات تسک" };

export default async function TaskPage(props: PageProps<"/tasks/[id]">) {
  const { id } = await props.params;
  const [me, { data: task }] = await Promise.all([requireAdmin(), db().from("tasks").select("*").eq("id", id).maybeSingle<Task>()]);
  if (!task) notFound();
  const rootId = task.root_id ?? task.id;

  const [family, requester, events, jobs, files, feedback, settings, workflows] = await Promise.all([
    db().from("tasks").select("*").or(`id.eq.${rootId},root_id.eq.${rootId}`).order("seq_in_root"),
    db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>(),
    db().from("task_events").select("*").eq("task_id", id).order("id", { ascending: false }).limit(400),
    db().from("jobs").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    db().from("task_files").select("*").eq("task_id", id).order("created_at"),
    db().from("feedback").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    getSettings(),
    workflowChoices(),
  ]);

  // The GitHub folder link and manifest (several GitHub API calls) load in the browser afterwards.

  return (
    <TaskDetailClient
      userId={me.id}
      task={task}
      family={(family.data ?? []) as Task[]}
      requester={requester.data ?? null}
      events={((events.data ?? []) as TaskEvent[]).reverse()}
      jobs={(jobs.data ?? []) as Job[]}
      files={(files.data ?? []) as TaskFile[]}
      feedback={(feedback.data ?? []) as { agent: string; rating: number; comment: string | null; created_at: string }[]}
      defaults={{ ...dispatchDefaults(settings), workflows }}
    />
  );
}
