import { Button, Tag } from "antd";
import { PlusOutlined, RightOutlined, LogoutOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/layout";
import { BUSINESS_KINDS, MODULES } from "@shared/constants";
import { ROLES } from "@shared/permissions";

export default function Orgs() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  return (
    <div className="mx-auto max-w-3xl p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <Button type="text" icon={<LogoutOutlined />} onClick={logout}>
          خروج
        </Button>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="m-0 text-xl font-bold">کسب‌وکارهای شما</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => nav("/orgs/new")}>
          کسب‌وکار جدید
        </Button>
      </div>
      <div className="grid gap-3">
        {(me?.orgs ?? []).map((o) => (
          <Link key={o.id} to={`/${o.id}`} className="tz-card flex items-center gap-4 p-4 !text-ink transition hover:-translate-y-0.5">
            {o.logo ? <img src={o.logo} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="grid h-12 w-12 place-content-center rounded-xl bg-brand-soft text-lg font-bold text-brand">{o.name.slice(0, 1)}</span>}
            <div className="min-w-0 flex-1">
              <div className="font-bold">{o.name}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Tag variant="filled">{BUSINESS_KINDS.find((b) => b.key === o.business_kind)?.title ?? o.business_kind}</Tag>
                {o.modules.map((m) => (
                  <Tag key={m} color="cyan" variant="filled">
                    {MODULES.find((x) => x.key === m)?.title}
                  </Tag>
                ))}
                {o.role ? <Tag variant="filled">{ROLES[o.role as keyof typeof ROLES]?.title ?? o.role}</Tag> : null}
              </div>
            </div>
            <RightOutlined className="rotate-180 text-muted" />
          </Link>
        ))}
        {!me?.orgs.length ? <div className="tz-card p-10 text-center text-muted">هنوز کسب‌وکاری نساخته‌اید.</div> : null}
      </div>
    </div>
  );
}
