import { Brand } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/shell-parts";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-y relative grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-gradient-brand opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(40rem_30rem_at_80%_20%,rgba(255,255,255,0.25),transparent)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3 text-xl font-black">TaskFlow AI</div>
          <div className="space-y-6">
            <h2 className="text-4xl font-black leading-[1.5]">
              از ثبت تسک تا تحویل نهایی،
              <br />
              خودکار و زنده.
            </h2>
            <ul className="space-y-3 text-[15px] leading-8 text-white/90">
              <li>● ثبت و پیگیری تسک با وضعیت و درصد پیشرفت زنده</li>
              <li>● پیش‌کار چندعاملی با Gemini: تحقیق، WBS و انجام کارهای ساده</li>
              <li>● تکمیل کار با Claude Code و ذخیره‌ی خروجی در GitHub</li>
              <li>● پایگاه دانشی که با هر تسک هوشمندتر می‌شود</li>
            </ul>
          </div>
          <p className="text-xs text-white/70">روی موبایل و دسکتاپ — از هر جا، هر زمان</p>
        </div>
      </div>
      <div className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Brand />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-md animate-float-in">{children}</div>
        </div>
      </div>
    </div>
  );
}
