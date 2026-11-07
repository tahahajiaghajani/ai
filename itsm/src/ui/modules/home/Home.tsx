// «خانه»: where every member lands — a greeting with today's date in the organisation's calendar, the AI strip for
// those who manage AI, a welcome card with the first steps of a new organisation (each only for those who may take
// it) and the organisation at a glance. Later modules add their own cards to this page.
import "./home.css";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "antd";
import { Building2, UserCog, Plug, Monitor, CircleUser, CircleHelp, type LucideIcon } from "lucide-react";
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from "@shared/constants";
import { ROLES, type Role } from "@shared/permissions";
import { formatJalali, todayISO, WEEKDAYS, weekday } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { BrandTile } from "../../components/brand";
import { AiIcon } from "../../components/shell/icons";
import { SetupStrip } from "../../ai/kit/SetupStrip";
import { openAssistant } from "../../ai/assistant/bus";
import { useCanAsk } from "../../ai/assistant/useAi";

function greeting(hour: number): string {
  if (hour < 5) return "شب بخیر";
  if (hour < 12) return "صبح بخیر";
  if (hour < 17) return "روز بخیر";
  return "عصر بخیر";
}

/** The hour now in the organisation's time zone. */
function hourIn(tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

interface Step {
  key: string;
  icon: LucideIcon;
  title: string;
  about: string;
  path: string;
  show: boolean;
}

function StepLink({ step, orgId }: { step: Step; orgId: string }) {
  const Icon = step.icon;
  return (
    <Link to={`/${orgId}/${step.path}`} className="hm-step">
      <span className="hm-step-ic" aria-hidden>
        <Icon size={18} strokeWidth={1.4} absoluteStrokeWidth />
      </span>
      <span className="min-w-0">
        <span className="hm-step-t">{step.title}</span>
        <span className="hm-step-d">{step.about}</span>
      </span>
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function Home() {
  const { org, orgId, info, can, timezone } = useOrg();
  const { me, meta } = useSession();
  const askable = useCanAsk();
  const today = todayISO(timezone);
  const name = me?.user.full_name?.trim().split(/\s+/)[0] ?? "";
  const desktop = meta?.mode === "desktop";
  const steps: Step[] = [
    { key: "org", icon: Building2, title: "مشخصات سازمان", about: "نام، نشانی، منطقهٔ زمانی و لوگو", path: "settings/org", show: can("settings", "edit") },
    { key: "users", icon: UserCog, title: "کاربران و دسترسی‌ها", about: "همکاران را اضافه کنید و نقش هر کدام را تعیین کنید", path: "settings/users", show: can("users", "edit") },
    { key: "ai", icon: AiIcon, title: "هوش مصنوعی", about: "یک اتصال بسازید تا دستیار برای اعضا به کار بیفتد", path: "settings/ai", show: can("ai", "full") },
    { key: "integrations", icon: Plug, title: "اتصال‌ها و API", about: "سامانه‌های دیگر رویدادهایشان را با وب‌هوک بفرستند", path: "settings/integrations", show: can("integrations", "full") },
    { key: "desktop", icon: Monitor, title: "نسخهٔ ویندوز", about: "پشتیبان‌گیری، حالت شبکه و هم‌گامی با نسخهٔ وب", path: "settings/desktop", show: desktop },
    { key: "account", icon: CircleUser, title: "حساب کاربری من", about: "نام، رمز عبور و دستگاه‌هایی که با آن‌ها وارد شده‌اید", path: "settings/account", show: true },
    { key: "help", icon: CircleHelp, title: "راهنما و میانبرها", about: "شروع کار، کلیدهای میانبر و پاسخ پرسش‌های رایج", path: "help", show: true },
  ];
  const role = info.member.title || ROLES[info.member.role as Role]?.title || info.member.role;
  return (
    <div className="hm">
      <PageHeader
        title="خانه"
        subtitle={
          <span>
            {name ? `${greeting(hourIn(timezone))}، ${name}` : greeting(hourIn(timezone))} · {WEEKDAYS[weekday(today)]} {formatJalali(today, { style: "long" })}
          </span>
        }
        actions={
          askable ? (
            <Button icon={<AiIcon size={16} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />} onClick={() => openAssistant()}>
              پرسش از دستیار
            </Button>
          ) : null
        }
      />
      <SetupStrip />
      <div className="hm-grid">
        <Card>
          <div className="hm-welcome">
            <BrandTile size={44} />
            <div className="min-w-0">
              <h2>به {APP_NAME} خوش آمدید</h2>
              <p>{APP_DESCRIPTION}. از این‌جا شروع کنید:</p>
            </div>
          </div>
          <div className="hm-steps">
            {steps
              .filter((s) => s.show)
              .map((s) => (
                <StepLink key={s.key} step={s} orgId={orgId} />
              ))}
          </div>
        </Card>
        <Card title="سازمان">
          <dl className="hm-facts">
            <Fact label="نام">{org.name}</Fact>
            <Fact label="نقش شما">{role}</Fact>
            <Fact label="اعضای فعال">
              <span className="ds-num">{faDigits(info.counts?.members ?? 0)}</span>
            </Fact>
            <Fact label="منطقهٔ زمانی">
              <bdi dir="ltr" className="ds-latin">
                {timezone}
              </bdi>
            </Fact>
            <Fact label="نسخه">
              <span>
                {desktop ? "ویندوز" : "وب"} · <span className="ds-num">{faDigits(APP_VERSION)}</span>
              </span>
            </Fact>
          </dl>
        </Card>
      </div>
    </div>
  );
}
