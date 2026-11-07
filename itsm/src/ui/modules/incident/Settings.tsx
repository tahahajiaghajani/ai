// «تنظیمات رخداد و مشکل»: the two settings rows of the modules (their forms open on their own pages), «افزودن
// پیش‌فرض‌ها» (categories, the priority matrix, SLAs, assignment groups and rules, notification rules, templates and
// canned responses — what an administrator deleted is added again), and the way to the shared rules the modules use.
import { useNavigate } from "react-router";
import { Button, Popconfirm } from "antd";
import { RotateCcw, Pencil } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { Loader } from "../../components/display";
import { recordPath, tablePath, useRecordList, useRefreshSchema } from "../../records";
import { incidentApi } from "./api";

const LINKS: [string, string][] = [
  ["category", "دسته‌بندی‌ها (رخداد و مشکل)"],
  ["sla_definition", "توافق‌های سطح خدمت"],
  ["assignment_rule", "قاعده‌های ارجاع"],
  ["priority_matrix", "ماتریس‌های اولویت"],
  ["notification_rule", "قاعده‌های اعلان"],
  ["ui_policy", "سیاست‌های فرم"],
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="ds-num text-ink">{value}</dd>
    </>
  );
}

const days = (v: unknown) => (Number(v) > 0 ? `${Number(v).toLocaleString("fa-IR")} روز` : "خاموش");
const yes = (v: unknown) => (v ? "بله" : "خیر");

export default function Settings() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const refreshSchema = useRefreshSchema();
  const inc = useRecordList("incident_config", { size: 1, total: false });
  const prob = useRecordList("problem_config", { size: 1, total: false });
  const seed = useAction(() => incidentApi.seed(api), {
    success: (d) => {
      const n = Object.values(d.incident.created).reduce((a, b) => a + b, 0) + Object.values(d.problem.created).reduce((a, b) => a + b, 0);
      return n ? `${n.toLocaleString("fa-IR")} مورد پیش‌فرض افزوده شد.` : "همهٔ پیش‌فرض‌ها از پیش وجود داشتند.";
    },
    onSuccess: () => {
      void inc.refetch();
      void prob.refetch();
      refreshSchema();
    },
  });
  const i = inc.data?.rows[0];
  const p = prob.data?.rows[0];
  return (
    <div>
      <PageHeader
        title="تنظیمات رخداد و مشکل"
        actions={
          <Popconfirm title="پیش‌فرض‌های رخداد و مشکل افزوده شوند؟" description="آنچه هست تغییر نمی‌کند؛ موارد حذف‌شده دوباره افزوده می‌شوند." okText="افزودن" cancelText="انصراف" onConfirm={() => seed.mutate(undefined)}>
            <Button icon={<RotateCcw {...ICON14} />} loading={seed.isPending}>
              افزودن پیش‌فرض‌ها
            </Button>
          </Popconfirm>
        }
      />
      {inc.isLoading || prob.isLoading ? (
        <Loader />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="رخدادها" tools={i ? <Button size="small" icon={<Pencil {...ICON14} />} onClick={() => nav(`/${orgId}/${recordPath("incident_config", i.id)}`)}>ویرایش</Button> : undefined}>
            {i ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                <Row label="بستن خودکار پس از حل" value={days(i.auto_close_days)} />
                <Row label="مهلت بازگشایی" value={days(i.reopen_window_days)} />
                <Row label="یادآوری انتظار درخواست‌دهنده" value={days(i.follow_up_days)} />
                <Row label="فاصلهٔ پیش‌فرض اطلاع‌رسانی رخداد عمده" value={`${Number(i.mi_default_cadence ?? 0).toLocaleString("fa-IR")} دقیقه`} />
                <Row label="هر رخداد عمده یک مشکل بگیرد" value={yes(i.mi_auto_problem)} />
                <Row label="حل والد، فرزندان را حل کند" value={yes(i.cascade_children)} />
              </dl>
            ) : (
              <p className="text-[13px] text-ink-3">تنظیمات هنوز ساخته نشده است؛ «افزودن پیش‌فرض‌ها» را بزنید.</p>
            )}
          </Card>
          <Card title="مشکلات" tools={p ? <Button size="small" icon={<Pencil {...ICON14} />} onClick={() => nav(`/${orgId}/${recordPath("problem_config", p.id)}`)}>ویرایش</Button> : undefined}>
            {p ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                <Row label="یادآوری بی‌فعالیتی" value={days(p.inactivity_days)} />
                <Row label="پایش پس از رفع" value={days(p.monitoring_days)} />
                <Row label="بازهٔ بررسی تکرار" value={days(p.candidate_window_days)} />
                <Row label="حداقل رخداد برای نامزدی" value={Number(p.candidate_min_incidents ?? 0).toLocaleString("fa-IR")} />
                <Row label="رفع مشکل، رخدادهای منتظر را حل کند" value={yes(p.resolve_waiting_incidents)} />
              </dl>
            ) : (
              <p className="text-[13px] text-ink-3">تنظیمات هنوز ساخته نشده است؛ «افزودن پیش‌فرض‌ها» را بزنید.</p>
            )}
          </Card>
          <Card title="قاعده‌های مشترک" className="lg:col-span-2">
            <ul className="flex flex-wrap gap-2">
              {LINKS.map(([table, label]) => (
                <li key={table}>
                  <Button size="small" onClick={() => nav(`/${orgId}/${tablePath(table)}`)}>
                    {label}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
