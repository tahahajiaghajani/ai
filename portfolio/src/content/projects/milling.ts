import type { Project } from "@/content/types";

export const milling: Project = {
  slug: "milling-tool-life",
  tier: "work",
  title: { fa: "تخمین زنده‌ی عمر تیغه‌ی فرز", en: "Live Milling-Cutter Life Estimation" },
  kicker: { fa: "نگهداری پیش‌بین · همکاری پژوهشی", en: "Predictive maintenance · Research collaboration" },
  oneLiner: {
    fa: "لرزه‌نگارِ متصل به دستگاه فرز، ورکفلویی با مدل‌های سری زمانی را تغذیه می‌کند که ناهنجاری‌ها را می‌یابد و با ترکیب فرمول‌های عمر ابزار و پارامترهای ماشین‌کاری، عمر تیغه را زنده تخمین می‌زند.",
    en: "A vibration sensor on a milling machine feeds a workflow of time-series models that flags anomalies and, combining tool-life formulas with machining parameters, estimates the cutter's remaining life live.",
  },
  year: "", // no sourced date yet
  period: { fa: "همکاری دانشگاهی", en: "University collaboration" },
  role: { fa: "طراحی مشترک سیستم و ورکفلو", en: "Co-designer of the system and workflow" },
  context: { fa: "با دانشجویان دانشگاه صنعتی شریف", en: "With students of Sharif University of Technology" },
  status: { fa: "سیستم کارکرده در محیط پژوهشی", en: "Working system in a research setting" },
  disciplines: ["industrial", "data", "automation"],
  stack: ["Vibration sensing", "Time-series models", "Anomaly detection", "Tool-life formulas", "Workflow orchestration"],
  cover: { kind: "art", art: "signal", alt: { fa: "سیگنال ارتعاش با یک ناهنجاری و منحنی عمر ابزار", en: "A vibration signal with an anomaly and a tool-life curve" } },
  challenge: {
    fa: "تیغه‌ی فرز در حین ماشین‌کاری فرسوده می‌شود. ارتعاش غیرعادی یا رسیدن به انتهای عمر ابزار، کیفیت قطعه را خراب می‌کند و توقف پیش‌بینی‌نشده می‌سازد. هدف این بود که خودِ ارتعاش دستگاه، ناهنجاری‌ها را آشکار کند و مهم‌تر از آن، تخمینی زنده از عمر باقی‌مانده‌ی تیغه بدهد.",
    en: "A milling cutter wears as it cuts. Abnormal vibration, or reaching the end of tool life, ruins parts and causes unplanned stops. The goal was to let the machine's own vibration reveal anomalies — and, above all, give a live estimate of the cutter's remaining life.",
  },
  approach: {
    fa: "یک لرزه‌نگار به دستگاه فرز متصل شد و خروجی آن به یک ورکفلو رفت. در ورکفلو، **مدل‌های time-segment** ناهنجاری‌ها را تشخیص می‌دهند، و مرحله‌ی تخمین عمر، **فرمول‌های موجود عمر ابزار** را با **پارامترهای ماشین‌کاری** و خروجی لرزه‌نگار ترکیب می‌کند تا عمر تیغه را به‌صورت زنده به‌روز کند؛ پیوند فیزیک و داده، مثل پروژه‌ی پایانی توربین.",
    en: "A vibration sensor was attached to the milling machine and its output streamed into a workflow. There, **time-segment models** detect anomalies, and a life-estimation stage combines **established tool-life formulas** with the **machining parameters** and the sensor output to update the cutter's life live — physics and data together, like the turbine thesis.",
  },
  architecture: {
    cols: 5,
    rows: 3,
    nodes: [
      { id: "sensor", col: 0, row: 1, kind: "source", label: { fa: "لرزه‌نگار", en: "Vibration sensor" }, sub: { fa: "روی دستگاه فرز", en: "on the milling machine" } },
      { id: "flow", col: 1, row: 1, kind: "process", label: { fa: "ورکفلو", en: "Workflow" }, sub: { fa: "پنجره‌های زمانی", en: "time segments" } },
      { id: "anomaly", col: 2, row: 0, kind: "model", label: { fa: "مدل‌های سری زمانی", en: "Time-series models" }, sub: { fa: "تشخیص ناهنجاری", en: "anomaly detection" } },
      { id: "params", col: 2, row: 2, kind: "source", label: { fa: "پارامترهای ماشین‌کاری", en: "Machining parameters" } },
      { id: "life", col: 3, row: 2, kind: "process", label: { fa: "فرمول‌های عمر ابزار", en: "Tool-life formulas" } },
      { id: "out", col: 4, row: 1, kind: "output", label: { fa: "عمر زنده‌ی تیغه", en: "Live cutter life" }, sub: { fa: "+ هشدار ناهنجاری", en: "+ anomaly alerts" } },
    ],
    edges: [
      { from: "sensor", to: "flow" },
      { from: "flow", to: "anomaly" },
      { from: "flow", to: "life" },
      { from: "params", to: "life" },
      { from: "anomaly", to: "out" },
      { from: "life", to: "out" },
    ],
    caption: { fa: "نمودار مفهومی", en: "Conceptual diagram" },
  },
  features: {
    fa: ["دریافت پیوسته‌ی داده‌ی ارتعاش از دستگاه فرز", "تشخیص ناهنجاری با مدل‌های time-segment", "تخمین زنده‌ی عمر تیغه، مهم‌ترین خروجی سیستم", "ترکیب فرمول‌های موجود، پارامترهای ماشین‌کاری و داده‌ی حسگر"],
    en: ["Continuous vibration data from the milling machine", "Anomaly detection with time-segment models", "Live estimation of cutter life — the system's key output", "Established formulas, machining parameters and sensor data combined"],
  },
  outcomes: [],
  gallery: [],
  orgs: ["sharif"],
  note: { fa: "جزئیات فنی این همکاری در قالب نمودار مفهومی آمده است.", en: "Technical details of this collaboration are shown as a conceptual diagram." },
};
