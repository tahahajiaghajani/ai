// «تنظیمات تغییر»: the module's settings row (risk bands, notice, CAB, PIR, automatic behaviours) opened as a record,
// the definitions it works with (models, the risk questionnaire, CABs, windows, templates, approval and notification
// rules), adding the defaults again, and blackouts made from the official holidays of a Jalali year.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, InputNumber, Modal, Segmented, Space } from "antd";
import { Settings2, Plus, CalendarX } from "lucide-react";
import { currentJalaliYear, todayISO } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Loader } from "../../components/display";
import { Card, ICON14 } from "../../components/blocks";
import { recordPath, recordsApi, tablePath } from "../../records";
import { changeApi, useChangeRefresh } from "./api";

const DEFINITIONS: { table: string; label: string; hint: string }[] = [
  { table: "change_model", label: "مدل‌های تغییر", hint: "مرحله‌ها، فیلدهای الزامی و قفل هر مرحله، CAB و بازبینی" },
  { table: "change_risk_question", label: "پرسش‌نامهٔ ریسک", hint: "پرسش‌ها، گزینه‌ها و امتیاز و وزن هر پاسخ" },
  { table: "cab", label: "هیئت‌های CAB", hint: "اعضا، رئیس جلسه، روز و ساعت جلسه‌های هفتگی" },
  { table: "change_window", label: "پنجره‌های زمانی", hint: "نگهداری، ممنوعیت و انجماد؛ تکرار به تقویم شمسی" },
  { table: "change_template", label: "الگوها و تغییرهای استاندارد", hint: "تغییرهای از پیش مجاز با کارها و برنامه‌های آماده" },
  { table: "approval_rule", label: "قاعده‌های تأیید", hint: "ماتریس اختیار: چه کسی کدام تغییر را تأیید می‌کند" },
  { table: "notification_rule", label: "قاعده‌های اعلان", hint: "اعلان‌های تغییر: رد، تأیید، شروع پنجره، تداخل…" },
];

export default function Settings() {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const refresh = useChangeRefresh();
  const [holidays, setHolidays] = useState(false);
  const [year, setYear] = useState(() => currentJalaliYear(todayISO(timezone)));
  const [enforcement, setEnforcement] = useState<"warn" | "block">("warn");
  const cfg = useQuery({ queryKey: ["change", orgId, "config-row"], queryFn: () => recordsApi.list(api, "change_config", { size: 1, sort: "created_at", fields: ["name", "seeded"], total: false }) });
  const seed = useAction(() => changeApi.seed(api, true), {
    success: (d) => {
      const n = Object.values(d.created).reduce((a, b) => a + b, 0);
      return n ? `${n} پیش‌فرض افزوده شد.` : "همهٔ پیش‌فرض‌ها از پیش بودند.";
    },
    onSuccess: () => {
      refresh();
      void cfg.refetch();
    },
  });
  const fromHolidays = useAction(() => changeApi.fromHolidays(api, year, enforcement), {
    success: (d) => (d.created ? `${d.created} دورهٔ ممنوعیت از تعطیلات ساخته شد.` : "دورهٔ تازه‌ای لازم نبود."),
    onSuccess: () => {
      setHolidays(false);
      refresh();
    },
  });
  const row = cfg.data?.rows[0];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="تنظیمات تغییر"
        actions={
          <Space wrap>
            <Button icon={<CalendarX {...ICON14} />} onClick={() => setHolidays(true)}>
              ممنوعیت از تعطیلات رسمی
            </Button>
            <Button icon={<Plus {...ICON14} />} loading={seed.isPending} onClick={() => seed.mutate(undefined)}>
              افزودن پیش‌فرض‌ها
            </Button>
          </Space>
        }
      />
      {cfg.isLoading ? (
        <Loader />
      ) : row ? (
        <Card title="آستانه‌ها و سیاست‌ها">
          <Button icon={<Settings2 {...ICON14} />} onClick={() => nav(`/${orgId}/${recordPath("change_config", row.id)}`)}>
            ویرایش تنظیمات
          </Button>
        </Card>
      ) : (
        <Card title="آستانه‌ها و سیاست‌ها">
          <p className="text-ink-3">تنظیمات هنوز ساخته نشده است؛ «افزودن پیش‌فرض‌ها» آن را با مقدارهای پیشنهادی می‌سازد.</p>
        </Card>
      )}
      <div className="chg-cards grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {DEFINITIONS.map((d) => (
          <Link key={d.table} to={`/${orgId}/${tablePath(d.table)}`} className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3 hover:bg-raised">
            <span className="font-medium text-ink">{d.label}</span>
            <span className="text-[12px] text-ink-3">{d.hint}</span>
          </Link>
        ))}
      </div>
      <Modal open={holidays} title="ممنوعیت تغییر در تعطیلات رسمی" okText="ساخت" cancelText="انصراف" destroyOnHidden onCancel={() => setHolidays(false)} onOk={() => fromHolidays.mutate(undefined)} okButtonProps={{ loading: fromHolidays.isPending }}>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2">
            <span>سال</span>
            <InputNumber min={1390} max={1500} value={year} onChange={(v) => setYear(Number(v) || year)} aria-label="سال شمسی" />
          </label>
          <Segmented value={enforcement} onChange={(v) => setEnforcement(v as "warn" | "block")} options={[{ value: "warn", label: "فقط هشدار" }, { value: "block", label: "جلوگیری" }]} />
          <p className="text-[12px] text-ink-3">برای هر تعطیل رسمی (و تعطیلات پشت سر هم) یک دورهٔ ممنوعیت ساخته می‌شود؛ تغییرهای اضطراری مستثنا هستند.</p>
        </div>
      </Modal>
    </div>
  );
}
