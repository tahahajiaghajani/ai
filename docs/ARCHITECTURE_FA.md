# معماری TaskFlow AI (چندکاربره)

## نمای کلی

```
                   ┌───────────────────────────── Vercel (Next.js 16) ─────────────────────────────┐
 همه‌ی کاربران ─►  │  حالت ساده (/portal)            حالت کامل (/dashboard، /inbox، /projects، …)   │
 (موبایل/دسکتاپ)  │        │ Server Actions                  │  Supabase Realtime (زنده)              │
                   │        ▼                                 ▼                                         │
                   │  سرویس تسک‌ها ─► صف کارها (jobs، با lane) ◄─ /api/worker/tick ◄─ pg_cron (۳۰ث)   │
                   │                          │  هر اجرا تا ~۲۴۰ثانیه، گام‌به‌گام و قابل ادامه       │
                   │                          ├─► اتصال‌های هر کاربر: Claude / Gemini / OpenAI-سازگار  │
                   │                          └─► GitHub Actions مخزن هر کاربر (Claude Code، graphify) │
                   │  /api/runner/*  ◄── رویدادها و نتیجه، با توکن مخصوص هر کاربر                     │
                   └───────────────────────────────────────────────────────────────────────────────┘
                         │
     Supabase (Postgres + Auth + Storage + Realtime + pg_cron + pg_net) — مشترک، با RLS
                         │
     GitHub هر کاربر: <user>/taskflow-workspace (projects/، tasks/، ورکفلوها)   ·   مخزن اپ (فقط مالک، ارتقا)
```

- **یک اپ، یک دیتابیس، چند کاربر.** هیچ کاربری چیزی نصب نمی‌کند؛ هر کاربر کلیدهای هوش مصنوعی و GitHub خودش را داخل اپ وصل می‌کند.
- **نقش‌ها:** `owner` (مالک: سیستم، کاربران، ارتقا، نظارت بر همه) و `member`. **حالت‌ها:** `simple` / `full` روی `profiles.mode`؛ مالک همیشه کامل.
- **قابلیت‌ها** (`src/lib/capabilities.ts`): بر اساس اتصال‌های کاربر — بدون کلید: فقط حالت ساده؛ کلید بدون GitHub: پیش‌کار و کار اصلی (خروجی در Storage)؛ با GitHub: پروژه‌ها، دانش، گراف و Claude Code.

## داده‌ها (migration `20261003000000_multi_tenant.sql`)

| جدول | نقش |
|---|---|
| `profiles` | `role` (owner/member)، `mode` (simple/full) |
| `tasks` | `requester_id` (تسک‌دهنده)، **`assignee_id` (مسئول)**، `project_id`؛ وضعیت دستی `in_progress` برای حالت ساده |
| `user_connections` | اتصال‌های هر کاربر (`kind` ai/github، `provider`، `base_url`، `secret_enc` رمزنگاری AES-256-GCM، `config`: مدل‌ها، جایگزین‌ها، مخزن، Claude Code) — بدون policy خواندن؛ فقط سرور |
| `connection_state` | توقف هر اتصال (لیمیت/دستی) و بلاک مدل‌به‌مدل — Realtime |
| `user_settings` | تنظیمات، ایجنت‌ها و ورکفلوهای هر کاربر (`config`، `agents`، `workflows`) |
| `agent_prompts` | نسخه‌های پرامپت هر ایجنت **برای هر کاربر** (`user_id`) |
| `projects`، `project_files` | پروژه‌ها و نقشه‌ی فایل‌ها (مسیر، اندازه، sha، نوع، خلاصه، نمادها، importها) — فایل‌ها خودشان در GitHub |
| `jobs` | `owner_id`، `connection_id`، `project_id`، `lane` (llm/external/system) |
| `worker_lanes` | ظرفیت هر lane: `max_running` (همه) و `per_owner` (هر کاربر) |
| `app_settings` | فقط تنظیمات سیستمی مالک (`system`: ثبت‌نام خودکار، ادغام خودکار ارتقا) |

**RLS:** هر کاربر فقط تسک‌هایی که داده یا به او سپرده شده، کارها، اتصال‌ها (وضعیت)، پروژه‌ها و تنظیمات خودش را می‌خواند؛ مالک همه را. همه‌ی نوشتن‌ها با service role در Server Actionها، بعد از `assertActive/assertFull/assertOwner`.
**Realtime:** `tasks`, `task_events`, `jobs`, `notifications`, `upgrades`, `connection_state`.

## صف منصفانه‌ی چندکاربره

- `claim_job(p_lane, …)` با advisory lock: کار با بیشترین اولویت و قدیمی‌ترین heartbeat را برمی‌دارد، به شرطی که lane متوقف نباشد، سقف `max_running` و `per_owner` پر نشده باشد و **اتصال آن کار متوقف نباشد**. لیمیت یک کاربر هیچ‌وقت صف بقیه را نگه نمی‌دارد.
- `runTick` چند حلقه را موازی اجرا می‌کند (external، system و ۳ حلقه‌ی llm) و تا وقتی کار هست خودش را دوباره صدا می‌زند (`after()` + زنجیره).
- خطاها: `RateLimitError` (اتصال یا مدل، با زمان ادامه)، `DeadlineError` (ادامه در اجرای بعد)، `TransientError` (تلاش دوباره)، `FatalError` (شکست فوری با پیام روشن).

## لایه‌ی چند‌ارائه‌دهنده‌ی LLM (`src/lib/ai/llm/`)

سه پروتکل همه‌ی سرویس‌ها را پوشش می‌دهند (`providers.ts`):

| آداپتر | سرویس‌ها | نکته‌ها |
|---|---|---|
| `google.ts` (`@google/genai`) | Google AI Studio | مدل `auto` = جدیدترین Flashهای رایگان؛ thought signature حفظ می‌شود (برای فراخوانی بدون امضا، placeholder مستند گوگل) |
| `anthropic.ts` (SDK رسمی) | Claude | thinking تطبیقی، effort، خروجی ساخت‌یافته، استریم ابزار |
| `openai.ts` (fetch + SSE) | OpenAI، Kimi، NVIDIA، OpenRouter، سفارشی | `max_completion_tokens`/`max_tokens`، `reasoning_content`، `extra_content` (امضای Gemini) |

- انواع خنثی `Block`/`LlmMessage` با `raw` (محتوای اصلی هر ارائه‌دهنده برای بازپخش دقیق).
- `generate`/`generateJson`: زنجیره‌ی مدل‌ها با جایگزینی، ادامه‌ی خروجی نیمه‌کاره، حذف رسانه برای مدل‌های متنی، دسته‌بندی خطاها (دقیقه‌ای/روزانه/بی‌اعتبار/شلوغ).
- `runAgent` (`agent.ts`): حلقه‌ی ابزار قابل ادامه بین اجراها، تاریخچه‌ی فقط-افزودنی، فشرده‌سازی نتایج قدیمی فقط برای پروتکل OpenAI.

## موتور ورکفلو (`src/lib/workflow/`)

- **ایجنت‌ها** (هر کاربر جدا): `llm` (متن یا چند فایل، با/بدون ابزار خواندن پروژه)، `router` (شرط بله/خیر)، `coder` (مجری: داخل اپ یا Claude Code). **ورکفلو** = DAG برای `prework` یا `main`.
- **مراحل هر اجرا:** `prepare` → `inputs` → `run` → `publish`؛ وضعیت در `job_data.graph`، هر اجرای ورکر یک گام.
- **ورودی مدل فقط پرامپت و فایل‌های جدید** همان ارسال است (عنوان و شرح تسک فرستاده نمی‌شود)، به‌علاوه‌ی تاریخچه‌ی همان تسک و — اگر پروژه انتخاب شده — توضیح، دانش، نقشه‌ی فایل‌ها و فایل‌های انتخاب‌شده.
- **تشخیص از متن:** `mentionedProject` (دستور سریع) و `mentionedFiles` (در `prepare`) پروژه و فایل‌های نام‌برده در پرامپت را پیدا می‌کنند.
- **مجری داخل اپ:** ابزارهای `list_files`، `search_code`، `read_file`، `write_file`، `append_file`، `edit_file`، `delete_file`، `finish` روی `WorkFS` (خواندن از GitHub، تغییرات staged و در `publish` یک commit).
- **Claude Code:** گام `coder` با موتور `claude_code` در GitHub Actions مخزن کاربر اجرا می‌شود (`external` lane)؛ runner با توکن `u.<userId>.<hmac>` فقط به کارهای همان کاربر دسترسی دارد.
- **publish:** سوابق (`PROMPT.md`، خروجی‌ها، `REPLY.md`، `manifest.json` با اسکیمای `taskflow.task/v2`)، فایل‌های پروژه، به‌روزرسانی نقشه‌ی فایل‌ها، صف «دانش پروژه» و graphify. بدون GitHub، خروجی‌ها در Supabase Storage (`<owner>/outputs/<task>/<job>/…`).

## پروژه‌ها و دانش (`src/lib/projects/`)

```
projects/<slug>/                 فایل‌های پروژه — کامل، بدون تکه‌تکه شدن
projects/<slug>/.taskflow/
  PROJECT.md   KNOWLEDGE.md   INDEX.md   graph/   tasks/<code>/runs/NN-stage/
tasks/<code>_<slug>/             سوابق تسک‌های بدون پروژه
```

- **ورود:** فایل‌ها، پوشه، zip (fflate) یا zipball یک مخزن GitHub؛ commitهای حداکثر ۶MB با cursor (قابل ادامه)؛ پوشه‌های build/وابستگی کنار گذاشته می‌شوند.
- **نقشه:** `project_files` با نمادها و importها (استخراج regex) و خلاصه‌ی هر فایل (کار `index`).
- **دانش:** یک فایل واحد `KNOWLEDGE.md` که بعد از هر کار با کار `knowledge` بازنویسی و تکمیل می‌شود (بدون قطعه‌قطعه کردن و بدون پایگاه برداری).
- **graphify vs archify:** graphify حفظ شد (کد + اسناد، با کلید Gemini کاربر یا فقط کد)؛ archify ابزار رسم دیاگرام است و نقشه‌ی دانش نمی‌سازد، پس استفاده نشد.

## GitHub هر کاربر (`src/lib/github/`)

- `connectGithub`: بررسی توکن، ساخت مخزن خصوصی (پیش‌فرض `taskflow-workspace`)، کپی قالب (`workspace-template/` که با `npm run template` در `template.generated.ts` بسته‌بندی می‌شود — پس توکن کاربر هرگز به مخزن اپ مالک نیاز ندارد) و secrets (`TASKFLOW_RUNNER_SECRET`، `TASKFLOW_APP_URL`؛ در صورت نیاز `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` و `GEMINI_API_KEY` برای graphify).
- مخزن اپ (`GITHUB_TOKEN` مالک) فقط برای «ارتقای اپلیکیشن» استفاده می‌شود.

## وضعیت تسک‌ها

| گره | وضعیت‌ها |
|---|---|
| منتظر پذیرش | `pending_approval`, `returned` |
| صف پیش‌کار | `approved`, `prework_queued` |
| پیش‌کار | `prework_running` |
| صف کار اصلی | `prework_done`, `main_queued` |
| کار اصلی | `main_running`, `main_done`, `in_progress` (دستی) |
| تایید خاتمه | `closure_pending`, `closure_rejected` |
| خاتمه | `closed`, `cancelled` |

- مسئول تسک را می‌پذیرد/برمی‌گرداند و (در حالت کامل) به هوش مصنوعی می‌فرستد؛ تسک‌دهنده خاتمه را تایید یا رد می‌کند. تسکی که کسی به خودش بدهد بدون پذیرش شروع و با «خاتمه» بسته می‌شود.
- **تسک مرتبط** (`parent_id`, `root_id`): ادامه‌ی همان پوشه‌ی سوابق، همان تاریخچه و همان جلسه‌ی Claude.

## امنیت

- کلیدها: AES-256-GCM با `APP_SECRET_KEY` (`src/lib/crypto.ts`)، هرگز به مرورگر فرستاده نمی‌شوند.
- runnerها: توکن HMAC مخصوص هر کاربر؛ runner مخزن اپ فقط کارهای `upgrade`.
- فایل‌ها (`/api/files/[id]`): مسئول و مالک همه‌ی فایل‌های تسک؛ تسک‌دهنده فایل‌های درخواست و خروجی.
