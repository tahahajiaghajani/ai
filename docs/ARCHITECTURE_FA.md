# معماری TaskFlow AI

## نمای کلی

```
                  ┌──────────────────────────── Vercel (Next.js 16) ─────────────────────────────┐
 تسک‌دهنده ──►   │  پنل تسک‌دهنده (/portal)          اپ اصلی مدیر (/dashboard، /inbox، …)         │
 (موبایل/دسکتاپ) │        │ Server Actions                     │  Supabase Realtime (زنده)        │
                  │        ▼                                    ▼                                   │
                  │  سرویس تسک‌ها ──► صف کارها (jobs) ◄── /api/worker/tick  ◄── pg_cron (هر ۳۰ ثانیه)│
                  │                                  │  هر بار یک گره‌ی LangGraph (≤۵۰ ثانیه)       │
                  │                                  ├─► Gemini (LangGraph + LangChain + RAG)       │
                  │                                  └─► dispatch GitHub Actions (Claude / graphify)│
                  │  /api/runner/*  ◄──── رویدادهای زنده و نتیجه از runnerها                          │
                  └──────────────────────────────────────────────────────────────────────────────┘
                         │                                  │
          Supabase (Postgres + pgvector + Auth + Storage + Realtime + pg_cron + pg_net)
                         │
          GitHub: ai-workspace (tasks/, knowledge/, ورکفلوهای Claude/graphify)  ·  ai (کد اپ + self-upgrade)
```

## چرا این معماری؟ (و جایگزین Celery/Redis)

درخواست اولیه استفاده از Celery و Redis بود، اما هم‌زمان خواسته شده بود **همه‌چیز روی Vercel رایگان و Supabase رایگان** باشد و **هیچ چیز لوکال** نباشد. Celery به یک پروسه‌ی worker دائمی نیاز دارد که روی Vercel (سرورلس، حداکثر ۶۰ ثانیه) امکان‌پذیر نیست. به همین دلیل همان قابلیت‌ها روی Postgres پیاده شده است:

| Celery / Redis | TaskFlow AI |
|---|---|
| Broker و صف | جدول `jobs` + تابع اتمیک `claim_job` با `FOR UPDATE SKIP LOCKED` و advisory lock |
| Worker | `/api/worker/tick` روی Vercel (با `after()` و self-chaining تا وقتی کار باقی است) |
| Celery beat | `pg_cron` + `pg_net` داخل Supabase (هر ۳۰ ثانیه) |
| Concurrency=1 برای هر حساب | `provider_state.max_concurrency` (Gemini=۱، Claude=۱) |
| Retry با backoff | `attempts`، `run_after`، backoff نمایی، تشخیص crash با lease |
| Rate limiting | `provider_state.paused_until` + بلاک مدل‌به‌مدل در `provider_state.models` |
| Result backend | `jobs.result` + `job_data` + `task_events` |

اگر روزی سرور دائمی (مثلاً Railway/Fly) اضافه شد، می‌توان همین handlerها را داخل Celery هم صدا زد؛ منطق کارها در `src/lib/queue/handlers/*` مستقل از زمان‌بند است.

## ورکفلوی تسک (state machine)

| گره‌ی ورکفلو | وضعیت‌ها |
|---|---|
| در انتظار تایید | `pending_approval`, `returned` |
| در صف پیش‌کار | `approved`, `prework_queued` |
| در حال انجام پیش‌کار | `prework_running` |
| در صف انجام کار اصلی | `prework_done`, `main_queued` |
| در حال انجام کار اصلی | `main_running`, `main_done` |
| در صف تایید برای خاتمه | `closure_pending`, `closure_rejected` |
| خاتمه یافته‌ها | `closed`, `cancelled` |

- **تسک مرتبط** (`parent_id`, `root_id`, `seq_in_root`, `relation_type`): کد به صورت `T-0007.2` ساخته می‌شود؛ در GitHub زیر همان پوشه (`iterations/02_…`)، در Gemini ادامه‌ی همان گفت‌وگو (پیام‌های قبلی از `ai_messages`) و در Claude ادامه‌ی همان جلسه (`claude_session_id` + فایل جلسه در `.claude-session/`).
- **رد خاتمه** توسط تسک‌دهنده خودکار یک تسک مرتبط از نوع `rejection` می‌سازد؛ تایید خاتمه‌ی آن، تسک اصلی را هم می‌بندد.

## پیش‌کار چندعاملی (LangGraph)

فایل: `src/lib/agents/prework.ts`

```
prepare → upload_inputs* → agent_research → wbs_outline → wbs_detail* → agent_methods* → agent_execute* → agent_report → extract_knowledge → publish
                                                (* = حلقه روی فازها/دسته‌ی فعالیت‌ها)
```

- **هر فراخوانی ورکر دقیقاً یک گره** را اجرا می‌کند: snapshot گراف از `job_data.graph` بازیابی، با `updateState(asNode)` ادامه داده و دوباره ذخیره می‌شود. این الگو محدودیت ۶۰ ثانیه‌ی Vercel را حل می‌کند.
- **خروجی نیمه‌کاره:** اگر زمان تمام شود، متن تولیدشده در `job_data.partial` ذخیره و در اجرای بعدی با «ادامه بده از همان نقطه» تکمیل می‌شود.
- **RAG پیش از هر کار:** جستجوی ترکیبی (برداری + کلیدواژه با Reciprocal Rank Fusion) در `knowledge_items` + پروفایل تسک‌دهنده.
- **فایل‌ها:** PDF/تصویر/صوت/ویدیو از طریق Gemini Files API، متن و Word به‌صورت متن، بقیه فقط در GitHub برای Claude.
- **مدل‌ها:** زنجیره‌ی قابل تنظیم؛ با `limit: 0` یا سقف روزانه مدل بعدی، با سقف دقیقه‌ای مکث کوتاه (`RateLimitError`).
- **LangChain:** `Embeddings` و `VectorStore` سفارشی (Gemini embedding + Supabase pgvector)، `RecursiveCharacterTextSplitter` برای قطعه‌بندی دانش.

## کار اصلی با Claude Code

- `src/lib/queue/handlers/main.ts`: پرامپت، دانش مرتبط (`CONTEXT-main.md`) و پیوست‌ها را در GitHub می‌گذارد و ورکفلوی `claude-task.yml` را در `ai-workspace` اجرا می‌کند.
- `workspace-template/.github/scripts/taskflow.mjs` روی runner:
  - مشخصات کار را از `/api/runner/jobs/:id` می‌گیرد،
  - Claude Code را با `--output-format stream-json` اجرا و **هر رویداد** (اجرای دستور، ایجاد/ویرایش فایل، TodoWrite، …) را به `/api/runner/events` می‌فرستد،
  - جلسه را برای ادامه در تسک‌های مرتبط ذخیره، `manifest.json` را به‌روز و نتایج را commit می‌کند،
  - پیام‌های لیمیت را تشخیص می‌دهد تا صف تا زمان ریست متوقف و سپس از همان جلسه ادامه دهد.
- کار دستی: می‌توانید مستقیماً با Claude Code (وب یا دسکتاپ) روی `ai-workspace` کار کنید؛ push‌ها از طریق `notify.yml` در لاگ همان تسک ثبت می‌شوند. از صفحه‌ی تسک هم «دستور تکمیلی به Claude» در همان پروژه ارسال می‌شود.

## graphify

پس از پیش‌کار و کار اصلی، کار `graphify` در صف Gemini قرار می‌گیرد و ورکفلوی `graphify.yml` با `graphify extract . --backend gemini` (یا `--code-only`) گراف دانش پوشه‌ی تسک را در `graphify-out/` می‌سازد. Claude طبق `CLAUDE.md` ابتدا `GRAPH_REPORT.md` را می‌خواند و از `graphify query` استفاده می‌کند. در اپ، گراف دیتا مپینگ از `manifest.json` نمایش داده می‌شود.

## پایگاه دانش و NotebookLM

- استخراج خودکار پس از پیش‌کار و کار اصلی: قطعه‌کد، ورکفلو، درس آموخته، بن‌بست، پرامپت موفق، تصمیم فنی، مرجع و «نحوه‌ی کار با تسک‌دهنده».
- ذخیره در Supabase (pgvector، ۷۶۸ بعد، `gemini-embedding-2`) + فایل Markdown در `ai-workspace/knowledge/`.
- **NotebookLM** نسخه‌ی عمومی API ندارد (فقط NotebookLM Enterprise روی Google Cloud)؛ بنابراین هر روز بسته‌ی تجمیعی در `knowledge/notebooklm/` ساخته می‌شود و از صفحه‌ی «پایگاه دانش» به صورت zip قابل دانلود است تا به‌عنوان منبع به NotebookLM اضافه شود. RAG واقعی ایجنت‌ها روی Supabase انجام می‌شود.

## خودارتقایی و یادگیری

- **ارتقا (`/upgrade`)**: پرامپت ← کار `upgrade` ← ورکفلوی `self-upgrade.yml` در مخزن `ai` ← Claude تغییر را پیاده، typecheck/build را اجرا و خطاها را خودش رفع می‌کند ← شاخه‌ی `upgrade/u-000N` و Pull Request ← پیش‌نمایش Vercel ← «انتشار» (merge با توکن مدیر) ← Vercel منتشر و `db-migrate.yml` migrationها را اعمال می‌کند. «بازگرداندن» یک commit معکوس می‌سازد.
- پیوستگی با «همین جلسه»: تزریق مستقیم پرامپت به یک جلسه‌ی چت Claude از بیرون ممکن نیست؛ به‌جای آن `CLAUDE.md` و همین سند، حافظه‌ی ماندگار پروژه‌اند و هر اجرای Claude ابتدا آن‌ها را می‌خواند.
- **یادگیری (`/learning`)**: بازخورد 👍/👎 روی خروجی هر ایجنت ← «بهینه‌ساز پرامپت» نسخه‌ی بهتر پیشنهاد می‌دهد ← شما فعال می‌کنید (نسخه‌بندی کامل در `agent_prompts`).

## امنیت

- RLS روی همه‌ی جدول‌ها؛ تسک‌دهنده فقط تسک‌ها و رویدادهای «قابل مشاهده برای تسک‌دهنده»ی خودش را می‌بیند؛ همه‌ی نوشتن‌ها از سرور و پس از بررسی نقش انجام می‌شود.
- فایل‌ها در باکت خصوصی؛ دانلود با لینک امضاشده‌ی ۲ دقیقه‌ای پس از بررسی دسترسی.
- runnerها با `TASKFLOW_RUNNER_SECRET` (مشتق از `CRON_SECRET`) احراز هویت می‌شوند؛ توکن Claude فقط در GitHub Secrets ذخیره می‌شود.
- حساب‌های جدید تا تایید مدیر غیرفعال‌اند.

## ساختار کد

```
src/
  app/(admin)/…        صفحه‌های مدیر: dashboard, inbox, tasks/[id], queue, knowledge, learning, upgrade, users, settings
  app/portal/…         پنل تسک‌دهنده
  app/(auth)/…         ورود، ثبت‌نام، انتظار تایید
  app/api/worker/tick  ورکر صف (pg_cron)
  app/api/runner/*     API ی runnerهای GitHub Actions
  app/actions/*        Server Actions
  lib/agents/prework.ts      گراف LangGraph پیش‌کار
  lib/ai/*                   Gemini، سهمیه، پرامپت‌ها، RAG، فایل‌ها، NotebookLM
  lib/claude/*               spec، نگاشت رویدادها، تشخیص لیمیت، دریافت نتایج
  lib/queue/*                صف، ورکر و handlerها
  lib/github/*               Git Data API، secrets، bootstrap
  lib/tasks/service.ts       منطق وضعیت تسک‌ها
supabase/migrations/          اسکیمای دیتابیس (هر تغییر = فایل جدید)
workspace-template/           فایل‌هایی که در مخزن ai-workspace کپی می‌شوند
.github/workflows/            self-upgrade و db-migrate
```
