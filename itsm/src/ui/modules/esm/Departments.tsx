// «میز واحدها» and the department workspace home (ESM-001…006, signature screen):
//   Departments      my departments (to their homes), «کجا بپرسم؟» (a sentence → the services that fit, across the
//                    departments the caller may ask), the cases I opened, and the day-one pack for administrators
//   DepartmentHome   one department's home: per case table the open, new, waiting, unassigned, mine and late cases, the
//                    last 30 days (opened, resolved, satisfaction), the latest cases, its services, its journeys (HR)
//                    and its knowledge — every figure counted with the caller's own access
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Progress } from "antd";
import { ArrowLeft, Building2, Compass, Plus, Route, Search } from "lucide-react";
import { formatJalali, toFa } from "@shared/jalali";
import { DEPARTMENT_KINDS, ESM_CASE_STATES, JOURNEY_TYPES } from "@shared/tables/esm";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";
import { ChoiceTag, recordPath } from "../../records";
import { ESM_KEYS, esmApi, type DeptQueue } from "./api";
import { CASE_PATHS, journeyState, readiness, type Row } from "./model";
import "./esm.css";

const caseState = (v: unknown) => ESM_CASE_STATES.states.find((s) => s.value === v);
const kindLabel = (v: unknown) => DEPARTMENT_KINDS.find((k) => k.value === v)?.label ?? "";

export function Departments() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const meta = useQuery({ queryKey: ESM_KEYS.meta(orgId), queryFn: () => esmApi.meta(api) });
  const all = useQuery({ queryKey: ESM_KEYS.departments(orgId), queryFn: () => esmApi.departments(api) });
  const [text, setText] = useState("");
  const route = useAction((t: string) => esmApi.route(api, t));
  const seed = useAction(() => esmApi.seed(api), { success: "واحدهای پیش‌فرض، خدمت‌ها و سفر ورود کارکنان افزوده شد", invalidate: [ESM_KEYS.all] });
  const depts = all.data?.departments ?? [];
  const my = depts.filter((d) => d.mine);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="میز واحدها" actions={meta.data?.admin && !meta.data.seeded ? <Button type="primary" onClick={() => seed.mutate(undefined)} loading={seed.isPending}>افزودن واحدهای پیش‌فرض</Button> : null} />
      <Card title="کجا بپرسم؟">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) route.mutate(text.trim());
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: فیش حقوقی این ماه را ندارم" maxLength={500} aria-label="درخواست به زبان ساده" prefix={<Compass {...ICON} />} />
          <Button htmlType="submit" icon={<Search {...ICON} />} loading={route.isPending}>پیدا کن</Button>
        </form>
        {route.data ? (
          route.data.matches.length ? (
            <ul className="mt-3 flex flex-col gap-2 text-[13px]">
              {route.data.matches.map((m) => (
                <li key={m.service.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.service.name}</span>
                  <span className="text-ink-3">— {m.department.name}</span>
                  {m.service.description ? <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{m.service.description}</span> : <span className="flex-1" />}
                  <Button size="small" icon={<Plus size={12} />} onClick={() => nav(`/${orgId}/${CASE_PATHS[m.service.case_table] ?? `r/${m.service.case_table}`}/new?service=${m.service.id}`)}>ثبت درخواست</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">خدمتی با این شرح پیدا نشد؛ واژه‌های دیگری بنویسید یا از فهرست واحدها بپرسید.</p>
          )
        ) : null}
      </Card>
      {all.isLoading ? (
        <Loader />
      ) : !depts.length ? (
        <EmptyState icon={Building2} title="هنوز واحدی راه‌اندازی نشده است" />
      ) : (
        <div className="esm-depts">
          {(my.length ? my : depts).map((d) => (
            <Link key={d.id} to={d.mine || meta.data?.admin ? `/${orgId}/esm/d/${d.key}` : `/${orgId}/${CASE_PATHS[d.case_table] ?? `r/${d.case_table}`}/new`} className="esm-dept" data-c={d.color ?? "blue"}>
              <span className="text-[15px] font-medium">{d.name}</span>
              <span className="text-[12px] text-ink-3">{kindLabel(d.kind)}{d.status === "setup" ? " · در حال راه‌اندازی" : ""}</span>
              <span className="flex items-center gap-1 text-[12px] text-accent-text">{d.mine || meta.data?.admin ? "خانهٔ واحد" : "ثبت درخواست"} <ArrowLeft size={12} /></span>
            </Link>
          ))}
        </div>
      )}
      <Card title="درخواست‌های باز من در واحدها">
        <MyCasesList />
      </Card>
    </div>
  );
}

/** The caller's open department cases (all departments, or one: `?department=<key>`). */
function MyCasesList({ department = null }: { department?: string | null }) {
  const { api, orgId } = useOrg();
  const mine = useQuery({ queryKey: ESM_KEYS.myCases(orgId, department), queryFn: () => esmApi.myCases(api, department) });
  if (mine.isLoading) return <Loader />;
  if (!mine.data?.cases.length) return <p className="text-[13px] text-ink-3">درخواست بازی در {department ? "این واحد" : "واحدها"} ندارید.</p>;
  return (
    <ul className="flex flex-col gap-1 text-[13px]">
      {mine.data.cases.map((c: Row) => {
        const st = caseState(c.state);
        return (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <Link className="ds-link" to={`/${orgId}/${recordPath(c.table, c.id)}`}>{c.number}</Link>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="text-[12px] text-ink-3">{c.department ?? c.table_label}</span>
            <ChoiceTag option={st ? { value: st.value, label: st.label, color: st.color } : undefined} value={String(c.state)} />
          </li>
        );
      })}
    </ul>
  );
}

/** «درخواست‌های من در واحدها» (the portal's link of each department: esm/my-cases?department=<key>). */
export function MyCases() {
  const [params] = useSearchParams();
  const department = params.get("department");
  const { api, orgId } = useOrg();
  const all = useQuery({ queryKey: ESM_KEYS.departments(orgId), queryFn: () => esmApi.departments(api) });
  const name = department ? all.data?.departments.find((d) => d.key === department)?.name : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={name ? `درخواست‌های من در ${name}` : "درخواست‌های من در واحدها"} back={`/${orgId}/esm`} />
      <Card>
        <MyCasesList department={department} />
      </Card>
    </div>
  );
}

function QueueCard({ q, orgId }: { q: DeptQueue; orgId: string }) {
  const path = CASE_PATHS[q.table] ?? `r/${q.table}`;
  return (
    <Card title={q.label} tools={<Link className="ds-link text-[12px]" to={`/${orgId}/${path}`}>همهٔ پرونده‌ها</Link>}>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <StatCard title="باز" value={toFa(q.open)} />
        <StatCard title="تازه" value={toFa(q.new)} />
        <StatCard title="منتظر" value={toFa(q.waiting)} />
        <StatCard title="بی‌کارشناس" value={toFa(q.unassigned)} />
        <StatCard title="با من" value={toFa(q.mine)} />
        <StatCard title="گذشته از موعد" value={<span className={q.breached ? "text-danger" : ""}>{toFa(q.breached)}</span>} />
      </div>
      <p className="mt-2 text-[12px] text-ink-3">
        سی روز گذشته: {toFa(q.created_30d)} ثبت، {toFa(q.resolved_30d)} حل
        {q.csat !== null ? `، رضایت ${toFa(Math.round(q.csat * 10) / 10)} از ۵ (${toFa(q.csat_n)} نظر)` : ""}
      </p>
      {q.recent.length ? (
        <ul className="mt-2 flex flex-col gap-1 text-[13px]">
          {q.recent.map((r) => {
            const st = caseState(r.state);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Link className="ds-link" to={`/${orgId}/${recordPath(q.table, r.id)}`}>{r.number}</Link>
                <span className="min-w-0 flex-1 truncate">{r.title ?? r.short_description}</span>
                <ChoiceTag option={st ? { value: st.value, label: st.label, color: st.color } : undefined} value={String(r.state)} />
                {r.assigned_to ? <span className="text-[12px] text-ink-3">{q.display[String(r.assigned_to)] ?? ""}</span> : <Chip tone="warning">بی‌کارشناس</Chip>}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

export function DepartmentHome() {
  const { key = "" } = useParams();
  const { api, orgId, allows } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ESM_KEYS.home(orgId, key), queryFn: () => esmApi.home(api, key), enabled: !!key });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState icon={Building2} title="این واحد در دسترس شما نیست" description="خانهٔ هر واحد برای اعضای فضای کاری آن و مدیرانش باز است." />;
  const dep = d.department;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={dep.name}
        back={`/${orgId}/esm`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav(`/${orgId}/${CASE_PATHS[dep.case_table] ?? `r/${dep.case_table}`}/new`)}>پروندهٔ تازه</Button>
            {d.journeys && allows({ area: "hr", op: "create" }) ? <Button icon={<Route {...ICON} />} onClick={() => nav(`/${orgId}/hr/journeys/start`)}>آغاز سفر کارمند</Button> : null}
            {d.admin ? <Button onClick={() => nav(`/${orgId}/${recordPath("esm_department", dep.id)}`)}>تنظیمات واحد</Button> : null}
          </div>
        }
      />
      {dep.intro ? <p className="text-[13px] text-ink-2">{dep.intro}</p> : null}
      {d.queues.length ? d.queues.map((qq) => <QueueCard key={qq.table} q={qq} orgId={orgId} />) : <EmptyState compact title="پرونده‌ای در این واحد نمی‌بینید" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {d.journeys ? (
          <Card title={`سفرهای کارکنان در جریان (${toFa(d.journeys.total)})`} tools={<Link className="ds-link text-[12px]" to={`/${orgId}/hr/journeys`}>همهٔ سفرها</Link>}>
            {d.journeys.rows.length ? (
              <ul className="flex flex-col gap-2 text-[13px]">
                {d.journeys.rows.map((j) => {
                  const st = journeyState(j.state);
                  const ready = readiness(j);
                  return (
                    <li key={j.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className="ds-link" to={`/${orgId}/hr/journeys/${j.id}/tracker`}>{j.name ?? j.number}</Link>
                        <ChoiceTag option={JOURNEY_TYPES.find((t) => t.value === j.type)} value={String(j.type ?? "")} />
                        <ChoiceTag option={st ? { value: st.value, label: st.label, color: st.color } : undefined} value={String(j.state)} />
                        <span className="text-[12px] text-ink-3">{formatJalali(j.anchor_date)}</span>
                        {j.type === "onboarding" ? <Chip tone={ready.ready ? "in" : "warning"}>{ready.ready ? "آمادهٔ روز نخست" : "روز نخست ناتمام"}</Chip> : null}
                        {Number(j.activities_overdue ?? 0) > 0 ? <Chip tone="danger">{toFa(j.activities_overdue)} دیرکرد</Chip> : null}
                      </div>
                      <Progress percent={Number(j.progress ?? 0)} size="small" format={(v) => `${toFa(v ?? 0)}٪`} aria-label="پیشرفت سفر" />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">سفر در جریانی نیست.</p>
            )}
          </Card>
        ) : null}
        <Card title="خدمت‌های واحد" tools={d.admin ? <Link className="ds-link text-[12px]" to={`/${orgId}/esm/services`}>مدیریت خدمت‌ها</Link> : null}>
          {d.services.length ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {d.services.map((s) => (
                <li key={s.id} className={`flex flex-wrap items-center gap-2 ${s.active ? "" : "text-ink-3"}`}>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {s.category ? <span className="text-[12px] text-ink-3">{s.category}</span> : null}
                  {s.active ? (
                    <Button size="small" onClick={() => nav(`/${orgId}/${CASE_PATHS[s.case_table] ?? `r/${s.case_table}`}/new?service=${s.id}`)}>ثبت</Button>
                  ) : (
                    <Chip>غیرفعال</Chip>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">خدمتی تعریف نشده است.</p>
          )}
          {d.kb_articles !== null ? <p className="mt-2 text-[12px] text-ink-3">پایگاه دانش واحد: {toFa(d.kb_articles)} مقاله</p> : null}
        </Card>
      </div>
    </div>
  );
}
