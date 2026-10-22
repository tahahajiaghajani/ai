"use client";

import { useEffect, useRef } from "react";

/**
 * Hero background: silk ribbons in the brand gradient flowing through one point of intersection
 * (the idea of the Pars logo). One full-screen fragment shader — no libraries. Renders at reduced
 * resolution, pauses off-screen / in hidden tabs / behind the chat, and draws a single still frame
 * for reduced motion. Falls back to the section's CSS gradient when WebGL is unavailable.
 */

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uDir;

float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
float th(float x){float e=exp(2.*clamp(x,-8.,8.));return (e-1.)/(e+1.);}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2((uv.x - .5) * aspect, uv.y - .5);
  float t = uTime;

  // the intersection point, low in the hero and nudged by the pointer
  vec2 c = vec2(uMouse.x * .10, -.33 + uMouse.y * .035);

  vec3 iris = vec3(.56,.53,1.);
  vec3 orchid = vec3(.76,.28,.62);
  vec3 pink = vec3(1.,.17,.56);

  vec3 col = vec3(.027,.024,.10);
  // aurora
  col += iris * .085 * (1. - smoothstep(0., 1.1, length(p - vec2(-.62 * aspect * .6, .42))));
  col += pink * .07 * (1. - smoothstep(0., 1., length(p - vec2(.55 * aspect * .6, -.46))));

  float xs = p.x * uDir;
  float cx = c.x * uDir;
  float spread = .30 + .04 * sin(t * .21);

  for (int i = 0; i < 11; i++) {
    float fi = float(i);
    float k = (fi - 5.) / 5.;
    float dx = xs - cx;
    // ribbons cross through the intersection (hourglass), with travelling waves on top
    float y = c.y + k * spread * th(dx * (1.55 + .25 * sin(fi * 1.7)))
            + .030 * sin(dx * 3.1 - t * .55 + fi * .9) * (1. - exp(-dx * dx * 6.))
            + .014 * sin(dx * 7.3 + t * .8 + fi * 2.1);
    float d = abs(p.y - y);
    float w = .0016 + .0011 * (1. - abs(k));
    float core = 1. - smoothstep(0., w * 1.6, d);
    float glow = .0042 / (d + .006);
    float lit = .45 + .55 * hash(vec2(fi, 3.1));
    float g = smoothstep(-.9, .9, dx);
    vec3 rc = mix(mix(iris, orchid, smoothstep(0., .55, g)), pink, smoothstep(.5, 1., g));
    float fade = (1. - smoothstep(aspect * .2, aspect * .62, abs(dx))) * .85 + .15;
    col += rc * (core * .72 + glow * .12) * lit * fade;
  }

  // the meeting point glows and breathes
  float r = length((p - c) * vec2(1., 1.5));
  col += mix(pink, vec3(1.), .25) * .32 * exp(-r * r * 90.) * (.82 + .18 * sin(t * 1.3));
  col += pink * .10 * exp(-r * r * 9.);

  // keep the headline area calm, vignette, grain
  col *= 1. - .35 * smoothstep(0., .5, p.y) * (1. - smoothstep(0., .75 * aspect, abs(p.x)));
  col *= 1. - smoothstep(.35, 1.25, length(p * vec2(.75, 1.35)));
  col += (hash(gl_FragCoord.xy + fract(t)) - .5) * .025;
  gl_FragColor = vec4(col, 1.);
}`;

export function HeroWaves({ dir }: { dir: "rtl" | "ltr" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const attrs: WebGLContextAttributes = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false };
    // without a real GPU (software rendering) the shader would burn the CPU: draw one still frame instead
    let gl = canvas.getContext("webgl", { ...attrs, failIfMajorPerformanceCaveat: true });
    let software = !gl;
    if (!gl) gl = canvas.getContext("webgl", attrs);
    if (!gl) return;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) software = true;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    gl.uniform1f(gl.getUniformLocation(prog, "uDir"), dir === "rtl" ? -1 : 1);

    const still = software || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
    let quality = window.innerWidth < 768 ? 0.55 : 0.7;
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * (software ? 0.4 : quality);
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };
    resize();

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    };

    let visible = true;
    let ready = false;
    let raf = 0;
    let last = performance.now();
    let time = 6;
    // adaptive: slow frames first halve the frame rate, then lower the resolution, then stop
    let fps30 = false;
    let skip = false;
    let slow = 0;
    let stopped = false;
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      skip = fps30 && !skip;
      if (!skip && document.documentElement.dataset.chat !== "open") {
        const t0 = performance.now();
        time += fps30 ? dt * 2 : dt;
        mouse.x += (mouse.tx - mouse.x) * 0.04;
        mouse.y += (mouse.ty - mouse.y) * 0.04;
        gl.uniform1f(uTime, time);
        gl.uniform2f(uMouse, mouse.x, mouse.y);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const cost = performance.now() - t0;
        slow = dt > 0.034 || cost > 12 ? slow + 1 : Math.max(0, slow - 1);
        if (slow > 40) {
          slow = 0;
          if (!fps30) fps30 = true;
          else if (quality > 0.4) {
            quality = 0.4;
            resize();
          } else stopped = true;
        }
      }
      if (!still && !stopped && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (ready && !raf && !stopped) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    io.observe(canvas);
    const onVis = () => !document.hidden && visible && start();
    const onResize = () => {
      resize();
      if (still) {
        gl.uniform1f(uTime, time);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", onResize, { passive: true });
    if (!still) window.addEventListener("pointermove", onMove, { passive: true });

    // first frame, then fade the canvas in over the CSS fallback; animate once the page is idle
    gl.uniform2f(uMouse, 0, 0);
    gl.uniform1f(uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.ready = "1";
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 1200));
    const begin = () =>
      idle(() => {
        ready = true;
        start();
      });
    if (document.readyState === "complete") begin();
    else window.addEventListener("load", begin, { once: true });

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("load", begin);
      // no loseContext(): a remount (StrictMode, fast refresh) gets the same context back
    };
  }, [dir]);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-[1.6s] data-[ready]:opacity-100" />;
}
