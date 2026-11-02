// Dashboard widget of the fx module: the board's dollar rate and live prices (BTC, ETH, USDT), the largest currency
// positions at market value, and today's deals, volume, profit and open remittances. Plain ink on the dashboard:
// the sea material stays inside «صرافی» (components.md §0.4).
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Button } from "antd";
import { ArrowLeftRight, Plus, Table2 } from "lucide-react";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { Ic } from "../../components/shell/icons";
import { fa, pct } from "../../lib/fa";
import { Amt, Card, Count, Empty, HeadLink, Sk, SkRows, Stat, num, scaled, useScale } from "../dashboard/kit";
import { useLive } from "./shared";

function FxWidget() {
  const { can } = useOrg();
  return can("fx", "view") ? <FxCard /> : null;
}

const latin = (n: number, dp: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp }).format(n);
const holding = (n: number, decimals: number) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: Math.min(Math.max(decimals, 0), 8) }).format(n);

function Move({ pct: p }: { pct: string | null | undefined }) {
  if (p === null || p === undefined || p === "") return null;
  const n = num(p);
  if (Math.abs(n) < 0.005) return <span className="db-mv">بدون تغییر</span>;
  return (
    <span className={`db-mv ${n > 0 ? "up" : "down"}`}>
      <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden className="me-1 inline-block align-[0]">
        {n > 0 ? <path d="M1 7.5h8L5 1.5z" fill="currentColor" /> : <path d="M1 2.5h8L5 8.5z" fill="currentColor" />}
      </svg>
      {pct(Math.abs(n) / 100, 2)}
    </span>
  );
}

function FxCard() {
  const { api, orgId, can, unit, org } = useOrg();
  const nav = useNavigate();
  const go = (p: string) => () => nav(`/${orgId}/${p}`);
  const sum = useQuery({ queryKey: ["fx-summary", orgId], queryFn: () => api.get("/fx/summary"), refetchInterval: 60_000 });
  const pos = useQuery({
    queryKey: ["fx-positions-dash", orgId],
    queryFn: () => api.get("/fx/reports/positions"),
    enabled: can("reports", "view"),
    refetchInterval: 120_000,
  });
  const live = useLive(["BTC", "ETH", "USDT"]);
  const s = sum.data;
  const usd = s?.board?.find((b: any) => b.code === "USD");
  const quotes = live.data?.quotes ?? [];
  const positions: any[] = (pos.data?.rows ?? [])
    .filter((r: any) => num(r.holdings) !== 0)
    .sort((a: any, b: any) => Math.abs(num(b.market_value ?? b.book_value)) - Math.abs(num(a.market_value ?? a.book_value)))
    .slice(0, 4);
  const profit = s?.day?.profit !== null && s?.day?.profit !== undefined ? num(s.day.profit) + num(s.day.fees) : null;
  const sc = useScale(s ? [s.day?.volume, profit, ...positions.map((p) => p.market_value ?? p.book_value)] : [], 5);
  const baseDp = org.money_decimals ?? 0;
  const openRem = (s?.remittances?.out_open ?? 0) + (s?.remittances?.in_open ?? 0);
  const quiet = s && !usd && !quotes.length && !positions.length && !s.day?.count;

  return (
    <Card
      title="صرافی"
      caption={s && !quiet ? `مبالغ به ${sc.unit}` : undefined}
      end={
        <>
          <HeadLink icon={Table2} onClick={go("fx/rates")}>
            تابلوی نرخ
          </HeadLink>
          {can("fx", "edit") ? (
            <HeadLink icon={Plus} onClick={go("fx/deals/new")}>
              معاملهٔ جدید
            </HeadLink>
          ) : null}
        </>
      }
      label="صرافی امروز"
    >
      {!s ? (
        <>
          <div className="db-rates">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="db-rate">
                <Sk w="40%" h={10} />
                <Sk w="75%" h={14} style={{ marginBlockStart: 6 }} />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <SkRows rows={3} />
          </div>
        </>
      ) : quiet ? (
        <Empty
          icon={ArrowLeftRight}
          title="هنوز نرخ و معامله‌ای ثبت نشده."
          text="نرخ‌های تابلو، موضع ارزها و معاملات امروز اینجا می‌آیند."
          action={
            can("fx", "edit") ? (
              <Button type="primary" icon={<Ic icon={Plus} />} onClick={go("fx/deals/new")}>
                معاملهٔ ارز
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="db-rates" role="group" aria-label="نرخ‌ها">
            {usd ? (
              <div className="db-rate">
                <span className="db-rate-h">
                  <span className="db-code">USD</span>
                  خرید
                </span>
                <span className="db-rate-v">{usd.buy ? fa(num(usd.buy), baseDp) : "—"}</span>
                <span className="db-rate-f">
                  فروش <span className="db-mv">{usd.sell ? fa(num(usd.sell), baseDp) : "—"}</span>
                </span>
              </div>
            ) : null}
            {quotes.map((q) => (
              <div key={q.code} className="db-rate">
                <span className="db-rate-h">
                  <span className="db-code">{q.code}</span>
                  <Move pct={q.change_24h} />
                </span>
                <span className="db-rate-v latin">{q.price_usd ? `$${latin(num(q.price_usd), num(q.price_usd) < 10 ? 4 : 0)}` : "—"}</span>
                <span className="db-rate-f">
                  {q.price_base ? (
                    <span className="db-mv">
                      {scaled(q.price_base, { div: num(q.price_base) >= 1e9 ? 1e6 : 1, word: "", unit })}
                      {num(q.price_base) >= 1e9 ? " میلیون" : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            ))}
          </div>

          {positions.length ? (
            <>
              <div className="db-sub">
                <span>موضع ارزها</span>
              </div>
              <div className="db-list db-l-pos">
                <div className="db-list-h">
                  <span>ارز</span>
                  <span className="text-end">موجودی</span>
                  <span className="text-end">ارزش روز</span>
                </div>
                {positions.map((p) => (
                  <button key={p.currency_id} type="button" className="db-row" onClick={go("fx/positions")}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="db-rate-h">
                        <span className="db-code">{p.code}</span>
                      </span>
                      <span className="db-cell muted">{p.name}</span>
                    </span>
                    <span className="db-num end">{holding(num(p.holdings), p.decimals ?? 2)}</span>
                    <span className="db-num end">{p.market_value !== null ? <Amt v={p.market_value} s={sc} /> : <span className="db-zero">بی‌نرخ</span>}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="db-divider" />
          <div className="db-strip" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", columnGap: 20 }}>
            <Stat label="معاملات امروز" onClick={go("fx/deals")}>
              <Count n={s.day?.count ?? 0} />
            </Stat>
            <Stat label="حجم امروز">
              <Amt v={s.day?.volume} s={sc} />
            </Stat>
            {profit !== null ? (
              <Stat label="سود و کارمزد امروز" tone={profit > 0 ? "in" : undefined}>
                <Amt v={profit} s={sc} />
              </Stat>
            ) : null}
            <Stat label="حواله‌های باز" onClick={go("fx/remittances")} tone={openRem ? "warning" : undefined}>
              {openRem ? <Count n={openRem} /> : <span className="db-zero">—</span>}
            </Stat>
          </div>
        </>
      )}
    </Card>
  );
}

registerWidget({ key: "fx", module: "fx", order: 15, render: () => <FxWidget /> });
