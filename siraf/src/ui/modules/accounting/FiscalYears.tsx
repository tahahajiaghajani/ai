import { Button, Table, Alert, Space } from "antd";
import { LockOutlined, UnlockOutlined, PlusOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { JDate, StatusTag, Money } from "../../components/display";
import { toJalali } from "@shared/jalali";

export default function FiscalYears() {
  const { info, api, orgId, can } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const refresh = () => qc.invalidateQueries({ queryKey: ["org", orgId] });
  const close = useAction((id: string) => api.post(`/fiscal-years/${id}/close`), { onSuccess: (r: any) => { n.ok("سال مالی بسته شد و سند افتتاحیه‌ی سال بعد صادر شد"); refresh(); void r; } });
  const reopen = useAction((id: string) => api.post(`/fiscal-years/${id}/reopen`), { success: "سال مالی دوباره باز شد", onSuccess: refresh });
  const add = useAction((jy: number) => api.post("/fiscal-years", { jalali_year: jy }), { success: "سال مالی ساخته شد", onSuccess: refresh });
  const years = info.fiscal_years;
  const latest = years[0];
  return (
    <div>
      <PageHeader
        title="سال‌های مالی"
        actions={can("accounting", "full") && latest ? <Button icon={<PlusOutlined />} onClick={() => add.mutate(toJalali(latest.end_date).jy + 1)}>سال بعد</Button> : null}
      />
      <Alert
        className="!mb-4"
        type="info"
        showIcon
        title="بستن سال مالی"
        description="با بستن سال، حساب‌های درآمد و هزینه به «خلاصه‌ی سود و زیان» بسته می‌شوند، سود یا زیان به «سود و زیان انباشته» می‌رود، سند اختتامیه صادر و همان مانده‌ها (همراه با مبالغ ارزی و وزن طلا) با سند افتتاحیه به سال بعد منتقل می‌شود. هر وقت لازم شد می‌توانید سال را دوباره باز کنید."
      />
      <div className="tz-card p-3">
        <Table
          className="tz-table"
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={years}
          columns={[
            { key: "title", dataIndex: "title", title: "عنوان", render: (v) => <b>{v}</b> },
            { key: "start", dataIndex: "start_date", title: "از", render: (v) => <JDate v={v} /> },
            { key: "end", dataIndex: "end_date", title: "تا", render: (v) => <JDate v={v} /> },
            { key: "status", dataIndex: "status", title: "وضعیت", render: (v) => <StatusTag s={v} /> },
            {
              key: "a",
              title: "",
              render: (_, r) =>
                can("accounting", "full") ? (
                  <Space>
                    {r.status !== "closed" ? (
                      <Button size="small" icon={<LockOutlined />} loading={close.isPending} onClick={async () => { if (await n.confirm(`بستن ${r.title}؟`, "اسناد پیش‌نویس باید پیش از بستن ثبت یا حذف شوند.")) close.mutate(r.id); }}>
                        بستن سال و صدور افتتاحیه
                      </Button>
                    ) : (
                      <Button size="small" icon={<UnlockOutlined />} loading={reopen.isPending} onClick={async () => { if (await n.confirm(`باز کردن دوباره‌ی ${r.title}؟`, "اسناد بستن و افتتاحیه حذف می‌شوند.")) reopen.mutate(r.id); }}>
                        باز کردن دوباره
                      </Button>
                    )}
                  </Space>
                ) : null,
            },
          ]}
        />
      </div>
      <span className="hidden"><Money v={0} /></span>
    </div>
  );
}
