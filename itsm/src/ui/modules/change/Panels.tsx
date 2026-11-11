// Side panels and tabs of a change's page:
//   «مسیر و آمادگی»   the lifecycle of its model (where it is), the readiness checks for authorization (CHG-070) and,
//                     while it waits for approval, the votes of the current cycle
//   «تداخل‌ها»         conflicts with their review (در حال بررسی / نادیده / برطرف with a reason) (CHG-045)
//   «تغییرهای مشابه»   similar changes and how they went (CHG-071)
//   tab «زمان‌بندی و اثر»  the scheduling assistant's free slots (one click sets the window, CHG-049), the CIs and
//                     services it touches with the impacted services from the CMDB (CHG-017)
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Button, Form, Input, Modal, Select, Space, Steps } from "antd";
import { Check, X, CalendarClock, RefreshCw, GitPullRequestArrow } from "lucide-react";
import { lifecycleOf, lifecycleSteps, humanSpan } from "@shared/change/logic";
import { CONFLICT_REVIEW } from "@shared/tables/change";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, Loader } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { RefLink, recordPath, recordsApi, type RecordContext } from "../../records";
import { CHANGE_KEYS, changeApi, useChangeRefresh } from "./api";
import { conflictLabel, voteText, type Row } from "./model";

export function ReadinessPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const r = ctx.row as Row;
  const lifecycle = (ctx.meta.change as { lifecycle?: string[] } | undefined)?.lifecycle ?? lifecycleOf(r.model_states as string[], r.type);
  const steps = lifecycleSteps(lifecycle, String(r.state));
  const current = steps.findIndex((s) => s.status === "current");
  const planning = ["new", "assess", "authorize"].includes(String(r.state));
  const ready = useQuery({ queryKey: CHANGE_KEYS.record(orgId, r.id, "readiness", r.version), queryFn: () => changeApi.readiness(api, r.id), enabled: planning });
  const votes = useQuery({ queryKey: CHANGE_KEYS.record(orgId, r.id, "votes", r.version), queryFn: () => changeApi.votes(api, r.id), enabled: r.state === "authorize" });
  return (
    <div className="flex flex-col gap-3">
      {r.state === "canceled" ? (
        <Chip tone="neutral">لغوشده</Chip>
      ) : (
        <Steps size="small" direction="vertical" current={current < 0 ? 0 : current} items={steps.map((s) => ({ title: s.label, status: s.status === "done" ? "finish" : s.status === "current" ? "process" : "wait" }))} />
      )}
      {r.state === "authorize" && votes.data ? <p className="text-[13px] text-ink-2">رأی‌ها: {voteText({ ...votes.data, my_approval: null })}</p> : null}
      {planning ? (
        ready.isLoading ? (
          <Loader />
        ) : ready.data ? (
          <div className="flex flex-col gap-1.5">
            <span className="ds-num text-[13px] text-ink-2">آمادگی برای تأیید: {ready.data.score}٪</span>
            <ul className="flex flex-col gap-1">
              {ready.data.checks.map((c) => (
                <li key={c.key} className={`flex items-start gap-1.5 text-[13px] ${c.ok ? "text-ink-2" : "text-ink"}`}>
                  {c.ok ? <Check {...ICON14} className="mt-0.5 text-in" aria-label="کامل" /> : <X {...ICON14} className="mt-0.5 text-warning" aria-label="ناقص" />}
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
            {ready.data.ai?.findings.length ? (
              <ul className="list-disc ps-4 text-[12px] text-ink-2">
                {ready.data.ai.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null
      ) : null}
    </div>
  );
}

export function ConflictsPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, timezone } = useOrg();
  const refresh = useChangeRefresh();
  const [review, setReview] = useState<{ id: string; version: number; status: string } | null>(null);
  const q = useQuery({
    queryKey: CHANGE_KEYS.record(orgId, ctx.row.id, "conflicts", ctx.row.version),
    queryFn: () => recordsApi.list(api, "change_conflict", { filter: { and: [{ f: "change_id", op: "eq", v: ctx.row.id }, { f: "active", op: "eq", v: true }] }, size: 50, sort: "overlap_start", fields: ["summary", "kind", "status", "justification", "other_change_id", "window_id", "overlap_start", "overlap_end"], total: false }),
  });
  const save = useAction((v: { status: string; justification?: string }) => recordsApi.update(api, "change_conflict", review!.id, { status: v.status, justification: v.justification ?? null }, review!.version), {
    success: "بررسی تداخل ثبت شد.",
    onSuccess: () => {
      setReview(null);
      refresh();
      ctx.refresh();
    },
  });
  if (q.isLoading) return <Loader />;
  const rows = (q.data?.rows ?? []) as Row[];
  if (!rows.length) return <p className="text-[13px] text-ink-3">{ctx.row.conflict_status === "not_checked" ? "تداخل این تغییر هنوز بررسی نشده است (زمان برنامه‌ریزی‌شده ندارد)." : "تداخلی پیدا نشد."}</p>;
  const can = !!ctx.meta.canWrite;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((c) => {
        const open = c.status === "detected" || c.status === "investigating";
        return (
          <div key={c.id} className="flex flex-col gap-1 border-b border-line pb-2 last:border-0">
            <div className="flex items-center gap-2">
              <Chip tone={open ? (c.status === "detected" ? "danger" : "warning") : "neutral"}>{CONFLICT_REVIEW.find((o) => o.value === c.status)?.label ?? c.status}</Chip>
              <span className="text-[12px] text-ink-3">{conflictLabel(c.kind)}</span>
            </div>
            <span className="text-[13px] text-ink">{c.summary}</span>
            {c.other_change_id ? <RefLink table="change_request" id={c.other_change_id} display={q.data?.display} /> : null}
            <span className="text-[12px] text-ink-3">
              {formatJalaliDateTime(c.overlap_start, timezone)} تا {formatJalaliDateTime(c.overlap_end, timezone)}
            </span>
            {c.justification ? <span className="text-[12px] text-ink-2">{c.justification}</span> : null}
            {can && open ? (
              <Space size={4}>
                {c.status === "detected" ? (
                  <Button size="small" onClick={() => setReview({ id: c.id, version: c.version, status: "investigating" })}>
                    در حال بررسی
                  </Button>
                ) : null}
                <Button size="small" onClick={() => setReview({ id: c.id, version: c.version, status: "ignored" })}>
                  نادیده بگیر
                </Button>
                <Button size="small" onClick={() => setReview({ id: c.id, version: c.version, status: "resolved" })}>
                  برطرف شد
                </Button>
              </Space>
            ) : null}
          </div>
        );
      })}
      <Modal open={!!review} title="بررسی تداخل" okText="ثبت" cancelText="انصراف" destroyOnHidden onCancel={() => setReview(null)} okButtonProps={{ form: "chg-conflict", htmlType: "submit", loading: save.isPending }}>
        {review ? (
          <Form id="chg-conflict" layout="vertical" initialValues={{ status: review.status }} onFinish={(v) => save.mutate(v)}>
            <Form.Item name="status" label="نتیجهٔ بررسی">
              <Select options={CONFLICT_REVIEW.filter((o) => o.value !== "detected").map((o) => ({ value: o.value, label: o.label }))} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => (
                <Form.Item name="justification" label="دلیل" rules={[{ required: getFieldValue("status") !== "investigating", message: "دلیل را بنویسید" }]}>
                  <Input.TextArea rows={3} maxLength={2000} />
                </Form.Item>
              )}
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}

export function SimilarPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: CHANGE_KEYS.record(orgId, ctx.row.id, "similar"), queryFn: () => changeApi.similar(api, ctx.row.id), staleTime: 60_000 });
  if (q.isLoading) return <Loader />;
  const items = q.data?.items ?? [];
  if (!items.length) return <p className="text-[13px] text-ink-3">تغییر مشابهی پیدا نشد.</p>;
  return (
    <div className="flex flex-col gap-2">
      {q.data?.summary ? (
        <span className="ds-num text-[12px] text-ink-2">
          {q.data.summary.failed} شکست از {q.data.summary.total} تغییر مشابه ({q.data.summary.failure_rate}٪)
        </span>
      ) : null}
      {items.slice(0, 6).map((c) => (
        <div key={c.id} className="flex flex-col">
          <Link to={`/${orgId}/${recordPath("change_request", c.id)}`} className="ds-link text-[13px]">
            <span className="ds-ltr">{c.number}</span> {c.short_description}
          </Link>
          <span className={`text-[12px] ${c.close_code === "unsuccessful" || c.close_code === "backed_out" ? "text-danger" : "text-ink-3"}`}>{c.outcome}</span>
        </div>
      ))}
    </div>
  );
}

export function ScheduleTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, timezone } = useOrg();
  const [days, setDays] = useState(21);
  const r = ctx.row as Row;
  const slots = useQuery({ queryKey: CHANGE_KEYS.record(orgId, r.id, "slots", `${days}:${r.version}`), queryFn: () => changeApi.slots(api, r.id, days) });
  const impact = useQuery({ queryKey: CHANGE_KEYS.record(orgId, r.id, "impact", r.version), queryFn: () => changeApi.impact(api, r.id) });
  const canPick = !!ctx.meta.canWrite && ["new", "assess", "authorize", "scheduled"].includes(String(r.state));
  const [simulating, setSimulating] = useState(false);
  const simulate = async () => {
    setSimulating(true);
    try {
      await changeApi.simulate(api, r.id, `اثر ${String(r.number ?? "تغییر")}`, impact.data?.cis ?? []);
      await impact.refetch();
    } finally {
      setSimulating(false);
    }
  };
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label="زمان‌های پیشنهادی">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="ds-t-section flex items-center gap-2">
            <CalendarClock {...ICON14} /> زمان‌های آزاد پیشنهادی
          </h3>
          <Select size="small" value={days} onChange={setDays} options={[7, 21, 45, 90].map((d) => ({ value: d, label: `${d} روز آینده` }))} aria-label="بازهٔ جست‌وجو" />
          <Button size="small" type="text" icon={<RefreshCw {...ICON14} />} aria-label="جست‌وجوی دوباره" onClick={() => void slots.refetch()} />
        </div>
        {slots.isLoading ? (
          <Loader />
        ) : slots.data ? (
          <>
            <span className="text-[12px] text-ink-3">
              مدت اجرا {humanSpan(slots.data.duration)}؛ زودترین شروع با مهلت اعلام: {formatJalaliDateTime(slots.data.earliest, timezone)}. در پنجره‌های نگهداری این تغییر، بیرون از ممنوعیت‌ها و زمان تغییرهای هم‌پوشان.
            </span>
            {slots.data.slots.length ? (
              <ul className="flex flex-col gap-1.5">
                {slots.data.slots.map((s) => (
                  <li key={s.start} className="flex items-center gap-3">
                    <span className="ds-num text-[13px]">
                      {formatJalaliDateTime(s.start, timezone)} تا {formatJalaliDateTime(s.end, timezone)}
                    </span>
                    {canPick ? (
                      <Button size="small" onClick={() => void ctx.save({ planned_start: s.start, planned_end: s.end })}>
                        همین زمان
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">در این بازه زمان آزادی پیدا نشد؛ بازه را بیشتر کنید.</p>
            )}
            {slots.data.narrative ? <p className="text-[13px] text-ink-2">{slots.data.narrative}</p> : null}
          </>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-label="اثر تغییر">
        <h3 className="ds-t-section">پیکربندی‌ها و خدمت‌های متأثر</h3>
        {impact.data ? (
          <>
            <div className="flex flex-wrap gap-2">
              {impact.data.cis.length ? impact.data.cis.map((id) => <RefLink key={id} table="ci" id={id} display={{ ...impact.data!.display, ...ctx.display }} />) : <span className="text-[13px] text-ink-3">پیکربندی مشخص نشده است.</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...impact.data.services, ...impact.data.impacted])].map((id) => (
                <RefLink key={id} table="service" id={id} display={{ ...impact.data!.display, ...ctx.display }} />
              ))}
            </div>
            {!impact.data.provider ? <span className="text-[12px] text-ink-3">نمودار وابستگی پیکربندی‌ها (CMDB) هنوز وصل نیست؛ خدمت‌های اثرپذیر پس از نصب آن خودکار حساب می‌شوند.</span> : null}
            {impact.data.provider ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-ink-2">شبیه‌سازی‌های اثر</span>
                  {impact.data.cis.length ? (
                    <Button size="small" loading={simulating} onClick={() => void simulate()}>
                      شبیه‌سازی از کار افتادن
                    </Button>
                  ) : null}
                </div>
                {impact.data.simulations.length ? (
                  <ul className="flex flex-col gap-1">
                    {impact.data.simulations.map((s) => (
                      <li key={s.id} className="flex flex-col">
                        {s.mine ? <Link className="ds-link text-[13px]" to={`/${orgId}/${recordPath("ci_impact_sim", s.id)}`}>{s.name}</Link> : <span className="text-[13px]">{s.name}</span>}
                        {s.summary ? <span className="text-[12px] text-ink-3">{s.summary}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-[12px] text-ink-3">هنوز شبیه‌سازی‌ای برای این تغییر ذخیره نشده است.</span>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <Loader />
        )}
      </section>
    </div>
  );
}

/** On an incident (or problem) page: changes that may have caused it — implemented around it on its CI or service. */
export function SuspectsPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const q = useQuery({
    queryKey: CHANGE_KEYS.record(orgId, ctx.row.id, "suspects"),
    queryFn: () => api.get<{ items: Row[] }>("/change/suspects", { incident: ctx.table === "incident" ? ctx.row.id : undefined, ci: (ctx.row as Row).ci_id ?? undefined, service: (ctx.row as Row).service_id ?? undefined }),
    staleTime: 60_000,
  });
  if (q.isLoading) return <Loader />;
  const items = q.data?.items ?? [];
  if (!items.length) return <p className="text-[13px] text-ink-3">تغییری در روزهای پیش از آن روی همین پیکربندی یا خدمت اجرا نشده است.</p>;
  return (
    <div className="flex flex-col gap-2">
      {items.slice(0, 5).map((c) => (
        <div key={c.id} className="flex flex-col">
          <Link to={`/${orgId}/${recordPath("change_request", c.id)}`} className="ds-link text-[13px]">
            <span className="ds-ltr">{c.number}</span> {c.short_description}
          </Link>
          <span className="text-[12px] text-ink-3">{c.why}</span>
        </div>
      ))}
    </div>
  );
}

/** On an incident, problem, known error or requested item: «ثبت تغییر» — a change initiated by this record (CHG-002). */
export function ChangeFromButton({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const go = useAction(() => changeApi.from(api, ctx.table, ctx.row.id), {
    success: (d) => `تغییر ${String(d.row.number)} ثبت شد.`,
    onSuccess: (d) => nav(`/${orgId}/${recordPath("change_request", String(d.row.id))}`),
  });
  // only for those who may register changes (not a requester following their own incident)
  if (!ctx.schema.def("change_request")?.can.create) return null;
  return (
    <Button size="small" icon={<GitPullRequestArrow {...ICON14} />} loading={go.isPending} onClick={() => go.mutate(undefined)}>
      ثبت تغییر
    </Button>
  );
}
