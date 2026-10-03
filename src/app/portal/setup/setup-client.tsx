"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Blocks, Bot, CheckCircle2, ChevronLeft, Circle, FolderGit2, Rocket, Sparkles } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { setModeAction } from "@/app/actions/settings";
import { cn } from "@/lib/utils";

const FEATURES = [
  { icon: Sparkles, title: "پیش‌کار", text: "تحلیل و آماده‌سازی خودکار" },
  { icon: Bot, title: "کار اصلی", text: "ویرایش و ساخت فایل‌ها" },
  { icon: FolderGit2, title: "پروژه‌ها", text: "کد و سند در GitHub خودتان" },
  { icon: Blocks, title: "ایجنت‌ها", text: "ورکفلوی شخصی شما" },
];

/** «آیا تجربه‌ی کامل اپلیکیشن را می‌خواهید؟» — what it adds and a checklist to get there. */
export function SetupClient({ mode, done }: { mode: "simple" | "full"; done: { ai: boolean; github: boolean; claude: boolean } }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const full = mode === "full";

  const activate = async () => {
    setBusy(true);
    const r = await setModeAction("full");
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("تجربه‌ی کامل فعال شد");
    router.push("/settings");
    router.refresh();
  };

  const steps = [
    { ok: full, title: "فعال‌سازی", text: "برگشت به حالت ساده همیشه ممکن است", href: null },
    { ok: done.ai, title: "کلید هوش مصنوعی", text: "Claude، Gemini، ChatGPT و…", href: "/settings#connections" },
    { ok: done.github, title: "GitHub", text: "برای پروژه‌ها", href: "/settings#github" },
    { ok: done.claude, title: "Claude Code", text: "اختیاری", href: "/settings#github", optional: true },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card className="p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-gradient-brand text-white shadow-[0_8px_24px_-10px_var(--brand)]">
          <Rocket className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-black sm:text-[28px]">تجربه‌ی کامل</h1>
        <p className="mt-2 text-[15px] leading-7 text-muted">تسک‌ها را با هوش مصنوعی و GitHub خودتان انجام دهید.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-line p-3">
              <Icon className="size-5 text-primary" />
              <p className="mt-2 text-sm font-extrabold">{title}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{text}</p>
            </div>
          ))}
        </div>
        {!full ? (
          <Button size="lg" className="mt-6" loading={busy} onClick={() => void activate()}>
            <Rocket className="size-5" /> فعال کن
          </Button>
        ) : null}
      </Card>

      <Card className="divide-y divide-line overflow-hidden">
        {steps.map((s) => {
          const body = (
            <>
              {s.ok ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className={cn("size-5 shrink-0", s.optional ? "text-faint" : "text-muted")} />}
              <span className="min-w-0 flex-1">
                <b className="block text-sm">{s.title}</b>
                <span className="block text-xs text-muted">{s.text}</span>
              </span>
              {s.href && full && !s.ok ? <ChevronLeft className="size-5 text-faint" /> : null}
            </>
          );
          return s.href && full && !s.ok ? (
            <Link key={s.title} href={s.href} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-surface-muted">
              {body}
            </Link>
          ) : (
            <div key={s.title} className="flex items-center gap-3 px-5 py-3.5">
              {body}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
