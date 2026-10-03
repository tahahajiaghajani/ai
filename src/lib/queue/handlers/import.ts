import "server-only";
import { unzipSync } from "fflate";
import { db } from "@/lib/supabase/admin";
import { downloadStorage } from "@/lib/ai/files";
import { commitFiles, octokitFor, userRepo, type CommitFile } from "@/lib/github/client";
import { githubConnection } from "@/lib/connections";
import { getProject, indexRow, refreshStats, upsertIndex, writeIndexFile, type Project } from "@/lib/projects/store";
import { isTextPath, MAX_PROJECT_FILE, safeProjectPath, skipOnImport } from "@/lib/projects/paths";
import { enqueueJob } from "@/lib/queue/jobs";
import { getUserConfig, stageModel } from "@/lib/settings";
import { logEvent, notify } from "@/lib/events";
import { formatBytes } from "@/lib/utils";
import type { JobRun, StepResult } from "@/lib/queue/run";

const MAX_FILES = 3000;
const MAX_TOTAL = 150 * 1024 * 1024;
/** One commit carries at most this much (GitHub accepts more, but a tick has a time budget). */
const COMMIT_BYTES = 6 * 1024 * 1024;

export interface ImportPayload {
  source: "upload" | "zip" | "github";
  /** folder inside the project the files go to ("" = project root) */
  target?: string;
  files?: { storage_path: string; name: string; size?: number | null }[];
  storage_path?: string;
  repo?: string;
  ref?: string;
  subdir?: string;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function asContent(path: string, bytes: Uint8Array): string | Uint8Array {
  if (!isTextPath(path)) return bytes;
  try {
    return utf8.decode(bytes);
  } catch {
    return bytes;
  }
}

/** Removes a single top-level folder that wraps everything (zips and GitHub archives have one). */
function stripCommonRoot(paths: string[]): string {
  const first = paths[0]?.split("/")[0];
  if (!first || paths.some((p) => !p.startsWith(`${first}/`))) return "";
  return `${first}/`;
}

async function archiveEntries(run: JobRun, p: ImportPayload): Promise<{ path: string; bytes: Uint8Array }[]> {
  let zip: Uint8Array;
  if (p.source === "zip") {
    zip = new Uint8Array(await (await downloadStorage(p.storage_path!)).arrayBuffer());
  } else {
    // a repository the user can read: their own token, or anonymously for public repositories
    const m = String(p.repo ?? "").match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/);
    if (!m) throw new Error("نشانی مخزن GitHub نامعتبر است (مثلاً owner/repo)");
    const conn = await githubConnection(run.job.owner_id!);
    const gh = conn ? octokitFor(conn.secret) : null;
    let ref = p.ref?.trim() || "";
    if (gh) {
      if (!ref) ref = (await gh.rest.repos.get({ owner: m[1], repo: m[2] })).data.default_branch;
      const res = await gh.rest.repos.downloadZipballArchive({ owner: m[1], repo: m[2], ref });
      zip = new Uint8Array(res.data as ArrayBuffer);
    } else {
      const res = await fetch(`https://codeload.github.com/${m[1]}/${m[2]}/zip/${ref ? encodeURIComponent(ref) : "HEAD"}`);
      if (!res.ok) throw new Error(`دریافت مخزن ${m[1]}/${m[2]} ناموفق بود (${res.status})`);
      zip = new Uint8Array(await res.arrayBuffer());
    }
  }
  if (zip.byteLength > MAX_TOTAL) throw new Error(`حجم آرشیو (${formatBytes(zip.byteLength)}) از سقف ${formatBytes(MAX_TOTAL)} بیشتر است`);
  const files = unzipSync(zip, { filter: (f) => !f.name.endsWith("/") && f.originalSize <= MAX_PROJECT_FILE && !skipOnImport(f.name) });
  const names = Object.keys(files).sort();
  const root = stripCommonRoot(names);
  const sub = p.subdir ? `${p.subdir.replace(/^\/+|\/+$/g, "")}/` : "";
  return names
    .map((n) => ({ path: n.slice(root.length), bytes: files[n] }))
    .filter((e) => !sub || e.path.startsWith(sub))
    .map((e) => ({ path: e.path.slice(sub.length), bytes: e.bytes }));
}

async function finish(run: JobRun, project: Project, added: number) {
  const fresh = await getProject(project.id);
  await refreshStats(project.id, { indexed_at: new Date().toISOString() });
  await writeIndexFile(fresh).catch(() => undefined);
  const cfg = await getUserConfig(project.owner_id);
  const conn = stageModel(cfg, "knowledge").connectionId;
  if (conn && added) {
    await db().from("projects").update({ status: "indexing", status_detail: "ساخت خلاصه‌ی فایل‌ها" }).eq("id", project.id);
    await enqueueJob({ kind: "index", owner_id: project.owner_id, connection_id: conn, project_id: project.id, priority: 40 });
  } else {
    await db().from("projects").update({ status: "ready", status_detail: null }).eq("id", project.id);
  }
  await notify(project.owner_id, { title: `${added} فایل به پروژه‌ی «${project.name}» اضافه شد`, link: `/projects/${project.id}` });
}

/**
 * Brings files into a project (uploaded files and folders, a zip, or another GitHub repository):
 * every file is committed whole, exactly as it is, under projects/<slug>/ and added to the file map.
 */
export async function importHandler(run: JobRun): Promise<StepResult> {
  const project = await getProject(run.job.project_id!);
  const repo = await userRepo(project.owner_id);
  const p = run.job.payload as unknown as ImportPayload;
  const target = p.target ? (safeProjectPath(p.target) ?? "") : "";
  const cursor = Number(run.state.cursor ?? 0);
  let added = Number(run.state.added ?? 0);
  if (!cursor) await db().from("projects").update({ status: "importing", status_detail: "در حال افزودن فایل‌ها" }).eq("id", project.id);

  const files: CommitFile[] = [];
  const rows: ReturnType<typeof indexRow>[] = [];
  let bytes = 0;
  let next = cursor;
  const add = (rel: string, data: Uint8Array) => {
    const path = safeProjectPath(target ? `${target}/${rel}` : rel);
    if (!path) return;
    const content = asContent(path, data);
    files.push({ path: `${project.root_path}/${path}`, content });
    rows.push(indexRow(project.id, path, content));
    bytes += data.byteLength;
  };

  if (p.source === "upload") {
    const list = (p.files ?? []).slice(0, MAX_FILES);
    while (next < list.length && bytes < COMMIT_BYTES && run.timeLeft() > 30_000) {
      const f = list[next++];
      if ((f.size ?? 0) > MAX_PROJECT_FILE || skipOnImport(f.name)) continue;
      add(f.name, new Uint8Array(await (await downloadStorage(f.storage_path)).arrayBuffer()));
    }
    if (files.length) {
      await commitFiles(repo, files, `[TaskFlow] افزودن ${files.length} فایل به پروژه‌ی ${project.name}`);
      await upsertIndex(rows, false);
      await db().storage.from("task-files").remove(list.slice(cursor, next).map((f) => f.storage_path));
    }
    added += files.length;
    await run.patchState({ cursor: next, added });
    await run.log({ source: "project", kind: "file", title: `${files.length} فایل به پروژه افزوده شد (${next}/${list.length})` });
    if (next < list.length) return { type: "continue" };
  } else {
    const entries = (await archiveEntries(run, p)).slice(0, MAX_FILES);
    if (!cursor) await run.log({ source: "project", kind: "log", title: `${entries.length} فایل در ${p.source === "zip" ? "فایل zip" : `مخزن ${p.repo}`} پیدا شد` });
    while (next < entries.length && bytes < COMMIT_BYTES && run.timeLeft() > 30_000) {
      const e = entries[next++];
      add(e.path, e.bytes);
    }
    if (files.length) {
      await commitFiles(repo, files, `[TaskFlow] افزودن ${files.length} فایل به پروژه‌ی ${project.name}`);
      await upsertIndex(rows, false);
    }
    added += files.length;
    await run.patchState({ cursor: next, added });
    await run.log({ source: "project", kind: "file", title: `${added}/${entries.length} فایل در GitHub ذخیره شد` });
    if (next < entries.length) return { type: "continue" };
    if (p.source === "zip" && p.storage_path) await db().storage.from("task-files").remove([p.storage_path]);
  }
  await finish(run, project, added);
  return { type: "done", result: { added } };
}

export async function importOnFail(run: JobRun, error: string) {
  if (!run.job.project_id) return;
  await db().from("projects").update({ status: "error", status_detail: error.slice(0, 500) }).eq("id", run.job.project_id);
  await logEvent({ project_id: run.job.project_id, job_id: run.job.id, source: "project", kind: "error", title: "افزودن فایل‌ها به پروژه ناموفق بود", detail: error });
}
