import "server-only";
import { getBlobBytes, getFileText, type Repo } from "@/lib/github/client";
import { projectFiles, type Project, type ProjectFile } from "@/lib/projects/store";
import { fileKind, isTextPath, safeProjectPath } from "@/lib/projects/paths";
import { ToolError, type AgentTool } from "@/lib/ai/agent";

/** Pending changes of a run: path → new content (null = deleted). Kept in the job state until published. */
export type Staged = Record<string, string | null>;

const textCache = new Map<string, string>();

/**
 * The files an agent works on: a project in the user's GitHub repo (reads go to GitHub, writes are
 * staged and committed together at the end) or, without a project, an empty scratch area whose
 * files become the run's outputs.
 */
export class WorkFS {
  private index: ProjectFile[] | null = null;

  constructor(
    public staged: Staged,
    private repo: Repo | null,
    private project: Project | null,
  ) {}

  get hasProject() {
    return !!this.project && !!this.repo;
  }

  private async files(): Promise<ProjectFile[]> {
    if (!this.project) return [];
    if (!this.index) this.index = await projectFiles(this.project.id);
    return this.index;
  }

  /** All paths visible to the agent (index + staged additions − staged deletions). */
  async entries(): Promise<{ path: string; size: number; kind: string; summary: string | null; symbols: string[]; sha: string | null }[]> {
    const map = new Map((await this.files()).map((f) => [f.path, { path: f.path, size: f.size, kind: f.kind, summary: f.summary, symbols: f.symbols, sha: f.sha }]));
    for (const [p, c] of Object.entries(this.staged)) {
      if (c === null) map.delete(p);
      else map.set(p, { path: p, size: Buffer.byteLength(c), kind: fileKind(p), summary: map.get(p)?.summary ?? "(تغییر در همین اجرا)", symbols: map.get(p)?.symbols ?? [], sha: null });
    }
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string): Promise<string | null> {
    if (path in this.staged) return this.staged[path];
    if (!this.project || !this.repo) return null;
    const f = (await this.files()).find((x) => x.path === path);
    const key = `${this.project.id}:${path}:${f?.sha ?? ""}`;
    const hit = textCache.get(key);
    if (hit !== undefined) return hit;
    let text: string | null;
    if (f?.sha) text = (await getBlobBytes(this.repo, f.sha).catch(() => null))?.toString("utf-8") ?? null;
    else text = await getFileText(this.repo, `${this.project.root_path}/${path}`).catch(() => null);
    if (text !== null && text.length < 2_000_000) {
      if (textCache.size > 400) textCache.clear();
      textCache.set(key, text);
    }
    return text;
  }

  write(path: string, content: string) {
    this.staged[path] = content;
  }

  remove(path: string) {
    this.staged[path] = null;
  }
}

function clean(input: unknown, opts?: { allowMeta?: boolean }): string {
  const p = safeProjectPath(String(input ?? ""), opts);
  if (!p) throw new ToolError(`مسیر «${String(input)}» مجاز نیست (مسیر نسبی داخل پروژه، بدون .. و بدون پوشه‌ی .taskflow)`);
  return p;
}

function numbered(text: string, from: number, to: number): string {
  const lines = text.split("\n");
  const end = Math.min(to, lines.length);
  return lines
    .slice(from - 1, end)
    .map((l, i) => `${String(from + i).padStart(5)}\t${l}`)
    .join("\n");
}

const MAX_READ_CHARS = 90_000;

/** Tools of the agents: read-only ones for analysis steps, plus write tools for the executor. */
export function workTools(fs: WorkFS, opts: { write: boolean; onWrite?: (path: string, action: string) => void }): AgentTool[] {
  const tools: AgentTool[] = [
    {
      def: {
        name: "list_files",
        description:
          "List the project's files with size, kind, one-line summary and main symbols. Use `query` (words matched against path, summary and symbols) or `path` (folder prefix) to narrow it down. Start here to find the files relevant to the request.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "folder prefix, e.g. src/components" }, query: { type: "string", description: "words to match, e.g. 'wbs profile load'" } },
        },
      },
      async run(input) {
        const prefix = input.path ? String(input.path).replace(/^\.?\/+|\/+$/g, "") : "";
        const words = String(input.query ?? "")
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);
        const all = await fs.entries();
        const hits = all.filter((e) => {
          if (prefix && !(e.path === prefix || e.path.startsWith(`${prefix}/`))) return false;
          if (!words.length) return true;
          const hay = `${e.path} ${e.summary ?? ""} ${e.symbols.join(" ")}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
        if (!all.length) return "پروژه هنوز فایلی ندارد.";
        if (!hits.length) return `هیچ فایلی مطابق نبود (کل فایل‌ها: ${all.length}). کلمه‌ی دیگری امتحان کن یا search_code را به کار ببر.`;
        const shown = hits.slice(0, 300);
        return `${hits.length} فایل${hits.length > shown.length ? ` (۳۰۰ مورد اول)` : ""}:\n${shown
          .map((e) => `${e.path} (${e.kind}, ${e.size} B)${e.summary ? ` — ${e.summary}` : ""}${e.symbols.length ? ` [${e.symbols.slice(0, 8).join(", ")}]` : ""}`)
          .join("\n")}`;
      },
    },
    {
      def: {
        name: "search_code",
        description: "Search the text of the project's files (case-insensitive). Returns matching lines as path:line: text. Optional `path` limits the search to a folder; `regex` treats the query as a regular expression.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" }, path: { type: "string" }, regex: { type: "boolean" } },
          required: ["query"],
        },
      },
      async run(input) {
        const q = String(input.query ?? "");
        if (!q.trim()) throw new ToolError("query خالی است");
        let re: RegExp;
        try {
          re = input.regex ? new RegExp(q, "i") : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        } catch {
          throw new ToolError("عبارت منظم نامعتبر است");
        }
        const prefix = input.path ? String(input.path).replace(/^\.?\/+|\/+$/g, "") : "";
        const candidates = (await fs.entries()).filter((e) => isTextPath(e.path) && e.size < 400_000 && (!prefix || e.path.startsWith(`${prefix}/`) || e.path === prefix)).slice(0, 400);
        const out: string[] = [];
        let scanned = 0;
        for (let i = 0; i < candidates.length && out.length < 80; i += 12) {
          const batch = candidates.slice(i, i + 12);
          const texts = await Promise.all(batch.map((e) => fs.read(e.path)));
          batch.forEach((e, j) => {
            const t = texts[j];
            if (t === null) return;
            scanned++;
            t.split("\n").forEach((line, n) => {
              if (out.length < 80 && re.test(line)) out.push(`${e.path}:${n + 1}: ${line.trim().slice(0, 220)}`);
            });
          });
        }
        return out.length ? `${out.length} نتیجه (در ${scanned} فایل):\n${out.join("\n")}` : `نتیجه‌ای نبود (${scanned} فایل جستجو شد).`;
      },
    },
    {
      def: {
        name: "read_file",
        description: "Read a project file with line numbers. Large files: pass start_line/end_line to read a range. Always read a file before editing it.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } },
          required: ["path"],
        },
      },
      async run(input) {
        const path = clean(input.path, { allowMeta: true });
        const text = await fs.read(path);
        if (text === null) throw new ToolError(`فایل «${path}» وجود ندارد. با list_files مسیر درست را پیدا کن.`);
        if (!isTextPath(path) && /[\u0000]/.test(text.slice(0, 2000))) throw new ToolError("این فایل باینری است و قابل خواندن به‌صورت متن نیست");
        const total = text.split("\n").length;
        const from = Math.max(1, Number(input.start_line ?? 1));
        let to = Number(input.end_line ?? total);
        let body = numbered(text, from, to);
        if (body.length > MAX_READ_CHARS) {
          body = body.slice(0, MAX_READ_CHARS);
          to = from + body.split("\n").length - 1;
          body += `\n… (ادامه دارد؛ بقیه را با start_line=${to} بخوان)`;
        }
        return `${path} — ${total} خط${from > 1 || to < total ? ` (خطوط ${from} تا ${Math.min(to, total)})` : ""}\n${body}`;
      },
    },
  ];

  if (!opts.write) return tools;

  tools.push(
    {
      def: {
        name: "write_file",
        description:
          "Create a new file or replace a whole file with complete content. Keep files whole: never split one file into pieces. For a long new file, write the first part here and continue with append_file. Prefer edit_file for changing existing files.",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      },
      async run(input) {
        const path = clean(input.path);
        const existed = (await fs.read(path)) !== null;
        fs.write(path, String(input.content));
        opts.onWrite?.(path, existed ? "replace" : "create");
        return `${existed ? "جایگزین شد" : "ساخته شد"}: ${path} (${String(input.content).split("\n").length} خط)`;
      },
    },
    {
      def: {
        name: "append_file",
        description: "Append content to the end of a file (to write a long file in several parts). The file is created if it does not exist.",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      },
      async run(input) {
        const path = clean(input.path);
        const current = (await fs.read(path)) ?? "";
        fs.write(path, current + String(input.content));
        opts.onWrite?.(path, "append");
        return `افزوده شد: ${path} (اکنون ${(current + String(input.content)).split("\n").length} خط)`;
      },
    },
    {
      def: {
        name: "edit_file",
        description:
          "Replace an exact piece of text in a file. old_text must match the file exactly (including spaces/indentation) and be unique unless replace_all is true. Read the file first.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" }, replace_all: { type: "boolean" } },
          required: ["path", "old_text", "new_text"],
        },
      },
      async run(input) {
        const path = clean(input.path);
        const text = await fs.read(path);
        if (text === null) throw new ToolError(`فایل «${path}» وجود ندارد`);
        const oldText = String(input.old_text);
        if (!oldText) throw new ToolError("old_text خالی است");
        const count = text.split(oldText).length - 1;
        if (count === 0) throw new ToolError("old_text در فایل پیدا نشد؛ فایل را دوباره بخوان و متن را دقیقاً همان‌طور کپی کن");
        if (count > 1 && !input.replace_all) throw new ToolError(`old_text ${count} بار در فایل هست؛ متن بیشتری از اطرافش بده تا یکتا شود یا replace_all بفرست`);
        fs.write(path, input.replace_all ? text.split(oldText).join(String(input.new_text)) : text.replace(oldText, () => String(input.new_text)));
        opts.onWrite?.(path, "edit");
        return `ویرایش شد: ${path}${count > 1 ? ` (${count} مورد)` : ""}`;
      },
    },
    {
      def: {
        name: "delete_file",
        description: "Delete a file from the project (only when the request needs it).",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      async run(input) {
        const path = clean(input.path);
        if ((await fs.read(path)) === null) throw new ToolError(`فایل «${path}» وجود ندارد`);
        fs.remove(path);
        opts.onWrite?.(path, "delete");
        return `حذف شد: ${path}`;
      },
    },
    {
      def: {
        name: "finish",
        description: "Call once when the work is completely done. `summary` is shown to the user: in Persian, briefly what you changed or created (file names) and anything that still needs attention.",
        parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      },
      async run() {
        return "ok";
      },
    },
  );
  return tools;
}
