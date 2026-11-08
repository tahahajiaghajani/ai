// «وضعیت خدمات» — the status page (catalogue SPF-013/015, «Beyond the market»): the services their owners published,
// grouped by portfolio branch, each with its live status, the owner's message, the availability over the window and one
// bar per day (the worst status of the day). Everyone in the organisation sees it — requesters included — and may
// subscribe to a service to be told of outages and planned work. Portfolio managers refresh the statuses and publish
// the page by a secret link for the intranet or the website (web version; the link shows the same projection).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Segmented, Space, Switch, Tooltip, Typography } from "antd";
import { Bell, BellOff, Link2, RefreshCw } from "lucide-react";
import type { StatusPageService } from "@shared/service_portfolio/api";
import { statusLabel } from "@shared/service_portfolio/logic";
import { useOrg } from "../../lib/org";
import { fa, pct } from "../../lib/fa";
import { useSession } from "../../lib/session";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, JDateTime, Loader } from "../../components/display";
import { publicStatusUrl, spfApi, SPF_KEYS } from "./api";
import { barTitle, groupServices, headline, statusColor, statusTone } from "./model";
import "./spf.css";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export function DayBars({ s, compact }: { s: Pick<StatusPageService, "bars" | "availability" | "name">; compact?: boolean }) {
  const bars = compact ? s.bars.slice(-30) : s.bars;
  return (
    <div className="spf-bars" role="img" aria-label={`${s.name}: دسترس‌پذیری ${pct(s.availability / 100, 2)} در ${fa(bars.length)} روز`}>
      {bars.map((b) => (
        <Tooltip key={b.day} title={barTitle(b)} mouseEnterDelay={0.05}>
          <span className={b.empty ? "is-empty" : undefined} style={b.empty ? undefined : { background: statusColor(b.status) }} />
        </Tooltip>
      ))}
    </div>
  );
}

/** One service of the page: status, message, day bars (and «خبرم کن» in the organisation; not on the published page). */
export function ServiceRow({ s, onToggle, busy }: { s: StatusPageService; onToggle?: () => void; busy?: boolean }) {
  return (
    <li className="spf-row">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <i className="spf-dot" style={{ background: statusColor(s.status) }} aria-hidden />
          <span className="truncate font-medium text-ink">{s.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {s.status === "operational" ? <span className="text-[12.5px] text-ink-3">{statusLabel(s.status)}</span> : <Chip tone={statusTone(s.status)}>{statusLabel(s.status)}</Chip>}
          {onToggle ? (
            <Tooltip title={s.subscribed ? "لغو اشتراک خبرها" : "خبرم کن"}>
              <Button size="small" type="text" loading={busy} aria-pressed={!!s.subscribed} aria-label={s.subscribed ? `لغو اشتراک ${s.name}` : `اشتراک ${s.name}`} icon={s.subscribed ? <BellOff {...ICON} /> : <Bell {...ICON} />} onClick={onToggle} />
            </Tooltip>
          ) : null}
        </div>
      </div>
      {s.note ? <p className="mt-1 text-[13px] text-ink-2">{s.note}</p> : null}
      <div className="mt-2 flex items-center gap-3">
        <DayBars s={s} />
        <span className="ds-num shrink-0 text-[12px] text-ink-3">{pct(s.availability / 100, 2)}</span>
      </div>
    </li>
  );
}

export default function StatusPage() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const session = useSession();
  const qc = useQueryClient();
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: SPF_KEYS.status(orgId, days), queryFn: () => spfApi.status(api, days), staleTime: 30_000, refetchInterval: 120_000 });
  const page = q.data;
  const refresh = useMutation({
    mutationFn: () => spfApi.refreshStatus(api),
    onSuccess: (r) => {
      message.success(r.changed ? `${fa(r.changed)} وضعیت تغییر کرد` : "وضعیت‌ها به‌روز است");
      void qc.invalidateQueries({ queryKey: SPF_KEYS.all(orgId) });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const publish = useMutation({
    mutationFn: (v: { enabled: boolean; regenerate?: boolean }) => spfApi.publish(api, v.enabled, v.regenerate),
    onSuccess: (r) => {
      message.success(r.enabled ? "صفحهٔ وضعیت عمومی منتشر شد" : "انتشار عمومی متوقف شد");
      void qc.invalidateQueries({ queryKey: SPF_KEYS.all(orgId) });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const toggle = async (s: StatusPageService) => {
    setBusy(s.id);
    try {
      if (s.subscribed) await spfApi.unsubscribe(api, s.id);
      else await spfApi.subscribe(api, s.id);
      message.success(s.subscribed ? "اشتراک لغو شد" : "از این پس خبر وضعیت این خدمت را می‌گیرید");
      await qc.invalidateQueries({ queryKey: SPF_KEYS.all(orgId) });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const web = session.meta?.mode !== "desktop";
  return (
    <div>
      <PageHeader
        title={page?.title ?? "وضعیت خدمات"}
        actions={
          <Space wrap>
            <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }]} />
            {page?.can_manage ? <Button icon={<RefreshCw {...ICON} />} loading={refresh.isPending} onClick={() => refresh.mutate()}>به‌روزرسانی وضعیت‌ها</Button> : null}
          </Space>
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !page ? (
        <EmptyState title="صفحهٔ وضعیت بارگذاری نشد" />
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
            <EmptyState
              title="خدمتی روی صفحهٔ وضعیت نیست"
              description={page.can_manage ? "در صفحهٔ هر خدمت زنده، «در صفحهٔ وضعیت» را روشن کنید تا این‌جا دیده شود." : "هنوز خدمتی برای نمایش وضعیت منتشر نشده است."}
            />
          ) : (
            groupServices(page.services).map((g) => (
              <Card key={g.group} title={g.group} flush>
                <ul className="spf-list">
                  {g.services.map((s) => (
                    <ServiceRow key={s.id} s={s} busy={busy === s.id} onToggle={() => toggle(s)} />
                  ))}
                </ul>
              </Card>
            ))
          )}
          {page.can_manage && web ? (
            <Card title="انتشار عمومی">
              <div className="flex flex-col gap-2 text-[13px]">
                <label className="flex items-center gap-2">
                  <Switch size="small" checked={!!page.public_token} loading={publish.isPending} onChange={(v) => publish.mutate({ enabled: v })} />
                  صفحهٔ وضعیت بدون ورود، با پیوند محرمانه
                </label>
                {page.public_token ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography.Text copyable={{ text: publicStatusUrl(page.public_token), tooltips: ["رونوشت پیوند", "رونوشت شد"] }} className="ds-latin break-all" dir="ltr">
                      {publicStatusUrl(page.public_token)}
                    </Typography.Text>
                    <Button size="small" icon={<Link2 {...ICON} />} onClick={() => publish.mutate({ enabled: true, regenerate: true })}>پیوند تازه</Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
