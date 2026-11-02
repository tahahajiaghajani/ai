// The business chooser: every business this account belongs to, the last one used first-marked.
import { Button } from "antd";
import { Plus, ChevronLeft, Building2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useSession } from "../../lib/session";
import { toPersianDigits, SEP } from "../../lib/fa";
import { BUSINESS_KINDS, MODULES } from "@shared/constants";
import { ROLES } from "@shared/permissions";
import { ICON, PlainFrame } from "../kit";

function lastOrg(): string | null {
  try {
    return localStorage.getItem("siraf.lastOrg") ?? localStorage.getItem("taraz.lastOrg");
  } catch {
    return null;
  }
}

const kindTitle = (k: string) => BUSINESS_KINDS.find((b) => b.key === k)?.title.replace(/\s*\(.*\)$/, "") ?? k;

export default function Orgs() {
  const { me } = useSession();
  const nav = useNavigate();
  const orgs = me?.orgs ?? [];
  const last = lastOrg();
  const first = (me?.user.full_name ?? "").trim().split(/\s+/)[0];
  return (
    <PlainFrame>
      <div className="pg-chooser sf-stagger">
        <div>
          {first ? <p className="pg-greet">سلام {first}،</p> : null}
          <div className="pg-ph">
            <h1 className="sf-t-page">{orgs.length ? "کسب‌وکارهای شما" : "به سیراف خوش آمدید"}</h1>
            {orgs.length > 1 ? <span className="pg-ph-meta sf-num">{toPersianDigits(String(orgs.length))} کسب‌وکار</span> : null}
          </div>
        </div>

        {orgs.length ? (
          <nav className="pg-list sf-stagger" aria-label="کسب‌وکارها">
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
                    <span className="pg-org-meta block">{[kindTitle(o.business_kind), ...mods, role].filter(Boolean).join(SEP)}</span>
                  </span>
                  <ChevronLeft {...ICON} className="pg-chev" aria-hidden />
                </Link>
              );
            })}
            <Link to="/orgs/new" className="pg-org pg-org-new">
              <span className="pg-org-logo" aria-hidden>
                <Plus {...ICON} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="pg-org-name">کسب‌وکار تازه</span>
                <span className="pg-org-meta block">کالا، طلا، صرافی یا خدمات؛ در سه گام</span>
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
              <h2>هنوز کسب‌وکاری ندارید.</h2>
              <p>اولین کسب‌وکارتان را بسازید؛ کدینگ حساب‌ها و سال مالی خودکار آماده می‌شود.</p>
              <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav("/orgs/new")}>
                ساخت کسب‌وکار
              </Button>
            </div>
          </div>
        )}
      </div>
    </PlainFrame>
  );
}
