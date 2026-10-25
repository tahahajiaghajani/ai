/**
 * Extra facts for the AI assistant that are not spelled out on the pages. Only verified facts: Taha's own
 * statements, his thesis and his repositories. Bilingual where it helps retrieval.
 */
export const FACTS: { id: string; title: string; tags: string[]; body: string; pinned?: boolean }[] = [
  {
    id: "services",
    pinned: true,
    title: "What Taha can do for an organisation / خدمات",
    tags: ["services", "hire", "خدمات", "همکاری", "استخدام", "پروژه", "مشاوره", "consulting"],
    body: [
      "- Enterprise AI systems end to end: analysing a complex organisation, designing the architecture, building and deploying it (forward-deployed engineering).",
      "- RAG and LLM systems: grounded assistants over company documents, knowledge graphs, model chains with fallback, Persian-first prompting.",
      "- AI agents, custom workflows and pipelines: tool-using agents, DAG workflow engines, n8n and ComfyUI pipelines, Claude Code automation on GitHub Actions.",
      "- Computer vision and VLMs for industry: inspection, segmentation (SAM), anomaly detection, predictive maintenance.",
      "- Full-stack platforms: Next.js / React / TypeScript, Python, SQL / PostgreSQL / Supabase, queues and background workers, secure multi-tenant design.",
      "- AI advisory for banks and enterprises, project-management systems (EPM / PWA / SharePoint), dashboards and reporting.",
      "- Design: brand identity, brand books, web design, motion-graphics teasers and brochures.",
      "- خدمات: طراحی و استقرار سیستم‌های سازمانی هوش مصنوعی، RAG و مدل‌های زبانی، ایجنت‌ها و ورکفلوها (n8n، ComfyUI)، بینایی ماشین صنعتی، پلتفرم‌های فول‌استک، مشاوره‌ی هوش مصنوعی برای بانک‌ها و سازمان‌ها، و طراحی برند و موشن‌گرافیک.",
    ].join("\n"),
  },
  {
    id: "skills",
    title: "Skills and tools / مهارت‌ها و ابزارها",
    tags: ["skills", "stack", "tools", "مهارت", "ابزار", "زبان برنامه‌نویسی", "python", "javascript", "sql", "n8n", "comfyui", "solidworks"],
    body: [
      "Languages: JavaScript / TypeScript, Python, SQL (also C# for enterprise jobs).",
      "AI: RAG, LLMs (Gemini, Claude, OpenAI-compatible models), computer vision, VLMs, Segment Anything, OpenCV, PyTorch, agents and tool loops.",
      "Automation: n8n and ComfyUI (full command), custom ComfyUI nodes, GitHub Actions runners, Claude Code.",
      "Platforms: Next.js, React, Supabase / PostgreSQL, Vercel, Tailwind, GSAP, WebGL.",
      "Engineering: SolidWorks; mechanical engineering background; systems design and data analysis.",
      "Design: branding, brand books, web and UI design, motion graphics and teasers.",
    ].join("\n"),
  },
  {
    id: "education",
    title: "Education / تحصیلات",
    tags: ["education", "university", "degree", "تحصیلات", "دانشگاه", "مدرک", "کارشناسی", "ارشد", "IUST", "علم و صنعت"],
    body: [
      "- BSc in Mechanical Engineering, Iran University of Science and Technology (IUST, دانشگاه علم و صنعت ایران). Final project (Tir 1405 / July 2026): a hybrid machine-vision system (Hough transform + Segment Anything) for automated health monitoring of turbine-fin cooling holes, built as custom ComfyUI nodes.",
      "- Currently an MSc student of Industrial Engineering, track: system design and data analysis (کارشناسی ارشد مهندسی صنایع، گرایش طراحی سیستم و تحلیل داده).",
      "- Did industrial university projects combining coding, AI and mechanical engineering, including a milling-machine vibration and tool-life system designed with Sharif University students.",
    ].join("\n"),
  },
  {
    id: "languages",
    title: "Languages and location / زبان و محل",
    tags: ["language", "زبان", "location", "شهر", "remote", "دورکاری", "Tehran", "تهران"],
    body: "Taha works in Persian and English and is based in Tehran, Iran. He collaborates remotely and on-site.",
  },
  {
    id: "assistant",
    title: "About this assistant and this website / درباره‌ی این دستیار",
    tags: ["assistant", "chatbot", "دستیار", "website", "سایت", "how built", "چطور ساخته"],
    body: [
      "This assistant runs on Google Gemini (free AI Studio tier) with a fallback chain of models. Its knowledge is generated from the website's own content (profile, case studies, journey) and retrieved with BM25 over Persian-normalised text, then grounded in a strict system prompt.",
      "The website was designed and directed by Taha and built with Claude Code (AI-native engineering): Next.js on Vercel with no database — requests, settings and extra knowledge live in a private GitHub repository — GSAP + Lenis motion, a WebGL portrait shader, and an AI-triaged request desk with tracking codes and Telegram notifications.",
    ].join("\n"),
  },
];
