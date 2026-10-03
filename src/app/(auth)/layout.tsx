import { Brand, Signature, Wordmark } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/shell-parts";

/** Sign-in pages: the brand on one side (desktop), the form on the other. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-y relative grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      {/* always the dark brand palette, whatever the theme */}
      <div className="dark relative hidden overflow-hidden bg-[#0b1222] text-white lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(42rem_28rem_at_70%_30%,rgba(61,92,255,0.32),transparent_70%),radial-gradient(36rem_24rem_at_20%_90%,rgba(63,224,245,0.16),transparent_70%)]" />
        <svg className="absolute inset-x-0 top-[30%] w-full" viewBox="0 0 640 160" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="auth-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#3d5cff" stopOpacity="0" />
              <stop offset="0.35" stopColor="#3d5cff" />
              <stop offset="1" stopColor="#3fe0f5" />
            </linearGradient>
          </defs>
          <path d="M -40 118 C 90 118, 120 46, 230 58 S 380 128, 500 92 S 600 40, 680 64" fill="none" stroke="url(#auth-flow)" strokeWidth="2" opacity="0.55" />
        </svg>
        <div className="relative flex h-full flex-col items-center justify-center gap-4 p-12 text-center">
          <Wordmark className="text-7xl text-white" />
          <p className="text-lg text-white/65">کارها، در جریان.</p>
        </div>
        <Signature className="absolute inset-x-0 bottom-10 text-center" />
      </div>
      <div className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Brand className="lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm animate-float-in">{children}</div>
        </div>
      </div>
    </div>
  );
}
