// «تنظیمات گزارش‌ها» (report administrators): the KPI library — which indicators and dashboards this organisation's
// installed modules make available and which are already added («افزودن پیش‌فرض‌ها» adds the missing ones), the daily
// snapshot on demand, the settings row (small-cell threshold, snapshot hour, retention) and a JSON export of every
// definition the administrator may read.
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Space } from "antd";
import { Camera, Check, FileJson, LibraryBig, Minus, Settings2 } from "lucide-react";
import { PRACTICE_OPTIONS } from "@shared/tables/analytics";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { Card, ICON14 } from "../../components/blocks";
import { recordPath, recordsApi } from "../../records";
import { analyticsApi, ANALYTICS_KEYS, saveJson } from "./api";
import { useAnalyticsMeta } from "./parts";
import "./analytics.css";

export default function Admin() {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const meta = useAnalyticsMeta();
  const lib = useQuery({ queryKey: ANALYTICS_KEYS.library(orgId), queryFn: () => analyticsApi.library(api) });
  const cfg = useQuery({ queryKey: ["analytics", orgId, "config-row"], queryFn: () => recordsApi.list(api, "analytics_config", { size: 1, sort: "created_at", fields: ["name", "small_cell_k", "snapshot_hour", "keep_days", "last_snapshot_on"], total: false }) });
  const seed = useAction(() => analyticsApi.seed(api, true), {
    success: (r) => (Object.keys(r.created).length ? `افزوده شد: ${Object.entries(r.created).map(([k, v]) => `${faDigits(v)} ${k === "analytics_indicator" ? "شاخص" : k === "analytics_dashboard" ? "داشبورد" : "مورد"}`).join("، ")}` : "چیز تازه‌ای برای افزودن نبود"),
    invalidate: [ANALYTICS_KEYS.all],
  });
  const collect = useAction(() => analyticsApi.collectAll(api), { success: (r) => `${faDigits(r.scores)} امتیاز ذخیره شد${r.done ? "" : " (بقیه در اجرای بعدی)"}` });
  const exportAll = async () => {
    try {
      const ids = async (table: string) => (await recordsApi.list(api, table, { filter: table === "analytics_indicator" ? null : { f: "trashed", op: "eq", v: false }, size: 100, fields: ["name"], total: false })).rows.map((r) => r.id);
      const bundle = await analyticsApi.exportBundle(api, { reports: await ids("analytics_report"), dashboards: await ids("analytics_dashboard"), indicators: await ids("analytics_indicator") });
      saveJson("analytics-export", bundle);
    } catch (e) {
      n.error(e);
    }
  };
  if (meta.isLoading) return <Loader />;
  if (!meta.data?.can_admin) return <EmptyState title="تنظیمات گزارش‌ها با مدیر گزارش‌هاست" />;
  const row = cfg.data?.rows[0];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="تنظیمات گزارش‌ها"
        actions={
          <Space size={8} wrap>
            <Button icon={<FileJson {...ICON14} />} onClick={exportAll}>
              خروجی همهٔ تعریف‌ها
            </Button>
            <Button icon={<Camera {...ICON14} />} loading={collect.isPending} onClick={() => collect.mutate(undefined)}>
              عکس شاخص‌ها اکنون
            </Button>
            <Button type="primary" icon={<LibraryBig {...ICON14} />} loading={seed.isPending} onClick={() => seed.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: ["records", orgId] }) })}>
              افزودن پیش‌فرض‌ها
            </Button>
          </Space>
        }
      />
      <Card title="تنظیمات" tools={row ? <Link to={`/${orgId}/${recordPath("analytics_config", row.id)}`}><Button size="small" icon={<Settings2 {...ICON14} />}>ویرایش</Button></Link> : null}>
        {row ? (
          <dl className="an-hub-facts">
            <dt>کمینهٔ رکورد هر خانه (k)</dt>
            <dd>{Number(row.small_cell_k) ? faDigits(Number(row.small_cell_k)) : "خاموش"}</dd>
            <dt>ساعت عکس روزانه</dt>
            <dd>{faDigits(Number(row.snapshot_hour ?? 2))}</dd>
            <dt>نگهداری امتیازها</dt>
            <dd>{faDigits(Number(row.keep_days ?? 730))} روز</dd>
            <dt>آخرین عکس روزانه</dt>
            <dd>{row.last_snapshot_on ? String(row.last_snapshot_on) : "هنوز گرفته نشده"}</dd>
          </dl>
        ) : (
          <p className="an-muted">تنظیمات با «افزودن پیش‌فرض‌ها» ساخته می‌شود.</p>
        )}
      </Card>
      <Card title="کتابخانهٔ شاخص‌ها" meta={<span className="an-muted">فقط شاخص‌هایی که جدول‌ها و فیلدهایشان در این سازمان هست</span>} flush>
        {lib.isLoading ? (
          <Loader />
        ) : (
          <table className="an-table">
            <thead>
              <tr>
                <th scope="col">شاخص</th>
                <th scope="col">فرایند</th>
                <th scope="col">در دسترس</th>
                <th scope="col">افزوده‌شده</th>
              </tr>
            </thead>
            <tbody>
              {(lib.data?.indicators ?? []).map((k) => (
                <tr key={k.key}>
                  <td>
                    {k.name} <code dir="ltr" className="an-muted">{k.key}</code>
                  </td>
                  <td>{PRACTICE_OPTIONS.find((p) => p.value === k.practice)?.label ?? k.practice}</td>
                  <td title={k.reason ?? undefined}>{k.available ? <Check {...ICON14} aria-label="بله" /> : <span className="an-muted">{k.reason ?? "نه"}</span>}</td>
                  <td>{k.installed ? <Check {...ICON14} aria-label="بله" /> : <Minus {...ICON14} aria-label="نه" />}</td>
                </tr>
              ))}
              {(lib.data?.dashboards ?? []).map((d) => (
                <tr key={d.key}>
                  <td>{d.name}</td>
                  <td>داشبورد</td>
                  <td>{d.available ? <Check {...ICON14} aria-label="بله" /> : <span className="an-muted">جدول آن نیست</span>}</td>
                  <td>{d.installed ? <Check {...ICON14} aria-label="بله" /> : <Minus {...ICON14} aria-label="نه" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
