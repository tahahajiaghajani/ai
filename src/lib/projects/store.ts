import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { blobSha, commitFiles, getFileText, listTree, userRepo, type CommitFile, type Repo } from "@/lib/github/client";
import { extractImports, extractSymbols } from "@/lib/projects/symbols";
import { META_DIR, fileKind, isTextPath, metaPath, projectRoot, projectSlug, SLUG_RE, type FileKind } from "@/lib/projects/paths";
import { formatJalali } from "@/lib/jalali";
import { formatBytes, truncate } from "@/lib/utils";

export interface Project {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string;
  root_path: string;
  source: Record<string, unknown>;
  status: "importing" | "indexing" | "ready" | "error";
  status_detail: string | null;
  file_count: number;
  total_size: number;
  indexed_at: string | null;
  knowledge_at: string | null;
  graph_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  project_id: string;
  path: string;
  size: number;
  sha: string | null;
  kind: FileKind;
  summary: string | null;
  symbols: string[];
  imports: string[];
  updated_at: string;
}

export async function listProjects(ownerId: string): Promise<Project[]> {
  const { data } = await db().from("projects").select("*").eq("owner_id", ownerId).order("updated_at", { ascending: false });
  return (data ?? []) as Project[];
}

/** A project, checking it belongs to `ownerId` (the owner of the app may read every project). */
export async function getProject(id: string, ownerId?: string): Promise<Project> {
  let q = db().from("projects").select("*").eq("id", id);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data } = await q.maybeSingle<Project>();
  if (!data) throw new Error("پروژه پیدا نشد");
  return data;
}

export async function projectBySlug(ownerId: string, slug: string): Promise<Project | null> {
  const { data } = await db().from("projects").select("*").eq("owner_id", ownerId).eq("slug", slug).maybeSingle<Project>();
  return data;
}

export async function projectFiles(projectId: string): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db().from("project_files").select("*").eq("project_id", projectId).order("path").range(from, from + 999);
    out.push(...((data ?? []) as ProjectFile[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function projectMarkdown(p: Pick<Project, "name" | "slug" | "description">): string {
  return `# ${p.name}\n\n- پوشه: \`${projectRoot(p.slug)}/\`\n\n## توضیحات\n\n${p.description.trim() || "—"}\n`;
}

const EMPTY_KNOWLEDGE = (name: string) =>
  `# دانش پروژه‌ی ${name}\n\n> این فایل پس از هر کار روی پروژه به صورت خودکار به‌روز می‌شود (و قابل ویرایش دستی است).\n\n## نمای کلی\n\n—\n\n## ساختار و معماری\n\n—\n\n## قراردادها و الگوها\n\n—\n\n## تصمیم‌ها\n\n—\n\n## درس‌ها و نکته‌ها\n\n—\n\n## کارهای باز\n\n—\n`;

export async function createProject(ownerId: string, input: { name: string; slug?: string; description?: string; source?: Record<string, unknown> }): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new Error("نام پروژه را وارد کنید");
  if (name.length > 120) throw new Error("نام پروژه حداکثر ۱۲۰ کاراکتر است");
  let slug = (input.slug?.trim().toLowerCase() || projectSlug(name)).slice(0, 48);
  if (!SLUG_RE.test(slug)) throw new Error("نام پوشه‌ی پروژه فقط حروف کوچک لاتین، عدد و - باشد (مثلاً renew)");
  if (await projectBySlug(ownerId, slug)) {
    if (input.slug) throw new Error(`پروژه‌ای با پوشه‌ی «${slug}» وجود دارد`);
    slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
  }
  const repo = await userRepo(ownerId);
  const description = (input.description ?? "").trim().slice(0, 20000);
  const meta = { name, slug, description };
  await commitFiles(
    repo,
    [
      { path: metaPath(slug, "PROJECT.md"), content: projectMarkdown(meta) },
      { path: metaPath(slug, "KNOWLEDGE.md"), content: EMPTY_KNOWLEDGE(name) },
      { path: metaPath(slug, "INDEX.md"), content: indexMarkdown(meta, []) },
    ],
    `[TaskFlow] پروژه‌ی جدید: ${name}`,
  );
  return must(
    await db()
      .from("projects")
      .insert({ owner_id: ownerId, slug, name, description, root_path: projectRoot(slug), source: input.source ?? {}, status: "ready" })
      .select("*")
      .single<Project>(),
    "ثبت پروژه",
  );
}

export async function updateProjectInfo(project: Project, input: { name?: string; description?: string }) {
  const name = (input.name ?? project.name).trim() || project.name;
  const description = (input.description ?? project.description).trim().slice(0, 20000);
  await db().from("projects").update({ name, description }).eq("id", project.id);
  const repo = await userRepo(project.owner_id);
  await commitFiles(repo, [{ path: metaPath(project.slug, "PROJECT.md"), content: projectMarkdown({ name, slug: project.slug, description }) }], `[TaskFlow] توضیحات پروژه‌ی ${name}`);
}

/** Index rows for files (symbols and imports read from text files; binaries keep only size/kind). */
export function indexRow(projectId: string, path: string, content: string | Uint8Array | null, size?: number) {
  const text = typeof content === "string" ? content : null;
  const bytes = content === null ? null : typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
  return {
    project_id: projectId,
    path,
    size: size ?? bytes ?? 0,
    sha: content === null ? null : blobSha(content),
    kind: fileKind(path),
    symbols: text && isTextPath(path) ? extractSymbols(path, text) : [],
    imports: text && isTextPath(path) ? extractImports(path, text) : [],
    updated_at: new Date().toISOString(),
  };
}

export async function upsertIndex(rows: ReturnType<typeof indexRow>[], keepSummaries = true) {
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    // a changed file loses its old summary (re-summarised later); unchanged content keeps it
    if (!keepSummaries) {
      const { error } = await db().from("project_files").upsert(batch.map((r) => ({ ...r, summary: null })));
      if (error) throw new Error(`نقشه‌ی فایل‌ها: ${error.message}`);
      continue;
    }
    const { data: existing } = await db()
      .from("project_files")
      .select("path, sha, summary")
      .eq("project_id", batch[0].project_id)
      .in("path", batch.map((r) => r.path));
    const prev = new Map((existing ?? []).map((e) => [e.path as string, e as { sha: string | null; summary: string | null }]));
    const { error } = await db()
      .from("project_files")
      .upsert(batch.map((r) => ({ ...r, summary: prev.get(r.path)?.sha === r.sha ? (prev.get(r.path)?.summary ?? null) : null })));
    if (error) throw new Error(`نقشه‌ی فایل‌ها: ${error.message}`);
  }
}

export async function removeFromIndex(projectId: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 200) {
    await db().from("project_files").delete().eq("project_id", projectId).in("path", paths.slice(i, i + 200));
  }
}

export async function refreshStats(projectId: string, patch: Partial<Project> = {}) {
  const { data } = await db().from("project_files").select("size").eq("project_id", projectId);
  const rows = (data ?? []) as { size: number }[];
  await db()
    .from("projects")
    .update({ file_count: rows.length, total_size: rows.reduce((s, r) => s + Number(r.size ?? 0), 0), ...patch })
    .eq("id", projectId);
}

const KIND_LABEL: Record<FileKind, string> = { code: "کد", doc: "سند", data: "داده", asset: "رسانه", other: "سایر" };

/** INDEX.md: the human- and model-readable map of a project's files. */
export function indexMarkdown(p: Pick<Project, "name" | "slug">, files: Pick<ProjectFile, "path" | "size" | "kind" | "summary" | "symbols">[]): string {
  const rows = files.map((f) => `| \`${f.path}\` | ${KIND_LABEL[f.kind] ?? f.kind} | ${formatBytes(f.size)} | ${(f.summary ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} | ${f.symbols.slice(0, 8).join("، ")} |`);
  return `# نقشه‌ی فایل‌های ${p.name}\n\n> به صورت خودکار ساخته می‌شود. مسیرها نسبت به \`${projectRoot(p.slug)}/\` هستند.\n\n_${files.length} فایل — به‌روزرسانی: ${formatJalali(new Date().toISOString(), { withTime: true })}_\n\n| مسیر | نوع | اندازه | خلاصه | نمادها |\n|---|---|---|---|---|\n${rows.join("\n")}\n`;
}

/** Rewrites INDEX.md from the database (one small commit). */
export async function writeIndexFile(project: Project, repo?: Repo) {
  const files = await projectFiles(project.id);
  const r = repo ?? (await userRepo(project.owner_id));
  await commitFiles(r, [{ path: metaPath(project.slug, "INDEX.md"), content: indexMarkdown(project, files) }], `[TaskFlow] نقشه‌ی فایل‌های ${project.name}`);
}

/** Rebuilds the index from the repository tree (new/removed files are picked up). */
export async function reindexFromRepo(project: Project): Promise<{ added: number; removed: number }> {
  const r = await userRepo(project.owner_id);
  const tree = (await listTree(r, project.root_path)).filter((t) => t.type === "blob" && !t.path.slice(project.root_path.length + 1).startsWith(`${META_DIR}/`));
  const known = new Map((await projectFiles(project.id)).map((f) => [f.path, f]));
  const seen = new Set<string>();
  const rows: ReturnType<typeof indexRow>[] = [];
  for (const t of tree) {
    const rel = t.path.slice(project.root_path.length + 1);
    seen.add(rel);
    const prev = known.get(rel);
    if (prev?.sha === t.sha) continue;
    let text: string | null = null;
    if (isTextPath(rel) && (t.size ?? 0) < 400_000) text = await getFileText(r, t.path).catch(() => null);
    rows.push({ ...indexRow(project.id, rel, text ?? new Uint8Array(0), t.size), sha: t.sha, size: t.size ?? 0 });
  }
  if (rows.length) await upsertIndex(rows);
  const removed = [...known.keys()].filter((p) => !seen.has(p));
  if (removed.length) await removeFromIndex(project.id, removed);
  await refreshStats(project.id, { indexed_at: new Date().toISOString() });
  return { added: rows.length, removed: removed.length };
}

/** Deletes the project folder from GitHub (one commit) and its rows. */
export async function deleteProjectEverywhere(project: Project) {
  try {
    const r = await userRepo(project.owner_id);
    const tree = (await listTree(r, project.root_path)).filter((t) => t.type === "blob");
    const files: CommitFile[] = tree.map((t) => ({ path: t.path, content: null }));
    for (let i = 0; i < files.length; i += 1500) await commitFiles(r, files.slice(i, i + 1500), `[TaskFlow] حذف پروژه‌ی ${project.name}`);
  } catch (err) {
    // without GitHub access the rows are still removed; the folder can be deleted by hand
    console.error("project delete (github)", err);
  }
  await db().from("projects").delete().eq("id", project.id);
}

/**
 * What the models get about a project: its description, knowledge file, the file map and (complete,
 * never split) the files the user picked.
 */
export async function projectContext(project: Project, selected: string[] = [], budget = 120_000): Promise<{ text: string; files: { path: string; content: string }[] }> {
  const r = await userRepo(project.owner_id);
  const [info, knowledge, files] = await Promise.all([
    getFileText(r, metaPath(project.slug, "PROJECT.md")).catch(() => null),
    getFileText(r, metaPath(project.slug, "KNOWLEDGE.md")).catch(() => null),
    projectFiles(project.id),
  ]);
  const map = files.map((f) => `- \`${f.path}\` (${KIND_LABEL[f.kind]}, ${formatBytes(f.size)})${f.summary ? ` — ${f.summary}` : ""}${f.symbols.length ? ` [${f.symbols.slice(0, 6).join(", ")}]` : ""}`);
  let mapText = map.join("\n");
  if (mapText.length > 40_000) mapText = `${truncate(mapText, 40_000)}\n…(فهرست کامل با ابزار list_files)`;
  const parts = [
    `## پروژه: ${project.name} (پوشه \`${project.root_path}/\`)`,
    info ? info.replace(/^# .*\n/, "").trim() : project.description || "",
    knowledge?.trim() ? `### دانش پروژه (KNOWLEDGE.md)\n${truncate(knowledge, 30_000)}` : "",
    `### نقشه‌ی فایل‌ها (${files.length} فایل؛ مسیرها نسبت به پوشه‌ی پروژه)\n${mapText || "— (پروژه هنوز فایلی ندارد)"}`,
  ];
  const picked: { path: string; content: string }[] = [];
  let left = budget;
  for (const p of selected) {
    if (left < 2_000) break;
    const content = await getFileText(r, `${project.root_path}/${p}`).catch(() => null);
    if (content === null) continue;
    picked.push({ path: p, content });
    left -= content.length;
  }
  if (picked.length) {
    parts.push(`### فایل‌های انتخاب‌شده (کامل)\n${picked.map((f) => `--- شروع فایل ${f.path} ---\n${f.content}\n--- پایان فایل ${f.path} ---`).join("\n\n")}`);
  }
  return { text: parts.filter(Boolean).join("\n\n"), files: picked };
}
