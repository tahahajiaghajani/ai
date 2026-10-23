"use client";

import { useEffect, useMemo, useState } from "react";
import { adminListMedia } from "@/app/actions/admin-catalog";
import { Badge, Button, Dialog, Input, Spinner } from "@/components/admin/ui";
import { ImageDropzone } from "@/components/admin/image-dropzone";
import { useAction } from "@/components/admin/toast";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";

/**
 * Chooses pictures from the library (newest first) or uploads new ones on the spot. Search looks in the alt
 * texts. With `multiple` several can be picked at once (in the order they were clicked).
 */
export function MediaPicker({
  open,
  onClose,
  onPick,
  multiple = false,
  title,
  exclude = [],
  alt,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (items: Media[]) => void;
  multiple?: boolean;
  title?: string;
  /** ids already in place (shown as «افزوده شده», not selectable) */
  exclude?: string[];
  /** alt texts for pictures uploaded from the picker */
  alt?: { fa?: string; en?: string };
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title ?? (multiple ? "افزودن از کتابخانه" : "انتخاب از کتابخانه")} wide>
      <PickerBody onClose={onClose} onPick={onPick} multiple={multiple} exclude={exclude} alt={alt} />
    </Dialog>
  );
}

function PickerBody({ onClose, onPick, multiple, exclude, alt }: { onClose: () => void; onPick: (items: Media[]) => void; multiple: boolean; exclude: string[]; alt?: { fa?: string; en?: string } }) {
  const [items, setItems] = useState<Media[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const { run } = useAction();

  useEffect(() => {
    run(() => adminListMedia(), { silent: true, onOk: (r) => setItems(r.items), onError: () => setItems([]) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!items) return [];
    if (!s) return items;
    return items.filter((m) => `${m.alt_fa ?? ""} ${m.alt_en ?? ""}`.toLowerCase().includes(s));
  }, [items, q]);

  const byId = useMemo(() => new Map((items ?? []).map((m) => [m.id ?? "", m])), [items]);
  const skip = new Set(exclude);

  const toggle = (id: string) => setSel((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : multiple ? [...xs, id] : [id]));
  const confirm = (ids = sel) => {
    const picked = ids.map((id) => byId.get(id)).filter((m): m is Media => Boolean(m));
    if (!picked.length) return;
    onPick(picked);
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="relative flex-1">
          <Icon name="search" className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در توضیح تصویرها" className="ps-9" type="search" />
        </div>
        <ImageDropzone
          compact
          multiple={multiple}
          alt={alt}
          label="بارگذاری از دستگاه"
          onUploaded={(m) => {
            if (!m.id) return;
            setItems((xs) => [m, ...(xs ?? [])]);
            setSel((xs) => (multiple ? [...xs, m.id!] : [m.id!]));
          }}
        />
      </div>

      {items === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Spinner /> در حال خواندن کتابخانه…
        </div>
      ) : shown.length === 0 ? (
        <div className="border border-dashed border-line-strong px-4 py-12 text-center text-sm text-muted">{items.length ? "تصویری با این توضیح پیدا نشد." : "کتابخانه هنوز خالی است؛ یک عکس بارگذاری کنید."}</div>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5">
          {shown.map((m) => {
            const id = m.id ?? "";
            const taken = skip.has(id);
            const order = sel.indexOf(id);
            const on = order >= 0;
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={taken}
                  onClick={() => toggle(id)}
                  onDoubleClick={() => !multiple && confirm([id])}
                  aria-pressed={on}
                  title={m.alt_fa || m.alt_en || undefined}
                  className={`group relative block w-full border text-start transition-colors disabled:cursor-not-allowed ${on ? "border-gold outline outline-1 outline-gold" : "border-line hover:border-ink"}`}
                >
                  <Picture media={m} ratio="3/4" sizes="160px" alt="" className={taken ? "opacity-40" : ""} />
                  {on && (
                    <span className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-gold text-[11px] font-medium text-white">
                      {multiple ? num(order + 1, "fa") : <Icon name="check" className="size-3.5" />}
                    </span>
                  )}
                  {taken && (
                    <span className="absolute inset-x-1.5 bottom-1.5">
                      <Badge>افزوده شده</Badge>
                    </span>
                  )}
                </button>
                <p className="mt-1 truncate text-[11px] text-muted">{m.alt_fa || m.alt_en || "بدون توضیح"}</p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex items-center justify-between gap-3 border-t border-line bg-white px-5 py-3">
        <span className="text-xs text-muted">{sel.length ? `${num(sel.length, "fa")} تصویر انتخاب شد` : multiple ? "روی تصویرها بزنید تا انتخاب شوند" : "روی یک تصویر بزنید"}</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => confirm()} disabled={!sel.length} icon="check">
            {multiple && sel.length > 1 ? `افزودن ${num(sel.length, "fa")} تصویر` : "انتخاب"}
          </Button>
        </div>
      </div>
    </div>
  );
}
