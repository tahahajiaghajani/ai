// «پیشخوان»: greeting and date, the period control, the hero (cash and bank, with its scrubbable area chart), one
// stat grid of four KPI tiles, income and expense by month, the module widgets and the latest vouchers.
// Rules: components.md §2 (header and filters), §3 (hero and KPIs), §4.4 (strips), §7–8 (empty, skeleton), §10 (charts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dropdown, Segmented, Space, type MenuProps } from "antd";
import { useNavigate } from "react-router";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  ArrowLeftRight,
  ChartColumn,
  ChevronDown,
  FilePlus2,
  FileText,
  Gem,
  HandCoins,
  History,
  Plus,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { PageHeader } from "../../components/layout";
import { ChequeIcon, Ic } from "../../components/shell/icons";
import { docNo, fa, jDate, jLong, jTime, pct } from "../../lib/fa";
import { stagger } from "../../lib/motion";
import { todayISO } from "@shared/jalali";
import { getWidgets } from "./widgets";
import { Hero } from "./Hero";
import {
  PERIODS,
  PERIOD_LABEL,
  nextSevenDays,
  periodSpec,
  useCashSeries,
  usePeriodPL,
  type Period,
} from "./data";
import {
  Amt,
  Card,
  Count,
  Delta,
  Empty,
  Figure,
  HeadLink,
  MiniBars,
  PairBars,
  Sep,
  Sk,
  SkRows,
  WeekDots,
  num,
  ratioOf,
  scaled,
  useScale,
  usePref,
  type Scale,
} from "./kit";
import "./register";

let entered = false; // the KPI tiles enter (staggered) on the first load of a session only

const isoDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

function greeting() {
  const h = new Date().getHours();
  return h < 5
    ? "شب بخیر"
    : h < 12
      ? "صبح بخیر"
      : h < 17
        ? "روز بخیر"
        : h < 20
          ? "عصر بخیر"
          : "شب بخیر";
}

export default function Dashboard() {
  const { api, orgId, has, can, unit, info, org } = useOrg();
  const { me } = useSession();
  const today = todayISO(org.settings?.timezone || "Asia/Tehran");
  const fy =
    info.fiscal_years.find(
      (f) => f.start_date <= today && f.end_date >= today,
    ) ?? null;

  const [period, setPeriod] = usePref<Period>(
    `siraf.dash.period.${orgId}`,
    "month",
    PERIODS,
  );
  const [compare, setCompare] = useState(true);
  const spec = useMemo(
    () => periodSpec(period, today, fy?.start_date),
    [period, today, fy?.start_date],
  );

  const q = useQuery({
    queryKey: ["dashboard", orgId],
    queryFn: () => api.get("/dashboard"),
    refetchInterval: 60_000,
  });
  const d = q.data;
  const treasury = useQuery({
    queryKey: ["treasury-summary", orgId],
    queryFn: () => api.get("/treasury/summary"),
    enabled: can("treasury", "view"),
    refetchInterval: 60_000,
  });
  const cashTotal = d ? num(d.totals.cash) + num(d.totals.bank) : null;
  const series = useCashSeries(spec, cashTotal);
  const pl = usePeriodPL(spec);

  const first = useRef(!entered);
  useEffect(() => {
    entered = true;
  }, []);

  const name = me?.user.full_name?.split(" ")[0] ?? "";
  return (
    <div className="db">
      <PageHeader
        title={name ? `${greeting()}، ${name}` : greeting()}
        subtitle={jLong(isoDate(today))}
        actions={<HeaderActions />}
      />

      <div className="db-filters">
        <Segmented<Period>
          size="small"
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
          aria-label="دوره"
        />
        {period !== "today" &&
        series !== undefined &&
        (series === null || series.previous.length > 0) ? (
          <button
            type="button"
            className="db-fchip sf-press"
            aria-pressed={compare}
            onClick={() => setCompare((c) => !c)}
          >
            <Ic icon={History} />
            مقایسه با دورهٔ پیش
          </button>
        ) : null}
        <span className="db-fresh" aria-live="polite">
          <span
            className="sf-nuqta"
            data-live={q.isFetching ? undefined : ""}
          />
          {q.isLoading
            ? "در حال بارگذاری"
            : q.isFetching
              ? "در حال به‌روزرسانی"
              : "به‌روز"}
          {q.dataUpdatedAt ? (
            <>
              <span className="db-sep" aria-hidden />
              <span className="db-time">{jTime(q.dataUpdatedAt)}</span>
            </>
          ) : null}
        </span>
      </div>

      <div className={`db-top ${first.current ? "is-enter" : ""}`}>
        <Hero
          total={cashTotal}
          series={d ? series : null}
          spec={spec}
          compare={compare}
          unit={unit}
        />
        <Kpis
          d={d}
          pl={pl}
          spec={spec}
          treasury={treasury.data}
          enter={first.current}
        />
      </div>

      <div className={`db-grid ${first.current ? "sf-stagger" : ""}`}>
        <TrendCard trend={d?.trend} />
        <RecentCard rows={d?.recent} />
        {getWidgets()
          .filter((w) => !w.module || has(w.module))
          .map((w) => (
            <WidgetSlot key={w.key} span={w.span}>
              {w.render()}
            </WidgetSlot>
          ))}
        {!can("treasury", "view") ? <ChequesCard rows={d?.cheques} /> : null}
      </div>
    </div>
  );
}

/** A widget renders null when its user lacks the permission; `display: contents` keeps the grid flowing then. */
function WidgetSlot({ span, children }: { span?: 1 | 2; children: ReactNode }) {
  return (
    <div className={`db-slotw ${span === 2 ? "db-span-2" : ""}`}>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ header actions: default + primary (§2)

function HeaderActions() {
  const { orgId, has, can } = useOrg();
  const nav = useNavigate();
  const acts: { key: string; label: string; icon: LucideIcon; path: string }[] =
    [];
  if (has("goods") && can("sales", "edit"))
    acts.push({
      key: "sale",
      label: "فاکتور فروش",
      icon: Receipt,
      path: "sales/invoices/new",
    });
  if (has("gold") && can("gold", "edit"))
    acts.push({
      key: "gold",
      label: "فروش طلا",
      icon: Gem,
      path: "gold/sale/new",
    });
  if (has("fx") && can("fx", "edit"))
    acts.push({
      key: "fx",
      label: "معاملهٔ ارز",
      icon: ArrowLeftRight,
      path: "fx/deals/new",
    });
  const voucher = can("accounting", "edit");
  const [main, ...rest] = acts;
  const menu: MenuProps = {
    items: rest.map((a) => ({
      key: a.key,
      label: a.label,
      icon: <Ic icon={a.icon} />,
    })),
    onClick: ({ key }) => {
      const a = rest.find((x) => x.key === key);
      if (a) nav(`/${orgId}/${a.path}`);
    },
  };
  return (
    <>
      {voucher ? (
        <Button
          icon={<Ic icon={FilePlus2} />}
          onClick={() => nav(`/${orgId}/accounting/vouchers/new`)}
        >
          سند جدید
        </Button>
      ) : null}
      {main ? (
        rest.length ? (
          <Space.Compact>
            <Button
              type="primary"
              icon={<Ic icon={Plus} />}
              onClick={() => nav(`/${orgId}/${main.path}`)}
            >
              {main.label}
            </Button>
            <Dropdown
              menu={menu}
              trigger={["click"]}
              placement="bottomLeft"
              rootClassName="sf-glass"
            >
              <Button
                type="primary"
                icon={<Ic icon={ChevronDown} />}
                aria-label="ثبت‌های دیگر"
              />
            </Dropdown>
          </Space.Compact>
        ) : (
          <Button
            type="primary"
            icon={<Ic icon={Plus} />}
            onClick={() => nav(`/${orgId}/${main.path}`)}
          >
            {main.label}
          </Button>
        )
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ KPI tiles: one stat grid (§3.2)

function Kpi({
  icon,
  label,
  i,
  enter,
  onClick,
  children,
}: {
  icon: LucideIcon;
  label: string;
  i: number;
  enter: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const body = (
    <>
      <div className="db-kpi-label">
        <Ic icon={icon} />
        <span>{label}</span>
      </div>
      {children}
    </>
  );
  const cls = `db-kpi ${onClick ? "is-link" : ""}`;
  const inner = (
    <div
      className={`flex min-h-0 flex-1 flex-col ${enter ? "sf-enter" : ""}`}
      style={enter ? stagger(i) : undefined}
    >
      {body}
    </div>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <section className={cls}>{inner}</section>
  );
}

const FootSk = () => (
  <div className="db-kpi-foot" aria-hidden>
    <Sk w="58%" h={10} />
  </div>
);

function KpiValue({
  v,
  s,
  id,
  loading,
}: {
  v: number | null;
  s: Scale;
  id: string;
  loading?: boolean;
}) {
  if (loading || v === null)
    return (
      <div className="db-kpi-val" aria-busy="true">
        <Sk w="62%" h={22} r={6} />
      </div>
    );
  if (v === 0)
    return (
      <div className="db-kpi-val is-zero">
        <span className="db-fig-n">—</span>
      </div>
    );
  return <Figure id={id} text={scaled(v, s)} unit={s.unit} />;
}

function Kpis({
  d,
  pl,
  spec,
  treasury,
  enter,
}: {
  d: any;
  pl: ReturnType<typeof usePeriodPL>;
  spec: ReturnType<typeof periodSpec>;
  treasury: any;
  enter: boolean;
}) {
  const { orgId, can } = useOrg();
  const nav = useNavigate();
  const go = (p: string) => () => nav(`/${orgId}/${p}`);
  const income = pl.cur ? num(pl.cur.total_income) : null;
  const net = pl.cur ? num(pl.cur.net) : null;
  const expense = pl.cur ? num(pl.cur.total_expense) : null;
  const prevIncome = pl.prev ? num(pl.prev.total_income) : null;
  const prevNet = pl.prev ? num(pl.prev.net) : null;
  const ar = d ? num(d.totals.receivable) : null;
  const ap = d ? num(d.totals.payable) : null;

  // cheques of the next seven days: exact sums from the treasury summary, the days from its list (and the dashboard's)
  const days = nextSevenDays(spec.to);
  const chq: any[] = [
    ...(treasury?.upcoming ?? []),
    ...(d?.cheques ?? []),
  ].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  const recvWeek = treasury
    ? num(treasury.cheques.received_week.sum)
    : d
      ? chq
          .filter(
            (c) =>
              c.direction === "received" &&
              c.due_date >= spec.to &&
              c.due_date <= days[6].date,
          )
          .reduce((a, c) => a + num(c.amount), 0)
      : null;
  const recvN = treasury
    ? treasury.cheques.received_week.count
    : chq.filter((c) => c.direction === "received" && c.due_date >= spec.to)
        .length;
  const issuedN = treasury
    ? treasury.cheques.issued_week.count
    : chq.filter((c) => c.direction !== "received" && c.due_date >= spec.to)
        .length;
  const overdue = treasury
    ? treasury.cheques.received_overdue.count +
      treasury.cheques.issued_overdue.count
    : chq.filter((c) => c.due_date < spec.to).length;
  const perDay = days.map((x) =>
    chq.filter((c) => String(c.due_date).slice(0, 10) === x.date),
  );
  const nextDue = perDay.findIndex((x, i) => i > 0 && x.length > 0);
  const weekDays = days.map((x, i) => ({
    initial: x.initial,
    today: x.today,
    n: perDay[i].length,
    next: i === nextDue,
    overdue: i === 0 && overdue > 0,
    title: `${jDate(isoDate(x.date))}: ${perDay[i].length ? `${fa(perDay[i].length)} چک` : "بدون چک"}`,
  }));

  const s = useScale([income, net, ar, ap, recvWeek]);
  const trend: any[] = d?.trend ?? [];
  const hiNow = trend.length - 1;
  const loading = !d;

  return (
    <div className="db-card db-kpis" role="group" aria-label="شاخص‌ها">
      <Kpi
        icon={TrendingUp}
        label={`درآمد ${spec.phrase}`}
        i={0}
        enter={enter}
        onClick={
          can("reports", "view") ? go("reports/income-statement") : undefined
        }
      >
        <KpiValue v={income} s={s} id="k-income" loading={pl.loading} />
        <MiniBars
          values={trend.map((t) => num(t.income))}
          hi={hiNow}
          label={`درآمد شش ماه اخیر، ماه جاری پررنگ`}
        />
        {pl.loading ? (
          <FootSk />
        ) : (
          <div className="db-kpi-foot">
            {income !== null &&
            prevIncome !== null &&
            ratioOf(income, prevIncome) !== null ? (
              <>
                <Delta ratio={ratioOf(income, prevIncome)} />
                <span>
                  {spec.key === "today" ? "از دیروز" : "از دورهٔ پیش"}
                </span>
              </>
            ) : (
              <span>شش ماه اخیر</span>
            )}
          </div>
        )}
      </Kpi>

      <Kpi
        icon={ChartColumn}
        label={`سود خالص ${spec.phrase}`}
        i={1}
        enter={enter}
        onClick={
          can("reports", "view") ? go("reports/income-statement") : undefined
        }
      >
        <KpiValue v={net} s={s} id="k-net" loading={pl.loading} />
        <div className="db-mini">
          {pl.cur ? (
            <PairBars
              rows={[
                {
                  label: "درآمد",
                  v: income ?? 0,
                  text: scaled(income ?? 0, s),
                  hi: true,
                },
                {
                  label: "هزینه",
                  v: expense ?? 0,
                  text: scaled(expense ?? 0, s),
                },
              ]}
            />
          ) : (
            <Sk h={6} />
          )}
        </div>
        {pl.loading ? (
          <FootSk />
        ) : (
          <div className="db-kpi-foot">
            {net !== null &&
            prevNet !== null &&
            ratioOf(net, prevNet) !== null ? (
              <>
                <Delta ratio={ratioOf(net, prevNet)} />
                <span>
                  {spec.key === "today" ? "از دیروز" : "از دورهٔ پیش"}
                </span>
              </>
            ) : (
              <span>
                {net !== null && income ? (
                  <>حاشیه {pct(net / income)}</>
                ) : (
                  "درآمد منهای هزینه"
                )}
              </span>
            )}
          </div>
        )}
      </Kpi>

      <Kpi
        icon={HandCoins}
        label="طلب از اشخاص"
        i={2}
        enter={enter}
        onClick={
          can("reports", "view") ? go("reports/detail-balances") : undefined
        }
      >
        <KpiValue v={ar} s={s} id="k-ar" loading={loading} />
        <div className="db-mini">
          {d ? (
            <PairBars
              rows={[
                {
                  label: "طلب",
                  v: ar ?? 0,
                  text: scaled(ar ?? 0, s),
                  hi: true,
                },
                { label: "بدهی", v: ap ?? 0, text: scaled(ap ?? 0, s) },
              ]}
            />
          ) : (
            <Sk h={6} />
          )}
        </div>
        {loading ? (
          <FootSk />
        ) : (
          <div className="db-kpi-foot">
            {d && num(d.totals.cheques_receivable) ? (
              <span>
                چک‌های در دست <Amt v={d.totals.cheques_receivable} s={s} />
              </span>
            ) : (
              <span>بدهی به تأمین‌کنندگان</span>
            )}
          </div>
        )}
      </Kpi>

      <Kpi
        icon={ChequeIcon}
        label="چک‌های ۷ روز آینده"
        i={3}
        enter={enter}
        onClick={
          can("treasury", "view") ? go("treasury/cheques/due") : undefined
        }
      >
        <KpiValue v={recvWeek} s={s} id="k-chq" loading={loading} />
        <div className="db-mini">
          <WeekDots days={weekDays} />
        </div>
        {loading ? (
          <FootSk />
        ) : (
          <div className="db-kpi-foot">
            {overdue ? (
              <span className="db-chip danger fig">
                <span className="sf-nuqta" />
                <Count n={overdue} /> سررسیدگذشته
              </span>
            ) : (
              <>
                <span>
                  <Count n={recvN} /> دریافتی
                </span>
                <Sep />
                <span>
                  <Count n={issuedN} /> پرداختی
                </span>
              </>
            )}
          </div>
        )}
      </Kpi>
    </div>
  );
}

// ------------------------------------------------------------------ income and expense by month (§10, recharts)

function TrendCard({ trend }: { trend: any[] | undefined }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const rows = (trend ?? []).map((t) => ({
    month: t.month,
    income: num(t.income),
    expense: num(t.expense),
    profit: num(t.profit),
  }));
  const s = useScale(
    rows.flatMap((r) => [r.income, r.expense]),
    4,
  );
  const empty = trend && rows.every((r) => !r.income && !r.expense);
  return (
    <Card
      title="درآمد و هزینه"
      caption={trend && !empty ? `شش ماه اخیر، مبالغ به ${s.unit}` : undefined}
      end={
        trend && !empty ? (
          <div className="db-toggle" role="group" aria-label="نمایش">
            <button
              type="button"
              aria-pressed={view === "chart"}
              onClick={() => setView("chart")}
            >
              نمودار
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              جدول
            </button>
          </div>
        ) : null
      }
      label="درآمد و هزینهٔ شش ماه اخیر"
    >
      {!trend ? (
        <div
          className="db-bars flex items-end gap-6 px-4 pb-7"
          aria-busy="true"
        >
          {[0.4, 0.62, 0.5, 0.8, 0.55, 0.7].map((h, i) => (
            <Sk key={i} h={Math.round(h * 160)} r={4} />
          ))}
        </div>
      ) : empty ? (
        <Empty
          icon={ChartColumn}
          title="هنوز درآمد و هزینه‌ای ثبت نشده."
          text="با ثبت فروش و هزینه‌ها، روند شش ماه اینجا می‌آید."
        />
      ) : view === "table" ? (
        <div
          className="db-list"
          style={{
            ["--cols" as string]:
              "minmax(64px, 1fr) minmax(96px, auto) minmax(96px, auto) minmax(96px, auto)",
          }}
        >
          <div className="db-list-h">
            <span>ماه</span>
            <span className="text-end">درآمد</span>
            <span className="text-end">هزینه</span>
            <span className="text-end">سود</span>
          </div>
          {rows
            .slice()
            .reverse()
            .map((r) => (
              <div key={r.month} className="db-row">
                <span className="db-cell">{r.month}</span>
                <span className="db-num end">
                  <Amt v={r.income} s={s} dp={1} />
                </span>
                <span className="db-num end">
                  <Amt v={r.expense} s={s} dp={1} />
                </span>
                <span className="db-num end">
                  {r.profit ? (
                    <bdi dir="ltr">
                      {new Intl.NumberFormat("fa-IR", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                        signDisplay: "exceptZero",
                      }).format(r.profit / s.div)}
                    </bdi>
                  ) : (
                    <span className="db-zero">—</span>
                  )}
                </span>
              </div>
            ))}
        </div>
      ) : (
        <>
          <div
            className="db-bars"
            role="img"
            aria-label={`درآمد و هزینهٔ شش ماه اخیر: ${rows.map((r) => `${r.month} درآمد ${scaled(r.income, s)} هزینه ${scaled(r.expense, s)}`).join("، ")}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
                barGap={2}
                barCategoryGap="28%"
              >
                <CartesianGrid vertical={false} stroke="var(--sf-chart-grid)" />
                <XAxis
                  dataKey="month"
                  reversed
                  tickLine={false}
                  axisLine={{ stroke: "var(--sf-chart-axis)" }}
                  tick={{ fontSize: 12, fill: "var(--sf-text-3)" }}
                  interval={0}
                />
                <YAxis hide tickCount={3} />
                <Tooltip
                  cursor={{ fill: "var(--sf-hover)" }}
                  content={<TrendTip s={s} />}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="income"
                  name="درآمد"
                  fill="var(--sf-accent-line)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  animationDuration={500}
                  animationEasing="ease-out"
                />
                <Bar
                  dataKey="expense"
                  name="هزینه"
                  fill="var(--sf-chart-other)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  animationDuration={500}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="db-legend db-legend-s">
            <span>
              <i className="key-bar" />
              درآمد
            </span>
            <span>
              <i className="key-bar muted" />
              هزینه
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function TrendTip({
  active,
  payload,
  label,
  s,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  s: Scale;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="db-tip">
      <div className="db-tip-t">{label}</div>
      <div className="db-tip-r">
        <b>{scaled(row.income, s, 1)}</b>
        <i className="db-tip-k" />
        درآمد
      </div>
      <div className="db-tip-r">
        <b>{scaled(row.expense, s, 1)}</b>
        <i className="db-tip-k muted" />
        هزینه
      </div>
      <div className="db-tip-r">
        <b>
          <bdi dir="ltr">
            {new Intl.NumberFormat("fa-IR", {
              maximumFractionDigits: 1,
              minimumFractionDigits: 1,
              signDisplay: "exceptZero",
            }).format(row.profit / s.div)}
          </bdi>
        </b>
        سود، {s.unit}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ cheques due (when the treasury widget is not shown)

function ChequesCard({ rows }: { rows: any[] | undefined }) {
  const { orgId, unit } = useOrg();
  const nav = useNavigate();
  const today = todayISO();
  return (
    <Card
      title="چک‌های دو هفتهٔ آینده"
      caption={rows?.length ? `مبالغ به ${unit}` : undefined}
      end={
        <HeadLink onClick={() => nav(`/${orgId}/treasury/cheques`)}>
          همهٔ چک‌ها
        </HeadLink>
      }
    >
      {!rows ? (
        <SkRows rows={5} />
      ) : !rows.length ? (
        <Empty
          compact
          icon={ChequeIcon}
          title="چکی در دو هفتهٔ آینده سررسید نمی‌شود."
        />
      ) : (
        <div className="db-list db-l-chq">
          {rows.map((c) => (
            <div key={c.id} className="db-row">
              <span
                className={`db-num ${c.due_date < today ? "text-danger" : ""}`}
              >
                {jDate(isoDate(c.due_date))}
              </span>
              <span className="db-cell meta">
                {c.direction === "received" ? "دریافتی" : "پرداختی"}
              </span>
              <span className="db-cell muted">{c.party_name ?? "—"}</span>
              <span className="db-num end">{fa(num(c.amount))}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ latest vouchers

function RecentCard({ rows }: { rows: any[] | undefined }) {
  const { orgId, unit, can } = useOrg();
  const nav = useNavigate();
  return (
    <Card
      title="آخرین اسناد"
      caption={rows?.length ? `مبالغ به ${unit}` : undefined}
      end={
        <HeadLink onClick={() => nav(`/${orgId}/accounting/vouchers`)}>
          همهٔ اسناد
        </HeadLink>
      }
      label="آخرین اسناد"
    >
      {!rows ? (
        <SkRows rows={6} cols={[0.5, 0.7, 0.6, 0.8]} />
      ) : !rows.length ? (
        <Empty
          icon={FileText}
          title="هنوز سندی ثبت نشده."
          text="اسناد دستی و خودکار، تازه‌ترین‌ها اول، اینجا می‌آیند."
          action={
            can("accounting", "edit") ? (
              <Button
                icon={<Ic icon={FilePlus2} />}
                onClick={() => nav(`/${orgId}/accounting/vouchers/new`)}
              >
                سند جدید
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="db-list db-l-doc">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="db-row"
              onClick={() => nav(`/${orgId}/accounting/vouchers/${r.id}`)}
            >
              <span className="db-doc">سند {docNo(num(r.no))}</span>
              <span className="db-cell">
                {r.description || <span className="db-zero">بی‌شرح</span>}
              </span>
              <span className="db-num db-cell meta db-hide-sm">
                {jDate(isoDate(r.date))}
              </span>
              <span className="db-num end">
                {num(r.total_debit) ? (
                  fa(num(r.total_debit))
                ) : (
                  <span className="db-zero">—</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
