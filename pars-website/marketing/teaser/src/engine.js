/* Motion engine for the Pars teaser: everything is a pure function of time t, so any frame can be rendered on its own.
   GSAP timelines hold the choreography (seeked, never played); render(t) then syncs cameras, the canvas and the chapter bar. */
const W = 1920, H = 1080;
const FA = "۰۱۲۳۴۵۶۷۸۹";
const fa = (v) => String(v).replace(/\d/g, (d) => FA[d]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);

gsap.registerPlugin(CustomEase);
CustomEase.create("pars", "M0,0 C0.16,1 0.3,1 1,1"); // the brand's motion curve cubic-bezier(.16,1,.3,1)
CustomEase.create("parsInOut", "M0,0 C0.7,0 0.2,1 1,1");

/* ── DOM helpers ───────────────────────────────────────────── */
function h(tag, cls, parent, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  if (parent) parent.appendChild(n);
  return n;
}
function place(n, css) {
  Object.assign(n.style, css);
  return n;
}
/**
 * Persian text split into masked words (never letters: Persian letters join). Inline markup such as <span class="g">…</span>
 * is kept: an element becomes one word. The wrappers are custom tags so no panel CSS rule for span/b/p can restyle them.
 * Returns the inner elements to animate.
 */
function words(n, text) {
  const src = document.createElement("div");
  src.innerHTML = text;
  n.innerHTML = "";
  const word = (content) => {
    const o = document.createElement("w-o"), i = document.createElement("w-i");
    if (typeof content === "string") i.textContent = content;
    else i.appendChild(content);
    o.appendChild(i);
    n.appendChild(o);
  };
  for (const node of [...src.childNodes]) {
    if (node.nodeType === 3) {
      // spaces break; a no-break space (U+00A0) glues a term; a short function word never ends a line
      const parts = node.textContent.split(/[ \t\n]+/);
      if (/^[ \t\n]/.test(node.textContent) && n.childNodes.length) n.appendChild(document.createTextNode(" "));
      let carry = "";
      parts.forEach((p, i) => {
        if (!p) return;
        if (STICKY.has(p) && i < parts.length - 1 && parts.slice(i + 1).some(Boolean)) { carry += p + "\u00a0"; return; }
        word(carry + p);
        carry = "";
        if (i < parts.length - 1) n.appendChild(document.createTextNode(" "));
      });
      if (carry) word(carry.trimEnd());
    } else if (node.nodeName === "BR") n.appendChild(document.createElement("br"));
    else word(node);
  }
  return [...n.querySelectorAll("w-i")];
}
const STICKY = new Set(["و", "در", "به", "از", "با", "تا", "بر", "برای", "روی", "کنار", "هر", "یک", "این", "آن"]);
/** word-by-word rise, in reading order */
function rise(targets, opt = {}) {
  return gsap.fromTo(targets, { yPercent: 115, opacity: 0, filter: "blur(10px)" },
    { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: opt.dur ?? 0.9, ease: "pars", stagger: opt.stagger ?? 0.07 });
}
function sink(targets, opt = {}) {
  return gsap.to(targets, { yPercent: -100, opacity: 0, filter: "blur(8px)", duration: opt.dur ?? 0.5, ease: "power2.in", stagger: opt.stagger ?? 0.03 });
}
function fadeIn(t, d = 0.8, extra = {}) {
  return gsap.fromTo(t, { opacity: 0, ...extra.from }, { opacity: 1, duration: d, ease: "pars", ...extra.to });
}

const ICON = {
  ai: "M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM19 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z",
  lock: "M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z",
  predict: "M3 17l5-5 4 3 7-8M15 7h4v4",
  rag: "M4 4h9a3 3 0 013 3v13H7a3 3 0 01-3-3zM16 20a3 3 0 003-3V7M8 8h5M8 11h5M17.5 14.5L21 18",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8 11h6M11 8v6",
  agents: "M9 3h6M12 3v3M6 6h12a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2zM9 11v1M15 11v1M9 15h6",
  epm: "M4 5h16M4 5v14h16M7 9h6M9 13h7M8 17h4",
  report: "M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 14h7M9 17h4",
  pattern: "M6 6a2 2 0 100-4 2 2 0 000 4zM18 8a2 2 0 100-4 2 2 0 000 4zM12 14a2 2 0 100-4 2 2 0 000 4zM6 22a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4zM7.5 5l3.2 5.4M16.5 7l-3 4M10.6 13.4L7 18.5M13.5 13.2l3.2 3.6",
  execute: "M13 2L4 14h7l-1 8 9-12h-7z",
  human: "M12 11a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z M9 12l2 2 4-4",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  training: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6",
  migration: "M4 8h11l-3-3M20 16H9l3 3M15 8c3 0 5 2 5 4M9 16c-3 0-5-2-5-4",
  custom: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10zM12 13a1 1 0 100-2 1 1 0 000 2z",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-5-5.9",
  gauge: "M12 21a9 9 0 110-18 9 9 0 010 18zM12 12l4-4M7 16h10",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  check: "M5 12l5 5L20 7",
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  book: "M4 5a2 2 0 012-2h5v18H6a2 2 0 01-2-2zM20 5a2 2 0 00-2-2h-5v18h5a2 2 0 002-2z",
  building: "M4 21V5l8-2v18M12 7l8 2v12M7 9h2M7 13h2M7 17h2M15 12h2M15 16h2M2 21h20",
  cap: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2",
  pin: "M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  lockOpen: "M7 11V8a5 5 0 019.6-2M6 11h12v9H6z",
};
const icon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24"><path d="${ICON[name] || ICON.ai}"/></svg>`;

/** a sound cue for the music (scene-local time); main.js shifts it to the chapter start */
function hit(tl, t, kind) {
  (tl.cues ??= []).push({ t, kind });
}

/* ── seeded randomness (identical every render) ─────────────── */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── the background: ink, glows, silk ribbons, particles ───── */
const BG = {
  // tweenable state; scenes animate these
  glowA: { x: 0.18, y: 0.2, r: 0.55, a: 0.22 }, // violet
  glowB: { x: 0.85, y: 0.9, r: 0.6, a: 0.18 }, // magenta
  glowC: { x: 0.5, y: 0.5, r: 0.4, a: 0.0 }, // centre burst (white-pink)
  ribbons: 1, // overall ribbon opacity
  flowY: 0.72, // baseline of the main flowing ribbon (fraction of height)
  flowAmp: 1, // undulation
  converge: 0, // 0 = free flowing streams, 1 = two streams meeting at P
  P: { x: 0.5, y: 0.46 },
  particles: 0.8,
  dim: 0, // darken everything (for focus)
};

const Ribbon = (() => {
  const spline = (pts) => {
    const n = pts.length - 1;
    return (t) => {
      const s = Math.min(n - 1e-9, Math.max(0, t * n)), i = Math.floor(s), u = s - i;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
      const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u);
      return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
    };
  };
  const profile = (vals) => {
    const s = spline(vals.map((v, i) => [i, v]));
    return (t) => s(t)[1];
  };
  /** draws one silk ribbon: n threads across a strip that twists around its centre line */
  function draw(ctx, o) {
    const { pts, width, turns, phase, n = 28, alpha = 0.5, colors, lw = 1.3, S = 140, kappa = 0.55 } = o;
    if (alpha <= 0.002) return;
    const C = spline(pts), Wd = profile(width);
    const P = [], N = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S, a = C(Math.max(0, t - 0.004)), b = C(Math.min(1, t + 0.004));
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      P.push(C(t)); N.push([-dy / L, dx / L]);
    }
    const g = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
    colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
    ctx.strokeStyle = g;
    ctx.lineWidth = lw;
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1) - 0.5, e = Math.pow(Math.abs(2 * u), 1.4);
      ctx.globalAlpha = alpha * (0.35 + 0.65 * e);
      ctx.beginPath();
      for (let s = 0; s <= S; s++) {
        const t = s / S, w = Math.max(0, Wd(t)), ph = phase + turns * 2 * Math.PI * t;
        const off = w * (u * Math.cos(ph) + kappa * (u * u - 1 / 12) * Math.sin(ph));
        const x = P[s][0] + N[s][0] * off, y = P[s][1] + N[s][1] * off;
        s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  return { draw };
})();

const Background = (() => {
  const cv = () => document.getElementById("bg");
  const R = rng(1389);
  const parts = Array.from({ length: 140 }, () => ({ x: R(), y: R(), z: 0.3 + R() * 0.7, s: 0.6 + R() * 1.8, ph: R() * 6.28, c: R() < 0.55 ? "196,190,255" : "255,140,196" }));
  function glow(ctx, g, rgb) {
    if (g.a <= 0.002) return;
    const x = g.x * W, y = g.y * H, r = g.r * W;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${g.a})`);
    gr.addColorStop(0.5, `rgba(${rgb},${g.a * 0.35})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }
  // film grain: dithers the gradients (no banding after encoding) and gives the frame some texture
  const grain = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d"), id = x.createImageData(256, 256), r = rng(77);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 128 + (r() + r() + r() - 1.5) * 120;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    return c;
  })();
  function render(t) {
    const ctx = cv().getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#07061a";
    ctx.fillRect(0, 0, W, H);
    // slow drift keeps the glows alive between scene moves
    glow(ctx, { ...BG.glowA, x: BG.glowA.x + 0.03 * Math.sin(t * 0.11), y: BG.glowA.y + 0.03 * Math.cos(t * 0.09) }, "143,134,255");
    glow(ctx, { ...BG.glowB, x: BG.glowB.x + 0.03 * Math.cos(t * 0.08), y: BG.glowB.y + 0.02 * Math.sin(t * 0.12) }, "223,17,115");
    glow(ctx, BG.glowC, "255,200,230");

    ctx.globalCompositeOperation = "lighter";
    const a = BG.ribbons;
    if (a > 0.002) {
      const c = BG.converge;
      // stream 1 (violet, experience) and stream 2 (magenta, intelligence)
      const yb = BG.flowY * H, amp = 60 * BG.flowAmp;
      const P = [BG.P.x * W, BG.P.y * H];
      // stream 1 runs right→left, the same direction as its converged form, so mixing the two never folds it
      const free1 = [[2080, yb - 120], [1560, yb - 200 + amp * Math.sin(t * 0.23 + 2)], [1060, yb - 40 + amp * Math.cos(t * 0.19)], [480, yb - 220 + amp * Math.sin(t * 0.17 + 1)], [-150, yb - 120 + amp * Math.sin(t * 0.21)]];
      const free2 = [[-150, yb + 90 + amp * Math.cos(t * 0.2)], [520, yb + 10 + amp * Math.sin(t * 0.18 + 2)], [1000, yb + 160 + amp * Math.sin(t * 0.16)], [1500, yb + 30 + amp * Math.cos(t * 0.22 + 1)], [2080, yb + 120]];
      const conv1 = [[2080, P[1] - 380], [1600, P[1] - 300], [1200, P[1] - 150], [P[0] + 140, P[1] - 30], P];
      const conv2 = [[-160, P[1] + 380], [320, P[1] + 300], [720, P[1] + 150], [P[0] - 140, P[1] + 30], P];
      const mix = (A, B) => A.map((p, i) => [lerp(p[0], B[i][0], c), lerp(p[1], B[i][1], c)]);
      const wFree1 = [60, 140, 90, 120, 40], wFree2 = [40, 120, 90, 140, 60], wConv = [150, 140, 110, 50, 1];
      // the inner end is only solid once the streams actually meet; half-way it fades out instead of stopping mid-screen
      const endA = smooth(clamp((c - 0.55) / 0.45, 0, 1)).toFixed(3);
      Ribbon.draw(ctx, { pts: mix(free1, conv1), width: wFree1.map((v, i) => lerp(v, wConv[i], c)), turns: 1.4, phase: t * 0.35, n: 30, alpha: 0.42 * a, colors: ["rgba(143,134,255,0.0)", "#8f86ff", "#b8b1ff", `rgba(224,107,192,${endA})`], lw: 1.35 });
      Ribbon.draw(ctx, { pts: mix(free2, conv2), width: wFree2.map((v, i) => lerp(v, wConv[i], c)), turns: 1.7, phase: 2 - t * 0.31, n: 30, alpha: 0.4 * a, colors: ["rgba(255,43,143,0.0)", "#df1173", "#ff4fa3", `rgba(255,156,204,${endA})`], lw: 1.35 });
      if (c > 0.01) {
        // the joined stream leaves the meeting point
        const out = [P, [P[0] - 120, P[1] + 60], [P[0] - 420, P[1] + 220], [-200, P[1] + 330]];
        Ribbon.draw(ctx, { pts: out, width: [1, 60, 130, 180], turns: 0.9, phase: t * 0.4, n: 34, alpha: 0.45 * a * smooth(clamp((c - 0.6) / 0.4, 0, 1)), colors: ["#ffffff", "#ff4fa3", "#c2479f", "rgba(143,134,255,0.2)"], lw: 1.3 });
      }
    }
    if (BG.particles > 0.01) {
      for (const p of parts) {
        const x = ((p.x * W + t * 18 * p.z) % (W + 40)) - 20;
        const y = p.y * H + Math.sin(t * 0.5 * p.z + p.ph) * 14;
        const tw = 0.5 + 0.5 * Math.sin(t * 1.3 * p.z + p.ph);
        ctx.fillStyle = `rgba(${p.c},${(0.15 + 0.55 * tw) * BG.particles * p.z})`;
        ctx.beginPath();
        ctx.arc(x, y, p.s * p.z, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.07;
    const f = Math.floor(t * 60), ox = (f * 97) % 256, oy = (f * 61) % 256;
    for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) ctx.drawImage(grain, x, y);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (BG.dim > 0.002) {
      ctx.fillStyle = `rgba(7,6,26,${BG.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  return { render };
})();

/* ── a browser window with pages (demo screenshots), a camera per page, callouts and a cursor ── */
const Browsers = [];
const Pending = []; // promises the renderer waits for (redacted screenshots drawn to canvas)
class Page {
  /** screen: {src, w, h, redact?: [{x,y,w,h} %]} */
  constructor(b, screen) {
    this.b = b;
    this.screen = screen;
    this.vp = h("div", "vp", b.root);
    place(this.vp, { left: b.ins.l + "px", top: b.ins.t + "px", right: b.ins.r + "px", bottom: b.ins.b + "px", borderRadius: b.chrome ? "10px" : "26px" });
    this.layer = place(h("div", "imgl", this.vp), { width: screen.w + "px", height: screen.h + "px" });
    if (screen.redact && screen.redact.length) {
      // sample personal data (emails, names of companies…) is blurred in place, once, on a canvas
      this.img = h("canvas", "", this.layer);
      this.img.width = screen.w;
      this.img.height = screen.h;
      const im = new Image();
      im.src = screen.src;
      Pending.push(im.decode().then(() => {
        const x = this.img.getContext("2d");
        x.drawImage(im, 0, 0);
        for (const r of screen.redact) {
          const px = (r.x / 100) * screen.w, py = (r.y / 100) * screen.h, pw = (r.w / 100) * screen.w, ph = (r.h / 100) * screen.h;
          x.save();
          x.beginPath();
          x.rect(px, py, pw, ph);
          x.clip();
          x.filter = "blur(9px)";
          for (let i = 0; i < 3; i++) x.drawImage(this.img, 0, 0);
          x.restore();
        }
      }));
    } else {
      this.img = h("img", "", this.layer);
      this.img.src = screen.src;
    }
    this.img.style.width = screen.w + "px";
    this.img.style.height = screen.h + "px";
    // patches: small overlays in image px that repair a rendering glitch of the demo (e.g. raw markdown asterisks)
    for (const pt of screen.patches ?? []) place(h("div", "patch", this.layer, pt.html), { left: pt.x + "px", top: pt.y + "px", width: pt.w + "px", height: pt.h + "px", ...(pt.style ?? {}) });
    this.ov = h("div", "ov", this.vp);
    this.vw = b.box.w - b.ins.l - b.ins.r;
    this.vh = b.box.h - b.ins.t - b.ins.b;
    this.fit = this.vw / screen.w;
    this.zmin = Math.max(1, this.vh / (screen.h * this.fit)); // a short screenshot is zoomed to fill the window's height
    this.cam = this.top();
    this.callouts = [];
    gsap.set(this.vp, { opacity: 0 });
  }
  /** camera target that shows region r (% of the image) centred, as large as fits, clamped inside the image */
  frame(r, opt = {}) {
    const sw = this.screen.w, sh = this.screen.h;
    const rw = (r.w / 100) * sw, rh = (r.h / 100) * sh;
    const zlo = opt.fitWidth ? 1 : Math.max(opt.zmin ?? 1, this.zmin); // fitWidth: a region wider than the zoomed view may zoom out to the full width
    const z = clamp(Math.min((this.vw * (opt.fill ?? 0.78)) / (rw * this.fit), (this.vh * (opt.fill ?? 0.78)) / (rh * this.fit)), zlo, Math.max(zlo, opt.zmax ?? 1.45));
    const sc = this.fit * z;
    const halfW = this.vw / 2 / sc, halfH = this.vh / 2 / sc;
    let cx = ((r.x + r.w / 2) / 100) * sw + (opt.dx ?? 0) / sc, cy = ((r.y + r.h / 2) / 100) * sh + (opt.dy ?? 0) / sc;
    cx = clamp(cx, halfW, Math.max(halfW, sw - halfW));
    cy = clamp(cy, halfH, Math.max(halfH, sh - halfH));
    return { cx, cy, z };
  }
  top() {
    return { cx: this.screen.w / 2, cy: this.vh / 2 / (this.fit * this.zmin), z: this.zmin };
  }
  bottom() {
    return { cx: this.screen.w / 2, cy: this.screen.h - this.vh / 2 / (this.fit * this.zmin), z: this.zmin };
  }
  /** image-% rectangle → viewport px under the current camera */
  toVP(r) {
    const sc = this.fit * this.cam.z, sw = this.screen.w, sh = this.screen.h;
    const tx = this.vw / 2 - this.cam.cx * sc, ty = this.vh / 2 - this.cam.cy * sc;
    return { x: tx + (r.x / 100) * sw * sc, y: ty + (r.y / 100) * sh * sc, w: ((r.w ?? 0) / 100) * sw * sc, h: ((r.h ?? 0) / 100) * sh * sc };
  }
  apply() {
    const sc = this.fit * this.cam.z;
    const tx = this.vw / 2 - this.cam.cx * sc, ty = this.vh / 2 - this.cam.cy * sc;
    this.layer.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
  }
}

class Browser {
  /** box: {x, y, w, h} in stage px */
  constructor(parent, box, url, opt = {}) {
    this.box = box;
    this.chrome = opt.chrome ?? true;
    this.ins = this.chrome ? { l: 10, t: 46, r: 10, b: 10 } : { l: 0, t: 0, r: 0, b: 0 };
    this.root = place(h("div", this.chrome ? "browser" : "browser device", parent), { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" });
    this.root.innerHTML = this.chrome ? `<div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="url">${icon("lock")}<span class="u"></span></div><div style="width:52px"></div></div><div class="load"></div>` : "";
    this.url = url;
    this.urlEl = this.root.querySelector(".u");
    this.load = this.root.querySelector(".load");
    this.pages = [];
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "lead-line");
    this.root.appendChild(this.svg);
    this.cursor = h("div", "cursor", this.root, `<i class="ripple"></i><svg viewBox="0 0 28 28"><path d="M5 3l17 10.5-7.6 1.6 4.4 8.3-3.3 1.6-4.3-8.4L5 22z"/></svg>`);
    this.cur = { page: 0, x: 50, y: 50, o: 0, press: 0, ripple: 0 };
    this.ripple = this.cursor.querySelector(".ripple");
    Browsers.push(this);
  }
  page(screen) {
    const p = new Page(this, screen);
    p.url = screen.url ?? this.url;
    this.root.insertBefore(p.vp, this.svg);
    this.pages.push(p);
    return p;
  }
  apply() {
    let paths = "";
    if (this.urlEl) {
      // the address bar shows the page that is most visible
      let best = this.pages[0];
      for (const p of this.pages) if (+p.vp.style.opacity > +best.vp.style.opacity) best = p;
      if (best && this.urlEl.textContent !== best.url) this.urlEl.textContent = best.url;
    }
    for (const p of this.pages) {
      if (+p.vp.style.opacity === 0 && !p.callouts.some((c) => +c.state.line > 0.001)) continue;
      p.apply();
      for (const c of p.callouts) {
        const v = p.toVP(c.r), pad = 10;
        place(c.hl, { left: v.x - pad + "px", top: v.y - pad + "px", width: v.w + 2 * pad + "px", height: v.h + 2 * pad + "px" });
        const k = +c.state.line;
        if (k > 0.001) {
          // from the highlight's nearest edge (browser-root coordinates) to the card
          const hx = this.ins.l + clamp(c.side === "left" ? v.x - pad : v.x + v.w + pad, 0, p.vw), hy = this.ins.t + clamp(v.y + v.h / 2, 30, p.vh - 30);
          const cb = c.cardBox;
          const cx = c.side === "left" ? cb.x + cb.w : cb.x, cy = cb.y + 46;
          const ex = lerp(hx, cx, k), ey = lerp(hy, cy, k);
          paths += `<path d="M${hx} ${hy}C${lerp(hx, cx, 0.5)} ${hy} ${lerp(hx, cx, 0.5)} ${cy} ${ex} ${ey}" stroke="url(#lg)" stroke-width="3" fill="none" stroke-dasharray="${k * 2000} 2000"/>` +
            `<circle cx="${hx}" cy="${hy}" r="${7 * Math.min(1, k * 3)}" fill="#ff4fa3"/>`;
        }
      }
    }
    this.svg.innerHTML = `<defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#ff4fa3"/><stop offset="1" stop-color="#8f86ff"/></linearGradient></defs>` + paths;
    // the cursor lives in image coordinates of its page, so it rides along with the camera
    const cu = this.cur, pg = this.pages[cu.page | 0];
    if (pg && cu.o > 0.001) {
      const v = pg.toVP({ x: cu.x, y: cu.y });
      v.x = clamp(v.x, 4, pg.vw - 30);
      v.y = clamp(v.y, 4, pg.vh - 34);
      this.cursor.style.opacity = cu.o;
      this.cursor.style.transform = `translate(${this.ins.l - 6 + v.x}px, ${this.ins.t - 4 + v.y}px) scale(${1 - 0.18 * cu.press})`;
      this.ripple.style.opacity = cu.ripple > 0 && cu.ripple < 1 ? 1 - cu.ripple : 0;
      this.ripple.style.transform = `translate(-50%, -50%) scale(${0.2 + 1.6 * cu.ripple})`;
    } else this.cursor.style.opacity = 0;
  }
  /**
   * A callout on region r of page p: a highlight that follows the camera, a dimmed surround, a leader line and a card
   * hanging outside the window (side "left" | "right"); cardY in browser px. big: {value, dec, suf, label} = a counter card.
   */
  callout(p, r, { n, label, text, side = "left", cardY = 120, big }) {
    const hl = h("div", "hl", p.ov);
    const card = h("div", big ? "card big" : "card", this.root);
    const cardBox = { x: side === "left" ? -470 - 60 : this.box.w + 60, y: cardY, w: 470 };
    place(card, { left: cardBox.x + "px", top: cardBox.y + "px" });
    let wordsList;
    const c = { r, hl, card, side, cardBox, state: { line: 0 }, big };
    if (big) {
      card.innerHTML = `<div class="num"></div><div class="big-v"><span class="g"></span></div><b></b><p></p>`;
      c.valueEl = card.querySelector(".big-v .g");
      c.valueEl.textContent = fmtNum(0, big);
      wordsList = [...words(card.querySelector("b"), label), ...(text ? words(card.querySelector("p"), text) : [])];
    } else {
      card.innerHTML = `<div class="num"></div><b></b><p></p>`;
      wordsList = [...words(card.querySelector("b"), label), ...words(card.querySelector("p"), text)];
    }
    c.words = wordsList;
    p.callouts.push(c);
    gsap.set(hl, { opacity: 0 });
    gsap.set(card, { opacity: 0 });
    return c;
  }
}
const fmtNum = (v, big) => `\u061c${big.pre ?? ""}${fa((big.dec ? v.toFixed(big.dec) : String(Math.round(v))).replace(".", "٫"))}${big.suf ?? ""}`;

/** timeline of one callout: show (spotlight + line + card) and hide */
function showCallout(c, hold = 2.2) {
  const tl = gsap.timeline();
  tl.fromTo(c.hl, { opacity: 0, scale: 1.08, boxShadow: "0 0 0 4px #ff4fa3, 0 0 0 9999px rgba(7,6,26,0)" },
    { opacity: 1, scale: 1, boxShadow: "0 0 0 4px #ff4fa3, 0 0 0 9999px rgba(7,6,26,0.62)", duration: 0.6, ease: "pars" }, 0);
  tl.fromTo(c.state, { line: 0 }, { line: 1, duration: 0.55, ease: "power2.out" }, 0.25);
  tl.fromTo(c.card, { opacity: 0, x: c.side === "left" ? -40 : 40 }, { opacity: 1, x: 0, duration: 0.7, ease: "pars" }, 0.45);
  if (c.big) {
    const o = { v: 0 };
    tl.fromTo(o, { v: 0 }, { v: c.big.value, duration: 1.6, ease: "power3.out", onUpdate: () => (c.valueEl.textContent = fmtNum(o.v, c.big)) }, 0.5);
  }
  tl.add(rise(c.words, { stagger: 0.035, dur: 0.7 }), 0.5);
  tl.to({}, { duration: hold });
  tl.to([c.card], { opacity: 0, x: c.side === "left" ? -30 : 30, duration: 0.45, ease: "power2.in" });
  tl.to(c.state, { line: 0, duration: 0.35, ease: "power2.in" }, "<");
  tl.to(c.hl, { opacity: 0, boxShadow: "0 0 0 4px #ff4fa3, 0 0 0 9999px rgba(7,6,26,0)", duration: 0.45, ease: "power2.in" }, "<");
  return tl;
}
function camTo(p, target, dur = 1.3, ease = "parsInOut") {
  return gsap.to(p.cam, { ...target, duration: dur, ease });
}

/* ── chapter bar, corner mark and address (pure functions of t) ── */
const Chapters = { list: [] };
function renderChapters(t) {
  const bar = document.getElementById("chapters"), label = document.getElementById("chapterLabel");
  const list = Chapters.list;
  if (!bar.children.length) for (const c of list) if (!c.hidden) h("div", "seg", bar, "<i></i>");
  let cur = -1, seg = 0;
  list.forEach((c, i) => {
    if (t >= c.start && t < c.end) cur = i;
    if (c.hidden) return;
    bar.children[seg++].firstChild.style.width = clamp((t - c.start) / (c.end - c.start), 0, 1) * 100 + "%";
  });
  const c = list[cur];
  const vis = c && !c.hidden;
  const num = vis ? list.slice(0, cur + 1).filter((x) => !x.hidden).length : 0; // visible chapters only
  const key = vis ? `${cur}` : "";
  if (label.dataset.key !== key) {
    label.dataset.key = key;
    label.innerHTML = vis ? `<b>${fa(String(num).padStart(2, "0"))}</b><span>${c.name}</span>` : "";
  }
  const edge = c ? Math.min(t - c.start, c.end - t) : 0;
  label.style.opacity = vis ? clamp(edge / 0.6, 0, 1) : 0;
  // the bar leaves with the outro and comes back after the intro, so the loop seam is clean
  const total = list.length ? list[list.length - 1].end : 1;
  const first = list.find((x) => !x.hidden), last = [...list].reverse().find((x) => !x.hidden);
  const barIn = first ? clamp((t - first.start + 1) / 1.2, 0, 1) : 1, barOut = last ? clamp((last.end - t) / 1.2, 0, 1) : 1;
  bar.style.opacity = Math.min(barIn, barOut);
  // the corner mark steps aside while a large logo or mark is the subject; the address while the intro and outro hold the stage
  const near = (kinds, fade = 0.8) => {
    let k = 1;
    for (const x of list) if (kinds.includes(x.kind)) k = Math.min(k, clamp(Math.max(x.start - t, t - x.end) / fade, 0, 1));
    return k;
  };
  document.getElementById("bug").style.opacity = 0.92 * near(["intro", "agents", "capabilities", "outro"]);
  const url = document.getElementById("url");
  if (!url.innerHTML) url.innerHTML = `${icon("globe")}<span>${(window.QR_URL || "").replace(/^https?:\/\//, "")}</span>`;
  url.style.opacity = 0.9 * near(["intro", "outro"]);
}

/* ── frame renderer ─────────────────────────────────────────── */
let MASTER = null;
function renderFrame(t) {
  MASTER.totalTime(t, false);
  for (const b of Browsers) if (b.root.closest(".layer").style.visibility !== "hidden") b.apply();
  Background.render(t);
  renderChapters(t);
}
