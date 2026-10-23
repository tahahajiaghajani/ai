/* assemble the master timeline; chapters are quantized to whole bars of the music (120 BPM → 2 s) */
(function build() {
  const BAR = 2;
  const tl = gsap.timeline({ paused: true });
  const chapters = [];
  const cues = [];
  let t = 0;
  const add = (scene, name, opt = {}) => {
    const start = t;
    tl.add(scene, start);
    for (const c of scene.cues ?? []) cues.push({ t: +(start + c.t).toFixed(3), kind: c.kind });
    // the next chapter starts on the bar line nearest to this one's fade-out (scenes crossfade by up to a second)
    const end = start + scene.duration();
    t = Math.ceil((end - 0.45) / BAR) * BAR; // only the outgoing scene's last fade may overlap the next chapter
    chapters.push({ name, start, end: t, hidden: !!opt.hidden, kind: opt.kind ?? "product" });
  };
  add(sceneIntro(), "", { hidden: true, kind: "intro" });
  add(sceneStats([{ value: 15, suf: "+", label: "سال تجربه،<br>از ۱۳۸۹" }, { value: 20, label: "بانک و سازمان<br>کاربر سامانه‌های پارس" }, { value: 60, suf: "+", label: "سازمان در آموزش،<br>مشاوره و نرم‌افزار" }, { pre: "تا", value: 90, suf: "٪", label: "خودکارسازی کارهای تکراری،<br>با تأیید انسانی" }], { kicker: "مدیریت پروژه پارس", title: "بیش از پانزده سال کنار پروژه‌های بزرگ" }), "پارس در یک نگاه", { kind: "stats" });
  add(sceneOverview({ kicker: "سامانه‌های جامع مدیریتی", title: "سیزده سامانه، یک بستر", lead: "از پروژه و وظایف تا استراتژی، ارزیابی و داشبورد", items: DATA.hub }), "سامانه‌های پارس", { kind: "overview" });
  const P = Object.fromEntries(DATA.products.map((p, i) => [p.key, [p, i + 1]]));
  const short = { pm: "مدیریت پروژه", bsc: "کارت امتیازی متوازن", okr: "اهداف و نتایج کلیدی", 360: "ارزیابی ۳۶۰ درجه", fs: "امکان‌سنجی پروژه‌ها", assess: "ارزیابی عملکرد سازمانی", dash: "داشبوردهای مدیریتی" };
  const product = (key, kind) => add(sceneProduct(...P[key]), short[key], { kind });
  product("pm", "product");
  add(sceneCopilot(DATA.copilot), "دستیار هوشمند پروژه", { kind: "ai" });
  product("bsc", "product2");
  product("okr", "product");
  product("360", "product2");
  product("fs", "product");
  product("assess", "product2");
  product("dash", "product");
  add(sceneAgents({ kicker: "ایجنت‌های هوش مصنوعی پارس", title: "در نسخه‌ی عملیاتی، همه‌ی سامانه‌های پارس هوشمندند.",
    inputs: [{ icon: "report", label: "نامه‌ها<br>و مستندات" }, { icon: "data", label: "داده‌های<br>سامانه‌ها" }, { icon: "epm", label: "گزارش‌ها<br>و صورت‌جلسه‌ها" }, { icon: "mail", label: "ایمیل‌ها<br>و درخواست‌ها" }],
    stages: ["خواندن", "فهمیدن", "پیش‌بینی", "اقدام"],
    outputs: [{ icon: "report", label: "گزارش مدیریتی<br>خودکار" }, { icon: "predict", label: "هشدار<br>ریسک و تأخیر" }, { icon: "execute", label: "اقدام در سامانه،<br>با تأیید انسانی" }, { icon: "rag", label: "پاسخ مستند<br>به فارسی" }] }), "ایجنت‌های هوش مصنوعی", { kind: "agents" });
  add(sceneCapabilities({ kicker: "توانمندی‌های پارس", title: "آموزش، مشاوره<br>و نرم‌افزار،<br>حالا با <span class=\"g\">هوش مصنوعی</span>.",
    items: [{ icon: "epm", label: "سامانه‌های<br>EPM و EPPM" }, { icon: "migration", label: "نوسازی و مهاجرت EPM" }, { icon: "agents", label: "ایجنت‌ها<br>و دستیارهای هوشمند", ai: 1 }, { icon: "custom", label: "سامانه‌های<br>مدیریتی سازمانی" }, { icon: "pattern", label: "مهندسی و تحلیل داده" }, { icon: "training", label: "آموزش و مشاوره" }] }), "توانمندی‌های پارس", { kind: "capabilities" });
  add(sceneClients({ kicker: "مشتریان ما", title: "از ستاد بانک‌ها تا شبکه‌ی برق کشور",
    logos: [{ file: "mellat.svg", name: "بانک ملت" }, { file: "tejarat.svg", name: "بانک تجارت" }, { file: "melli.svg", name: "بانک ملی ایران" }, { file: "refah.svg", name: "بانک رفاه کارگران" }, { file: "sepah.svg", name: "بانک سپه" }, { file: "postbank.svg", name: "پست بانک ایران" }, { file: "ayandeh.svg", name: "بانک آینده" }, { file: "igmc.webp", name: "مدیریت شبکه برق ایران" }, { file: "rajaee.webp", name: "قرارگاه خاتم‌الانبیاء<br>گروه تخصصی شهید رجائی" }],
    more: '<span class="g">۵۰+</span> سازمان دیگر در آموزش، مشاوره و نرم‌افزار' }), "مشتریان پارس", { kind: "clients" });
  // the printed address and the QR come from one source (TEASER_URL in build.mjs)
  add(sceneOutro({ qr: window.QR_SVG || "", url: (window.QR_URL || "https://" + DATA.url).replace(/^https?:\/\//, "") }), "", { hidden: true, kind: "outro" });

  // a light sweeps across at every chapter change (the music has a whoosh there)
  const sw = document.getElementById("sweep");
  chapters.slice(1).forEach((c) => {
    tl.fromTo(sw, { x: 2100, opacity: 1 }, { x: -1100, duration: 0.9, ease: "power2.inOut", immediateRender: false }, c.start - 0.45);
    tl.set(sw, { opacity: 0 }, c.start + 0.46);
    cues.push({ t: c.start, kind: "chapter" });
  });
  gsap.set(sw, { opacity: 0 });
  Chapters.list = chapters;
  MASTER = tl;
  const duration = chapters[chapters.length - 1].end;
  window.TEASER = { duration, chapters, cues, render: renderFrame, ready: Promise.all(Pending) };
})();
