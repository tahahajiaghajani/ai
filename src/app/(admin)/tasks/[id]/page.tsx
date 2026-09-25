import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getSettings, dispatchDefaults } from "@/lib/settings";
import { getFileText, repoRef, repoUrl, defaultBranch } from "@/lib/github/client";
import { env } from "@/lib/env";
import { TaskDetailClient } from "./task-detail-client";
import type { Job, Profile, Task, TaskEvent, TaskFile } from "@/lib/types";
import type { Manifest } from "@/lib/github/workspace";

export const metadata = { title: "جزئیات تسک" };

export default async function TaskPage(props: PageProps<"/tasks/[id]">) {
  const me = await requireAdmin();
  const { id } = await props.params;
  const { data: task } = await db().from("tasks").select("*").eq("id", id).maybeSingle<Task>();
  if (!task) notFound();
  const rootId = task.root_id ?? task.id;

  const [family, requester, events, jobs, files, feedback, settings] = await Promise.all([
    db().from("tasks").select("*").or(`id.eq.${rootId},root_id.eq.${rootId}`).order("seq_in_root"),
    db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>(),
    db().from("task_events").select("*").eq("task_id", id).order("id", { ascending: false }).limit(400),
    db().from("jobs").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    db().from("task_files").select("*").eq("task_id", id).order("created_at"),
    db().from("feedback").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    getSettings(),
  ]);

  let manifest: Manifest | null = null;
  let github: { folder: string; repo: string } | null = null;
  if (task.github_path && env.githubToken) {
    try {
      const ref = await repoRef("workspace");
      const branch = await defaultBranch(ref);
      const text = await getFileText(ref, `${task.github_path}/manifest.json`);
      manifest = text ? (JSON.parse(text) as Manifest) : null;
      github = { folder: repoUrl(ref, task.github_path, branch), repo: repoUrl(ref) };
    } catch {
      manifest = null;
    }
  }

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
      manifest={manifest}
      github={github}
      defaults={dispatchDefaults(settings)}
    />
  );
}
