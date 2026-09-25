"use client";
import * as React from "react";
import { CheckCircle2, FileUp, Loader2, Paperclip, RotateCcw, Trash2, XCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn, formatBytes, randomId, storageSafeName } from "@/lib/utils";

export interface UploadedFile {
  storage_path: string;
  name: string;
  mime: string | null;
  size: number;
}

interface Item {
  key: string;
  file: File;
  status: "uploading" | "done" | "error";
  error?: string;
  uploaded?: UploadedFile;
}

const MAX = 50 * 1024 * 1024;

export interface UploadStatus {
  uploading: number;
  failed: number;
}

function uploadError(message: string): string {
  if (/invalid key/i.test(message)) return "نام فایل برای ذخیره‌سازی نامعتبر بود";
  if (/payload too large|exceeded the maximum|too large/i.test(message)) return "حجم فایل بیش از حد مجاز است";
  if (/mime type/i.test(message)) return "این نوع فایل مجاز نیست";
  if (/row-level security|unauthorized|jwt/i.test(message)) return "اجازه‌ی بارگذاری ندارید؛ دوباره وارد شوید";
  if (/fetch|network/i.test(message)) return "خطای شبکه؛ دوباره تلاش کنید";
  return `بارگذاری ناموفق: ${message}`;
}

/** Collects the uploaded files of a FileDropzone and tells whether the form may be submitted yet. */
export function useUploads() {
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [status, setStatus] = React.useState<UploadStatus>({ uploading: 0, failed: 0 });
  const onChange = React.useCallback((f: UploadedFile[], s: UploadStatus) => {
    setFiles(f);
    setStatus(s);
  }, []);
  const blocker = status.uploading
    ? "صبر کنید تا بارگذاری فایل‌ها تمام شود"
    : status.failed
      ? "بارگذاری بعضی فایل‌ها ناموفق بود؛ آن‌ها را دوباره بارگذاری یا حذف کنید"
      : null;
  return { files, onChange, status, blocker };
}

/**
 * Uploads any file type straight from the browser to Supabase Storage (bypassing the
 * serverless body limit). The parent receives the uploaded file descriptors.
 */
export function FileDropzone({
  userId,
  onChange,
  compact,
  label = "فایل‌ها را اینجا رها کنید یا کلیک کنید",
}: {
  userId: string;
  /** Called with the successfully uploaded files and the number still uploading / failed. */
  onChange: (files: UploadedFile[], status: UploadStatus) => void;
  compact?: boolean;
  label?: string;
}) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    onChange(
      items.filter((i) => i.status === "done" && i.uploaded).map((i) => i.uploaded!),
      { uploading: items.filter((i) => i.status === "uploading").length, failed: items.filter((i) => i.status === "error").length },
    );
  }, [items, onChange]);

  const upload = async (file: File, existingKey?: string) => {
    const key = existingKey ?? randomId(10);
    if (file.size > MAX) {
      setItems((s) => [...s, { key, file, status: "error", error: "حداکثر حجم ۵۰ مگابایت است" }]);
      return;
    }
    setItems((s) => (existingKey ? s.map((it) => (it.key === key ? { ...it, status: "uploading", error: undefined } : it)) : [...s, { key, file, status: "uploading" }]));
    const month = new Date().toISOString().slice(0, 7);
    // Storage keys must be ASCII; the original (e.g. Persian) name is stored with the file record.
    const path = `${userId}/${month}/${key}-${storageSafeName(file.name)}`;
    const { error } = await supabaseBrowser().storage.from("task-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    setItems((s) =>
      s.map((it) =>
        it.key === key
          ? error
            ? { ...it, status: "error", error: uploadError(error.message) }
            : { ...it, status: "done", uploaded: { storage_path: path, name: file.name, mime: file.type || null, size: file.size } }
          : it,
      ),
    );
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    Array.from(list).forEach((f) => void upload(f));
  };

  const remove = async (key: string) => {
    const it = items.find((i) => i.key === key);
    setItems((s) => s.filter((i) => i.key !== key));
    if (it?.uploaded) await supabaseBrowser().storage.from("task-files").remove([it.uploaded.storage_path]);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-surface-strong/60 text-sm text-muted transition hover:border-primary hover:text-fg",
          compact ? "px-4 py-3" : "flex-col px-6 py-7",
          drag && "border-primary bg-primary-soft text-fg",
        )}
      >
        {compact ? <Paperclip className="size-4" /> : <FileUp className="size-7 text-primary" />}
        <span>{label}</span>
        {!compact ? <span className="text-xs text-faint">هر نوع فایل — تا ۵۰ مگابایت</span> : null}
      </button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-strong px-3 py-2 text-sm">
              {it.status === "uploading" ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : it.status === "done" ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <XCircle className="size-4 text-danger" />
              )}
              <span dir="auto" className="min-w-0 flex-1 truncate text-start">{it.file.name}</span>
              <span className={cn("shrink-0 text-xs", it.error ? "text-danger" : "text-faint")}>{it.error ?? formatBytes(it.file.size)}</span>
              {it.status === "error" && it.file.size <= MAX ? (
                <button type="button" onClick={() => void upload(it.file, it.key)} className="rounded-lg p-1 text-muted hover:text-primary" aria-label="تلاش دوباره" title="تلاش دوباره">
                  <RotateCcw className="size-3.5" />
                </button>
              ) : null}
              <button type="button" onClick={() => void remove(it.key)} className="rounded-lg p-1 text-muted hover:text-danger" aria-label="حذف">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
