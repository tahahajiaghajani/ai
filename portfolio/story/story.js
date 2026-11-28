/* Taha Aghajani — portfolio story. One timeline, rendered frame by frame: window.renderAt(seconds). */
(() => {
  const DUR = 17.2; // the finished end card is held for four seconds: time to read it and take a screenshot
  const A2 = 3.5, A3 = 7.5, A4 = 10.9; // act starts
  const R0 = 0.5; // the film opens on the portrait already drawn in dots: a face in the very first frame
  const STILL = new URLSearchParams(location.search).has("still");
  if (STILL) document.body.classList.add("still");
  const FRAME_W = 936, FRAME_H = STILL ? 976 : 1170;
  const K = FRAME_W / 350; // story pixels per CSS pixel of the site's hero frame on a phone

  const $ = (s) => document.querySelector(s);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const fa = (v) => String(v).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  /* ------------------------------------------------------------------ the vision portrait (the site's shader) */
  const VERT = `attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;
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
  vec2 org = floor(uRes * vec2(0.47, 0.66)) + 0.5; // the face: the dots swell in place around the subject
  vec2 fp = frag - org;
  vec2 id = floor(fp / cell);
  vec2 center = ((id + 0.5) * cell + org) / uRes;
  float r = hash(id);
  float lum = photo(center);
  vec2 local = fract(fp / cell) - 0.5;
  float radius = sqrt(lum) * 0.62;
  float aa = 1.2 / cell;
  float dots = smoothstep(radius + aa, radius - aa, length(local));
  float appear = smoothstep(r * 0.55, r * 0.55 + 0.18, uReveal * 1.25);
  float resolve = smoothstep(0.5 + r * 0.38, 0.62 + r * 0.38, uReveal);
  resolve *= 1.0 - smoothstep(0.05, 0.75, uScroll + r * 0.25);
  float base = mix(dots * appear, photo(vUv), resolve);
  vec2 d = (vUv - uMouse) * vec2(uRes.x / uRes.y, 1.0);
  float dist = length(d);
  float R = 0.2 * uHover;
  float lens = 1.0 - smoothstep(R - 0.006, R, dist);
  float ring = (1.0 - smoothstep(0.0, 0.004, abs(dist - R))) * uHover;
  float ticks = step(0.985, abs(cos(atan(d.y, d.x) * 24.0))) * (1.0 - smoothstep(0.0, 0.018, abs(dist - R - 0.014))) * uHover;
  float band = 1.0 - smoothstep(0.0, 0.07, abs((1.0 - vUv.y) - uScan));
  band *= step(0.0, uScan) * step(uScan, 1.0);
  float bandLine = (1.0 - smoothstep(0.0, 0.0025, abs((1.0 - vUv.y) - uScan))) * step(0.0, uScan) * step(uScan, 1.0);
  float m = max(lens, band * 0.85);
  float machine = 0.0;
  if (m > 0.001) {
    float e = edges(vUv);
    float scan = 0.78 + 0.22 * sin(frag.y * 0.9 / uDpr - uTime * 6.0);
    vec2 g = abs(fract(frag / (28.0 * uDpr)) - 0.5);
    float grid = step(0.485, max(g.x, g.y)) * 0.12;
    machine = max(e * scan, grid) + dots * 0.08;
  }
  float c = mix(base, machine, m) + ring * 0.9 + ticks * 0.6 + bandLine * 0.7;
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  gl_FragColor = vec4(vec3(c), 1.0);
}`;

  const st = { reveal: R0, scroll: 0, scan: -1 };
  const cv = $("#gl");
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(FRAME_W * dpr);
  cv.height = Math.round(FRAME_H * dpr);
  const gl = cv.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
  let u = null;
  let glReady = false;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const initGl = (img) => {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    u = { res: U("uRes"), texel: U("uTexel"), crop: U("uCrop"), mouse: U("uMouse"), hover: U("uHover"), reveal: U("uReveal"), scroll: U("uScroll"), scan: U("uScan"), time: U("uTime"), dpr: U("uDpr") };
    const flat = document.createElement("canvas");
    flat.width = img.naturalWidth;
    flat.height = img.naturalHeight;
    flat.getContext("2d").drawImage(img, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.viewport(0, 0, cv.width, cv.height);
    const fa_ = FRAME_W / FRAME_H;
    const ia = img.naturalWidth / img.naturalHeight;
    gl.uniform2f(u.crop, fa_ < ia ? fa_ / ia : 1, fa_ < ia ? 1 : ia / fa_);
    gl.uniform2f(u.res, cv.width, cv.height);
    gl.uniform2f(u.texel, 1 / img.naturalWidth, 1 / img.naturalHeight);
    // the site draws 5-CSS-pixel cells in a 350-pixel frame on a phone: keep the same number of cells across this frame
    gl.uniform1f(u.dpr, dpr * K);
    gl.uniform2f(u.mouse, 0.5, 0.55);
    gl.uniform1f(u.hover, 0);
    glReady = true;
  };
  const drawGl = (t, scan, scroll = st.scroll) => {
    if (!glReady) return;
    gl.uniform1f(u.reveal, st.reveal);
    gl.uniform1f(u.scroll, scroll);
    gl.uniform1f(u.scan, scan);
    gl.uniform1f(u.time, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  /* ------------------------------------------------------------------ detection boxes */
  const DETS = [
    { label: "person", score: 0.997, box: [0.02, 0.14, 0.9, 0.984], at: 1.1 },
    { label: "taha_aghajani", score: 0.998, box: [0.32, 0.215, 0.62, 0.47], at: 1.4 },
    { label: "wristwatch", score: 0.942, box: [0.35, 0.728, 0.455, 0.815], at: 1.72 },
  ];
  const dets = $("#dets");
  const ASPECT = FRAME_W / FRAME_H; // the square photo is cropped to this width
  const fromHero = (x) => (x * 0.8 + 0.1 - (1 - ASPECT) / 2) / ASPECT; // hero frame (4:5) → photo → this frame
  DETS.forEach((d, i) => {
    const [x0, y0, x1, y1] = [fromHero(d.box[0]), d.box[1], fromHero(d.box[2]), d.box[3]];
    const el = document.createElement("div");
    el.className = "box";
    el.style.cssText = `left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%`;
    el.innerHTML = `<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><b></b><span class="lab"><span class="t"></span><em></em></span>`;
    dets.appendChild(el);
    d.el = el;
    d.t = el.querySelector(".t");
    d.s = el.querySelector("em");
    d.seed = i + 1;
  });
  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_#/<>";
  const scramble = (text, p, seed, t) => {
    const n = Math.floor(clamp(p) * text.length);
    let out = text.slice(0, n);
    const tick = Math.floor(t * 15);
    for (let i = n; i < text.length; i++) out += GLYPHS[Math.floor(hash(seed * 31 + i * 7 + tick * 13) * GLYPHS.length)];
    return out;
  };

  /* ------------------------------------------------------------------ the statement, word by word */
  const fill = (host, text) => {
    const parts = text.split(" ");
    parts.forEach((w, i) => {
      const s = document.createElement("span");
      s.className = "w";
      s.textContent = w;
      host.appendChild(s);
      if (i < parts.length - 1) host.appendChild(document.createTextNode(" "));
    });
    return [...host.querySelectorAll(".w")];
  };
  const lead1 = fill($("#lead1"), "سیستم‌های هوش مصنوعی پیچیده را");
  const lead2 = fill($("#lead2"), "و در سازمان");
  const verbs = [...document.querySelectorAll("#verbs div")];

  /* ------------------------------------------------------------------ the wall of work */
  // pictures the site already shows (paths under ../public/media)
  const CARDS = [
    [
      ["work/pars/site-hero-fa.webp", "Pars", "Brand · Web"],
      ["products/siraf/dashboard-light.webp", "Siraf", "Product"],
      ["work/tejarat-new-epm/audit-report.webp", "EPM · Tejarat", "Bank system"],
      ["work/pars-ai/pm-dashboard.webp", "Pars PM", "Copilot"],
    ],
    [
      ["work/sendo/golden-hour.webp", "Sendō", "AI companion"],
      ["products/kariz/agent-home-dark.webp", "Kariz", "Product"],
      ["work/celin/home-hero-fa.webp", "Celin", "Luxury web"],
      ["work/turbine/comfyui-graph.png", "Turbine", "Vision"],
    ],
  ];
  CARDS.forEach((col, c) => {
    const host = $(c === 0 ? "#col1" : "#col2");
    col.forEach(([file, name, kind]) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="pic"><img src="../public/media/${file}" alt=""></div><div class="cap mono"><span>${name}</span><em>${kind}</em></div>`;
      host.appendChild(el);
    });
  });

  /* ------------------------------------------------------------------ the QR code */
  (() => {
    const { n, rows } = window.QR_DATA;
    const q = 2; // quiet zone, in modules (the light plate around it adds the rest)
    let path = "";
    rows.forEach((r, y) => {
      for (let x = 0; x < n; x++) if (r[x] === "1") path += `M${x + q} ${y + q}h1v1h-1z`;
    });
    const svg = `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges"><path d="${path}" fill="#050505"/></svg>`;
    $("#qr").innerHTML = svg;
    $("#qr2").innerHTML = svg;
  })();

  /* ------------------------------------------------------------------ the timeline */
  gsap.config({ force3D: false });
  gsap.defaults({ lazy: false, overwrite: false });
  const tl = gsap.timeline({ paused: true, defaults: { ease: "expo.out" } });

  // starting states
  gsap.set(".box", { opacity: 0, scale: 1.08, transformOrigin: "50% 50%" });
  gsap.set(["#nfirst", "#nlast"], { yPercent: 122 });
  gsap.set("#a2", { autoAlpha: 0 });
  gsap.set("#a2eb", { opacity: 0, x: 24 });
  gsap.set("#verbs", { opacity: 0 });
  gsap.set("#a3", { autoAlpha: 0 });
  gsap.set("#col1", { y: -6 });
  gsap.set("#col2", { y: -60 });
  gsap.set([".st .big > span"], { yPercent: 118 });
  gsap.set(".fact", { opacity: 0, y: 28 });
  gsap.set(".bank", { opacity: 0, scale: 0.9 });
  gsap.set("#a4", { autoAlpha: 0 });
  gsap.set(".cta .mask > span", { yPercent: 122 });
  gsap.set(["#hint", "#qr", "#qrtxt", "#sigrow"], { opacity: 0, y: 22 });
  gsap.set("#ubox", { opacity: 0, scale: 1.05, transformOrigin: "50% 50%" });

  // ---- act 1: the portrait as a vision model sees it
  const SCAN_AT = 0.7, SCAN_END = 2.06;
  tl.to(st, { reveal: 1, duration: 1.3, ease: "power1.out" }, 0);
  tl.fromTo(st, { scan: -0.1 }, { scan: 1.1, duration: 1.35, ease: "power1.inOut", immediateRender: false }, SCAN_AT);
  tl.set(st, { scan: -1 }, SCAN_END);
  DETS.forEach((d) => tl.to(d.el, { opacity: 1, scale: 1, duration: 0.55 }, d.at));
  tl.to("#scrim", { opacity: 1, duration: 0.8, ease: "power2.out" }, 1.7);
  tl.to("#nfirst", { yPercent: 0, duration: 1.1 }, 1.9);
  tl.to("#nlast", { yPercent: 0, duration: 1.1 }, 2.02);

  // ---- act 2: the statement (the portrait dissolves into large dots first, then steps back behind the words)
  tl.to(".box", { opacity: 0, duration: 0.35, ease: "power2.in" }, A2);
  tl.to("#hud", { opacity: 0, duration: 0.35, ease: "power2.in" }, A2);
  tl.to("#nfirst", { xPercent: 9, opacity: 0, duration: 0.55, ease: "power2.in" }, A2);
  tl.to("#nlast", { xPercent: -11, opacity: 0, duration: 0.55, ease: "power2.in" }, A2);
  tl.to("#scrim", { opacity: 0, duration: 0.5, ease: "power2.in" }, A2);
  tl.to(st, { scroll: 1, duration: 1.0, ease: "power2.inOut" }, A2);
  tl.to("#gl", { opacity: 0.13, duration: 0.5, ease: "power2.inOut" }, A2 + 0.4);
  tl.set("#a2", { autoAlpha: 1 }, A2 + 0.5);
  tl.to("#a2eb", { opacity: 1, x: 0, duration: 0.8 }, A2 + 0.6);
  tl.to("#verbs", { opacity: 1, duration: 0.8, ease: "power2.out" }, A2 + 0.65);
  lead1.forEach((w, i) => tl.to(w, { opacity: 1, duration: 0.4, ease: "power2.out" }, A2 + 0.8 + i * 0.075));
  const light = (v, at) => {
    tl.to(verbs[v], { color: "#f3f3ef", duration: 0.45, ease: "power2.out" }, at);
    tl.to(verbs[v].querySelector("span"), { color: "#9b9b96", duration: 0.45, ease: "power2.out" }, at);
  };
  tl.to("#v1", { yPercent: 0, duration: 0.95 }, A2 + 1.1);
  light(0, A2 + 1.2);
  tl.to("#v2", { yPercent: 0, duration: 0.95 }, A2 + 1.5);
  light(1, A2 + 1.6);
  lead2.forEach((w, i) => tl.to(w, { opacity: 1, duration: 0.4, ease: "power2.out" }, A2 + 1.85 + i * 0.075));
  tl.to("#v3", { yPercent: 0, duration: 0.95 }, A2 + 2.0);
  light(2, A2 + 2.1);

  // ---- act 3: the work, the numbers, the banks
  tl.to("#st", { yPercent: -6, opacity: 0, duration: 0.35, ease: "power2.in" }, A3);
  tl.to(["#a2eb", "#verbs"], { opacity: 0, duration: 0.35, ease: "power2.in" }, A3);
  tl.to("#gl", { opacity: 0, duration: 0.35, ease: "power2.in" }, A3);
  tl.set("#a2", { autoAlpha: 0 }, A3 + 0.36);
  tl.set("#a3", { autoAlpha: 1 }, A3 + 0.36);
  tl.fromTo("#wall", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power2.out", immediateRender: true }, A3 + 0.36);
  tl.to("#col1", { y: -46, duration: A4 - A3 + 0.9, ease: "none" }, A3);
  tl.to("#col2", { y: -20, duration: A4 - A3 + 0.9, ease: "none" }, A3);
  // the pictures turn to colour, as they do on the site under the pointer
  const sat = { v: 0 };
  tl.to(sat, { v: 1, duration: 0.8, ease: "power2.inOut" }, A3 + 0.4);
  const counts = { a: 1, b: 1, c: 1 };
  document.querySelectorAll(".fact").forEach((f, i) => {
    tl.to(f, { opacity: 1, y: 0, duration: 0.8 }, A3 + 0.5 + i * 0.13);
  });
  tl.to(counts, { a: 11, duration: 0.8, ease: "power2.out" }, A3 + 0.5);
  tl.to(counts, { b: 5, duration: 0.7, ease: "power2.out" }, A3 + 0.63);
  document.querySelectorAll(".bank").forEach((b, i) => {
    tl.to(b, { opacity: 1, scale: 1, duration: 0.6 }, A3 + 0.95 + i * 0.07);
  });

  // ---- act 4: the address
  tl.fromTo("#a3", { clipPath: "inset(0% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.55, ease: "power3.inOut", immediateRender: false }, A4);
  tl.to("#edge", { opacity: 0, duration: 0.4, ease: "power2.in" }, A4 + 0.1);
  tl.to("#urllabel", { opacity: 0, duration: 0.3, ease: "power2.in" }, A4 + 0.1);
  tl.set("#a4", { autoAlpha: 1 }, A4 + 0.3);
  tl.to("#frame", { autoAlpha: 0, duration: 0.35, ease: "power1.out" }, A4 + 0.5);
  tl.to(".cta .l1", { yPercent: 0, duration: 1.0 }, A4 + 0.35);
  tl.to(".cta .l2", { yPercent: 0, duration: 1.0 }, A4 + 0.47);
  // the address does not travel: the lower third goes out and the address is decoded inside its detection box
  const UBOX_AT = A4 + 0.8, UDEC_AT = A4 + 0.9, UDEC_DUR = 0.6;
  // the lower third stays until the address in the box is nearly read out, so one whole address is always on screen
  tl.to("#url", { opacity: 0, duration: 0.3, ease: "power2.in" }, A4 + 1.3);
  tl.to("#ubox", { opacity: 1, scale: 1, duration: 0.5 }, UBOX_AT);
  tl.set("#urlbig", { opacity: 1 }, UDEC_AT);
  tl.to("#hint", { opacity: 1, y: 0, duration: 0.6 }, A4 + 1.3);
  tl.to("#qr", { opacity: 1, y: 0, duration: 0.6 }, A4 + 1.38);
  tl.to("#qrtxt", { opacity: 1, y: 0, duration: 0.6 }, A4 + 1.46);
  tl.to("#sigrow", { opacity: 1, y: 0, duration: 0.6 }, A4 + 1.62);
  tl.to("#markpath", { strokeDashoffset: 0, duration: 0.7, ease: "power2.inOut" }, A4 + 1.35);
  // while the end card is held, the box takes hold of the address once more; the address itself never moves
  const RELOCK_AT = A4 + 4.1;
  tl.to("#ubox", { left: 62, top: 828, width: 956, height: 176, duration: 0.2, ease: "power2.out" }, RELOCK_AT);
  tl.to("#ubox", { left: 72, top: 838, width: 936, height: 156, duration: 0.7, ease: "expo.out" }, RELOCK_AT + 0.2);
  tl.fromTo("#ubox b", { borderColor: "rgba(255,255,255,0.5)" }, { borderColor: "rgba(255,255,255,0.95)", duration: 0.2, ease: "power2.out", immediateRender: false }, RELOCK_AT);
  tl.to("#ubox b", { borderColor: "rgba(255,255,255,0.5)", duration: 0.9, ease: "power2.out" }, RELOCK_AT + 0.2);
  tl.set({}, {}, DUR);

  const ULAB_AT = UBOX_AT + 0.05;
  const ADDRESS = "taha-aghajani-portfolio.vercel.app";
  const NOISE = "abcdefghijklmnopqrstuvwxyz-.";
  const urlbig = $("#urlbig");
  const pics = [...document.querySelectorAll(".card .pic img")];
  const ulab = $("#ulab");
  const hudr = $("#hudr");
  const dot = $("#dot");
  const factV = [...document.querySelectorAll(".fact .v")];

  // With motion blur several instants are averaged into one frame: anything that changes in steps (decoding labels,
  // counters) is held at the frame's own time, so two different texts are never blended into one picture.
  const FRAME_FPS = Number(new URLSearchParams(location.search).get("fps") || 0);
  const held = (t) => (FRAME_FPS ? Math.ceil(t * FRAME_FPS - 1e-6) / FRAME_FPS : t);
  const apply = (tNow) => {
    // the scanning line stays one crisp line per frame (averaged over several instants it would turn into a faint comb)
    const t = held(tNow);
    tl.time(t, false);
    stepped(t);
    const scan = st.scan, scroll = st.scroll;
    if (t !== tNow) tl.time(tNow, false);
    drawGl(t, scan, scroll);
    const sat_ = sat.v;
    pics.forEach((im) => { im.style.filter = `grayscale(${(1 - sat_).toFixed(3)}) contrast(1.08)`; });
    // the availability dot breathes
    const b = 0.5 - 0.5 * Math.cos((2 * Math.PI * tNow) / 2.4);
    dot.style.transform = `scale(${1 - 0.4 * b})`;
    dot.style.opacity = String(1 - 0.55 * b);
  };
  const stepped = (t) => {
    // detection labels: decoded from noise, the confidence counted up
    DETS.forEach((d) => {
      const p = clamp((t - d.at - 0.08) / 0.75);
      d.t.textContent = p >= 1 ? d.label : scramble(d.label, p, d.seed, t);
      const e = 1 - Math.pow(1 - clamp((t - d.at) / 0.7), 3);
      d.s.textContent = (d.score * e).toFixed(3);
    });
    const up = clamp((t - ULAB_AT) / 0.7);
    ulab.textContent = up >= 1 ? "portfolio" : scramble("portfolio", up, 9, t);
    // the address itself: decoded left to right, in letters an address is made of
    const dp = clamp((t - UDEC_AT) / UDEC_DUR);
    if (dp >= 1) urlbig.textContent = ADDRESS;
    else {
      const n = Math.floor(dp * ADDRESS.length);
      const tick = Math.floor(t * 15);
      let out = ADDRESS.slice(0, n);
      for (let k = n; k < ADDRESS.length; k++) out += NOISE[Math.floor(hash(77 + k * 7 + tick * 13) * NOISE.length)];
      urlbig.textContent = out;
    }
    // the frame's status line
    if (t < SCAN_AT) hudr.textContent = `resolve ${String(Math.round(clamp((st.reveal - R0) / (1 - R0)) * 100)).padStart(3, "0")}%`;
    else if (t < SCAN_END) hudr.textContent = `scan ${String(Math.round(clamp((st.scan + 0.1) / 1.2) * 100)).padStart(3, "0")}%`;
    else hudr.textContent = "objects 03";
    // numbers
    factV[0].textContent = fa(Math.round(counts.a));
    factV[1].textContent = fa(Math.round(counts.b));
    factV[2].textContent = fa(Math.round(counts.c));
  };

  const ready = (async () => {
    await document.fonts.ready;
    await Promise.all(["900 100px Vazirmatn", "200 100px Vazirmatn", "600 100px Vazirmatn", "400 100px Vazirmatn", "300 100px Vazirmatn", "700 100px Vazirmatn", "500 40px 'JetBrains Mono'", "400 40px 'JetBrains Mono'", "600 40px 'Inter Tight'"].map((f) => document.fonts.load(f, "طاها آقاجانی Portfolio 0123 ۱۲۳")));
    const img = new Image();
    img.src = "../public/media/taha-portrait.jpg";
    await img.decode();
    initGl(img);
    await Promise.all([...document.images].map((i) => (i.complete ? i.decode().catch(() => {}) : new Promise((r) => { i.onload = i.onerror = r; }))));
    apply(0);
  })();

  // the still: the portrait resolved, everything detected, the address in its box
  const applyStill = () => {
    tl.time(A2 - 0.02, false);
    stepped(A2 - 0.02);
    drawGl(A2 - 0.02, -1);
    hudr.textContent = "objects 03";
    const el = document.querySelector("#url");
    el.style.left = "0px";
    el.style.right = "0px";
  };
  window.STORY = { DUR, A2, A3, A4, ready, STILL };
  window.renderAt = async (t) => {
    await ready;
    if (STILL) applyStill();
    else apply(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
})();
