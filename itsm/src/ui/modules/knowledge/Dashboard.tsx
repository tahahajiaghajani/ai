// «داشبورد دانش» (kb/dashboard): the inventory (published, drafts, in review, retired, review due, expiring, flagged,
// internal) by state, base and type; search analytics (searches, zero-result and click-through rates, the top and the
// unanswered queries); deflection («مشکلم حل شد» of sessions); feedback, reuse and link rate; translations; the AQI
// of the caller's own reviews; captured articles and 90/0; the readiness of each base for AI answers; the best and the
// weakest articles — over 30, 90 or 365 days, every figure counted by the server with the caller's access.
import "./knowledge.css";
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Table } from "antd";
import type { KbCount } from "@shared/knowledge/api";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { pct } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { KB_KEYS, kbApi } from "./api";
import { faNum } from "./model";

function Bars({ items, label }: { items: KbCount[]; label: string }) {
  const max = Math.max(1, ...items.map((x) => x.count));
  if (!items.length) return <p className="text-[13px] text-ink-3">داده‌ای نیست.</p>;
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {items.map((x) => (
        <li key={x.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[13px]">
          <span className="truncate text-ink-2" title={x.label}>
            {x.label || "(خالی)"}
          </span>
          <span className="h-2 overflow-hidden rounded-xs bg-sunken" aria-hidden>
            <span className="block h-full rounded-xs" style={{ width: `${(x.count / max) * 100}%`, background: "var(--ds-chart-1)" }} />
          </span>
          <span className="ds-num text-ink">{faNum(x.count)}</span>
        </li>
      ))}
    </ul>
  );
}

const ratio = (n: number) => pct(Math.max(0, Math.min(1, n / 100)), 0);

export default function Dashboard() {
  const { api, orgId } = useOrg();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: KB_KEYS.dashboard(orgId, days), queryFn: () => kbApi.dashboard(api, days), retry: false });
  const d = q.data;
  return (
    <div>
      <PageHeader
        title="داشبورد دانش"
        actions={
          <Segmented
            value={days}
            onChange={(v) => setDays(Number(v))}
            options={[
              { value: 30, label: "۳۰ روز" },
              { value: 90, label: "۹۰ روز" },
              { value: 365, label: "یک سال" },
            ]}
          />
        }
      />
      {q.isLoading ? <Loader /> : null}
      {q.error ? <EmptyState title="داشبورد در دسترس نیست" description={errorText(q.error)} /> : null}
      {d ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard title="منتشرشده" value={<span className="ds-num">{faNum(d.totals.published)}</span>} hint={`${faNum(d.totals.internal)} فقط کارشناسان`} />
            <StatCard title="پیش‌نویس و بازبینی" value={<span className="ds-num">{faNum(d.totals.drafts + d.totals.in_review)}</span>} hint={`${faNum(d.totals.in_review)} در بازبینی`} />
            <StatCard title="موعد بازبینی گذشته" value={<span className={`ds-num ${d.totals.review_due ? "text-danger" : ""}`}>{faNum(d.totals.review_due)}</span>} hint={`${faNum(d.totals.expiring)} نزدیک پایان اعتبار`} />
            <StatCard title="گزارش‌های باز" value={<span className="ds-num">{faNum(d.feedback.open_flags)}</span>} hint={`${faNum(d.feedback.open_tasks)} کار دانش باز`} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard title="جست‌وجو" value={<span className="ds-num">{faNum(d.search.searches)}</span>} hint={`بی‌نتیجه ${ratio(d.search.zero_rate)} · کلیک ${ratio(d.search.click_rate)}`} />
            <StatCard title="پیشگیری از درخواست" value={<span className="ds-num">{ratio(d.deflection.rate)}</span>} hint={`${faNum(d.deflection.deflected)} از ${faNum(d.deflection.sessions)} نشست`} />
            <StatCard title="مفید بودن" value={<span className="ds-num">{ratio(d.feedback.ratio)}</span>} hint={`${faNum(d.feedback.helpful)} مفید · ${faNum(d.feedback.not_helpful)} نامفید`} />
            <StatCard title="استفادهٔ دوباره" value={<span className="ds-num">{faNum(d.reuse.links)}</span>} hint={`${faNum(d.reuse.articles_reused)} مقاله · نرخ پیوند ${ratio(d.reuse.link_rate)}`} />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="بر پایهٔ وضعیت">
              <Bars items={d.by_state} label="مقاله‌ها بر پایهٔ وضعیت" />
            </Card>
            <Card title="بر پایهٔ پایگاه">
              <Bars items={d.by_base} label="مقاله‌ها بر پایهٔ پایگاه" />
            </Card>
            <Card title="بر پایهٔ نوع">
              <Bars items={d.by_type} label="مقاله‌ها بر پایهٔ نوع" />
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="پرتکرارترین جست‌وجوها" flush>
              <Table
                size="small"
                rowKey="query"
                pagination={false}
                dataSource={d.queries}
                locale={{ emptyText: "جست‌وجویی نبوده است" }}
                columns={[
                  { title: "پرسش", dataIndex: "query", ellipsis: true },
                  { title: "بار", dataIndex: "searches", width: 70, align: "end", render: (v: number) => <span className="ds-num">{faNum(v)}</span> },
                  { title: "کلیک", dataIndex: "clicks", width: 70, align: "end", render: (v: number) => <span className="ds-num">{faNum(v)}</span> },
                ]}
              />
            </Card>
            <Card title="جست‌وجوهای بی‌پاسخ" meta={<span className="text-[12px] text-ink-3">کمبودهای دانش از همین‌جا پیدا می‌شوند</span>} flush>
              <Table
                size="small"
                rowKey="query"
                pagination={false}
                dataSource={d.zero}
                locale={{ emptyText: "همهٔ جست‌وجوها نتیجه داشتند" }}
                columns={[
                  { title: "پرسش", dataIndex: "query", ellipsis: true },
                  { title: "بی‌نتیجه", dataIndex: "zero", width: 90, align: "end", render: (v: number) => <span className="ds-num">{faNum(v)}</span> },
                ]}
              />
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="بهترین مقاله‌ها">
              <ul className="kb-list">
                {d.top.map((a) => (
                  <li key={a.id}>
                    <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/kb/a/${a.id}`}>
                      {a.title}
                    </Link>
                    <span className="shrink-0 text-[12px] text-ink-3">
                      <span className="ds-num">{faNum(a.view_count)}</span> بازدید · <span className="ds-num">{faNum(a.reuse_count)}</span> استفاده
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="نیازمند توجه">
              <ul className="kb-list">
                {d.bottom.map((a) => (
                  <li key={a.id}>
                    <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/kb/a/${a.id}`}>
                      {a.title}
                    </Link>
                    <span className="shrink-0 text-[12px] text-ink-3">
                      <span className="ds-num">{faNum(a.helpful_no)}</span> نامفید
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="ترجمه‌ها">
              <p className="m-0 text-[13px] text-ink-2">
                <span className="ds-num">{faNum(d.translation.translated)}</span> ترجمه برای <span className="ds-num">{faNum(d.translation.masters)}</span> مقالهٔ اصلی ·{" "}
                <span className={d.translation.stale ? "text-danger" : ""}>
                  <span className="ds-num">{faNum(d.translation.stale)}</span> کهنه
                </span>
              </p>
            </Card>
            <Card title="دانش از کار روزانه (KCS)">
              <p className="m-0 text-[13px] text-ink-2">
                <span className="ds-num">{faNum(d.capture.from_records)}</span> مقاله از رکوردها · <span className="ds-num">{faNum(d.capture.external)}</span> بیرونی‌شده · ۹۰/۰: <span className="ds-num">{ratio(d.capture.ratio_90_0)}</span>
              </p>
            </Card>
            <Card title="کیفیت محتوا (AQI)">
              <p className="m-0 text-[13px] text-ink-2">
                {d.aqi.reviews ? (
                  <>
                    میانگین <span className="ds-num">{faNum(d.aqi.average ?? 0)}</span> از <span className="ds-num">{faNum(d.aqi.reviews)}</span> بازبینی شما
                  </>
                ) : (
                  "هنوز بازبینی کیفیتی ثبت نکرده‌اید."
                )}
              </p>
            </Card>
          </div>
          {d.readiness.length ? (
            <Card title="آمادگی پایگاه‌ها برای پاسخ هوش مصنوعی" flush>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={d.readiness}
                columns={[
                  { title: "پایگاه", dataIndex: "label", ellipsis: true },
                  { title: "مقاله", dataIndex: "articles", width: 80, align: "end", render: (v: number) => <span className="ds-num">{faNum(v)}</span> },
                  { title: "پوشش", dataIndex: "coverage", width: 80, align: "end", render: (v: number) => <span className="ds-num">{ratio(v)}</span> },
                  { title: "تازگی", dataIndex: "freshness", width: 80, align: "end", render: (v: number) => <span className="ds-num">{ratio(v)}</span> },
                  { title: "استفاده", dataIndex: "usage", width: 80, align: "end", render: (v: number) => <span className="ds-num">{ratio(v)}</span> },
                  { title: "امتیاز", dataIndex: "score", width: 80, align: "end", render: (v: number) => <span className="ds-num font-medium">{faNum(v)}</span> },
                ]}
              />
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
