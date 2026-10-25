/* The booth items: sizes, copy and layout. Every coordinate is in centimetres from the top-left corner of the printed file.
   Facts follow the website (src/content/fa.ts) and the brand book; copy matches the brochure. */
const Q = new URLSearchParams(location.search);
const ITEM = Q.get("item") ?? "popup", STYLE = Q.get("style") ?? "minimal", MODE = Q.get("mode") ?? "dark";
document.documentElement.dataset.mode = MODE;
const DARK = MODE === "dark";

// popup: 35 return | 291 face | 35 return · roll-ups: 85 × 200 trim + 5 cm bleed · counter: 72 side | 70 front | 72 side
const SIZES = { popup: { w: 361, h: 230 }, rollup1: { w: 95, h: 210 }, rollup2: { w: 95, h: 210 }, counter: { w: 214, h: 90 }, swatch: { w: 60, h: 45 } };
// where content may sit (cm): the proof draws these as the green safe area and render.mjs fails on any block outside them.
// Pop-up: the face above the counters (y ≤ 140), with seams that logos, numbers, the QR and the agent steps keep off.
// Roll-up: inside the trim, above the stand foot. Counter: clear of the folds. The returns' marks are decoration.
window.SAFE = {
  popup: { x: [43, 318], y: [10, 140], seams: [107.75, 180.5, 253.25] },
  rollup1: { x: [10, 85], y: [10, 190], seams: [] },
  rollup2: { x: [10, 85], y: [10, 190], seams: [] },
  counter: { x: [3, 211], y: [4, 82], seams: [72, 142] },
};
const SIZE = SIZES[ITEM];
const HOST = new URL(window.SITE_URL).host;

const COPY = {
  slogan2: ['جایی که مدیریت و <span class="g">هوش</span>', "به هم می‌رسند."],
  slogan3: ["جایی که", 'مدیریت و <span class="g">هوش</span>', "به هم می‌رسند."],
  sloganLine: 'جایی که مدیریت و <span class="g">هوش</span> به هم می‌رسند.',
  name: "مدیریت پروژه پارس",
  phones: ["۰۲۱-۸۸۷۳۱۶۰۱", "۰۲۱-۸۲۸۰۳۵۶۵"],
  mail: "info@parspmi.ir",
};
const SVC = {
  agents: { icon: "agents", ai: 1, t: "ایجنت‌ها و دستیارهای هوشمند", d: "<bdi>RAG</bdi> فارسی روی اسناد سازمان، تحلیل پیش‌بین و جستجوی هوشمند." },
  epm: { icon: "epm", t: "سامانه‌های <bdi>EPM</bdi> و <bdi>EPPM</bdi>", d: "طراحی و استقرار روی <bdi>Project Server</bdi>، <bdi>Primavera P6</bdi> و <bdi>Jira</bdi>." },
  custom: { icon: "custom", t: "سامانه‌های مدیریتی سازمانی", d: "پروژه‌ها و وظایف، درخواست‌ها و قراردادها، ارزیابی عملکرد و مستندات." },
  data: { icon: "pattern", t: "مهندسی و تحلیل داده", d: "داده‌های بزرگ، <bdi>BI</bdi> و داشبوردهای مدیریتی برای تصمیم‌گیری." },
  migration: { icon: "migration", t: "نوسازی و مهاجرت <bdi>EPM</bdi>", d: "ارزیابی سامانه‌ی فعلی، انتقال امن با حفظ همه‌ی داده‌های تاریخی و افزودن هوش مصنوعی." },
  academy: { icon: "training", t: "آموزش و توانمندسازی", d: "دوره‌های <bdi>PMBOK</bdi>، <bdi>MSP</bdi>، <bdi>Primavera P6</bdi>، <bdi>PMP</bdi> و <bdi>PSM</bdi>؛ درون‌سازمانی، آنلاین یا مجازی." },
  consult: { icon: "consult", t: "مشاوره‌ی مدیریت پروژه", d: "عارضه‌یابی نظام مدیریت پروژه و طراحی سیستم برنامه‌ریزی و کنترل پروژه بر پایه‌ی <bdi>PMBOK</bdi>." },
  training: { icon: "training", t: "آموزش و مشاوره", d: "دوره‌های <bdi>PMBOK</bdi>، <bdi>PMP</bdi>، <bdi>PSM</bdi> و <bdi>Primavera P6</bdi>؛ طراحی نظام برنامه‌ریزی و کنترل پروژه." },
};
const STATS = [
  { n: "۱۵+", l: "سال تجربه،<br>از ۱۳۸۹" },
  { n: "۲۰", l: "بانک و سازمان<br>با سامانه‌های پارس" },
  { n: "۶۰+", l: "سازمان در آموزش،<br>مشاوره و نرم‌افزار" },
  { n: "تا ۹۰٪", l: "خودکارسازی کارهای تکراری،<br>با تأیید انسانی" },
];
const CLIENTS = [
  ["mellat.svg", "بانک ملت"], ["tejarat.svg", "بانک تجارت"], ["melli.svg", "بانک ملی ایران"], ["refah.svg", "بانک رفاه کارگران"], ["sepah.svg", "بانک سپه"],
  ["postbank.svg", "پست بانک ایران"], ["ayandeh.svg", "بانک آینده"], ["igmc.webp", "مدیریت شبکه برق ایران"], ["rajaee.webp", "قرارگاه خاتم‌الانبیاء"],
];
const STEPS = [["read", "خواندن"], ["understand", "فهمیدن"], ["predict", "پیش‌بینی"], ["act", "اقدام"]];
const PATH = ["کشف و<br>ارزیابی", "طراحی<br>راهکار", "ساخت و<br>استقرار", "اتوماسیون<br>هوشمند", "آموزش و<br>تکامل"];

const LOGO = DARK ? "assets/pars-logo-reverse.svg" : "assets/pars-logo.svg";
const MARK = DARK ? "assets/pars-mark-reverse.svg" : "assets/pars-mark.svg";

const board = document.getElementById("board");
board.style.width = SIZE.w + "cm";
board.style.height = SIZE.h + "cm";
const page = document.createElement("style");
// Chromium rounds the page size down to 0.01 in, which would leave the last fraction of a millimetre blank: the page gets
// 1 mm more than the board and render.mjs crops it back to the exact size from the top-left corner
page.textContent = `@page { size: ${SIZE.w + 0.1}cm ${SIZE.h + 0.1}cm; margin: 0; } html, body { width: ${SIZE.w + 0.1}cm; height: ${SIZE.h + 0.1}cm; overflow: hidden; }`;
document.head.appendChild(page);

/** a block at (x, y) cm, width w cm (height optional); css: extra inline style */
function B(x, y, w, h, html, cls = "", css = "") {
  const n = document.createElement("div");
  n.className = "b " + cls;
  n.style.cssText = `left:${x}cm;top:${y}cm;width:${w}cm;${h ? `height:${h}cm;` : ""}${css}`;
  n.innerHTML = html;
  board.appendChild(n);
  return n;
}
const img = (x, y, w, src, cls = "") => B(x, y, w, 0, `<img src="${src}" style="width:100%;display:block" alt="">`, cls);
const logo = (x, y, w) => img(x, y, w, LOGO, "logo");
const mark = (x, y, w) => img(x, y, w, MARK, "mark");
const lines = (arr) => arr.join("<br>");

/** service rows; size s = title font in cm */
function services(x, y, w, keys, s, gap) {
  const icon = s * 2.9, pad = s * 0.62;
  const rows = keys.map((k) => {
    const v = SVC[k];
    return `<div class="row${v.ai ? " ai" : ""}" style="gap:${pad}cm;padding:${pad}cm ${pad * 1.1}cm;border-radius:${s * 0.6}cm;border-width:${s * 0.016}cm">
      <span class="ic" style="width:${icon}cm;height:${icon}cm;border-radius:${s * 0.5}cm;font-size:${icon * 0.56}cm;border-width:${s * 0.016}cm">${ico(v.icon)}</span>
      <div><div class="t" style="font-size:${s}cm">${v.t}</div><div class="d" style="font-size:${s * 0.72}cm">${v.d}</div></div></div>`;
  });
  return B(x, y, w, 0, rows.join(""), "svc", `gap:${gap}cm`);
}
function kicker(x, y, w, n, text, s) {
  return B(x, y, w, 0, `${n ? `<span class="n">${n}</span>` : ""}<span>${text}</span><span class="rule"></span>`, "kicker", `font-size:${s}cm`);
}
function qr(x, y, size) {
  return B(x, y, size, size, window.QR_SVG, "qr", `border-radius:${size * 0.06}cm;padding:${size * 0.02}cm`);
}
function contact(x, y, w, s, opts = {}) {
  const parts = [];
  if (opts.title) parts.push(`<div class="hl" style="font-size:${s * 1.25}cm;line-height:1.45;margin-bottom:${s * 0.35}cm">${opts.title}</div>`);
  parts.push(`<div class="li url latin ltr" style="font-size:${s * 1.08}cm;justify-content:flex-end">${HOST}${ico("globe")}</div>`);
  if (opts.phone !== false) parts.push(`<div class="li" style="font-size:${s * 0.92}cm;margin-top:${s * 0.3}cm">${ico("phone")}<span class="ltr">${COPY.phones[0]}</span><span>و</span><span class="ltr">${COPY.phones[1]}</span></div>`);
  if (opts.mail) parts.push(`<div class="li" style="font-size:${s * 0.92}cm;margin-top:${s * 0.25}cm">${ico("mail")}<span class="ltr latin" style="font-weight:400">${COPY.mail}</span></div>`);
  return B(x, y, w, 0, parts.join(""), "contact", `align-items:${opts.align ?? "flex-start"}`);
}
function url(x, y, w, s, align = "right") {
  return B(x, y, w, 0, `<span class="latin ltr" style="font-weight:600">${HOST}</span>${ico("globe")}`, "urlline",
    `font-size:${s}cm;display:flex;align-items:center;gap:.4em;justify-content:${align === "center" ? "center" : align === "left" ? "flex-end" : "flex-start"};color:var(--fg)`);
}
function stat(x, y, w, st, s, align = "center", ls = s * 0.25) {
  return B(x, y, w, 0, `<div class="num" style="font-size:${s}cm"><span class="g">${st.n}</span></div><div class="lab" style="font-size:${ls}cm;margin-top:${s * 0.08}cm">${st.l}</div>`, "stat", `text-align:${align}`);
}
/** a hairline that fades out at both ends */
const rule = (x, y, w) => B(x, y, w, 0.1, "", "hair");
/** the company's Persian name, set under the logo */
const name = (x, y, w, s) => B(x, y, w, 0, COPY.name, "hl name", `font-size:${s}cm;line-height:1.3;text-align:center`);
/** service names with their icons, no detail: the minimal roll-ups */
function svcList(x, y, w, keys, s) {
  const rows = keys.map((k) => `<div class="li${SVC[k].ai ? " ai" : ""}" style="gap:${s * 0.55}cm;padding:${s * 0.42}cm 0">${ico(SVC[k].icon)}<span>${SVC[k].t}</span></div>`);
  return B(x, y, w, 0, rows.join(""), "svclist", `font-size:${s}cm`);
}

/* ═══════════════════ POP-UP · 361 × 230 (35 | 291 | 35) ═══════════════════ */
const FACE = [35, 326];
function popup() {
  if (STYLE === "minimal") {
    for (const x of [7.5, 333.5]) mark(x, 20, 20);
    logo(258, 12, 52);
    name(258, 57.5, 52, 4.4);
    B(90, 71, 220, 0, lines(COPY.slogan2), "hl slogan", "font-size:15cm;line-height:1.42;text-align:right");
    B(90, 116.5, 220, 0, "سامانه‌های مدیریت پروژه، حالا با ایجنت‌های هوش مصنوعی.", "muted sub", "font-size:5cm;text-align:right;line-height:1.5");
    url(90, 127.5, 220, 5);
    return;
  }
  // four face panels of 72.75 cm (P1 at the left … P4 at the right); logos and small text stay off the seams,
  // and everything that matters sits above y = 140, the top of the counters
  const panel = (FACE[1] - FACE[0]) / 4, mid = (p) => FACE[0] + (p + 0.5) * panel;
  for (const x of [8.5, 334.5]) mark(x, 16, 18);
  logo(mid(3) - 17, 10.5, 34);
  name(mid(3) - 25, 41, 50, 3.3);
  B(118, 20.5, 128, 0, COPY.sloganLine, "hl slogan", "font-size:6cm;text-align:right;white-space:nowrap");
  // P1: the QR, what it opens and the address
  qr(mid(0) - 14, 10.5, 28);
  B(mid(0) - 27, 40.5, 54, 0, "سوابق و دموها را ببینید", "muted", "font-size:2.8cm;font-weight:500;line-height:1.4;text-align:center");
  url(mid(0) - 27, 46.1, 54, 2.8, "center");
  // P3–P4: headline and a line of proof
  B(184, 53, 134, 0, lines(["مدیریت پروژه‌ی سازمانی،", 'حالا با <span class="g">ایجنت‌های هوش مصنوعی</span>.']), "hl head fit", "font-size:8cm;line-height:1.42;text-align:right");
  B(184, 77.5, 134, 0, "از ۱۳۸۹ سامانه‌های مدیریت پروژه‌ی بانک‌ها و سازمان‌های بزرگ را می‌سازیم؛ حالا ایجنت‌ها کارهای تکراری دفتر پروژه را خودکار می‌کنند.", "muted", "font-size:3.4cm;line-height:1.65;text-align:justify;text-align-last:right");
  // P1–P2: what an agent does, four steps joined by a thread (art.js); the seam falls between the second and third step
  kicker(43, 54, 129, "", "ایجنت‌های پارس چه می‌کنند", 3.2);
  B(46, 60, 120, 0, STEPS.map(([i, t]) => `<div class="st" style="width:15cm"><span class="dot" style="width:15cm;height:15cm;font-size:7cm;border-width:.22cm">${ico(i)}</span><b style="font-size:3.6cm;margin-top:1.1cm">${t}</b></div>`).join(""), "flow", "");
  B(43, 84.5, 62, 0, `${ico("human")}<span>انسان در حلقه: تصمیم‌های حساس با تأیید شما</span>`, "", "font-size:2.9cm;display:flex;align-items:center;gap:.4em;justify-content:center;color:var(--muted);font-weight:500;white-space:nowrap");
  // one statistic per panel
  [3, 2, 1, 0].forEach((p, i) => stat(mid(p) - 28, 97, 56, STATS[i], 10.5, "center", 2.8));
  // clients: 2 + 3 + 3 + 2 tiles, each group centred in its panel
  kicker(184, 121.5, 134, "", "در کنار این سازمان‌ها بوده‌ایم", 3);
  const cell = (inner, caption) => `<figure style="width:19cm"><div class="t" style="width:19cm;height:8.5cm;border-radius:1.4cm;padding:1.3cm 1.8cm">${inner}</div><figcaption style="font-size:1.9cm;margin-top:.5cm;white-space:nowrap">${caption}</figcaption></figure>`;
  const cells = CLIENTS.map(([f, n]) => cell(`<img src="assets/${f}" alt="">`, n));
  cells.push(`<figure style="width:19cm"><div class="t more" style="width:19cm;height:8.5cm;border-radius:1.4cm;display:grid;place-items:center;background:var(--tile);border:.2cm solid var(--tile-line)"><div class="num" style="font-size:5.4cm;font-weight:600;line-height:1"><span class="g">۵۰+</span></div></div><figcaption style="font-size:1.9cm;margin-top:.5cm;white-space:nowrap">سازمان دیگر</figcaption></figure>`);
  [[3, 0, 2], [2, 2, 5], [1, 5, 8], [0, 8, 10]].forEach(([p, a, b]) => {
    const n = b - a, w = n * 19 + (n - 1) * 2.5;
    B(mid(p) - w / 2, 126.5, w, 0, cells.slice(a, b).join(""), "logos", "gap:2.5cm;justify-content:flex-start");
  });
}

/* ═══════════════════ ROLL-UPS · 95 × 210 (85 × 200 trim, 5 cm bleed) ═══════════════════ */
function rollup(k) {
  // roll-up 1 stands at the right of the booth and roll-up 2 at the left; on the detailed pair a silk band runs down the
  // outer edge (art.js), so the content keeps 2 cm more from that edge
  if (STYLE === "minimal") {
    logo(30.5, 12, 34);
    name(10, 42.5, 75, 3.3);
    B(10, 56, 75, 0, lines(COPY.slogan3), "hl slogan", "font-size:8cm;line-height:1.36;text-align:center");
    B(10, 98.5, 75, 0, `<span class="rule r"></span><span>${k === 1 ? "سامانه‌ها و هوش مصنوعی" : "آموزش، مشاوره و استقرار"}</span><span class="rule"></span>`, "kicker", "font-size:2.4cm");
    svcList(10, 105, 75, k === 1 ? ["epm", "agents", "custom", "data"] : ["academy", "consult", "migration"], 3);
    url(10, k === 1 ? 145 : 136, 75, 3, "center");
    return;
  }
  const X = k === 1 ? 10 : 12, W = 73, C = X + W / 2;
  logo(C - 12, 10, 24);
  name(X, 31, W, 2.6);
  kicker(X, 39, W, k === 1 ? "۰۱" : "۰۲", k === 1 ? "خدمات پارس · سامانه‌ها و هوش مصنوعی" : "خدمات پارس · آموزش، مشاوره و استقرار", 2.4);
  const demo = (y) => {
    rule(X, y, W);
    qr(X, y + 3, 17);
    contact(X + 20, y + 3.4, W - 20, 2.4, { title: "دموی زنده را از ما بخواهید", align: "flex-start" });
  };
  if (k === 1) {
    B(X, 44, W - 1, 0, lines(["سامانه‌های مدیریت پروژه،", 'حالا با <span class="g">ایجنت‌های هوش مصنوعی</span>.']), "hl head fit", "font-size:4.9cm;line-height:1.45;text-align:right");
    services(X, 62, W, ["agents", "epm", "custom", "data"], 3.15, 2);
    demo(129.5);
    B(X, 159, W, 0, `<div class="aibar"><div class="cap" style="font-size:3.1cm;font-weight:600;line-height:1.5">تا ۹۰٪ کارهای تکراری، خودکار با ایجنت‌ها</div>
      <div class="bar" style="display:flex;gap:.6cm;margin-top:1.3cm;height:2.8cm"><span class="seg ai" style="flex:9;border-radius:1.4cm"></span><span class="seg hu" style="flex:1;border-radius:1.4cm"></span></div>
      <div style="display:flex;justify-content:space-between;font-size:2.3cm;color:var(--muted);margin-top:.8cm"><span>ایجنت‌های پارس</span><span>تأیید انسانی</span></div></div>`, "", "");
  } else {
    B(X, 44, W - 1, 0, lines(["از آموزش تا استقرار،", '<span class="g">کنار تیم شما</span>.']), "hl head fit", "font-size:5.6cm;line-height:1.45;text-align:right");
    services(X, 64, W, ["academy", "consult", "migration"], 3, 1.5);
    demo(115.5);
    kicker(X, 141, W, "", "مسیر همکاری", 2.4);
    B(X, 146.5, W, 0, PATH.map((t, i) => `<div class="st"><span class="dot" style="width:7cm;height:7cm;font-size:3cm;border-width:.16cm;font-weight:600">${["۱", "۲", "۳", "۴", "۵"][i]}</span><b style="font-size:2.2cm;margin-top:.8cm;line-height:1.4;font-weight:500">${t}</b></div>`).join(""), "flow path", "");
    [0, 2].forEach((si, i) => stat(i ? X : X + W / 2, 167, W / 2, STATS[si], 7, "center", 2.1));
  }
}

/* ═══════════════════ COUNTER · 214 × 90 (72 | 70 | 72) ═══════════════════ */
function counter() {
  if (STYLE === "minimal") {
    logo(89, 6.5, 36);
    name(74, 38, 66, 3.1);
    B(74, 46, 66, 0, lines(COPY.slogan2), "hl slogan", "font-size:5cm;line-height:1.45;text-align:center");
    url(74, 63.5, 66, 2.7, "center");
    for (const x of [26, 168]) mark(x, 24, 20);
    return;
  }
  logo(93, 5, 28);
  name(74, 29.5, 66, 2.8);
  B(74, 37.5, 66, 0, lines(COPY.slogan2), "hl slogan", "font-size:4cm;line-height:1.45;text-align:center");
  B(74, 52.5, 66, 0, "سامانه‌های مدیریت پروژه،<br>حالا با ایجنت‌های هوش مصنوعی.", "muted", "font-size:2.6cm;line-height:1.55;text-align:center");
  url(74, 64, 66, 2.6, "center");
  // left side: what we do
  kicker(6, 7.5, 60, "", "خدمات پارس", 2.4);
  services(6, 13, 60, ["epm", "agents", "custom", "training"], 2.4, 1);
  // right side: the live demo
  B(148, 7.5, 60, 0, "دموی زنده را<br>همین‌جا از ما بخواهید.", "hl", "font-size:3.9cm;line-height:1.45;text-align:right");
  qr(148, 25, 29);
  B(148, 56.5, 29, 0, "دموها، سوابق<br>و دستیار هوشمند پارس", "muted", "font-size:1.9cm;line-height:1.5;text-align:center;font-weight:500");
  contact(180.5, 27, 28, 2.2, { mail: true, align: "flex-start" });
}

/* ═══════════════════ TEST STRIP · 60 × 45 ═══════════════════
   Printed first on the real material: the brand colours, the finest threads, the smallest text and the smallest QR. */
const CHIPS = DARK
  ? [["#1c1d58", "زمینه، بالا"], ["#141547", "زمینه، میانه"], ["#0c0d33", "زمینه، پایین"], ["#20215d", "دایره‌ها"], ["#8f86ff", "بنفش برند"], ["#b8b1ff", "بنفش متن"],
     ["#df1173", "سرخابی برند"], ["#ff4fa3", "سرخابی متن"], ["#7b235a", "آلویی"], ["#c2479f", "ارغوانی"], ["#d6d3ef", "متن کم‌رنگ"], ["#ffffff", "سفید"]]
  : [["#ffffff", "زمینه، بالا"], ["#f7f5fc", "زمینه، میانه"], ["#efebf8", "زمینه، پایین"], ["#1a183a", "متن"], ["#46436a", "متن کم‌رنگ"], ["#5b52d6", "بنفش متن"],
     ["#8f86ff", "بنفش برند"], ["#df1173", "سرخابی برند"], ["#ff4fa3", "سرخابی روشن"], ["#7b235a", "آلویی"], ["#a1308a", "ارغوانی"], ["#c2479f", "ارغوانی روشن"]];
function swatch() {
  logo(3, 2.5, 9);
  B(15, 2.8, 42, 0, `نوار تست رنگ و جزئیات · غرفه‌ی پارس · ${DARK ? "حالت تیره" : "حالت روشن"}`, "hl", "font-size:1.5cm;text-align:right;white-space:nowrap");
  B(15, 6.2, 42, 0, "پیش از چاپ اصلی، این برگه را روی همان جنس، با همان دستگاه و پروفایل چاپ کنید.", "muted", "font-size:.8cm;text-align:right");
  qr(3, 13, 11);
  B(2, 24.6, 13, 0, "این QR از همه‌ی QRهای غرفه کوچک‌تر است؛<br>اگر از یک متری اسکن شد،<br>بقیه هم اسکن می‌شوند.", "muted", "font-size:.55cm;line-height:1.5;text-align:center");
  const cells = CHIPS.map(([c, n]) => `<figure style="width:5.8cm;display:flex;flex-direction:column;align-items:center"><span style="display:block;width:5.8cm;height:5.8cm;border-radius:.5cm;background:${c};border:.05cm solid var(--card-line)"></span><figcaption style="font-size:.6cm;margin-top:.35cm;color:var(--muted);text-align:center;line-height:1.35">${n}<br><span class="latin ltr" style="font-size:.55cm">${c.toUpperCase()}</span></figcaption></figure>`);
  B(17.7, 12.5, 39.3, 0, cells.join(""), "", "display:grid;grid-template-columns:repeat(6, 5.8cm);column-gap:.9cm;row-gap:.7cm");
  // the two gradients, labelled
  B(17.7, 34.2, 30, 1.4, "", "", `border-radius:.7cm;background:linear-gradient(270deg, ${DARK ? "#b8b1ff, #e06bc0, #ff4fa3" : "#5b52d6, #a1308a, #df1173"})`);
  B(17.7, 36.4, 30, 1.4, "", "aibar", "border-radius:.7cm;display:flex").innerHTML = `<span class="seg ai" style="flex:1;border-radius:.7cm"></span>`;
  B(48.5, 34.2, 8.5, 0, "واژه‌های رنگی<br><br>نوار ۹۰٪ ایجنت‌ها", "muted", "font-size:.55cm;line-height:2.03;text-align:right");
  B(3, 31.5, 13.5, 0, `<div style="font-size:1.7cm;font-weight:500;line-height:1.5">خدمات پارس</div><div style="font-size:.9cm;line-height:1.6">۱٫۷ و ۰٫۹ سانتی‌متر</div>`, "", "text-align:right");
  // the faintest tints of the boards: the dot grid (art.js) and a card with its border
  B(3, 37, 6.2, 4.6, "", "tintslot");
  B(10.3, 37, 6.2, 4.6, "", "", "border-radius:.5cm;background:var(--card);border:.05cm solid var(--card-line)");
  [[3, "نقطه‌های زمینه"], [10.3, "کارت و قاب"]].forEach(([x, t]) => B(x, 42.1, 6.2, 0, t, "muted", "font-size:.5cm;text-align:center"));
  // four ribbon samples (art.js) from the finest to the widest thread on the boards, at the boards' opacity
  ["۰٫۷ تا ۰٫۹", "۰٫۹ تا ۱٫۲", "۱٫۴ تا ۱٫۸", "۲ تا ۲٫۶"].forEach((t, i) => B(17.7 + i * 10.1, 39.4, 9.2, 4.6, `<span class="muted" style="font-size:.55cm;position:absolute;bottom:0;left:0;right:0;text-align:center">خط ${t} میلی‌متر</span>`, "ribslot"));
}

({ popup, rollup1: () => rollup(1), rollup2: () => rollup(2), counter, swatch })[ITEM]();
