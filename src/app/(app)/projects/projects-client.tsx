"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Brain, ChevronLeft, FolderGit2, FolderPlus, Network, Search } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { QuickCommand } from "@/components/tasks/quick-command";
import { createProjectAction } from "@/app/actions/projects";
import { projectSlug } from "@/lib/projects/paths";
import { timeAgo } from "@/lib/jalali";
import { faNum, formatBytes } from "@/lib/utils";
import type { DispatchDefaults } from "@/lib/settings";
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

export function ProjectsClient({ userId, github, projects, defaults }: { userId: string; github: boolean; projects: ProjectSummary[]; defaults: DispatchDefaults }) {
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
      <Card>
        <EmptyState
          icon={<FolderGit2 className="size-7" />}
          title="پروژه‌ها در GitHub خودتان نگه داشته می‌شوند"
          description="برای ساخت پروژه، افزودن فایل‌های کد و سند، دانش پروژه و گراف، ابتدا GitHub را در تنظیمات وصل کنید. پیش‌کار و کار اصلی بدون GitHub هم کار می‌کنند."
          action={
            <Link href="/settings">
              <Button>تنظیمات و اتصال‌ها</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">پروژه‌ها و دانش</h1>
          <p className="mt-1 max-w-3xl text-sm leading-7 text-muted">
            هر پروژه یک پوشه در مخزن GitHub شماست: فایل‌های کد و سند کامل و بدون تکه‌تکه شدن، یک فایل دانش که بعد از هر کار به‌روز می‌شود و نقشه‌ی فایل‌ها. در «دستور سریع» یا هنگام ارسال تسک، پروژه را انتخاب کنید
            تا مجری فایل‌های درست را پیدا، ویرایش یا ایجاد کند.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <FolderPlus className="size-4" /> پروژه‌ی جدید
        </Button>
      </div>

      {projects.length ? <QuickCommand userId={userId} defaults={defaults} compact /> : null}

      {projects.length > 6 ? (
        <div className="relative max-w-sm">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی پروژه…" className="pr-9" />
        </div>
      ) : null}

      {!projects.length ? (
        <Card>
          <EmptyState
            icon={<FolderGit2 className="size-7" />}
            title="هنوز پروژه‌ای ندارید"
            description="یک پروژه بسازید و فایل‌ها، پوشه، فایل zip یا یک مخزن GitHub (مثلاً اپ ذخیره‌شده از Google AI Studio) را واردش کنید."
            action={
              <Button onClick={() => setCreating(true)}>
                <FolderPlus className="size-4" /> ساخت اولین پروژه
              </Button>
            }
          />
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
        description="پوشه‌ی پروژه در مخزن GitHub شما ساخته می‌شود؛ بعد از ساخت، فایل‌ها را اضافه کنید."
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
          <Field label="نام پوشه (لاتین)" hint={`خالی = ${name ? projectSlug(name) : "از روی نام"}؛ در دستورها می‌توانید با همین نام به پروژه اشاره کنید.`}>
            <Input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder={name ? projectSlug(name) : "renew"} />
          </Field>
          <Field label="توضیح پروژه" hint="هدف، فناوری‌ها و نکات مهم؛ به همه‌ی ایجنت‌ها داده می‌شود.">
            <Textarea className="min-h-28" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
