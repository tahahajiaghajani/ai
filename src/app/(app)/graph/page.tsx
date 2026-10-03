import Link from "next/link";
import { Network } from "lucide-react";
import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getUserConfig } from "@/lib/settings";
import { capabilities } from "@/lib/capabilities";
import { defaultBranch, userRepoOrNull } from "@/lib/github/client";
import { resolveImport } from "@/lib/projects/symbols";
import { buildProjectsOverview, type ProjectFileLite, type ProjectLite, type TaskLite } from "@/lib/graph/model";
import { Button, Card, EmptyState } from "@/components/ui/primitives";
import { GraphClient } from "./graph-client";

export const metadata = { title: "گراف دانش" };

export default async function GraphPage(props: PageProps<"/graph">) {
  const me = await requireFull();
  const sp = await props.searchParams;
  const caps = await capabilities(me);
  if (!caps.github) {
    return (
      <Card>
        <EmptyState
          icon={<Network className="size-7" />}
          title="گراف دانش به GitHub نیاز دارد"
          description="پروژه‌ها و گراف آن‌ها در مخزن GitHub خودتان نگه داشته می‌شوند. ابتدا GitHub را در تنظیمات وصل کنید."
          action={
            <Link href="/settings">
              <Button>تنظیمات و اتصال‌ها</Button>
            </Link>
          }
        />
      </Card>
    );
  }
  const [projects, cfg, repo] = await Promise.all([
    db().from("projects").select("id, name, slug, root_path, graph_at").eq("owner_id", me.id).order("updated_at", { ascending: false }),
    getUserConfig(me.id),
    userRepoOrNull(me.id),
  ]);
  const list = (projects.data ?? []) as (ProjectLite & { graph_at: string | null })[];
  const ids = list.map((p) => p.id);
  const [files, tasks, branch] = await Promise.all([
    ids.length ? db().from("project_files").select("project_id, path, kind, summary, symbols, imports").in("project_id", ids).order("path").limit(6000) : Promise.resolve({ data: [] }),
    ids.length ? db().from("tasks").select("id, code, title, status, project_id").in("project_id", ids).eq("assignee_id", me.id).order("created_at", { ascending: false }).limit(400) : Promise.resolve({ data: [] }),
    repo ? defaultBranch(repo).catch(() => "main") : Promise.resolve("main"),
  ]);

  const overview = buildProjectsOverview({
    projects: list,
    files: (files.data ?? []) as ProjectFileLite[],
    tasks: (tasks.data ?? []) as TaskLite[],
    resolve: resolveImport,
    fileUrl: repo ? (p, path) => `https://github.com/${repo.owner}/${repo.repo}/blob/${branch}/${`${p.root_path}/${path}`.split("/").map(encodeURIComponent).join("/")}` : undefined,
  });

  const focusProject = typeof sp.project === "string" && ids.includes(sp.project) ? sp.project : null;
  const focusTask = typeof sp.task === "string" ? ((tasks.data ?? []) as TaskLite[]).find((t) => t.id === sp.task) : undefined;
  const focus = focusTask?.project_id ? { project: focusTask.project_id, task: focusTask.id } : focusProject ? { project: focusProject, task: null } : null;

  return (
    <GraphClient
      overview={overview}
      projects={list.map((p) => ({ id: p.id, name: p.name, slug: p.slug, graphAt: p.graph_at }))}
      graphifyReady={list.filter((p) => p.graph_at).map((p) => p.id).slice(0, 15)}
      focus={focus}
      graphifyEnabled={cfg.graphify.mode !== "off"}
      githubReady={caps.github}
    />
  );
}
