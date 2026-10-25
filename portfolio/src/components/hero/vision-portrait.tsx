"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onIntroDone } from "@/components/fx/preloader";

gsap.registerPlugin(ScrollTrigger);

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/*
 * The portrait as a vision model would see it.
 * - reveal: halftone dots pop in cell by cell, then each cell resolves into the photograph;
 * - lens: around the pointer, the "machine view" — Sobel edges, scanlines and a measuring grid;
 * - scan: a band of machine view sweeps down now and then (also on touch screens);
 * - scroll: the photograph dissolves back into ever larger dots.
 */
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uTexel;
uniform vec2 uCrop;
uniform vec2 uMouse;
uniform float uHover;
uniform float uReveal;
uniform float uScroll;
uniform float uScan;
uniform float uTime;
uniform float uDpr;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec2 cover(vec2 uv) { return uCrop * (uv - 0.5) + 0.5; }
float photo(vec2 uv) {
  float l = luma(texture2D(uTex, cover(uv)).rgb);
  return smoothstep(0.02, 0.92, l);
}

float edges(vec2 uv) {
  vec2 t = uTexel * 1.4;
  float tl = photo(uv + vec2(-t.x, t.y)), tc = photo(uv + vec2(0.0, t.y)), tr = photo(uv + vec2(t.x, t.y));
  float ml = photo(uv + vec2(-t.x, 0.0)), mr = photo(uv + vec2(t.x, 0.0));
  float bl = photo(uv + vec2(-t.x, -t.y)), bc = photo(uv + vec2(0.0, -t.y)), br = photo(uv + vec2(t.x, -t.y));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return clamp(length(vec2(gx, gy)) * 2.6, 0.0, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float cell = mix(5.0, 22.0, smoothstep(0.0, 1.0, uScroll)) * uDpr;
  vec2 id = floor(frag / cell);
  vec2 center = (id + 0.5) * cell / uRes;
  float r = hash(id);

  // halftone: a dot per cell, its radius from the brightness under the cell centre
  float lum = photo(center);
  vec2 local = fract(frag / cell) - 0.5;
  float radius = sqrt(lum) * 0.62;
  float aa = 1.2 / cell;
  float dots = smoothstep(radius + aa, radius - aa, length(local));

  float appear = smoothstep(r * 0.55, r * 0.55 + 0.18, uReveal * 1.25);
  float resolve = smoothstep(0.5 + r * 0.38, 0.62 + r * 0.38, uReveal);
  resolve *= 1.0 - smoothstep(0.05, 0.75, uScroll + r * 0.25);
  float base = mix(dots * appear, photo(vUv), resolve);

  // pointer lens
  vec2 d = (vUv - uMouse) * vec2(uRes.x / uRes.y, 1.0);
  float dist = length(d);
  float R = 0.2 * uHover;
  float lens = 1.0 - smoothstep(R - 0.006, R, dist);
  float ring = (1.0 - smoothstep(0.0, 0.004, abs(dist - R))) * uHover;
  float ticks = step(0.985, abs(cos(atan(d.y, d.x) * 24.0))) * (1.0 - smoothstep(0.0, 0.018, abs(dist - R - 0.014))) * uHover;

  // sweeping band
  float band = 1.0 - smoothstep(0.0, 0.07, abs((1.0 - vUv.y) - uScan));
  band *= step(0.0, uScan) * step(uScan, 1.0);
  float bandLine = (1.0 - smoothstep(0.0, 0.0025, abs((1.0 - vUv.y) - uScan))) * step(0.0, uScan) * step(uScan, 1.0);

  float m = max(lens, band * 0.85);
  // the machine view (edges, scanlines and a fine grid) only where the lens or the band shows it: the Sobel filter
  // costs eight more texture reads per pixel
  float machine = 0.0;
  if (m > 0.001) {
    float e = edges(vUv);
    float scan = 0.78 + 0.22 * sin(frag.y * 0.9 / uDpr - uTime * 6.0);
    vec2 g = abs(fract(frag / (28.0 * uDpr)) - 0.5);
    float grid = step(0.485, max(g.x, g.y)) * 0.12;
    machine = max(e * scan, grid) + dots * 0.08;
  }
  float c = mix(base, machine, m) + ring * 0.9 + ticks * 0.6 + bandLine * 0.7;

  // a soft vignette keeps the frame quiet at its edges
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  gl_FragColor = vec4(vec3(c), 1.0);
}`;

export type Detection = { label: string; score: string; box: [number, number, number, number]; delay?: number };

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
  return s;
}

/**
 * A square photograph shown in a 4:5 frame through a WebGL "vision" shader, with detection boxes laid over it.
 * Falls back to the plain (grayscale) image without WebGL, after a lost context and whenever the canvas does not
 * show the photo; the <img> is always there for no-JS and crawlers.
 *
 * It draws only while something moves (the reveal, the scanning band, the lens, the scroll), so an idle portrait
 * costs nothing, and phones draw at most 1.5 device pixels per CSS pixel.
 */
export function VisionPortrait({ src, alt, detections, className = "" }: { src: string; alt: string; detections: Detection[]; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gl, setGl] = useState(false);
  // bumped when the browser gives a lost WebGL context back, to set everything up again
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!ctx || ctx.isContextLost()) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const maxDpr = window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2;
    let prog: WebGLProgram;
    try {
      prog = ctx.createProgram()!;
      ctx.attachShader(prog, compile(ctx, ctx.VERTEX_SHADER, VERT));
      ctx.attachShader(prog, compile(ctx, ctx.FRAGMENT_SHADER, FRAG));
      ctx.linkProgram(prog);
      if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) throw new Error("link");
    } catch (e) {
      console.warn("[portrait] webgl unavailable", e);
      return;
    }
    ctx.useProgram(prog);
    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
    const loc = ctx.getAttribLocation(prog, "aPos");
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
    const U = (n: string) => ctx.getUniformLocation(prog, n);
    const u = {
      res: U("uRes"), texel: U("uTexel"), crop: U("uCrop"), mouse: U("uMouse"), hover: U("uHover"), reveal: U("uReveal"),
      scroll: U("uScroll"), scan: U("uScan"), time: U("uTime"), dpr: U("uDpr"),
    };

    // after a lost context comes back the portrait returns as it was, without playing the reveal again
    const revealed = reduce || epoch > 0;
    const state = { reveal: revealed ? 1 : 0, hover: 0, hoverTarget: 0, mx: 0.5, my: 0.55, tx: 0.5, ty: 0.55, scroll: 0, scan: -1 };
    let imgW = 1, imgH = 1;
    let ready = false;
    let visible = true;
    let raf = 0;
    let disposed = false;
    let checked = false;
    const start = performance.now();

    const tex = ctx.createTexture();
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img.onload = async () => {
      // decoded before the upload, so the texture never receives a half-decoded picture
      await img.decode().catch(() => {});
      if (disposed || ctx.isContextLost()) return;
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
      ctx.bindTexture(ctx.TEXTURE_2D, tex);
      ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true);
      ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, img);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
      ready = true;
      setGl(true);
      resize();
      // the first frames ran before the photo arrived and stopped; start drawing now (frame() still stops off-screen)
      kick();
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      // layout size, not getBoundingClientRect: a transform on an ancestor must not shrink the drawing buffer
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      ctx.viewport(0, 0, cv.width, cv.height);
      // "cover": crop the longer side of the photo to the frame
      const fa = w / h;
      const ia = imgW / imgH;
      ctx.uniform2f(u.crop, fa < ia ? fa / ia : 1, fa < ia ? 1 : ia / fa);
      ctx.uniform2f(u.res, cv.width, cv.height);
      ctx.uniform2f(u.texel, 1 / imgW, 1 / imgH);
      ctx.uniform1f(u.dpr, dpr);
      // resizing clears the canvas: draw again
      kick();
    };

    // the canvas could not show the photo (all white: a broken texture or a mobile GPU's lost buffer): show the <img>
    const giveUp = (why: string) => {
      console.warn("[portrait] showing the plain photo:", why);
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      setGl(false);
    };

    const frame = (now: number) => {
      raf = 0;
      if (!ready || !visible || disposed || ctx.isContextLost()) return;
      state.hover += (state.hoverTarget - state.hover) * 0.12;
      state.mx += (state.tx - state.mx) * 0.16;
      state.my += (state.ty - state.my) * 0.16;
      ctx.uniform2f(u.mouse, state.mx, state.my);
      ctx.uniform1f(u.hover, state.hover);
      ctx.uniform1f(u.reveal, state.reveal);
      ctx.uniform1f(u.scroll, state.scroll);
      ctx.uniform1f(u.scan, state.scan);
      ctx.uniform1f(u.time, (now - start) / 1000);
      ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
      // once the photo has resolved, make sure the canvas really shows it (the photo is dark; a white frame is broken)
      if (!checked && state.reveal >= 1 && state.scan < 0 && state.hover < 0.01) {
        checked = true;
        const px = new Uint8Array(4);
        let bright = 0;
        for (const [fx, fy] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.3], [0.3, 0.8], [0.7, 0.75]]) {
          ctx.readPixels(Math.floor(cv.width * fx), Math.floor(cv.height * fy), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
          if (px[0] > 235) bright++;
        }
        if (bright === 5) return giveUp("the canvas is white");
      }
      // keep drawing only while the lens is on or settling; tweens and the scroll ask for frames themselves
      const settling = Math.abs(state.hoverTarget - state.hover) > 0.002 || Math.abs(state.tx - state.mx) + Math.abs(state.ty - state.my) > 0.001;
      if (state.hover > 0.002 || settling) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(frame);
    };

    // phones drop a WebGL context under memory pressure or in the background: show the photo, rebuild when it returns
    const lost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = 0;
      ready = false;
      setGl(false);
    };
    const restored = () => setEpoch((n) => n + 1);
    cv.addEventListener("webglcontextlost", lost);
    cv.addEventListener("webglcontextrestored", restored);
    // a page brought back from the background may have had its canvas cleared without any event
    const back = () => document.visibilityState === "visible" && kick();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      state.tx = (e.clientX - r.left) / r.width;
      state.ty = 1 - (e.clientY - r.top) / r.height;
      state.hoverTarget = 1;
      kick();
    };
    const leave = () => {
      state.hoverTarget = 0;
      kick();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", move);
    el.addEventListener("pointerleave", leave);
    // a touch ends with pointerup, or with pointercancel when the finger starts scrolling the page
    const up = (e: PointerEvent) => e.pointerType !== "mouse" && leave();
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", leave);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) kick();
    });
    io.observe(el);
    const ro = new ResizeObserver(() => ready && resize());
    ro.observe(el);

    const tweens: gsap.core.Animation[] = [];
    const stopIntro = onIntroDone(() => {
      if (reduce) return;
      if (!revealed) tweens.push(gsap.to(state, { reveal: 1, duration: 3.2, ease: "power2.inOut", delay: 0.15, onUpdate: kick }));
      // the scanning band: once after the reveal, then every few seconds (drawn only while it moves)
      tweens.push(
        gsap
          .timeline({ repeat: -1, repeatDelay: 6.5, delay: 3.1 })
          .fromTo(state, { scan: -0.1 }, { scan: 1.1, duration: 2.4, ease: "power1.inOut", onUpdate: kick })
          .set(state, { scan: -1, onComplete: kick }),
      );
    });
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: "bottom top",
      scrub: true,
      onUpdate: (self) => {
        state.scroll = self.progress;
        kick();
      },
    });

    kick();
    return () => {
      disposed = true;
      img.onload = null;
      stopIntro();
      tweens.forEach((t) => t.kill());
      st.kill();
      io.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", leave);
      cv.removeEventListener("webglcontextlost", lost);
      cv.removeEventListener("webglcontextrestored", restored);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("pageshow", back);
      // the context stays with the canvas: losing it here would leave a dead context for the next mount (Strict Mode)
      ctx.deleteTexture(tex);
      ctx.deleteBuffer(buf);
      ctx.deleteProgram(prog);
    };
  }, [src, epoch]);

  return (
    <div ref={wrap} className={`relative aspect-[4/5] touch-pan-y overflow-hidden bg-[#050505] ${className}`} data-cursor-label="AI">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={`absolute inset-0 size-full object-cover grayscale transition-opacity duration-700 ${gl ? "opacity-0" : "opacity-100"}`} fetchPriority="high" />
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
      <Detections items={detections} />
      <div aria-hidden className="pointer-events-none absolute inset-0 border border-white/10" />
    </div>
  );
}

/** Bounding boxes with corner brackets and scrambling labels, drawn in after the reveal. */
function Detections({ items }: { items: Detection[] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const boxes = el.querySelectorAll<HTMLElement>("[data-box]");
    if (reduce) {
      gsap.set(boxes, { opacity: 1 });
      return;
    }
    gsap.set(boxes, { opacity: 0 });
    const stop = onIntroDone(() => {
      boxes.forEach((b, i) => {
        const delay = 2.2 + Number(b.dataset.delay ?? i * 0.35);
        gsap.fromTo(b, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.6, ease: "expo.out", delay });
        const label = b.querySelector<HTMLElement>("[data-label]");
        if (label) scramble(label, label.dataset.text ?? "", delay + 0.1);
      });
    });
    return stop;
  }, []);
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0 font-mono text-[10px] uppercase tracking-[0.12em] text-white">
      {items.map((d) => {
        const [x0, y0, x1, y1] = d.box;
        return (
          <div
            key={d.label}
            data-box
            data-delay={d.delay}
            className="absolute"
            style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
          >
            <span className="absolute -left-px -top-px size-3 border-l border-t border-white" />
            <span className="absolute -right-px -top-px size-3 border-r border-t border-white" />
            <span className="absolute -bottom-px -left-px size-3 border-b border-l border-white" />
            <span className="absolute -bottom-px -right-px size-3 border-b border-r border-white" />
            <span className="absolute inset-0 border border-white/25" />
            <span className="absolute -top-[18px] left-0 flex gap-1.5 whitespace-nowrap bg-white px-1.5 py-[2px] leading-none text-black" dir="ltr">
              <span data-label data-text={d.label}>{d.label}</span>
              <span className="opacity-60">{d.score}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_#/<>";

/** Decodes a label from noise, left to right. */
function scramble(el: HTMLElement, text: string, delay: number) {
  const state = { p: 0 };
  gsap.to(state, {
    p: 1,
    duration: 0.9,
    delay,
    ease: "none",
    onUpdate: () => {
      const n = Math.floor(state.p * text.length);
      let out = text.slice(0, n);
      for (let i = n; i < text.length; i++) out += text[i] === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      el.textContent = out;
    },
    onComplete: () => {
      el.textContent = text;
    },
  });
}
