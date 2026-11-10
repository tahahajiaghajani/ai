# کاریز · Kariz

<p align="center">
  <img src="docs/brand/logo/kariz-lockup-fa.svg" alt="کاریز" height="56" /><br />
  <b>مدیریت هوشمند خدمات سازمان</b><br />
  <sub>سامانهٔ سازمانی مدیریت خدمات فناوری اطلاعات و خدمات سازمانی با هوش مصنوعی · نسخهٔ وب (Vercel + Supabase) و برنامهٔ ویندوز (بی‌اینترنت، با یک فایل نصب)، هم‌گام با هم.</sub>
</p>

<p align="center">
  <a href="https://github.com/tahahajiaghajani/ai/releases"><b>دریافت برای ویندوز</b></a>
  &nbsp;·&nbsp; <a href="docs/SETUP_FA.md">راه‌اندازی</a>
  &nbsp;·&nbsp; <a href="docs/DESKTOP_FA.md">نسخهٔ ویندوز</a>
  &nbsp;·&nbsp; <a href="docs/AI_FA.md">هوش مصنوعی</a>
  &nbsp;·&nbsp; <a href="docs/ARCHITECTURE_FA.md">معماری</a>
</p>

---

> **نام و برند.** «کاریز» (Kariz) — قناتی که سه هزار سال آب را بی‌صدا، پیوسته و به‌اندازه به شهر رسانده است؛ کتاب برند: [`docs/BRAND_FA.md`](docs/BRAND_FA.md)، سامانهٔ طراحی: [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). نام فقط در `src/shared/constants.ts` (`APP_NAME`، `APP_NAME_EN`، `APP_TAGLINE`…) تعریف شده و همه‌جا از همان خوانده می‌شود؛ شناسه‌های داخلی (`sm_*`، `itsm.*`، `ITSM_*`، `itsm:*`، پوشهٔ `%APPDATA%\ITSM`) عمداً بی‌نام مانده‌اند.

این پوشه پروژه‌ای **مستقل** در همین مخزن است: `package.json` و lockfile خودش، پروژهٔ Vercel خودش (Root Directory: `itsm`)، پروژهٔ Supabase خودش و فایل نصب ویندوز خودش. هیچ کد، جدول یا تنظیمی با پروژه‌های دیگر مخزن مشترک نیست.

## این نسخه چه دارد

آنچه نسخهٔ ۱٫۱ بتا و ۱٫۰ دارند، سه نسخهٔ نصب و محدودیت‌های شناخته‌شده در [`docs/RELEASE_FA.md`](docs/RELEASE_FA.md) آمده است؛ فهرست کامل قابلیت‌ها در [`docs/FEATURES_FA.md`](docs/FEATURES_FA.md). بنیان سکو، که ماژول‌های مدیریت خدمات (درخواست و رخداد، مشکل، تغییر، کاتالوگ خدمات، پایگاه دانش، دارایی‌ها و CMDB، سطح خدمات…) روی آن ساخته شده‌اند:

- **راه‌اندازی نخستین اجرا، ثبت‌نام، ورود و بازیابی رمز** با کد بازیابی؛ نشست‌های امن، خروج از همهٔ دستگاه‌ها.
- **سازمان‌ها** با ویزارد ساده (نام و منطقهٔ زمانی)، **اعضا و نقش‌ها** (مالک، مدیر، عضو، ناظر) و دسترسی بخش‌به‌بخش، تنظیمات سازمان و «گزارش رویدادها».
- **هوش مصنوعی** با کلید خود هر سازمان یا مدل محلی: اتصال‌ها، کارها و زنجیرهٔ مدل‌ها، حریم خصوصی، مصرف و بودجه، فعالیت؛ و **«دستیار»** در همهٔ صفحه‌ها با ابزارهای عمومی (من کیستم و چه دسترسی دارم، سازمان من، امروز، اعضا، ماشین‌حساب دقیق، نمودار). هر نوشتنی فقط پیش‌نویسی است که شخص مجاز تأییدش می‌کند. راهنما: [docs/AI_FA.md](docs/AI_FA.md).
- **اتصال‌ها و API**: وب‌هوک‌های امضاشده از سامانه‌های دیگر (پایش، فرم‌ها، ابزارهای گفت‌وگو) و کلیدهای API برای برنامه‌های دیگر.
- **مدیریت سامانه** (کنسول مالک سکو): پیشخوان، سازمان‌ها و وضعیتشان، کاربران، هوش مصنوعی، رویدادهای امنیتی، سلامت سامانه و «حالت پشتیبانی» زمان‌دار و ثبت‌شده.
- **برنامهٔ ویندوز** با PostgreSQL داخلی که بی‌اینترنت کار می‌کند، با نسخهٔ وب **هم‌گام** می‌ماند، پشتیبان خودکار می‌گیرد و می‌تواند سرور شبکهٔ داخلی یک دفتر باشد. راهنما: [docs/DESKTOP_FA.md](docs/DESKTOP_FA.md).
- **سامانهٔ طراحی** فارسی و راست‌چین (`src/ui/ds`) با تم روشن و تیره، چیدمان گوشی و ماژول‌پذیری (`src/ui/modules/registry.tsx`).

## نشانی‌ها

| چه | کجا |
|---|---|
| راه‌اندازی کامل: Supabase، Vercel، نسخهٔ ویندوز | [`docs/SETUP_FA.md`](docs/SETUP_FA.md) |
| معماری و قواعد داده | [`docs/ARCHITECTURE_FA.md`](docs/ARCHITECTURE_FA.md) |
| هوش مصنوعی و اتصال‌های رایگان و محلی | [`docs/AI_FA.md`](docs/AI_FA.md) |
| یادداشت انتشار: آنچه این نسخه دارد، سه نسخهٔ نصب، محدودیت‌ها | [`docs/RELEASE_FA.md`](docs/RELEASE_FA.md) |
| نسخهٔ ویندوز | [`docs/DESKTOP_FA.md`](docs/DESKTOP_FA.md) |
| نسخهٔ سرور: نصب MSI روی ویندوز سرور در شبکهٔ بسته، پشتیبان‌گیری، ارتقا | [`docs/SERVER_FA.md`](docs/SERVER_FA.md) |
| ورود با Active Directory و ورود خودکار ویندوز (SSO) | [`docs/AD_FA.md`](docs/AD_FA.md) |
| کارایی در مقیاس بانک: آزمون بار، اندازهٔ سرور، تنظیم PostgreSQL | [`docs/PERFORMANCE_FA.md`](docs/PERFORMANCE_FA.md) |
| دادهٔ نمایشی «بانک نمونهٔ آفتاب»: بارگذاری با یک کلیک، سناریوی نمایش، حذف بی‌ردپا | [`docs/DEMO_FA.md`](docs/DEMO_FA.md) |
| دارایی‌ها در تراز بانک: اموال شعبه‌ها، ناوگان خودپرداز، حواله و زنجیرهٔ نگهداری، دفتر اموال | [`docs/modules/itam_FA.md`](docs/modules/itam_FA.md) |
| وارسی کلیک‌به‌کلیک همهٔ صفحه‌ها (گزارش QA) | [`docs/qa/CLICKTHROUGH.md`](docs/qa/CLICKTHROUGH.md) |
| کتاب برند «کاریز»: داستان، نام، نشانه، رنگ، لحن | [`docs/BRAND_FA.md`](docs/BRAND_FA.md) |
| سامانهٔ طراحی (راهنمای مهندسان): توکن‌ها، اجزا، ساختن صفحه | [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) و [`src/ui/ds/README.md`](src/ui/ds/README.md) |
| پایگاه دادهٔ کامل برای Supabase | [`supabase/schema.sql`](supabase/schema.sql) |
| فایل نصب ویندوز | صفحهٔ [**Releases**](https://github.com/tahahajiaghajani/ai/releases): `itsm-vX.Y.Z` (شاخهٔ `main`) یا `itsm-preview-<شاخه>` (پیش‌نمایش هر شاخه) ← `Kariz-Setup-x.y.z.exe` |
| CI و ساخت فایل نصب | [`.github/workflows/itsm.yml`](../.github/workflows/itsm.yml) |

## ساختار

```
itsm/
├─ src/shared     منطق مشترک: نام و ثابت‌ها، تقویم شمسی، اعداد دقیق، اعتبارسنجی، تعریف داده‌ها، دسترسی‌ها، قراردادهای هوش مصنوعی
├─ src/server     API (Hono): احراز هویت، سازمان‌ها و اعضا، مدیریت سامانه، هوش مصنوعی، اتصال‌ها، همگام‌سازی، migrationها
├─ src/ui         رابط کاربری (React 19 + Ant Design 6 + Tailwind 4، Vite)، سامانهٔ طراحی (src/ui/ds) و ماژول‌ها (src/ui/modules)
├─ src/desktop    سرور محلی نسخهٔ ویندوز (PGlite)، همگام‌سازی با ابر، پشتیبان‌گیری
├─ app/api        میزبانی API روی Vercel (Next.js)
├─ desktop        Electron، صفحهٔ آغاز، تصویرها و فایل نصب NSIS
├─ supabase       schema.sql و migrationها (با npm run schema ساخته می‌شوند)
├─ scripts        ساخت نسخهٔ ویندوز، تولید schema، سرور محلی، عکس صفحه‌ها
├─ tests          آزمون‌ها (هسته، دسترسی‌ها، همگام‌سازی دوطرفه، هوش مصنوعی، PostgreSQL واقعی) با یک ماژول آزمایشی
└─ docs           راهنماها
```

## فرمان‌ها

```bash
npm ci
npm run typecheck && npm test && npm run check:schema && npm run build   # build بدون هیچ متغیر محیطی
npm run build:ui && npm run start:local          # نسخهٔ «ویندوزی» بدون Electron روی http://127.0.0.1:3939
npm run schema                                   # به‌روزرسانی supabase/schema.sql پس از تغییر migrationها
node scripts/ui-shots.mjs                        # عکس همهٔ صفحه‌ها در تم روشن و تیره و گوشی، با گزارش خطا
(cd desktop && npm ci) && node scripts/build-desktop.mjs && (cd desktop && npx electron-builder --win nsis --x64)   # فایل نصب
```
