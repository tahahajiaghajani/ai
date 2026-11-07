import type { ReactNode } from "react";
import { Monitor, Globe } from "lucide-react";
import { Logo } from "../../components/brand";
import { APP_TAGLINE_EN } from "@shared/constants";
import { useSession } from "../../lib/session";
import { toPersianDigits } from "../../lib/fa";
import { ICON, ThemeToggle } from "../kit";

// the first two sentences of the Persian story (brief §2), for the brand panel
const STORY =
  "هزار سال پیش، سیراف در کرانهٔ خلیج فارس بندرِ پررونقِ داد و ستد با چین و هند و آفریقا بود. سیرافِ امروز همان بندر است برای سازمان شما: کالا، طلا، نقد و چک، حواله و رمزارز به یک‌جا می‌رسند و در یک دفتر می‌نشینند.";

export interface AuthSteps {
  labels: string[];
  current: number;
}

/**
 * Login, sign-up, recovery and first-run layout (components.md §11): the calm form side at the start and the Dusk
 * brand panel at the end (a 200 px band above the form on phones). With `steps`, the panel shows the onboarding steps
 * as the mark's nuqta column (§11.2). `swapKey` replays the column's entrance when the step changes.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  steps,
  back,
  wide,
  swapKey,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  steps?: AuthSteps;
  back?: ReactNode;
  wide?: boolean;
  swapKey?: string | number;
}) {
  const { meta } = useSession();
  const desktop = meta?.mode === "desktop";
  // «۱٫۰٫۰»: Persian digits with the Persian decimal separator, never ASCII full stops between them
  const version = meta?.version ? toPersianDigits(meta.version).replace(/\./g, "٫") : null;
  return (
    <div className="pg-auth">
      <div className="pg-form-side">
        <div className="pg-form-top">
          {meta ? (
            <span className="pg-mode">
              {desktop ? <Monitor {...ICON} aria-hidden /> : <Globe {...ICON} aria-hidden />}
              {desktop ? "نسخهٔ ویندوز" : "نسخهٔ وب"}
            </span>
          ) : (
            <span />
          )}
          <ThemeToggle />
        </div>

        <div className="pg-col pg-enter" data-wide={wide || undefined} key={swapKey}>
          {back ? <div className="flex">{back}</div> : null}
          {steps ? (
            <div className="pg-steps-inline" aria-hidden>
              <span className="pg-dots">
                {steps.labels.map((l, i) => (
                  <i key={l} data-on={i <= steps.current || undefined} />
                ))}
              </span>
              <span>
                {steps.current < steps.labels.length
                  ? `گام ${toPersianDigits(String(steps.current + 1))} از ${toPersianDigits(String(steps.labels.length))}، ${steps.labels[steps.current]}`
                  : "همهٔ گام‌ها انجام شد"}
              </span>
            </div>
          ) : null}
          <div>
            <h1 className="pg-title">{title}</h1>
            {subtitle ? <p className="pg-lead">{subtitle}</p> : null}
          </div>
          <div className="pg-body">{children}</div>
        </div>

        <footer className="pg-form-foot">
          <span className="ds-nuqta" data-live="" aria-hidden />
          <span>{desktop ? "داده‌ها روی همین رایانه نگه داشته می‌شوند" : "سامانه در دسترس است"}</span>
          <span className="pg-foot-end">{version ? <span>
                نسخهٔ <span className="ds-num">{version}</span>
              </span> : null}</span>
        </footer>
      </div>

      <aside className="ds-brand pg-brand pg-in" aria-label="سیراف">
        <div className="ds-brand-in">
          <div className="pg-brand-top">
            <span className="pg-brand-logo">
              <Logo size={36} tone="white" launch />
            </span>
            <span className="pg-band-toggle">
              <ThemeToggle />
            </span>
          </div>
          {steps ? (
            <ol className="pg-steps" aria-label="گام‌ها">
              {steps.labels.map((l, i) => (
                <li key={l} className="pg-step" data-state={i < steps.current ? "done" : i === steps.current ? "current" : "next"} aria-current={i === steps.current ? "step" : undefined}>
                  <i aria-hidden />
                  {l}
                </li>
              ))}
            </ol>
          ) : null}
          <p className="ds-tagline">
            هر داد و ستد،
            <br />
            به حساب می‌نشیند.
          </p>
          <span className="ds-horizon" aria-hidden="true" />
          <p className="ds-en">{APP_TAGLINE_EN}</p>
          {steps ? null : <p className="ds-story">{STORY}</p>}
          <div className="ds-bfoot">
            <span>حسابداری و مدیریت سازمان</span>
            <span className="ds-nuqta" />
            <span>وب و ویندوز</span>
            <span className="ds-nuqta" />
            <span>با اینترنت و بی‌اینترنت</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
