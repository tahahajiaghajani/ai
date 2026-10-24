"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { finePointer, useMotionReduced } from "@/components/fx/motion";

/** [base, a, b, light] as 0–1 RGB — the brand's grounds, mixed as moving silk light. */
const PALETTES = {
  espresso: [
    [0.07, 0.051, 0.043],
    [0.06, 0.31, 0.29],
    [0.61, 0.37, 0.2],
    [0.95, 0.85, 0.69],
  ],
  paraiba: [
    [0.012, 0.075, 0.07],
    [0.05, 0.38, 0.36],
    [0.2, 0.72, 0.67],
    [0.86, 0.98, 0.95],
  ],
  cocoa: [
    [0.11, 0.082, 0.07],
    [0.42, 0.12, 0.15],
    [0.62, 0.38, 0.22],
    [0.97, 0.86, 0.72],
  ],
  porcelain: [
    [0.98, 0.965, 0.937],
    [0.93, 0.85, 0.78],
    [0.89, 0.79, 0.64],
    [1, 1, 1],
  ],
} as const;

export type AuraPalette = keyof typeof PALETTES;

const CSS_FALLBACK: Record<AuraPalette, CSSProperties> = {
  espresso: { background: "var(--mesh-espresso)" },
  paraiba: { background: "var(--mesh-paraiba)" },
  cocoa: { background: "var(--mesh-cocoa)" },
  porcelain: { background: "var(--mesh-porcelain)" },
};

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision mediump float;
uniform vec2 u_res;uniform float u_time;uniform vec2 u_mouse;uniform vec3 u_base;uniform vec3 u_a;uniform vec3 u_b;uniform vec3 u_c;uniform float u_light;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
vec2 uv=gl_FragCoord.xy/u_res;vec2 p=uv;float ar=u_res.x/u_res.y;p.x*=ar;
float t=u_time*.045;
vec2 q=vec2(fbm(p*1.3+t),fbm(p*1.3-t+3.1));
vec2 r=vec2(fbm(p*1.7+2.*q+vec2(1.7,9.2)+t*1.3),fbm(p*1.7+2.*q+vec2(8.3,2.8)-t));
float f=fbm(p*1.5+2.4*r);
float folds=sin(f*7.+r.x*3.5)*.5+.5;
float sheen=pow(folds,7.);
vec3 col=u_base;
col=mix(col,u_a,smoothstep(.3,.95,f)*.8);
col=mix(col,u_b,smoothstep(.5,1.,r.y)*.6);
col+=u_c*sheen*.2*u_light;
vec2 m=u_mouse;m.x*=ar;float d=distance(p,m);
col+=u_c*.16*u_light*exp(-d*d*5.);
col*=mix(.7,1.,1.-smoothstep(.15,1.25,distance(uv,vec2(.5))));
gl_FragColor=vec4(col,1.);
}`;

/**
 * A living light behind a band: slow silk folds of the brand colours (WebGL, half resolution, ~30fps,
 * paused off-screen) that lean towards the pointer. Falls back to the CSS mesh ground; one still frame
 * with reduced motion (live: the footer toggle and the OS setting apply at once). The GL context is created
 * only when the band comes within a screen of the viewport, and released when the band leaves the page.
 */
export function Aura({ palette = "espresso", className = "", light = 1 }: { palette?: AuraPalette; className?: string; light?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useMotionReduced();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let stop: (() => void) | undefined;
    const near = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || stop) return;
        near.disconnect();
        stop = run(canvas, palette, light, reduced);
      },
      { rootMargin: "100% 0px" },
    );
    near.observe(canvas);
    return () => {
      near.disconnect();
      stop?.();
    };
  }, [palette, light, reduced]);

  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} style={CSS_FALLBACK[palette]}>
      <canvas ref={ref} className="absolute inset-0 size-full opacity-0 transition-opacity duration-1000 data-ready:opacity-100" />
    </div>
  );
}

/** Draws the silk light on `canvas` until the returned cleanup runs. */
function run(canvas: HTMLCanvasElement, palette: AuraPalette, light: number, still: boolean): (() => void) | undefined {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
  if (!gl) return;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const [base, a, b, c] = PALETTES[palette];
  gl.uniform3fv(u("u_base"), base);
  gl.uniform3fv(u("u_a"), a);
  gl.uniform3fv(u("u_b"), b);
  gl.uniform3fv(u("u_c"), c);
  gl.uniform1f(u("u_light"), light);
  const uRes = u("u_res");
  const uTime = u("u_time");
  const uMouse = u("u_mouse");

  const mouse = { x: 0.62, y: 0.6, tx: 0.62, ty: 0.6 };
  const scale = 0.5;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * scale));
    canvas.height = Math.max(1, Math.round(r.height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };
  resize();
  canvas.dataset.ready = "";

  let raf = 0;
  let last = 0;
  let visible = true;
  const t0 = performance.now() - 40000 * Math.random();
  const draw = (now: number) => {
    raf = 0;
    if (!visible) return;
    if (now - last >= 33) {
      last = now;
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!still) raf = requestAnimationFrame(draw);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting && document.visibilityState === "visible";
    kick();
  });
  io.observe(canvas);
  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(canvas);
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) / r.width;
    mouse.ty = 1 - (e.clientY - r.top) / r.height;
  };
  if (!still && finePointer()) window.addEventListener("pointermove", onMove, { passive: true });
  kick();
  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener("pointermove", onMove);
    // free the GPU objects; the context itself is kept while the canvas stays (the effect runs again on the same
    // canvas: Strict Mode, Fast Refresh, the motion toggle) and released once the canvas has left the page, so
    // client navigation never piles up contexts until the browser evicts them
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const lose = gl.getExtension("WEBGL_lose_context");
    setTimeout(() => {
      if (!canvas.isConnected) lose?.loseContext();
    }, 0);
  };
}
