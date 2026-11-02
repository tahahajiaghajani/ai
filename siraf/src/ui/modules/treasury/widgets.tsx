// Dashboard widget of the treasury module: cash and bank totals, cheques due this week (and
// overdue ones), today's receipts and payments, and the next cheques to watch.
import { useQuery } from "@tanstack/react-query";
import { Button, Tag } from "antd";
import { useNavigate } from "react-router";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { Section } from "../../components/layout";
import { JDate, Money } from "../../components/display";
import { faDigits } from "@shared/format";

function Figure({ label, value, hint, tone = "", onClick }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="tz-soft min-w-0 p-3 text-start transition hover:-translate-y-0.5" disabled={!onClick}>
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-base font-bold ${tone}`}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-muted">{hint}</div> : null}
    </button>
  );
}

function TreasuryWidget() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const allowed = can("treasury", "view");
  const q = useQuery({ queryKey: ["treasury-summary", orgId], queryFn: () => api.get("/treasury/summary"), enabled: allowed, refetchInterval: 60_000 });
  if (!allowed) return null;
  const s = q.data;
  const go = (p: string) => () => nav(`/${orgId}/${p}`);
  return (
    <Section
      title="خزانه‌داری — این هفته"
      extra={
        <Button size="small" type="link" onClick={go("treasury/cheques/due")}>
          سررسید چک‌ها
        </Button>
      }
    >
      {!s ? (
        <div className="h-28" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Figure label="موجودی صندوق‌ها" value={<Money v={s.cash_total} />} onClick={go("treasury/book")} />
            <Figure
              label="موجودی بانک‌ها"
              value={<Money v={s.bank_total} />}
              hint={s.in_collection.count ? <>در جریان وصول: <Money v={s.in_collection.sum} /></> : undefined}
              onClick={go("treasury/book?bank=")}
            />
            <Figure
              label="چک‌های دریافتی تا ۷ روز"
              value={<Money v={s.cheques.received_week.sum} />}
              hint={
                <>
                  {faDigits(s.cheques.received_week.count)} چک
                  {s.cheques.received_overdue.count ? <span className="text-bad"> · {faDigits(s.cheques.received_overdue.count)} سررسیدگذشته</span> : null}
                </>
              }
              tone="text-ok"
              onClick={go("treasury/cheques")}
            />
            <Figure
              label="چک‌های پرداختی تا ۷ روز"
              value={<Money v={s.cheques.issued_week.sum} />}
              hint={
                <>
                  {faDigits(s.cheques.issued_week.count)} چک
                  {s.cheques.issued_overdue.count ? <span className="text-bad"> · {faDigits(s.cheques.issued_overdue.count)} سررسیدگذشته</span> : null}
                </>
              }
              tone="text-bad"
              onClick={go("treasury/cheques/issued")}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-muted">
              دریافت‌های امروز: <b className="text-ink"><Money v={s.today_receipts.sum} /></b> ({faDigits(s.today_receipts.count)})
            </span>
            <span className="text-muted">
              پرداخت‌های امروز: <b className="text-ink"><Money v={s.today_payments.sum} /></b> ({faDigits(s.today_payments.count)})
            </span>
          </div>
          {s.upcoming.length ? (
            <div className="mt-3 divide-y divide-[var(--tz-line)] border-t border-line">
              {s.upcoming.slice(0, 5).map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={go(`treasury/cheques${c.direction === "issued" ? "/issued" : ""}?open=${c.id}`)}
                  className="flex w-full items-center gap-2 py-1.5 text-start text-xs hover:bg-surface-2"
                >
                  <span className={c.overdue ? "font-bold text-bad" : ""}><JDate v={c.due_date} /></span>
                  <Tag variant="filled" color={c.direction === "received" ? "cyan" : "gold"} className="!m-0">
                    {c.direction === "received" ? "دریافتی" : "پرداختی"}
                  </Tag>
                  <span className="min-w-0 flex-1 truncate">{c.party_name ?? "—"}</span>
                  <Money v={c.amount} />
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

registerWidget({ key: "treasury", order: 10, render: () => <TreasuryWidget /> });
