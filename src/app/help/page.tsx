import { Bot, Check, FolderGit2, KeyRound, Lock, Play, Plus, Flag, Sparkles, Workflow } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Card } from "@/components/ui/primitives";
import { PageHeader } from "@/components/shell/page-header";
import { Signature, Wordmark } from "@/components/shell/logo";
import { RELEASES } from "@/lib/changelog";
import { formatJalali } from "@/lib/jalali";
import { faNum } from "@/lib/utils";
import { MarkReleaseSeen } from "./seen";

export const metadata = { title: "راهنما" };

const TABS = [
  { href: "/help", label: "شروع" },
  { href: "/help?tab=how", label: "چطور کار می‌کند" },
  { href: "/help?tab=news", label: "تازه‌ها" },
];

function Steps({ title, steps }: { title?: string; steps: { icon: React.ReactNode; title: string; text: string }[] }) {
  return (
    <section className="space-y-3">
      {title ? <h2 className="text-sm font-extrabold text-muted">{title}</h2> : null}
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Card className="flex h-full items-start gap-3 p-4">
              <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                {s.icon}
                <span className="absolute -top-1.5 -left-1.5 grid size-5 place-items-center rounded-full bg-ink text-[10.5px] font-bold text-white ring-2 ring-[var(--surface-strong)] dark:bg-brand">{faNum(i + 1)}</span>
              </span>
              <span>
                <b className="block text-[15px]">{s.title}</b>
                <span className="mt-0.5 block text-[13px] leading-6 text-muted">{s.text}</span>
              </span>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

const FLOW = [
  { label: "تسک", color: "var(--stage-approval)" },
  { label: "پذیرش", color: "var(--stage-approval)" },
  { label: "پیش‌کار", color: "var(--stage-prework)" },
  { label: "کار اصلی", color: "var(--stage-main)" },
  { label: "خاتمه", color: "var(--stage-closed)" },
];

/** One place for how to use the app, how it works and what is new. */
export default async function HelpPage(props: PageProps<"/help">) {
  const me = await requireUser();
  const { tab } = await props.searchParams;
  const full = me.mode === "full";
  const icon = "size-5";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <MarkReleaseSeen />
      <PageHeader title="راهنما" tabs={TABS} />

      {tab === "how" ? (
        <div className="space-y-5">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1" dir="rtl">
              {FLOW.map((f, i) => (
                <div key={f.label} className="flex shrink-0 items-center gap-1.5">
                  <span className="flex items-center gap-2 rounded-full border border-line bg-surface-muted px-3.5 py-2 text-sm font-bold">
                    <span className="size-2.5 rounded-full" style={{ background: f.color }} />
                    {f.label}
                  </span>
                  {i < FLOW.length - 1 ? <span className="h-0.5 w-6 rounded-full bg-flow opacity-70" /> : null}
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-7 text-muted">پیش‌کار و کار اصلی فقط در حالت کامل و با هوش مصنوعی انجام می‌شوند؛ در حالت ساده، مسئول وضعیت را خودش به‌روز می‌کند.</p>
          </Card>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { icon: <Workflow className={icon} />, title: "دو حالت", text: "ساده: تسک‌دهی و پیگیری. کامل: هوش مصنوعی، پروژه‌ها و ایجنت‌ها." },
              { icon: <KeyRound className={icon} />, title: "کلیدهای خودتان", text: "هر کاربر کلید هوش مصنوعی و GitHub خودش را وصل می‌کند." },
              { icon: <Lock className={icon} />, title: "حریم خصوصی", text: "کلیدها رمزنگاری می‌شوند؛ به مدل فقط پرامپت و فایل‌های همان ارسال می‌رود." },
            ].map((c) => (
              <Card key={c.title} className="p-4">
                <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">{c.icon}</span>
                <b className="mt-3 block">{c.title}</b>
                <p className="mt-1 text-[13px] leading-6 text-muted">{c.text}</p>
              </Card>
            ))}
          </div>
        </div>
      ) : tab === "news" ? (
        <ol className="relative space-y-4 ps-6">
          <span className="absolute inset-y-2 right-[7px] w-0.5 rounded-full bg-line" />
          {RELEASES.map((r, i) => (
            <li key={r.id} className="relative">
              <span className={i === 0 ? "absolute -right-6 top-5 size-4 rounded-full bg-flow ring-4 ring-[var(--bg)]" : "absolute -right-[22px] top-5 size-3 rounded-full bg-line-strong ring-4 ring-[var(--bg)]"} />
              <Card className="p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <b className="text-[15px]">{r.title}</b>
                  <span className="text-xs text-faint">{formatJalali(r.date)}</span>
                </div>
                <ul className="mt-2 space-y-1 text-[13.5px] leading-7 text-muted">
                  {r.items.map((it) => (
                    <li key={it} className="flex items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" /> {it}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-6">
          <Steps
            steps={[
              { icon: <Plus className={icon} />, title: "تسک جدید", text: "عنوان، مسئول و مهلت" },
              { icon: <Check className={icon} />, title: "پذیرش", text: "مسئول تسک را می‌پذیرد" },
              { icon: <Play className={icon} />, title: "انجام", text: "پیشرفت را زنده می‌بینید" },
              { icon: <Flag className={icon} />, title: "خاتمه", text: "تسک‌دهنده تایید می‌کند" },
            ]}
          />
          {full ? (
            <Steps
              title="با هوش مصنوعی"
              steps={[
                { icon: <KeyRound className={icon} />, title: "اتصال کلید", text: "تنظیمات ← کلیدها" },
                { icon: <Sparkles className={icon} />, title: "پیش‌کار", text: "تحلیل و آماده‌سازی" },
                { icon: <Bot className={icon} />, title: "کار اصلی", text: "مدل داخل اپ یا Claude Code" },
                { icon: <FolderGit2 className={icon} />, title: "پروژه‌ها", text: "فایل‌ها در GitHub خودتان" },
              ]}
            />
          ) : null}
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5 pt-6">
        <Wordmark className="text-lg" />
        <Signature />
      </div>
    </div>
  );
}
