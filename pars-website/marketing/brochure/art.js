/* Generative art for the brochure, drawn as vector SVG in sheet millimetres (viewBox 0 0 303 216).
   Two silk streams — violet (management experience) and magenta (intelligence) — leave the QR on the back,
   wrap around the spine and meet at one point on the cover: the logo's "point of convergence". */
const drawArt = () => {
  const NS = "http://www.w3.org/2000/svg";
  const MM = 25.4 / 96;
  const f = (n) => +n.toFixed(2);

  /* Gradient words as SVG text. CSS background-clip:text prints, but some PDF viewers draw a hairline box around it;
     an SVG text filled with a gradient is plain vector text. The HTML text keeps its place (hidden) so nothing moves. */
  let gid = 0;
  for (const g of document.querySelectorAll(".g")) {
    let span = g;
    if (getComputedStyle(g).display !== "inline") {
      span = document.createElement("g-t"); // a tag no panel rule matches, inline by default
      span.append(...g.childNodes);
      g.append(span);
    }
    // bidi runs can split one line into several boxes; boxes on different lines mean the word wrapped
    const rects = [...span.getClientRects()];
    if (rects.some((r) => Math.abs(r.top - rects[0].top) > 1)) throw new Error("gradient text wraps onto two lines: " + span.textContent);
    const cs = getComputedStyle(span);
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    span.prepend(mark);
    const r = span.getBoundingClientRect();
    const base = mark.getBoundingClientRect().top - r.top;
    mark.remove();
    const text = span.textContent;
    const ltr = !/[\u0600-\u06ff]/.test(text) && /[a-z]/i.test(text);
    const id = "tg" + gid++;
    const w = r.width, h = r.height;
    span.style.position = "relative";
    span.innerHTML = `<g-h style="visibility:hidden">${span.innerHTML}</g-h>` +
      `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;overflow:visible;visibility:visible">` +
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.18"><stop offset="0" stop-color="#b8b1ff"/><stop offset=".48" stop-color="#e06bc0"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient></defs>` +
      `<text x="${w / 2}" y="${base}" text-anchor="middle" direction="${ltr ? "ltr" : "rtl"}" fill="url(#${id})" style="font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};letter-spacing:${cs.letterSpacing}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
    g.classList.remove("g");
  }

  // seeded PRNG so every render is identical
  let seed = 20101389;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const el = (parent, tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent.appendChild(n);
    return n;
  };

  /** element box in sheet mm */
  const box = (sheet, node) => {
    const s = sheet.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return { x0: (r.left - s.left) * MM, y0: (r.top - s.top) * MM, x1: (r.right - s.left) * MM, y1: (r.bottom - s.top) * MM,
      get cx() { return (this.x0 + this.x1) / 2; }, get cy() { return (this.y0 + this.y1) / 2; } };
  };

  /** Catmull-Rom through points, t ∈ [0, 1] */
  const spline = (pts) => {
    const n = pts.length - 1;
    return (t) => {
      const s = Math.min(n - 1e-9, Math.max(0, t * n));
      const i = Math.floor(s), u = s - i;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
      const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u);
      return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
    };
  };
  /** smooth 1-D profile through evenly spaced values */
  const profile = (vals) => {
    const s = spline(vals.map((v, i) => [i, v]));
    return (t) => s(t)[1];
  };

  const defs = (svg) => svg.querySelector("defs") || el(svg, "defs");
  const linear = (svg, id, x1, y1, x2, y2, stops) => {
    const g = el(defs(svg), "linearGradient", { id, gradientUnits: "userSpaceOnUse", x1, y1, x2, y2 });
    for (const [o, c, a = 1] of stops) el(g, "stop", { offset: o, "stop-color": c, "stop-opacity": a });
    return `url(#${id})`;
  };
  const radial = (svg, id, stops) => {
    const g = el(defs(svg), "radialGradient", { id });
    for (const [o, c, a = 1] of stops) el(g, "stop", { offset: o, "stop-color": c, "stop-opacity": a });
    return `url(#${id})`;
  };
  const glow = (svg, g, cx, cy, rx, ry, fill) => el(g, "ellipse", { cx, cy, rx, ry, fill });

  /**
   * A silk ribbon: n threads across a strip that twists around its centreline.
   * offset = W · (u·cosφ + κ·(u² − 1/12)·sinφ) — the curved cross-section keeps threads apart when the strip turns edge-on.
   */
  const ribbon = (g, o) => {
    const { pts, width, turns = 1, phase0 = 0, n = 26, sw = 0.18, op = 0.6, kappa = 0.55, S = 220, stroke, edgeBoost = 0.55, fill } = o;
    const C = spline(pts), W = profile(width);
    const P = [], N = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S, a = C(Math.max(0, t - 0.003)), b = C(Math.min(1, t + 0.003));
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      P.push(C(t)); N.push([-dy / L, dx / L]);
    }
    const at = (s, u) => {
      const t = s / S, w = Math.max(0, W(t)), ph = phase0 + turns * 2 * Math.PI * t;
      const off = w * (u * Math.cos(ph) + kappa * (u * u - 1 / 12) * Math.sin(ph));
      return [P[s][0] + N[s][0] * off, P[s][1] + N[s][1] * off];
    };
    if (fill) {
      let d = "";
      for (let s = 0; s <= S; s++) { const [x, y] = at(s, -0.5); d += (s ? "L" : "M") + f(x) + " " + f(y); }
      for (let s = S; s >= 0; s--) { const [x, y] = at(s, 0.5); d += "L" + f(x) + " " + f(y); }
      el(g, "path", { d: d + "Z", fill, opacity: o.fillOp ?? 0.08 });
    }
    const lines = [];
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1) - 0.5;
      let d = "";
      for (let s = 0; s <= S; s++) { const [x, y] = at(s, u); d += (s ? "L" : "M") + f(x) + " " + f(y); }
      const e = Math.pow(Math.abs(2 * u), 1.4);
      const p = el(g, "path", { d, fill: "none", stroke: typeof stroke === "function" ? stroke(u, k) : stroke, "stroke-width": f(sw * (1 + 0.3 * e)), opacity: f(op * (1 - edgeBoost + edgeBoost * e) * (0.85 + 0.3 * rnd())), "stroke-linecap": "round" });
      lines.push({ u, p });
    }
    return { at, S, C, W };
  };

  const particles = (g, rib, count, spread, colorFn, rMax = 0.42) => {
    for (let i = 0; i < count; i++) {
      const s = Math.floor(rnd() * rib.S), u = (rnd() - 0.5) * spread;
      const [x, y] = rib.at(s, u);
      const r = 0.12 + rnd() * rMax;
      el(g, "circle", { cx: f(x), cy: f(y), r: f(r), fill: colorFn(rnd()), opacity: f(0.35 + rnd() * 0.6) });
    }
  };
  const node = (g, svg, x, y, r = 0.85, halo = 7) => {
    el(g, "circle", { cx: x, cy: y, r: halo, fill: radial(svg, "nh" + Math.round(rnd() * 1e6), [[0, "#ffd6ea", 0.85], [0.18, "#ff4fa3", 0.55], [0.5, "#c2479f", 0.16], [1, "#8f86ff", 0]]) });
    el(g, "circle", { cx: x, cy: y, r, fill: "#fff" });
  };

  /* ═════════ OUTSIDE ═════════ */
  {
    const sheet = document.getElementById("outside");
    const svg = document.getElementById("art-out");
    const base = el(svg, "g");
    el(base, "rect", { x: 0, y: 0, width: 303, height: 216, fill: "#07061a" });

    const tile = box(sheet, document.getElementById("qr"));
    const h1 = box(sheet, document.querySelector(".cover h1"));
    const logo = box(sheet, document.querySelector(".cover .logo"));
    const P = [38, (logo.y1 + h1.y0) / 2 - 2]; // the meeting point, centred in the open field of the cover

    const glows = el(svg, "g");
    glow(svg, glows, P[0], P[1], 62, 54, radial(svg, "gP", [[0, "#df1173", 0.34], [0.45, "#7b235a", 0.16], [1, "#07061a", 0]]));
    glow(svg, glows, 92, 30, 50, 42, radial(svg, "gT", [[0, "#8f86ff", 0.16], [1, "#8f86ff", 0]]));
    glow(svg, glows, tile.cx, tile.cy, 52, 46, radial(svg, "gQ", [[0, "#8f86ff", 0.28], [0.5, "#c2479f", 0.1], [1, "#07061a", 0]]));
    glow(svg, glows, 270, 8, 58, 40, radial(svg, "gF", [[0, "#8f86ff", 0.2], [1, "#8f86ff", 0]]));
    glow(svg, glows, 60, 214, 70, 26, radial(svg, "gB", [[0, "#df1173", 0.14], [1, "#df1173", 0]]));

    // rings around the meeting point and around the QR: "signal"
    const rings = el(svg, "g", { fill: "none", stroke: "#a9a2ff", "stroke-width": 0.2 });
    [5, 10, 16].forEach((r, i) => el(rings, "circle", { cx: f(P[0]), cy: f(P[1]), r, opacity: 0.5 - i * 0.1, "stroke-dasharray": i === 1 ? "0.8 1.4" : "none" }));
    const open = el(defs(svg), "clipPath", { id: "qropen" });
    el(open, "rect", { x: 0, y: 0, width: 303, height: f(tile.y1 + 2.4) });
    const qrRings = el(rings, "g", { "clip-path": "url(#qropen)" });
    [3.2, 6.4].forEach((d, i) =>
      el(qrRings, "rect", { x: f(tile.x0 - d), y: f(tile.y0 - d), width: f(tile.x1 - tile.x0 + 2 * d), height: f(tile.y1 - tile.y0 + 2 * d), rx: 5 + d, opacity: 0.5 - i * 0.1, "stroke-dasharray": i === 1 ? "0.8 1.4" : "none" }),
    );

    const gV = linear(svg, "gV", tile.cx, 0, P[0], 0, [[0, "#b8b1ff"], [0.55, "#8f86ff"], [1, "#e06bc0"]]);
    const gM = linear(svg, "gM", tile.cx, 0, P[0], 0, [[0, "#ff4fa3"], [0.5, "#df1173"], [1, "#ff9ccc"]]);
    const gJ1 = linear(svg, "gJ1", P[0], 0, -4, 0, [[0, "#ffd6ea"], [0.4, "#c2479f"], [1, "#8f86ff"]]);
    const gJ2 = linear(svg, "gJ2", P[0], 0, -4, 0, [[0, "#ffd6ea"], [0.4, "#ff2b8f"], [1, "#df1173"]]);
    const ribs = el(svg, "g");
    const spine = 103;
    // violet: from the QR, out of its top-left, over the spine, down into the point
    const v = ribbon(ribs, {
      pts: [[tile.cx, tile.cy - 6], [tile.x0 - 6, tile.y0 + 7], [spine + 10, tile.y0 + 2], [spine - 6, P[1] - 30], [P[0] + 30, P[1] - 30], [P[0] + 10, P[1] - 10], P],
      width: [3, 6, 11, 15, 17, 9, 0.2], turns: 1.35, phase0: 0.4, n: 28, stroke: gV, op: 0.62, fill: gV, fillOp: 0.05,
    });
    // magenta: out of the QR's lower-left, over the spine lower down, up into the point
    const m = ribbon(ribs, {
      pts: [[tile.cx, tile.cy + 5], [tile.x0 - 5, tile.cy + 9], [spine + 9, tile.cy + 17], [spine - 8, P[1] + 34], [P[0] + 30, P[1] + 28], [P[0] + 10, P[1] + 9], P],
      width: [3, 6, 12, 16, 18, 9, 0.2], turns: 1.6, phase0: 2.1, n: 28, stroke: gM, op: 0.6, fill: gM, fillOp: 0.05,
    });
    // joined: one stream leaves the point towards the free edge
    const j = ribbon(ribs, {
      pts: [P, [P[0] - 10, P[1] + 3], [P[0] - 24, P[1] + 10], [-6, P[1] + 20]],
      width: [0.2, 7, 14, 20], turns: 0.7, phase0: 1.2, n: 32, stroke: (u) => (u < 0 ? gJ1 : gJ2), op: 0.66, fill: gJ2, fillOp: 0.05,
    });
    const pc = (r) => (r < 0.5 ? "#c9c4ff" : "#ff8cc4");
    const parts = el(svg, "g");
    particles(parts, v, 26, 1.3, pc);
    particles(parts, m, 26, 1.3, pc);
    particles(parts, j, 18, 1.2, pc);
    node(parts, svg, f(P[0]), f(P[1]), 0.9, 8);

    // annotations, like a technical drawing: what each stream is
    const notes = el(svg, "g", { fill: "none", stroke: "#c4beff", "stroke-width": 0.2, opacity: 0.8 });
    const annotate = (cls, [ax, ay], dx, dy, run, fa) => {
      const bx = ax + dx, by = ay + dy, cx = bx + run;
      el(notes, "path", { d: `M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}H${f(cx)}` });
      el(svg, "circle", { cx: f(ax), cy: f(ay), r: 0.8, fill: "#07061a", stroke: cls === "m" ? "#ff4fa3" : "#a9a2ff", "stroke-width": 0.3 });
      const d = document.createElement("div");
      d.className = "note";
      d.textContent = fa;
      sheet.appendChild(d);
      const w = d.getBoundingClientRect().width * MM, h = d.getBoundingClientRect().height * MM;
      d.style.top = f(by - h / 2) + "mm";
      d.style.left = f(run < 0 ? cx - 1.2 - w : cx + 1.2) + "mm";
    };
    const on = (r, t) => r.at(Math.round(t * r.S), 0);
    annotate("v", on(v, 0.76), -6, -12, -4, "تجربه‌ی سازمانی");
    annotate("m", on(m, 0.84), -6, 11, -4, "هوش مصنوعی");
    annotate("c", P, -7, -14, -3, "نقطه‌ی تلاقی");
  }

  /* ═════════ INSIDE ═════════ */
  {
    const sheet = document.getElementById("inside");
    const svg = document.getElementById("art-in");
    const base = el(svg, "g");
    el(base, "rect", { x: 0, y: 0, width: 303, height: 216, fill: "#07061a" });

    const core = box(sheet, document.getElementById("core"));
    const glows = el(svg, "g");
    glow(svg, glows, core.cx, core.cy, 60, 58, radial(svg, "gC", [[0, "#df1173", 0.24], [0.5, "#7b235a", 0.1], [1, "#07061a", 0]]));
    glow(svg, glows, 292, 18, 64, 50, radial(svg, "gR", [[0, "#8f86ff", 0.22], [1, "#8f86ff", 0]]));
    glow(svg, glows, 10, 200, 70, 50, radial(svg, "gL", [[0, "#8f86ff", 0.2], [1, "#8f86ff", 0]]));

    // the agent flow: inputs converge into the agents, results fan out
    const flow = el(svg, "g", { fill: "none", "stroke-linecap": "round" });
    const ins = [...document.querySelectorAll(".row.in .node")].map((n) => box(sheet, n));
    const outs = [...document.querySelectorAll(".row.out .node")].map((n) => box(sheet, n));
    const gin = linear(svg, "gin", 0, ins[0].y1, 0, core.y0, [[0, "#8f86ff", 0.9], [1, "#ff4fa3", 1]]);
    const gout = linear(svg, "gout", 0, core.y1, 0, outs[0].y0, [[0, "#ff4fa3", 1], [1, "#a9a2ff", 0.9]]);
    const bundle = (x0, y0, x1, y1, stroke, spread0, spread1, n = 7) => {
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1) - 0.5;
        const a = x0 + u * spread0, b = x1 + u * spread1, my = (y0 + y1) / 2;
        const tw = Math.sin(u * Math.PI) * 0.8;
        el(flow, "path", { d: `M${f(a)} ${f(y0)}C${f(a + tw)} ${f(my)} ${f(b - tw)} ${f(my)} ${f(b)} ${f(y1)}`, stroke, "stroke-width": 0.2, opacity: f(0.45 + 0.5 * Math.abs(2 * u)) });
      }
    };
    ins.forEach((n, i) => bundle(n.cx, n.y1, core.cx + (i - 1.5) * 4.2, core.y0, gin, 4.4, 1.2));
    outs.forEach((n, i) => bundle(core.cx + (i - 1.5) * 4.2, core.y1, n.cx, n.y0, gout, 1.2, 4.4));
    const ports = el(svg, "g");
    for (const n of ins) el(ports, "circle", { cx: f(n.cx), cy: f(n.y1), r: 0.55, fill: "#a9a2ff" });
    for (const n of outs) el(ports, "circle", { cx: f(n.cx), cy: f(n.y0), r: 0.55, fill: "#ff4fa3" });
    for (let i = 0; i < 4; i++) {
      el(ports, "circle", { cx: f(core.cx + (i - 1.5) * 4.2), cy: f(core.y0), r: 0.5, fill: "#ff4fa3" });
      el(ports, "circle", { cx: f(core.cx + (i - 1.5) * 4.2), cy: f(core.y1), r: 0.5, fill: "#ff4fa3" });
    }
    // packets on the way in
    for (let i = 0; i < 14; i++) {
      const n = ins[i % 4], t = 0.2 + rnd() * 0.6;
      const x = n.cx + (core.cx + ((i % 4) - 1.5) * 4.2 - n.cx) * (3 * t * t - 2 * t * t * t) + (rnd() - 0.5) * 2.4 * (1 - t);
      const y = n.y1 + (core.y0 - n.y1) * t;
      el(ports, "circle", { cx: f(x), cy: f(y), r: f(0.2 + rnd() * 0.25), fill: rnd() < 0.5 ? "#c9c4ff" : "#ff8cc4", opacity: f(0.5 + rnd() * 0.5) });
    }

    // the path of collaboration as one twisting thread through the five steps (step 1 is on the right)
    const dots = [...document.querySelectorAll("#steps .dot")].map((n) => box(sheet, n));
    const thread = el(svg, "g");
    const gs = linear(svg, "gs", dots[0].cx, 0, dots[4].cx, 0, [[0, "#8f86ff"], [0.5, "#c2479f"], [1, "#ff2b8f"]]);
    ribbon(thread, { pts: [[dots[0].cx + 6, dots[0].cy], ...dots.map((d) => [d.cx, d.cy]), [dots[4].cx - 6, dots[4].cy]], width: [0.4, 2.6, 3.2, 3.2, 3.2, 2.6, 0.4], turns: 3, n: 9, sw: 0.18, stroke: gs, op: 0.85, edgeBoost: 0.3 });

    // a quiet stream under the opening panel, entering from the trim edge
    const q = box(sheet, document.querySelector(".cin .quote"));
    const gq = linear(svg, "gq", 303, 0, 200, 0, [[0, "#ff4fa3", 0.9], [0.6, "#8f86ff", 0.6], [1, "#8f86ff", 0]]);
    const quiet = el(svg, "g");
    ribbon(quiet, { pts: [[306, q.y0 - 22], [282, q.y0 - 12], [256, q.y0 - 16], [228, q.y0 - 8], [201, q.y0 - 10]], width: [12, 10, 8, 6, 2], turns: 1.1, n: 22, stroke: gq, op: 0.38 });
  }
};
// layout depends on the fonts and the logo images: draw once both are in; render.mjs waits for data-ready
window.addEventListener("load", () =>
  document.fonts.ready.then(() => {
    const root = document.documentElement;
    try {
      drawArt();
      root.dataset.ready = "1";
    } catch (e) {
      root.dataset.error = e.message;
      root.dataset.ready = "error";
    }
  }),
);
