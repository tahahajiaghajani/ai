/* Generative art for the booth, drawn as vector SVG in centimetres (viewBox = the printed file).
   The logo's two silk streams — violet for organisational experience, magenta for intelligence — meet at one point:
   the "point of convergence". Seeded, so every render is identical. */
const drawArt = () => {
  const NS = "http://www.w3.org/2000/svg";
  const CM = 96 / 2.54; // CSS px per cm
  const f = (n) => +n.toFixed(2);
  const W = SIZE.w, H = SIZE.h;
  const svg = document.getElementById("art");
  svg.setAttribute("viewBox", `0 0 ${W + OVER} ${H + OVER}`); // 1 unit = 1 cm over the whole board, overscan included
  svg.setAttribute("preserveAspectRatio", "none");

  const PAL = DARK
    ? { base: ["#1c1d58", "#141547", "#0c0d33"], glowV: "#8f86ff", glowM: "#df1173", glowP: "#7b235a", node: ["#ffd6ea", "#ff4fa3", "#c2479f", "#8f86ff"],
        v: ["#c9c4ff", "#8f86ff", "#e06bc0"], m: ["#ff6fb5", "#df1173", "#ff9ccc"], j: ["#ffd6ea", "#c2479f", "#8f86ff"], j2: ["#ffd6ea", "#ff2b8f", "#df1173"],
        part: ["#c9c4ff", "#ff8cc4"], text: ["#b8b1ff", "#e06bc0", "#ff4fa3"], op: 1, dots: "rgba(196,190,255,.16)" }
    : { base: ["#ffffff", "#f7f5fc", "#efebf8"], glowV: "#c9c3ff", glowM: "#ffb8da", glowP: "#e9d6f0", node: ["#ffffff", "#ff7ab8", "#df1173", "#8f86ff"],
        v: ["#8f86ff", "#5b52d6", "#a1308a"], m: ["#ff4fa3", "#df1173", "#a1308a"], j: ["#7b235a", "#a1308a", "#5b52d6"], j2: ["#df1173", "#b0145f", "#7b235a"],
        part: ["#8f86ff", "#ff4fa3"], text: ["#5b52d6", "#a1308a", "#df1173"], op: 0.78, dots: "rgba(26,24,58,.09)" };

  // seeded PRNG, one seed per item, style and mode (FNV-1a of the three)
  let seed = [...`${ITEM}/${STYLE}/${MODE}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
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
  const defs = el(svg, "defs");
  let gid = 0;
  const linear = (x1, y1, x2, y2, stops) => {
    const id = "lg" + gid++;
    const g = el(defs, "linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2) });
    stops.forEach(([o, c, a = 1]) => el(g, "stop", { offset: o, "stop-color": c, "stop-opacity": a }));
    return `url(#${id})`;
  };
  const radial = (stops) => {
    const id = "rg" + gid++;
    const g = el(defs, "radialGradient", { id });
    stops.forEach(([o, c, a = 1]) => el(g, "stop", { offset: o, "stop-color": c, "stop-opacity": a }));
    return `url(#${id})`;
  };
  /** element box in board cm */
  const bx = (node) => {
    const s = board.getBoundingClientRect(), r = node.getBoundingClientRect();
    return { x0: (r.left - s.left) / CM, y0: (r.top - s.top) / CM, x1: (r.right - s.left) / CM, y1: (r.bottom - s.top) / CM,
      get cx() { return (this.x0 + this.x1) / 2; }, get cy() { return (this.y0 + this.y1) / 2; } };
  };

  /* headlines marked .fit never wrap: shrink until every line fits its box */
  for (const n of document.querySelectorAll(".fit")) {
    n.style.whiteSpace = "nowrap";
    let fs = parseFloat(n.style.fontSize);
    while (n.scrollWidth > n.clientWidth + 1 && fs > 1) { fs *= 0.98; n.style.fontSize = fs + "cm"; }
  }

  /* gradient words as SVG text (CSS background-clip:text leaves hairline boxes in some PDF viewers) */
  for (const g of document.querySelectorAll(".g")) {
    const rects = [...g.getClientRects()];
    if (rects.some((r) => Math.abs(r.top - rects[0].top) > 1)) throw new Error("gradient text wraps onto two lines: " + g.textContent);
    const cs = getComputedStyle(g);
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    g.prepend(mark);
    const r = g.getBoundingClientRect();
    const base = mark.getBoundingClientRect().top - r.top;
    mark.remove();
    const text = g.textContent;
    const id = "tg" + gid++;
    const w = r.width, h = r.height;
    g.style.position = "relative";
    g.style.display = "inline-block";
    g.innerHTML = `<span style="visibility:hidden">${g.innerHTML}</span>` +
      `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;overflow:visible">` +
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.2"><stop offset="0" stop-color="${PAL.text[0]}"/><stop offset=".5" stop-color="${PAL.text[1]}"/><stop offset="1" stop-color="${PAL.text[2]}"/></linearGradient></defs>` +
      `<text x="${w / 2}" y="${base}" text-anchor="middle" direction="rtl" fill="url(#${id})" style="font-family:${cs.fontFamily.replace(/"/g, "'")};font-size:${cs.fontSize};font-weight:${cs.fontWeight}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
  }

  /* ── background: a navy (or mist) field, soft glows, a quiet dot grid on the detailed boards ── */
  // diagonal light, except on the counter: its two folded sides must print in the same tone
  const bgDir = ITEM === "counter" ? [0, 0, 0, H] : [W, 0, 0, H];
  el(svg, "rect", { x: 0, y: 0, width: W + OVER, height: H + OVER, fill: linear(...bgDir, [[0, PAL.base[0]], [0.5, PAL.base[1]], [1, PAL.base[2]]]) });
  const glow = (cx, cy, rx, ry, color, a) => el(svg, "ellipse", { cx: f(cx), cy: f(cy), rx: f(rx), ry: f(ry), fill: radial([[0, color, a], [0.55, color, a * 0.32], [1, color, 0]]) });
  if (STYLE === "detailed") {
    const step = ITEM === "popup" ? 6 : 3.2, r = ITEM === "popup" ? 0.32 : 0.17;
    // real circles in one path: a PDF tiling pattern is rasterised coarsely by some RIPs and viewers
    let d = "";
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) d += `M${f(x - r)} ${f(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    el(svg, "path", { d, fill: PAL.dots });
  }

  /* ── silk ribbon: n threads across a strip that twists around its centreline ── */
  const spline = (pts) => {
    const n = pts.length - 1;
    return (t) => {
      const s = Math.min(n - 1e-9, Math.max(0, t * n)), i = Math.floor(s), u = s - i;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
      const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u);
      return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
    };
  };
  const profile = (vals) => { const s = spline(vals.map((v, i) => [i, v])); return (t) => s(t)[1]; };
  const ribbon = (o) => {
    const { pts, width, turns = 1, phase0 = 0, n = 30, sw = 0.12, op = 0.6, kappa = 0.55, S = 260, stroke, edgeBoost = 0.55, fill, fillOp = 0.06 } = o;
    const g = el(svg, "g");
    const C = spline(pts), Wd = profile(width);
    const P = [], N = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S, a = C(Math.max(0, t - 0.003)), b = C(Math.min(1, t + 0.003));
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      P.push(C(t)); N.push([-dy / L, dx / L]);
    }
    const at = (s, u) => {
      const t = s / S, w = Math.max(0, Wd(t)), ph = phase0 + turns * 2 * Math.PI * t;
      const off = w * (u * Math.cos(ph) + kappa * (u * u - 1 / 12) * Math.sin(ph));
      return [P[s][0] + N[s][0] * off, P[s][1] + N[s][1] * off];
    };
    if (fill) {
      let d = "";
      for (let s = 0; s <= S; s++) { const [x, y] = at(s, -0.5); d += (s ? "L" : "M") + f(x) + " " + f(y); }
      for (let s = S; s >= 0; s--) { const [x, y] = at(s, 0.5); d += "L" + f(x) + " " + f(y); }
      el(g, "path", { d: d + "Z", fill, opacity: fillOp });
    }
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1) - 0.5;
      let d = "";
      for (let s = 0; s <= S; s++) { const [x, y] = at(s, u); d += (s ? "L" : "M") + f(x) + " " + f(y); }
      const e = Math.pow(Math.abs(2 * u), 1.4);
      el(g, "path", { d, fill: "none", stroke, "stroke-width": f(sw * (1 + 0.3 * e)), opacity: f(op * PAL.op * (1 - edgeBoost + edgeBoost * e) * (0.85 + 0.3 * rnd())), "stroke-linecap": "round" });
    }
    return { at, S };
  };
  const particles = (rib, count, spread, rMax) => {
    for (let i = 0; i < count; i++) {
      const s = Math.floor(rnd() * rib.S), u = (rnd() - 0.5) * spread;
      const [x, y] = rib.at(s, u);
      el(svg, "circle", { cx: f(x), cy: f(y), r: f(rMax * (0.25 + 0.75 * rnd())), fill: PAL.part[rnd() < 0.5 ? 0 : 1], opacity: f((0.35 + rnd() * 0.6) * PAL.op) });
    }
  };
  const node = (x, y, r, halo) => {
    el(svg, "circle", { cx: f(x), cy: f(y), r: f(halo), fill: radial([[0, PAL.node[0], 0.9], [0.18, PAL.node[1], 0.55], [0.5, PAL.node[2], 0.16], [1, PAL.node[3], 0]]) });
    el(svg, "circle", { cx: f(x), cy: f(y), r: f(r), fill: DARK ? "#fff" : "#df1173" });
  };
  /** two streams that meet at P, and the joined stream that leaves it */
  const converge = ({ P, v, m, j, sw, n = 30, op = 0.62, parts = 30, pr = 0.3 }) => {
    const gV = linear(v.pts[0][0], v.pts[0][1], P[0], P[1], [[0, PAL.v[0]], [0.55, PAL.v[1]], [1, PAL.v[2]]]);
    const gM = linear(m.pts[0][0], m.pts[0][1], P[0], P[1], [[0, PAL.m[0]], [0.5, PAL.m[1]], [1, PAL.m[2]]]);
    const rv = ribbon({ ...v, pts: [...v.pts, P], n, sw, op, stroke: gV, fill: gV });
    const rm = ribbon({ ...m, pts: [...m.pts, P], n, sw, op, stroke: gM, fill: gM });
    let rj = null;
    if (j) {
      const end = j.pts[j.pts.length - 1];
      const gJ = linear(P[0], P[1], end[0], end[1], [[0, PAL.j2[0]], [0.4, PAL.j2[1]], [1, PAL.j2[2]]]);
      rj = ribbon({ ...j, pts: [P, ...j.pts], n: n + 4, sw, op: op * 1.05, stroke: gJ, fill: gJ });
    }
    for (const r of [rv, rm, rj]) if (r) particles(r, parts, 1.4, pr);
    return { rv, rm, rj };
  };

  /* ═══ per item ═══ */
  if (ITEM === "popup") {
    glow(300, 18, 150, 110, PAL.glowV, DARK ? 0.32 : 0.55);
    glow(30, 220, 170, 90, PAL.glowP, DARK ? 0.4 : 0.5);
    if (STYLE === "minimal") {
      const P = [96, 100];
      glow(P[0], P[1], 120, 95, PAL.glowM, DARK ? 0.38 : 0.45);
      // violet falls from the top of the face, clear of the mark on the return; magenta rises from the floor
      converge({
        P, sw: 0.2, op: 0.66, parts: 44, pr: 0.45,
        v: { pts: [[46, -6], [52, 22], [62, 50], [78, 78]], width: [30, 34, 26, 12, 0.5], turns: 1.25, phase0: 0.4 },
        m: { pts: [[-6, 204], [26, 194], [54, 160], [78, 122]], width: [30, 36, 26, 12, 0.5], turns: 1.5, phase0: 2.1 },
        j: { pts: [[116, 116], [158, 156], [222, 184], [296, 194], [367, 188]], width: [0.5, 12, 24, 32, 32, 30], turns: 1.1, phase0: 1.2 },
      });
      node(P[0], P[1], 0.9, 11);
    } else {
      // a thread through the four steps of an agent (read → … → act, right to left)
      const dots = [...document.querySelectorAll(".flow .dot")].map(bx);
      const gT = linear(dots[0].cx, 0, dots[3].cx, 0, [[0, PAL.v[1]], [0.5, PAL.j[1]], [1, PAL.m[1]]]);
      ribbon({ pts: [[dots[0].x1 + 8, dots[0].cy], ...dots.map((d) => [d.cx, d.cy]), [dots[3].x0 - 8, dots[3].cy]], width: [0.4, 3.4, 4.2, 4.2, 4.2, 3.4, 0.4], turns: 3, n: 11, sw: 0.16, op: 0.85, edgeBoost: 0.3, stroke: gT });
      // the streams come round the left return, meet just inside the face and run between the hero row and the statistics
      const P = [40, 92.5];
      glow(P[0], P[1], 70, 50, PAL.glowM, DARK ? 0.3 : 0.4);
      converge({
        P, sw: 0.16, op: 0.6, parts: 30, pr: 0.32, n: 24,
        v: { pts: [[-6, 38], [10, 58], [24, 78]], width: [22, 22, 12, 0.4], turns: 1.1, phase0: 0.6 },
        m: { pts: [[-6, 152], [12, 128], [26, 107]], width: [22, 22, 12, 0.4], turns: 1.3, phase0: 2.2 },
        j: { pts: [[70, 93], [140, 92], [210, 93.5], [290, 92], [330, 93], [367, 88]], width: [0.4, 4.2, 4.6, 4.6, 4.6, 5.5, 14], turns: 4, phase0: 1.2 },
      });
      node(P[0], P[1], 0.7, 8);
      // below 140 the counters may stand: a broad, calm silk carries the art there, and a quiet stream runs along the floor
      const gL = linear(0, 0, W, 0, [[0, PAL.v[1]], [0.5, PAL.j[1]], [1, PAL.m[1]]]);
      ribbon({ pts: [[-6, 204], [70, 180], [160, 190], [250, 168], [367, 178]], width: [16, 26, 22, 28, 20], turns: 1.3, phase0: 0.8, n: 30, sw: 0.14, op: 0.5, stroke: gL, fill: gL, fillOp: 0.05 });
      const gB = linear(0, 0, W, 0, [[0, PAL.v[1], 0.9], [0.5, PAL.j[1], 0.8], [1, PAL.m[1], 0.9]]);
      ribbon({ pts: [[-6, 222], [90, 216], [180, 224], [270, 216], [367, 222]], width: [10, 12, 10, 12, 10], turns: 2, n: 22, sw: 0.14, op: 0.42, stroke: gB });
    }
  }

  if (ITEM === "rollup1" || ITEM === "rollup2") {
    const R = ITEM === "rollup1"; // roll-up 1 flows in from the right, roll-up 2 from the left: a mirrored pair
    const mx = (x) => (R ? x : W - x);
    glow(mx(80), 20, 60, 50, PAL.glowV, DARK ? 0.3 : 0.5);
    glow(mx(10), 200, 70, 50, PAL.glowP, DARK ? 0.4 : 0.5);
    if (STYLE === "minimal" && R) {
      // roll-up 1: the two streams enter from the outer edge under the services and meet
      const P = [mx(31), 171];
      glow(P[0], P[1], 46, 34, PAL.glowM, DARK ? 0.42 : 0.5);
      converge({
        P, sw: 0.09, op: 0.66, parts: 26, pr: 0.2, n: 28,
        v: { pts: [[mx(101), 150], [mx(84), 152], [mx(64), 158], [mx(46), 165]], width: [12, 15, 13, 9, 0.3], turns: 1.2, phase0: 0.5 },
        m: { pts: [[mx(101), 194], [mx(84), 192], [mx(64), 186], [mx(46), 178]], width: [12, 15, 13, 9, 0.3], turns: 1.45, phase0: 2.1 },
        j: { pts: [[mx(22), 175], [mx(10), 181], [mx(-6), 186]], width: [0.3, 7, 11, 13], turns: 0.8, phase0: 1.4 },
      });
      node(P[0], P[1], 0.45, 5.5);
    } else if (STYLE === "minimal") {
      // roll-up 2: the two streams rise side by side from the outer edge, with five glowing nodes
      glow(mx(40), 172, 50, 34, PAL.glowM, DARK ? 0.36 : 0.45);
      const gV = linear(mx(0), 0, mx(W), 0, [[0, PAL.v[0]], [0.6, PAL.v[1]], [1, PAL.v[2]]]);
      const gM = linear(mx(0), 0, mx(W), 0, [[0, PAL.m[0]], [0.5, PAL.m[1]], [1, PAL.m[2]]]);
      const rv = ribbon({ pts: [[mx(-6), 190], [mx(20), 180], [mx(50), 171], [mx(78), 158], [mx(101), 150]], width: [9, 12, 11, 10, 8], turns: 1.6, phase0: 0.5, n: 24, sw: 0.09, op: 0.62, stroke: gV, fill: gV });
      const rm = ribbon({ pts: [[mx(-6), 206], [mx(22), 194], [mx(52), 186], [mx(80), 174], [mx(101), 167]], width: [9, 12, 11, 10, 8], turns: 1.4, phase0: 2.2, n: 24, sw: 0.09, op: 0.62, stroke: gM, fill: gM });
      particles(rv, 22, 1.4, 0.2);
      particles(rm, 22, 1.4, 0.2);
      for (let i = 0; i < 5; i++) { const [x, y] = rv.at(Math.round(rv.S * (0.18 + i * 0.16)), 0); node(x, y, 0.32, 2.6); }
    } else {
      // a silk band down the outer edge (right on roll-up 1, left on roll-up 2), inside the trim
      const x0 = mx(87.5);
      const gE = linear(0, 0, 0, H, [[0, PAL.v[0]], [0.5, PAL.j[1]], [1, PAL.m[1]]]);
      ribbon({ pts: [[x0, -6], [x0 - (R ? 0.6 : -0.6), 50], [x0 + (R ? 0.4 : -0.4), 110], [x0 - (R ? 0.5 : -0.5), 160], [x0, 216]], width: [3.5, 4.5, 4, 4.5, 3.5], turns: 4, n: 18, sw: 0.08, op: 0.7, stroke: gE, fill: gE, fillOp: 0.05 });
      if (ITEM === "rollup2") {
        const dots = [...document.querySelectorAll(".path .dot")].map(bx);
        const gT = linear(dots[0].cx, 0, dots[4].cx, 0, [[0, PAL.v[1]], [0.5, PAL.j[1]], [1, PAL.m[1]]]);
        ribbon({ pts: [[dots[0].x1 + 3, dots[0].cy], ...dots.map((d) => [d.cx, d.cy]), [dots[4].x0 - 3, dots[4].cy]], width: [0.2, 1.6, 2, 2, 2, 2, 1.6, 0.2], turns: 3, n: 9, sw: 0.07, op: 0.85, edgeBoost: 0.3, stroke: gT });
      }
    }
  }

  if (ITEM === "counter") {
    glow(107, 20, 60, 40, PAL.glowV, DARK ? 0.32 : 0.5);
    if (STYLE === "minimal") {
      const P = [107, 80];
      glow(P[0], P[1], 50, 26, PAL.glowM, DARK ? 0.4 : 0.5);
      converge({
        P, sw: 0.1, op: 0.62, parts: 30, pr: 0.22, n: 26,
        v: { pts: [[-5, 28], [22, 50], [50, 66], [80, 76]], width: [14, 16, 13, 8, 0.3], turns: 1.4, phase0: 0.5 },
        m: { pts: [[219, 28], [192, 50], [164, 66], [134, 76]], width: [14, 16, 13, 8, 0.3], turns: 1.6, phase0: 2.1 },
      });
      node(P[0], P[1], 0.45, 5);
    } else {
      const P = [107, 82];
      glow(P[0], P[1], 46, 18, PAL.glowM, DARK ? 0.34 : 0.45);
      converge({
        P, sw: 0.08, op: 0.55, parts: 18, pr: 0.18, n: 20,
        v: { pts: [[-5, 84], [30, 80], [60, 84], [86, 82]], width: [6, 8, 7, 4, 0.3], turns: 2, phase0: 0.5 },
        m: { pts: [[219, 84], [184, 80], [154, 84], [128, 82]], width: [6, 8, 7, 4, 0.3], turns: 2.2, phase0: 2.1 },
      });
      node(P[0], P[1], 0.35, 3.5);
    }
  }

  if (ITEM === "swatch") {
    // the finest to the widest thread on the boards, each with the opacity of the board thread it stands for
    // (0.7 mm: roll-up 2 path; 0.9 mm: minimal roll-ups; 1.4 mm: lower pop-up silk; 2 mm: minimal pop-up)
    [[0.07, 0.85, 0.3], [0.09, 0.66, 0.55], [0.14, 0.5, 0.55], [0.2, 0.66, 0.55]].forEach(([sw, op, edgeBoost], i) => {
      const b = bx(document.querySelectorAll(".ribslot")[i]);
      const g = linear(b.x0, 0, b.x1, 0, [[0, PAL.v[1]], [0.5, PAL.j[1]], [1, PAL.m[1]]]);
      ribbon({ pts: [[b.x0, b.y0 + 1.6], [b.cx, b.y0 + 1.2], [b.x1, b.y0 + 1.8]], width: [2.4, 3, 2.4], turns: 1.4, n: 14, sw, op, edgeBoost, stroke: g });
    });
    // the dot grid of the detailed boards
    const t = bx(document.querySelector(".tintslot"));
    let d = "";
    for (let y = t.y0 + 0.8; y < t.y1 - 0.4; y += 1.6) for (let x = t.x0 + 0.7; x < t.x1 - 0.4; x += 1.6) d += `M${f(x - 0.17)} ${f(y)}a.17 .17 0 1 0 .34 0a.17 .17 0 1 0 -.34 0`;
    el(svg, "path", { d, fill: PAL.dots });
  }

  /* everything drawn so far sits under the page content */
  svg.style.zIndex = 0;

  /* ── guides for the proof (?guides) ── */
  if (Q.has("guides")) {
    const gs = document.createElementNS(NS, "svg");
    gs.id = "guides";
    gs.setAttribute("viewBox", `0 0 ${W + OVER} ${H + OVER}`);
    gs.setAttribute("preserveAspectRatio", "none");
    board.appendChild(gs);
    const line = (x1, y1, x2, y2, c, dash = "") => el(gs, "line", { x1, y1, x2, y2, stroke: c, "stroke-width": ITEM === "popup" ? 0.35 : 0.2, "stroke-dasharray": dash });
    const rect = (x, y, w, h, c, dash = "") => el(gs, "rect", { x, y, width: w, height: h, fill: "none", stroke: c, "stroke-width": ITEM === "popup" ? 0.35 : 0.2, "stroke-dasharray": dash });
    const label = (x, y, t, c, s) => { const n = el(gs, "text", { x, y, fill: c, "font-size": s, "font-family": "Sora", direction: "ltr" }); n.textContent = t; };
    const C1 = "#00b7ff", C2 = "#ff9f1a", C3 = "#ff3b6b", s = ITEM === "popup" ? 2.6 : 1.4;
    if (ITEM === "popup") {
      line(35, 0, 35, H, C1, "2 1"); line(326, 0, 326, H, C1, "2 1");
      [107.75, 180.5, 253.25].forEach((x) => line(x, 0, x, H, C2, "0.6 1.2"));
      const S = SAFE.popup;
      rect(S.x[0], S.y[0], S.x[1] - S.x[0], S.y[1] - S.y[0], "#3ddc97", "1 1");
      line(35, 140, 326, 140, C3, "2 1");
      label(36.5, 6, "RETURN 35 | FACE 291 × 230 | RETURN 35 — PANEL SEAMS (4 × 72.75) DOTTED — SAFE AREA GREEN", C1, s);
      label(36.5, 145, "RED: TOP OF THE COUNTERS (90 CM) — EVERYTHING THAT MATTERS STAYS ABOVE IT", C3, s);
    } else if (ITEM === "counter") {
      line(72, 0, 72, H, C1, "2 1"); line(142, 0, 142, H, C1, "2 1");
      const S = SAFE.counter;
      rect(S.x[0], S.y[0], S.x[1] - S.x[0], S.y[1] - S.y[0], "#3ddc97", "1 1");
      label(3, 2.8, "SIDE 72 | FRONT 70 | SIDE 72 — 214 × 90 — SAFE AREA GREEN", C1, s);
    } else if (ITEM !== "swatch") {
      rect(5, 5, 85, 200, C1, "2 1");
      const S = SAFE[ITEM];
      rect(S.x[0], S.y[0], S.x[1] - S.x[0], S.y[1] - S.y[0], "#3ddc97", "1 1");
      line(5, 192, 90, 192, C3, "2 1");
      label(5.5, 3.6, "TRIM 85 × 200 · BLEED 5 · SAFE AREA GREEN", C1, s);
      label(5.5, 196, "BELOW RED: INSIDE THE STAND FOOT", C3, s);
    }
  }
};

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
