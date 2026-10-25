import type { L } from "@/lib/i18n";

export const PROFILE = {
  name: { fa: "طاها آقاجانی", en: "Taha Aghajani" } as L,
  first: { fa: "طاها", en: "Taha" } as L,
  last: { fa: "آقاجانی", en: "Aghajani" } as L,
  born: { fa: "۱۳۸۰", en: "2001" } as L,
  city: { fa: "تهران", en: "Tehran, Iran" } as L,
  /** rotating titles under the name */
  roles: {
    fa: ["معمار سیستم‌های هوش مصنوعی سازمانی", "مهندس استقرار پیشرو (FDE)", "مهندس فول‌استک", "طراح و برندساز"],
    en: ["Enterprise AI Systems Architect", "Forward Deployed Engineer", "Full-Stack Engineer", "Designer & Brand Maker"],
  } as L<string[]>,
  headline: {
    fa: "سیستم‌های هوش مصنوعی پیچیده را طراحی می‌کنم، می‌سازم و در سازمان مستقر می‌کنم.",
    en: "I design, build and deploy complex AI systems inside real organisations.",
  } as L,
  intro: {
    fa: "متخصص هوش مصنوعی با تسلط بر RAG، مدل‌های زبانی بزرگ، بینایی ماشین و VLM؛ مدیر پروژه و سرپرست تیم هوش مصنوعی شرکت مدیریت پروژه پارس. از تحلیل یک سیستم پیچیده تا معماری، پیاده‌سازی و استقرار، کار را خودم تا آخر می‌برم.",
    en: "AI specialist across RAG, large language models, computer vision and VLMs; project manager and head of the AI team at Pars Project Management. From untangling a complex system to its architecture, implementation and deployment, I carry the work end to end myself.",
  } as L,
  manifesto: {
    fa: "بزرگ‌ترین توان من دیدن کل سیستم است: داده، آدم‌ها، فرایندها و مدل‌ها، کنار هم. سیستم‌های سازمانی را از تحلیل تا استقرار طراحی می‌کنم، ورکفلوها و پایپ‌لاین‌های هوشمند می‌سازم، و چون طراح هم هستم، نتیجه نه‌فقط کار می‌کند، بلکه درست دیده می‌شود.",
    en: "My strongest skill is seeing the whole system — data, people, processes and models at once. I design enterprise systems from analysis to deployment, build intelligent workflows and pipelines, and because I am also a designer, what I ship doesn't just work: it reads right.",
  } as L,
  contact: {
    email: "taha.aghajani8@gmail.com",
    phone: "+989336627597",
    phoneDisplay: { fa: "۰۹۳۳ ۶۶۲ ۷۵۹۷", en: "+98 933 662 7597" } as L,
    telegram: "https://t.me/+989336627597",
    github: "https://github.com/tahahajiaghajani",
  },
};

/** The disciplines, in the order the expertise section tells them. */
export const EXPERTISE: { key: string; title: L; body: L; tags: string[] }[] = [
  {
    key: "enterprise",
    title: { fa: "معماری هوش مصنوعی سازمانی", en: "Enterprise AI architecture" },
    body: {
      fa: "تحلیل سیستم‌های پیچیده‌ی سازمانی و طراحی معماری‌ای که هوش مصنوعی را در دل داده‌ها، فرایندها و تصمیم‌ها می‌نشاند؛ با امنیت، صف‌بندی منصفانه، چندمستأجری و تأیید انسانی.",
      en: "Untangling complex organisational systems and designing architectures that put AI inside the data, processes and decisions — secure, multi-tenant, fairly queued, with humans approving what matters.",
    },
    tags: ["System design", "Multi-tenant", "Queues", "Human-in-the-loop"],
  },
  {
    key: "agents",
    title: { fa: "ایجنت‌ها، ورکفلوها و پایپ‌لاین‌ها", en: "Agents, workflows & pipelines" },
    body: {
      fa: "ایجنت‌های ابزارمحور، ورکفلوهای DAG با مراحل موازی و شرطی، مسیریاب‌ها و کدنویس‌های خودکار؛ از n8n و ComfyUI تا موتورهای اختصاصی.",
      en: "Tool-using agents, DAG workflows with parallel and conditional steps, routers and autonomous coders — from n8n and ComfyUI to custom engines.",
    },
    tags: ["Agent loops", "DAG engines", "n8n", "ComfyUI"],
  },
  {
    key: "rag",
    title: { fa: "RAG و مدل‌های زبانی", en: "RAG & large language models" },
    body: {
      fa: "پاسخ مستند از دانش سازمان: بازیابی ترکیبی، گراف دانش، زنجیره‌ی مدل‌ها با جایگزین خودکار، و پرامپت‌هایی که فارسی را درست می‌فهمند.",
      en: "Grounded answers from organisational knowledge: hybrid retrieval, knowledge graphs, model chains with automatic fallback, and prompts that handle Persian properly.",
    },
    tags: ["Retrieval", "BM25 + vectors", "Knowledge graphs", "Gemini · Claude · GPT"],
  },
  {
    key: "vision",
    title: { fa: "بینایی ماشین و VLM", en: "Computer vision & VLMs" },
    body: {
      fa: "پایش صنعتی با ترکیب هندسه‌ی کلاسیک و مدل‌های پایه مثل SAM؛ قطعه‌بندی، تشخیص ناهنجاری و مدل‌های بینایی‌-زبانی برای خط تولید.",
      en: "Industrial inspection that pairs classical geometry with foundation models like SAM — segmentation, anomaly detection and vision-language models on the production line.",
    },
    tags: ["SAM", "OpenCV", "Anomaly detection", "VLMs"],
  },
  {
    key: "fullstack",
    title: { fa: "مهندسی فول‌استک و داده", en: "Full-stack & data engineering" },
    body: {
      fa: "از پایگاه داده و SQL تا API، صف‌های پس‌زمینه و رابط کاربری؛ با JavaScript/TypeScript، Python و SQL، سامانه‌ی کامل و قابل نگهداری.",
      en: "From databases and SQL to APIs, background queues and the interface — complete, maintainable systems in JavaScript/TypeScript, Python and SQL.",
    },
    tags: ["TypeScript", "Python", "SQL", "Next.js · Supabase"],
  },
  {
    key: "design",
    title: { fa: "طراحی، برند و موشن", en: "Design, brand & motion" },
    body: {
      fa: "هویت بصری، کتاب برند، طراحی وب و تیزرهای موشن‌گرافیک؛ زیبایی‌شناسی‌ای که به سیستم‌های فنی اعتبار و شخصیت می‌دهد.",
      en: "Visual identities, brand books, web design and motion-graphics teasers — an aesthetic that gives technical systems credibility and character.",
    },
    tags: ["Identity", "Brand books", "Web design", "Motion"],
  },
  {
    key: "engineering",
    title: { fa: "مهندسی مکانیک و سیستم", en: "Mechanical & systems engineering" },
    body: {
      fa: "مهندس مکانیک با تسلط بر SolidWorks و دانشجوی ارشد مهندسی صنایع (طراحی سیستم و تحلیل داده)؛ پلی میان ماشین، داده و هوش مصنوعی.",
      en: "A mechanical engineer fluent in SolidWorks and a graduate student of industrial engineering (system design & data analysis) — a bridge between machines, data and AI.",
    },
    tags: ["SolidWorks", "Predictive maintenance", "Systems analysis"],
  },
];

/** The working method, told as five moves. */
export const METHOD: { title: L; body: L }[] = [
  {
    title: { fa: "تحلیل", en: "Analyse" },
    body: { fa: "سیستم موجود، داده‌ها و آدم‌ها را از نزدیک می‌شناسم؛ مسئله‌ی واقعی را پیدا می‌کنم، نه صورت مسئله را.", en: "I study the existing system, its data and its people up close — and find the real problem, not just its symptoms." },
  },
  {
    title: { fa: "معماری", en: "Architect" },
    body: { fa: "معماری‌ای طراحی می‌کنم که هم امروز کار کند و هم فردا بزرگ شود: امن، قابل ردیابی، با هزینه‌ی قابل پیش‌بینی.", en: "I design an architecture that works today and scales tomorrow — secure, traceable, with predictable cost." },
  },
  {
    title: { fa: "ساخت", en: "Build" },
    body: { fa: "با مهندسی هوش‌مصنوعی‌محور می‌سازم: مشخصات را می‌نویسم و ساخت را با Claude Code هدایت می‌کنم؛ بک‌اند، ایجنت‌ها، پایپ‌لاین داده و رابط کاربری، با تست و بازبینی سخت‌گیرانه.", en: "I build with AI-native engineering: I write the specification and direct the build with Claude Code — backend, agents, data pipelines and interface — with tests and adversarial review." },
  },
  {
    title: { fa: "استقرار", en: "Deploy" },
    body: { fa: "کنار تیم مشتری مستقر می‌کنم، آموزش می‌دهم و با داده‌ی واقعی می‌سنجم؛ این یعنی مهندسی استقرار پیشرو.", en: "I deploy alongside the client's team, train them and measure on real data — that is forward-deployed engineering." },
  },
  {
    title: { fa: "تکامل", en: "Evolve" },
    body: { fa: "سیستم با بازخورد واقعی بهتر می‌شود: مانیتورینگ، دانش به‌روز و چرخه‌های بهبود مداوم.", en: "The system improves on real feedback — monitoring, living knowledge and continuous improvement loops." },
  },
];
