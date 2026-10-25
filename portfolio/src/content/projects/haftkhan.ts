import type { Project } from "@/content/types";

export const haftkhan: Project = {
  slug: "haft-khan",
  tier: "lab",
  title: { fa: "هفت‌خان: پایپ‌لاین قهرمان با هوش مصنوعی", en: "Haft Khan: an AI-to-MetaHuman hero pipeline" },
  kicker: { fa: "آزمایشگاه · بازی و سه‌بعدی · پیش‌تولید", en: "Lab · Games & 3D · Pre-production" },
  oneLiner: {
    fa: "طرح پیش‌تولید دموی کوتاه یک بازی اکشن شاهنامه‌ای (رستم در برابر دیو سپید): رستم با ابزارهای تصویرساز و تبدیل تصویر به سه‌بعدی ساخته می‌شود، در آنریل ۵.۸ به متاهیومن ریگ‌شده بدل می‌شود و با موشن‌مچینگ جان می‌گیرد؛ فقط با ابزار رایگان، روی یک RTX 4060 لپ‌تاپ.",
    en: "A pre-production plan for a short Shahnameh action-game demo — Rostam against the White Div: Rostam generated with image and image-to-3D tools, conformed into a rigged MetaHuman in Unreal Engine 5.8 and brought to life with motion matching — on free tools and a laptop RTX 4060.",
  },
  year: "2026",
  period: { fa: "مرداد تا شهریور ۱۴۰۵", en: "Jul – Aug 2026" },
  role: { fa: "مالک و رهبر خلاق؛ هدف، قیدها و انتخاب مسیر؛ نقشه‌ی راه با Claude نوشته شد", en: "Owner & creative lead: goal, constraints and the choice of path; roadmap written with Claude" },
  context: { fa: "پروژه‌ی شخصی یک‌نفره", en: "Solo personal project" },
  status: { fa: "پیش‌تولید و طراحی پایپ‌لاین", en: "Pre-production & pipeline design" },
  disciplines: ["3d", "design"],
  stack: ["Unreal Engine 5.8", "MetaHuman · Mesh to MetaHuman", "Hunyuan3D · Rodin · Meshy", "Motion Matching", "IK Retargeter", "C++ · Blueprint", "Python editor scripting"],
  cover: { kind: "art", art: "mesh", alt: { fa: "مش سه‌بعدی", en: "A 3D mesh" } },
  challenge: {
    fa: "کاراکترهای سه‌بعدی ساخته‌ی هوش مصنوعی توپولوژی آشفته و مثلثی داشتند؛ حلقه‌های لبه از مفصل‌ها پیروی نمی‌کرد، پس آرنج و زانو هنگام تغییر شکل له می‌شد و باور رایج این بود که هوش مصنوعی نمی‌تواند قهرمان بسازد. چالش: یک‌نفره، روی کارت گرافیک لپ‌تاپ و فقط با ابزار رایگان، به قهرمانی باورپذیر و قابل انیمیشن و مبارزه‌ای با وزن برسد.",
    en: "AI-generated 3D characters came with messy, triangulated topology: edge loops ignored the joints, so elbows and knees crumpled on deformation, and the common view was that AI couldn't make a hero. The challenge: solo, on a laptop GPU and with free tools only, reach a believable, animatable hero and a fight that feels heavy.",
  },
  approach: {
    fa: "پایپ‌لاین حول Mesh to MetaHuman در آنریل ۵.۸ طراحی شد که هر مش انسانی با توپولوژی دلخواه را به متاهیومن کاملاً ریگ‌شده تبدیل می‌کند. همین قاعده‌ی انتخاب ابزار را وارونه کرد: ابزار تبدیل تصویر به سه‌بعدی را برای فرم، حجم عضله و جزئیات انتخاب کن، نه تمیزی مش.\n\nمسیر: پرامپت‌های مفهومی با قیدهای سخت (A-pose، نمای کاملاً روبه‌رو، نور تخت)، مقایسه‌ی Hunyuan3D، Rodin و Meshy روی یک تصویر، حل هویت و ریگ خودکار، شکل‌دهی بدن، مو و زره‌های جدا با Leader Pose، انیمیشن با نمونه‌ی Game Animation و موشن‌مچینگ، و سیستم مبارزه‌ی ترکیبی C++ و Blueprint. دامنه عمداً کوچک ماند: یک غار، دو کاراکتر و یک نبرد سه‌مرحله‌ای.",
    en: "The pipeline was designed around UE 5.8's Mesh to MetaHuman, which turns any human mesh of arbitrary topology into a fully rigged MetaHuman. That inverts the tool-selection rule: pick the image-to-3D tool for form, muscle volume and detail, not mesh cleanliness.\n\nThe path: concept prompts with hard constraints (A-pose, strictly frontal, flat light), Hunyuan3D vs Rodin vs Meshy on the same image, identity solve and auto-rig, body shaping, grooms and separate armour pieces on Leader Pose, animation from the Game Animation Sample with motion matching, and a hybrid C++/Blueprint combat system. Scope stays deliberately small: one cave, two characters, one three-phase boss fight.",
  },
  architecture: {
    cols: 6,
    rows: 1,
    nodes: [
      { id: "concept", col: 0, row: 0, kind: "model", label: { fa: "مفهوم", en: "Concept" }, sub: { fa: "تصویرساز · A-pose", en: "image gen · A-pose" } },
      { id: "mesh", col: 1, row: 0, kind: "model", label: { fa: "تصویر به سه‌بعدی", en: "Image to 3D" }, sub: { fa: "Hunyuan3D · Rodin", en: "Hunyuan3D · Rodin" } },
      { id: "mh", col: 2, row: 0, kind: "process", label: { fa: "Mesh to MetaHuman", en: "Mesh to MetaHuman" }, sub: { fa: "حل هویت · ریگ", en: "identity · auto-rig" } },
      { id: "outfit", col: 3, row: 0, kind: "process", label: { fa: "مو و زره", en: "Grooms & armour" }, sub: { fa: "Leader Pose", en: "Leader Pose" } },
      { id: "anim", col: 4, row: 0, kind: "process", label: { fa: "انیمیشن", en: "Animation" }, sub: { fa: "موشن‌مچینگ", en: "motion matching" } },
      { id: "demo", col: 5, row: 0, kind: "output", label: { fa: "دموی مبارزه", en: "Combat demo" }, sub: { fa: "۶۰ فریم · RTX 4060", en: "60 fps · RTX 4060" } },
    ],
    edges: [
      { from: "concept", to: "mesh" },
      { from: "mesh", to: "mh" },
      { from: "mh", to: "outfit" },
      { from: "outfit", to: "anim" },
      { from: "anim", to: "demo" },
    ],
    caption: { fa: "بودجه: صفر؛ همه‌ی ابزارها رایگان", en: "Budget: zero — every tool is free" },
  },
  features: {
    fa: [
      "استراتژی «هوش مصنوعی به متاهیومن» با دامنه‌ی سخت: بدون باس دست‌ساز، بدون غار دست‌مدل، بدون انیمیشن از صفر",
      "قیدهای ورودی برای تصویرسازها تا مرحله‌ی تطبیق، سیلوئت واقعی بدن را ببیند",
      "مقایسه‌ی ابزارهای تبدیل تصویر به سه‌بعدی روی یک تصویر",
      "تنظیم پارامترهای بدن در داده‌ی جفت‌شده‌ی متاهیومن (چربی پیش از عضله)",
      "نمادهای هویتی: ببر بیان، کلاه‌خود شاخ‌دار و گرز گاوسر",
      "فهرست حداقل حرکات و نبرد سه‌مرحله‌ای با دیو سپید",
    ],
    en: [
      "An «AI to MetaHuman» strategy with a hard scope: no hand-built boss, no hand-modelled cave, no animation from scratch",
      "Input constraints for image generators so the conform step sees the true body silhouette",
      "A side-by-side comparison of image-to-3D tools on the same picture",
      "Body parameters tuned within MetaHuman's coupled data model (fat before muscle)",
      "Identity elements: the tiger pelt (Babr-e Bayan), a horned helmet and the ox-head mace",
      "A minimum move list and a three-phase fight with the White Div",
    ],
  },
  outcomes: [],
  gallery: [],
  note: {
    fa: "این کار در مرحله‌ی طرح است و هنوز دارایی یا دمو ساخته‌شده‌ای ندارد؛ برای همین در آزمایشگاه آمده است.",
    en: "This is still a plan, with no built assets or demo yet — which is why it sits in the lab.",
  },
};
