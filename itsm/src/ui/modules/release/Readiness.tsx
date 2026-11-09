// «تابلوی آمادگی» (REL-013/014): releases being built, tested or waiting for their go/no-go decision, one card each
// with the readiness bar, the blocking checks still open, risk and the decision; a card opens its checks (verdicts on
// manual checks, waivers with a reason for release managers) and the decision dialog. Every number comes from the
// server with the person's access; the board refreshes after each action.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Space } from "antd";
import { Gavel, ListChecks, RefreshCw } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime, Loader } from "../../components/display";
import { ICON, ICON14 } from "../../components/blocks";
import { recordPath } from "../../records";
import { RELEASE_KEYS, releaseApi, type Readiness as R } from "./api";
import { ChecksList, DecisionModal, ReadinessBar } from "./Panels";
import { boardColumns, decisionLabel, decisionTone, riskLabel, riskTone, typeLabel, typeTone, type Row } from "./model";

export default function Readiness() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: RELEASE_KEYS.meta(orgId), queryFn: () => releaseApi.meta(api) });
  const board = useQuery({ queryKey: RELEASE_KEYS.board(orgId), queryFn: () => releaseApi.board(api) });
  const [open, setOpen] = useState<Row | null>(null);
  const [deciding, setDeciding] = useState<Row | null>(null);
  const manages = !!meta.data?.manages;
  const refresh = () => qc.invalidateQueries({ queryKey: RELEASE_KEYS.board(orgId) });
  const run = useAction((id: string) => releaseApi.runChecks(api, id), { success: "بررسی‌ها دوباره اجرا شد", onSuccess: refresh });
  const cols = boardColumns(board.data?.releases ?? []);
  const fresh = open ? (board.data?.releases ?? []).find((r) => r.id === open.id) ?? open : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="تابلوی آمادگی انتشار" actions={<Button icon={<RefreshCw {...ICON} />} onClick={refresh} loading={board.isFetching}>تازه‌سازی</Button>} />
      {board.isLoading ? (
        <Loader />
      ) : !board.data?.releases.length ? (
        <EmptyState title="انتشاری در ساخت، آزمون یا انتظار تصمیم نیست" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {cols.map((c) => (
            <section key={c.key} aria-label={c.label} className="flex flex-col gap-2">
              <h2 className="flex items-center gap-2 text-[14px] text-ink-2">
                {c.label} <span className="ds-num text-ink-3">{c.items.length.toLocaleString("fa-IR")}</span>
              </h2>
              {c.items.length ? (
                c.items.map((r) => {
                  const rd = r.readiness as R;
                  return (
                    <article key={r.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/${orgId}/${recordPath("release", r.id)}`} className="ds-link font-medium">{r.number}</Link>
                        <Chip tone={typeTone(r.type)}>{typeLabel(r.type)}</Chip>
                        {r.risk_band ? <Chip tone={riskTone(r.risk_band)}>ریسک {riskLabel(r.risk_band)}</Chip> : null}
                      </div>
                      <p className="text-[13px] text-ink">{r.short_description}{r.version_name ? <span className="ltr ms-1 text-ink-3">{r.version_name}</span> : null}</p>
                      <ReadinessBar r={rd} />
                      {rd.blockers.length ? (
                        <ul className="list-disc ps-4 text-[12px] text-ink-2">
                          {rd.blockers.slice(0, 3).map((b) => <li key={b}>{b}</li>)}
                          {rd.blockers.length > 3 ? <li>و {(rd.blockers.length - 3).toLocaleString("fa-IR")} مورد دیگر</li> : null}
                        </ul>
                      ) : (
                        <p className="text-[12px] text-in">مانع بازدارنده‌ای نمانده است.</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                        <Chip tone={decisionTone(r.go_no_go)}>{decisionLabel(r.go_no_go)}</Chip>
                        {r.planned_end ? <span>عرضه: <JDateTime v={r.planned_end} /></span> : null}
                      </div>
                      <Space wrap>
                        <Button size="small" icon={<ListChecks {...ICON14} />} onClick={() => setOpen(r)}>بررسی‌ها</Button>
                        <Button size="small" icon={<RefreshCw {...ICON14} />} onClick={() => run.mutate(r.id)} loading={run.isPending && run.variables === r.id}>اجرای دوباره</Button>
                        {r.state === "readiness" && manages ? (
                          <Button size="small" type="primary" icon={<Gavel {...ICON14} />} onClick={() => setDeciding(r)}>تصمیم اجرا</Button>
                        ) : null}
                      </Space>
                    </article>
                  );
                })
              ) : (
                <p className="rounded-lg border border-dashed border-line p-3 text-[12px] text-ink-3">خالی</p>
              )}
            </section>
          ))}
        </div>
      )}
      <Drawer open={!!fresh} onClose={() => setOpen(null)} title={fresh ? `بررسی‌های آمادگی ${fresh.number}` : ""} size="large" destroyOnHidden>
        {fresh ? <ChecksList releaseId={fresh.id} checks={(fresh.checks as Row[]) ?? []} manages={manages} canWork onChanged={refresh} /> : null}
      </Drawer>
      {deciding ? <DecisionModal release={deciding} open onClose={() => setDeciding(null)} onDone={refresh} /> : null}
    </div>
  );
}
