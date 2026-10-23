"use client";

import { useState, type ReactNode } from "react";
import { adminUpdateMedia } from "@/app/actions/admin-catalog";
import { Button, Dialog, Field, Input } from "@/components/admin/ui";
import { FocalPointEditor } from "@/components/admin/focal-point";
import { useAction } from "@/components/admin/toast";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";

/**
 * Details of one library picture: alt texts (fa/en) and the focal point, saved on the picture itself, so
 * they apply everywhere it is used. `children` adds actions of the calling page (cover, remove, delete…).
 */
export function MediaEditDialog({
  media,
  open,
  onClose,
  onSaved,
  title = "ویرایش تصویر",
  children,
}: {
  media: Media | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (m: Media) => void;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open && Boolean(media)} onClose={onClose} title={title} wide>
      {media && <MediaForm media={media} onClose={onClose} onSaved={onSaved} extra={children} />}
    </Dialog>
  );
}

function MediaForm({ media, onClose, onSaved, extra }: { media: Media; onClose: () => void; onSaved?: (m: Media) => void; extra?: ReactNode }) {
  const [fx, setFx] = useState(media.fx);
  const [fy, setFy] = useState(media.fy);
  const [altFa, setAltFa] = useState(media.alt_fa ?? "");
  const [altEn, setAltEn] = useState(media.alt_en ?? "");
  const { pending, run } = useAction();
  const dirty = fx !== media.fx || fy !== media.fy || altFa !== (media.alt_fa ?? "") || altEn !== (media.alt_en ?? "");

  const save = () => {
    if (!media.id) return;
    run(() => adminUpdateMedia({ id: media.id, alt_fa: altFa, alt_en: altEn, focal_x: fx, focal_y: fy }), {
      onOk: () => {
        onSaved?.({ ...media, fx, fy, alt_fa: altFa.trim(), alt_en: altEn.trim() });
        onClose();
      },
    });
  };

  return (
    <div className="space-y-5">
      <FocalPointEditor media={media} fx={fx} fy={fy} onChange={(x, y) => (setFx(x), setFy(y))} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="توضیح تصویر (فارسی)" hint="برای نابینایان و موتورهای جستجو؛ مثلاً «انگشتر نقره‌ای با نگین آبی روی دست»">
          <Input value={altFa} onChange={(e) => setAltFa(e.target.value)} maxLength={300} />
        </Field>
        <Field label="توضیح تصویر (انگلیسی)">
          <Input value={altEn} onChange={(e) => setAltEn(e.target.value)} maxLength={300} dir="ltr" />
        </Field>
      </div>
      {media.width > 0 && (
        <p className="text-xs text-muted">
          اندازه‌ی اصلی: <span className="ltr">{num(`${media.width} × ${media.height}`, "fa")}</span> پیکسل
        </p>
      )}
      {extra}
      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-white px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
        <Button onClick={save} pending={pending} disabled={!dirty || !media.id} icon="check">
          ذخیره‌ی تصویر
        </Button>
      </div>
    </div>
  );
}
