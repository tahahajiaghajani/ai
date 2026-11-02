// Dashboard widget of the treasury module: cash and bank totals (and what is in collection), today's receipts and
// payments, and the cheques of the next seven days with the overdue ones first.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ArrowDownToLine, ArrowUpFromLine, BookOpenText, Landmark, Vault } from "lucide-react";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { ChequeIcon } from "../../components/shell/icons";
import { fa, jDate } from "../../lib/fa";
import { Amt, Card, Count, HeadLink, SkRows, SkStats, Stat, num, scaled, useScale } from "../dashboard/kit";

const day = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

function TreasuryWidget() {
  const { can } = useOrg();
  return can("treasury", "view") ? <TreasuryCard /> : null;
}

function TreasuryCard() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["treasury-summary", orgId], queryFn: () => api.get("/treasury/summary"), refetchInterval: 60_000 });
  const s = q.data;
  const go = (p: string) => () => nav(`/${orgId}/${p}`);
  const sc = useScale(s ? [s.cash_total, s.bank_total, s.today_receipts.sum, s.today_payments.sum, ...s.upcoming.map((c: any) => c.amount), ...s.boxes.map((b: any) => b.balance), ...s.banks.map((b: any) => b.balance)] : [], 5);
  const overdue = s ? s.cheques.received_overdue.count + s.cheques.issued_overdue.count : 0;
  // balances by cash box and bank account, largest first (at most five; the rest fold into «سایر»)
  const all: { key: string; id: string; name: string; balance: number; bank: boolean }[] = s
    ? [
        ...s.boxes.map((b: any) => ({ key: `c${b.id}`, id: b.id, name: b.name, balance: num(b.balance), bank: false })),
        ...s.banks.map((b: any) => ({ key: `b${b.id}`, id: b.id, name: b.name, balance: num(b.balance), bank: true })),
      ].sort((a, b) => b.balance - a.balance)
    : [];
  const accounts = all.some((a) => a.balance !== 0) ? (all.length > 5 ? all.slice(0, 4) : all) : [];
  const maxAcc = Math.max(1, ...all.map((a) => a.balance));

  return (
    <Card
      title="خزانه‌داری"
      caption={s ? `این هفته، مبالغ به ${sc.unit}` : undefined}
      end={
        <>
          <HeadLink icon={BookOpenText} onClick={go("treasury/book")}>
            دفتر صندوق و بانک
          </HeadLink>
        </>
      }
      label="خزانه‌داری این هفته"
    >
      {!s ? (
        <>
          <SkStats n={4} />
          <div className="mt-5">
            <SkRows rows={4} cols={[0.5, 0.8, 0.6]} />
          </div>
        </>
      ) : (
        <>
          <div className="db-strip" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", columnGap: 20 }}>
            <Stat label="موجودی صندوق‌ها" onClick={go("treasury/book")}>
              <Amt v={s.cash_total} s={sc} />
            </Stat>
            <Stat label="موجودی بانک‌ها" onClick={go("treasury/book?bank=")} foot={s.in_collection.count ? <>در وصول {scaled(s.in_collection.sum, sc)}</> : undefined}>
              <Amt v={s.bank_total} s={sc} />
            </Stat>
            <Stat label="دریافت امروز" onClick={go("treasury/receipts")} foot={s.today_receipts.count ? <><Count n={s.today_receipts.count} /> سند</> : undefined}>
              <Amt v={s.today_receipts.sum} s={sc} />
            </Stat>
            <Stat label="پرداخت امروز" onClick={go("treasury/payments")} foot={s.today_payments.count ? <><Count n={s.today_payments.count} /> سند</> : undefined}>
              <Amt v={s.today_payments.sum} s={sc} />
            </Stat>
          </div>

          {accounts.length ? (
            <>
              <div className="db-sub">
                <span>صندوق‌ها و بانک‌ها</span>
              </div>
              <div className="db-rank">
                {accounts.map((a, i) => (
                  <button key={a.key} type="button" className="db-rank-r is-link" onClick={go(a.bank ? `treasury/book?bank=${a.id}` : `treasury/book?box=${a.id}`)}>
                    <span className="db-rank-n flex items-center gap-2">
                      {a.bank ? <Landmark size={14} strokeWidth={1.4} absoluteStrokeWidth className="flex-none text-ink-3" aria-hidden /> : <Vault size={14} strokeWidth={1.4} absoluteStrokeWidth className="flex-none text-ink-3" aria-hidden />}
                      <span className="truncate">{a.name}</span>
                    </span>
                    <span className="db-rank-v">{num(a.balance) ? scaled(a.balance, sc, 1) : <span className="db-zero">—</span>}</span>
                    <span className="db-rank-b" aria-hidden>
                      <i style={{ inlineSize: `${(Math.max(0, num(a.balance)) / maxAcc) * 100}%`, ["--i" as string]: i }} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="db-sub">
            <span>چک‌های ۷ روز آینده</span>
            {overdue ? (
              <span className="db-chip danger fig">
                <span className="sf-nuqta" />
                {fa(overdue)} سررسیدگذشته
              </span>
            ) : null}
            <span className="sf-end">
              <HeadLink icon={ChequeIcon} squeeze onClick={go("treasury/cheques/due")}>
                سررسید چک‌ها
              </HeadLink>
            </span>
          </div>
          {s.upcoming.length ? (
            <div className="db-list db-l-tchq">
              {s.upcoming.slice(0, 5).map((c: any) => {
                const out = c.direction !== "received";
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="db-row"
                    onClick={go(`treasury/cheques${out ? "/issued" : ""}?open=${c.id}`)}
                    aria-label={`چک ${out ? "پرداختی" : "دریافتی"} ${c.party_name ?? ""}، سررسید ${jDate(day(c.due_date))}${c.overdue ? "، سررسیدگذشته" : ""}`}
                  >
                    <span className={`db-num ${c.overdue ? "text-danger" : "text-ink-2"}`}>{jDate(day(c.due_date))}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      {out ? <ArrowUpFromLine size={14} strokeWidth={1.4} absoluteStrokeWidth className="flex-none text-ink-3" aria-hidden /> : <ArrowDownToLine size={14} strokeWidth={1.4} absoluteStrokeWidth className="flex-none text-in" aria-hidden />}
                      <span className="db-cell">{c.party_name ?? "—"}</span>
                    </span>
                    <span className={`db-num end ${out ? "" : "db-in"}`}>{scaled(c.amount, sc, 1)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md bg-sunken px-4 py-3 text-[13px] text-ink-2">
              <ChequeIcon size={16} strokeWidth={1.4} absoluteStrokeWidth className="text-ink-3" aria-hidden />
              چکی در ۷ روز آینده سررسید نمی‌شود.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

registerWidget({ key: "treasury", order: 10, render: () => <TreasuryWidget /> });
