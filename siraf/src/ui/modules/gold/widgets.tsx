// Dashboard widget of the gold module: the 18-karat gram price with its change and a 30-rate sparkline, the weights
// in stock (showcase, used and melted gold, 3 decimals in ink) and today's and this month's sales. On the dashboard
// gold is shown in plain ink: the gold material stays inside «طلا» (components.md §0.4).
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Button } from "antd";
import { Gem, LineChart, Plus } from "lucide-react";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { Ic } from "../../components/shell/icons";
import { fa, grams, jDate, jTime } from "../../lib/fa";
import { Amt, Card, Count, Delta, Empty, HeadLink, Sk, Sparkline, Stat, num, useScale } from "../dashboard/kit";

function GoldWidget() {
  const { can } = useOrg();
  return can("gold", "view") ? <GoldCard /> : null;
}

function Weight({ g }: { g: unknown }) {
  const n = num(g);
  if (!n) return <span className="db-zero">—</span>;
  return (
    <>
      {grams(n)}
      <span className="db-unit">گرم</span>
    </>
  );
}

function GoldCard() {
  const { api, orgId, can, unit } = useOrg();
  const nav = useNavigate();
  const go = (p: string) => () => nav(`/${orgId}/${p}`);
  const q = useQuery({ queryKey: ["gold-summary", orgId], queryFn: () => api.get("/gold/summary"), refetchInterval: 60_000 });
  const hist = useQuery({
    queryKey: ["gold-rates-spark", orgId],
    queryFn: () => api.get<{ rows: { at: string; gram18: string | null }[] }>("/gold/rates", { size: 30 }),
    staleTime: 5 * 60_000,
  });
  const d = q.data;
  const r = d?.rate?.rate;
  const spark = (hist.data?.rows ?? [])
    .filter((x) => num(x.gram18) > 0)
    .map((x) => num(x.gram18))
    .reverse();
  const sc = useScale(d ? [d.sales_today?.total, d.sales_month?.total] : [], 5);
  const at = r?.at ? new Date(r.at) : null;
  const sameDay = at ? jDate(at) === jDate(new Date()) : false;
  const nothing = d && !r && !num(d.stock?.pieces) && !num(d.sales_month?.count);

  return (
    <Card
      title="طلا و جواهر"
      caption={d && !nothing ? `فروش به ${sc.unit}` : undefined}
      end={
        <>
          <HeadLink icon={LineChart} onClick={go("gold/rates")}>
            تابلوی قیمت
          </HeadLink>
          {can("gold", "edit") ? (
            <HeadLink icon={Plus} onClick={go("gold/sale/new")}>
              فروش
            </HeadLink>
          ) : null}
        </>
      }
      label="طلا و جواهر"
    >
      {!d ? (
        <>
          <Sk w="40%" h={10} />
          <Sk w="55%" h={26} style={{ marginBlockStart: 10 }} />
          <div className="mt-6 grid grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Sk w="50%" h={10} />
                <Sk w="80%" h={16} />
              </div>
            ))}
          </div>
        </>
      ) : nothing ? (
        <Empty
          icon={Gem}
          title="هنوز نرخ و جنسی ثبت نشده."
          text="با ثبت نرخ روز و اجناس ویترین، قیمت و موجودی اینجا می‌آید."
          action={
            can("gold", "edit") ? (
              <Button icon={<Ic icon={LineChart} />} onClick={go("gold/rates")}>
                ثبت نرخ روز
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="db-price">
            <div className="min-w-0">
              <div className="db-price-l">هر گرم طلای ۱۸ عیار</div>
              <div className="db-price-v">
                {r?.gram18 ? (
                  <>
                    <span className="db-fig-n">{fa(num(r.gram18))}</span>
                    <span className="db-unit">{unit}</span>
                  </>
                ) : (
                  <span className="db-zero">نرخ امروز ثبت نشده</span>
                )}
              </div>
              <div className="db-price-f">
                {d.rate?.change_pct !== null && d.rate?.change_pct !== undefined ? <Delta ratio={num(d.rate.change_pct) / 100} dp={2} title="نسبت به نرخ پیشین" /> : null}
                {r?.mazaneh ? (
                  <span>
                    مظنه <span className="sf-num">{fa(num(r.mazaneh))}</span>
                  </span>
                ) : null}
                {at ? <span className="sf-num">{sameDay ? jTime(at) : jDate(at)}</span> : null}
              </div>
            </div>
            {spark.length > 1 ? <Sparkline values={spark} h={44} label={`روند ${fa(spark.length)} نرخ اخیر گرم ۱۸ عیار`} /> : <span />}
          </div>

          <div className="db-divider" />

          <div className="db-weights">
            <div className="db-w">
              <span className="db-w-l">موجودی ویترین (۷۵۰)</span>
              <span className="db-w-v">
                <Weight g={d.stock?.w750} />
              </span>
              <span className="db-w-f">
                <Count n={num(d.stock?.pieces)} /> جنس{d.stock?.consigned ? <>، {fa(d.stock.consigned)} امانی</> : null}
              </span>
            </div>
            <div className="db-w">
              <span className="db-w-l">طلای مستعمل</span>
              <span className="db-w-v">
                <Weight g={d.ledger?.gold_old?.w} />
              </span>
            </div>
            <div className="db-w">
              <span className="db-w-l">طلای آبشده</span>
              <span className="db-w-v">
                <Weight g={d.ledger?.gold_bullion?.w} />
              </span>
            </div>
          </div>

          <div className="db-divider" />

          <div className="db-strip is-2">
            <Stat label="فروش امروز" onClick={go("gold/docs")} foot={<><Count n={num(d.sales_today?.count)} /> فاکتور{num(d.sales_today?.weight750) ? <>، {grams(num(d.sales_today.weight750))} گرم</> : null}</>}>
              <Amt v={d.sales_today?.total} s={sc} />
            </Stat>
            <Stat label="فروش این ماه" foot={<><Count n={num(d.sales_month?.count)} /> فاکتور{num(d.sales_month?.weight750) ? <>، {grams(num(d.sales_month.weight750))} گرم</> : null}</>}>
              <Amt v={d.sales_month?.total} s={sc} />
            </Stat>
          </div>
        </>
      )}
    </Card>
  );
}

registerWidget({ key: "gold", module: "gold", order: 30, render: () => <GoldWidget /> });
