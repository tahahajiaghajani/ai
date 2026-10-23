"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/admin/ui";
import { uploadImage } from "@/components/admin/resize";
import { Icon } from "@/components/ui/icons";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";

/**
 * Picture upload for the admin: a drop zone (or a single button with `compact`) that takes one or many
 * files, resizes each in the browser (resize.ts) and uploads them one after another with a status line per
 * file. Every finished picture is handed to `onUploaded` at once, so the caller can show it right away.
 */

type Item = { id: number; name: string; preview: string; state: "queued" | "working" | "done" | "error"; error?: string };

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.avif,.heic";
const isImage = (f: File) => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(f.name);

let seq = 0;

export function ImageDropzone({
  onUploaded,
  onFinished,
  multiple = true,
  alt,
  compact = false,
  label,
  hint,
  className = "",
}: {
  onUploaded: (media: Media) => void;
  /** after the whole batch (successful or not) */
  onFinished?: (uploaded: Media[]) => void;
  multiple?: boolean;
  /** alt texts for the new pictures (e.g. the product name) */
  alt?: { fa?: string; en?: string };
  compact?: boolean;
  label?: string;
  hint?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const cbs = useRef({ onUploaded, onFinished, alt });
  useEffect(() => {
    cbs.current = { onUploaded, onFinished, alt };
  });
  const busy = items.some((i) => i.state === "queued" || i.state === "working");

  const patch = (id: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    let list = [...files];
    const rejected = list.filter((f) => !isImage(f));
    list = list.filter(isImage);
    if (!multiple) list = list.slice(0, 1);
    const fresh: Item[] = list.map((f) => ({ id: ++seq, name: f.name, preview: URL.createObjectURL(f), state: "queued" }));
    const bad: Item[] = rejected.map((f) => ({ id: ++seq, name: f.name, preview: "", state: "error", error: "این فایل تصویر نیست." }));
    if (!fresh.length && !bad.length) return;
    setItems((xs) => [...xs.filter((x) => x.state !== "done" && x.state !== "error"), ...fresh, ...bad]);
    const done: Media[] = [];
    fresh.forEach((it, i) => {
      queue.current = queue.current.then(async () => {
        patch(it.id, { state: "working" });
        try {
          const m = await uploadImage(list[i], cbs.current.alt ?? {});
          done.push(m);
          patch(it.id, { state: "done" });
          cbs.current.onUploaded(m);
          const id = it.id;
          setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2500);
        } catch (e) {
          patch(it.id, { state: "error", error: e instanceof Error ? e.message : "بارگذاری انجام نشد." });
        } finally {
          URL.revokeObjectURL(it.preview);
        }
      });
    });
    queue.current = queue.current.then(() => cbs.current.onFinished?.(done));
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      multiple={multiple}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        add(e.target.files);
        e.target.value = "";
      }}
    />
  );

  const status = items.length > 0 && (
    <ul className="mt-3 space-y-1.5" aria-live="polite">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 border border-line bg-white px-3 py-2 text-xs">
          {it.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.preview} alt="" className="size-9 shrink-0 bg-tile object-cover" />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center bg-tile text-faint">
              <Icon name="image" className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ink-2" title={it.name}>
              <span className="ltr">{it.name}</span>
            </span>
            <span className={`block ${it.state === "error" ? "text-danger" : "text-muted"}`}>
              {it.state === "queued" ? "در صف" : it.state === "working" ? "آماده‌سازی و ارسال…" : it.state === "done" ? "بارگذاری شد" : it.error}
            </span>
          </span>
          {it.state === "working" ? (
            <Spinner className="size-4 text-gold" />
          ) : it.state === "done" ? (
            <Icon name="check" className="size-4 text-success" />
          ) : it.state === "error" ? (
            <button type="button" className="grid size-8 place-items-center text-muted hover:text-ink" aria-label="بستن" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
              <Icon name="close" className="size-4" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <div className={className}>
        {picker}
        <Button variant="secondary" icon="upload" pending={busy} onClick={() => input.current?.click()}>
          {label ?? "بارگذاری تصویر تازه"}
        </Button>
        {status}
      </div>
    );
  }

  const count = items.filter((i) => i.state === "queued" || i.state === "working").length;
  return (
    <div className={className}>
      {picker}
      <div
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-3 border border-dashed px-4 py-6 text-center transition-colors sm:flex-row sm:gap-4 sm:text-start ${over ? "border-gold bg-gold-mist" : "border-line-strong bg-ground"}`}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-gold">
          {busy ? <Spinner className="size-4" /> : <Icon name="upload" className="size-5" />}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-medium text-ink">
            {busy ? (
              `در حال بارگذاری ${num(count, "fa")} تصویر…`
            ) : label ? (
              label
            ) : (
              <>
                <span className="pointer-coarse:hidden">{multiple ? "عکس‌ها را اینجا رها کنید" : "عکس را اینجا رها کنید"}</span>
                <span className="hidden pointer-coarse:inline">{multiple ? "عکس‌ها را از گالری یا دوربین انتخاب کنید" : "عکس را از گالری یا دوربین انتخاب کنید"}</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted">{hint ?? "JPG، PNG یا WebP؛ پیش از ارسال در همین مرورگر بهینه می‌شود."}</span>
        </span>
        <Button variant="secondary" icon="plus" onClick={() => input.current?.click()}>
          {multiple ? "انتخاب عکس‌ها" : "انتخاب عکس"}
        </Button>
      </div>
      {status}
    </div>
  );
}
