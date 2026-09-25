"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpenText, Download, ExternalLink, Minus, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { Markdown } from "@/components/ui/markdown";
import { addKnowledgeAction, deleteKnowledgeAction, rateKnowledgeAction, searchKnowledgeAction } from "@/app/actions/admin";
import { timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { KnowledgeRow } from "@/lib/types";

const KINDS: Record<string, string> = {
  snippet: "قطعه‌کد",
  workflow: "ورکفلو",
  lesson: "درس آموخته",
  dead_end: "بن‌بست",
  prompt: "پرامپت موفق",
  decision: "تصمیم فنی",
  reference: "مرجع",
  requester_profile: "تسک‌دهنده",
  document: "سند",
};

interface Hit {
  id: string;
  title: string;
  kind: string;
  content: string;
  similarity?: number;
  task_code?: string;
  use_count?: number;
  score?: number;
  created_at?: string;
}

function toHit(r: KnowledgeRow): Hit {
  return { id: r.id, title: r.metadata.title ?? "—", kind: r.metadata.kind ?? "document", content: r.content, task_code: r.metadata.task_code, use_count: r.use_count, score: r.score, created_at: r.created_at };
}

export function KnowledgeClient({ initial, total, repoUrl }: { initial: KnowledgeRow[]; total: number; repoUrl: string | null }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [hits, setHits] = React.useState<Hit[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ kind: "lesson", title: "", content: "", tags: "" });

  const list: Hit[] = hits ?? initial.map(toHit).filter((h) => !kind || h.kind === kind);
  const counts = initial.reduce<Record<string, number>>((acc, r) => {
    const k = r.metadata.kind ?? "document";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const search = async () => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    setBusy(true);
    const r = await searchKnowledgeAction(q, kind || undefined);
    setBusy(false);
    if (r.ok) setHits(r.data);
    else toast.error(r.error);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">پایگاه دانش</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            RAG پیشرفته (pgvector + جستجوی ترکیبی معنایی و کلیدواژه) — ایجنت‌های Gemini و Claude قبل از هر کاری اینجا جستجو می‌کنند. {faNum(total)} قطعه‌ی دانش.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> افزودن دانش
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="جستجوی معنایی… مثلاً «اتصال به وب‌سرویس بانک با احراز هویت دوطرفه»"
              className="pr-9"
            />
          </div>
          <Button onClick={search} loading={busy}>
            <Sparkles className="size-4" /> جستجو
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => setKind("")} className={cn("rounded-full px-3 py-1 text-xs font-semibold", !kind ? "bg-primary text-white" : "bg-surface-muted text-muted")}>
            همه
          </button>
          {Object.entries(KINDS).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", kind === k ? "bg-primary text-white" : "bg-surface-muted text-muted")}>
              {label} {counts[k] ? `(${faNum(counts[k])})` : ""}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          {hits ? <p className="text-xs text-muted">{faNum(hits.length)} نتیجه برای «{q}»</p> : null}
          {list.length === 0 ? <EmptyState icon={<BookOpenText className="size-7" />} title="موردی یافت نشد" description="دانش به صورت خودکار پس از هر پیش‌کار و کار اصلی استخراج می‌شود." /> : null}
          {list.map((h) => (
            <Card key={h.id} className="p-4">
              <button className="flex w-full items-start gap-3 text-start" onClick={() => setOpen(open === h.id ? null : h.id)}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="violet">{KINDS[h.kind] ?? h.kind}</Badge>
                    {h.task_code ? <span className="ltr text-[11px] text-muted">{h.task_code}</span> : null}
                    {h.similarity !== undefined ? <span className="text-[11px] text-muted">شباهت {faNum(h.similarity.toFixed(2))}</span> : null}
                    {h.use_count ? <span className="text-[11px] text-muted">{faNum(h.use_count)} بار استفاده</span> : null}
                    {h.created_at ? <span className="text-[11px] text-faint">{timeAgo(h.created_at)}</span> : null}
                  </div>
                  <p className="mt-1.5 font-bold">{h.title}</p>
                  {open !== h.id ? <p className="mt-1 line-clamp-2 text-xs text-muted">{h.content.slice(0, 300)}</p> : null}
                </div>
              </button>
              {open === h.id ? (
                <div className="mt-3 border-t border-line pt-3">
                  <Markdown>{h.content}</Markdown>
                  <div className="mt-3 flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={async () => { await rateKnowledgeAction(h.id, 1); toast.success("امتیاز افزایش یافت"); }}>
                      <Plus className="size-4" /> مفید
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await rateKnowledgeAction(h.id, -1); toast.success("امتیاز کاهش یافت"); }}>
                      <Minus className="size-4" /> کم‌ارزش
                    </Button>
                    <Button size="sm" variant="ghost" className="ms-auto text-danger" onClick={async () => {
                      const r = await deleteKnowledgeAction([h.id]);
                      if (r.ok) {
                        toast.success("حذف شد");
                        setHits((s) => s?.filter((x) => x.id !== h.id) ?? null);
                        router.refresh();
                      }
                    }}>
                      <Trash2 className="size-4" /> حذف
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="همگام‌سازی با NotebookLM" icon={<BookOpenText className="size-4" />} />
            <div className="space-y-3 p-5 text-sm leading-7 text-muted">
              <p>
                NotebookLM نسخه‌ی عمومی API ندارد؛ برای همین دانش هر روز به صورت چند فایل Markdown تجمیعی (یک فایل برای هر نوع) در مخزن GitHub ساخته می‌شود و می‌توانید آن را به‌عنوان «منبع» به نوت‌بوک اضافه کنید.
              </p>
              <a href="/api/knowledge/export">
                <Button className="w-full" variant="secondary">
                  <Download className="size-4" /> دانلود بسته‌ی NotebookLM (zip)
                </Button>
              </a>
              {repoUrl ? (
                <a href={repoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-primary">
                  پوشه‌ی knowledge در GitHub <ExternalLink className="size-3" />
                </a>
              ) : null}
              <ol className="list-decimal space-y-1 ps-5 text-xs">
                <li>notebooklm.google.com را باز کنید و یک نوت‌بوک «TaskFlow Knowledge» بسازید.</li>
                <li>Add source ← Upload ← فایل‌های داخل zip را انتخاب کنید.</li>
                <li>هفته‌ای یک بار فایل‌ها را جایگزین کنید (یا فقط فایل‌های تغییرکرده را).</li>
              </ol>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={adding}
        onOpenChange={setAdding}
        title="افزودن دانش دستی"
        description="مثلاً نکته‌ای درباره‌ی نحوه‌ی کار با یک تسک‌دهنده، یک قطعه‌کد پرکاربرد یا تجربه‌ای که نباید تکرار شود."
        footer={
          <Button
            onClick={async () => {
              const r = await addKnowledgeAction({ kind: form.kind, title: form.title, content: form.content, tags: form.tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean) });
              if (r.ok) {
                toast.success("به پایگاه دانش اضافه شد");
                setAdding(false);
                setForm({ kind: "lesson", title: "", content: "", tags: "" });
                router.refresh();
              } else toast.error(r.error);
            }}
          >
            ذخیره
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="نوع">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KINDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="عنوان" required>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="محتوا (Markdown)" required>
            <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="min-h-48" />
          </Field>
          <Field label="برچسب‌ها" hint="با کاما جدا کنید">
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
