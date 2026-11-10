// «کنسول مدیریت»: the tenant administrator's home — the set-up checklist (each step done by the data, or marked by
// hand), the plan's limits against what the organisation uses, the features the platform offers it (and the ones the
// administrator may switch), the background jobs that need attention and what is new in the platform.
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Progress, Switch } from "antd";
import { CheckCircle2, Circle, RotateCcw } from "lucide-react";
import { LIMITS, limitTone, type FlagState, type LimitKey } from "@shared/admin/plans";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { fa, jDate } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, Skeleton, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";

interface Step {
  key: string;
  label: string;
  path: string;
  done: boolean;
  manual: boolean;
}

interface HomeData {
  onboarding: Step[];
  plan: { key: string; name: string | null; limits: Partial<Record<LimitKey, number>> };
  usage: Record<LimitKey, number>;
  features: FlagState[];
  jobs: { failed_24h: number; backlog_seconds: number; queued: number };
  changelog: { version: string; date: string; items: string[] }[];
}

const KEY = ["admin", "home"];
const TONE = { ok: "in", warning: "warning", danger: "danger" } as const;

function backlog(s: number): string {
  if (s < 60) return "بی‌تأخیر";
  if (s < 3600) return `${fa(Math.round(s / 60))} دقیقه`;
  return `${fa(Math.round(s / 3600))} ساعت`;
}

export default function Home() {
  const { api, orgId, can } = useOrg();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<HomeData>("/admin/home") });
  const mark = useAction((v: { key: string; done: boolean }) => api.put(`/admin/onboarding/${v.key}`, { done: v.done }), { invalidate: [KEY] });
  const toggle = useAction((v: { key: string; enabled: boolean }) => api.put(`/admin/features/${v.key}`, { enabled: v.enabled }), { invalidate: [KEY], success: "قابلیت به‌روز شد" });
  const seed = useAction(() => api.post("/admin/seed"), { invalidate: [KEY], success: "پیش‌فرض‌های کنسول بازگردانده شد" });
  const d = q.data;
  const done = d?.onboarding.filter((s) => s.done).length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="کنسول مدیریت"
        actions={
          can("settings", "full") ? (
            <Button icon={<RotateCcw {...ICON} />} loading={seed.isPending} onClick={() => seed.mutate(undefined)}>
              افزودن پیش‌فرض‌ها
            </Button>
          ) : undefined
        }
      />
      {!d ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="خلاصه">
            <StatCard title="راه‌اندازی" value={<span className="ds-num">{fa(done)} از {fa(d.onboarding.length)}</span>} hint="گام انجام‌شده" />
            <StatCard title="طرح" value={d.plan.name ?? "بدون طرح"} hint={d.plan.key === "*" ? "بدون سقف" : undefined} />
            <StatCard title="کارهای ناموفق ۲۴ ساعت" value={<span className="ds-num">{fa(d.jobs.failed_24h)}</span>} tone={d.jobs.failed_24h ? "bad" : "muted"} hint={<Link to={`/${orgId}/settings/logs`}>گزارش‌های سامانه</Link>} />
            <StatCard title="صف کارها" value={<span className="ds-num">{fa(d.jobs.queued)}</span>} hint={`تأخیر: ${backlog(d.jobs.backlog_seconds)}`} />
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="راه‌اندازی سازمان" meta={<Progress percent={Math.round((done / Math.max(1, d.onboarding.length)) * 100)} size="small" className="!m-0 w-32" showInfo={false} />} flush>
              <ul className="m-0 list-none p-0">
                {d.onboarding.map((s) => (
                  <li key={s.key} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
                    {s.done ? <CheckCircle2 {...ICON} className="text-in" aria-label="انجام شده" /> : <Circle {...ICON} className="text-ink-3" aria-label="مانده" />}
                    <Link to={`/${orgId}/${s.path}`} className="flex-1">
                      {s.label}
                    </Link>
                    {can("settings", "edit") && (!s.done || s.manual) ? (
                      <Checkbox checked={s.manual} onChange={(e) => mark.mutate({ key: s.key, done: e.target.checked })}>
                        <span className="text-[12px] text-ink-3">انجام شد</span>
                      </Checkbox>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="طرح و محدودیت‌ها" flush>
              <ul className="m-0 list-none p-0">
                {LIMITS.map((l) => {
                  const limit = d.plan.limits[l.key];
                  const used = d.usage[l.key] ?? 0;
                  const tone = limitTone(used, limit);
                  return (
                    <li key={l.key} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 last:border-b-0">
                      <span className="flex-1 text-ink">{l.label}</span>
                      {l.key === "api_rate" ? (
                        <span className="ds-num text-ink-2">{limit === undefined ? "بدون سقف" : `${fa(limit)} ${l.unit}`}</span>
                      ) : (
                        <Chip tone={limit === undefined ? "neutral" : TONE[tone]} dot={limit !== undefined}>
                          <span className="ds-num">{fa(used)}</span>
                          {limit === undefined ? ` ${l.unit} · بدون سقف` : ` از ${fa(limit)} ${l.unit}`}
                        </Chip>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title="قابلیت‌ها" flush>
              <ul className="m-0 list-none p-0">
                {d.features.map((f) => (
                  <li key={f.key} className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-b-0">
                    <span className="flex flex-1 flex-col">
                      <span className="text-ink">{f.label}</span>
                      {!f.on ? <span className="text-[12px] text-ink-3">{f.reason}</span> : null}
                    </span>
                    {f.toggle && can("settings", "full") ? (
                      <Switch size="small" checked={f.on} loading={toggle.isPending && toggle.variables?.key === f.key} onChange={(on) => toggle.mutate({ key: f.key, enabled: on })} aria-label={f.label} />
                    ) : (
                      <Chip tone={f.on ? "in" : "neutral"}>{f.on ? "روشن" : "خاموش"}</Chip>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="تازه‌ها">
              <div className="flex flex-col gap-3">
                {d.changelog.map((c) => (
                  <div key={c.version} className="flex flex-col gap-1">
                    <span className="text-[13px] text-ink-2">
                      نسخهٔ <span className="ds-num ds-latin">{c.version}</span> · <span className="ds-num">{jDate(new Date(c.date))}</span>
                    </span>
                    <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-[13px] text-ink">
                      {c.items.map((it) => (
                        <li key={it}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
