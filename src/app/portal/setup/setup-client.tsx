"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, BookOpen, Brain, CheckCircle2, Circle, ExternalLink, FolderGit2, KeyRound, Network, Rocket, Smartphone, Sparkles } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { setModeAction } from "@/app/actions/settings";
import { cn } from "@/lib/utils";

const FEATURES = [
  { icon: Sparkles, title: "پیش‌کار با هوش مصنوعی", text: "پرامپت و فایل‌هایتان را بدهید؛ ایجنت‌ها درخواست را می‌فهمند و دستور کار کامل آماده می‌کنند." },
  { icon: Bot, title: "کار اصلی خودکار", text: "مجری فایل‌های مرتبط پروژه را پیدا، ویرایش، ایجاد و جایگزین می‌کند — داخل اپ یا با Claude Code." },
  { icon: FolderGit2, title: "پروژه‌های کد و سند", text: "فایل‌ها، پوشه‌ها، zip یا یک مخزن GitHub (مثلاً اپ Google AI Studio) را وارد کنید؛ کامل و بدون تکه‌تکه شدن." },
  { icon: Brain, title: "دانش و گراف هر پروژه", text: "یک فایل دانش که بعد از هر کار به‌روز می‌شود و گراف فایل‌ها، کدها و مفاهیم." },
  { icon: Smartphone, title: "از موبایل", text: "«در پروژه renew فایل audit.cs باگ دارد» را بنویسید؛ پروژه و فایل خودکار پیدا و درست می‌شود." },
  { icon: Network, title: "ایجنت‌ها و ورکفلوهای شخصی", text: "ورکفلو و پرامپت‌های خودتان را بسازید و نسخه‌بندی کنید." },
];

export function SetupClient({ mode, guideUrl, done }: { mode: "simple" | "full"; guideUrl: string | null; done: { ai: boolean; github: boolean; claude: boolean } }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const activate = async () => {
    setBusy(true);
    const r = await setModeAction("full");
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("تجربه‌ی کامل فعال شد؛ حالا کلیدهایتان را وصل کنید");
    router.push("/settings");
    router.refresh();
  };

  const steps = [
    {
      ok: mode === "full",
      title: "فعال کردن حالت کامل",
      text: "با یک کلیک؛ هر زمان از «تنظیمات ← حالت اپ» به حالت ساده برمی‌گردید و چیزی پاک نمی‌شود.",
    },
    {
      ok: done.ai,
      title: "وصل کردن کلید هوش مصنوعی (لازم برای پیش‌کار و کار اصلی)",
      text: "در «تنظیمات ← کلیدهای هوش مصنوعی» یکی از این‌ها را اضافه کنید: Claude (بهترین کیفیت)، Google AI Studio یا NVIDIA (رایگان)، ChatGPT، Kimi یا OpenRouter. برای هر مرحله می‌توانید کلید و مدل جدا انتخاب کنید.",
    },
    {
      ok: done.github,
      title: "وصل کردن GitHub (برای پروژه‌ها، دانش و گراف)",
      text: "یک توکن GitHub با دسترسی repo و workflow بسازید و در «تنظیمات ← GitHub» وارد کنید. اپ خودش یک مخزن خصوصی در حساب شما می‌سازد و فایل‌های لازم را در آن می‌گذارد؛ نیازی به کپی کردن مخزن دیگری نیست.",
    },
    {
      ok: done.claude,
      optional: true,
      title: "(اختیاری) Claude Code روی GitHub Actions",
      text: "اگر اشتراک Claude دارید، با دستور claude setup-token توکن بسازید و در همان بخش GitHub وارد کنید تا کار اصلی با Claude Code در مخزن خودتان اجرا شود.",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div className="absolute -left-20 -top-20 size-72 rounded-full bg-gradient-brand opacity-15 blur-3xl" />
        <p className="flex items-center gap-2 text-sm font-bold text-primary">
          <Rocket className="size-5" /> تجربه‌ی کامل اپلیکیشن
        </p>
        <h1 className="mt-2 text-2xl font-black leading-10 sm:text-3xl">آیا تجربه‌ی کامل اپلیکیشن را می‌خواهید؟</h1>
        <p className="mt-2 text-sm leading-7 text-muted">
          در حالت ساده فقط تسک می‌دهید و وضعیت تسک‌های خودتان را دستی به‌روز می‌کنید. در حالت کامل، همان تسک‌ها را با کلیدهای هوش مصنوعی و مخزن GitHub <b className="text-fg">خودتان</b> انجام می‌دهید. نصب جداگانه‌ای لازم نیست:
          همین اپ است و هر بخشی که اتصالش را نداشته باشید فقط غیرفعال می‌ماند.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {mode === "full" ? (
            <Link href="/settings">
              <Button size="lg">
                <KeyRound className="size-5" /> رفتن به تنظیمات و اتصال‌ها
              </Button>
            </Link>
          ) : (
            <Button size="lg" loading={busy} onClick={() => void activate()}>
              <Rocket className="size-5" /> بله، فعال کن
            </Button>
          )}
          {guideUrl ? (
            <a href={guideUrl} target="_blank" rel="noreferrer">
              <Button size="lg" variant="secondary">
                <BookOpen className="size-5" /> راهنمای کامل <ExternalLink className="size-4" />
              </Button>
            </a>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="flex gap-3 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
              <Icon className="size-5" />
            </span>
            <div>
              <p className="font-extrabold">{title}</p>
              <p className="mt-1 text-xs leading-6 text-muted">{text}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-black">راه‌اندازی در ۴ قدم</h2>
        <ol className="mt-4 space-y-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              {s.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : <Circle className={cn("mt-0.5 size-5 shrink-0", s.optional ? "text-faint" : "text-muted")} />}
              <div>
                <p className="text-sm font-extrabold">
                  {i + 1}. {s.title}
                </p>
                <p className="mt-1 text-xs leading-6 text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-5 rounded-xl bg-surface-muted p-3 text-xs leading-6 text-muted">
          <b className="text-fg">بدون کلید هوش مصنوعی:</b> بخش‌های هوش مصنوعی غیرفعال‌اند و مثل حالت ساده کار می‌کنید. <b className="text-fg">با کلید ولی بدون GitHub:</b> پیش‌کار و کار اصلی کار می‌کنند (خروجی‌ها در
          گفت‌وگوی تسک قابل دانلودند)، فقط پروژه‌ها، دانش و گراف غیرفعال‌اند. کلیدها رمزنگاری‌شده ذخیره می‌شوند و فقط برای کارهای خودتان استفاده می‌شوند.
        </div>
      </Card>
    </div>
  );
}
