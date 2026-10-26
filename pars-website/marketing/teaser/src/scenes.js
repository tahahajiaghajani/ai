/* Scenes. Each builder makes its own DOM under #scenes and returns a GSAP timeline that starts and ends invisible. */
const SCENES = document.getElementById("scenes");

function sceneBox() {
  const n = h("div", "layer", SCENES);
  gsap.set(n, { autoAlpha: 0 });
  return n;
}
/** wrap a scene: show at 0, hide at the end */
function wrap(n, tl, out = 0.6) {
  const w = gsap.timeline();
  w.set(n, { autoAlpha: 1 }, 0);
  w.add(tl, 0);
  w.to(n, { autoAlpha: 0, duration: out, ease: "power2.inOut" }, tl.duration() - out);
  w.cues = tl.cues ?? [];
  return w;
}

/* ── 1 · intro: two streams meet, the logo, the tagline (short: the same, faster, for an app teaser) ── */
function sceneIntro({ short = false } = {}) {
  const T = short ? { conv: 0.2, convD: 2, flash: 2.1, glow: 2.6, rib: 1.9, logo: 2.2, word: 2.8, tag: 3.4, out: 7, part: 7.2 }
    : { conv: 0.6, convD: 3, flash: 3.5, glow: 4, rib: 3.3, logo: 3.6, word: 4.3, tag: 5.1, out: 10.2, part: 10.4 };
  const n = sceneBox();
  const mark = place(h("img", "abs", n), { left: "810px", top: "300px", width: "300px" });
  mark.src = "assets/brand/pars-mark-reverse.svg";
  const word = place(h("img", "abs", n), { left: "735px", top: "640px", width: "450px" });
  word.src = "assets/brand/pars-wordmark-reverse.svg";
  const tag = place(h("div", "abs h2", n), { left: "0", right: "0", top: "760px", textAlign: "center", fontSize: "64px" });
  const tw = words(tag, 'جایی که مدیریت و <span class="g">هوش</span> به هم می‌رسند.');
  const tl = gsap.timeline();
  // the outro ends on this exact state (ink, no ribbons, no glow), so the loop has no seam
  tl.set(BG, { ribbons: 0, converge: 0, particles: 0, flowY: 0.6 }, 0);
  tl.set(BG.glowA, { a: 0.0 }, 0).set(BG.glowB, { a: 0.0 }, 0).set(BG.glowC, { a: 0, r: 0.3, x: 0.5, y: 0.42 }, 0).set(BG.P, { x: 0.5, y: 0.42 }, 0);
  tl.to(BG, { ribbons: 1, particles: 0.8, duration: 1.6, ease: "power1.inOut" }, 0);
  tl.to(BG.glowA, { a: 0.35, duration: 2.4 }, 0).to(BG.glowB, { a: 0.3, duration: 2.4 }, 0.3);
  tl.to(BG, { converge: 1, duration: T.convD, ease: "parsInOut" }, T.conv);
  tl.to(BG.glowC, { a: 0.4, r: 0.45, duration: 0.5, ease: "power2.out" }, T.flash).to(BG.glowC, { a: 0.1, r: 0.35, duration: 2.2, ease: "power2.inOut" }, T.glow);
  tl.to(BG, { ribbons: 0.42, duration: 1.4, ease: "power2.inOut" }, T.rib);
  hit(tl, T.logo, "logo");
  tl.fromTo(mark, { opacity: 0, scale: 0.6, filter: "blur(20px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.4, ease: "pars" }, T.logo);
  tl.fromTo(word, { opacity: 0, y: 30, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 1.1, ease: "pars" }, T.word);
  tl.add(rise(tw, { stagger: 0.09, dur: 1 }), T.tag);
  tl.to([mark, word], { opacity: 0, scale: 0.92, filter: "blur(8px)", duration: 0.8, ease: "power2.in" }, T.out);
  tl.add(sink(tw), T.out);
  // the streams part again and settle behind the chapters at a calmer level, below any text
  tl.to(BG, { converge: 0, ribbons: 0.4, duration: 1.6, ease: "parsInOut" }, T.part);
  tl.to(BG.glowC, { a: 0, duration: 1.4 }, T.part);
  return wrap(n, tl, 0.4);
}

/* ── kinetic statement: a kicker, a big line, a lead ─────────── */
function sceneStatement({ kicker, title, lead, dur = 7, align = "center" }) {
  const n = sceneBox();
  const box = place(h("div", "abs", n), { left: "160px", right: "160px", top: "330px", textAlign: align });
  const k = h("div", "kicker", box, "");
  place(k, { justifyContent: align === "center" ? "center" : "flex-start" });
  k.innerHTML = `<span class="rule"></span><span>${kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  const t = place(h("div", "h2", box), { marginTop: "26px" });
  const tw = words(t, title);
  const l = place(h("div", "lead", box), { marginTop: "24px", maxWidth: "1300px", marginInline: "auto" });
  const lw = lead ? words(l, lead) : [];
  const tl = gsap.timeline();
  tl.add(fadeIn(k, 0.8, { from: { y: 20 }, to: { y: 0 } }), 0.2);
  tl.add(rise(tw, { stagger: 0.08 }), 0.4);
  if (lw.length) tl.add(rise(lw, { stagger: 0.03, dur: 0.8 }), 1.2);
  tl.to({}, { duration: dur - 1.6 }, 1.2);
  tl.add(sink([...tw, ...lw], { stagger: 0.01 }), dur - 0.7);
  tl.to(k, { opacity: 0, duration: 0.5 }, dur - 0.7);
  return wrap(n, tl, 0.3);
}

/* ── numbers that count up ───────────────────────────────────── */
function sceneStats(items, { kicker, title }) {
  const n = sceneBox();
  const head = place(h("div", "abs", n), { left: "160px", right: "160px", top: "230px", textAlign: "center" });
  const k = h("div", "kicker", head);
  place(k, { justifyContent: "center" });
  k.innerHTML = `<span class="rule"></span><span>${kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  const t = place(h("div", "h3", head), { marginTop: "22px" });
  const tw = words(t, title);
  const row = place(h("div", "abs", n), { left: "140px", right: "140px", top: "470px", display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)` });
  const tl = gsap.timeline();
  tl.add(fadeIn(k, 0.8), 0.1).add(rise(tw), 0.3);
  items.forEach((it, i) => {
    const c = place(h("div", "", row), { textAlign: "center", padding: "0 24px", borderInlineStart: i ? "2px solid rgba(196,190,255,.22)" : "none" });
    const num = place(h("div", "", c), { fontSize: "150px", fontWeight: 600, lineHeight: 1.05 });
    place(num, { whiteSpace: "nowrap" });
    const pre = it.pre ? `<span style="font-size:.5em;color:#c3bfdc;margin-inline-end:.18em">${it.pre}</span>` : "";
    num.innerHTML = `${pre}<span class="g">${fa(0)}${it.suf ?? ""}</span>`;
    const lab = place(h("div", "lead", c), { fontSize: "30px", marginTop: "16px", lineHeight: 1.6 });
    const lw = words(lab, it.label);
    const o = { v: 0 };
    const at = 0.8 + i * 0.35;
    tl.fromTo(c, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.9, ease: "pars" }, at);
    tl.fromTo(o, { v: 0 }, { v: it.value, duration: 1.8, ease: "power3.out", onUpdate: () => (num.lastChild.textContent = `${fa(Math.round(o.v))}${it.suf ?? ""}`) }, at);
    tl.add(rise(lw, { stagger: 0.04, dur: 0.7 }), at + 0.3);
  });
  tl.to({}, { duration: 3.2 });
  tl.to([head, row], { opacity: 0, y: -30, duration: 0.6, ease: "power2.in" });
  // the ribbons step back behind the numbers (placed last: appended tweens above follow the timeline's end)
  tl.to(BG, { ribbons: 0.22, duration: 1.2, ease: "power1.inOut" }, 0).to(BG, { ribbons: 0.4, duration: 1, ease: "power1.inOut" }, tl.duration() - 1);
  return wrap(n, tl, 0.3);
}

/* ── a product chapter: title card, then shots (a demo walkthrough, a screen wall, an infographic), then the AI layer ── */
const BW = 1180, BH = 700, BY = 190;
const X_MID = (W - BW) / 2, X_RIGHT = W - 110 - BW, X_LEFT = 110;

function sceneProduct(p, idx) {
  const n = sceneBox();
  const tl = gsap.timeline();
  // each chapter gets its own light: the glows travel to the product's corner
  const g = p.glow ?? [0.2, 0.25, 0.82, 0.85];
  tl.to(BG.glowA, { x: g[0], y: g[1], a: 0.26, duration: 2.4, ease: "parsInOut" }, 0).to(BG.glowB, { x: g[2], y: g[3], a: 0.2, duration: 2.4, ease: "parsInOut" }, 0);
  let t = titleCard(n, tl, p, idx);
  for (const s of p.shots) {
    if (s.type === "demo") t = shotDemo(n, tl, p, s, t);
    else if (s.type === "wall") t = shotWall(n, tl, p, s, t);
    else t = INFO[s.type](n, tl, s, t);
  }
  tl.to({}, { duration: 0.3 }, t);
  return wrap(n, tl, 0.4);
}

function titleCard(n, tl, p, idx) {
  const tc = h("div", "layer", n);
  const ghost = place(h("div", "abs latin", tc), { left: "-200px", right: "-200px", top: "120px", textAlign: "center", fontSize: "520px", fontWeight: 700, lineHeight: 1, color: "transparent", WebkitTextStroke: "2px rgba(184,177,255,.10)", whiteSpace: "nowrap" });
  ghost.textContent = p.acronym || "";
  const num = place(h("div", "abs kicker", tc), { left: "0", right: "0", top: "200px", justifyContent: "center" });
  num.innerHTML = `<span class="rule"></span><span>دموی محصول</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  const acr = place(h("div", "abs latin", tc), { left: "0", right: "0", top: "262px", textAlign: "center", fontSize: "220px", fontWeight: 700, lineHeight: 1, letterSpacing: "-.02em" });
  let letters = [];
  if (p.acronym) {
    acr.innerHTML = [...p.acronym].map((ch) => `<w-o style="padding:.06em .02em .12em;margin:-.06em -.02em -.12em"><w-i class="g">${ch}</w-i></w-o>`).join("");
    letters = [...acr.querySelectorAll("w-i")];
  } else {
    acr.innerHTML = `<span style="display:inline-grid;place-items:center;width:230px;height:230px;border-radius:60px;background:rgba(255,43,143,.10);border:2px solid rgba(255,79,163,.45);color:#ff4fa3">${icon(p.glyph ?? "gauge")}</span>`;
    acr.querySelector("svg").style.cssText = "width:130px;height:130px;stroke-width:1.4";
    letters = [acr.firstChild];
  }
  const nm = place(h("div", "abs h2", tc), { left: "0", right: "0", top: "530px", textAlign: "center", fontSize: "70px" });
  const nmw = words(nm, p.name);
  const line = place(h("div", "abs", tc), { left: "760px", width: "400px", top: "655px", height: "3px", borderRadius: "2px", background: "var(--edge)", transformOrigin: "50% 50%" });
  const hk = place(h("div", "abs lead", tc), { left: "0", right: "0", top: "685px", textAlign: "center", fontSize: "38px" });
  const hkw = words(hk, p.hook);
  tl.fromTo(ghost, { opacity: 0, x: 140 }, { opacity: 1, x: -140, duration: 4.2, ease: "none" }, 0);
  tl.add(fadeIn(num, 0.6, { from: { y: 16 }, to: { y: 0 } }), 0.1);
  tl.fromTo(letters, { yPercent: 110, opacity: 0, filter: "blur(16px)" }, { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: 1, ease: "pars", stagger: 0.09 }, 0.15);
  tl.add(rise(nmw, { stagger: 0.07 }), 0.55);
  tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: "pars" }, 0.9);
  tl.add(rise(hkw, { stagger: 0.045, dur: 0.8 }), 1.05);
  tl.to(tc, { opacity: 0, scale: 0.94, filter: "blur(10px)", duration: 0.55, ease: "power2.in" }, 3.45);
  return 3.95; // the demo window starts once the title has gone (no text over text)
}

/** a demo walkthrough: one browser window, page after page, with callouts; the cursor navigates between pages */
function shotDemo(n, tl, p, s, t0) {
  const b = new Browser(n, { x: X_MID, y: BY, w: BW, h: BH }, p.url);
  const pages = s.pages.map((pg) => {
    const page = b.page(pg.screen);
    page.cam = pg.start ? page.frame(pg.start, pg.startOpt ?? {}) : page.top();
    return page;
  });
  gsap.set(b.root, { opacity: 0 });
  tl.fromTo(b.root, { opacity: 0, y: 140, rotationX: 22, rotationY: s.tilt ?? -10, scale: 0.84, transformPerspective: 2400 },
    { opacity: 1, y: 0, rotationX: 0, rotationY: 0, scale: 1, duration: 1.4, ease: "pars" }, t0);
  tl.set(pages[0].vp, { opacity: 1 }, t0);
  hit(tl, t0 + 0.1, "whoosh");
  let t = t0 + 1.25, left = X_MID, coN = 0;
  const glide = (x, at, d = 1.2) => {
    if (x === left) return;
    tl.to(b.root, { left: x, duration: d, ease: "parsInOut" }, at);
    left = x;
  };
  s.pages.forEach((pg, i) => {
    const page = pages[i];
    if (i > 0) t = navigate(tl, b, pages[i - 1], page, s.pages[i - 1].next ?? { x: 92, y: 30 }, t, glide, s.pages[i - 1].rest ? pages[i - 1].frame(s.pages[i - 1].rest, s.pages[i - 1].restOpt ?? {}) : null);
    if (pg.scroll) {
      const to = pg.scroll.to ? page.frame(pg.scroll.to, pg.scroll.opt ?? {}) : page.bottom();
      tl.to(page.cam, { ...to, duration: pg.scroll.dur ?? 3.5, ease: "sine.inOut" }, t);
      t += (pg.scroll.dur ?? 3.5) + 0.15;
    }
    (pg.callouts ?? []).forEach((c, ci) => {
      const mid = c.x + c.w / 2;
      const side = c.side ?? (mid < 40 ? "left" : mid > 60 ? "right" : coN % 2 ? "right" : "left");
      coN++;
      const co = b.callout(page, c, { n: coN, label: c.label, text: c.text, side, cardY: c.cardY ?? 150, big: c.big });
      glide(side === "left" ? X_RIGHT : X_LEFT, t);
      // camRegion: frame something else than the highlight (e.g. keep a clipped page title out of view)
      let target = c.camRegion ? page.frame(c.camRegion, c.camOpt ?? {}) : page.frame(c, { zmax: c.zmax ?? 1.45, fill: c.fill ?? 0.7, zmin: c.zmin, dx: c.dx, dy: c.dy, fitWidth: c.fitWidth });
      // hug: the highlight sits just inside the window edge on its card's side, so the leader line crosses no text
      if (c.hug) target = page.hug(target, c, side, c.hug > 1 ? c.hug : undefined); // hug: 1, or the margin in px
      // pan: a longer, scroll-like camera move down a tall page before the card shows
      const md = c.pan ?? 1.25;
      tl.add(camTo(page, target, md, c.pan ? "sine.inOut" : "parsInOut"), t);
      const ct = showCallout(co, c.hold ?? 2.6);
      tl.add(ct, t + md - 0.4);
      hit(tl, t + md - 0.4, c.big ? "sparkle" : "tick");
      // a slow push while the card is up keeps the frame alive
      tl.to(page.cam, { z: target.z * (c.push ?? 1.035), duration: ct.duration() - 0.6, ease: "sine.inOut" }, t + md);
      t += md - 0.4 + ct.duration() - 0.25;
    });
    if (!s.ai || i < s.pages.length - 1) {
      // breathe out to the whole page (or push into the page's resting detail) before moving on
      if ((pg.callouts ?? []).length || pg.rest) {
        const slow = !(pg.callouts ?? []).length;
        glide(X_MID, t, 1.1);
        tl.add(camTo(page, pg.rest ? page.frame(pg.rest, pg.restOpt ?? {}) : page.top(), slow ? 2.2 : 1.2, slow ? "sine.inOut" : "parsInOut"), t);
        t += slow ? 2.5 : 1.25;
      }
    }
  });
  if (s.ai) t = aiLayer(n, tl, b, pages[pages.length - 1], p, t, glide, s.pages[s.pages.length - 1]);
  tl.to(b.root, { opacity: 0, y: -90, scale: 0.92, rotationX: -12, transformPerspective: 2400, duration: 0.9, ease: "power2.in" }, t);
  return t + 0.85; // the next shot starts once the window has nearly gone
}

/** a page change: the new page is painted over the old one, from the top (a browser) or from the bottom (a new chat message);
 *  every pixel is either the old page or the new one, so there is no see-through and no double image */
function reveal(tl, to, from, at, dir = "down", dur = 0.6) {
  const hidden = dir === "down" ? "inset(0% 0% 100% 0%)" : "inset(100% 0% 0% 0%)";
  tl.set(to.vp, { opacity: 1 }, at);
  tl.fromTo(to.vp, { clipPath: hidden }, { clipPath: "inset(0% 0% 0% 0%)", duration: dur, ease: "power2.inOut", immediateRender: false }, at);
  tl.set(from.vp, { opacity: 0 }, at + dur);
}

/** cursor glides to a menu item, clicks; a load bar runs; the next page slides in */
function navigate(tl, b, from, to, at, t, glide, rest) {
  glide(X_MID, t, 1.0);
  const fi = b.pages.indexOf(from);
  if (at === false) {
    // another app of the same family: the address changes, no click
    tl.fromTo(b.load, { width: 0, opacity: 1 }, { width: BW - 20, duration: 0.55, ease: "power2.inOut" }, t + 0.2);
    tl.to(b.load, { opacity: 0, duration: 0.25 }, t + 0.75);
    reveal(tl, to, from, t + 0.45);
    return t + 1.2;
  }
  tl.add(camTo(from, rest ?? from.top(), 0.9), t);
  tl.set(b.cur, { page: fi }, t);
  tl.fromTo(b.cur, { x: at.x - 14, y: at.y + 22, o: 0 }, { x: at.x, y: at.y, o: 1, duration: 0.9, ease: "parsInOut" }, t + 0.1);
  hit(tl, t + 1.0, "click");
  tl.to(b.cur, { press: 1, duration: 0.1, ease: "power2.in" }, t + 1.0).to(b.cur, { press: 0, duration: 0.18, ease: "power2.out" }, t + 1.1);
  tl.fromTo(b.cur, { ripple: 0 }, { ripple: 1, duration: 0.6, ease: "power2.out" }, t + 1.02);
  tl.fromTo(b.load, { width: 0, opacity: 1 }, { width: BW - 20, duration: 0.55, ease: "power2.inOut" }, t + 1.08);
  tl.to(b.load, { opacity: 0, duration: 0.25 }, t + 1.63);
  reveal(tl, to, from, t + 1.35);
  tl.to(b.cur, { o: 0, duration: 0.3 }, t + 1.5);
  return t + 2.05;
}

/** the AI layer over the last page: a scan, sparkles where the agents would act, the panel of production AI features */
function aiLayer(n, tl, b, page, p, t, glide, pg) {
  const scan = place(h("div", "scan", page.ov), { top: "-200px" });
  const tint = place(h("div", "abs", page.ov), { inset: "0", background: "linear-gradient(120deg, rgba(143,134,255,.20), rgba(223,17,115,.24))", mixBlendMode: "multiply", opacity: 0 });
  const spots = (pg.aiSpots ?? []).map(() => h("div", "ai-spot", page.ov, icon("ai")));
  const panel = place(h("div", "ai-panel", n), { left: "70px", top: BY + "px" });
  panel.innerHTML = `<div class="tag">${icon("ai")}<span>در نسخه‌ی عملیاتی</span></div><h3></h3><ul></ul>`;
  const hw = words(panel.querySelector("h3"), p.aiTitle.replace("هوش مصنوعی ", "هوش مصنوعی<br>"));
  const ul = panel.querySelector("ul");
  const rows = p.ai.slice(0, 4).map((a) => {
    const li = h("li", "", ul, `<span class="ic">${icon(a.icon ?? "ai")}</span><div><div class="t"></div><div class="d"></div></div>`);
    return { li, w: [...words(li.querySelector(".t"), a.title), ...words(li.querySelector(".d"), a.line)] };
  });
  gsap.set(panel, { opacity: 0 });
  gsap.set(spots, { opacity: 0 });
  glide(X_RIGHT, t, 1.2);
  tl.add(camTo(page, pg.aiCam ? page.frame(pg.aiCam, pg.aiCamOpt ?? { zmax: 1.2, fill: 0.95 }) : page.top(), 1.2), t);
  tl.fromTo(tint, { opacity: 0 }, { opacity: 1, duration: 0.8 }, t + 0.3);
  tl.fromTo(scan, { top: -200 }, { top: page.vh + 40, duration: 1.8, ease: "power1.inOut" }, t + 0.3);
  hit(tl, t + 0.3, "scan");
  hit(tl, t + 0.9, "sparkle");
  // sparkles ride the camera: they are positioned like highlight boxes on the page's image
  (pg.aiSpots ?? []).forEach((sp, i) => {
    page.callouts.push({ r: { x: sp.x, y: sp.y, w: 0, h: 0 }, hl: spots[i], state: { line: 0 }, side: "left", cardBox: { x: 0, y: 0, w: 0 }, spot: true });
    tl.fromTo(spots[i], { opacity: 0, scale: 0.3, rotation: -40 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.6, ease: "back.out(2)" }, t + 0.9 + i * 0.3);
  });
  tl.fromTo(panel, { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.9, ease: "pars" }, t + 0.8);
  tl.add(rise(hw, { stagger: 0.06 }), t + 1);
  rows.forEach((r, i) => {
    tl.fromTo(r.li, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.7, ease: "pars" }, t + 1.5 + i * 0.4);
    tl.add(rise(r.w, { stagger: 0.03, dur: 0.6 }), t + 1.55 + i * 0.4);
  });
  const end = t + (p.aiHold ?? 9);
  tl.to(panel, { opacity: 0, x: -40, duration: 0.6, ease: "power2.in" }, end - 0.7);
  tl.to([tint, ...spots], { opacity: 0, duration: 0.6 }, end - 0.7);
  return end;
}

/** a wall of the product's screens floating in depth; the camera drifts through it */
function shotWall(n, tl, p, s, t0) {
  const wall = place(h("div", "layer", n), { perspective: "2200px" });
  const CW = 620, CH = CW * 9 / 16;
  const slots = [
    { x: 300, y: 170, r: 14, z: -80 }, { x: 1000, y: 120, r: -8, z: -260 },
    { x: 220, y: 560, r: 10, z: -300 }, { x: 960, y: 560, r: -14, z: -60 },
  ];
  const cards = s.cards.map((c, i) => {
    const sl = slots[i % slots.length];
    const d = place(h("div", "abs", wall), { left: sl.x + "px", top: sl.y + "px", width: CW + "px", height: CH + "px", borderRadius: "16px", overflow: "hidden",
      boxShadow: "0 40px 90px rgba(0,0,0,.55), 0 0 0 1.5px rgba(196,190,255,.35)", backgroundColor: "#fff" });
    const k = CW / ((c.hero.w / 100) * c.w);
    Object.assign(d.style, { backgroundImage: `url(${c.src})`, backgroundSize: `${c.w * k}px ${c.h * k}px`, backgroundPosition: `${-(c.hero.x / 100) * c.w * k}px ${-(c.hero.y / 100) * c.h * k}px`, backgroundRepeat: "no-repeat" });
    return { d, sl };
  });
  const capL = place(h("div", "layer", n), { zIndex: 4 });
  const cap = place(h("div", "abs h3", capL), { left: "960px", top: "462px", padding: "16px 46px 20px", whiteSpace: "nowrap", fontSize: "58px", borderRadius: "22px",
    background: "rgba(10,9,32,.84)", boxShadow: "0 0 0 1.5px rgba(196,190,255,.3), 0 30px 80px rgba(0,0,0,.5)" });
  gsap.set(cap, { opacity: 0, xPercent: -50 });
  const cw = s.caption ? words(cap, s.caption) : [];
  cards.forEach(({ d, sl }, i) => {
    hit(tl, t0 + i * 0.5, "tick");
    tl.fromTo(d, { opacity: 0, z: -1600, rotationY: sl.r * 2, rotationX: 10, y: 80 }, { opacity: 1, z: sl.z, rotationY: sl.r, rotationX: 4, y: 0, duration: 1.3, ease: "pars" }, t0 + i * 0.5);
    tl.to(d, { x: (i % 2 ? -1 : 1) * 60, z: sl.z + 160, rotationY: sl.r * 0.6, duration: 4.4 - i * 0.5, ease: "none" }, t0 + 1.3 + i * 0.5);
  });
  if (cw.length) tl.fromTo(cap, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.7, ease: "pars" }, t0 + 1.5).add(rise(cw, { stagger: 0.07 }), t0 + 1.6);
  const end = t0 + 5.6;
  // the wall has gone before the demo window comes in
  tl.to(cards.map((c) => c.d), { opacity: 0, z: "+=420", duration: 0.55, ease: "power2.in", stagger: 0.04 }, end - 1.05);
  if (cw.length) tl.to(cap, { opacity: 0, scale: 0.95, duration: 0.45, ease: "power2.in" }, end - 1.05);
  return end - 0.1;
}

/* ── infographic shots inside product chapters ──────────────── */
const INFO = {
  /** numbered sections lighting up one by one (e.g. the ten parts of a project file) */
  sections(n, tl, s, t0) {
    const L = h("div", "layer", n);
    const head = place(h("div", "abs", L), { left: "160px", right: "160px", top: "210px", textAlign: "center" });
    const k = h("div", "kicker", head);
    place(k, { justifyContent: "center" });
    k.innerHTML = `<span class="rule"></span><span>${s.kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
    const tt = place(h("div", "h2", head), { marginTop: "18px", fontSize: "66px" });
    const tw = words(tt, s.title);
    const wrapP = place(h("div", "abs", L), { left: "180px", right: "180px", top: "500px", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "22px 20px", direction: "rtl" });
    const pills = s.items.map((it, i) => h("div", "pill", wrapP, `<span class="k">${fa(i + 1)}</span><span>${it}</span>`));
    tl.add(fadeIn(k, 0.6), t0 + 0.1).add(rise(tw, { stagger: 0.07 }), t0 + 0.25);
    hit(tl, t0 + 0.1, "whoosh");
    pills.forEach((pl, i) => tl.fromTo(pl, { opacity: 0, y: 40, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "pars" }, t0 + 0.9 + i * 0.16));
    const end = t0 + 0.9 + pills.length * 0.16 + 3;
    tl.to([head, ...pills], { opacity: 0, y: -30, duration: 0.5, ease: "power2.in", stagger: 0.01 }, end - 0.6);
    return end;
  },
  /** a path of numbered steps that light up in order (e.g. the eleven UNIDO steps) */
  steps(n, tl, s, t0) {
    const L = h("div", "layer", n);
    const head = place(h("div", "abs", L), { left: "160px", right: "160px", top: "150px", textAlign: "center" });
    const k = h("div", "kicker", head);
    place(k, { justifyContent: "center" });
    k.innerHTML = `<span class="rule"></span><span>${s.kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
    const tt = place(h("div", "h2", head), { marginTop: "18px", fontSize: "64px" });
    const tw = words(tt, s.title);
    const N = s.items.length, x0 = 1730, x1 = 190, y = 640;
    const track = place(h("div", "abs", L), { left: x1 + "px", width: x0 - x1 + "px", top: y - 2 + "px", height: "4px", borderRadius: "2px", background: "rgba(196,190,255,.16)" });
    const fill = place(h("div", "abs", L), { left: x1 + "px", width: x0 - x1 + "px", top: y - 2 + "px", height: "4px", borderRadius: "2px", background: "linear-gradient(270deg, #8f86ff, #c2479f 55%, #ff2b8f)", transformOrigin: "100% 50%" });
    const nodes = s.items.map((it, i) => {
      const x = x0 - ((x0 - x1) * i) / (N - 1), up = i % 2 === 0;
      const dot = place(h("div", "abs", L), { left: x - 26 + "px", top: y - 26 + "px", width: "52px", height: "52px", borderRadius: "50%", display: "grid", placeItems: "center", fontSize: "24px", fontWeight: 600, background: "#13122f", border: "2px solid rgba(196,190,255,.4)" });
      dot.textContent = fa(i + 1);
      const lab = place(h("div", "abs", L), { left: x - 110 + "px", width: "220px", top: (up ? y - 130 : y + 52) + "px", height: "78px", display: "flex", alignItems: up ? "flex-end" : "flex-start", justifyContent: "center", textAlign: "center", fontSize: "25px", fontWeight: 500, lineHeight: 1.45, color: "#c3bfdc" });
      lab.textContent = it;
      return { dot, lab };
    });
    tl.add(fadeIn(k, 0.6), t0 + 0.1).add(rise(tw, { stagger: 0.07 }), t0 + 0.25);
    tl.fromTo(track, { opacity: 0 }, { opacity: 1, duration: 0.6 }, t0 + 0.6);
    const per = s.per ?? 0.3, start = t0 + 0.9;
    hit(tl, t0 + 0.1, "whoosh");
    s.items.forEach((_, i) => i % 2 === 0 && hit(tl, start + i * per, "tick"));
    tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: per * (N - 1) + 0.2, ease: "none" }, start);
    nodes.forEach(({ dot, lab }, i) => {
      const at = start + i * per;
      tl.fromTo(dot, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(2)" }, at - 0.05);
      tl.to(dot, { background: "linear-gradient(140deg, #8f86ff, #ff2b8f)", borderColor: "rgba(255,255,255,.6)", boxShadow: "0 0 30px rgba(255,79,163,.6)", duration: 0.3 }, at + 0.1);
      tl.fromTo(lab, { opacity: 0, y: i % 2 ? -14 : 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "pars" }, at);
    });
    const end = start + per * N + 2.6;
    tl.to([head, track, fill, ...nodes.flatMap((o) => [o.dot, o.lab])], { opacity: 0, duration: 0.5, ease: "power2.in" }, end - 0.6);
    return end;
  },
  /** bars that grow to their values, with a total counter (e.g. the four BSC perspectives) */
  bars(n, tl, s, t0) {
    const L = h("div", "layer", n);
    const head = place(h("div", "abs", L), { right: "160px", top: "250px", width: "640px" });
    const k = h("div", "kicker", head);
    k.innerHTML = `<span class="n">●</span><span>${s.kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
    const tt = place(h("div", "h2", head), { marginTop: "18px", fontSize: "62px" });
    const tw = words(tt, s.title);
    const tot = place(h("div", "abs", L), { right: "160px", top: "560px", width: "640px", fontSize: "170px", fontWeight: 600, lineHeight: 1.05 });
    tot.innerHTML = `<span class="g">${fmtNum(0, s.total)}</span>`;
    const totL = place(h("div", "abs lead", L), { right: "160px", top: "760px", width: "640px", fontSize: "32px" });
    const tlw = words(totL, s.total.label);
    const box = place(h("div", "abs", L), { left: "160px", width: "860px", top: "290px", display: "grid", gap: "34px" });
    const rows = s.items.map((it) => {
      const r = h("div", "", box);
      r.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:32px;font-weight:600;margin-bottom:12px"><span>${it.label}</span><span class="v" style="color:${it.warn ? "#ffb547" : "#ff4fa3"}">${fmtNum(0, it)}</span></div><div style="height:18px;border-radius:9px;background:rgba(196,190,255,.14);overflow:hidden;direction:rtl"><i style="display:block;height:100%;width:${it.value}%;border-radius:9px;background:${it.warn ? "linear-gradient(270deg,#ffb547,#ff7a59)" : "var(--edge)"};transform-origin:100% 50%"></i></div>`;
      return { r, v: r.querySelector(".v"), bar: r.querySelector("i"), it };
    });
    tl.add(fadeIn(k, 0.6), t0 + 0.1).add(rise(tw, { stagger: 0.07 }), t0 + 0.25);
    rows.forEach(({ r, v, bar, it }, i) => {
      const at = t0 + 0.7 + i * 0.25, o = { v: 0 };
      tl.fromTo(r, { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.7, ease: "pars" }, at);
      tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 1.4, ease: "power3.out" }, at + 0.2);
      tl.fromTo(o, { v: 0 }, { v: it.value, duration: 1.4, ease: "power3.out", onUpdate: () => (v.textContent = fmtNum(o.v, it)) }, at + 0.2);
    });
    const o = { v: 0 };
    hit(tl, t0 + 0.1, "whoosh");
    hit(tl, t0 + 1.4, "sparkle");
    tl.fromTo(tot, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.8, ease: "pars" }, t0 + 1.4);
    tl.fromTo(o, { v: 0 }, { v: s.total.value, duration: 1.8, ease: "power3.out", onUpdate: () => (tot.firstChild.textContent = fmtNum(o.v, s.total)) }, t0 + 1.4);
    tl.add(rise(tlw, { stagger: 0.04, dur: 0.7 }), t0 + 1.8);
    const end = t0 + 6.2;
    tl.to([head, tot, totL, ...rows.map((x) => x.r)], { opacity: 0, y: -24, duration: 0.5, ease: "power2.in", stagger: 0.02 }, end - 0.6);
    return end;
  },
  /** one person, feedback from four angles (360°) */
  orbit(n, tl, s, t0) {
    const L = h("div", "layer", n);
    const head = place(h("div", "abs", L), { right: "150px", top: "330px", width: "640px" });
    const k = h("div", "kicker", head);
    k.innerHTML = `<span class="n">●</span><span>${s.kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
    const tt = place(h("div", "h2", head), { marginTop: "18px", fontSize: "62px" });
    const tw = words(tt, s.title);
    const ld = place(h("div", "lead", head), { marginTop: "16px", fontSize: "32px" });
    const lw = words(ld, s.lead);
    const cx = 640, cy = 560, R = 300;
    const ring = place(h("div", "abs", L), { left: cx - R + "px", top: cy - R + "px", width: 2 * R + "px", height: 2 * R + "px", borderRadius: "50%", border: "2px dashed rgba(196,190,255,.3)" });
    const me = place(h("div", "abs", L), { left: cx - 95 + "px", top: cy - 95 + "px", width: "190px", height: "190px", borderRadius: "50%", display: "grid", placeItems: "center", color: "#fff",
      background: "radial-gradient(circle at 50% 35%, rgba(223,17,115,.4), rgba(16,15,42,.97) 70%) padding-box, var(--edge) border-box", border: "3px solid transparent", boxShadow: "0 0 80px rgba(223,17,115,.4)" });
    me.innerHTML = icon("human");
    me.querySelector("svg").style.cssText = "width:90px;height:90px;stroke-width:1.5";
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "1920"); svg.setAttribute("height", "1080");
    svg.setAttribute("class", "abs"); svg.style.cssText = "left:0;top:0;overflow:visible";
    L.insertBefore(svg, ring);
    const nodes = s.items.map((it, i) => {
      const a = -Math.PI / 2 + (i / s.items.length) * Math.PI * 2 + Math.PI / 4;
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      const d = place(h("div", "abs pill", L), { left: x + "px", top: y + "px", transform: "translate(-50%,-50%)", fontSize: "28px" });
      d.innerHTML = `<span style="color:#ff4fa3;display:grid">${icon(it.icon)}</span><span>${it.label}</span>`;
      d.querySelector("svg").style.cssText = "width:30px;height:30px";
      const ln = document.createElementNS(svgNS, "line");
      ln.setAttribute("x1", x); ln.setAttribute("y1", y); ln.setAttribute("x2", cx); ln.setAttribute("y2", cy);
      ln.setAttribute("stroke", "url(#og)"); ln.setAttribute("stroke-width", "3"); ln.setAttribute("stroke-dasharray", "8 10");
      svg.appendChild(ln);
      return { d, ln };
    });
    svg.insertAdjacentHTML("afterbegin", `<defs><linearGradient id="og"><stop offset="0" stop-color="#8f86ff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient></defs>`);
    tl.to(BG, { ribbons: 0.22, duration: 1, ease: "power1.inOut" }, t0).to(BG, { ribbons: 0.4, duration: 1, ease: "power1.inOut" }, t0 + 5.4);
    tl.add(fadeIn(k, 0.6), t0 + 0.1).add(rise(tw, { stagger: 0.07 }), t0 + 0.25).add(rise(lw, { stagger: 0.035, dur: 0.7 }), t0 + 0.8);
    hit(tl, t0 + 0.3, "sparkle");
    tl.fromTo(me, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 1, ease: "back.out(1.6)" }, t0 + 0.3);
    tl.fromTo(ring, { opacity: 0, scale: 0.6, rotation: -50 }, { opacity: 1, scale: 1, rotation: 0, duration: 1.4, ease: "pars" }, t0 + 0.4);
    tl.to(ring, { rotation: 25, duration: 6, ease: "none" }, t0 + 1.8);
    nodes.forEach(({ d, ln }, i) => {
      tl.fromTo(d, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.8, ease: "back.out(1.8)" }, t0 + 1 + i * 0.3);
      tl.fromTo(ln, { opacity: 0 }, { opacity: 1, duration: 0.5 }, t0 + 1.2 + i * 0.3);
      tl.fromTo(ln, { strokeDashoffset: 0 }, { strokeDashoffset: -120, duration: 5, ease: "none" }, t0 + 1.2);
    });
    const end = t0 + 6.4;
    tl.to([head, me, ring, svg, ...nodes.map((o) => o.d)], { opacity: 0, duration: 0.5, ease: "power2.in" }, end - 0.6);
    return end;
  },
};

/* ── the AI copilot, live in the PM demo: the chat panel lifts out of the dashboard and works step by step ── */
function sceneCopilot(c) {
  const n = sceneBox();
  const tl = gsap.timeline();
  tl.to(BG.glowA, { x: 0.25, y: 0.5, a: 0.3, duration: 2.4, ease: "parsInOut" }, 0).to(BG.glowB, { x: 0.75, y: 0.35, a: 0.24, duration: 2.4, ease: "parsInOut" }, 0);
  tl.to(BG, { ribbons: 0.25, duration: 1.5, ease: "power1.inOut" }, 0);

  // A · the claim
  const A = h("div", "layer", n);
  const head = place(h("div", "abs", A), { left: "160px", right: "160px", top: "330px", textAlign: "center" });
  const k = h("div", "kicker", head);
  place(k, { justifyContent: "center" });
  k.innerHTML = `<span class="rule"></span><span style="color:#b8b1ff;display:inline-grid">${icon("ai")}</span><span>${c.kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  k.querySelector("svg").style.cssText = "width:30px;height:30px";
  const tt = place(h("div", "h1", head), { marginTop: "24px", fontSize: "88px" });
  const tw = words(tt, c.title);
  tl.add(fadeIn(k, 0.7, { from: { y: 16 }, to: { y: 0 } }), 0.1).add(rise(tw, { stagger: 0.08 }), 0.3);
  tl.to(BG.glowC, { x: 0.5, y: 0.45, r: 0.45, a: 0.16, duration: 1.2 }, 0.3).to(BG.glowC, { a: 0, duration: 1.2 }, 3.8);
  tl.add(sink(tw, { stagger: 0.02 }), 3.7).to(k, { opacity: 0, duration: 0.4 }, 3.7);
  let t = 4.3;

  // B · the PM dashboard; the cursor clicks the assistant's chip
  const b = new Browser(n, { x: X_MID, y: BY, w: BW, h: BH }, c.url);
  const p0 = b.page(c.before);
  gsap.set(b.root, { opacity: 0 });
  tl.fromTo(b.root, { opacity: 0, y: 120, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 1.2, ease: "pars" }, t);
  tl.set(p0.vp, { opacity: 1 }, t);
  t += 1.0;
  tl.set(b.cur, { page: 0 }, t);
  tl.fromTo(b.cur, { x: c.chip.x + 14, y: c.chip.y - 22, o: 0 }, { x: c.chip.x, y: c.chip.y, o: 1, duration: 0.9, ease: "parsInOut" }, t + 0.1);
  hit(tl, t + 1.0, "click");
  tl.to(b.cur, { press: 1, duration: 0.1, ease: "power2.in" }, t + 1.0).to(b.cur, { press: 0, duration: 0.18, ease: "power2.out" }, t + 1.1);
  tl.fromTo(b.cur, { ripple: 0 }, { ripple: 1, duration: 0.6, ease: "power2.out" }, t + 1.02);
  tl.to(b.cur, { o: 0, duration: 0.3 }, t + 1.35);
  t += 1.25;

  // C · the panel lifts out into its own device frame
  const D = { x: 150, y: 118, w: 550, h: 880 };
  const dev = new Browser(n, D, c.url, { chrome: false });
  const pages = c.steps.map((s) => {
    const pg = dev.page(s.screen);
    pg.cam = pg.frame(c.panel, { zmax: 8, fill: 1 });
    return pg;
  });
  gsap.set(dev.root, { opacity: 0, transformOrigin: "0 0" });
  tl.set(pages[0].vp, { opacity: 1 }, t);
  const v = p0.toVP(c.chip), sc0 = 0.06; // the chip on the dashboard (camera at the top of the page)
  hit(tl, t + 0.1, "whoosh");
  // the device opens out of the chip, then settles in its place; the browser falls away behind it
  tl.fromTo(dev.root, { x: X_MID + 10 + v.x - D.x, y: BY + 46 + v.y - D.y, scale: sc0 }, { x: 0, y: 0, scale: 1, duration: 1.4, ease: "parsInOut" }, t + 0.1);
  tl.fromTo(dev.root, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, t + 0.1);
  tl.to(b.root, { opacity: 0, x: 360, scale: 0.86, filter: "blur(6px)", duration: 1.1, ease: "power2.inOut" }, t + 0.35);
  t += 1.6;

  // D · the steps, each with a caption on the right
  const cap = place(h("div", "abs", n), { left: "800px", right: "150px", top: "300px" });
  c.steps.forEach((s, i) => {
    const pg = pages[i];
    // the next state of the chat rises from the bottom like a new message (same header, so only the conversation changes)
    if (i > 0) reveal(tl, pg, pages[i - 1], t + 0.1, "up", 0.65);
    const box = h("div", "", cap);
    place(box, { position: "absolute", left: "0", right: "0", top: "0" });
    const num = place(h("div", "kicker", box), {});
    num.innerHTML = `<span>گام ${fa(i + 1)} از ${fa(c.steps.length)}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
    const st = place(h("div", "h2", box), { marginTop: "16px", fontSize: "62px" });
    const sw = words(st, s.title);
    const ln = place(h("div", "lead", box), { marginTop: "18px", fontSize: "34px" });
    const lw = words(ln, s.line);
    const chips = s.chips ? place(h("div", "", box), { marginTop: "30px", display: "flex", flexWrap: "wrap", gap: "14px" }) : null;
    const ch = (s.chips ?? []).map((x) => h("div", "pill", chips, `<span style="color:#ff4fa3;display:grid">${icon("check")}</span><span>${x}</span>`));
    ch.forEach((e) => (e.querySelector("svg").style.cssText = "width:26px;height:26px"));
    const at = t + 0.35;
    hit(tl, at, i ? "tick" : "sparkle");
    tl.add(fadeIn(num, 0.5, { from: { y: 14 }, to: { y: 0 } }), at);
    tl.add(rise(sw, { stagger: 0.06 }), at + 0.1);
    tl.add(rise(lw, { stagger: 0.03, dur: 0.7 }), at + 0.5);
    ch.forEach((e, j) => tl.fromTo(e, { opacity: 0, y: 20, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.6)" }, at + 1 + j * 0.18));
    const dur = s.dur ?? 4.8;
    if (s.zoom) {
      const z = pg.frame(s.zoom, { zmax: 8, fill: 0.92 });
      // the top edge of the zoomed view sits on a clean boundary (below the panel's header rows), never through a line of text
      if (s.zoomTop != null) z.cy = Math.max(z.cy, s.zoomTop + pg.vh / 2 / (pg.fit * z.z));
      tl.to(pg.cam, { ...z, duration: 1.3, ease: "parsInOut" }, t + 1.1);
      tl.to(pg.cam, { ...pg.frame(c.panel, { zmax: 8, fill: 1 }), duration: 1.1, ease: "parsInOut" }, t + dur - 1.2);
    }
    tl.to(box, { opacity: 0, y: -24, duration: 0.45, ease: "power2.in" }, t + dur - 0.45);
    t += dur;
  });

  // E · the line that closes the chapter
  tl.to(dev.root, { opacity: 0, scale: 0.92, y: 40, duration: 0.8, ease: "power2.in" }, t - 0.2);
  const E = place(h("div", "abs", n), { left: "120px", right: "120px", top: "360px", textAlign: "center" });
  const et = place(h("div", "h1", E), { fontSize: "76px", lineHeight: 1.5 });
  const ew = words(et, c.closing);
  hit(tl, t + 0.5, "swell");
  tl.add(rise(ew, { stagger: 0.08, dur: 1 }), t + 0.5);
  tl.to(BG.glowC, { x: 0.5, y: 0.5, r: 0.5, a: 0.2, duration: 1.4 }, t + 0.4).to(BG.glowC, { a: 0, duration: 1 }, t + 4.6);
  tl.add(sink(ew, { stagger: 0.02 }), t + 4.8);
  t += 5.5;
  tl.to(BG, { ribbons: 0.4, duration: 1, ease: "power1.inOut" }, t - 1);
  tl.to({}, { duration: 0.1 }, t);
  return wrap(n, tl, 0.3);
}

/* ── outro: the call to action, how to reach Pars, the logo; ends on the intro's first frame (ink, nothing else) ── */
function sceneOutro({ title, lead, contact, site, start = 0, bar = 2 }) {
  const n = sceneBox();
  const tt = place(h("div", "abs h2", n), { right: "160px", top: "300px", width: "940px", fontSize: "76px" });
  const tw = words(tt, title);
  const ld = place(h("div", "abs lead", n), { right: "160px", top: "560px", width: "900px" });
  const lw = words(ld, lead);
  // the site, the e-mail and the phones: the same details as the booth
  const card = place(h("div", "abs glass", n), { left: "170px", top: "300px", width: "600px", padding: "44px 46px", display: "grid", gap: "34px", boxShadow: "0 40px 120px rgba(0,0,0,.5), 0 0 120px rgba(143,134,255,.25)" });
  const row = (ic, html, latin) => {
    const r = h("div", "", card, `<span style="flex:none;width:68px;height:68px;border-radius:18px;display:grid;place-items:center;background:rgba(143,134,255,.16);border:1.5px solid rgba(169,162,255,.55);color:#ff4fa3">${icon(ic)}</span><span class="${latin ? "latin" : ""}" style="font-size:${latin ? 36 : 40}px;font-weight:600;white-space:nowrap">${html}</span>`);
    place(r, { display: "flex", alignItems: "center", gap: "24px" });
    r.querySelector("svg").style.cssText = "width:34px;height:34px";
    return r;
  };
  const rows = [row("globe", site, 1), row("mail", contact.mail, 1), row("phone", `${contact.phones[0]} <span style="color:#c3bfdc;font-weight:500">و</span> ${contact.phones[1]}`)];
  const logo = place(h("img", "abs", n), { right: "160px", top: "700px", width: "190px" });
  logo.src = "assets/brand/pars-logo-reverse.svg";
  const tl = gsap.timeline();
  tl.to(BG, { ribbons: 0.25, duration: 2, ease: "parsInOut" }, 0);
  tl.add(rise(tw, { stagger: 0.08 }), 0.3);
  tl.add(rise(lw, { stagger: 0.04, dur: 0.8 }), 1.1);
  tl.fromTo(card, { opacity: 0, scale: 0.9, rotationY: -20, transformPerspective: 1600 }, { opacity: 1, scale: 1, rotationY: 0, duration: 1.2, ease: "pars" }, 0.6);
  rows.forEach((r, i) => tl.fromTo(r, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.7, ease: "pars" }, 1 + i * 0.22));
  hit(tl, 1, "sparkle");
  tl.add(fadeIn(logo, 0.9, { from: { y: 20 }, to: { y: 0 } }), 1.6);
  // everything is gone before the last frame, which then matches the intro's first one
  tl.to([tt, ld, card, logo], { opacity: 0, duration: 1.2, ease: "power2.inOut" }, 8.2);
  tl.to(BG, { ribbons: 0, particles: 0, converge: 0, duration: 1.6, ease: "power2.inOut" }, 8.2);
  tl.to(BG.glowA, { a: 0, duration: 1.6 }, 8.2).to(BG.glowB, { a: 0, duration: 1.6 }, 8.2).to(BG.glowC, { a: 0, duration: 1.6 }, 8.2);
  tl.to({}, { duration: 0.6 }, 9.8);
  // the details hold a little longer so the loop ends on a bar line of the music, already in ink
  const end = start + tl.duration();
  tl.shiftChildren(Math.ceil(end / bar - 1e-6) * bar - end, false, 8.2);
  return wrap(n, tl, 0.2);
}

/* ── the product family: the demo hub's systems as one grid ──── */
function sceneOverview({ kicker, title, lead, items }) {
  const n = sceneBox();
  const head = place(h("div", "abs", n), { left: "140px", right: "140px", top: "120px", textAlign: "center" });
  const k = h("div", "kicker", head);
  place(k, { justifyContent: "center" });
  k.innerHTML = `<span class="rule"></span><span>${kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  const t = place(h("div", "h3", head), { marginTop: "16px", fontSize: "54px" });
  const tw = words(t, title);
  const l = place(h("div", "lead", head), { marginTop: "6px", fontSize: "28px" });
  const lw = words(l, lead);
  // rows fill right to left and a short last row is centred (no hole at the bottom-left)
  const grid = place(h("div", "abs", n), { left: "150px", right: "150px", top: "330px", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "22px", direction: "rtl", perspective: "1600px" });
  const cards = items.map((it) => {
    const c = place(h("div", "", grid), { width: "306px", height: "175px", borderRadius: "20px", padding: "22px 20px", background: "linear-gradient(rgba(19,18,47,.92), rgba(19,18,47,.92)) padding-box, linear-gradient(140deg, rgba(196,190,255,.4), rgba(196,190,255,.08) 40%, rgba(255,79,163,.35)) border-box", border: "1.5px solid transparent", display: "flex", flexDirection: "column", gap: "10px", transformStyle: "preserve-3d" });
    c.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between"><span style="width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:rgba(143,134,255,.14);border:1.5px solid rgba(169,162,255,.4);color:#b8b1ff">${icon(it.icon)}</span><span class="latin" style="font-size:20px;font-weight:600;color:#ff4fa3">${it.code ?? ""}</span></div>
      <div style="font-size:25px;font-weight:600;line-height:1.4">${it.name}</div><div style="font-size:18px;line-height:1.55;color:#c3bfdc">${it.line}</div>`;
    c.querySelector("svg").style.cssText = "width:28px;height:28px";
    return c;
  });
  const tl = gsap.timeline();
  // the heading waits for the outgoing chapter to clear (chapters overlap by up to half a second)
  tl.add(fadeIn(k, 0.7), 0.5).add(rise(tw, { stagger: 0.07 }), 0.65).add(rise(lw, { stagger: 0.03, dur: 0.7 }), 1.05);
  cards.forEach((c, i) => {
    const row = Math.floor(i / 5), col = 4 - (i % 5);
    tl.fromTo(c, { opacity: 0, rotationX: -50, y: 60, z: -200 }, { opacity: 1, rotationX: 0, y: 0, z: 0, duration: 1, ease: "pars" }, 1.1 + row * 0.25 + col * 0.09);
  });
  // a light passes over the grid
  const sweep = place(h("div", "abs", n), { left: "0", top: "330px", width: "380px", height: "640px", background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.10), rgba(255,255,255,0))", transform: "skewX(-18deg)", mixBlendMode: "screen", opacity: 0,
    maskImage: "linear-gradient(transparent, #000 18%, #000 82%, transparent)", WebkitMaskImage: "linear-gradient(transparent, #000 18%, #000 82%, transparent)" });
  tl.fromTo(sweep, { x: 1900, opacity: 1 }, { x: -500, duration: 1.8, ease: "power2.inOut" }, 3.4);
  tl.to({}, { duration: 3.2 }, 3.4);
  tl.to(cards, { opacity: 0, y: -30, duration: 0.5, ease: "power2.in", stagger: 0.015 }, 7.6);
  tl.to(head, { opacity: 0, duration: 0.5 }, 7.6);
  return wrap(n, tl, 0.3);
}

/* ── how the agents work: inputs converge, results fan out ───── */
function sceneAgents({ kicker, title, inputs, stages, outputs }) {
  const n = sceneBox();
  const head = place(h("div", "abs", n), { left: "140px", right: "140px", top: "105px", textAlign: "center" });
  const k = h("div", "kicker", head);
  place(k, { justifyContent: "center" });
  k.innerHTML = `<span class="rule"></span><span>${kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  const t = place(h("div", "h3", head), { marginTop: "14px", fontSize: "58px" });
  const tw = words(t, title);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "abs");
  svg.setAttribute("width", "1920"); svg.setAttribute("height", "1080");
  svg.style.cssText = "left:0;top:0;overflow:visible";
  n.appendChild(svg);
  const node = (x, y, ic, label, cls) => {
    const d = place(h("div", "abs", n), { left: x - 170 + "px", top: y - 60 + "px", width: "340px", height: "120px", borderRadius: "22px", display: "flex", alignItems: "center", gap: "16px", padding: "0 24px",
      background: "linear-gradient(rgba(19,18,47,.95), rgba(19,18,47,.95)) padding-box, linear-gradient(140deg, rgba(196,190,255,.5), rgba(255,79,163,.4)) border-box", border: "1.5px solid transparent" });
    d.innerHTML = `<span style="flex:none;width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:${cls === "out" ? "rgba(255,43,143,.14)" : "rgba(143,134,255,.14)"};color:${cls === "out" ? "#ff4fa3" : "#b8b1ff"}">${icon(ic)}</span><span style="font-size:27px;font-weight:600;line-height:1.35">${label}</span>`;
    d.querySelector("svg").style.cssText = "width:30px;height:30px";
    return d;
  };
  const yIn = [380, 520, 660, 800], cx = 960, cy = 590;
  const ins = inputs.map((it, i) => node(1640, yIn[i], it.icon, it.label, "in"));
  const outs = outputs.map((it, i) => node(280, yIn[i], it.icon, it.label, "out"));
  const core = place(h("div", "abs", n), { left: cx - 230 + "px", top: cy - 190 + "px", width: "460px", height: "380px", borderRadius: "40px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px",
    background: "radial-gradient(circle at 50% 35%, rgba(223,17,115,.28), rgba(16,15,42,.97) 60%) padding-box, var(--edge) border-box", border: "2.5px solid transparent", boxShadow: "0 0 120px rgba(223,17,115,.35)" });
  core.innerHTML = `<img src="assets/brand/pars-mark-reverse.svg" style="width:120px"><div style="font-size:38px;font-weight:600">ایجنت‌های پارس</div><div class="st" style="display:flex;gap:12px;font-size:23px;color:#c3bfdc"></div>`;
  const st = core.querySelector(".st");
  stages.forEach((s, i) => { st.insertAdjacentHTML("beforeend", `${i ? '<span style="color:#ff4fa3">←</span>' : ""}<span>${s}</span>`); });
  // connectors
  const paths = [];
  const mk = (d, col) => {
    const p = document.createElementNS(svgNS, "path");
    p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", col); p.setAttribute("stroke-width", "3"); p.setAttribute("stroke-linecap", "round");
    svg.appendChild(p);
    const L = p.getTotalLength();
    p.style.strokeDasharray = `${L} ${L}`; p.style.strokeDashoffset = L;
    paths.push(p);
    return { p, L };
  };
  const inPaths = yIn.map((y) => mk(`M${1640 - 170} ${y}C${1300} ${y} ${1350} ${cy} ${cx + 230} ${cy}`, "url(#gin)"));
  const outPaths = yIn.map((y) => mk(`M${cx - 230} ${cy}C${600} ${cy} ${650} ${y} ${280 + 170} ${y}`, "url(#gout)"));
  svg.insertAdjacentHTML("afterbegin", `<defs><linearGradient id="gin" x1="1" x2="0"><stop offset="0" stop-color="#8f86ff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient><linearGradient id="gout" x1="1" x2="0"><stop offset="0" stop-color="#ff4fa3"/><stop offset="1" stop-color="#a9a2ff"/></linearGradient></defs>`);
  // packets travelling along the connectors
  const packets = [];
  [...inPaths, ...outPaths].forEach((c, i) => {
    for (let k = 0; k < 2; k++) {
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("r", "7"); dot.setAttribute("fill", i < 4 ? "#c9c4ff" : "#ff8cc4");
      dot.style.filter = "drop-shadow(0 0 8px rgba(255,79,163,.9))";
      dot.setAttribute("opacity", "0");
      svg.appendChild(dot);
      packets.push({ dot, c, off: k * 0.5 + (i % 4) * 0.13, out: i >= 4 });
    }
  });
  const prog = { k: 0 };
  const tl = gsap.timeline();
  tl.add(fadeIn(k, 0.7), 0.1).add(rise(tw, { stagger: 0.07 }), 0.25);
  ins.forEach((d, i) => tl.fromTo(d, { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.8, ease: "pars" }, 1 + i * 0.15));
  tl.fromTo(core, { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 1.1, ease: "pars" }, 1.6);
  inPaths.forEach((c, i) => tl.to(c.p, { strokeDashoffset: 0, duration: 1, ease: "power2.inOut" }, 2 + i * 0.12));
  outPaths.forEach((c, i) => tl.to(c.p, { strokeDashoffset: 0, duration: 1, ease: "power2.inOut" }, 3.1 + i * 0.12));
  outs.forEach((d, i) => tl.fromTo(d, { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.8, ease: "pars" }, 3.6 + i * 0.15));
  tl.fromTo(prog, { k: 0 }, { k: 6, duration: 7, ease: "none", onUpdate: () => {
    for (const pk of packets) {
      const raw = prog.k - (pk.out ? 1.2 : 0) - pk.off;
      if (raw < 0) { pk.dot.setAttribute("opacity", "0"); continue; }
      const u = raw % 1, pt = pk.c.p.getPointAtLength(u * pk.c.L);
      pk.dot.setAttribute("cx", pt.x); pk.dot.setAttribute("cy", pt.y);
      pk.dot.setAttribute("opacity", String(Math.sin(Math.PI * u)));
    }
  } }, 2.6);
  tl.to(BG.glowC, { a: 0.18, r: 0.35, x: 0.5, y: 0.55, duration: 1.5 }, 1.6).to(BG.glowC, { a: 0, duration: 1 }, 9);
  tl.to([head, core, ...ins, ...outs, svg], { opacity: 0, duration: 0.6, ease: "power2.in" }, 9.4);
  return wrap(n, tl, 0.3);
}

/* ── what Pars does: capabilities around the mark ────────────── */
function sceneCapabilities({ kicker, title, items }) {
  const n = sceneBox();
  const head = place(h("div", "abs", n), { right: "150px", top: "330px", width: "620px" });
  const k = h("div", "kicker", head);
  k.innerHTML = `<span class="n">●</span><span>${kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  const t = place(h("div", "h2", head), { marginTop: "20px", fontSize: "64px" });
  const tw = words(t, title);
  const cx = 640, cy = 560, R = 330;
  const mark = place(h("img", "abs", n), { left: cx - 90 + "px", top: cy - 95 + "px", width: "180px" });
  mark.src = "assets/brand/pars-mark-reverse.svg";
  const ring = place(h("div", "abs", n), { left: cx - R + "px", top: cy - R + "px", width: 2 * R + "px", height: 2 * R + "px", borderRadius: "50%", border: "2px dashed rgba(196,190,255,.28)" });
  const nodes = items.map((it, i) => {
    const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    const d = place(h("div", "abs", n), { left: x - 170 + "px", top: y - 52 + "px", width: "340px", minHeight: "104px", borderRadius: "20px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px",
      background: "linear-gradient(rgba(19,18,47,.95), rgba(19,18,47,.95)) padding-box, linear-gradient(140deg, rgba(196,190,255,.5), rgba(255,79,163,.45)) border-box", border: "1.5px solid transparent" });
    d.innerHTML = `<span style="flex:none;width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:${it.ai ? "rgba(143,134,255,.28)" : "rgba(143,134,255,.14)"};color:${it.ai ? "#ffffff" : "#b8b1ff"};${it.ai ? "box-shadow:0 0 24px rgba(143,134,255,.6)" : ""}">${icon(it.icon)}</span><span style="font-size:23px;font-weight:600;line-height:1.4">${it.label}</span>`;
    d.querySelector("svg").style.cssText = "width:28px;height:28px";
    return d;
  });
  const tl = gsap.timeline();
  tl.to(BG, { ribbons: 0.22, duration: 1, ease: "power1.inOut" }, 0).to(BG, { ribbons: 0.4, duration: 1, ease: "power1.inOut" }, 8.4);
  tl.add(fadeIn(k, 0.7), 0.2).add(rise(tw, { stagger: 0.07 }), 0.35);
  tl.fromTo(mark, { opacity: 0, scale: 0.5, rotation: -20 }, { opacity: 1, scale: 1, rotation: 0, duration: 1.2, ease: "pars" }, 0.4);
  tl.fromTo(ring, { opacity: 0, scale: 0.6, rotation: -60 }, { opacity: 1, scale: 1, rotation: 0, duration: 1.6, ease: "pars" }, 0.5);
  tl.to(ring, { rotation: 30, duration: 8, ease: "none" }, 2);
  nodes.forEach((d, i) => tl.fromTo(d, { opacity: 0, scale: 0.6, x: (cx - parseFloat(d.style.left) - 170) * 0.6, y: (cy - parseFloat(d.style.top) - 52) * 0.6 }, { opacity: 1, scale: 1, x: 0, y: 0, duration: 1, ease: "pars" }, 1.1 + i * 0.22));
  tl.to([head, mark, ring, ...nodes], { opacity: 0, duration: 0.6, ease: "power2.in" }, 8.8);
  return wrap(n, tl, 0.3);
}

/* ── who has worked with Pars ────────────────────────────────── */
function sceneClients({ kicker, title, logos, more }) {
  const n = sceneBox();
  const head = place(h("div", "abs", n), { left: "140px", right: "140px", top: "120px", textAlign: "center" });
  const k = h("div", "kicker", head);
  place(k, { justifyContent: "center" });
  k.innerHTML = `<span class="rule"></span><span>${kicker}</span><span class="rule" style="transform:scaleX(-1)"></span>`;
  const t = place(h("div", "h3", head), { marginTop: "16px", fontSize: "58px" });
  const tw = words(t, title);
  const grid = place(h("div", "abs", n), { left: "260px", right: "260px", top: "320px", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "26px 24px", direction: "rtl" });
  const tiles = logos.map((l) => {
    const c = place(h("div", "", grid), { width: "245px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" });
    c.innerHTML = `<div style="width:100%;height:150px;border-radius:14px;background:#fff;display:grid;place-items:center;box-shadow:0 20px 50px rgba(0,0,0,.4)"><img src="assets/clients/${l.file}" style="max-height:104px;max-width:74%;object-fit:contain"></div><div style="font-size:22px;font-weight:500;color:#c3bfdc;text-align:center;line-height:1.4">${l.name}</div>`;
    return c;
  });
  const m = place(h("div", "abs", n), { left: "0", right: "0", top: "860px", textAlign: "center", fontSize: "34px", fontWeight: 500 });
  m.innerHTML = more;
  const tl = gsap.timeline();
  tl.add(fadeIn(k, 0.7), 0.1).add(rise(tw, { stagger: 0.07 }), 0.25);
  tiles.forEach((c, i) => tl.fromTo(c, { opacity: 0, y: 50, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: "pars" }, 0.9 + i * 0.12));
  tl.add(fadeIn(m, 0.8, { from: { y: 20 }, to: { y: 0 } }), 2.4);
  tl.to([head, ...tiles, m], { opacity: 0, duration: 0.6, ease: "power2.in" }, 6.8);
  return wrap(n, tl, 0.3);
}
