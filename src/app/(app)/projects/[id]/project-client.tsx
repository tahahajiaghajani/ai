"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Brain,
  ChevronLeft,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  Network,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, Spinner, Textarea } from "@/components/ui/primitives";
import { Modal, Tabs } from "@/components/ui/overlays";
import { Markdown } from "@/components/ui/markdown";
import { FileDropzone, useUploads } from "@/components/ui/file-dropzone";
import { StatusBadge } from "@/components/tasks/badges";
import { QuickCommand } from "@/components/tasks/quick-command";
import { ProjectStatus } from "../projects-client";
import {
  addProjectFilesAction,
  buildProjectGraphAction,
  deleteProjectAction,
  deleteProjectFilesAction,
  importGithubAction,
  importZipAction,
  projectMetaAction,
  readProjectFileAction,
  reindexProjectAction,
  saveProjectFileAction,
  updateProjectAction,
} from "@/app/actions/projects";
import { formatJalali, timeAgo } from "@/lib/jalali";
import { cn, faNum, formatBytes } from "@/lib/utils";
import type { DispatchDefaults } from "@/lib/settings";
import type { Job, ProjectSummary, Task } from "@/lib/types";

export interface ProjectFileRow {
  path: string;
  size: number;
  kind: string;
  summary: string | null;
  symbols: string[];
}

const JOB_LABEL: Record<string, string> = { import: "افزودن فایل‌ها", index: "خلاصه‌ی فایل‌ها", knowledge: "به‌روزرسانی دانش", graphify: "ساخت گراف" };

async function go<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>, msg?: string): Promise<T | null> {
  const r = await p;
  if (!r.ok) {
    toast.error(r.error);
    return null;
  }
  if (msg) toast.success(msg);
  return r.data;
}

// ---------------------------------------------------------------- file viewer / editor
function FileViewer({ projectId, path, onClose, onDeleted }: { projectId: string; path: string; onClose: () => void; onDeleted: () => void }) {
  const [data, setData] = React.useState<{ text: string | null; url: string; binary: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    setEditing(false);
    void readProjectFileAction(projectId, path).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data);
        setDraft(r.data.text ?? "");
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [projectId, path]);

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <FileCode2 className="size-4 text-muted" />
        <span className="ltr min-w-0 flex-1 truncate text-start font-mono text-xs font-bold">{path}</span>
        {data?.url ? (
          <a href={data.url} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost">
              GitHub <ExternalLink className="size-3.5" />
            </Button>
          </a>
        ) : null}
        {data && !data.binary && !editing ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> ویرایش
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          onClick={async () => {
            if (!window.confirm(`فایل ${path} از پروژه (و GitHub) حذف شود؟`)) return;
            if (await go(deleteProjectFilesAction(projectId, [path]), "فایل حذف شد")) onDeleted();
          }}
        >
          <Trash2 className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="بستن">
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="p-4 text-sm text-danger">{error}</p>
        ) : !data ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : data.binary ? (
          <p className="p-4 text-sm text-muted">این فایل متنی نیست؛ از طریق GitHub باز کنید. مدل‌ها فایل‌های PDF و Word را هنگام کار می‌خوانند.</p>
        ) : editing ? (
          <div className="p-3">
            <Textarea dir="ltr" spellCheck={false} className="min-h-[55vh] font-mono text-[12.5px] leading-6" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="mt-2 flex gap-2">
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await go(saveProjectFileAction(projectId, path, draft), "ذخیره و در GitHub ثبت شد");
                  setBusy(false);
                  if (ok !== null) {
                    setData((d) => (d ? { ...d, text: draft } : d));
                    setEditing(false);
                  }
                }}
              >
                <Save className="size-4" /> ذخیره
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                انصراف
              </Button>
            </div>
          </div>
        ) : /\.(md|markdown)$/i.test(path) ? (
          <div className="p-4">
            <Markdown>{data.text ?? ""}</Markdown>
          </div>
        ) : (
          <pre dir="ltr" className="whitespace-pre p-4 text-start font-mono text-[12px] leading-6">
            {data.text}
          </pre>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- file browser
function FileBrowser({ projectId, files, open, setOpen }: { projectId: string; files: ProjectFileRow[]; open: string | null; setOpen: (p: string | null) => void }) {
  const router = useRouter();
  const [dir, setDir] = React.useState(() => (open?.includes("/") ? open.slice(0, open.lastIndexOf("/")) : ""));
  const [q, setQ] = React.useState("");

  const entries = React.useMemo(() => {
    const prefix = dir ? `${dir}/` : "";
    const folders = new Map<string, number>();
    const here: ProjectFileRow[] = [];
    for (const f of files) {
      if (!f.path.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) here.push(f);
      else folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) ?? 0) + 1);
    }
    return { folders: [...folders.entries()].sort((a, b) => a[0].localeCompare(b[0])), files: here.sort((a, b) => a.path.localeCompare(b.path)) };
  }, [files, dir]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length ? files.filter((f) => words.every((w) => `${f.path} ${f.summary ?? ""} ${f.symbols.join(" ")}`.toLowerCase().includes(w))).slice(0, 200) : null;

  const fileRow = (f: ProjectFileRow, full = false) => (
    <button
      key={f.path}
      type="button"
      onClick={() => setOpen(f.path)}
      className={cn("flex w-full items-start gap-2.5 px-4 py-2.5 text-start hover:bg-surface-muted", open === f.path && "bg-primary-soft")}
    >
      <FileText className="mt-0.5 size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="ltr block truncate text-start font-mono text-xs font-semibold">{full ? f.path : f.path.split("/").pop()}</span>
        {f.summary ? <span className="mt-0.5 line-clamp-2 block text-[11px] leading-5 text-muted">{f.summary}</span> : null}
      </span>
      <span className="shrink-0 text-[10.5px] text-faint">{formatBytes(f.size)}</span>
    </button>
  );

  return (
    <div className={cn("grid gap-4", open ? "lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]" : "")}>
      <Card className={cn("overflow-hidden", open && "hidden lg:block")}>
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو: نام فایل، خلاصه یا نام تابع/کلاس" className="h-10 pr-9" />
          </div>
          {!results ? (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
              <button type="button" onClick={() => setDir("")} className="font-bold text-primary">
                ریشه
              </button>
              {dir
                ? dir.split("/").map((part, i, all) => (
                    <React.Fragment key={i}>
                      <ChevronLeft className="size-3 text-faint" />
                      <button type="button" onClick={() => setDir(all.slice(0, i + 1).join("/"))} className="ltr font-mono font-semibold text-primary">
                        {part}
                      </button>
                    </React.Fragment>
                  ))
                : null}
            </div>
          ) : null}
        </div>
        <div className="max-h-[65vh] divide-y divide-line overflow-y-auto">
          {results ? (
            results.length ? (
              results.map((f) => fileRow(f, true))
            ) : (
              <p className="p-4 text-sm text-muted">فایلی پیدا نشد.</p>
            )
          ) : (
            <>
              {dir ? (
                <button type="button" onClick={() => setDir(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "")} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-xs text-muted hover:bg-surface-muted">
                  <ArrowRight className="size-4" /> بالا
                </button>
              ) : null}
              {entries.folders.map(([name, count]) => (
                <button key={name} type="button" onClick={() => setDir(dir ? `${dir}/${name}` : name)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start hover:bg-surface-muted">
                  <Folder className="size-4 shrink-0 text-amber-500" />
                  <span className="ltr min-w-0 flex-1 truncate text-start font-mono text-xs font-bold">{name}</span>
                  <span className="text-[10.5px] text-faint">{faNum(count)} فایل</span>
                </button>
              ))}
              {entries.files.map((f) => fileRow(f))}
              {!entries.folders.length && !entries.files.length ? <p className="p-4 text-sm text-muted">این پوشه خالی است.</p> : null}
            </>
          )}
        </div>
      </Card>
      {open ? (
        <FileViewer
          projectId={projectId}
          path={open}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- add files
function AddFiles({ projectId, userId, onQueued }: { projectId: string; userId: string; onQueued: () => void }) {
  const [source, setSource] = React.useState<"files" | "folder" | "zip" | "github">("files");
  const [target, setTarget] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [subdir, setSubdir] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [dropKey, setDropKey] = React.useState(0);
  const uploads = useUploads();

  const submit = async () => {
    setBusy(true);
    let ok: unknown = null;
    if (source === "github") ok = await go(importGithubAction(projectId, repo, { ref, subdir, target }), "ورود از GitHub در صف قرار گرفت");
    else if (source === "zip") {
      const zip = uploads.files[0];
      if (!zip) toast.error("فایل zip را انتخاب کنید");
      else ok = await go(importZipAction(projectId, zip, target), "باز کردن zip در صف قرار گرفت");
    } else ok = await go(addProjectFilesAction(projectId, uploads.files, target), `${faNum(uploads.files.length)} فایل در صف افزودن قرار گرفت`);
    setBusy(false);
    if (ok !== null) {
      setDropKey((k) => k + 1);
      onQueued();
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap gap-1 rounded-2xl bg-surface-muted p-1 text-sm font-bold">
        {(
          [
            ["files", "فایل‌ها"],
            ["folder", "یک پوشه"],
            ["zip", "فایل zip"],
            ["github", "مخزن GitHub"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setSource(k);
              setDropKey((x) => x + 1);
            }}
            className={cn("flex-1 rounded-xl px-3 py-2 transition", source === k ? "bg-surface-strong shadow-card" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs leading-6 text-muted">
        فایل‌ها کامل و بدون تکه‌تکه شدن در پوشه‌ی پروژه در GitHub شما ذخیره می‌شوند (پوشه‌هایی مثل node_modules، bin و obj خودکار کنار گذاشته می‌شوند). سپس برای هر فایل یک خلاصه‌ی کوتاه ساخته می‌شود تا ایجنت‌ها سریع فایل درست را
        پیدا کنند.
      </p>
      {source === "github" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-xs leading-6">
            <b>پروژه‌های Google AI Studio:</b> در AI Studio از منوی پروژه «Save to GitHub» را بزنید و نشانی همان مخزن را این‌جا وارد کنید؛ یا «Download» را بزنید و فایل zip را در زبانه‌ی «فایل zip» وارد کنید. مخزن‌های
            خصوصی هم با همان توکن GitHub شما خوانده می‌شوند.
          </div>
          <Field label="مخزن" required>
            <Input dir="ltr" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo یا https://github.com/owner/repo" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="شاخه / تگ (اختیاری)">
              <Input dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
            </Field>
            <Field label="فقط این پوشه از مخزن (اختیاری)">
              <Input dir="ltr" value={subdir} onChange={(e) => setSubdir(e.target.value)} placeholder="src" />
            </Field>
          </div>
        </div>
      ) : (
        <FileDropzone
          key={`${source}-${dropKey}`}
          userId={userId}
          onChange={uploads.onChange}
          folders={source === "folder"}
          label={source === "zip" ? "فایل zip پروژه را اینجا رها کنید" : source === "folder" ? "یک پوشه را انتخاب کنید (ساختار پوشه‌ها حفظ می‌شود)" : "فایل‌ها را اینجا رها کنید یا کلیک کنید"}
        />
      )}
      <Field label="پوشه‌ی مقصد داخل پروژه (اختیاری)" hint="خالی = ریشه‌ی پروژه">
        <Input dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="مثلاً docs" />
      </Field>
      <Button loading={busy} disabled={source === "github" ? !repo.trim() : !uploads.files.length || !!uploads.blocker} title={uploads.blocker ?? undefined} onClick={() => void submit()}>
        <Upload className="size-4" /> افزودن به پروژه
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------- knowledge
function KnowledgeTab({ projectId, meta, reload }: { projectId: string; meta: { knowledge: string | null } | null; reload: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  if (!meta) return <Spinner />;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 font-extrabold">
          <Brain className="size-4" /> فایل دانش پروژه (KNOWLEDGE.md)
        </p>
        <p className="w-full text-xs leading-6 text-muted sm:w-auto sm:flex-1">
          یک فایل واحد که بعد از هر کار روی پروژه خودکار به‌روز می‌شود: معماری، فایل‌های کلیدی، قراردادها، تصمیم‌ها و درس‌ها. ایجنت‌ها آن را قبل از کار می‌خوانند.
        </p>
        {!editing ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(meta.knowledge ?? "");
              setEditing(true);
            }}
          >
            <Pencil className="size-4" /> ویرایش
          </Button>
        ) : null}
      </div>
      {editing ? (
        <>
          <Textarea dir="auto" className="min-h-[55vh] font-mono text-[12.5px] leading-7" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await go(saveProjectFileAction(projectId, ".taskflow/KNOWLEDGE.md", draft), "دانش پروژه ذخیره شد");
                setBusy(false);
                if (ok !== null) {
                  setEditing(false);
                  reload();
                }
              }}
            >
              <Save className="size-4" /> ذخیره
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              انصراف
            </Button>
          </div>
        </>
      ) : meta.knowledge ? (
        <Markdown>{meta.knowledge}</Markdown>
      ) : (
        <p className="text-sm text-muted">هنوز دانشی ثبت نشده است.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- page
export function ProjectDetailClient({
  userId,
  project,
  files,
  tasks,
  jobs,
  defaults,
  initialFile,
  initialTab,
}: {
  userId: string;
  project: Pick<ProjectSummary, "id" | "name" | "slug" | "description" | "status" | "status_detail" | "file_count" | "total_size" | "knowledge_at" | "graph_at" | "updated_at">;
  files: ProjectFileRow[];
  tasks: Pick<Task, "id" | "code" | "title" | "status" | "updated_at" | "assignee_id">[];
  jobs: Pick<Job, "id" | "kind" | "status" | "error" | "created_at" | "finished_at" | "state">[];
  defaults: DispatchDefaults;
  initialFile: string | null;
  initialTab: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState(initialTab ?? (initialFile ? "files" : files.length ? "files" : "add"));
  const [open, setOpen] = React.useState<string | null>(initialFile);
  const [meta, setMeta] = React.useState<{ knowledge: string | null; hasGraph: boolean; folderUrl: string } | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [info, setInfo] = React.useState({ name: project.name, description: project.description });
  const [deleting, setDeleting] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running") || project.status === "importing" || project.status === "indexing";

  const loadMeta = React.useCallback(() => {
    void projectMetaAction(project.id).then((r) => setMeta(r.ok ? r.data : { knowledge: null, hasGraph: false, folderUrl: "" }));
  }, [project.id]);
  React.useEffect(() => loadMeta(), [loadMeta, project.knowledge_at]);

  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);

  return (
    <div className="space-y-5">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowRight className="size-4" /> پروژه‌ها
      </Link>

      <Card className="relative overflow-hidden p-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
            <FolderGit2 className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black">{project.name}</h1>
            <p className="ltr text-start font-mono text-xs text-muted">projects/{project.slug}</p>
            {project.description ? <p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted">{project.description}</p> : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge>{faNum(project.file_count)} فایل</Badge>
          <Badge>{formatBytes(project.total_size)}</Badge>
          {project.knowledge_at ? <Badge tone="success">دانش: {timeAgo(project.knowledge_at)}</Badge> : null}
          {project.graph_at ? <Badge tone="violet">گراف: {timeAgo(project.graph_at)}</Badge> : null}
          <ProjectStatus p={project} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {meta?.folderUrl ? (
            <a href={meta.folderUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary">
                <GitBranch className="size-4" /> GitHub <ExternalLink className="size-3.5" />
              </Button>
            </a>
          ) : null}
          <Link href={`/graph?project=${project.id}`}>
            <Button size="sm" variant="secondary">
              <Network className="size-4" /> گراف
            </Button>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "graph"}
            onClick={async () => {
              setBusy("graph");
              await go(buildProjectGraphAction(project.id), "ساخت گراف graphify در صف قرار گرفت");
              setBusy(null);
            }}
          >
            <Network className="size-4" /> ساخت گراف
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "reindex"}
            onClick={async () => {
              setBusy("reindex");
              const r = await go(reindexProjectAction(project.id));
              setBusy(null);
              if (r) toast.success(`همگام شد: ${faNum(r.added)} فایل جدید/تغییرکرده، ${faNum(r.removed)} حذف‌شده`);
            }}
          >
            <RefreshCw className="size-4" /> همگام‌سازی با GitHub
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> ویرایش
          </Button>
          <Button size="sm" variant="ghost" className="ms-auto text-danger" onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
        {jobs.length ? (
          <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs">
            {jobs.slice(0, 4).map((j) => (
              <p key={j.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={j.status === "done" ? "success" : j.status === "failed" ? "danger" : j.status === "running" ? "violet" : "info"} dot>
                  {JOB_LABEL[j.kind] ?? j.kind}
                </Badge>
                <span className="text-muted">{j.status === "running" ? (j.state?.live?.thought ?? "در حال اجرا…") : j.status === "queued" ? "در صف" : formatJalali(j.finished_at ?? j.created_at, { withTime: true })}</span>
                {j.error && j.status === "failed" ? <span className="text-danger">{j.error}</span> : null}
              </p>
            ))}
          </div>
        ) : null}
      </Card>

      <QuickCommand userId={userId} defaults={defaults} projectId={project.id} compact />

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: "files",
            label: `فایل‌ها (${faNum(files.length)})`,
            content: files.length ? (
              <FileBrowser projectId={project.id} files={files} open={open} setOpen={setOpen} />
            ) : (
              <Card>
                <EmptyState icon={<FileText className="size-7" />} title="هنوز فایلی نیست" description="از زبانه‌ی «افزودن فایل» فایل‌ها، پوشه، zip یا یک مخزن GitHub را وارد کنید." />
              </Card>
            ),
          },
          { value: "knowledge", label: "دانش پروژه", content: <KnowledgeTab projectId={project.id} meta={meta} reload={loadMeta} /> },
          { value: "add", label: "افزودن فایل", content: <AddFiles projectId={project.id} userId={userId} onQueued={() => router.refresh()} /> },
          {
            value: "tasks",
            label: `تسک‌ها (${faNum(tasks.length)})`,
            content: (
              <Card className="divide-y divide-line">
                {tasks.length ? (
                  tasks.map((t) => (
                    <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                      <span className="ltr w-16 text-xs font-bold text-muted">{t.code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.title}</span>
                      <StatusBadge status={t.status} />
                    </Link>
                  ))
                ) : (
                  <p className="p-5 text-sm text-muted">هنوز تسکی روی این پروژه انجام نشده است.</p>
                )}
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={editing}
        onOpenChange={setEditing}
        title="ویرایش پروژه"
        footer={
          <Button
            onClick={async () => {
              if ((await go(updateProjectAction(project.id, info), "ذخیره شد")) !== null) {
                setEditing(false);
                loadMeta();
              }
            }}
          >
            <Save className="size-4" /> ذخیره
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="نام">
            <Input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
          </Field>
          <Field label="توضیح" hint="در PROJECT.md پروژه هم ذخیره می‌شود و همه‌ی ایجنت‌ها آن را می‌بینند.">
            <Textarea className="min-h-32" value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title={`حذف پروژه‌ی «${project.name}»`}
        description="پوشه‌ی پروژه با همه‌ی فایل‌ها، دانش و گرافش از مخزن GitHub شما و از اپ حذف می‌شود. تسک‌ها باقی می‌مانند. این کار برگشت‌پذیر نیست (جز از تاریخچه‌ی git)."
        footer={
          <Button
            variant="danger"
            disabled={confirm.trim() !== project.slug}
            loading={busy === "delete"}
            onClick={async () => {
              setBusy("delete");
              const ok = await go(deleteProjectAction(project.id, confirm), "پروژه حذف شد");
              setBusy(null);
              if (ok !== null) router.push("/projects");
            }}
          >
            <Trash2 className="size-4" /> حذف همیشگی
          </Button>
        }
      >
        <Field label={`برای تایید، نام پوشه را بنویسید: ${project.slug}`}>
          <Input dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
