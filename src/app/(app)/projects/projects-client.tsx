"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Brain, ChevronLeft, FolderGit2, FolderPlus, Network, Search } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { PageHeader, SECTIONS } from "@/components/shell/page-header";
import { createProjectAction } from "@/app/actions/projects";
import { projectSlug } from "@/lib/projects/paths";
import { timeAgo } from "@/lib/jalali";
import { faNum, formatBytes } from "@/lib/utils";
import type { ProjectSummary } from "@/lib/types";

export function ProjectStatus({ p }: { p: Pick<ProjectSummary, "status" | "status_detail"> }) {
  if (p.status === "ready") return null;
  return (
    <Badge tone={p.status === "error" ? "danger" : "info"} dot>
      {p.status === "importing" ? "در حال افزودن فایل‌ها" : p.status === "indexing" ? "در حال خلاصه‌سازی" : "خطا"}
      {p.status_detail ? ` — ${p.status_detail}` : ""}
    </Badge>
  );
}

export function ProjectsClient({ github, projects }: { github: boolean; projects: ProjectSummary[] }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const busyProjects = projects.some((p) => p.status === "importing" || p.status === "indexing");

  // imports and summaries run in the background: refresh until they finish
  React.useEffect(() => {
    if (!busyProjects) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [busyProjects, router]);

  const list = projects.filter((p) => !q.trim() || `${p.name} ${p.slug} ${p.description}`.toLowerCase().includes(q.trim().toLowerCase()));

  if (!github) {
    return (
      <div className="space-y-5">
        <PageHeader title="پروژه‌ها" tabs={SECTIONS.projects} />
        <Card>
          <EmptyState
            icon={<FolderGit2 className="size-6" />}
            title="GitHub وصل نیست"
            description="پروژه‌ها در مخزن GitHub خودتان نگه داشته می‌شوند."
            action={
              <Link href="/settings#github">
                <Button>اتصال GitHub</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="پروژه‌ها"
        tabs={SECTIONS.projects}
        actions={
          <Button onClick={() => setCreating(true)}>
            <FolderPlus className="size-4" /> پروژه‌ی جدید
          </Button>
        }
      />

      {projects.length > 6 ? (
        <div className="relative max-w-sm">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو" aria-label="جستجو" className="pr-9" />
        </div>
      ) : null}

      {!projects.length ? (
        <Card>
          <EmptyState icon={<FolderGit2 className="size-6" />} title="هنوز پروژه‌ای ندارید" description="فایل، پوشه، zip یا مخزن GitHub" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="group flex h-full flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-pop">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    <FolderGit2 className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold">{p.name}</p>
                    <p className="ltr truncate text-start font-mono text-xs text-muted">projects/{p.slug}</p>
                  </div>
                  <ChevronLeft className="size-5 text-faint transition group-hover:-translate-x-1" />
                </div>
                {p.description ? <p className="mt-2 line-clamp-2 text-xs leading-6 text-muted">{p.description}</p> : null}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                  <Badge>{faNum(p.file_count)} فایل</Badge>
                  <Badge>{formatBytes(p.total_size)}</Badge>
                  {p.knowledge_at ? (
                    <Badge tone="success">
                      <Brain className="size-3" /> دانش
                    </Badge>
                  ) : null}
                  {p.graph_at ? (
                    <Badge tone="violet">
                      <Network className="size-3" /> گراف
                    </Badge>
                  ) : null}
                  <ProjectStatus p={p} />
                  <span className="ms-auto text-[11px] text-faint">{timeAgo(p.updated_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="پروژه‌ی جدید"
        footer={
          <Button
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              const r = await createProjectAction({ name, slug: slug || undefined, description: desc });
              setBusy(false);
              if (!r.ok) return toast.error(r.error);
              toast.success("پروژه ساخته شد");
              setCreating(false);
              router.push(`/projects/${r.data.id}?add=1`);
            }}
          >
            <FolderPlus className="size-4" /> ساخت پروژه
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="نام پروژه" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً Renew" />
          </Field>
          <Field label="نام پوشه (لاتین)" hint={`خالی = ${name ? projectSlug(name) : "از روی نام"}`}>
            <Input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder={name ? projectSlug(name) : "renew"} />
          </Field>
          <Field label="توضیح پروژه" hint="به همه‌ی ایجنت‌ها داده می‌شود">
            <Textarea className="min-h-28" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
