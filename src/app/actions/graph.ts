"use server";
import { headers } from "next/headers";
import { assertAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { defaultBranch, getFileText, repoRef, repoUrl } from "@/lib/github/client";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { parseGraphify, taskNodeId, type GraphData } from "@/lib/graph/model";
import { act } from "./_util";
import type { Task } from "@/lib/types";

export type GraphifyLoad = { taskId: string; status: "ok" | "missing" | "error"; graph?: GraphData; error?: string };

/** Reads `graphify-out/graph.json` of each project folder in the workspace repo. */
export async function loadGraphifyGraphsAction(taskIds: string[]) {
  return act(async (): Promise<GraphifyLoad[]> => {
    await assertAdmin();
    const ids = [...new Set(taskIds)].slice(0, 20);
    if (!ids.length) return [];
    if (!env.githubToken) return ids.map((taskId) => ({ taskId, status: "error" as const, error: "GitHub متصل نیست" }));
    const { data } = await db().from("tasks").select("id, code, github_path").in("id", ids);
    const ref = await repoRef("workspace");
    const branch = await defaultBranch(ref);
    const tasks = (data ?? []) as Pick<Task, "id" | "code" | "github_path">[];
    return Promise.all(
      ids.map(async (taskId): Promise<GraphifyLoad> => {
        const t = tasks.find((x) => x.id === taskId);
        if (!t?.github_path) return { taskId, status: "missing" };
        try {
          const text = await getFileText(ref, `${t.github_path}/graphify-out/graph.json`, branch);
          if (!text) return { taskId, status: "missing" };
          const graph = parseGraphify(JSON.parse(text), {
            prefix: `g:${t.id}`,
            rootId: taskNodeId(t.id),
            taskId: t.id,
            taskCode: t.code,
            fileUrl: (p) => repoUrl(ref, `${t.github_path}/${p}`, branch),
          });
          return { taskId, status: "ok", graph };
        } catch (err) {
          return { taskId, status: "error", error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
  });
}

/** Queues a graphify run (GitHub Actions) for a project's folder. */
export async function buildGraphifyAction(taskId: string) {
  return act(async () => {
    const admin = await assertAdmin();
    const { data: task } = await db().from("tasks").select("id, root_id, github_path").eq("id", taskId).maybeSingle<Pick<Task, "id" | "root_id" | "github_path">>();
    if (!task) throw new Error("تسک پیدا نشد");
    if (!task.github_path) throw new Error("این پروژه هنوز پوشه‌ای در GitHub ندارد؛ graphify بعد از اولین پیش‌کار قابل اجراست");
    if (!env.githubToken) throw new Error("GitHub متصل نیست");
    const settings = await getSettings();
    if (settings.graphify.mode === "off") throw new Error("graphify در تنظیمات خاموش است");
    const { data: running } = await db().from("jobs").select("id").eq("task_id", task.id).eq("kind", "graphify").in("status", ["queued", "running"]).limit(1);
    if (running?.length) throw new Error("ساخت گراف این پروژه از قبل در صف است");
    await enqueueJob({ kind: "graphify", task_id: task.id, payload: { path: task.github_path }, priority: 30, created_by: admin.id });
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    await kickWorker(host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : undefined);
    return null;
  });
}
