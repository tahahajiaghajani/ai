/* The teaser's content: products, screens, callout regions (% of each screenshot, x from the left) and copy.
   Screenshots come from the demo archive (not in the repository); regions were measured on them. */
const S = (name, w, h, extra = {}) => ({ src: `screens/${name}.png`, w, h, ...extra });

const DATA = {
  // how to reach Pars, as on the booth; the site's address comes from build.mjs (TEASER_URL)
  contact: { mail: "info@parspmi.ir", phones: ["۸۸۷۳۱۶۰۱", "۸۲۸۰۳۵۶۵"] },
  products: [
    {
      key: "pm", acronym: "PM", name: "سامانه‌ی مدیریت پروژه", hook: "از منشور پروژه تا تأیید نهایی، یک‌جا.", url: "project.parspmi.ir",
      glow: [0.15, 0.3, 0.85, 0.8],
      shots: [
        { type: "wall", caption: "آبشاری، چابک و اقدام؛ در یک سبد.", cards: [
          { ...S("project-0", 1900, 3208), hero: { x: 0, y: 0, w: 100, h: 33.32 } },
          { ...S("project-2", 1900, 3385), hero: { x: 1.79, y: 4.05, w: 98.21, h: 31.02 } },
          { ...S("project-5", 1900, 1939), hero: { x: 0, y: 0, w: 100, h: 55.13 } },
          { ...S("project-1", 1900, 6820), hero: { x: 0, y: 0, w: 100, h: 15.67 } },
        ] },
        { type: "demo", pages: [
          { screen: S("project-0", 1900, 3208), next: { x: 93.2, y: 9.1 }, callouts: [
            { x: 3.37, y: 7.73, w: 77.58, h: 4.3, label: "سبد پروژه‌ها، یک‌جا", text: "تعداد پروژه‌ها، اقدام‌ها و کارهای در جریان، بی‌درنگ پیش چشم مدیر." },
            { x: 29.58, y: 12.87, w: 25.11, h: 13.47, label: "بار کاری هر واحد", text: "ببینید کدام واحد بیشترین پروژه را دارد و منابع را متوازن کنید.", side: "left", camRegion: { x: 28.2, y: 11.45, w: 54.2, h: 17.8 }, camOpt: { fill: 1, zmax: 1.9 }, push: 1 },
            { x: 9.58, y: 29.21, w: 24.32, h: 23.47, label: "برنامه در برابر واقعیت", text: "پیشرفت برنامه‌ای و واقعی هر پروژه، کنار درصد عملکرد و نشانگر افت.", zmax: 1.3, pan: 1.8 },
          ] },
          // the charter: the camera settles on its ten tabs (the whole form, below the app header and left of the menu), then the infographic lists them legibly
          { screen: S("project-5", 1900, 1939), rest: { x: 1.6, y: 6, w: 82.5, h: 44.6 }, restOpt: { zmax: 1.7, fill: 1 } },
        ] },
        { type: "sections", kicker: "پرونده‌ی پروژه", title: "ده زبانه، یک پرونده‌ی کامل",
          items: ["منشور پروژه", "برنامه‌ی زمان‌بندی", "تیم پروژه", "ریسک‌ها", "ذی‌نفعان", "وضعیت پروژه", "دلایل تأخیر", "اسناد پروژه", "اقدام‌های مرتبط", "اسپرینت"] },
        { type: "demo", tilt: 10, pages: [
          { screen: S("project-1", 1900, 6820), callouts: [
            { x: 3.47, y: 4.69, w: 77.37, h: 3.99, label: "گزارش آخرین وضعیت", text: "گزارش پیشرفت تیم، پیش از ثبت نهایی، به تأیید مدیر می‌رسد." },
            { x: 6.32, y: 6.42, w: 9.79, h: 2.05, label: "تأیید یا رد با یک کلیک", text: "هر مورد همان‌جا تأیید یا رد می‌شود و سابقه‌اش می‌ماند.", zmax: 1.7, dy: 36 },
          ] },
        ] },
      ],
    },
    {
      key: "bsc", acronym: "BSC", name: "سامانه‌ی کارت امتیازی متوازن", hook: "استراتژی سازمان، روی یک نقشه و با عدد دقیق.", url: "bsc.parspmi.ir",
      glow: [0.82, 0.22, 0.18, 0.85],
      aiTitle: "هوش مصنوعی در هسته‌ی کارت امتیازی",
      ai: [
        { icon: "predict", title: "هشدار زودهنگام افت شاخص", line: "پیش از پایان دوره، نه بعد از آن" },
        { icon: "pattern", title: "کشف روابط علّی از داده", line: "کدام شاخص واقعاً اثر می‌گذارد؟" },
        { icon: "shield", title: "پیش‌بررسی صحه‌گذاری", line: "خلاصه‌ی مستندات، برای تأیید انسانی" },
        { icon: "rag", title: "پرسش فارسی از استراتژی", line: "پاسخ مستند، با ارجاع به داده" },
      ],
      shots: [
        { type: "demo", tilt: 10, pages: [
          { screen: S("bsc-0", 1900, 3539), callouts: [
            { x: 11.63, y: 6.87, w: 77.79, h: 21.53, label: "نقشه‌ی استراتژی", text: "اهداف هر منظر، با درصد تحقق و رنگ وضعیت، کنار هم.", zmax: 1.2, fill: 0.9 },
            { x: 28.95, y: 62.16, w: 37.37, h: 13.28, label: "روابط علت و معلولی", text: "ببینید یادگیری و رشد چگونه به فرایندها، مشتری و نتیجه‌ی مالی می‌رسد.", pan: 2.8 },
          ] },
        ] },
        { type: "bars", kicker: "توازن چهار منظر", title: "کل استراتژی،<br>روی یک صفحه",
          total: { value: 79, suf: "٪", label: "تحقق کل استراتژی؛ ۱۲ هدف و ۲۴ شاخص." },
          items: [
            { label: "مالی", value: 88.8, dec: 1, suf: "٪" },
            { label: "مشتری", value: 87.6, dec: 1, suf: "٪" },
            { label: "فرایندهای داخلی", value: 68.6, dec: 1, suf: "٪", warn: 1 },
            { label: "یادگیری و رشد", value: 70.9, dec: 1, suf: "٪", warn: 1 },
          ] },
        { type: "demo", ai: 1, pages: [
          { screen: S("bsc-4", 1900, 3215), aiSpots: [{ x: 20, y: 29 }, { x: 50, y: 35 }, { x: 59, y: 17.5 }], callouts: [
            { x: 52.1, y: 27.4, w: 37.5, h: 2.9, label: "صحه‌گذاری هر عدد", text: "عدد مصوب قبلی و عدد پیشنهادی، کنار هم و با میزان تغییر.", zmax: 1.9 },
            { x: 11.3, y: 34.55, w: 18.5, h: 1.2, label: "تأیید با مسئولیت انسانی", text: "هیچ عددی بدون تأیید مسئول وارد کارت امتیازی نمی‌شود.", zmax: 2 },
          ] },
        ] },
      ],
    },
    {
      key: "okr", acronym: "OKR", aiHold: 10, name: "سامانه‌ی اهداف و نتایج کلیدی", hook: "پیشرفت اهداف سازمان را فصل‌به‌فصل ببینید.", url: "okr.parspmi.ir",
      glow: [0.2, 0.8, 0.8, 0.2],
      aiTitle: "هوش مصنوعی در هسته‌ی OKR",
      ai: [
        { icon: "predict", title: "پیش‌بینی تحقق اهداف", line: "هشدار، پیش از عقب ماندن فصل" },
        { icon: "target", title: "پیشنهاد نتایج کلیدی", line: "سنجش‌پذیر، با تأیید شما" },
        { icon: "pattern", title: "همسویی هوشمند اهداف", line: "ناهمسویی واحدها آشکار می‌شود" },
        { icon: "report", title: "گزارش فصلی خودکار", line: "پیشرفت و دلایل عقب ماندن از هدف" },
      ],
      shots: [
        { type: "demo", ai: 1, pages: [
          // framed so the page title (which the screenshot clips at the top) never shows
          { screen: S("okr-0", 1920, 911), start: { x: 1.98, y: 6.15, w: 79.17, h: 93.85 }, startOpt: { fill: 1, zmax: 1.3 }, rest: { x: 1.98, y: 6.15, w: 79.17, h: 93.85 }, restOpt: { fill: 1, zmax: 1.3 },
            aiCam: { x: 1.98, y: 6.15, w: 79.17, h: 93.85 }, aiCamOpt: { fill: 1, zmax: 1.3 }, aiSpots: [{ x: 62, y: 42 }, { x: 76, y: 80 }, { x: 10, y: 45 }], callouts: [
            { x: 13.44, y: 66.96, w: 56.25, h: 27.88, label: "پیشرفت فصل‌به‌فصل", text: "سهم هر فصل را مقایسه کنید و فصل عقب‌مانده را پیدا کنید." },
            { x: 84.5, y: 14, w: 14, h: 69, label: "از تعریف هدف تا تأیید", text: "اهداف سازمان و واحدها، وظایف و تأییدها؛ همه از یک منو.", camRegion: { x: 25, y: 10, w: 75, h: 88 }, camOpt: { fill: 1, zmax: 1.3 }, push: 1 },
          ] },
        ] },
      ],
    },
    {
      key: "360", acronym: "360°", name: "سامانه‌ی ارزیابی ۳۶۰ درجه", hook: "بازخورد از چهار زاویه؛ تصمیم روشن‌تر.", url: "360.parspmi.ir",
      glow: [0.8, 0.75, 0.2, 0.25],
      aiTitle: "هوش مصنوعی در ارزیابی ۳۶۰ درجه",
      ai: [
        { icon: "rag", title: "خلاصه‌ی هوشمند نظرات", line: "نقاط قوت و زمینه‌های رشد" },
        { icon: "training", title: "برنامه‌ی توسعه‌ی فردی", line: "پیش‌نویس هوشمند، تأیید با مدیر" },
        { icon: "predict", title: "هشدار زودهنگام افت عملکرد", line: "پیش از رسیدن به رده‌ی خطر" },
        { icon: "search", title: "پرسش فارسی، پاسخ مستند", line: "«چه کسی آماده‌ی ارتقاست؟»" },
      ],
      shots: [
        { type: "orbit", kicker: "ارزیابی ۳۶۰ درجه", title: "یک نفر،<br>چهار زاویه‌ی دید", lead: 'بازخورد خود فرد، مدیر، همکاران و زیردستان، در <span>شش بُعد</span> شایستگی.',
          items: [{ icon: "human", label: "خود فرد" }, { icon: "shield", label: "مدیر مستقیم" }, { icon: "users", label: "همکاران" }, { icon: "users", label: "زیردستان" }] },
        { type: "demo", ai: 1, pages: [
          // the AI panel's subtitle named a third-party model: retyped without it
          { screen: S("360-0", 1913, 1825, { patches: [{ x: 1290, y: 364, w: 356, h: 21, html: '<div style="font:400 14px/21px Plex, sans-serif;color:#69707c;direction:rtl;text-align:right;background:#f8f9fc;height:100%;padding-inline-start:6px">تحلیل روندهای سازمان با هوش مصنوعی بر روی نتایج ۳۶۰ درجه</div>' }] }), next: { x: 52.5, y: 2.3 }, callouts: [
            { x: 10.35, y: 28.27, w: 79.67, h: 37.37, label: "ماتریس نُه‌خانه‌ای استعداد", text: "جایگاه هر کارمند، بر پایه‌ی عملکرد واقعی و پتانسیل رشد.", zmax: 1.2, fill: 0.9 },
          ] },
          { screen: S("360-2", 1913, 1715, { patches: [{ x: 1100, y: 296, w: 468, h: 26, html: '<div style="font:400 16px/26px Plex, sans-serif;color:#64748b;direction:rtl;text-align:right;background:#fff;height:100%;padding-inline-start:4px">شروع همکاری: ۱۴۰۱/۰۳/۱۵</div>' }] }), next: { x: 44, y: 2.4 }, callouts: [
            { x: 50.86, y: 30.03, w: 39.15, h: 49.97, label: "رادار شایستگی", text: "شش شایستگی و چهار دیدگاه، روی یک نمودار.", zmax: 1.3 },
            { x: 10.35, y: 32.71, w: 39.15, h: 9.74, label: "شکاف دیدگاه‌ها", text: "فاصله‌ی خودارزیابی با نگاه دیگران؛ نقطه‌ی شروع گفت‌وگوی توسعه.", zmax: 1.5 },
          ] },
          { screen: S("360-3", 1913, 1539), aiSpots: [{ x: 35, y: 11 }, { x: 62, y: 29 }, { x: 22, y: 29 }], callouts: [
            { x: 12.6, y: 66.3, w: 19.8, h: 6.5, label: "فاصله‌ی امتیاز دو نفر", text: "امتیاز دو نفر در هر شایستگی، دقیق و کنار هم.", big: { value: 0.85, dec: 2, pre: "+" }, zmax: 2 },
          ] },
        ] },
      ],
    },
    {
      key: "fs", acronym: "FS", name: "سامانه‌ی امکان‌سنجی پروژه‌ها", hook: "پیش از سرمایه‌گذاری، توجیه طرح را بسنجید.", url: "fs.parspmi.ir",
      glow: [0.15, 0.2, 0.85, 0.85],
      aiTitle: "هوش مصنوعی در امکان‌سنجی طرح‌ها",
      ai: [
        { icon: "predict", title: "پیش‌بینی ریسک طرح", line: "اثر قیمت، هزینه و تأخیر بر NPV" },
        { icon: "report", title: "پیش‌نویس خودکار گزارش", line: "بازبینی و تأیید با کارشناس" },
        { icon: "data", title: "استخراج داده از اسناد", line: "از پیش‌فاکتور و قرارداد تا ورودی طرح" },
        { icon: "pattern", title: "شناسایی فرض‌های غیرواقعی", line: "با مقایسه‌ی طرح‌های مشابه گذشته" },
      ],
      shots: [
        { type: "steps", kicker: "امکان‌سنجی بر پایه‌ی استاندارد UNIDO", title: "یازده گام، از فرض تا تصمیم",
          items: ["فرضیات کلی و تقویم", "سرمایه‌گذاری ثابت", "سرمایه در گردش", "تولید و فروش", "هزینه‌های بهره‌برداری", "تأمین مالی و وام‌ها", "صورت‌های مالی", "شاخص‌های اقتصادی", "نقطه‌ی سربه‌سر", "تحلیل حساسیت", "گزارش جامع"] },
        { type: "demo", ai: 1, tilt: 10, pages: [
          { screen: S("fs-1", 1913, 1379), next: false, callouts: [
            { x: 15.68, y: 44.96, w: 14.9, h: 39.74, label: "عمر مفید و ارزش اسقاط", text: "استهلاک هر دارایی، به روش خط مستقیم، خودکار محاسبه می‌شود.", zmax: 1.4, pan: 1.6 },
          ] },
          { screen: S("fs-2", 1913, 2030, { patches: [{ x: 262, y: 477, w: 243, h: 22, html: '<div style="font:400 15px/22px Plex, sans-serif;color:#374151;direction:rtl;text-align:right;background:#f8fafc;height:100%;padding-inline-start:2px">شرکت نمونه</div>' }] }), aiCam: { x: 12.75, y: 21.48, w: 74.8, h: 39.66 }, aiSpots: [{ x: 42, y: 26 }, { x: 22, y: 34 }, { x: 30, y: 41.5 }], callouts: [
            { x: 10.45, y: 14.48, w: 79.46, h: 4.38, label: "گزارش رسمی، آماده‌ی چاپ", text: "برای بانک، صندوق توسعه‌ی ملی و هیئت‌مدیره؛ چاپ یا PDF." },
            { x: 13.07, y: 32.51, w: 74.23, h: 6.75, label: "حکم روشن، با دلیل عددی", text: "پیش از تعهد سرمایه، نه بعد از آن.", pan: 1.6 },
            { x: 12.96, y: 40.99, w: 74.65, h: 18.42, label: "شاخص‌های کلیدی اقتصادی", text: "NPV، IRR، دوره‌ی بازگشت و نقطه‌ی سربه‌سر، در برابر معیار پذیرش.", zmax: 1.2 },
          ] },
        ] },
      ],
    },
    {
      key: "assess", acronym: "", glyph: "gauge", name: "سامانه‌ی ارزیابی عملکرد سازمانی", hook: "عملکرد هر واحد، در یک عدد روشن.", url: "assess.parspmi.ir",
      glow: [0.8, 0.2, 0.2, 0.8],
      aiTitle: "هوش مصنوعی در ارزیابی عملکرد",
      ai: [
        { icon: "predict", title: "هشدار زودهنگام شاخص‌ها", line: "پیش از پایان دوره‌ی ارزیابی" },
        { icon: "report", title: "گزارش ارزیابی خودکار", line: "برای هر معاونت، با تأیید مدیر" },
        { icon: "data", title: "جمع‌آوری خودکار داده", line: "از گزارش‌ها و سامانه‌ها" },
        { icon: "target", title: "پیشنهاد هدف واقع‌بینانه", line: "بر پایه‌ی سوابق؛ تصمیم با شما" },
      ],
      shots: [
        { type: "demo", ai: 1, pages: [
          // framed below the app header and without the dashboard's empty «مقایسه عملکرد» card (its chart never rendered in the capture)
          { screen: S("assess-0", 1920, 911), start: { x: 33.3, y: 11.2, w: 66.7, h: 78 }, startOpt: { fill: 1, zmax: 1.6 }, rest: { x: 33.3, y: 11.2, w: 66.7, h: 78 }, restOpt: { fill: 1, zmax: 1.6 }, next: { x: 91.7, y: 32.7 }, callouts: [
            { x: 34.6, y: 32.6, w: 30.4, h: 35.35, label: "امتیاز کل سازمان", text: "امتیاز کل، کنار امتیاز معاونت‌ها و ادارات کل.", big: { value: 83.9, dec: 1 }, camRegion: { x: 33.4, y: 23.5, w: 48, h: 56.3 }, camOpt: { fill: 1, zmax: 2.1 }, push: 1 },
          ] },
          // the indicators page opens, and the AI layer ends, on the whole page left of the menu, header included
          { screen: S("assess-1", 1920, 911), start: { x: 1.5, y: 0, w: 81, h: 94.8 }, startOpt: { fill: 1, zmax: 1.3 }, aiCam: { x: 1.5, y: 0, w: 81, h: 94.8 }, aiCamOpt: { fill: 1, zmax: 1.3 }, aiSpots: [{ x: 30, y: 40.5 }, { x: 15, y: 60 }, { x: 45, y: 80 }], callouts: [
            { x: 23, y: 44, w: 7.5, h: 31, label: "رنگ‌بندی درصد تحقق", text: "شاخص‌های عقب‌مانده، با رنگ قرمز و زرد، پیش از جلسه دیده می‌شوند.", zmax: 1.65, hug: 1 },
            { x: 59.64, y: 34, w: 21.61, h: 41, label: "ساختار سلسله‌مراتبی", text: "هر شاخص زیر معاونت و اداره‌ی کل مسئول؛ پاسخ‌گویی روشن است.", zmax: 1.4, hug: 30 },
          ] },
        ] },
      ],
    },
    {
      key: "dash", acronym: "", glyph: "grid", name: "داشبوردهای مدیریتی", hook: "از ریشه‌ی تأخیرها تا تصویر کل سبد.", url: "delays.parspmi.ir",
      glow: [0.25, 0.75, 0.75, 0.25],
      aiTitle: "هوش مصنوعی در داشبوردهای مدیریتی",
      ai: [
        { icon: "report", title: "خلاصه‌ی مدیریتی خودکار", line: "وضعیت سبد، در چند جمله" },
        { icon: "predict", title: "پیش‌بینی تأخیر پروژه‌ها", line: "از الگوی تأخیرهای گذشته" },
        { icon: "pattern", title: "یافتن ریشه‌ی تأخیرها", line: "الگوهای عامل، نوع و مدت" },
        { icon: "rag", title: "پرسش فارسی از داشبورد", line: "پاسخ مستند، همان لحظه" },
      ],
      shots: [
        { type: "demo", ai: 1, pages: [
          { screen: S("delays-0", 1920, 911, { bg: "#f1f5f9" }), start: { x: 0, y: 0, w: 100, h: 100 }, startOpt: { fill: 1, zmax: 1, zmin: 0.9, ay: 1 }, rest: { x: 0, y: 0, w: 100, h: 100 }, restOpt: { fill: 1, zmax: 1, zmin: 0.9, ay: 1 }, next: false, callouts: [
            { x: 1.3, y: 16.68, w: 97.4, h: 11.64, fill: 0.95, zmin: 0.9, label: "پنج شاخص کلیدی تأخیر", text: "تعداد، موارد بحرانی، مجموع روزها، عامل اصلی و نوع شایع تأخیر؛ در یک ردیف.", },
            { x: 28.49, y: 57.52, w: 9.43, h: 5.38, label: "نقطه‌ی داغ تأخیر", text: "ماتریس عامل و نوع تأخیر می‌گوید اصلاح را از کجا شروع کنید.", camRegion: { x: 26, y: 39, w: 52, h: 61 }, camOpt: { fill: 1, zmax: 2 } },
          ] },
          // short dashboards show whole, on their own margin colour (no cropped cards at the sides)
          { screen: S("dashboard-sample-0", 1900, 980, { url: "dashboard-sample.parspmi.ir", bg: "#f8fafc" }), start: { x: 0, y: 0, w: 100, h: 100 }, startOpt: { fill: 1, zmax: 1, zmin: 0.9 },
            aiCam: { x: 0, y: 0, w: 100, h: 100 }, aiCamOpt: { fill: 0.97, zmax: 1, zmin: 0.9 }, aiSpots: [{ x: 74, y: 5 }, { x: 25, y: 72 }, { x: 45.5, y: 30 }], callouts: [
            { x: 51.05, y: 12.24, w: 32.26, h: 32.65, label: "وضعیت پروژه‌ها", text: "چند پروژه خاتمه یافته، طبق برنامه پیش می‌رود یا تأخیر دارد.", zmax: 1.5, hug: 1 },
            // the whole section, slightly smaller than the window so the highlight closes on all four sides
            { x: 1.05, y: 46.94, w: 98.89, h: 51.02, fill: 0.95, zmin: 0.9, label: "وضعیت به تفکیک معاونت", text: "معاونت‌ها را مقایسه کنید و واحدهای دارای تأخیر را زودتر بیابید.", zmax: 1.1 },
          ] },
        ] },
      ],
    },
  ],
};

/* the AI copilot, live in the PM demo (screens from the second archive) */
DATA.copilot = {
  url: "project.parspmi.ir",
  kicker: "هوش مصنوعی پارس، در عمل",
  title: 'فقط گفت‌وگو نیست؛<br>کار را <span class="g">انجام می‌دهد</span>.',
  closing: 'و این، تنها یکی از کوچک‌ترین<br>توانایی‌های هوش مصنوعی <span class="g">پارس</span> است.',
  before: S("project-0", 1900, 3208),
  chip: { x: 7.8, y: 26.5 },
  panel: { x: 1.5625, y: 9.55, w: 26.04, h: 87.82 },
  steps: [
    { screen: S("copilot-8", 1920, 911), title: "به زبان خودتان بخواهید", line: "از تعریف پروژه و WBS تا ریسک و گزارش‌گیری، همه در یک گفت‌وگو.",
      chips: ["پروژه‌ی جدید", "اقدام جدید", "فعالیت و WBS", "تیم، ریسک و تأخیر"], dur: 5.2 },
    { screen: S("copilot-11", 1920, 911, { patches: [{ x: 76, y: 421, w: 432, h: 45, html: '<div style="font:400 14px/21px Plex, sans-serif;color:#1e293b;direction:rtl;text-align:right;background:#fff;height:100%;padding-inline-end:10px">گزارش کلی اقلام به تفکیک نوع شامل <b>۱۰</b> پروژه آبشاری، <b>۵</b> پروژه چابک و <b>۱۰</b> اقدام اجرایی است:</div>' }] }),
      title: "گزارش هوشمند، همان لحظه", line: "یک درخواست کوتاه؛ گزارش تفکیکی با نمودار، از داده‌های واقعی سامانه.", dur: 5 },
    { screen: S("copilot-12", 1920, 911), title: "از گزارش تا داشبورد", line: "فهرست پروژه‌ها، با پیوند مستقیم به داشبورد هر کدام.", dur: 4.4 },
    { screen: S("copilot-9", 1920, 911), title: "ثبت در WBS، با یک تأیید", line: "فعالیت تازه با مدت، وزن و مسئول پیشنهاد می‌شود و با یک تأیید به WBS پروژه افزوده می‌شود.", dur: 5.6 },
    { screen: S("copilot-10", 1920, 911), title: "تیم، ریسک، وضعیت و تأخیر", line: "اطلاعات پروژه از همان گفت‌وگو ثبت می‌شود؛ بی‌نیاز از فرم‌های جداگانه.",
      chips: ["اعضای تیم", "افزودن ریسک", "ثبت وضعیت", "علت تأخیر"], dur: 5.2 },
  ],
};

DATA.hub = [
  { code: "PM", icon: "epm", name: "مدیریت پروژه", line: "کنترل یکپارچه‌ی پروژه‌ها و اقدام‌ها" },
  { code: "TM", icon: "check", name: "مدیریت وظایف", line: "واگذاری و پیگیری وظایف" },
  { code: "MSB", icon: "calendar", name: "جلسات و مصوبات", line: "صورت‌جلسه‌ها و پیگیری مصوبات" },
  { code: "BSC", icon: "gauge", name: "کارت امتیازی متوازن", line: "پایش استراتژی سازمان" },
  { code: "OKR", icon: "target", name: "اهداف و نتایج کلیدی", line: "مدیریت اهداف سازمان" },
  { code: "FS", icon: "search", name: "امکان‌سنجی پروژه‌ها", line: "توجیه فنی و اقتصادی" },
  { code: "ROPM3", icon: "chart", name: "ارزیابی بلوغ", line: "بلوغ مدیریت پروژه‌ی سازمان" },
  { code: "360°", icon: "users", name: "ارزیابی ۳۶۰ درجه", line: "بازخورد شایستگی‌ها" },
  { code: "", icon: "human", name: "ارزیابی عملکرد", line: "ارزیابی منظم و شفاف" },
  { code: "", icon: "grid", name: "داشبوردهای مدیریتی", line: "چهار داشبورد تحلیلی" },
  { code: "", icon: "cap", name: "آزمون مدیریت پروژه", line: "آزمون‌های تخصصی" },
  { code: "PMBOK8", icon: "book", name: "اپ آموزش", line: "ویرایش هشتم استاندارد" },
  { code: "", icon: "building", name: "پورتال شرکت", line: "خدمات و ارتباطات سازمانی" },
];
