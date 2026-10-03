import { notFound } from "next/navigation";
import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { dispatchDefaults } from "@/lib/capabilities";
import { getProject, projectFiles } from "@/lib/projects/store";
import { ProjectDetailClient, type ProjectFileRow } from "./project-client";
import type { Job, Task } from "@/lib/types";

export const metadata = { title: "پروژه" };

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const me = await requireFull();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const project = await getProject(id, me.isOwner ? undefined : me.id).catch(() => null);
  if (!project) notFound();
  const [files, tasks, jobs, defaults] = await Promise.all([
    projectFiles(project.id),
    db().from("tasks").select("id, code, title, status, updated_at, assignee_id").eq("project_id", project.id).order("updated_at", { ascending: false }).limit(100),
    db().from("jobs").select("id, kind, status, error, created_at, finished_at, state").eq("project_id", project.id).in("kind", ["import", "index", "knowledge", "graphify"]).order("created_at", { ascending: false }).limit(12),
    dispatchDefaults(me),
  ]);
  const rows: ProjectFileRow[] = files.map((f) => ({ path: f.path, size: f.size, kind: f.kind, summary: f.summary, symbols: f.symbols.slice(0, 12) }));
  return (
    <ProjectDetailClient
      userId={me.id}
      project={{
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        status: project.status,
        status_detail: project.status_detail,
        file_count: project.file_count,
        total_size: project.total_size,
        knowledge_at: project.knowledge_at,
        graph_at: project.graph_at,
        updated_at: project.updated_at,
      }}
      files={rows}
      tasks={(tasks.data ?? []) as Pick<Task, "id" | "code" | "title" | "status" | "updated_at" | "assignee_id">[]}
      jobs={(jobs.data ?? []) as Pick<Job, "id" | "kind" | "status" | "error" | "created_at" | "finished_at" | "state">[]}
      defaults={defaults}
      initialFile={typeof sp.file === "string" ? sp.file : null}
      initialTab={sp.add ? "add" : typeof sp.tab === "string" ? sp.tab : null}
    />
  );
}
