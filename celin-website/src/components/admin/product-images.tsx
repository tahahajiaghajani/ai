"use client";

import { useState, type DragEvent } from "react";
import { Badge, Button, Card } from "@/components/admin/ui";
import { ImageDropzone } from "@/components/admin/image-dropzone";
import { MediaEditDialog } from "@/components/admin/media-edit";
import { MediaPicker } from "@/components/admin/media-picker";
import { Icon, type IconName } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";

/**
 * The ordered pictures of a product: the first is the cover, the second shows on hover in the shop.
 * Reorder by dragging (desktop) or with the arrow buttons (touch, keyboard); remove only takes a picture off
 * this product (the file stays in the library).
 */
export function ProductImages({
  images,
  media,
  setImages,
  onMedia,
  alt,
}: {
  images: string[];
  media: Record<string, Media>;
  setImages: (fn: (prev: string[]) => string[]) => void;
  onMedia: (m: Media) => void;
  alt: { fa: string; en: string };
}) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const move = (from: number, to: number) =>
    setImages((xs) => {
      if (from === to || from < 0 || to < 0 || from >= xs.length || to >= xs.length) return xs;
      const next = [...xs];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  const remove = (id: string) => setImages((xs) => xs.filter((x) => x !== id));
  const add = (ms: Media[]) => {
    ms.forEach(onMedia);
    const ids = ms.map((m) => m.id).filter((x): x is string => Boolean(x));
    setImages((xs) => [...xs, ...ids.filter((id) => !xs.includes(id))]);
  };

  const editIdx = editing ? images.indexOf(editing) : -1;
  const editMedia = editing ? media[editing] ?? null : null;

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

  return (
    <Card
      title="تصاویر"
      sub="عکس عمودی ۳:۴ بهترین نتیجه را دارد. عکس اول (کاور) واضح‌ترین عکس خود محصول باشد و عکس دوم روی مدل؛ در فروشگاه با رفتن نشانگر روی کارت نمایش داده می‌شود."
      actions={
        <Button variant="secondary" icon="image" onClick={() => setPicker(true)}>
          انتخاب از کتابخانه
        </Button>
      }
    >
      {images.length > 0 && (
        <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {images.map((id, i) => {
            const m = media[id];
            return (
              <li
                key={id}
                {...dragProps(i)}
                data-image-tile
                className={`bg-white transition-opacity ${drag === i ? "opacity-40" : ""} ${over === i && drag !== i ? "outline outline-1 outline-offset-2 outline-gold" : ""}`}
              >
                <div className="relative border border-line">
                  {m ? (
                    <button type="button" onClick={() => setEditing(id)} className="block w-full cursor-grab active:cursor-grabbing" aria-label={`ویرایش تصویر ${num(i + 1, "fa")}`}>
                      <Picture media={m} ratio="3/4" sizes="(min-width: 1024px) 200px, 45vw" alt="" />
                    </button>
                  ) : (
                    <div className="grid aspect-[3/4] place-items-center bg-tile px-3 text-center text-xs text-muted">این تصویر در کتابخانه پیدا نشد</div>
                  )}
                  <span className="pointer-events-none absolute start-1.5 top-1.5">{i === 0 ? <Badge tone="ink">کاور</Badge> : <Badge className="bg-white/90">{num(i + 1, "fa")}</Badge>}</span>
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    className="absolute end-1 top-1 grid size-9 place-items-center bg-white/90 text-ink-2 hover:text-danger"
                    aria-label="حذف از این محصول"
                    title="حذف از این محصول (فایل در کتابخانه می‌ماند)"
                  >
                    <Icon name="close" className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 border-x border-b border-line">
                  <TileButton icon="chevron" label="جابه‌جایی به قبل" disabled={i === 0} onClick={() => move(i, i - 1)} />
                  <TileButton icon="chevron" flip label="جابه‌جایی به بعد" disabled={i === images.length - 1} onClick={() => move(i, i + 1)} />
                  <TileButton icon="edit" label="توضیح و نقطه‌ی کانونی" disabled={!m} onClick={() => setEditing(id)} />
                </div>
                {i === 0 ? (
                  <div className="grid h-10 place-items-center border-x border-b border-line bg-ground text-xs text-muted">تصویر کاور</div>
                ) : (
                  <button type="button" onClick={() => move(i, 0)} className="h-10 w-full border-x border-b border-line text-xs text-ink-2 transition-colors hover:bg-bone hover:text-ink">
                    کاور شود
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ImageDropzone multiple alt={alt} onUploaded={(m) => add([m])} hint={images.length ? "JPG، PNG یا WebP؛ چند عکس را با هم انتخاب کنید یا بکشید و رها کنید." : "هنوز تصویری ندارد؛ چند عکس را با هم انتخاب کنید یا بکشید و رها کنید."} />

      <MediaPicker open={picker} onClose={() => setPicker(false)} multiple exclude={images} alt={alt} onPick={add} />
      <MediaEditDialog media={editMedia} open={Boolean(editMedia)} onClose={() => setEditing(null)} onSaved={onMedia} title={editIdx === 0 ? "تصویر کاور" : `تصویر ${num(editIdx + 1, "fa")}`}>
        {editing && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {editIdx > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon="sparkle"
                onClick={() => {
                  move(editIdx, 0);
                  setEditing(null);
                }}
              >
                کاور شود
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              icon="close"
              onClick={() => {
                remove(editing);
                setEditing(null);
              }}
            >
              حذف از این محصول
            </Button>
            <span className="self-center text-xs text-muted">فایل در کتابخانه می‌ماند.</span>
          </div>
        )}
      </MediaEditDialog>
    </Card>
  );
}

function TileButton({ icon, label, onClick, disabled, flip }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; flip?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid h-10 place-items-center border-line text-ink-2 transition-colors not-last:border-e hover:bg-bone hover:text-ink disabled:text-faint disabled:hover:bg-transparent">
      <Icon name={icon} className={`size-4 ${flip ? "-scale-x-100" : ""}`} />
    </button>
  );
}
