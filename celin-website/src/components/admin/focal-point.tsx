"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/admin/ui";
import { Picture } from "@/components/ui/picture";
import { num } from "@/lib/format";
import { mediaUrl, type Media } from "@/lib/media";

/**
 * Focal point of a picture: click or drag on the image (or use the arrow keys, Shift = 5%) to choose the
 * point that must stay in view when the picture is cropped to another shape. The crops the site uses are
 * previewed live next to it. Coordinates are physical percent from the left/top (CSS object-position).
 */

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const PREVIEWS = [
  { ratio: "3/4", label: "۳:۴" },
  { ratio: "4/5", label: "۴:۵" },
  { ratio: "1/1", label: "۱:۱" },
  { ratio: "16/9", label: "۱۶:۹" },
];

export function FocalPointEditor({ media, fx, fy, onChange, maxHeight = "min(50vh, 440px)" }: { media: Media; fx: number; fy: number; onChange: (fx: number, fy: number) => void; maxHeight?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    onChange(clamp(((e.clientX - r.left) / r.width) * 100), clamp(((e.clientY - r.top) / r.height) * 100));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    onChange(clamp(fx + m[0]), clamp(fy + m[1]));
  };

  const shown = { ...media, fx, fy };
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)] sm:items-start">
      <div className="space-y-2">
        <div className="flex justify-center bg-tile p-2">
          <div
            ref={box}
            role="slider"
            tabIndex={0}
            aria-label="نقطه‌ی کانونی؛ با کلیک یا کلیدهای جهت جابه‌جا کنید"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={fx}
            aria-valuetext={`افقی ${num(fx, "fa")}٪، عمودی ${num(fy, "fa")}٪`}
            onKeyDown={onKey}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              fromPointer(e);
            }}
            onPointerMove={(e) => dragging.current && fromPointer(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            className="relative inline-block cursor-crosshair touch-none select-none outline-offset-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(media, 960)}
              width={media.width || undefined}
              height={media.height || undefined}
              alt=""
              draggable={false}
              className="block h-auto w-auto max-w-full"
              style={{ maxHeight }}
            />
            {/* crosshair (physical coordinates, like object-position) */}
            <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-white/80 mix-blend-difference" style={{ left: `${fx}%` }} />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-white/80 mix-blend-difference" style={{ top: `${fy}%` }} />
            <span
              aria-hidden
              className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-ink/50"
              style={{ left: `${fx}%`, top: `${fy}%` }}
            >
              <span className="absolute inset-0 m-auto size-1.5 rounded-full bg-white ring-1 ring-ink/50" />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            افقی {num(fx, "fa")}٪ · عمودی {num(fy, "fa")}٪
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange(50, 50)} disabled={fx === 50 && fy === 50}>
            وسط تصویر
          </Button>
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-ink-2">پیش‌نمایش برش‌ها</div>
        <p className="mb-2 text-[11px] leading-5 text-muted">روی جواهر بزنید یا نشانگر را بکشید؛ این نقطه در همه‌ی برش‌ها دیده می‌ماند.</p>
        <div className="grid grid-cols-4 items-end gap-2 sm:grid-cols-2">
          {PREVIEWS.map((p) => (
            <figure key={p.ratio} className="min-w-0">
              <Picture media={shown} ratio={p.ratio} sizes="120px" alt="" className="border border-line" />
              <figcaption className="mt-1 text-center text-[11px] text-muted">{p.label}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
