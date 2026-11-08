// «تنظیمات درخواست خدمت»: the module's one settings row (auto-confirmation of deliveries, reminders and auto-cancel of
// items waiting for the requester, the statistics window, the default fulfilment group and calendar) on its record
// page, and «افزودن پیش‌فرض‌ها», which adds the starter IT catalogue, its flows, approval rules, SLAs and
// notifications again where they were deleted (nothing that exists is changed).
import { Alert, Button, Popconfirm } from "antd";
import { DatabaseZap } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Loader, EmptyState } from "../../components/display";
import { ICON } from "../../components/blocks";
import { RecordPage, useRecordList } from "../../records";
import { requestApi, useRequestConfig, useRequestRefresh } from "./api";

export default function Settings() {
  const { api } = useOrg();
  const cfg = useRequestConfig();
  const refresh = useRequestRefresh();
  const list = useRecordList("request_config", { size: 1, sort: "created_at" });
  const seed = useAction(() => requestApi.seed(api), {
    success: (r) => (Object.keys(r.created).length ? `پیش‌فرض‌ها افزوده شد: ${Object.values(r.created).reduce((a, b) => a + b, 0).toLocaleString("fa-IR")} مورد` : "همهٔ پیش‌فرض‌ها از پیش بودند."),
    onSuccess: () => {
      void list.refetch();
      void refresh.all();
    },
  });
  const row = list.data?.rows[0];
  const canAdmin = !!cfg.data?.can_admin;
  return (
    <>
      <PageHeader
        title="تنظیمات درخواست خدمت"
        actions={
          canAdmin ? (
            <Popconfirm title="کاتالوگ فناوری اطلاعات، گردش‌کارها، قاعده‌های تأیید، توافق‌ها و اعلان‌های پیش‌فرض هر جا حذف شده‌اند دوباره افزوده شوند؟" okText="بیفزا" cancelText="انصراف" onConfirm={() => seed.mutate(undefined)}>
              <Button icon={<DatabaseZap {...ICON} />} loading={seed.isPending}>
                افزودن پیش‌فرض‌ها
              </Button>
            </Popconfirm>
          ) : null
        }
      />
      {list.isLoading ? <Loader /> : null}
      {list.error ? <Alert type="error" title={errorText(list.error)} /> : null}
      {row ? <RecordPage table="request_config" id={row.id} /> : !list.isLoading ? <EmptyState title="تنظیمات هنوز ساخته نشده است" description="پیش‌فرض‌ها چند دقیقه پس از ساخت سازمان افزوده می‌شوند؛ می‌توانید همین حالا آن‌ها را بیفزایید" /> : null}
    </>
  );
}
