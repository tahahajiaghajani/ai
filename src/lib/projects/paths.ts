/**
 * Project paths and file classification (shared by the UI and the server).
 * A project is a folder `projects/<slug>/` in the user's workspace repo; the app's own notes live in
 * `projects/<slug>/.taskflow/`, apart from the project's files.
 */

export const META_DIR = ".taskflow";

export function projectRoot(slug: string) {
  return `projects/${slug}`;
}

export function metaPath(slug: string, file: string) {
  return `${projectRoot(slug)}/${META_DIR}/${file}`;
}

/** Latin slug for a project folder (a Persian name gets a short latin fallback). */
export function projectSlug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return s || `project-${Math.random().toString(36).slice(2, 7)}`;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * A safe path inside a project (relative, forward slashes, no `..`, not inside `.taskflow/` or
 * `.git/`). Returns null for anything else.
 */
export function safeProjectPath(input: string, opts: { allowMeta?: boolean } = {}): string | null {
  const p = String(input ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (!p || p.length > 400) return null;
  const parts = p.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || /[\u0000-\u001f<>:"|?*]/.test(s))) return null;
  if (parts[0] === ".git" || (!opts.allowMeta && parts[0] === META_DIR)) return null;
  return p;
}

export type FileKind = "code" | "doc" | "data" | "asset" | "other";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|cs|csx|vb|py|java|kt|kts|go|rb|php|rs|c|cc|cpp|h|hpp|swift|m|vue|svelte|css|scss|sass|less|html?|sql|sh|bash|ps1|bat|xaml|razor|cshtml|aspx|asmx|ascx|config|dart|lua|r|scala|groovy|gradle|tf|dockerfile)$/i;
const DOC = /\.(md|markdown|mdx|txt|rst|adoc|pdf|docx?|rtf|odt|pptx?)$/i;
const DATA = /\.(json|jsonc|csv|tsv|xml|ya?ml|toml|ini|xlsx?|ods|graphql|proto|env\.example)$/i;
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|bmp|mp3|wav|mp4|webm|mov|woff2?|ttf|otf|eot|zip|gz|tar|7z|rar|exe|dll|so|dylib|bin)$/i;

export function fileKind(path: string): FileKind {
  const name = path.split("/").pop() ?? path;
  if (/^(dockerfile|makefile|procfile)$/i.test(name)) return "code";
  if (CODE.test(name)) return "code";
  if (DOC.test(name)) return "doc";
  if (DATA.test(name)) return "data";
  if (ASSET.test(name)) return "asset";
  return "other";
}

/** Files the models read as text. */
export function isTextPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (/\.(pdf|docx?|pptx?|xlsx?|ods|odt|rtf)$/i.test(name)) return false;
  const k = fileKind(path);
  return k === "code" || k === "data" || (k === "doc" && !/\.(pdf|docx?)$/i.test(name)) || (k === "other" && !/\.[a-z0-9]{1,8}$/i.test(name)) || /\.(gitignore|editorconfig|env\.example|txt|log|svg)$/i.test(name);
}

/** Folders and files never imported into a project (dependencies, build output, VCS, lock files). */
const SKIP_DIR = /(^|\/)(node_modules|\.git|\.next|\.nuxt|dist|build|out|bin|obj|target|__pycache__|\.venv|venv|\.idea|\.vs|\.vscode|coverage|\.turbo|\.cache|\.gradle|Pods|DerivedData)(\/|$)/;
const SKIP_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

export function skipOnImport(path: string): boolean {
  return SKIP_DIR.test(path) || SKIP_FILE.test(path);
}

/** Largest single file kept in a project (GitHub's own limit is 100 MB). */
export const MAX_PROJECT_FILE = 20 * 1024 * 1024;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The word `w` appears in `text` on its own (not inside a longer latin word or path). */
function mentions(text: string, w: string) {
  return new RegExp(`(^|[^\\w./-])${escapeRe(w)}($|[^\\w/-])`, "i").test(text);
}

/**
 * Project files a prompt names ("فایل audit.cs باگ دارد", "src/app/page.tsx"): full paths first,
 * then unique file names with an extension. Lets the agents start from the right files at once.
 */
export function mentionedFiles(prompt: string, paths: string[], max = 10): string[] {
  const text = prompt.replace(/\\/g, "/");
  const out: string[] = [];
  for (const p of paths) if (p.includes("/") && mentions(text, p)) out.push(p);
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    const name = (p.split("/").pop() ?? p).toLowerCase();
    if (name.length < 4 || !/\.[a-z0-9]{1,8}$/i.test(name)) continue;
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  for (const [name, list] of byName) {
    if (!mentions(text, name)) continue;
    // a common name (index.ts) in many folders is only taken when the prompt names little else
    for (const p of list.slice(0, 3)) if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, max);
}

/** The one project a prompt names ("در پروژه renew …"), by folder name or project name. */
export function mentionedProject<T extends { slug: string; name: string }>(prompt: string, projects: T[]): T | null {
  const hits = projects.filter((p) => mentions(prompt, p.slug) || (p.name.trim().length >= 2 && mentions(prompt, p.name.trim())));
  if (hits.length === 1) return hits[0];
  // several matches: prefer the one introduced with «پروژه»/project
  const strict = hits.filter((p) => new RegExp(`(پروژه|project)\\s*[«"']?\\s*(${escapeRe(p.slug)}|${escapeRe(p.name.trim())})`, "i").test(prompt));
  return strict.length === 1 ? strict[0] : null;
}
