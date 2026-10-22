"use client";

import { useState } from "react";
import { deleteDemo, reorderDemos, upsertDemo } from "@/app/actions/admin";
import type { DemoLink } from "@/lib/demos";
import { Button, Input, Label, Spinner, Textarea } from "@/components/ui/field";
import { Empty, Panel, Toggle } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { Icon } from "@/components/site/icons";

type Draft = Omit<DemoLink, "id"> & { id?: string };

const blank = (sort: number): Draft => ({ title_fa: "", title_en: "", description_fa: "", description_en: "", url: "https://", tag: "", enabled: true, sort });

export function DemosManager({ rows }: { rows: DemoLink[] }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const { pending, run } = useAction();
  const move = (i: number, d: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorderDemos(ids), { silent: true });
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        <Button onClick={() => setEditing(blank((rows.length + 1) * 10))}>+ دموی تازه</Button>
        {rows.length === 0 ? (
          <Empty>هنوز دمویی اضافه نشده است. تا وقتی فهرست خالی است، در سایت «به‌زودی» نمایش داده می‌شود.</Empty>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r, i) => (
              <li key={r.id} className={`card flex items-center gap-3 p-4 ${r.enabled ? "" : "opacity-60"}`}>
                <div className="flex flex-col">
                  <button type="button" aria-label="بالا" disabled={pending || i === 0} onClick={() => move(i, -1)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-white/5 disabled:opacity-30">
                    ▲
                  </button>
                  <button type="button" aria-label="پایین" disabled={pending || i === rows.length - 1} onClick={() => move(i, 1)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-white/5 disabled:opacity-30">
                    ▼
                  </button>
                </div>
                <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 text-start">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-bold">{r.title_fa}</span>
                    {r.tag && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-violet">{r.tag}</span>}
                    {!r.enabled && <span className="text-[11px] text-faint">(پنهان)</span>}
                  </span>
                  <span className="ltr mt-0.5 block truncate text-start text-xs text-faint">{r.url}</span>
                </button>
                <a href={r.url} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-full border border-line text-muted hover:text-fg" aria-label="باز کردن">
                  <Icon name="external" className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <Panel title={editing.id ? "ویرایش دمو" : "دموی تازه"} className="xl:sticky xl:top-8 xl:self-start">
          <DemoEditor key={editing.id ?? "new"} draft={editing} onDone={() => setEditing(null)} />
        </Panel>
      )}
    </div>
  );
}

function DemoEditor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [d, setD] = useState(draft);
  const { pending, run } = useAction();
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <div>
        <Label>عنوان (فارسی)</Label>
        <Input value={d.title_fa} onChange={set("title_fa")} />
      </div>
      <div>
        <Label>Title (English)</Label>
        <Input value={d.title_en} onChange={set("title_en")} dir="ltr" />
      </div>
      <div>
        <Label>آدرس دمو</Label>
        <Input value={d.url} onChange={set("url")} dir="ltr" placeholder="https://demo.example.com" />
      </div>
      <div>
        <Label hint="مثلاً EPM یا AI">برچسب</Label>
        <Input value={d.tag} onChange={set("tag")} />
      </div>
      <div>
        <Label>توضیح کوتاه (فارسی)</Label>
        <Textarea value={d.description_fa} onChange={set("description_fa")} rows={2} />
      </div>
      <div>
        <Label>Description (English)</Label>
        <Textarea value={d.description_en} onChange={set("description_en")} rows={2} dir="ltr" />
      </div>
      <Toggle checked={d.enabled} onChange={(v) => setD({ ...d, enabled: v })} label="نمایش در سایت" />
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button disabled={pending} onClick={() => run(() => upsertDemo(d), { onOk: onDone })}>
            {pending && <Spinner />}
            ذخیره
          </Button>
          <Button variant="soft" onClick={onDone}>
            انصراف
          </Button>
        </div>
        {d.id && (
          <Button variant="ghost" className="!text-danger" disabled={pending} onClick={() => confirm("این دمو حذف شود؟") && run(() => deleteDemo(d.id!), { onOk: onDone })}>
            حذف
          </Button>
        )}
      </div>
    </div>
  );
}
