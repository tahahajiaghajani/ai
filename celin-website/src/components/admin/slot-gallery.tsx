"use client";

import { useState, type DragEvent } from "react";
import { Badge, Button, Spinner } from "@/components/admin/ui";
import { ImageDropzone } from "@/components/admin/image-dropzone";
import { Icon, type IconName } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";

/** a tile's identity: the library id, or the folder of a built-in picture that was never copied into the library */
export const galleryKey = (m: Media) => m.id ?? m.src;

/**
 * The ordered pictures of a gallery slot (the home page's turning «سرآغاز»): the first opens in the centre arch.
 * Reorder by dragging (desktop) or with the arrow buttons (touch, keyboard); add by uploading here or from the
 * library; a tile opens the picture's alt text and focal point. Removing only takes a picture off this list (the
 * file stays in the library). The picker and the picture dialog live beside the sheet (SlotsBoard), so this calls
 * `onLibrary` / `onEdit`.
 */
export function SlotGallery({
  items,
  min,
  max,
  onChange,
  onLibrary,
  onEdit,
  editing,
}: {
  items: Media[];
  min: number;
  max: number;
  onChange: (fn: (prev: Media[]) => Media[]) => void;
  onLibrary: () => void;
  onEdit: (index: number) => void;
  /** index of the tile being opened (a built-in picture is first copied into the library) */
  editing?: number | null;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const move = (from: number, to: number) =>
    onChange((xs) => {
      if (from === to || from < 0 || to < 0 || from >= xs.length || to >= xs.length) return xs;
      const next = [...xs];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  const remove = (i: number) => onChange((xs) => (xs.length <= min ? xs : xs.filter((_, j) => j !== i)));
  const add = (m: Media) => onChange((xs) => (xs.length >= max || xs.some((x) => galleryKey(x) === galleryKey(m)) ? xs : [...xs, m]));

  const dragProps = (i: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDrag(i);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    },
    onDragOver: (e: DragEvent) => {
      if (drag === null) return;
      e.preventDefault();
      setOver(i);
    },
    onDrop: (e: DragEvent) => {
      if (drag === null) return;
      e.preventDefault();
      move(drag, i);
      setDrag(null);
      setOver(null);
    },
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
  });

  const full = items.length >= max;
  return (
    <div className="space-y-3" data-slot-gallery>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-medium">تصاویر چرخان</div>
        <div className="text-xs text-muted">
          {num(items.length, "fa")} تصویر · حداقل {num(min, "fa")}، حداکثر {num(max, "fa")}
        </div>
      </div>
      <p className="text-xs leading-6 text-muted">تصویر اول هنگام باز شدن صفحه در طاق وسط است، دومی در طاق چپ و آخری در طاق راست؛ سپس تصویرها به‌ترتیب از چپ به وسط می‌آیند.</p>
      <ul className="grid grid-cols-3 gap-2.5">
        {items.map((m, i) => (
          <li
            key={galleryKey(m)}
            {...dragProps(i)}
            data-gallery-tile
            className={`bg-white transition-opacity ${drag === i ? "opacity-40" : ""} ${over === i && drag !== i ? "outline outline-1 outline-offset-2 outline-gold" : ""}`}
          >
            <div className="relative border border-line">
              <button type="button" onClick={() => onEdit(i)} className="block w-full cursor-grab active:cursor-grabbing" aria-label={`توضیح و نقطه‌ی کانونی تصویر ${num(i + 1, "fa")}`}>
                <Picture media={m} ratio="3/4" sizes="160px" alt="" />
              </button>
              <span className="pointer-events-none absolute start-1.5 top-1.5">{i === 0 ? <Badge tone="ink">وسط</Badge> : <Badge className="bg-white/90">{num(i + 1, "fa")}</Badge>}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={items.length <= min}
                className="absolute end-1 top-1 grid size-8 place-items-center bg-white/90 text-ink-2 hover:text-danger disabled:text-faint disabled:hover:text-faint"
                aria-label={`برداشتن تصویر ${num(i + 1, "fa")} از سرآغاز`}
                title={items.length <= min ? `حداقل ${num(min, "fa")} تصویر` : "برداشتن از سرآغاز (فایل در کتابخانه می‌ماند)"}
              >
                <Icon name="close" className="size-4" />
              </button>
              {editing === i && (
                <span className="absolute inset-0 grid place-items-center bg-white/60 text-ink">
                  <Spinner className="size-5" />
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 border-x border-b border-line">
              <TileButton icon="chevron" label="جابه‌جایی به قبل" disabled={i === 0} onClick={() => move(i, i - 1)} />
              <TileButton icon="chevron" flip label="جابه‌جایی به بعد" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} />
              <TileButton icon="edit" label="توضیح و نقطه‌ی کانونی" onClick={() => onEdit(i)} />
            </div>
            {i === 0 ? (
              <div className="grid h-9 place-items-center border-x border-b border-line bg-ground text-xs text-muted">تصویر اول</div>
            ) : (
              <button type="button" onClick={() => move(i, 0)} className="h-9 w-full border-x border-b border-line text-xs text-ink-2 transition-colors hover:bg-bone hover:text-ink">
                اول شود
              </button>
            )}
          </li>
        ))}
      </ul>
      {full ? (
        <p className="text-xs text-muted">به حداکثر {num(max, "fa")} تصویر رسیده است؛ برای تصویر تازه یکی را بردارید.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <ImageDropzone compact multiple label="بارگذاری عکس‌های تازه" onUploaded={add} />
          <Button variant="secondary" icon="image" onClick={onLibrary}>
            افزودن از کتابخانه
          </Button>
        </div>
      )}
    </div>
  );
}

function TileButton({ icon, label, onClick, disabled, flip }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; flip?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid h-9 place-items-center border-line text-ink-2 transition-colors not-last:border-e hover:bg-bone hover:text-ink disabled:text-faint disabled:hover:bg-transparent">
      <Icon name={icon} className={`size-4 ${flip ? "-scale-x-100" : ""}`} />
    </button>
  );
}
