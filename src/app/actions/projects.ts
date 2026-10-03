"use server";
import { headers } from "next/headers";
import { assertActive, assertFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { githubInfo } from "@/lib/connections";
import { commitFiles, defaultBranch, getFileText, repoUrl, userRepo } from "@/lib/github/client";
import { createProject, deleteProjectEverywhere, getProject, indexRow, projectFiles, refreshStats, reindexFromRepo, removeFromIndex, updateProjectInfo, upsertIndex, writeIndexFile } from "@/lib/projects/store";
import { isTextPath, metaPath, safeProjectPath } from "@/lib/projects/paths";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { getUserConfig, stageModel } from "@/lib/settings";
import type { ImportPayload } from "@/lib/queue/handlers/import";
import type { UploadedFile } from "@/lib/tasks/service";
import type { PersonLite, ProjectSummary } from "@/lib/types";
import { act, mutate } from "./_util";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : undefined;
}

async function own(id: string) {
  const user = await assertFull();
  return { user, project: await getProject(id, user.isOwner ? undefined : user.id) };
}

const SUMMARY = "id, slug, name, description, status, status_detail, file_count, total_size, updated_at, knowledge_at, graph_at";

export async function listProjectsAction() {
  return act(async () => {
    const user = await assertFull();
    const { data } = await db().from("projects").select(SUMMARY).eq("owner_id", user.id).order("updated_at", { ascending: false });
    return (data ?? []) as ProjectSummary[];
  });
}

export async function createProjectAction(input: { name: string; slug?: string; description?: string }) {
  return mutate(async () => {
    const user = await assertFull();
    if (!(await githubInfo(user.id))) throw new Error("پروژه‌ها در GitHub شما ذخیره می‌شوند؛ اول GitHub را وصل کنید (تنظیمات ← اتصال‌ها)");
    const p = await createProject(user.id, input);
    return { id: p.id, slug: p.slug };
  });
}

export async function updateProjectAction(id: string, input: { name?: string; description?: string }) {
  return mutate(async () => {
    const { project } = await own(id);
    await updateProjectInfo(project, input);
    return null;
  });
}

export async function deleteProjectAction(id: string, confirmSlug: string) {
  return act(async () => {
    const { project } = await own(id);
    if (confirmSlug.trim() !== project.slug) throw new Error("برای تایید، نام پوشه‌ی پروژه را دقیقاً وارد کنید");
    await deleteProjectEverywhere(project);
    return null;
  });
}

/** The project's files for the browser and the searchable file picker (paths, kinds, summaries). */
export async function projectFilesAction(id: string) {
  return act(async () => {
    const { project } = await own(id);
    const files = await projectFiles(project.id);
    return files.map((f) => ({ path: f.path, size: f.size, kind: f.kind, summary: f.summary, symbols: f.symbols.slice(0, 12) }));
  });
}

export async function readProjectFileAction(id: string, path: string) {
  return act(async () => {
    const { project } = await own(id);
    const rel = safeProjectPath(path, { allowMeta: true });
    if (!rel) throw new Error("مسیر نامعتبر است");
    const repo = await userRepo(project.owner_id);
    const branch = await defaultBranch(repo);
    const url = repoUrl(repo, `${project.root_path}/${rel}`, branch).replace("/tree/", "/blob/");
    if (!isTextPath(rel)) return { text: null as string | null, url, binary: true };
    const text = await getFileText(repo, `${project.root_path}/${rel}`);
    if (text === null) throw new Error("فایل پیدا نشد");
    return { text: text.length > 600_000 ? `${text.slice(0, 600_000)}\n…` : text, url, binary: false };
  });
}

/** Small manual edits from the phone: replaces one whole file (committed as is). */
export async function saveProjectFileAction(id: string, path: string, content: string) {
  return mutate(async () => {
    const { project } = await own(id);
    const rel = safeProjectPath(path, { allowMeta: path.startsWith(".taskflow/KNOWLEDGE.md") || path === ".taskflow/PROJECT.md" });
    if (!rel) throw new Error("مسیر نامعتبر است");
    if (content.length > 2_000_000) throw new Error("فایل بیش از حد بزرگ است");
    const repo = await userRepo(project.owner_id);
    await commitFiles(repo, [{ path: `${project.root_path}/${rel}`, content }], `[TaskFlow] ویرایش دستی ${rel}`);
    if (!rel.startsWith(".taskflow/")) {
      await upsertIndex([indexRow(project.id, rel, content)]);
      await refreshStats(project.id);
      await writeIndexFile(project, repo).catch(() => undefined);
    } else if (rel === ".taskflow/KNOWLEDGE.md") {
      await db().from("projects").update({ knowledge_at: new Date().toISOString() }).eq("id", project.id);
    }
    return null;
  });
}

export async function deleteProjectFilesAction(id: string, paths: string[]) {
  return mutate(async () => {
    const { project } = await own(id);
    const clean = paths.map((p) => safeProjectPath(p)).filter((p): p is string => !!p).slice(0, 500);
    if (!clean.length) return null;
    const repo = await userRepo(project.owner_id);
    await commitFiles(repo, clean.map((p) => ({ path: `${project.root_path}/${p}`, content: null })), `[TaskFlow] حذف ${clean.length} فایل از ${project.name}`);
    await removeFromIndex(project.id, clean);
    await refreshStats(project.id);
    await writeIndexFile(project, repo).catch(() => undefined);
    return null;
  });
}

async function queueImport(projectId: string, ownerId: string, payload: ImportPayload) {
  const { data: running } = await db().from("jobs").select("id").eq("project_id", projectId).eq("kind", "import").in("status", ["queued", "running"]).limit(1);
  if (running?.length) throw new Error("افزودن فایل به این پروژه در حال انجام است؛ کمی صبر کنید");
  await db().from("projects").update({ status: "importing", status_detail: "در صف افزودن فایل‌ها" }).eq("id", projectId);
  await enqueueJob({ kind: "import", owner_id: ownerId, project_id: projectId, payload: payload as unknown as Record<string, unknown>, priority: 55 });
  await kickWorker(await origin());
}

/** Uploaded files (names may carry folders: "src/app.tsx") are committed whole into the project. */
export async function addProjectFilesAction(id: string, files: UploadedFile[], target = "") {
  return mutate(async () => {
    const { user, project } = await own(id);
    if (!files.length) throw new Error("فایلی انتخاب نشده است");
    for (const f of files) if (!f.storage_path.startsWith(`${user.id}/`)) throw new Error("مسیر فایل نامعتبر است");
    await queueImport(project.id, project.owner_id, { source: "upload", target, files: files.map((f) => ({ storage_path: f.storage_path, name: f.name, size: f.size })) });
    return null;
  });
}

export async function importZipAction(id: string, file: UploadedFile, target = "") {
  return mutate(async () => {
    const { user, project } = await own(id);
    if (!file.storage_path.startsWith(`${user.id}/`)) throw new Error("مسیر فایل نامعتبر است");
    await queueImport(project.id, project.owner_id, { source: "zip", target, storage_path: file.storage_path });
    return null;
  });
}

/** Copies another GitHub repository (e.g. a Google AI Studio app saved to GitHub) into the project. */
export async function importGithubAction(id: string, repo: string, opts: { ref?: string; subdir?: string; target?: string } = {}) {
  return mutate(async () => {
    const { project } = await own(id);
    if (!/^(https?:\/\/github\.com\/)?[\w.-]+\/[\w.-]+/.test(repo.trim())) throw new Error("نشانی مخزن را به شکل owner/repo یا لینک GitHub وارد کنید");
    await queueImport(project.id, project.owner_id, { source: "github", repo: repo.trim(), ref: opts.ref?.trim() || undefined, subdir: opts.subdir?.trim() || undefined, target: opts.target ?? "" });
    return null;
  });
}

/** Re-reads the project folder from GitHub (changes made outside the app) and refreshes the summaries. */
export async function reindexProjectAction(id: string, summaries = true) {
  return mutate(async () => {
    const { project } = await own(id);
    const r = await reindexFromRepo(project);
    await writeIndexFile(project).catch(() => undefined);
    const cfg = await getUserConfig(project.owner_id);
    const conn = stageModel(cfg, "knowledge").connectionId;
    if (summaries && conn) {
      await db().from("projects").update({ status: "indexing", status_detail: "ساخت خلاصه‌ی فایل‌ها" }).eq("id", project.id);
      await enqueueJob({ kind: "index", owner_id: project.owner_id, connection_id: conn, project_id: project.id, priority: 40 });
      await kickWorker(await origin());
    }
    return r;
  });
}

export async function buildProjectGraphAction(id: string) {
  return act(async () => {
    const { project } = await own(id);
    const cfg = await getUserConfig(project.owner_id);
    if (cfg.graphify.mode === "off") throw new Error("graphify در تنظیمات خاموش است");
    const { data: running } = await db().from("jobs").select("id").eq("project_id", project.id).eq("kind", "graphify").in("status", ["queued", "running"]).limit(1);
    if (running?.length) throw new Error("ساخت گراف این پروژه از قبل در صف است");
    await enqueueJob({ kind: "graphify", owner_id: project.owner_id, project_id: project.id, payload: { project_id: project.id }, priority: 30 });
    await kickWorker(await origin());
    return null;
  });
}

export async function projectMetaAction(id: string) {
  return act(async () => {
    const { project } = await own(id);
    const repo = await userRepo(project.owner_id);
    const branch = await defaultBranch(repo);
    const [knowledge, graph] = await Promise.all([getFileText(repo, metaPath(project.slug, "KNOWLEDGE.md")).catch(() => null), getFileText(repo, metaPath(project.slug, "graph/graph.json")).catch(() => null)]);
    return { knowledge, hasGraph: !!graph, folderUrl: repoUrl(repo, project.root_path, branch) };
  });
}

// ------------------------------------------------------------------ people
/** Active users for the assignee field (name and picture only). */
export async function peopleAction() {
  return act(async () => {
    await assertActive();
    const { data } = await db().from("profiles").select("id, full_name, avatar_url, org_unit, color").eq("status", "active").order("full_name");
    return (data ?? []) as PersonLite[];
  });
}

