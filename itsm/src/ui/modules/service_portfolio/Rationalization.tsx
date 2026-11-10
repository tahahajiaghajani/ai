// «بهینه‌سازی سبد» (catalogue SPF-020/021): every service in the catalogue on a value × cost quadrant (support load —
// incidents in 90 days — when the person cannot see money or too few services have a cost): invest, maintain and
// optimise, review, or a candidate for retirement or consolidation; services that look alike (similar names or tags,
// readily in the same branch) are listed as overlaps. The table carries the reasons so a portfolio board can decide.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Table, Tooltip } from "antd";
import type { RationalizationRow } from "@shared/service_portfolio/api";
import { QUADRANTS } from "@shared/service_portfolio/logic";
import { formatMoney } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { COLOR_TOKENS } from "../../records/model/colors";
import { spfApi, SPF_KEYS } from "./api";
import { scatter } from "./model";
import "./spf.css";

type Q = RationalizationRow["quadrant"];
const TONE: Record<Q, "in" | "neutral" | "warning" | "danger"> = { invest: "in", maintain: "neutral", review: "warning", retire: "danger" };

export default function Rationalization() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: SPF_KEYS.rationalization(orgId), queryFn: () => spfApi.rationalization(api), staleTime: 120_000 });
  const [only, setOnly] = useState<Q | "all">("all");
  const data = q.data;
  const points = useMemo(() => (data ? scatter(data.rows, data.axis) : []), [data]);
  const rows = (data?.rows ?? []).filter((r) => only === "all" || r.quadrant === only);
  const yLabel = data?.axis === "cost" ? "هزینهٔ سالانه" : "بار پشتیبانی (رخداد ۹۰ روز)";
  return (
    <div>
      <PageHeader title="بهینه‌سازی سبد خدمات" />
      {q.isLoading ? (
        <Loader />
      ) : !data?.rows.length ? (
        <EmptyState title="خدمتی در کاتالوگ نیست" description="خدمت‌های زنده و رو به کنارگذاری این‌جا سنجیده می‌شوند." />
      ) : (
        <div className="flex flex-col gap-3">
          {data.axis === "load" ? <Note>{data.cost_visible ? "برای بیشتر خدمت‌ها هزینه ثبت نشده؛ محور عمودی بار پشتیبانی است." : "هزینه‌ها برای شما پنهان است؛ محور عمودی بار پشتیبانی است."}</Note> : null}
          <Card title="ارزش در برابر هزینه" meta={<span className="text-ink-3">افقی: ارزش کسب‌وکاری · عمودی: {yLabel}</span>}>
            <div className="spf-quad" role="group" aria-label="نمودار ارزش و هزینهٔ خدمت‌ها">
              <span className="spf-quad-label" style={{ insetInlineStart: 0, top: 0 }}>{QUADRANTS.maintain.label}</span>
              <span className="spf-quad-label" style={{ insetInlineEnd: 0, top: 0 }}>{QUADRANTS.retire.label}</span>
              <span className="spf-quad-label" style={{ insetInlineStart: 0, bottom: 0 }}>{QUADRANTS.invest.label}</span>
              <span className="spf-quad-label" style={{ insetInlineEnd: 0, bottom: 0 }}>{QUADRANTS.review.label}</span>
              {points.map((p) => {
                const r = data.rows.find((x) => x.id === p.id)!;
                // value grows to the reader's left in RTL: high value sits at the start (right) side
                return (
                  <Tooltip key={p.id} title={`${r.name} — ارزش ${fa(r.value)}${r.annual_cost ? ` — ${formatMoney(r.annual_cost)}` : ""} — ${QUADRANTS[r.quadrant].label}`}>
                    <Link
                      to={`/${orgId}/services/${r.id}`}
                      className="spf-point"
                      aria-label={`${r.name}: ${QUADRANTS[r.quadrant].label}`}
                      style={{ right: `${4 + p.x * 92}%`, top: `${96 - p.y * 92}%`, left: "auto", background: COLOR_TOKENS[QUADRANTS[r.quadrant].color] }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          </Card>
          <Segmented
            value={only}
            onChange={(v) => setOnly(v as Q | "all")}
            options={[{ value: "all", label: "همه" }, ...(Object.keys(QUADRANTS) as Q[]).map((k) => ({ value: k, label: `${QUADRANTS[k].label} (${fa(data.rows.filter((r) => r.quadrant === k).length)})` }))]}
          />
          <Card flush>
            <Table
              rowKey="id"
              size="small"
              dataSource={rows}
              pagination={rows.length > 25 ? { pageSize: 25 } : false}
              scroll={{ x: 980 }}
              columns={[
                { title: "خدمت", dataIndex: "name", key: "n", render: (v: string, r: RationalizationRow) => <Link className="ds-link" to={`/${orgId}/services/${r.id}`}>{v}</Link> },
                { title: "شاخه", dataIndex: "node", key: "b", width: 140, render: (v: string | null) => v ?? "—" },
                { title: "ارزش", dataIndex: "value", key: "v", width: 70, sorter: (a: RationalizationRow, b: RationalizationRow) => a.value - b.value, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                { title: "امتیاز", dataIndex: "score", key: "s", width: 70, render: (v: number | null) => <span className="ds-num">{v === null ? "—" : fa(v)}</span> },
                ...(data.cost_visible ? [{ title: "هزینهٔ سالانه", dataIndex: "annual_cost", key: "c", width: 140, render: (v: string | null) => (v ? <span className="ds-num">{formatMoney(v)}</span> : "—") }] : []),
                { title: "مشترک", dataIndex: "subscribers", key: "u", width: 70, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                { title: "رخداد ۹۰ روز", dataIndex: "incidents_90d", key: "i", width: 100, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                { title: "پیشنهاد", dataIndex: "quadrant", key: "q", width: 170, render: (v: Q) => <Chip tone={TONE[v]}>{QUADRANTS[v].label}</Chip> },
                { title: "دلیل‌ها و همپوشانی", key: "r", render: (_: unknown, r: RationalizationRow) => <span className="text-[12.5px] text-ink-2">{r.reasons.join("، ") || "—"}</span> },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
