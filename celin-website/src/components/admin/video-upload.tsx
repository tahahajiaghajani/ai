"use client";

import { useRef, useState } from "react";
import { adminFinishVideo, adminVideoUploadUrl } from "@/app/actions/admin";
import { Button } from "@/components/admin/ui";
import { Icon } from "@/components/ui/icons";
import { num } from "@/lib/format";
import { mediaUrl, type Media } from "@/lib/media";
import { checkVideoFile, mp4Info, playsEverywhere, sniffVideo, SNIFF_BYTES, VIDEO_ACCEPT, VIDEO_MIME, videoMimeOf, type Video } from "@/lib/video";

/**
 * «ویدئو (اختیاری)» in the slot sheet: a muted looping video over the slot's picture. The file is checked here
 * (type, size, magic bytes, the MP4 codec, that the browser can read it), sent straight to the storage bucket
 * through a one-time signed URL (Vercel functions cannot take bodies this large), then checked again on the
 * server and recorded. The slot keeps its picture as the poster and the fallback.
 */

type Stage = { step: "check" | "upload" | "verify"; progress: number } | null;

const mb = (bytes: number) => num((bytes / 1048576).toFixed(1), "fa").replace(".", "٫");

/** Width, height and length as the browser reads them (null when this browser cannot open the file). */
function probe(file: File): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (r: { width: number; height: number; duration: number } | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => done(null), 15000);
    v.muted = true;
    v.preload = "metadata";
    v.onloadedmetadata = () => done(v.videoWidth > 0 ? { width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0 } : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

function put(url: string, file: File, type: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((ok, fail) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("content-type", type);
    x.setRequestHeader("cache-control", "max-age=31536000");
    x.setRequestHeader("x-upsert", "false");
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return ok();
      fail(new Error(x.status === 413 ? "فضای ذخیره این حجم را نپذیرفت (حداکثر ۲۵ مگابایت)." : x.status === 415 || /mime|type/i.test(x.responseText) ? "فضای ذخیره این نوع فایل را نپذیرفت؛ SQL تازه را از «اتصالات» اجرا کنید." : `بارگذاری انجام نشد (خطای ${num(x.status, "fa")}).`));
    };
    x.onerror = () => fail(new Error("اتصال به فضای ذخیره برقرار نشد؛ اینترنت را بررسی کنید و دوباره امتحان کنید."));
    x.send(file);
  });
}

async function uploadVideo(file: File, stage: (s: Stage) => void): Promise<Video> {
  stage({ step: "check", progress: 0 });
  const problem = checkVideoFile(file);
  if (problem) throw new Error(problem);
  const mime = videoMimeOf(file)!;
  const kind = sniffVideo(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  if (!kind || VIDEO_MIME[kind] !== mime) throw new Error("این فایل ویدئوی MP4 یا WebM معتبر نیست.");
  let h264 = false;
  if (kind === "mp4") {
    const info = await mp4Info(async (o, l) => new Uint8Array(await file.slice(o, o + l).arrayBuffer()), file.size).catch(() => null);
    if (info && !playsEverywhere(info.codec)) {
      throw new Error(info.codec === "hvc1" || info.codec === "hev1" ? "این ویدئو HEVC (H.265) است و در همه‌ی مرورگرها پخش نمی‌شود؛ با کدک H.264 خروجی بگیرید." : "کدک این ویدئو در همه‌ی مرورگرها پخش نمی‌شود؛ با کدک H.264 خروجی بگیرید.");
    }
    h264 = info?.codec === "avc1" || info?.codec === "avc3";
  }
  const meta = await probe(file);
  // some Linux builds of Chromium have no H.264 decoder: a file that is surely H.264 is still accepted
  if (!meta && !h264) throw new Error("این مرورگر نتوانست ویدئو را باز کند؛ فایل را با خروجی MP4 (H.264) دوباره ذخیره کنید.");

  const signed = await adminVideoUploadUrl({ type: mime, name: file.name, size: file.size });
  if (!signed.ok) throw new Error(signed.error);
  stage({ step: "upload", progress: 0 });
  await put(signed.url, file, mime, (p) => stage({ step: "upload", progress: p }));
  stage({ step: "verify", progress: 1 });
  const done = await adminFinishVideo({ path: signed.path, ...(meta ?? { width: 0, height: 0, duration: 0 }) });
  if (!done.ok) throw new Error(done.error);
  return done.video;
}

export function SlotVideoField({ video, poster, ratio, onChange, onBusy }: { video: Video | null; poster: Media; ratio: string; onChange: (v: Video | null) => void; onBusy?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [error, setError] = useState("");
  const busy = stage !== null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    onBusy?.(true);
    try {
      const v = await uploadVideo(file, setStage);
      onChange(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "بارگذاری انجام نشد.");
    } finally {
      setStage(null);
      onBusy?.(false);
    }
  };

  const facts = video
    ? [mb(video.bytes) + " مگابایت", video.duration ? `${num(Math.round(video.duration), "fa")} ثانیه` : "", video.width ? `${num(video.width, "fa")}×${num(video.height, "fa")}` : "", video.type === "video/webm" ? "WebM" : "MP4"].filter(Boolean)
    : [];

  return (
    <div className="space-y-3 border-t border-line pt-5" data-video-field>
      <div>
        <div className="text-sm font-medium">ویدئو (اختیاری)</div>
        <p className="mt-0.5 text-xs leading-5 text-muted">MP4 (H.264) یا WebM، بی‌صدا و حلقه‌ای، تا ۲۵ مگابایت. تصویر همین بخش پوستر ویدئو است و هر جا ویدئو پخش نشود (کاهش حرکت، صرفه‌جویی داده) نمایش داده می‌شود.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex items-start gap-3">
        <div className="relative w-20 shrink-0 overflow-hidden border border-line bg-tile" style={{ aspectRatio: ratio }}>
          {video ? (
            <video key={video.id} src={video.src} poster={mediaUrl(poster, 480)} muted loop playsInline autoPlay preload="metadata" className="absolute inset-0 size-full object-cover" style={{ objectPosition: `${poster.fx}% ${poster.fy}%` }} />
          ) : (
            <span className="absolute inset-0 grid place-items-center border border-dashed border-line-strong text-faint">
              <Icon name="upload" className="size-5" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {video && <p className="text-xs leading-5 text-ink-2">{facts.join(" · ")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon="upload" pending={busy} onClick={() => input.current?.click()}>
              {video ? "جایگزینی ویدئو" : "بارگذاری ویدئو"}
            </Button>
            {video && !busy && (
              <Button variant="ghost" icon="close" onClick={() => onChange(null)}>
                حذف ویدئو
              </Button>
            )}
          </div>
          {stage && (
            <div className="space-y-1" aria-live="polite">
              <div className="text-xs text-muted">{stage.step === "check" ? "بررسی فایل…" : stage.step === "upload" ? `ارسال… ${num(Math.round(stage.progress * 100), "fa")}٪` : "بررسی نهایی…"}</div>
              <div className="h-1 w-full overflow-hidden bg-bone">
                <div className="h-full bg-gold transition-[width] duration-300" style={{ width: `${Math.round((stage.step === "check" ? 0.02 : stage.progress) * 100)}%` }} />
              </div>
            </div>
          )}
          {error && (
            <p className="text-xs leading-5 text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
