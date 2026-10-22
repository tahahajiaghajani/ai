"use client";

import { useMemo, useState } from "react";
import { askAssistant, deleteKnowledge, importKnowledge, upsertKnowledge } from "@/app/actions/admin";
import { Markdown } from "@/components/chat/markdown";
import { Button, Field, Input, Spinner, Textarea } from "@/components/ui/field";
import { Empty, Panel, Toggle } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";

interface Row {
  id?: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  enabled: boolean;
  sort: number;
  updated_at?: string;
}

const BUDGET = 28000;
const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

export function KnowledgeManager({ rows, defaultsCount, prefill }: { rows: Row[]; defaultsCount: number; prefill: { title: string; body: string } | null }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Row | null>(prefill ? { title: prefill.title, body: prefill.body, tags: [], pinned: false, enabled: true, sort: (rows.length + 1) * 10 } : null);
  const { pending, run } = useAction();
  const total = rows.filter((r) => r.enabled).reduce((s, r) => s + r.title.length + r.body.length + 6, 0);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? rows.filter((r) => `${r.title} ${r.body} ${r.tags.join(" ")}`.toLowerCase().includes(term)) : rows;
  }, [rows, q]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows.map(({ title, body, tags, pinned, enabled, sort }) => ({ title, body, tags, pinned, enabled, sort })), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pars-knowledge-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setEditing({ title: "", body: "", tags: [], pinned: false, enabled: true, sort: (rows.length + 1) * 10 })}>+ مدخل تازه</Button>
          <Button variant="soft" onClick={exportJson} disabled={!rows.length}>
            خروجی JSON
          </Button>
          <label className="inline-flex h-12 cursor-pointer items-center rounded-full bg-white/[0.06] px-6 text-[15px] font-semibold hover:bg-white/10">
            ورود JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const json = await file.text();
                const replace = confirm("مدخل‌های فعلی جایگزین شوند؟ (لغو = افزودن به فهرست فعلی)");
                run(() => importKnowledge({ mode: "json", json, replace }));
              }}
            />
          </label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در دانش…" aria-label="جستجو در دانش" className="h-12 min-w-48 flex-1 rounded-full border border-line bg-ink-2 px-4 text-sm outline-none focus:border-violet/60" />
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              حجم دانش فعال: {fa(total)} نویسه {total > BUDGET ? "— دستیار برای هر پرسش، مرتبط‌ترین مدخل‌ها را برمی‌گزیند (RAG)" : "— کل دانش در هر پاسخ در نظر گرفته می‌شود"}
            </span>
            <span>{fa(rows.length)} مدخل</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-reverse" style={{ width: `${Math.min(100, (total / BUDGET) * 100)}%` }} />
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty>
            <p>هنوز دانشی در پایگاه داده نیست؛ دستیار فعلاً از دانش اولیه ({fa(defaultsCount)} مدخل) استفاده می‌کند.</p>
            <Button className="mt-5" disabled={pending} onClick={() => run(() => importKnowledge({ mode: "defaults" }))}>
              {pending && <Spinner />}
              بارگذاری دانش اولیه برای ویرایش
            </Button>
          </Empty>
        ) : (
          <ul className="grid gap-3">
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setEditing(r)} className="card block w-full p-5 text-start transition hover:border-line-strong">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{r.title}</span>
                    {r.pinned && <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[11px] text-violet">همیشه ارسال می‌شود</span>}
                    {!r.enabled && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-muted">غیرفعال</span>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-7 text-muted">{r.body}</p>
                  {r.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-faint">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-6 xl:sticky xl:top-8 xl:self-start">
        {editing ? <Editor key={editing.id ?? "new"} row={editing} onClose={() => setEditing(null)} /> : <Playground />}
      </div>
    </div>
  );
}

function Editor({ row, onClose }: { row: Row; onClose: () => void }) {
  const [r, setR] = useState(row);
  const [tags, setTags] = useState(row.tags.join("، "));
  const { pending, run } = useAction();
  return (
    <Panel title={row.id ? "ویرایش مدخل" : "مدخل تازه"} sub="جمله‌های کوتاه و دقیق بنویسید؛ عدد، نام و تاریخ فقط اگر قطعی است.">
      <div className="space-y-4">
        <Field label="عنوان">
          <Input value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} maxLength={200} />
        </Field>
        <Field label="متن" hint={`${fa(r.body.length)} نویسه`}>
          <Textarea value={r.body} onChange={(e) => setR({ ...r, body: e.target.value })} rows={12} dir="auto" />
        </Field>
        <Field label="کلیدواژه‌ها" hint="با ویرگول جدا کنید">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="EPM، بانک، مهاجرت" />
        </Field>
        <Toggle checked={r.pinned} onChange={(v) => setR({ ...r, pinned: v })} label="همیشه به دستیار داده شود" hint="برای معرفی، تماس و قواعد مهم." />
        <Toggle checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} label="فعال" />
        <Field label="ترتیب" hint="عدد کوچک‌تر = بالاتر">
          <Input type="number" value={r.sort} onChange={(e) => setR({ ...r, sort: Number(e.target.value) })} dir="ltr" />
        </Field>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <div className="flex gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                run(() => upsertKnowledge({ ...r, tags: tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean) }), {
                  onOk: () => onClose(),
                })
              }
            >
              {pending && <Spinner />}
              ذخیره
            </Button>
            <Button variant="soft" onClick={onClose}>
              انصراف
            </Button>
          </div>
          {row.id && (
            <Button
              variant="ghost"
              className="!text-danger"
              disabled={pending}
              onClick={() => {
                if (confirm("این مدخل حذف شود؟")) run(() => deleteKnowledge(row.id!), { onOk: onClose });
              }}
            >
              حذف
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Playground() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ answer: string; model: string; used: string[] } | null>(null);
  const { pending, run } = useAction();
  return (
    <Panel title="آزمایش دستیار" sub="پرسشی بپرسید تا ببینید دستیار با دانش فعلی چه پاسخی می‌دهد و از کدام مدخل‌ها استفاده می‌کند.">
      <Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} placeholder="مثلاً: آیا دوره‌ی Primavera دارید؟" aria-label="پرسش آزمایشی" />
      <Button className="mt-3 w-full" disabled={pending || !q.trim()} onClick={() => run(() => askAssistant(q), { silent: true, onOk: (r) => setRes({ answer: r.answer, model: r.model, used: r.used }) })}>
        {pending && <Spinner />}
        بپرس
      </Button>
      {res && (
        <div className="mt-5 space-y-3">
          <div className="rounded-2xl bg-ink-4/70 p-4 text-sm">
            <Markdown text={res.answer} />
          </div>
          <p className="text-xs leading-6 text-faint">
            مدل: <span className="ltr">{res.model}</span> · مدخل‌های ارسال‌شده: {res.used.join("، ")}
          </p>
        </div>
      )}
    </Panel>
  );
}
