import type { Project } from "@/content/types";

export const taskflow: Project = {
  slug: "task-flow",
  tier: "flagship",
  featured: true,
  title: { fa: "Task Flow", en: "Task Flow" },
  kicker: { fa: "پلتفرم ایجنتی چندکاربره · محصول شخصی", en: "Multi-tenant agentic platform · Own product" },
  oneLiner: {
    fa: "هر کس به هر کس تسک می‌دهد و ورکفلوهای ایجنتی‌ای که خودتان طراحی می‌کنید (Gemini، Claude، مدل‌های سازگار با OpenAI یا Claude Code روی GitHub Actions) کار را انجام می‌دهند؛ از یک پیام کوتاه در موبایل تا یک commit واقعی در کد.",
    en: "Anyone assigns tasks to anyone, and agent workflows you design yourself — Gemini, Claude, any OpenAI-compatible model, or Claude Code on GitHub Actions — do the work: from a one-line message on a phone to a real commit in the code.",
  },
  year: "2026",
  period: { fa: "۳ تا ۱۱ مهر ۱۴۰۵ · ۹ نسخه", en: "Sep 25 – Oct 3, 2026 · 9 releases" },
  role: {
    fa: "مالک محصول و معمار سیستم؛ پیاده‌سازی با Claude Code به‌عنوان مهندس جفت",
    en: "Product owner & system architect; implemented with Claude Code as AI pair engineer",
  },
  context: { fa: "اولین محصول برند شخصی «By Taha Aghajani»", en: "The first product of the «By Taha Aghajani» brand" },
  status: { fa: "مستقر روی Vercel + Supabase؛ در استفاده‌ی واقعی", en: "Deployed on Vercel + Supabase; used on real work" },
  disciplines: ["agents", "enterprise-ai", "rag", "fullstack", "automation", "design"],
  stack: ["Next.js 16", "React 19", "TypeScript", "Supabase Postgres · pg_cron", "GitHub Actions", "Claude Code", "Gemini", "Claude", "OpenAI-compatible", "React Flow", "Tailwind v4"],
  cover: { kind: "art", art: "flow", alt: { fa: "خطوط جریان موازی", en: "Parallel flow lines" } },
  challenge: {
    fa: "کارهای فنی سازمانی بی‌وقفه می‌رسند: داشبورد، گزارش، رفع باگ در چند پروژه. طاها می‌خواست اتوماسیونی داشته باشد که هر تسک را از درخواست تا خروجی تحویل‌شده با ایجنت‌ها پیش ببرد و همه را از موبایل مدیریت کند.\n\nچت‌های عمومی هوش مصنوعی این‌ها را ندارند: گردش پذیرش و تأیید تسک، دانش ماندگار هر پروژه، پایپ‌لاین چندمرحله‌ای، صفی که به سهمیه‌ی رایگان احترام بگذارد و تحویل فایل واقعی در GitHub. و همه باید روی لایه‌ی رایگان Vercel و Supabase و سهمیه‌ی رایگان Google AI Studio اجرا شود.",
    en: "Enterprise technical tasks never stop arriving: dashboards, reports, bug fixes across several projects. Taha wanted an automation that takes each task from request to delivered output with agents — and to run it all from his phone.\n\nGeneric AI chats lack all of it: an intake and approval workflow, persistent per-project knowledge, multi-step pipelines, a queue that respects free-tier quotas, and delivery of real files into GitHub. And it all had to run on Vercel's and Supabase's free tiers and the free Google AI Studio quota.",
  },
  approach: {
    fa: "یک PWA فارسی (Next.js 16 + Supabase) که کل چرخه‌ی تسک را یک ورکفلوی زنده می‌کند: درخواست، پذیرش، **پیش‌کار** با یک DAG قابل‌طراحی از ایجنت‌های LLM، **کار اصلی** با یک ایجنت کدنویس (درون‌برنامه‌ای یا Claude Code روی GitHub Actions خود کاربر) و تأیید پایان.\n\nبه‌جای Celery و Redis، یک **صف منصفانه‌ی چندمسیره در Postgres** (claim_job + pg_cron هر ۳۰ ثانیه) هر کار را در گام‌های ازسرگرفتنی جلو می‌برد؛ لیمیت یک کلید فقط کارهای همان کاربر را متوقف می‌کند و خودکار ادامه می‌دهد.\n\nدو تصمیم مهم از استفاده‌ی واقعی آمد: اولین اجرا برای یک تسک ساده **۶۴ فایل** ساخت و پایپ‌لاین همان روز به **یک دستور کار (BRIEF.md)** و چند فایل کمکی بازطراحی شد؛ و RAG تکه‌تکه‌ی نسخه‌ی اول کنار رفت تا پروژه‌ها **کامل و بدون chunk** با یک فایل دانش زنده و گراف دانش نگه داشته شوند.",
    en: "A Persian PWA (Next.js 16 + Supabase) that turns the whole task lifecycle into one live workflow: intake, acceptance, **pre-work** through a configurable DAG of LLM agents, **main work** by a coder agent (in-app, or Claude Code on the user's own GitHub Actions), and sign-off.\n\nInstead of Celery and Redis, a **fair multi-lane Postgres queue** (claim_job + pg_cron every 30 s) advances each job in resumable steps; a rate limit pauses only that user's connection and resumes on its own.\n\nTwo key decisions came from real use: the first run produced **64 files** for a simple task, and the pipeline was redesigned the same day around **one work order (BRIEF.md)** plus a few helper files; and v1's chunked RAG was dropped so projects are stored **whole, never chunked**, with one living knowledge file and a knowledge graph.",
  },
  architecture: {
    cols: 6,
    rows: 3,
    nodes: [
      { id: "users", col: 0, row: 1, kind: "human", label: { fa: "موبایل و دسکتاپ", en: "Phone & desktop" }, sub: { fa: "PWA فارسی", en: "Persian PWA" } },
      { id: "app", col: 1, row: 1, kind: "process", label: { fa: "اپ Next.js 16", en: "Next.js 16 app" }, sub: { fa: "Server Actions · Realtime", en: "Server Actions · Realtime" } },
      { id: "cron", col: 2, row: 0, kind: "source", label: { fa: "pg_cron", en: "pg_cron" }, sub: { fa: "هر ۳۰ ثانیه", en: "every 30 s" } },
      { id: "queue", col: 2, row: 1, kind: "store", label: { fa: "صف Postgres", en: "Postgres queue" }, sub: { fa: "claim_job · مسیرهای منصفانه", en: "claim_job · fair lanes" } },
      { id: "engine", col: 3, row: 1, kind: "agent", label: { fa: "موتور DAG", en: "DAG engine" }, sub: { fa: "تا ۳ گره موازی", en: "≤3 parallel nodes" } },
      { id: "llm", col: 4, row: 0, kind: "model", label: { fa: "ایجنت‌های LLM", en: "LLM agents" }, sub: { fa: "Gemini · Claude · OpenAI", en: "Gemini · Claude · OpenAI" } },
      { id: "coder", col: 4, row: 2, kind: "agent", label: { fa: "Claude Code", en: "Claude Code" }, sub: { fa: "GitHub Actions کاربر", en: "user's GitHub Actions" } },
      { id: "repo", col: 5, row: 1, kind: "output", label: { fa: "مخزن کاربر", en: "User's repo" }, sub: { fa: "فایل کامل · KNOWLEDGE.md", en: "whole files · KNOWLEDGE.md" } },
    ],
    edges: [
      { from: "users", to: "app" },
      { from: "app", to: "queue" },
      { from: "cron", to: "queue", dashed: true },
      { from: "queue", to: "engine" },
      { from: "engine", to: "llm" },
      { from: "engine", to: "coder" },
      { from: "llm", to: "repo" },
      { from: "coder", to: "repo", label: { fa: "commit", en: "commit" } },
    ],
    caption: { fa: "هر کاربر کلیدهای هوش مصنوعی و مخزن GitHub خودش را دارد؛ اسرار با AES-256-GCM رمز می‌شوند", en: "Every user brings their own AI keys and GitHub repo; secrets are AES-256-GCM encrypted" },
  },
  interactive: "dag-player",
  features: {
    fa: [
      "تسک‌دهی به هر کسی با ۱۴ وضعیت؛ تسک‌های مرتبط همان تاریخچه و همان جلسه‌ی Claude را ادامه می‌دهند",
      "سازنده‌ی بصری ایجنت و ورکفلو (DAG با شاخه‌های موازی و مسیریاب بله/خیر)، به سبک n8n",
      "ایجنت کدنویس درون‌برنامه‌ای با ابزار (فهرست، جستجو، خواندن، نوشتن، ویرایش فایل) روی هر مدل",
      "Claude Code روی GitHub Actions کاربر با لاگ زنده، ادامه‌ی جلسه و ازسرگیری خودکار پس از ریست لیمیت",
      "کلید شخصی برای هر مرحله: Claude، Google AI Studio، OpenAI، Kimi، NVIDIA، OpenRouter یا هر endpoint سازگار",
      "پروژه‌ها کامل در مخزن خصوصی کاربر، با نقشه‌ی فایل، KNOWLEDGE.md زنده و گراف دانش graphify",
      "خودارتقایی: پرامپت مالک ← PR از Claude Code با ترمیم خودکار build ← پیش‌نمایش Vercel ← ادغام یا بازگشت",
      "فقط پرامپت و فایل‌های همان ارسال به مدل می‌رود؛ نه عنوان و شرح تسک",
    ],
    en: [
      "Assign tasks to anyone with a 14-status lifecycle; related tasks continue the same history and the same Claude session",
      "A visual agent and workflow builder (DAG with parallel branches and yes/no routers), n8n-style",
      "An in-app tool-using code agent (list, search, read, write, edit files) on any model",
      "Claude Code on the user's GitHub Actions with a live log, session resume and automatic resume after a usage-limit reset",
      "Bring-your-own keys per stage: Claude, Google AI Studio, OpenAI, Kimi, NVIDIA, OpenRouter or any compatible endpoint",
      "Projects stored whole in the user's private repo, with a file map, a living KNOWLEDGE.md and a graphify knowledge graph",
      "Self-upgrade: owner prompt → Claude Code PR with build self-repair → Vercel preview → merge or roll back",
      "Only the prompt and that send's files go to the model — never the task's title or description",
    ],
  },
  outcomes: [
    { value: { fa: "۹ روز", en: "9 days" }, label: { fa: "از ابزار شخصی تا محصول چندکاربره، در ۹ PR", en: "from personal tool to multi-tenant product, in 9 PRs" } },
    { value: { fa: "۶۴ → ۱", en: "64 → 1" }, label: { fa: "فایل پیش‌کار ← یک دستور کار، پس از بازطراحی همان‌روزه", en: "pre-work files → one work order, after a same-day redesign" } },
    { value: { fa: "۶ + ۳", en: "6 + 3" }, label: { fa: "ارائه‌دهنده‌ی هوش مصنوعی روی ۳ پروتکل", en: "AI providers over 3 wire protocols" } },
    { value: { fa: "۲۲K", en: "22K" }, label: { fa: "خط TypeScript با ۷۳ تست و CI بدون متغیر محیطی", en: "lines of TypeScript, 73 tests, CI with no env vars" } },
  ],
  gallery: [],
  code: [
    {
      title: { fa: "زمان‌بند DAG با شاخه‌های مسیریاب و حذف آبشاری؛ خالص و مشترک بین موتور و سازنده‌ی بصری", en: "DAG scheduler with router branches and cascading skips — pure, shared by the engine and the visual builder" },
      lang: "ts",
      file: "src/lib/workflow/types.ts",
      code: `export function schedule(wf, outcomes) {
  const status = (id) => outcomes[id]?.status ?? "pending";
  const skipped = new Set<string>();
  const effective = (id) => (skipped.has(id) ? "skipped" : status(id));
  const active = (e) => effective(e.source) === "done" && (!e.when || outcomes[e.source]?.decision === e.when);
  const resolved = (e) => ["done", "skipped", "error"].includes(effective(e.source));

  // skipping can cascade: repeat until stable
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of wf.nodes) {
      if (effective(n.id) !== "pending") continue;
      const inc = incoming(wf, n.id);
      if (inc.length && inc.every(resolved) && !inc.some(active)) {
        skipped.add(n.id);
        changed = true;
      }
    }
  }
  const ready = wf.nodes
    .filter((n) => effective(n.id) === "pending")
    .filter((n) => {
      const inc = incoming(wf, n.id);
      return !inc.length || (inc.every(resolved) && inc.some(active));
    })
    .map((n) => n.id);
  return { ready, skip: [...skipped] };
}`,
    },
    {
      title: { fa: "برداشتن منصفانه‌ی کار: سقف هر مسیر، سقف هر کاربر، و کنار گذاشتن اتصال‌های متوقف", en: "Fair job claim: per-lane cap, per-owner cap, paused connections excluded" },
      lang: "sql",
      file: "supabase/migrations/20261003000000_multi_tenant.sql",
      code: `perform pg_advisory_xact_lock(hashtext('claim:' || p_lane));

select j.* into v_job from public.jobs j
 where j.lane = p_lane
   and j.run_after <= now()
   and (
     (j.status = 'running' and (j.locked_until is null or j.locked_until < now()))
     or (
       j.status = 'queued'
       and v_running < v_lane.max_running
       and (select count(*) from public.jobs r
             where r.lane = p_lane and r.status = 'running'
               and r.owner_id is not distinct from j.owner_id) < v_lane.per_owner
     )
   )
   and not exists (
     select 1 from public.connection_state c
      where c.connection_id = j.connection_id
        and (c.manual_pause or (c.paused_until is not null and c.paused_until > now()))
   )
 order by j.priority desc, coalesce(j.heartbeat_at, j.created_at)
 limit 1
 for update of j skip locked;`,
    },
    {
      title: { fa: "نسخه‌ی نخست: جستجوی ترکیبی pgvector و متن کامل با Reciprocal Rank Fusion", en: "Version one: hybrid pgvector + full-text search fused with Reciprocal Rank Fusion" },
      lang: "sql",
      file: "supabase/migrations/20260925000000_init.sql",
      code: `with semantic as (
  select k.id, row_number() over (order by k.embedding <=> query_embedding) as rnk
  from public.knowledge_items k
  where k.metadata @> filter and k.embedding is not null
  order by k.embedding <=> query_embedding
  limit match_count * 3
),
keyword as (
  select k.id, row_number() over (
           order by ts_rank_cd(k.fts, websearch_to_tsquery('simple', query_text)) desc) as rnk
  from public.knowledge_items k
  where k.metadata @> filter and k.fts @@ websearch_to_tsquery('simple', query_text)
  limit match_count * 3
)
select k.id, k.content,
       (coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + kw.rnk), 0)
         + least(k.score, 5) * 0.002)::float as score
from semantic s
full outer join keyword kw on kw.id = s.id
join public.knowledge_items k on k.id = coalesce(s.id, kw.id)
order by score desc
limit match_count;`,
    },
  ],
  links: [{ label: { fa: "کد منبع در GitHub", en: "Source on GitHub" }, href: "https://github.com/tahahajiaghajani/ai" }],
  note: {
    fa: "معماری، مشخصات و تصمیم‌های محصول از طاهاست؛ پیاده‌سازی با Claude Code انجام شد. نشانی نسخه‌ی مستقر به‌خاطر داده‌های واقعی کاری منتشر نمی‌شود.",
    en: "The architecture, specification and product decisions are Taha's; the implementation was done with Claude Code. The deployed instance holds real work data, so its address isn't published.",
  },
};
