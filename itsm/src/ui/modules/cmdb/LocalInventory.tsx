// «موجودی این رایانه» (catalogue CMDB-048/051, Windows app only): the app reads its own machine — name and domain,
// operating system, processor, memory, disk, network addresses, serial number, maker and model, BIOS id and, if asked,
// installed software — and records it through the reconciliation engine as a CI of the right class (laptop, desktop or
// server), so a second run updates the same CI. A «جمع‌آورندهٔ کشف» of kind «همین رایانه» repeats it on a schedule.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Space, Switch, Table } from "antd";
import { Check, MonitorSmartphone, RefreshCw } from "lucide-react";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { useSession } from "../../lib/session";
import { cmdbApi, CMDB_KEYS } from "./api";
import { useCmdbRefresh } from "./CiParts";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function LocalInventory() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const session = useSession();
  const refresh = useCmdbRefresh();
  const desktop = session.meta?.mode === "desktop";
  const [software, setSoftware] = useState(false);
  const q = useQuery({ queryKey: CMDB_KEYS.local(orgId, software), queryFn: () => cmdbApi.localPreview(api, software), enabled: desktop, staleTime: 60_000 });
  const collect = useMutation({
    mutationFn: () => cmdbApi.collectLocal(api, { include_software: software }),
    onSuccess: (r) => {
      const item = r.result.results[0];
      message.success(item?.action === "created" ? "این رایانه در پایگاه پیکربندی ثبت شد" : item?.action === "unchanged" ? "اطلاعات این رایانه تغییری نکرده بود" : "اطلاعات این رایانه به‌روز شد");
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (!desktop) return <EmptyState title="فقط در نسخهٔ ویندوزی" description="جمع‌آوری موجودی رایانه را برنامهٔ ویندوزی روی همان رایانه انجام می‌دهد." icon={MonitorSmartphone} />;
  const inv = q.data?.inventory;
  const done = collect.data?.result.results[0];
  const rows: [string, string | number | null][] = inv
    ? [
        ["نام رایانه", inv.hostname], ["نام کامل", inv.fqdn], ["دامنه", inv.domain], ["سیستم‌عامل", `${inv.os} ${inv.os_version}`], ["معماری", inv.arch],
        ["پردازنده", inv.cpu_model ? `${inv.cpu_model} (${fa(inv.cpu_count)} هسته)` : fa(inv.cpu_count)], ["حافظه", `${fa(Math.round(inv.ram_mb / 1024))} گیگابایت`],
        ["دیسک", inv.disk_gb !== null ? `${fa(inv.disk_gb)} گیگابایت` : null], ["نشانی IP", inv.ip_address], ["نشانی MAC", inv.mac_address],
        ["شمارهٔ سریال", inv.serial_number], ["سازنده", inv.manufacturer], ["مدل", inv.model_name], ["شناسهٔ BIOS", inv.bios_uuid], ["کاربر", inv.user],
      ]
    : [];
  return (
    <div>
      <PageHeader
        title="موجودی این رایانه"
        actions={
          <Space wrap>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <Switch size="small" checked={software} onChange={setSoftware} />
              نرم‌افزارهای نصب‌شده
            </label>
            <Button icon={<RefreshCw {...ICON} />} onClick={() => q.refetch()} loading={q.isFetching}>خواندن دوباره</Button>
            <Button type="primary" icon={<Check {...ICON} />} loading={collect.isPending} disabled={!inv} onClick={() => collect.mutate()}>ثبت در پایگاه پیکربندی</Button>
          </Space>
        }
      />
      {q.isLoading ? <Loader /> : !inv ? <EmptyState title="موجودی خوانده نشد" description={(q.error as Error | null)?.message} /> : (
        <div className="flex flex-col gap-3">
          {inv.warnings.length ? <Note tone="warning">{inv.warnings.join("؛ ")}</Note> : null}
          {done?.ci_id ? (
            <Note action={<Link className="ds-link" to={`/${orgId}/cis/${done.ci_id}`}>باز کردن</Link>}>
              {`پیکربندی ${done.number ? faDigits(done.number) : ""} — ${done.matched_by ? `شناخته‌شده با ${done.matched_by}` : "ثبت شد"}`}
            </Note>
          ) : null}
          <Card title={inv.hostname}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px] md:grid-cols-[auto_1fr_auto_1fr]">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="break-all">{v === null || v === undefined || v === "" ? "—" : <bdi>{faDigits(String(v))}</bdi>}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {software && inv.software.length ? (
            <Card title={`نرم‌افزارها — ${fa(inv.software.length)}`} flush>
              <Table
                rowKey={(s) => `${s.name}|${s.version ?? ""}`}
                size="small"
                pagination={{ pageSize: 25 }}
                dataSource={inv.software}
                columns={[
                  { title: "نام", dataIndex: "name", key: "n", render: (v: string) => <bdi className="ds-latin">{v}</bdi> },
                  { title: "نسخه", dataIndex: "version", key: "v", width: 140, render: (v: string | null) => <span className="ds-ltr ds-num">{v ?? "—"}</span> },
                  { title: "ناشر", dataIndex: "vendor", key: "p", render: (v: string | null) => (v ? <bdi className="ds-latin">{v}</bdi> : "—") },
                ]}
              />
            </Card>
          ) : null}
          <p className="text-[12.5px] text-ink-3">
            برای تکرار خودکار، در «<Link className="ds-link" to={`/${orgId}/cmdb/collectors`}>جمع‌آورنده‌های کشف</Link>» یک جمع‌آورندهٔ «همین رایانه» با بازهٔ ساعتی بسازید.
          </p>
        </div>
      )}
    </div>
  );
}
