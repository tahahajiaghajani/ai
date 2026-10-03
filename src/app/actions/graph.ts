"use server";
import { headers } from "next/headers";
import { assertFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getUserConfig } from "@/lib/settings";
import { defaultBranch, getFileText, repoUrl, userRepoOrNull } from "@/lib/github/client";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { metaPath } from "@/lib/projects/paths";
import { parseGraphify, projectNodeId, type GraphData } from "@/lib/graph/model";
import { act } from "./_util";

export type GraphifyLoad = { projectId: string; status: "ok" | "missing" | "error"; graph?: GraphData; error?: string };

/** Reads `.taskflow/graph/graph.json` (graphify) of the user's projects. */
export async function loadGraphifyGraphsAction(projectIds: string[]) {
  return act(async (): Promise<GraphifyLoad[]> => {
    const user = await assertFull();
    const ids = [...new Set(projectIds)].slice(0, 20);
    if (!ids.length) return [];
    const repo = await userRepoOrNull(user.id);
    if (!repo) return ids.map((projectId) => ({ projectId, status: "error" as const, error: "GitHub وصل نیست" }));
    const { data } = await db().from("projects").select("id, slug, name, root_path").eq("owner_id", user.id).in("id", ids);
    const branch = await defaultBranch(repo);
    const projects = (data ?? []) as { id: string; slug: string; name: string; root_path: string }[];
    return Promise.all(
      ids.map(async (projectId): Promise<GraphifyLoad> => {
        const p = projects.find((x) => x.id === projectId);
        if (!p) return { projectId, status: "missing" };
        try {
          const text = await getFileText(repo, metaPath(p.slug, "graph/graph.json"), branch);
          if (!text) return { projectId, status: "missing" };
          const graph = parseGraphify(JSON.parse(text), {
            prefix: `g:${p.id}`,
            rootId: projectNodeId(p.id),
            projectId: p.id,
            fileUrl: (path) => repoUrl(repo, `${p.root_path}/${path}`, branch).replace("/tree/", "/blob/"),
          });
          return { projectId, status: "ok", graph };
        } catch (err) {
          return { projectId, status: "error", error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
  });
}

/** Queues a graphify run (in the user's GitHub Actions) for a project. */
export async function buildGraphifyAction(projectId: string) {
  return act(async () => {
    const user = await assertFull();
    const { data: project } = await db().from("projects").select("id").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
    if (!project) throw new Error("پروژه پیدا نشد");
    const cfg = await getUserConfig(user.id);
    if (cfg.graphify.mode === "off") throw new Error("graphify در تنظیمات خاموش است");
    const { data: running } = await db().from("jobs").select("id").eq("project_id", projectId).eq("kind", "graphify").in("status", ["queued", "running"]).limit(1);
    if (running?.length) throw new Error("ساخت گراف این پروژه از قبل در صف است");
    await enqueueJob({ kind: "graphify", owner_id: user.id, project_id: projectId, payload: { project_id: projectId }, priority: 30, created_by: user.id });
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    await kickWorker(host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : undefined);
    return null;
  });
}
