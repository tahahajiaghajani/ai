"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminDeleteMedia, adminMediaUsage } from "@/app/actions/admin-catalog";
import type { Media } from "@/lib/media";
import { num } from "@/lib/format";
import { Badge, ConfirmButton, Empty, Input, Spinner } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { ImageDropzone } from "@/components/admin/image-dropzone";
import { MediaEditDialog } from "@/components/admin/media-edit";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";

/** Admin → تصاویر سایت → کتابخانه: every uploaded (or adopted built-in) picture, with alt texts, focal point and usage. */

const isStarter = (m: Media) => m.src.startsWith("/media/seed/");

export function MediaLibrary({ items }: { items: Media[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // pictures uploaded on this page, shown at once (the list refreshes from the server after the batch)
  const [fresh, setFresh] = useState<Media[]>([]);
  const [gone, setGone] = useState<string[]>([]);
  const all = useMemo(() => {
    const ids = new Set(items.map((m) => m.id));
    return [...fresh.filter((m) => !ids.has(m.id)), ...items].filter((m) => !gone.includes(m.id ?? ""));
  }, [items, fresh, gone]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((m) => `${m.alt_fa ?? ""} ${m.alt_en ?? ""}`.toLowerCase().includes(s)) : all;
  }, [all, q]);
  const current = open ? all.find((m) => m.id === open) ?? null : null;
  const del = useAction();

  return (
    <div className="space-y-5">
      <ImageDropzone
        multiple
        onUploaded={(m) => setFresh((xs) => [m, ...xs])}
        onFinished={(done) => done.length && router.refresh()}
        hint="عکس‌های تازه را اینجا بارگذاری کنید و بعد در محصولات، دسته‌ها یا تصاویر سایت از «انتخاب از کتابخانه» استفاده کنید."
      />
      {all.length === 0 ? (
        <Empty title="کتابخانه خالی است">عکس‌هایی که بارگذاری می‌کنید، و تصویرهای نمونه‌ای که در جایی ویرایش شوند، اینجا جمع می‌شوند.</Empty>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-80">
              <Icon name="search" className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در توضیح تصویرها" className="ps-9" aria-label="جستجو" />
            </div>
            <span className="text-xs text-muted">{q ? `${num(shown.length, "fa")} از ${num(all.length, "fa")} تصویر` : `${num(all.length, "fa")} تصویر`}</span>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {shown.map((m) => (
              <li key={m.id} data-media={m.id}>
                <button type="button" onClick={() => setOpen(m.id ?? null)} className="group block w-full border border-line bg-white text-start transition-colors hover:border-ink">
                  <div className="relative">
                    <Picture media={m} ratio="3/4" sizes="(min-width: 1280px) 170px, (min-width: 768px) 24vw, 45vw" alt="" />
                    {isStarter(m) && (
                      <span className="absolute start-1.5 top-1.5">
                        <Badge className="bg-white/90">نمونه</Badge>
                      </span>
                    )}
                  </div>
                  <span className={`block truncate px-2 py-1.5 text-[11px] ${m.alt_fa || m.alt_en ? "text-ink-2" : "text-faint"}`}>{m.alt_fa || m.alt_en || "بدون توضیح"}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <MediaEditDialog media={current} open={Boolean(current)} onClose={() => setOpen(null)} onSaved={(m) => setFresh((xs) => [m, ...xs.filter((x) => x.id !== m.id)])}>
        {current?.id && (
          <div className="space-y-3 border-t border-line pt-4">
            <Usage id={current.id} />
            <div className="flex flex-wrap items-center gap-3">
              <ConfirmButton
                size="md"
                pending={del.pending}
                confirmLabel="حذف همیشگی؟ دوباره بزنید"
                onConfirm={() =>
                  del.run(() => adminDeleteMedia({ id: current.id }), {
                    onOk: () => {
                      setGone((g) => [...g, current.id!]);
                      setOpen(null);
                    },
                  })
                }
              >
                حذف از کتابخانه
              </ConfirmButton>
              <span className="text-xs leading-5 text-muted">{isStarter(current) ? "تصویر نمونه فقط از کتابخانه برداشته می‌شود." : "فقط تصویری که جایی استفاده نشده حذف می‌شود."}</span>
            </div>
          </div>
        )}
      </MediaEditDialog>
    </div>
  );
}

function Usage({ id }: { id: string }) {
  const [usage, setUsage] = useState<string[] | null>(null);
  const { run } = useAction();
  useEffect(() => {
    run(() => adminMediaUsage({ id }), { silent: true, onOk: (r) => setUsage(r.usage), onError: () => setUsage([]) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-ink-2">کجا استفاده شده</div>
      {usage === null ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Spinner className="size-3.5" /> در حال بررسی…
        </div>
      ) : usage.length === 0 ? (
        <p className="text-xs text-muted">جایی استفاده نشده است.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {usage.map((u) => (
            <li key={u}>
              <Badge tone="gold">{u}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
