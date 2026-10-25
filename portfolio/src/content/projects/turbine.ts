import type { Project } from "@/content/types";

export const turbine: Project = {
  slug: "turbine-vision",
  tier: "flagship",
  featured: true,
  title: { fa: "پایش هوشمند سوراخ‌های خنک‌کاری توربین", en: "Turbine Cooling-Hole Inspection" },
  kicker: { fa: "بینایی ماشین صنعتی · پایان‌نامه", en: "Industrial computer vision · Thesis" },
  oneLiner: {
    fa: "هندسه‌ی کلاسیک جای هر سوراخ را پیدا می‌کند، Segment Anything مرزش را ترسیم می‌کند و آمار حکم «سالم» یا «معیوب» می‌دهد؛ در قالب نودهای سفارشی ComfyUI و بدون حتی یک تصویر آموزشی.",
    en: "Classical geometry finds every hole, Segment Anything traces its boundary, statistics call it pass or fail — packaged as custom ComfyUI nodes, without a single training image.",
  },
  year: "2026",
  period: { fa: "تیر ۱۴۰۵", en: "July 2026" },
  role: { fa: "طراحی سیستم، توسعه‌ی نودها، تحلیل و نگارش", en: "System design, node development, analysis & writing" },
  context: { fa: "پایان‌نامه‌ی مهندسی مکانیک · دانشگاه علم و صنعت ایران", en: "Mechanical Engineering thesis · Iran University of Science and Technology" },
  status: { fa: "نمونه‌ی کارکرده روی ویدئوهای نمونه", en: "Working prototype on sample inspection videos" },
  disciplines: ["vision", "industrial", "automation"],
  stack: ["Python", "PyTorch", "OpenCV", "Segment Anything (ViT-B)", "ComfyUI", "NumPy", "CUDA"],
  cover: { kind: "art", art: "vision", alt: { fa: "شبکه‌ی ۶×۶ سوراخ‌ها با کادرهای تشخیص", en: "A 6×6 grid of holes with detection boxes" } },
  challenge: {
    fa: "سوراخ‌های خنک‌کاری فین توربین برای انتقال حرارت و عمر قطعه حیاتی‌اند و وضعیتشان باید دقیق و مستند پایش شود. امروز این کار با چشم انجام می‌شود: خستگی بازرس، قضاوت‌های متفاوت و نبود سابقه‌ی دیجیتال.\n\nمدل‌های یادگیری عمیق سرتاسری مثل YOLO داده‌ی برچسب‌خورده‌ی زیادی می‌خواهند که برای قطعات کم‌تیراژ توربین وجود ندارد، جعبه‌سیاه‌اند و به نور کارخانه حساس. پردازش تصویر کلاسیک داده نمی‌خواهد اما با شکل‌های غیرایده‌آل می‌شکند. مسئله، پیدا کردن راه سوم بود.",
    en: "Cooling holes on turbine fins are critical for heat transfer and part life, and their condition has to be monitored precisely and on record. Today it is done by eye: inspector fatigue, inconsistent judgement, no digital trail.\n\nEnd-to-end detectors such as YOLO need large labelled datasets that low-volume turbine parts simply don't have; they are black boxes and sensitive to factory light. Classical image processing needs no data but breaks on non-ideal shapes. The problem was to find a third way.",
  },
  approach: {
    fa: "یک معماری هیبرید که کار را تقسیم می‌کند: **هندسه‌ی قابل ردیابی** می‌گوید هر سوراخ کجاست، **یک مدل پایه‌ی از پیش آموزش‌دیده** مرز دقیقش را می‌کشد، و **آمار** حکم می‌دهد.\n\nفریم‌ها از ویدئوی بازرسی نمونه‌برداری می‌شوند؛ نود هندسی با فیلتر گاوسی و تبدیل هاف مراکز سوراخ‌ها را می‌دهد؛ هر مرکز به‌عنوان نقطه‌ی ترغیبی به SAM (ViT-B) می‌رود و یک ماسک دقیق برمی‌گردد؛ واریانس شدت پیکسل‌ها درون هر ماسک با آستانه مقایسه می‌شود و برای هر سوراخ یک رکورد JSON ساخته می‌شود. بدون fine-tune، بدون دیتاست برچسب‌خورده، و هر تصمیم برای اپراتور قابل توضیح.",
    en: "A hybrid architecture that splits the work: **traceable geometry** decides where each hole is, **a pretrained foundation model** draws its exact boundary, and **statistics** give the verdict.\n\nFrames are sampled from the inspection video; a geometry node runs a Gaussian blur and a Hough circle transform to emit hole centres; each centre becomes a point prompt for SAM (ViT-B), which returns one precise mask; the pixel-intensity variance inside each mask is compared with a threshold and every hole gets a JSON record. No fine-tuning, no labelled dataset, and every decision explainable to the operator.",
  },
  architecture: {
    cols: 6,
    rows: 3,
    nodes: [
      { id: "video", col: 0, row: 1, kind: "source", label: { fa: "ویدئوی بازرسی", en: "Inspection video" }, sub: { fa: "VHS_LoadVideo", en: "VHS_LoadVideo" } },
      { id: "frames", col: 1, row: 1, kind: "process", label: { fa: "نمونه‌برداری فریم", en: "Frame sampling" }, sub: { fa: "۱ فریم بر ثانیه", en: "1 fps" } },
      { id: "resize", col: 2, row: 1, kind: "process", label: { fa: "تغییر اندازه", en: "Resize" }, sub: { fa: "۱۰۲۴×۱۵۳۶ · Lanczos", en: "1024×1536 · Lanczos" } },
      { id: "hough", col: 3, row: 0, kind: "process", label: { fa: "تبدیل هاف", en: "Hough circles" }, sub: { fa: "OpenCV · کجا", en: "OpenCV · where" } },
      { id: "sam", col: 4, row: 0, kind: "model", label: { fa: "SAM ViT-B", en: "SAM ViT-B" }, sub: { fa: "نقطه‌ی ترغیبی · مرز", en: "point prompts · boundary" } },
      { id: "analyzer", col: 4, row: 2, kind: "process", label: { fa: "تحلیل‌گر جریان", en: "Flow analyzer" }, sub: { fa: "واریانس درون ماسک", en: "in-mask variance" } },
      { id: "report", col: 5, row: 1, kind: "output", label: { fa: "گزارش JSON", en: "JSON report" }, sub: { fa: "سالم / معیوب", en: "PASSED / FAILED" } },
    ],
    edges: [
      { from: "video", to: "frames" },
      { from: "frames", to: "resize" },
      { from: "resize", to: "hough" },
      { from: "hough", to: "sam", label: { fa: "نقاط", en: "points" } },
      { from: "sam", to: "analyzer", label: { fa: "ماسک‌ها", en: "masks" } },
      { from: "frames", to: "analyzer", dashed: true },
      { from: "analyzer", to: "report" },
    ],
    caption: { fa: "گراف ComfyUI، با سه نود سفارشی بسته‌ی turbine_fin_inspection", en: "The ComfyUI graph, with the three custom nodes of the turbine_fin_inspection pack" },
  },
  interactive: "hole-inspector",
  features: {
    fa: [
      "ورودی ویدئو و نمونه‌برداری فقط از فریم‌های لازم",
      "تشخیص هندسی بدون هوش مصنوعی و بدون داده‌ی آموزشی؛ هر تصمیم مکانی قابل ردیابی",
      "SAM با ترغیب هندسی: هر مرکز هاف یک نقطه‌ی ترغیبی و یک ماسک",
      "معیار سلامت آماری برای هر سوراخ با آستانه‌ی قابل تنظیم",
      "گزارش JSON ساختاریافته (شناسه‌ی A1..F6، مرکز، واریانس، وضعیت) و درصد گرفتگی",
      "بسته‌ی نود سفارشی ComfyUI با نوع داده‌ی اختصاصی POINTS و انتخاب خودکار GPU/CPU",
    ],
    en: [
      "Video input, sampling only the frames that matter",
      "Geometric detection with no AI and no training data — every location decision is traceable",
      "Geometry-prompted SAM: one Hough centre, one point prompt, one mask",
      "A per-hole statistical health criterion with a tunable threshold",
      "Structured JSON report (grid id A1..F6, centre, variance, status) and a clog percentage",
      "A custom ComfyUI node pack with its own POINTS data type and automatic GPU/CPU selection",
    ],
  },
  outcomes: [
    { value: { fa: "۳۶/۳۶", en: "36/36" }, label: { fa: "سوراخ روی نمونه‌ی سالم تشخیص داده شد", en: "holes detected on the healthy sample" } },
    { value: { fa: "۰", en: "0" }, label: { fa: "تصویر آموزشی یا fine-tune لازم شد", en: "training images or fine-tuning needed" } },
    { value: { fa: "۳", en: "3" }, label: { fa: "سوراخ معیوب روی نمونه‌ی آزمون known_bad علامت خورد", en: "faulty holes flagged on the known_bad test sample" } },
    { value: { fa: "۳٫۳٪", en: "3.3%" }, label: { fa: "ضریب تغییرات واریانس روی سوراخ‌های سالم", en: "spread (CV) of variance across healthy holes" } },
  ],
  gallery: [
    {
      kind: "image",
      src: "/media/work/turbine/comfyui-graph.png",
      w: 1786,
      h: 718,
      frame: "browser",
      tone: "color",
      alt: { fa: "گراف کامل ورکفلو در ComfyUI", en: "The full workflow graph in ComfyUI" },
      caption: { fa: "کل ورکفلو روی ویدئوی known_bad: پیش‌نمایش هاف با ۳۶ دایره، خروجی با ۳ سوراخ علامت‌خورده", en: "The whole workflow on the known_bad video: the Hough preview with 36 circles, the output with 3 flagged holes" },
    },
    {
      kind: "image",
      src: "/media/work/turbine/hough-36.png",
      w: 314,
      h: 507,
      tone: "color",
      alt: { fa: "پیش‌نمایش نامزدهای هاف", en: "Hough candidate preview" },
      caption: { fa: "مرحله‌ی ۱ · ۳۶ نامزد هاف", en: "Stage 1 · 36 Hough candidates" },
    },
    {
      kind: "image",
      src: "/media/work/turbine/annotated-3-failed.png",
      w: 309,
      h: 509,
      tone: "color",
      alt: { fa: "خروجی علامت‌گذاری‌شده با سه سوراخ معیوب", en: "Annotated output with three failed holes" },
      caption: { fa: "مرحله‌ی ۴ · سه سوراخ معیوب", en: "Stage 4 · three failed holes" },
    },
  ],
  code: [
    {
      title: { fa: "هندسه می‌گوید کجا: فیلتر گاوسی و دایره‌های هاف، نقاط ترغیبی SAM را می‌سازند", en: "Geometry decides where: Gaussian blur + Hough circles emit SAM's point prompts" },
      lang: "python",
      file: "turbine_fin_inspection/geometry_hole_detector.py",
      code: `def detect(self, image, min_radius, max_radius):
    img = self._to_uint8(image)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 1.5)

    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=2 * min_radius,
        param1=100,
        param2=20,
        minRadius=min_radius,
        maxRadius=max_radius,
    )

    points = []
    preview = img.copy()
    if circles is not None:
        circles = np.round(circles[0, :]).astype(int)
        for x, y, r in circles:
            points.append((int(x), int(y)))
            cv2.circle(preview, (x, y), r, (0, 255, 0), 2)

    return (points, self._to_comfy_image(preview))`,
    },
    {
      title: { fa: "مدل می‌گوید مرز کجاست: یک نقطه‌ی ترغیبی برای هر سوراخ، یک ماسک", en: "The model decides the boundary: one point prompt per hole, one mask" },
      lang: "python",
      file: "turbine_fin_inspection/sam_point_segmenter.py",
      code: `device = "cuda" if torch.cuda.is_available() else "cpu"
sam.to(device)

predictor = SamPredictor(sam)
predictor.set_image(img)

masks_out = []
for (x, y) in points:
    masks, scores, _ = predictor.predict(
        point_coords=np.array([[x, y]]),
        point_labels=np.array([1]),
        multimask_output=False,
    )
    mask = torch.from_numpy(masks[0].astype(np.uint8)).float().unsqueeze(0)
    masks_out.append(mask)

return (masks_out,)`,
    },
  ],
  orgs: ["iust"],
};
