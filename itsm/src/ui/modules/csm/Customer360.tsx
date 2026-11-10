// «نمای ۳۶۰ مشتری» (CSM-006, signature screen): one account as the caller may read it — relationship health with its
// 90-day trend, open cases with their deadlines, complaints and escalations, entitlements with their usage, contacts,
// the installed base, contracts, recent closed cases and the service reviews. Each list links to its records; what
// the caller cannot read is simply not there (the server reads every part with the caller's access).
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "antd";
import { formatJalali, toFa } from "@shared/jalali";
import { SUPPORT_LEVELS, ENTITLEMENT_STATES, ESCALATION_STATES, REVIEW_STATES } from "@shared/tables/csm";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { Card } from "../../components/blocks";
import { ChoiceTag, recordPath } from "../../records";
import { CSM_KEYS, csmApi, type Customer360 } from "./api";
import { caseState, healthOption, healthTone, sparkline, usage, usageTone, type Row } from "./model";

const optionOf = (list: { value: string; label: string; color?: string }[], v: unknown) => {
  const o = list.find((x) => x.value === v);
  return o ? { value: o.value, label: o.label, color: o.color as never } : undefined;
};

export default function Customer360Page() {
  const { id = "" } = useParams();
  return <Account360 id={id} />;
}

export function Account360({ id, inline }: { id: string; inline?: boolean }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: CSM_KEYS.c360(orgId, id), queryFn: () => csmApi.c360(api, id), enabled: !!id });
  const d = q.data;
  const link = (table: string, rid: string, text: string) => <Link className="ds-link" to={`/${orgId}/${recordPath(table, rid)}`}>{text}</Link>;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState title="این حساب در دسترس نیست" />;
  const a = d.account;
  const h = healthOption(a.health_status);
  const trend = sparkline(d.health.map((x) => x.score));
  const activeEnts = d.entitlements.filter((e) => e.state === "active");
  return (
    <div className="flex flex-col gap-4">
      {inline ? null : <PageHeader title={`نمای ۳۶۰ — ${a.name}`} back={`/${orgId}/${recordPath("customer_account", a.id)}`} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          title="سلامت رابطه"
          value={
            <span className="flex items-center gap-2">
              <Chip tone={healthTone(a.health_status)}>{h.label}</Chip>
              {a.health_score !== null && a.health_score !== undefined ? <span className="ds-num">{toFa(a.health_score)}</span> : null}
            </span>
          }
          hint={
            trend ? (
              <svg viewBox="0 0 160 36" width="160" height="36" role="img" aria-label="روند سلامت نود روز">
                <polyline points={trend} fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            ) : (
              "هنوز روندی ثبت نشده است"
            )
          }
        />
        <StatCard title="پرونده‌های باز" value={toFa(d.open_cases.length)} hint={`${toFa(d.open_cases.filter((c) => c.complaint).length)} شکایت، ${toFa(d.escalations.length)} تشدید باز`} />
        <StatCard title="رضایت" value={d.csat === null ? "—" : `${toFa(Math.round(d.csat * 10) / 10)} از ۵`} hint={`${toFa(d.csat_n)} نظر`} />
        <StatCard title="استحقاق‌های فعال" value={toFa(activeEnts.length)} hint={activeEnts[0]?.ends_on ? `نزدیک‌ترین پایان: ${formatJalali(activeEnts.map((e) => String(e.ends_on)).sort()[0])}` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="پرونده‌های باز">
          {d.open_cases.length ? (
            <ul className="flex flex-col gap-2 text-[13px]">
              {d.open_cases.map((c) => {
                const st = caseState(c.state);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    {link("customer_case", c.id, String(c.number))}
                    <span className="min-w-0 flex-1 truncate">{c.short_description}</span>
                    <ChoiceTag option={st ? { value: st.value, label: st.label, color: st.color } : undefined} value={String(c.state)} />
                    {c.complaint ? <Chip tone="danger">شکایت</Chip> : null}
                    {c.escalated ? <Chip tone="warning">تشدید</Chip> : null}
                    {c.sentiment === "negative" ? <Chip tone="warning">ناخرسند</Chip> : null}
                    {c.sla_due ? <span className="text-[12px] text-ink-3">موعد {formatJalali(c.sla_due)}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">پروندهٔ بازی ندارد.</p>
          )}
        </Card>
        <Card title="استحقاق‌ها">
          {d.entitlements.length ? (
            <ul className="flex flex-col gap-2 text-[13px]">
              {d.entitlements.map((e: Row) => {
                const pct = usage(e);
                return (
                  <li key={e.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {link("entitlement", e.id, String(e.name ?? e.number))}
                      <ChoiceTag option={optionOf(SUPPORT_LEVELS, e.support_level)} value={String(e.support_level ?? "")} />
                      <ChoiceTag option={optionOf(ENTITLEMENT_STATES.states, e.state)} value={String(e.state)} />
                      <span className="text-[12px] text-ink-3">تا {formatJalali(e.ends_on)}</span>
                    </div>
                    {pct !== null ? (
                      <div className="flex items-center gap-2">
                        <Progress percent={pct} size="small" showInfo={false} status={pct >= 100 ? "exception" : "normal"} aria-label="مصرف سهمیه" className="max-w-[220px]" />
                        <Chip tone={usageTone(pct, Number(e.warn_percent ?? 80))}>{toFa(pct)}٪ مصرف</Chip>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">استحقاقی ثبت نشده است؛ پرونده‌ها بی پوشش ثبت می‌شوند.</p>
          )}
        </Card>
        <Card title="مخاطبان">
          {d.contacts.length ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {d.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  {link("customer_contact", c.id, String(c.name))}
                  {c.is_primary ? <Chip tone="accent">اصلی</Chip> : null}
                  {c.job_title ? <span className="text-ink-3">{c.job_title}</span> : null}
                  {c.email ? <span className="ltr text-[12px] text-ink-3">{c.email}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">مخاطبی ثبت نشده است.</p>
          )}
        </Card>
        <Card title="پایگاه نصب">
          {d.install_base.length ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {d.install_base.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2">
                  {link("install_base_item", i.id, String(i.name ?? i.number))}
                  {i.product_id ? <span className="text-ink-3">{d.display[String(i.product_id)] ?? ""}</span> : null}
                  {i.ci_id ? <span className="text-[12px] text-ink-3">پیکربندی: {d.display[String(i.ci_id)] ?? "(محدود)"}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">قلمی در پایگاه نصب ثبت نشده است.</p>
          )}
        </Card>
        <Card title="قراردادها و تشدیدها">
          <ul className="flex flex-col gap-1 text-[13px]">
            {d.contracts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                {link("customer_contract", c.id, String(c.name ?? c.number))}
                <span className="text-[12px] text-ink-3">{formatJalali(c.starts_on)} تا {formatJalali(c.ends_on)}</span>
              </li>
            ))}
            {d.escalations.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                {link("case_escalation", e.id, String(e.number))}
                <ChoiceTag option={optionOf(ESCALATION_STATES.states, e.state)} value={String(e.state)} />
                <span className="min-w-0 flex-1 truncate">{e.short_description ?? e.reason ?? ""}</span>
              </li>
            ))}
            {!d.contracts.length && !d.escalations.length ? <li className="text-ink-3">قرارداد یا تشدید بازی نیست.</li> : null}
          </ul>
        </Card>
        <Card title="بازبینی‌ها و پرونده‌های بسته‌شدهٔ اخیر">
          <ul className="flex flex-col gap-1 text-[13px]">
            {d.reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                {link("account_review", r.id, String(r.title ?? r.number))}
                <ChoiceTag option={optionOf(REVIEW_STATES.states, r.state)} value={String(r.state)} />
                {r.period_to ? <span className="text-[12px] text-ink-3">تا {formatJalali(r.period_to)}</span> : null}
              </li>
            ))}
            {d.recent_cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                {link("customer_case", c.id, String(c.number))}
                <span className="min-w-0 flex-1 truncate">{c.short_description}</span>
                {c.resolution_accepted === false ? <Chip tone="warning">راه‌حل پذیرفته نشد</Chip> : null}
                {c.satisfaction ? <span className="text-[12px] text-ink-3">رضایت {toFa(c.satisfaction)}</span> : null}
              </li>
            ))}
            {!d.reviews.length && !d.recent_cases.length ? <li className="text-ink-3">موردی نیست.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export type { Customer360 };
