import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { defaultBranch, repoRef, repoUrl } from "@/lib/github/client";
import { buildOverview, type FileLite, type KnowledgeLite, type ProfileLite, type TaskLite } from "@/lib/graph/model";
import { GraphClient } from "./graph-client";

export const metadata = { title: "گراف دانش" };

export default async function GraphPage(props: PageProps<"/graph">) {
  await requireAdmin();
  const sp = await props.searchParams;
  const focus = typeof sp.task === "string" ? sp.task : null;

  const [tasks, profiles, files, knowledge, graphifyJobs, settings] = await Promise.all([
    db().from("tasks").select("id, code, title, status, root_id, parent_id, relation_type, requester_id, github_path").order("created_at", { ascending: false }).limit(500),
    db().from("profiles").select("id, full_name, email"),
    db().from("task_files").select("id, task_id, name, context, github_path").not("task_id", "is", null).order("created_at", { ascending: false }).limit(1500),
    db().from("knowledge_items").select("id, metadata").or("metadata->>chunk.is.null,metadata->>chunk.eq.0").order("created_at", { ascending: false }).limit(500),
    db().from("jobs").select("task_id").eq("kind", "graphify").eq("status", "done").order("updated_at", { ascending: false }).limit(300),
    getSettings(),
  ]);

  const taskRows = (tasks.data ?? []) as TaskLite[];
  let fileUrl: ((p: string) => string) | undefined;
  if (env.githubToken) {
    try {
      const ref = await repoRef("workspace");
      const branch = await defaultBranch(ref);
      fileUrl = (p) => repoUrl(ref, p, branch);
    } catch {
      fileUrl = undefined;
    }
  }

  const overview = buildOverview({
    tasks: taskRows,
    profiles: (profiles.data ?? []) as ProfileLite[],
    files: (files.data ?? []) as FileLite[],
    knowledge: (knowledge.data ?? []) as KnowledgeLite[],
    fileUrl,
  });

  const rootOf = new Map(taskRows.map((t) => [t.id, t.root_id ?? t.id]));
  const graphifyReady = [...new Set(((graphifyJobs.data ?? []) as { task_id: string | null }[]).map((j) => (j.task_id ? rootOf.get(j.task_id) : undefined)).filter(Boolean) as string[])].slice(0, 15);
  const projects = taskRows.filter((t) => !t.root_id || t.root_id === t.id).map((t) => ({ id: t.id, code: t.code, title: t.title, hasFolder: !!t.github_path }));

  return (
    <GraphClient
      overview={overview}
      projects={projects}
      graphifyReady={graphifyReady}
      focus={focus ? { project: rootOf.get(focus) ?? focus, task: focus } : null}
      graphifyEnabled={settings.graphify.mode !== "off"}
      githubReady={!!env.githubToken}
    />
  );
}
