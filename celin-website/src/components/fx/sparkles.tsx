"use client";

import { useEffect, useRef } from "react";
import { finePointer, useMotionReduced } from "@/components/fx/motion";

interface Glint {
  x: number;
  y: number;
  size: number;
  period: number;
  phase: number;
  tilt: number;
}

const SAMPLE_W = 120;

/** The brightest local peaks of a photo (sample coordinates 0–1), per picture and count: each photo is analysed once. */
type Peak = { x: number; y: number; s: number };
const PEAKS = new Map<string, Peak[]>();

/**
 * Live glints on the bright facets of a jewellery photo. The picture next to the canvas (the first <img>
 * of the parent) is analysed once per photo, in the browser, when the main thread is idle: small local peaks of
 * brightness — facets and claws, not a white background — become four-point stars that twinkle, and brighten
 * near the pointer. Works for any uploaded photo (same origin). Paused off-screen; nothing at all with reduced
 * motion (live: the footer toggle and the OS setting stop and restart it).
 */
export function Sparkles({ count = 14, intensity = 1, className = "" }: { count?: number; intensity?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useMotionReduced();

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const img = host?.querySelector("img");
    if (!canvas || !host || !img || reduced) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let glints: Glint[] = [];
    let raf = 0;
    let visible = false;
    let inView = false;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pointer = { x: -1, y: -1, on: false };

    // the brightest local peaks of the photo, in sample coordinates (0–1); cached per photo and count
    const peaksOf = (): Peak[] | null => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return null;
      const key = `${img.currentSrc || img.src}|${count}`;
      const known = PEAKS.get(key);
      if (known) return known;
      const sw = SAMPLE_W;
      const sh = Math.round((SAMPLE_W * nh) / nw);
      const off = document.createElement("canvas");
      off.width = sw;
      off.height = sh;
      const o = off.getContext("2d", { willReadFrequently: true });
      if (!o) return null;
      let data: Uint8ClampedArray;
      try {
        o.drawImage(img, 0, 0, sw, sh);
        data = o.getImageData(0, 0, sw, sh).data;
      } catch {
        PEAKS.set(key, []);
        return []; // a cross-origin picture: no glints
      }
      const lum = new Float32Array(sw * sh);
      for (let i = 0; i < sw * sh; i++) lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
      // brightness minus the local mean (5×5): peaks, not plain bright areas
      const r = 2;
      const peaks: { i: number; s: number }[] = [];
      for (let y = r; y < sh - r; y++) {
        for (let x = r; x < sw - r; x++) {
          const i = y * sw + x;
          const L = lum[i];
          if (L < 170) continue;
          let sum = 0;
          let max = 0;
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              const v = lum[i + dy * sw + dx];
              sum += v;
              if (v > max && (dx || dy)) max = v;
            }
          if (L < max) continue;
          const s = L - sum / ((2 * r + 1) * (2 * r + 1));
          if (s > 18) peaks.push({ i, s: s + (L - 170) * 0.15 });
        }
      }
      peaks.sort((a, b) => b.s - a.s);
      const minD = sw * 0.07;
      const chosen: { x: number; y: number; s: number }[] = [];
      for (const p of peaks) {
        const x = p.i % sw;
        const y = Math.floor(p.i / sw);
        if (chosen.every((c) => (c.x - x) ** 2 + (c.y - y) ** 2 > minD * minD)) chosen.push({ x, y, s: p.s });
        if (chosen.length >= count) break;
      }
      const list = chosen.map((c) => ({ x: c.x / sw, y: c.y / sh, s: c.s }));
      PEAKS.set(key, list);
      return list;
    };

    // peaks → glints in box coordinates (object-fit: cover with the focal point as object-position)
    const layout = () => {
      const chosen = peaksOf();
      if (!chosen) return;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const pos = getComputedStyle(img).objectPosition.split(" ").map((v) => parseFloat(v) / 100);
      const fx = Number.isFinite(pos[0]) ? pos[0] : 0.5;
      const fy = Number.isFinite(pos[1]) ? pos[1] : 0.5;
      const scale = Math.max(w / nw, h / nh);
      const rw = nw * scale;
      const rh = nh * scale;
      const ox = (w - rw) * fx;
      const oy = (h - rh) * fy;
      const top = chosen[0]?.s || 1;
      glints = chosen
        .map((c) => ({
          x: ox + c.x * rw,
          y: oy + c.y * rh,
          size: (7 + 11 * Math.min(1, c.s / top)) * (Math.min(w, 600) / 420),
          period: 1800 + Math.random() * 2600,
          phase: Math.random() * 6000,
          tilt: (Math.random() - 0.5) * 0.5,
        }))
        .filter((g) => g.x > 0 && g.y > 0 && g.x < w && g.y < h);
    };

    const star = (g: Glint, a: number) => {
      const s = g.size * (0.55 + 0.45 * a) * dpr;
      const x = g.x * dpr;
      const y = g.y * dpr;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(g.tilt);
      ctx.globalAlpha = Math.min(1, a * intensity);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.9);
      glow.addColorStop(0, "rgba(255,250,240,0.95)");
      glow.addColorStop(0.25, "rgba(255,236,210,0.35)");
      glow.addColorStop(1, "rgba(255,230,200,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,252,246,0.95)";
      for (const [len, wid] of [
        [s * 1.6, s * 0.07],
        [s * 0.9, s * 0.05],
      ]) {
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.quadraticCurveTo(0, -wid, len, 0);
        ctx.quadraticCurveTo(0, wid, -len, 0);
        ctx.moveTo(0, -len);
        ctx.quadraticCurveTo(wid, 0, 0, len);
        ctx.quadraticCurveTo(-wid, 0, 0, -len);
        ctx.fill();
        ctx.rotate(Math.PI / 4);
      }
      ctx.restore();
    };

    const frame = (t: number) => {
      raf = 0;
      if (!visible) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";
      for (const g of glints) {
        const k = ((t + g.phase) % g.period) / g.period;
        let a = Math.max(0, Math.sin(k * Math.PI * 2)) ** 6;
        if (pointer.on) {
          const d = Math.hypot(pointer.x - g.x, pointer.y - g.y) / Math.max(w, h);
          a = Math.max(a, Math.max(0, 1 - d * 4) ** 2 * (0.6 + 0.4 * Math.sin(t / 140 + g.phase)));
        }
        if (a > 0.02) star(g, a);
      }
      raf = requestAnimationFrame(frame);
    };

    // only when the box really changed size (the ResizeObserver also reports the first size)
    const size = () => {
      const r = host.getBoundingClientRect();
      if (r.width === w && r.height === h) return;
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      layout();
    };

    const start = () => {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      visible = inView && document.visibilityState === "visible";
      start();
    });
    const ro = new ResizeObserver(() => size());
    // the first analysis waits for an idle moment (it reads pixels), never in the middle of a scroll
    const ric = typeof requestIdleCallback === "function";
    const idle = (fn: () => void): number => (ric ? requestIdleCallback(fn, { timeout: 1500 }) : (setTimeout(fn, 200) as unknown as number));
    const unidle = (id: number) => (ric ? cancelIdleCallback(id) : clearTimeout(id));
    let idleId = 0;
    const ready = () => {
      idleId = idle(() => {
        size();
        io.observe(host);
        ro.observe(host);
      });
    };
    if (img.complete && img.naturalWidth) ready();
    else img.addEventListener("load", ready, { once: true });

    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = true;
    };
    const leave = () => (pointer.on = false);
    if (finePointer()) {
      host.addEventListener("pointermove", move);
      host.addEventListener("pointerleave", leave);
    }
    const onVis = () => {
      visible = inView && document.visibilityState === "visible";
      start();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      unidle(idleId);
      io.disconnect();
      ro.disconnect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      img.removeEventListener("load", ready);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [count, intensity, reduced]);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 z-[1] size-full ${className}`} />;
}
