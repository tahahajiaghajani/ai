// «کارهای من در واحدها» (ESM-024): the HR tasks given to the caller (sign, read, fill in, upload, learn) with their due
// days, and the journeys in which they are the employee or the manager, with progress and day-one readiness.
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "antd";
import { formatJalali, todayISO, toFa } from "@shared/jalali";
import { HR_TASK_TYPES, JOURNEY_TYPES } from "@shared/tables/esm";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card } from "../../components/blocks";
import { ChoiceTag, recordPath } from "../../records";
import { ESM_KEYS, esmApi } from "./api";
import { readiness } from "./model";

export default function MyTodos() {
  const { api, orgId, timezone } = useOrg();
  const q = useQuery({ queryKey: ESM_KEYS.todos(orgId), queryFn: () => esmApi.todos(api) });
  const today = todayISO(timezone);
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="کارهای من در واحدها" />
      {q.isLoading ? (
        <Loader />
      ) : !d || (!d.tasks.length && !d.journeys.length) ? (
        <EmptyState title="کاری از واحدها به شما سپرده نشده است" />
      ) : (
        <>
          <Card title="کارها">
            {d.tasks.length ? (
              <ul className="flex flex-col gap-2 text-[13px]">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <Link className="ds-link" to={`/${orgId}/${recordPath("hr_task", t.id)}`}>{t.short_description}</Link>
                    <ChoiceTag option={HR_TASK_TYPES.find((x) => x.value === t.type)} value={String(t.type)} />
                    {t.due_date ? <Chip tone={String(t.due_date) < today ? "danger" : "neutral"}>تا {formatJalali(t.due_date)}</Chip> : null}
                    {t.journey_id ? <span className="text-[12px] text-ink-3">{d.display[String(t.journey_id)] ?? ""}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">کار بازی ندارید.</p>
            )}
          </Card>
          {d.journeys.length ? (
            <Card title="سفرها">
              <ul className="flex flex-col gap-3 text-[13px]">
                {d.journeys.map((j) => {
                  const r = readiness(j);
                  return (
                    <li key={j.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className="ds-link" to={`/${orgId}/hr/journeys/${j.id}/tracker`}>{j.name ?? j.number}</Link>
                        <ChoiceTag option={JOURNEY_TYPES.find((x) => x.value === j.type)} value={String(j.type)} />
                        <span className="text-[12px] text-ink-3">{formatJalali(j.anchor_date)}</span>
                        {j.type === "onboarding" ? <Chip tone={r.ready ? "in" : "warning"}>{r.text}</Chip> : null}
                      </div>
                      <Progress percent={Number(j.progress ?? 0)} size="small" format={(v) => `${toFa(v ?? 0)}٪`} aria-label="پیشرفت" />
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
