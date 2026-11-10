// «پیشخوان» of the platform: the figures that matter (organisations, people, Windows apps, database, AI),
// what needs attention, live support sessions, the newest organisations and the latest security events.
import { Link, useNavigate } from "react-router";
import { AlertTriangle, Building2, CheckCircle2, Database, LifeBuoy, Monitor, ShieldAlert, Users } from "lucide-react";
import { AiIcon } from "../../components/shell/icons";
import { PageHeader } from "../../components/layout";
import { Skeleton, StatCard } from "../../components/display";
import { Card } from "../../components/blocks";
import { fa } from "../../lib/fa";
import { ICON, EVENT_KIND, When, ago, bytes, eventDetail, usd, useAdminQuery, type SecurityEvent } from "./ui";
import { timeLeft } from "../../components/shell/SupportBanner";

interface OverviewData {
  mode: "cloud" | "desktop";
  kpis: {
    orgs: { total: number; active_30d: number; new_30d: number; read_only: number; suspended: number };
    users: { total: number; active_today: number; active_7d: number; disabled: number; admins: number; new_30d: number };
    devices: { total: number; active_7d: number };
    db: { bytes: number; limit: number | null };
    ai: { enabled_orgs: number | null; calls_month: number | null; errors_month: number | null; cost_month_usd: string | null };
    security: { events_24h: number; failed_sign_ins_24h: number };
    support: { active: number };
  };
  attention: { key: string; tone: "danger" | "warning" | "neutral"; title: string; detail?: string; path: string }[];
  active_support: { id: string; org_id: string; org_name: string | null; admin_name: string | null; level: string; expires_at: string }[];
  recent_orgs: { id: string; name: string; created_at: string; owner_name: string | null }[];
  recent_events: SecurityEvent[];
}

export default function Overview() {
  const q = useAdminQuery<OverviewData>(["overview"], "/admin/overview");
  const nav = useNavigate();
  const d = q.data;
  const k = d?.kpis;
  const ratio = k?.db.limit ? k.db.bytes / k.db.limit : 0;
  return (
    <div>
      <PageHeader title="پیشخوان" subtitle={d ? (d.mode === "cloud" ? "نسخهٔ وب" : "نسخهٔ ویندوز") : undefined} />
      {!k ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <section className="ad-kpis" aria-label="آمار سامانه">
            <StatCard
              icon={<Building2 {...ICON} />}
              title="سازمان‌ها"
              value={<span className="ds-num">{fa(k.orgs.total)}</span>}
              hint={`${fa(k.orgs.active_30d)} فعال در ۳۰ روز · ${fa(k.orgs.new_30d)} تازه`}
              onClick={() => nav("/admin/orgs")}
            />
            <StatCard
              icon={<Users {...ICON} />}
              title="کاربران فعال امروز"
              value={<span className="ds-num">{fa(k.users.active_today)}</span>}
              hint={`${fa(k.users.active_7d)} در ۷ روز · از ${fa(k.users.total)} حساب`}
              onClick={() => nav("/admin/users")}
            />
            <StatCard
              icon={<Database {...ICON} />}
              title="حجم پایگاه داده"
              value={<span className="ds-num">{bytes(k.db.bytes)}</span>}
              hint={
                k.db.limit ? (
                  <>
                    <div className="ad-meter" data-tone={ratio >= 0.9 ? "danger" : ratio >= 0.7 ? "warning" : undefined} role="meter" aria-label="سهم مصرف‌شده از طرح رایگان" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
                      <i style={{ inlineSize: `${Math.max(1, Math.min(100, ratio * 100))}%` }} />
                    </div>
                    <span className="mt-1.5 block">از {bytes(k.db.limit)} طرح رایگان</span>
                  </>
                ) : (
                  "پایگاه دادهٔ همین رایانه"
                )
              }
              onClick={() => nav("/admin/health")}
            />
            <StatCard
              icon={<AiIcon {...ICON} />}
              title="هزینهٔ هوش مصنوعی این ماه"
              value={<span className="ds-num ds-latin">{usd(k.ai.cost_month_usd ?? 0)}</span>}
              hint={k.ai.enabled_orgs === null ? "هنوز سازمانی کلید نگذاشته" : `${fa(k.ai.enabled_orgs)} سازمان با هوش مصنوعی · ${fa(k.ai.calls_month ?? 0)} درخواست`}
              onClick={() => nav("/admin/ai")}
            />
          </section>

          <div className="ad-grid">
            <div className="ad-stack">
              <Card title="نیازمند توجه" flush>
                {d.attention.length ? (
                  <ul className="ad-list">
                    {d.attention.map((a) => (
                      <li key={a.key}>
                        <span className="ad-tone" data-tone={a.tone} aria-hidden>
                          <AlertTriangle {...ICON} />
                        </span>
                        <span className="ad-li-main">
                          <Link to={a.path} className="ad-li-t ds-link">
                            {a.title}
                          </Link>
                          {a.detail ? <span className="ad-li-d">{a.detail}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="ad-list">
                    <li>
                      <span className="ad-tone" data-tone="ok" aria-hidden>
                        <CheckCircle2 {...ICON} />
                      </span>
                      <span className="ad-li-main">
                        <span className="ad-li-t">همه‌چیز رو به راه است</span>
                        <span className="ad-li-d">پایگاه داده، کلیدها و ورودها مشکلی ندارند.</span>
                      </span>
                    </li>
                  </ul>
                )}
              </Card>

              <Card title="سازمان‌های تازه" tools={<Link to="/admin/orgs" className="ds-link text-[13px]">همه</Link>} flush>
                <ul className="ad-list">
                  {d.recent_orgs.map((o) => (
                    <li key={o.id}>
                      <span className="ad-tone" aria-hidden>
                        <Building2 {...ICON} />
                      </span>
                      <span className="ad-li-main">
                        <Link to={`/admin/orgs/${o.id}`} className="ad-li-t ds-link">
                          {o.name}
                        </Link>
                        <span className="ad-li-d">{o.owner_name ? `مالک: ${o.owner_name}` : "بدون مالک فعال"}</span>
                      </span>
                      <span className="ad-li-end">{ago(o.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <div className="ad-stack">
              <section className="ad-kpis ad-kpis-2">
                <StatCard icon={<Monitor {...ICON} />} title="برنامهٔ ویندوز" value={<span className="ds-num">{fa(k.devices.total)}</span>} hint={`${fa(k.devices.active_7d)} همگام در ۷ روز`} />
                <StatCard
                  icon={<ShieldAlert {...ICON} />}
                  title="ورود ناموفق در ۲۴ ساعت"
                  value={<span className="ds-num">{fa(k.security.failed_sign_ins_24h)}</span>}
                  hint={`${fa(k.security.events_24h)} رویداد امنیتی`}
                  onClick={() => nav("/admin/security?kind=sign_in&ok=false")}
                />
              </section>

              {d.active_support.length ? (
                <Card title="حالت پشتیبانی در جریان" flush>
                  <ul className="ad-list">
                    {d.active_support.map((s) => (
                      <li key={s.id}>
                        <span className="ad-tone" data-tone="warning" aria-hidden>
                          <LifeBuoy {...ICON} />
                        </span>
                        <span className="ad-li-main">
                          <Link to={`/admin/orgs/${s.org_id}`} className="ad-li-t ds-link">
                            {s.org_name}
                          </Link>
                          <span className="ad-li-d">
                            {s.admin_name} · {s.level === "edit" ? "مشاهده و اصلاح" : "فقط مشاهده"}
                          </span>
                        </span>
                        <span className="ad-li-end">{timeLeft(new Date(s.expires_at).getTime() - Date.now())} مانده</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <Card title="رویدادهای امنیتی" tools={<Link to="/admin/security" className="ds-link text-[13px]">همه</Link>} flush>
                {d.recent_events.length ? (
                  <ul className="ad-list">
                    {d.recent_events.map((e) => (
                      <li key={e.id}>
                        <span className="ad-li-main">
                          <span className="ad-li-t">
                            {EVENT_KIND[e.kind] ?? e.kind}
                            {e.ok ? null : <span className="text-danger"> · ناموفق</span>}
                          </span>
                          <span className="ad-li-d">{[e.user_name ?? e.email, e.org_name, eventDetail(e)].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="ad-li-end">
                          <When v={e.at} block />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 px-5 py-4 text-[13px] text-ink-3">رویدادی ثبت نشده است.</p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
