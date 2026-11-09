// «میز کار SOC» (SEC-013): tiles that open the queues, the riskiest open security incidents, the analysts' workload,
// MTTD / MTTC / MTTR with the false-positive rate (90 days) and the shift handover («تحویل شیفت», copied with one
// click). Everything is computed by the server from the incidents the caller reads.
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Table } from "antd";
import { Copy } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { recordPath } from "../../records";
import { SEC_KEYS, durationFa, securityApi } from "./api";

const SEVERITY: Record<string, [string, "danger" | "warning" | "neutral"]> = { "1": ["بحرانی", "danger"], "2": ["بالا", "warning"], "3": ["متوسط", "neutral"], "4": ["کم", "neutral"] };
const fa = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("fa-IR"));

export default function Soc() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const q = useQuery({ queryKey: SEC_KEYS.soc(orgId), queryFn: () => securityApi.soc(api), staleTime: 30_000, refetchInterval: 60_000 });
  const d = q.data;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d?.handover ?? "");
      n.note("متن تحویل شیفت رونوشت شد.");
    } catch {
      n.error(new Error("رونوشت ممکن نشد"));
    }
  };
  return (
    <div>
      <PageHeader title="میز کار SOC" actions={d ? <Button icon={<Copy {...ICON14} />} onClick={copy}>رونوشت تحویل شیفت</Button> : null} />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="میز کار در دسترس نیست" description="به رخدادهای امنیتی دسترسی ندارید یا بارگذاری انجام نشد." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {d.tiles.map((t) => (
              <StatCard key={t.key} title={t.label} value={fa(t.value)} hint={t.tone === "danger" && t.value ? <Chip tone="danger">نیاز به اقدام</Chip> : undefined} onClick={t.path ? () => nav(`/${orgId}/${t.path}`) : undefined} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card title="پرخطرترین رخدادهای باز" flush>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={d.top}
                locale={{ emptyText: "رخداد بازی نیست" }}
                onRow={(r) => ({ onClick: () => nav(`/${orgId}/${recordPath("sec_incident", r.id)}`), style: { cursor: "pointer" } })}
                columns={[
                  { title: "شماره", dataIndex: "number", render: (v: string) => <bdi className="ds-num">{v}</bdi> },
                  { title: "عنوان", dataIndex: "title", ellipsis: true },
                  { title: "وضعیت", dataIndex: "state_label" },
                  { title: "شدت", dataIndex: "severity", render: (v: string) => (SEVERITY[v] ? <Chip tone={SEVERITY[v][1]}>{SEVERITY[v][0]}</Chip> : "—") },
                  { title: "ریسک", dataIndex: "risk_score", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "تحلیل‌گر", dataIndex: "assigned_to", render: (v: string | null) => (v ? d.display[v] ?? "—" : <Chip tone="warning">بی‌تحلیل‌گر</Chip>) },
                ]}
              />
            </Card>
            <div className="flex flex-col gap-4">
              <Card title="زمان‌ها (۹۰ روز)">
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                  <dt className="text-ink-2">میانگین زمان تا کشف (MTTD)</dt>
                  <dd className="ds-num">{durationFa(d.times.mttd)}</dd>
                  <dt className="text-ink-2">میانگین زمان تا مهار (MTTC)</dt>
                  <dd className="ds-num">{durationFa(d.times.mttc)}</dd>
                  <dt className="text-ink-2">میانگین زمان تا بازیابی (MTTR)</dt>
                  <dd className="ds-num">{durationFa(d.times.mttr)}</dd>
                  <dt className="text-ink-2">نرخ مثبت کاذب</dt>
                  <dd className="ds-num">{d.times.false_positive_rate === null ? "—" : `${fa(d.times.false_positive_rate)}٪`}</dd>
                </dl>
              </Card>
              <Card title="بار کاری تحلیل‌گران">
                {d.workload.length ? (
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {d.workload.map((w) => (
                      <li key={w.user_id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                        <span className="truncate">{w.name || "—"}</span>
                        <span className="ds-num text-ink">{fa(w.open)}</span>
                        {w.critical ? <Chip tone="danger">{fa(w.critical)} مهم</Chip> : <span />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-3">رخداد بازی به کسی سپرده نشده است.</p>
                )}
              </Card>
            </div>
          </div>
          <Card title="تحویل شیفت">
            <pre className="whitespace-pre-wrap text-[13px] leading-7 text-ink" style={{ fontFamily: "inherit" }}>
              {d.handover}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
}
