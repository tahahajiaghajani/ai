// «وضعیت خدمات» in the portal (PTL-014): today's status of the services the organisation shows on its status page,
// the owner's message, availability and one bar a day — the service portfolio's own page parts — with «خبرم کن» to be
// told when a service changes, and the announcements on air for the person above it.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Segmented, Skeleton } from "antd";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { JDateTime } from "../../components/display";
import { ServiceRow } from "../service_portfolio/StatusPage";
import { SPF_KEYS, spfApi } from "../service_portfolio/api";
import { groupServices, headline, statusColor } from "../service_portfolio/model";
import type { StatusPageService } from "@shared/service_portfolio/api";
import { usePortalHome, type PortalConfig } from "./api";
import { Empty, PageHead } from "./parts";
import "../service_portfolio/spf.css";

export default function Status({ cfg }: { cfg: PortalConfig }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const notify = useNotify();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const home = usePortalHome(cfg.portal.id, false);
  const q = useQuery({ queryKey: SPF_KEYS.status(orgId, days), queryFn: () => spfApi.status(api, days), staleTime: 30_000, refetchInterval: 120_000 });
  const page = q.data;
  const toggle = async (s: StatusPageService) => {
    setBusy(s.id);
    try {
      if (s.subscribed) await spfApi.unsubscribe(api, s.id);
      else await spfApi.subscribe(api, s.id);
      notify.ok(s.subscribed ? "دیگر خبر این خدمت را نمی‌گیرید" : "هر تغییر وضعیت این خدمت را خبرتان می‌کنیم");
      await qc.invalidateQueries({ queryKey: SPF_KEYS.all(orgId) });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const announcements = home.data?.announcements ?? [];
  return (
    <>
      <PageHead title="وضعیت خدمات" sub="وضعیت امروز خدمت‌ها و اختلال‌های در جریان" actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }]} />} />
      {announcements.length ? (
        <div className="mb-4 flex flex-col gap-2">
          {announcements.map((a) => (
            <div key={a.id} className="pt-ann" data-kind={a.kind} role="status">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="pt-ann-t">{a.title}</span>
                {a.body ? <span className="pt-ann-b">{a.body}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {q.isLoading ? (
        <div className="pt-card">
          <Skeleton active />
        </div>
      ) : !page ? (
        <Empty title="وضعیت خدمات در دسترس نیست" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="spf-banner" data-status={page.overall} style={{ ["--spf-c" as string]: statusColor(page.overall) }}>
            <i className="spf-dot is-lg" aria-hidden />
            <div className="flex min-w-0 flex-col">
              <span className="ds-t-title text-ink">{headline(page.overall, page.services)}</span>
              <span className="text-[12.5px] text-ink-3">
                به‌روزرسانی: <JDateTime v={page.updated_at} />
              </span>
            </div>
          </div>
          {!page.services.length ? (
            <Empty title="خدمتی روی صفحهٔ وضعیت نیست" />
          ) : (
            groupServices(page.services).map((g) => (
              <section key={g.group} className="pt-card is-flush" aria-label={g.group}>
                <div className="px-4 pt-3 font-medium">{g.group}</div>
                <ul className="spf-list">
                  {g.services.map((s) => (
                    <ServiceRow key={s.id} s={s} busy={busy === s.id} onToggle={() => void toggle(s)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </>
  );
}
