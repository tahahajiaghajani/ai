// The published status page (/p/status/:key, no sign-in): the projection the organisation published by its secret link
// — each published service's status, the owner's message, the availability and one bar per day — refreshed every two
// minutes, over the sign-in-free API (GET /api/public/status/:key, rate limited). No subscriptions, no record links.
import { useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "antd";
import type { StatusPage as StatusPageData } from "@shared/service_portfolio/api";
import { publicApi, ApiError } from "../../lib/api";
import { Card } from "../../components/blocks";
import { EmptyState, JDateTime, Loader } from "../../components/display";
import { ServiceRow } from "./StatusPage";
import { groupServices, headline, statusColor } from "./model";
import "./spf.css";

export default function PublicStatus() {
  const { key = "" } = useParams();
  const [days, setDays] = useState(90);
  const q = useQuery({
    queryKey: ["public-status", key, days],
    queryFn: () => publicApi.get<StatusPageData>(`/status/${encodeURIComponent(key)}`, { days: String(days) }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 429)) && n < 2,
  });
  const page = q.data;
  if (q.isLoading) return <Loader />;
  if (!page) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return <EmptyState title={gone ? "این صفحهٔ وضعیت منتشر نیست" : "صفحهٔ وضعیت بارگذاری نشد"} description={gone ? "پیوند عوض شده یا انتشار آن متوقف شده است." : "کمی بعد دوباره امتحان کنید."} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="ds-t-title m-0 text-ink">{page.title}</h1>
        <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }]} />
      </div>
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
        <EmptyState title="خدمتی روی صفحهٔ وضعیت نیست" />
      ) : (
        groupServices(page.services).map((g) => (
          <Card key={g.group} title={g.group} flush>
            <ul className="spf-list">
              {g.services.map((s) => (
                <ServiceRow key={s.id} s={s} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
