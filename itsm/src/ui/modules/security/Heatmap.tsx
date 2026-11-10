// «نقشهٔ حرارتی ریسک» (SEC-043): open risks on the 5 × 5 matrix (inherent and residual), each cell coloured by its
// rating and showing how many risks sit there, the risks above their category's appetite and the count per category.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Table } from "antd";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { recordPath } from "../../records";
import { SEC_KEYS, securityApi, type RiskHeatmap } from "./api";
import { RATING_VAR } from "./Panels";
import { RISK_CATEGORIES } from "@shared/tables/security";

const fa = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("fa-IR"));

function Grid({ data, which }: { data: RiskHeatmap; which: "inherent" | "residual" }) {
  const nav = useNavigate();
  const { orgId } = useOrg();
  const cells = data[which];
  const at = (l: number, i: number) => cells.find((c) => c.likelihood === l && c.impact === i);
  return (
    <div className="grid grid-cols-[auto_repeat(5,minmax(2.5rem,1fr))] gap-1" role="grid" aria-label={which === "inherent" ? "ریسک ذاتی" : "ریسک باقی‌مانده"}>
      {[5, 4, 3, 2, 1].map((l) => (
        <div key={l} className="contents" role="row">
          <span className="self-center pe-2 text-[12px] text-ink-2">{data.likelihood_labels[l - 1]}</span>
          {[1, 2, 3, 4, 5].map((i) => {
            const c = at(l, i);
            const filter = { and: [{ f: `${which}_likelihood`, op: "eq", v: String(l) }, { f: `${which}_impact`, op: "eq", v: String(i) }, { f: "state", op: "nin", v: ["closed", "retired"] }] };
            return (
              <button
                key={i}
                type="button"
                role="gridcell"
                className="flex h-12 items-center justify-center rounded-sm text-[15px] text-ink disabled:cursor-default"
                style={{ background: RATING_VAR[c?.rating ?? "low"] }}
                disabled={!c?.count}
                onClick={() => nav(`/${orgId}/grc/risks?filter=${encodeURIComponent(JSON.stringify(filter))}`)}
                aria-label={`احتمال ${fa(l)}، اثر ${fa(i)}: ${fa(c?.count ?? 0)} ریسک`}
              >
                <span className="ds-num">{c?.count ? fa(c.count) : ""}</span>
              </button>
            );
          })}
        </div>
      ))}
      <span />
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="pt-1 text-center text-[12px] text-ink-2">
          {data.impact_labels[i - 1]}
        </span>
      ))}
    </div>
  );
}

export default function Heatmap() {
  const { api, orgId } = useOrg();
  const [which, setWhich] = useState<"residual" | "inherent">("residual");
  const q = useQuery({ queryKey: SEC_KEYS.heatmap(orgId), queryFn: () => securityApi.heatmap(api), staleTime: 60_000 });
  const d = q.data;
  return (
    <div>
      <PageHeader title="نقشهٔ حرارتی ریسک" actions={<Segmented value={which} onChange={(v) => setWhich(v as "residual" | "inherent")} options={[{ value: "residual", label: "باقی‌مانده" }, { value: "inherent", label: "ذاتی" }]} />} />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="نقشه در دسترس نیست" description="به ثبت ریسک‌ها دسترسی ندارید." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Card title={which === "residual" ? "ریسک باقی‌مانده" : "ریسک ذاتی"} meta={<span className="text-[12px] text-ink-3">عمودی: احتمال · افقی: اثر</span>}>
            <Grid data={d} which={which} />
          </Card>
          <div className="flex flex-col gap-4">
            <Card title="بالاتر از اشتهای ریسک" flush>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={d.above_appetite}
                locale={{ emptyText: "ریسکی بالاتر از اشتها نیست" }}
                columns={[
                  { title: "ریسک", dataIndex: "title", ellipsis: true, render: (v: string, r) => <Link className="ds-link" to={`/${orgId}/${recordPath("grc_risk", r.id)}`}>{v}</Link> },
                  { title: "باقی‌مانده", dataIndex: "residual_score", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "اشتها", dataIndex: "appetite_score", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "مالک", dataIndex: "owner_id", render: (v: string | null) => (v ? d.display[v] ?? "—" : "—") },
                ]}
              />
            </Card>
            <Card title="ریسک‌های باز به تفکیک دسته">
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.by_category.map((c) => (
                  <li key={c.key} className="grid grid-cols-[1fr_auto]">
                    <span className="text-ink-2">{RISK_CATEGORIES.find((x) => x.value === c.key)?.label ?? c.key}</span>
                    <span className="ds-num">{fa(c.count)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
