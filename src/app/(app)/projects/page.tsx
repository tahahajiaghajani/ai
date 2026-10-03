import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { capabilities, dispatchDefaults } from "@/lib/capabilities";
import { ProjectsClient } from "./projects-client";
import type { ProjectSummary } from "@/lib/types";

export const metadata = { title: "پروژه‌ها و دانش" };

export default async function ProjectsPage() {
  const me = await requireFull();
  const [caps, projects, defaults] = await Promise.all([
    capabilities(me),
    db().from("projects").select("id, slug, name, description, status, status_detail, file_count, total_size, updated_at, knowledge_at, graph_at").eq("owner_id", me.id).order("updated_at", { ascending: false }),
    dispatchDefaults(me),
  ]);
  return <ProjectsClient userId={me.id} github={caps.github} projects={(projects.data ?? []) as ProjectSummary[]} defaults={defaults} />;
}
