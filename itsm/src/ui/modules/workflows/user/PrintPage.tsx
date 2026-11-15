// The printable view of a case (design F §5, package F7) at `workflows/c/:id/print`: GET /process/cases/:id/print gives
// everything already in words (states, people, Jalali dates, values as people read them); this page only lays it out —
// the case, its values, its decisions — with the organisation's print head and signature lines.
import { useParams } from "react-router";
import { Button } from "antd";
import { Printer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../../lib/org";
import { PrintFoot, PrintHead } from "../../../components/blocks";
import { EmptyState, Loader } from "../../../components/display";
import { RecordNo } from "../../../records/fields/display";
import { USER_KEYS, userApi } from "./api";
import { Head, useWf } from "./parts";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function PrintPage() {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const wf = useWf();
  const q = useQuery({ queryKey: USER_KEYS.print(orgId, id), queryFn: () => userApi.print(api, id), staleTime: 30_000 });
  if (q.isLoading) return <Loader />;
  if (q.isError || !q.data) return <EmptyState title="پرونده پیدا نشد" description={q.error instanceof Error ? q.error.message : undefined} />;
  const p = q.data;
  const c = p.case;
  return (
    <div className="wfu-page wfu-print">
      <div className="no-print">
        <Head
          title={`نسخهٔ چاپی ${c.number ?? ""}`}
          sub={c.title ?? undefined}
          back={{ to: wf.to(wf.paths.kase(id)), label: "پرونده" }}
          actions={
            <Button type="primary" icon={<Printer {...I16} />} onClick={() => window.print()}>
              چاپ
            </Button>
          }
        />
      </div>
      <PrintHead title={c.process ?? "پرونده"} no={c.number} date={c.started_at} lines={c.version_no ? [`نسخهٔ ${faDigits(c.version_no)}`] : []} />
      <article className="wfu-paper">
        <h2 className="wfu-h2">{c.title ?? c.number}</h2>
        <dl className="wfu-dl wfu-dl-2">
          <div>
            <dt>شماره</dt>
            <dd>
              {c.number ? <RecordNo no={c.number} /> : "—"}
            </dd>
          </div>
          <div>
            <dt>گردش‌کار</dt>
            <dd>{`${c.process ?? "—"}${c.version_no ? ` · نسخهٔ ${faDigits(c.version_no)}` : ""}`}</dd>
          </div>
          <div>
            <dt>وضعیت</dt>
            <dd>{[c.state, c.finished ? c.outcome : null].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt>درخواست‌دهنده</dt>
            <dd>{c.requested_by ?? "—"}{c.requested_for && c.requested_for !== c.requested_by ? ` (برای ${c.requested_for})` : ""}</dd>
          </div>
          <div>
            <dt>آغاز</dt>
            <dd>{c.started_at ? formatJalaliDateTime(c.started_at) : "—"}</dd>
          </div>
          {c.ended_at ? (
            <div>
              <dt>پایان</dt>
              <dd>{formatJalaliDateTime(c.ended_at)}</dd>
            </div>
          ) : null}
        </dl>
        {p.values.length ? (
          <section aria-label="داده‌ها">
            <h3 className="rk-sec-t">داده‌ها</h3>
            <table className="wfu-ptable">
              <tbody>
                {p.values.map((v) => (
                  <tr key={v.field}>
                    <th scope="row">{v.label}</th>
                    <td>{v.text || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        {p.decisions.length ? (
          <section aria-label="تصمیم‌ها">
            <h3 className="rk-sec-t">تصمیم‌ها</h3>
            <table className="wfu-ptable">
              <thead>
                <tr>
                  <th scope="col">مرحله</th>
                  <th scope="col">تصمیم</th>
                  <th scope="col">به دست</th>
                  <th scope="col">زمان</th>
                  <th scope="col">توضیح</th>
                </tr>
              </thead>
              <tbody>
                {p.decisions.map((d, i) => (
                  <tr key={i}>
                    <td>{`${d.step ?? "—"}${d.round > 1 ? ` (دور ${faDigits(d.round)})` : ""}`}</td>
                    <td>{d.outcome ?? d.action ?? "—"}</td>
                    <td>{`${d.by ?? "—"}${d.for ? ` به جانشینی از ${d.for}` : ""}`}</td>
                    <td>{d.at_text ?? "—"}</td>
                    <td>{d.comment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        <p className="rk-hint">{`چاپ‌شده در ${formatJalaliDateTime(p.printed_at)} · ${p.org}`}</p>
      </article>
      <PrintFoot sign={["درخواست‌دهنده", "تأییدکننده"]} />
    </div>
  );
}
