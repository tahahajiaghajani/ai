// Fiscal years (سال‌های مالی): close a year (closing voucher + opening voucher of the next year) or reopen it.
import { Button, Table } from "antd";
import { Lock, LockOpen, Plus, CalendarRange } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDate, StatusTag } from "../../components/display";
import { toJalali } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { ICON14, ICON } from "../reports/kit";

export default function FiscalYears() {
  const { info, api, orgId, can, fy, support } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const refresh = () => qc.invalidateQueries({ queryKey: ["org", orgId] });
  const close = useAction((id: string) => api.post(`/fiscal-years/${id}/close`), {
    onSuccess: () => {
      n.ok("سال مالی بسته شد و سند افتتاحیهٔ سال بعد صادر شد.");
      refresh();
    },
  });
  const reopen = useAction((id: string) => api.post(`/fiscal-years/${id}/reopen`), { success: "سال مالی دوباره باز شد.", onSuccess: refresh });
  const add = useAction((jy: number) => api.post("/fiscal-years", { jalali_year: jy }), { success: "سال مالی ساخته شد.", onSuccess: refresh });
  const years = info.fiscal_years;
  const latest = years[0];
  const full = can("accounting", "full");
  // reopening deletes the closing and opening vouchers: the owner or a manager only, never support
  const canReopen = full && !support && (info.member.role === "owner" || info.member.role === "admin");
  return (
    <div>
      <PageHeader
        title="سال‌های مالی"
        subtitle={<Link className="sf-link" to={`/${orgId}/help#fiscal`}>بستن سال چه می‌کند؟</Link>}
        actions={
          full && latest ? (
            <Button icon={<Plus {...ICON} />} loading={add.isPending} onClick={() => add.mutate(toJalali(latest.end_date).jy + 1)}>
              سال {faDigits(toJalali(latest.end_date).jy + 1)}
            </Button>
          ) : null
        }
      />
      <div className="bk-card">
        <Table
          className="bk-tbl"
          size="middle"
          rowKey="id"
          pagination={false}
          dataSource={years}
          locale={{ emptyText: <EmptyState icon={CalendarRange} title="سال مالی تعریف نشده" /> }}
          columns={[
            {
              key: "title",
              dataIndex: "title",
              title: "سال مالی",
              render: (v, r) => (
                <span className="inline-flex items-center gap-2">
                  <span className="font-medium">{v}</span>
                  {fy?.id === r.id ? <Chip tone="accent" dot={false}>سال جاری</Chip> : null}
                </span>
              ),
            },
            { key: "start", dataIndex: "start_date", title: "از", width: 140, render: (v) => <JDate v={v} /> },
            { key: "end", dataIndex: "end_date", title: "تا", width: 140, render: (v) => <JDate v={v} /> },
            { key: "status", dataIndex: "status", title: "وضعیت", width: 140, render: (v) => (v === "closed" ? <Chip tone="neutral">بسته</Chip> : <StatusTag s={v} />) },
            {
              key: "a",
              title: "",
              width: 240,
              render: (_, r) =>
                full ? (
                  <span className="flex justify-end">
                    {r.status !== "closed" ? (
                      <Button
                        size="small"
                        icon={<Lock {...ICON14} />}
                        loading={close.isPending && close.variables === r.id}
                        onClick={async () => {
                          if (await n.confirm(`بستن ${r.title}؟`, "درآمد و هزینه‌ها بسته و سند اختتامیه صادر می‌شود و مانده‌ها با سند افتتاحیه به سال بعد می‌روند. اسناد پیش‌نویس باید پیش از بستن ثبت یا حذف شوند.")) close.mutate(r.id);
                        }}
                      >
                        بستن سال و صدور افتتاحیه
                      </Button>
                    ) : canReopen ? (
                      <Button
                        size="small"
                        icon={<LockOpen {...ICON14} />}
                        loading={reopen.isPending && reopen.variables === r.id}
                        onClick={async () => {
                          if (await n.confirm(`باز کردن دوبارهٔ ${r.title}؟`, "اسناد اختتامیه و افتتاحیهٔ این سال حذف می‌شوند.")) reopen.mutate(r.id);
                        }}
                      >
                        باز کردن دوباره
                      </Button>
                    ) : null}
                  </span>
                ) : null,
            },
          ]}
        />
      </div>
    </div>
  );
}
