import type { ReactNode } from "react";
import { Logo } from "../../components/brand";
import { APP_NAME, APP_TAGLINE_EN } from "@shared/constants";
import { useSession } from "../../lib/session";
import { faDigits } from "@shared/format";

// the first two sentences of the Persian story (brief §2), for the brand panel
const STORY =
  "هزار سال پیش، سیراف در کرانهٔ خلیج فارس بندرِ پررونقِ داد و ستد با چین و هند و آفریقا بود. سیرافِ امروز همان بندر است برای کسب‌وکار شما: کالا، طلا، نقد و چک، حواله و رمزارز به یک‌جا می‌رسند و در یک دفتر می‌نشینند.";

// Login, sign-up and first-run layout (components.md §11.1): the form at the start, the Dusk brand panel at the end.
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { meta } = useSession();
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_44%] xl:grid-cols-[minmax(0,1fr)_640px]">
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo size={24} />
          </div>
          <h1 className="sf-display m-0 text-[30px] font-bold leading-[42px]">{title}</h1>
          {subtitle ? <p className="mb-7 mt-1.5 text-sm text-ink-2">{subtitle}</p> : <div className="mb-7" />}
          {children}
          <div className="mt-10 text-center text-xs text-ink-3">
            {APP_NAME} · {meta?.mode === "desktop" ? "نسخه‌ی ویندوز" : "نسخه‌ی وب"} {faDigits(meta?.version ?? "")}
          </div>
        </div>
      </div>
      <div className="sf-brand m-2 ms-0 hidden lg:block">
        <div className="sf-brand-in">
          <Logo size={36} tone="white" launch />
          <p className="sf-tagline">
            هر داد و ستد،
            <br />
            به حساب می‌نشیند.
          </p>
          <span className="sf-horizon" aria-hidden="true" />
          <p className="sf-en">{APP_TAGLINE_EN}</p>
          <p className="sf-story">{STORY}</p>
          <div className="sf-bfoot">
            <span>حسابداری و مدیریت کسب‌وکار</span>
            <span className="sf-nuqta" />
            <span>وب و ویندوز</span>
            <span className="sf-nuqta" />
            <span>با اینترنت و بی‌اینترنت</span>
          </div>
        </div>
      </div>
    </div>
  );
}
