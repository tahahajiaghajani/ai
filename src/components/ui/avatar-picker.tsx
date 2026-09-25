"use client";
import * as React from "react";
import { Camera, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const OUTPUT = 320;

/**
 * Center-crops an image to a square and shrinks it in the browser, so uploads stay tiny
 * (tens of KB) and fit comfortably in a server action body.
 */
export async function imageToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("لطفاً یک فایل تصویری انتخاب کنید");
  if (file.size > 15 * 1024 * 1024) throw new Error("حجم تصویر حداکثر ۱۵ مگابایت است");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("این تصویر قابل خواندن نیست"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("مرورگر از ویرایش تصویر پشتیبانی نمی‌کند");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, OUTPUT, OUTPUT);
    const webp = canvas.toDataURL("image/webp", 0.86);
    // Safari cannot encode WebP and silently returns PNG; JPEG is much smaller there.
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Round picture with a camera button; reports the processed image as a data URL (or null when removed). */
export function AvatarPicker({
  name,
  value,
  onChange,
  onError,
  size = 96,
  disabled,
}: {
  name: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  onError?: (message: string) => void;
  size?: number;
  disabled?: boolean;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await imageToAvatarDataUrl(file));
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
        aria-label="انتخاب تصویر پروفایل"
      >
        <Avatar name={name || "?"} src={value} size={size} />
        <span className={cn("absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100", busy && "opacity-100")}>
          <Camera className="size-6" />
        </span>
      </button>
      <div className="space-y-1.5 text-sm">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold transition hover:bg-surface-muted disabled:opacity-50">
            {value ? "تغییر تصویر" : "انتخاب تصویر"}
          </button>
          {value ? (
            <button type="button" disabled={disabled || busy} onClick={() => onChange(null)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50">
              <Trash2 className="size-3.5" /> حذف
            </button>
          ) : null}
        </div>
        <p className="text-[11px] text-faint">JPG، PNG یا WebP — به‌صورت مربعی برش و کوچک می‌شود.</p>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}
