// The periodic incident review's page parts (catalogue INC-080): «محاسبهٔ آمار» in the header (the server counts the
// incidents the person may read, picks a stable sample of resolved ones and drafts the report — or rewrites it on
// request) and the «آمار دوره» tab: the figures, frequent categories, major incidents, new kinds of incident and the
// sample to check. Improvement actions are the related list «اقدام‌های بهبود».
import { Link } from "react-router";
import { Button, Dropdown } from "antd";
import { Calculator, ChevronDown } from "lucide-react";
import type { PeriodStats } from "@shared/incident/logic";
import { INCIDENT_CHOICE_LISTS } from "@shared/tables/incident";
import { PRIORITIES } from "@shared/model/task";
import type { Option } from "@shared/model/types";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { ICON14 } from "../../components/blocks";
import { EmptyState, JDateTime, StatCard } from "../../components/display";
import { recordPath, type RecordContext } from "../../records";
import { incidentApi } from "./api";
import { durationText } from "./model";
import { Bars } from "./Dashboard";

const label = (options: Option[], v: string) => (v === "—" ? "نامشخص" : options.find((o) => o.value === v)?.label ?? v);

export function PeriodActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const run = useAction((overwrite: boolean) => incidentApi.computePeriod(api, String(ctx.row.id), overwrite), {
    success: "آمار دوره محاسبه شد.",
    onSuccess: () => void ctx.refresh(),
  });
  if (!ctx.meta.canWrite || ctx.row.state === "canceled") return null;
  return (
    <Dropdown.Button
      icon={<ChevronDown {...ICON14} />}
      loading={run.isPending}
      onClick={() => run.mutate(false)}
      menu={{ items: [{ key: "overwrite", label: "محاسبه و بازنویسی گزارش" }], onClick: () => run.mutate(true) }}
    >
      <Calculator {...ICON14} /> محاسبهٔ آمار
    </Dropdown.Button>
  );
}

export function PeriodStatsTab({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const s = ctx.row.stats as Partial<PeriodStats> | null | undefined;
  if (!s || typeof s.opened !== "number") {
    return <EmptyState title="آمار این دوره هنوز محاسبه نشده است" description="«محاسبهٔ آمار» را در بالای صفحه بزنید." />;
  }
  const cats = INCIDENT_CHOICE_LISTS["incident.category"];
  const subs = INCIDENT_CHOICE_LISTS["incident.subcategory"];
  const priorities = Object.entries(s.by_priority ?? {}).map(([k, n]) => ({ key: k, label: label(PRIORITIES, k), count: n })).sort((a, b) => a.key.localeCompare(b.key));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="ثبت‌شده" value={fa(s.opened)} />
        <StatCard title="حل‌شده" value={fa(s.resolved ?? 0)} />
        <StatCard title="نقض توافق" value={fa(s.breached ?? 0)} />
        <StatCard title="بازگشایی‌شده" value={fa(s.reopened ?? 0)} />
        <StatCard title="ارجاع پیاپی" value={fa(s.bounced ?? 0)} />
        <StatCard title="میانهٔ زمان حل" value={s.mttr_median === null || s.mttr_median === undefined ? "—" : durationText(s.mttr_median)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="اولویت‌ها" className="flex flex-col gap-2">
          <h3 className="ds-t-label text-ink">اولویت‌ها</h3>
          <Bars items={priorities} label="اولویت‌ها" />
        </section>
        <section aria-label="دسته‌های پرتکرار" className="flex flex-col gap-2">
          <h3 className="ds-t-label text-ink">دسته‌های پرتکرار</h3>
          <Bars items={(s.top_categories ?? []).map((c) => ({ key: c.key, label: label(cats, c.key), count: c.count }))} label="دسته‌های پرتکرار" />
        </section>
        <section aria-label="رخدادهای عمده" className="flex flex-col gap-2">
          <h3 className="ds-t-label text-ink">رخدادهای عمده</h3>
          {s.majors?.length ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {s.majors.map((m) => (
                <li key={m.id}>
                  <Link to={`/${orgId}/${recordPath("incident", m.id)}`}>
                    <bdi className="ds-num">{m.number}</bdi>
                  </Link>{" "}
                  {m.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">رخداد عمده‌ای در این دوره نبود.</p>
          )}
        </section>
        <section aria-label="نوع‌های تازه" className="flex flex-col gap-2">
          <h3 className="ds-t-label text-ink">نوع‌های تازهٔ رخداد</h3>
          {s.new_subcategories?.length ? (
            <ul className="flex flex-wrap gap-1.5 text-[13px]">
              {s.new_subcategories.map((x) => (
                <li key={x} className="rounded-xs bg-sunken px-2 py-0.5">
                  {label(subs, x)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">نوع تازه‌ای دیده نشد.</p>
          )}
        </section>
      </div>
      <p className="text-[12px] text-ink-3">
        محاسبه: <JDateTime v={ctx.row.computed_at as string | null} /> · نمونهٔ کیفیت در فیلد «نمونهٔ رخدادها» است.
      </p>
    </div>
  );
}
