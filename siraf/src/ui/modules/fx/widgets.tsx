// Dashboard widget of the fx module: live prices (BTC, ETH, USDT) and the board's dollar rate,
// with today's deals, profit and open remittances.
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useNavigate } from "react-router";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { Section } from "../../components/layout";
import { Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { Change, CurrencyChip, rateLabel, useLive } from "./shared";

function FxWidget() {
  const { can } = useOrg();
  return can("fx", "view") ? <FxSummary /> : null;
}

function FxSummary() {
  const { api, orgId, can, unit, org } = useOrg();
  const nav = useNavigate();
  const sum = useQuery({ queryKey: ["fx-summary", orgId], queryFn: () => api.get("/fx/summary"), refetchInterval: 60_000 });
  const live = useLive(["BTC", "ETH", "USDT"]);
  const s = sum.data;
  const usd = s?.board?.find((b: any) => b.code === "USD");
  const baseDp = org.money_decimals ?? 0;
  return (
    <Section
      title="صرافی امروز"
      extra={
        <div className="flex gap-1">
          <Button size="small" type="link" onClick={() => nav(`/${orgId}/fx/rates`)}>تابلوی نرخ</Button>
          {can("fx", "edit") ? <Button size="small" type="primary" onClick={() => nav(`/${orgId}/fx/deals/new`)}>معامله‌ی جدید</Button> : null}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {usd ? (
          <div className="tz-soft px-3 py-2">
            <div className="flex items-center justify-between"><CurrencyChip c={{ code: "USD", kind: "fiat" }} /><span className="text-[10px] text-muted">{unit}</span></div>
            <div className="num mt-1 text-sm font-bold">{usd.buy ? rateLabel(usd.buy, baseDp) : "—"}</div>
            <div className="num text-[11px] text-muted">فروش {usd.sell ? rateLabel(usd.sell, baseDp) : "—"}</div>
          </div>
        ) : null}
        {(live.data?.quotes ?? []).map((q) => (
          <div key={q.code} className="tz-soft px-3 py-2">
            <div className="flex items-center justify-between"><CurrencyChip c={{ code: q.code, kind: q.kind }} /><Change pct={q.change_24h} /></div>
            <div className="num ltr mt-1 text-start text-sm font-bold">{q.price_usd ? `$${formatNumber(q.price_usd, { dp: D(q.price_usd).lt(10) ? 4 : 0 })}` : "—"}</div>
            <div className="num truncate text-[11px] text-muted">{q.price_base ? `${rateLabel(q.price_base, baseDp)} ${unit}` : ""}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><div className="text-[11px] text-muted">معاملات امروز</div><b className="num">{faDigits(s?.day?.count ?? 0)}</b></div>
        <div><div className="text-[11px] text-muted">حجم امروز</div><b><Money v={s?.day?.volume ?? 0} /></b></div>
        {s?.day?.profit !== null && s?.day?.profit !== undefined ? <div><div className="text-[11px] text-muted">سود و کارمزد امروز</div><b><Money v={D(s.day.profit).plus(D(s.day.fees ?? 0)).toFixed()} colored /></b></div> : null}
        <div className="cursor-pointer" onClick={() => nav(`/${orgId}/fx/remittances`)}>
          <div className="text-[11px] text-muted">حواله‌های باز</div>
          <b className="num">{faDigits((s?.remittances?.out_open ?? 0) + (s?.remittances?.in_open ?? 0))}</b>
        </div>
      </div>
    </Section>
  );
}

registerWidget({ key: "fx", module: "fx", order: 40, render: () => <FxWidget /> });
