// The organisation chooser: every organisation this account belongs to, the last one used marked.
import { Button } from "antd";
import { Plus, ChevronLeft, Building2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useSession } from "../../lib/session";
import { toPersianDigits, SEP } from "../../lib/fa";
import { APP_NAME, MODULES, TIMEZONES } from "@shared/constants";
import { ROLES } from "@shared/permissions";
import { ICON, PlainFrame } from "../kit";

function lastOrg(): string | null {
  try {
    return localStorage.getItem("itsm.lastOrg");
  } catch {
    return null;
  }
}

const zoneTitle = (tz: string | null | undefined) => (tz ? (TIMEZONES.find((z) => z.value === tz)?.label.replace(/\s*\(.*\)$/, "") ?? tz) : null);

export default function Orgs() {
  const { me } = useSession();
  const nav = useNavigate();
  const orgs = me?.orgs ?? [];
  const last = lastOrg();
  const first = (me?.user.full_name ?? "").trim().split(/\s+/)[0];
  return (
    <PlainFrame>
      <div className="pg-chooser ds-stagger">
        <div>
          {first ? <p className="pg-greet">سلام {first}،</p> : null}
          <div className="pg-ph">
            <h1 className="ds-t-page">{orgs.length ? "سازمان‌های شما" : `به ${APP_NAME} خوش آمدید`}</h1>
            {orgs.length > 1 ? <span className="pg-ph-meta ds-num">{toPersianDigits(String(orgs.length))} سازمان</span> : null}
          </div>
        </div>

        {orgs.length ? (
          <nav className="pg-list ds-stagger" aria-label="سازمان‌ها">
            {orgs.map((o) => {
              const role = o.role ? ROLES[o.role as keyof typeof ROLES]?.title ?? o.role : null;
              const mods = o.modules.map((m) => MODULES.find((x) => x.key === m)?.title).filter(Boolean);
              return (
                <Link key={o.id} to={`/${o.id}`} className="pg-org">
                  {o.logo ? (
                    <img src={o.logo} alt="" className="pg-org-logo" />
                  ) : (
                    <span className="pg-org-logo" aria-hidden>
                      {o.name.trim().slice(0, 1)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="pg-org-name">
                      <span className="truncate">{o.name}</span>
                      {o.id === last && orgs.length > 1 ? <span className="pg-chip">آخرین بار</span> : null}
                    </span>
                    <span className="pg-org-meta block">{[zoneTitle(o.timezone), ...mods].filter(Boolean).join(SEP)}</span>
                  </span>
                  {role ? <span className="pg-org-role">{role}</span> : null}
                  <ChevronLeft {...ICON} className="pg-chev" aria-hidden />
                </Link>
              );
            })}
            <Link to="/orgs/new" className="pg-org pg-org-new">
              <span className="pg-org-logo" aria-hidden>
                <Plus {...ICON} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="pg-org-name">سازمان تازه</span>
                <span className="pg-org-meta block">نام و منطقهٔ زمانی؛ در یک گام</span>
              </span>
              <ChevronLeft {...ICON} className="pg-chev" aria-hidden />
            </Link>
          </nav>
        ) : (
          <div className="pg-list">
            <div className="pg-empty">
              <span className="pg-empty-tile">
                <Building2 size={28} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
              </span>
              <h2>هنوز سازمانی ندارید.</h2>
              <p>اولین سازمانتان را بسازید؛ بعد اعضا را دعوت کنید و نقش هر کدام را تعیین کنید.</p>
              <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav("/orgs/new")}>
                ساخت سازمان
              </Button>
            </div>
          </div>
        )}
      </div>
    </PlainFrame>
  );
}
