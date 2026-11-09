// «داشبورد دارایی‌ها» (catalogue ITAM-076): how many assets, where they are in their lifecycle, what needs attention
// (warranties and leases ending, acknowledgements waiting, stock below the reorder point, repairs, disposals), the
// licence position, renewals, and — for holders of the financial field group — purchase cost and book value. Every
// figure is computed by the server over what the person may read.
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Space } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Boxes, PackageSearch, QrCode, Radar, ShieldCheck } from "lucide-react";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { itamApi, ITAM_KEYS } from "./api";
import { ICON, Money } from "./parts";

const listOf = (path: string, filter: unknown) => `${path}?filter=${encodeURIComponent(JSON.stringify(filter))}`;

export default function Dashboard() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const meta = useQuery({ queryKey: ITAM_KEYS.meta(orgId), queryFn: () => itamApi.meta(api), staleTime: 300_000 });
  const q = useQuery({ queryKey: ITAM_KEYS.dashboard(orgId), queryFn: () => itamApi.dashboard(api), staleTime: 60_000 });
  const discovered = useMutation({
    mutationFn: () => itamApi.discovered(api),
    onSuccess: (r) => message.success(r.created ? `${fa(r.created)} دارایی برای سخت‌افزار کشف‌شده ساخته شد` : "سخت‌افزار کشف‌شدهٔ بی‌دارایی پیدا نشد"),
    onError: (e: Error) => message.error(e.message),
  });
  const go = (path: string) => () => nav(`/${orgId}/${path}`);
  const d = q.data;
  return (
    <div>
      <PageHeader
        title="داشبورد دارایی‌ها"
        actions={
          <Space wrap>
            <Button icon={<PackageSearch {...ICON} />} onClick={go("itam/stock")}>موجودی انبارها</Button>
            {meta.data?.software ? <Button icon={<ShieldCheck {...ICON} />} onClick={go("itam/compliance")}>انطباق مجوزها</Button> : null}
            <Button icon={<QrCode {...ICON} />} onClick={go("itam/labels")}>چاپ برچسب</Button>
            {meta.data?.can_manage ? <Button icon={<Radar {...ICON} />} loading={discovered.isPending} onClick={() => discovered.mutate()}>دارایی برای سخت‌افزار کشف‌شده</Button> : null}
          </Space>
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داده‌های دارایی در دسترس نیست" description="به دارایی‌ها دسترسی ندارید یا بارگذاری انجام نشد." />
      ) : !d.total ? (
        <EmptyState title="هنوز دارایی‌ای ثبت نشده است" description="دارایی‌ها را با رسید کالای سفارش خرید، ورود از اکسل یا ثبت دستی بسازید." icon={Boxes} action={<Button type="primary" onClick={go("assets/new")}>ثبت دارایی</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles ds-stagger">
            <StatCard title="دارایی" value={fa(d.total)} onClick={go("assets")} />
            <StatCard title="در انبار" value={fa(d.in_stock)} onClick={go(listOf("assets", { f: "state", op: "eq", v: "in_stock" }))} />
            <StatCard title="در استفاده" value={fa(d.in_use)} onClick={go(listOf("assets", { f: "state", op: "eq", v: "in_use" }))} />
            <StatCard title="مفقود" value={fa(d.missing)} onClick={go(listOf("assets", { f: "state", op: "eq", v: "missing" }))} />
            <StatCard title="پایان ضمانت تا ۹۰ روز" value={fa(d.warranty_expiring)} onClick={go("itam/warranty")} />
            <StatCard title="پایان اجاره تا ۹۰ روز" value={fa(d.lease_ending)} />
            <StatCard title="تعهدنامهٔ پاسخ‌نداده" value={fa(d.pending_acks)} onClick={go(listOf("itam/acknowledgements", { f: "state", op: "eq", v: "pending" }))} />
            <StatCard title="هشدار موجودی" value={fa(d.stock_alerts)} onClick={go("itam/stock")} />
            <StatCard title="تعمیر باز" value={fa(d.open_repairs)} onClick={go("itam/repairs")} />
            <StatCard title="اسقاط در جریان" value={fa(d.pending_disposal)} onClick={go("itam/disposals")} />
            {d.renewals_90 !== null ? <StatCard title="قرارداد رو به پایان (۹۰ روز)" value={fa(d.renewals_90)} onClick={go("supplier/renewals")} /> : null}
          </div>
          {d.money ? (
            <div className="itam-tiles">
              <StatCard title="بهای خرید دارایی‌ها" value={<Money v={d.money.purchase_cost} compact />} />
              <StatCard title="ارزش دفتری" value={<Money v={d.money.book_value} compact />} />
            </div>
          ) : null}
          {d.compliance ? (
            <Card title="مجوزهای نرم‌افزار" tools={<Button size="small" onClick={go("itam/compliance")}>جزئیات</Button>}>
              <div className="itam-tiles">
                <StatCard title="نرم‌افزار در تطبیق" value={fa(d.compliance.products)} hint={d.compliance.run_at ? `آخرین تطبیق ${formatJalali(d.compliance.run_at.slice(0, 10))}` : "هنوز تطبیق نشده"} />
                <StatCard title="کمبود مجوز" value={fa(d.compliance.under_licensed)} />
                {d.compliance.exposure !== null ? <StatCard title="ریسک کمبود" value={<Money v={d.compliance.exposure} compact />} /> : null}
                {d.compliance.savings !== null ? <StatCard title="صرفه‌جویی ممکن" value={<Money v={d.compliance.savings} compact />} /> : null}
              </div>
            </Card>
          ) : null}
          <div className="itam-two">
            <Card title="بر پایهٔ وضعیت">
              <div style={{ height: 220 }} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.by_state} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--ds-line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} interval={0} />
                    <YAxis width={32} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
                    <Tooltip formatter={(v) => [fa(Number(v)), "دارایی"]} />
                    <Bar dataKey="count" fill="var(--ds-chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="بر پایهٔ دسته">
              <ul className="itam-list">
                {d.by_category.map((c) => (
                  <li key={c.category}>
                    <button type="button" className="ds-link" onClick={go(listOf("assets", { f: "category", op: "eq", v: c.category }))}>{c.label}</button>
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
