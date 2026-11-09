// «نمای خط لوله» (REL-019/020, DEV-002/007): one row per service (or pipeline), one column per environment in
// pipeline order; each cell is the latest deployment there — version, state, when, and whether a change authorized
// it — and a version that reached the previous environment but not this one shows as waiting for promotion. Cells
// open their deployment. Read with the person's access (deployments they may not read are not counted).
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "antd";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime, Loader } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { recordPath } from "../../records";
import { DEVOPS_KEYS, devopsApi } from "./api";
import { DEPLOY_STATE_LABELS, deployTone, waitingInto, type Row } from "./model";

export default function Pipeline() {
  const { api, orgId } = useOrg();
  const [days, setDays] = useState(60);
  const q = useQuery({ queryKey: DEVOPS_KEYS.pipeline(orgId, days), queryFn: () => devopsApi.pipeline(api, days) });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="نمای خط لوله" actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 14, label: "دو هفته" }, { value: 60, label: "دو ماه" }, { value: 180, label: "شش ماه" }]} aria-label="بازه" />} />
      {q.isLoading ? (
        <Loader />
      ) : !d || !d.environments.length ? (
        <EmptyState title="محیطی تعریف نشده است" />
      ) : !d.rows.length ? (
        <EmptyState title="در این بازه استقراری ثبت نشده است" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead className="bg-sunken">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-normal text-ink-3">خدمت یا خط لوله</th>
                {d.environments.map((e) => (
                  <th key={e.id} scope="col" className="px-3 py-2 text-start font-normal text-ink-2">{e.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((row: Row) => (
                <tr key={row.key} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-2 text-start font-medium text-ink">
                    {row.service_id ? (d.display[row.service_id] ?? "(محدود)") : row.pipeline_id ? (d.display[row.pipeline_id] ?? "خط لوله") : "بدون خدمت"}
                  </th>
                  {d.environments.map((e) => {
                    const cell = row.cells[e.id] as Row | undefined;
                    const waiting = waitingInto(row, e.id);
                    return (
                      <td key={e.id} className="px-3 py-2">
                        {cell ? (
                          <Link to={`/${orgId}/${recordPath("deployment", cell.id)}`} className="flex flex-col gap-1 rounded-md p-1 hover:bg-sunken" aria-label={`${cell.number} در ${e.name}`}>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="ltr ds-num font-medium text-ink">{cell.artifact_version ?? "—"}</span>
                              <Chip tone={deployTone(cell.state)}>{DEPLOY_STATE_LABELS[String(cell.state)] ?? String(cell.state)}</Chip>
                              {cell.change_id ? <ShieldCheck {...ICON14} className="text-in" aria-label="با تغییر مجاز" /> : null}
                            </span>
                            <span className="text-[12px] text-ink-3">{cell.actual_end ? <JDateTime v={cell.actual_end} /> : "در جریان"}</span>
                          </Link>
                        ) : (
                          <span className="text-[12px] text-ink-4">—</span>
                        )}
                        {waiting ? (
                          <span className="mt-1 flex items-center gap-1 text-[12px] text-warning">
                            <ArrowLeft {...ICON14} aria-hidden />
                            <span className="ltr">{waiting}</span> منتظر ارتقا
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
