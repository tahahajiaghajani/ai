import { notFound, redirect } from "next/navigation";
import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { peopleById } from "@/lib/people";
import { dispatchDefaults } from "@/lib/capabilities";
import { TaskDetailClient } from "./task-detail-client";
import type { Job, Task, TaskEvent, TaskFile } from "@/lib/types";

export const metadata = { title: "جزئیات تسک" };

export default async function TaskPage(props: PageProps<"/tasks/[id]">) {
  const { id } = await props.params;
  const [me, { data: task }] = await Promise.all([requireFull(), db().from("tasks").select("*").eq("id", id).maybeSingle<Task>()]);
  if (!task) notFound();
  // the assignee works on the task here; the person who gave it follows it in the simple view
  if (task.assignee_id !== me.id) {
    if (task.requester_id === me.id) redirect(`/portal/tasks/${id}`);
    if (!me.isOwner) notFound();
  }
  const rootId = task.root_id ?? task.id;

  const [family, people, events, jobs, files, feedback, project, defaults] = await Promise.all([
    db().from("tasks").select("*").or(`id.eq.${rootId},root_id.eq.${rootId}`).order("seq_in_root"),
    peopleById([task.requester_id, task.assignee_id]),
    db().from("task_events").select("*").eq("task_id", id).order("id", { ascending: false }).limit(400),
    db().from("jobs").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    db().from("task_files").select("*").eq("task_id", id).order("created_at"),
    db().from("feedback").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    task.project_id ? db().from("projects").select("id, name, slug").eq("id", task.project_id).maybeSingle<{ id: string; name: string; slug: string }>() : Promise.resolve({ data: null }),
    dispatchDefaults(me),
  ]);

  return (
    <TaskDetailClient
      userId={me.id}
      task={task}
      family={(family.data ?? []) as Task[]}
      requester={people.get(task.requester_id) ?? null}
      assignee={people.get(task.assignee_id) ?? null}
      project={project.data ?? null}
      events={((events.data ?? []) as TaskEvent[]).reverse()}
      jobs={(jobs.data ?? []) as Job[]}
      files={(files.data ?? []) as TaskFile[]}
      feedback={(feedback.data ?? []) as { agent: string; rating: number; comment: string | null; created_at: string }[]}
      defaults={defaults}
    />
  );
}
