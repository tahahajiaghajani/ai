// «توافق ۳۶۰» (SLM-001/004/017/034/043/047): one agreement at a glance — live compliance of every target in the current
// review period with its goal, warning level, records measured and breached, and the trend of the closed periods; the
// overall status; experience next to the operational numbers (the watermelon flag); breaches by definition, team and
// priority; the agreement tree, its reviews, credits and improvement actions; flags for a review overdue or an end
// near; the document and the customer's acceptance. A customer's contact sees the agreement and its document only.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Input, Progress, Segmented, Space, Tooltip } from "antd";
import { FileText, Gauge, RefreshCw, SquareArrowOutUpLeft, Stamp, TriangleAlert } from "lucide-react";
import { toFa } from "@shared/jalali";
import type { TargetLive } from "@shared/slm/api";
import { AGREEMENT_STATES } from "@shared/tables/slm";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader, JDate } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";
import { recordPath, RecordMarkdown } from "../../records";
import { Sparkline } from "../analytics/Chart";
import { SLM_KEYS, slmApi } from "./api";
import { barPct, categoryLabel, kindLabel, STATUS_LABEL, STATUS_TONE, targetKindLabel, valueText } from "./model";
import "./slm.css";

const stateLabel = (v: unknown) => AGREEMENT_STATES.states.find((s) => s.value === v)?.label ?? String(v ?? "");

function TargetRow({ t }: { t: TargetLive }) {
  const marker = t.goal === null ? null : barPct(t.goal);
  return (
    <div className="slm-target" role="row">
      <div className="slm-target-main" role="cell">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{t.name}</span>
          <Chip tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Chip>
          {!t.customer_facing ? <Chip tone="neutral" dot={false}>داخلی</Chip> : null}
        </div>
        <div className="text-[12px] text-ink-3">
          {targetKindLabel(t.kind)} · {categoryLabel(t.metric_category)}
          {t.kind === "timer" ? <> · {toFa(t.total)} رکورد، {toFa(t.breached)} نقض{t.excluded ? `، ${toFa(t.excluded)} بیرون از سقف` : ""}</> : t.total ? <> · {toFa(t.total)} داده</> : null}
        </div>
      </div>
      <div className="slm-target-bar" role="cell" aria-label={`مقدار ${valueText(t.kind, t.value)} در برابر هدف ${valueText(t.kind, t.goal)}`}>
        <div className="slm-bar">
          <div className="slm-bar-fill" data-status={t.status} style={{ inlineSize: `${barPct(t.value)}%` }} />
          {marker !== null ? <div className="slm-bar-goal" style={{ insetInlineStart: `${marker}%` }} title={`هدف ${valueText(t.kind, t.goal)}`} /> : null}
        </div>
        <div className="flex justify-between text-[12px]">
          <span className="ds-num font-medium">{valueText(t.kind, t.value)}</span>
          <span className="text-ink-3">هدف <span className="ds-num">{valueText(t.kind, t.goal)}</span></span>
        </div>
      </div>
      <div className="slm-target-trend" role="cell">
        <Sparkline points={t.trend.map((p) => ({ key: p.key, label: p.label, value: p.value }))} target={t.goal} height={34} />
      </div>
    </div>
  );
}

export function DocumentDrawer({ id, open, onClose, canAccept, onAccepted }: { id: string; open: boolean; onClose: () => void; canAccept: boolean; onAccepted?: () => void }) {
  const { api, orgId } = useOrg();
  const [view, setView] = useState<"full" | "customer">("full");
  const [text, setText] = useState<{ markdown: string; ai: boolean } | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: SLM_KEYS.doc(orgId, id, view === "customer"), queryFn: () => slmApi.document(api, id, view === "customer"), enabled: open });
  const draft = useAction(() => slmApi.draftDocument(api, id), { onSuccess: (d) => setText(d) });
  const accept = useAction(() => slmApi.accept(api, id, note), { success: "پذیرش توافق ثبت شد", onSuccess: () => onAccepted?.() });
  const md = text?.markdown ?? q.data?.markdown ?? "";
  return (
    <Drawer open={open} onClose={onClose} size="large" title="سند توافق" destroyOnHidden extra={
      <Space>
        <Segmented size="small" value={view} onChange={(v) => { setView(v as "full" | "customer"); setText(null); }} options={[{ value: "full", label: "کامل" }, { value: "customer", label: "نمای مشتری" }]} />
        <Button onClick={() => draft.mutate(undefined)} loading={draft.isPending}>نگارش رسمی</Button>
        <Button onClick={() => window.print()}>چاپ</Button>
      </Space>
    }>
      {q.isLoading ? <Loader /> : <div className="slm-doc"><RecordMarkdown text={md} /></div>}
      {text ? <p className="mt-3 text-[12px] text-ink-3">{text.ai ? "متن با هوش مصنوعی بازنویسی شد؛ عددها و تعهدها همان رکورد است." : "بدون مدل هوش مصنوعی، از خود رکورد ساخته شد."}</p> : null}
      {canAccept ? (
        <Card title="پذیرش مشتری" className="mt-4">
          <Space.Compact className="w-full">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت پذیرش (اختیاری)" maxLength={1000} />
            <Button type="primary" icon={<Stamp {...ICON} />} loading={accept.isPending} onClick={() => accept.mutate(undefined)}>پذیرفتم</Button>
          </Space.Compact>
        </Card>
      ) : null}
    </Drawer>
  );
}

export default function Agreement360() {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [doc, setDoc] = useState(false);
  const q = useQuery({ queryKey: SLM_KEYS.a360(orgId, id), queryFn: () => slmApi.a360(api, id) });
  const measure = useAction(() => slmApi.measure(api, id), { success: "انطباق دورهٔ جاری دوباره سنجیده شد", onSuccess: () => qc.invalidateQueries({ queryKey: SLM_KEYS.a360(orgId, id) }) });
  if (q.isLoading) return <Loader />;
  const d = q.data;
  if (!d) return <EmptyState title="توافق پیدا نشد" />;
  const a = d.agreement;
  const flags = d.flags;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={String(a.name ?? "")}
        subtitle={<span className="flex items-center gap-2 flex-wrap"><span className="ds-latin">{a.number}</span> · {kindLabel(a.kind)} · <Chip tone={flags.in_force ? "in" : "neutral"}>{stateLabel(a.state)}</Chip></span>}
        back
        actions={
          <Space wrap>
            {d.can.write || d.can.manage ? <Button icon={<RefreshCw {...ICON} />} loading={measure.isPending} onClick={() => measure.mutate(undefined)}>سنجش دوباره</Button> : null}
            <Button icon={<FileText {...ICON} />} onClick={() => setDoc(true)}>سند توافق</Button>
            <Button type="primary" icon={<SquareArrowOutUpLeft {...ICON} />} onClick={() => nav(`/${orgId}/${recordPath("service_agreement", id)}`)}>رکورد توافق</Button>
          </Space>
        }
      />
      {flags.review_overdue ? <Note tone="warning">بازبینی این توافق از <JDate v={a.next_review_at} /> عقب افتاده است.</Note> : null}
      {flags.expiring_days !== null ? <Note tone="warning">{flags.expiring_days < 0 ? "اعتبار این توافق گذشته است." : `${toFa(flags.expiring_days)} روز تا پایان اعتبار توافق مانده است؛ تمدید را آغاز کنید.`}</Note> : null}
      {d.watermelon.flagged ? <Note tone="danger">توافق سبز است اما تجربهٔ کاربران {toFa(d.watermelon.gap ?? 0)} امتیاز پایین‌تر است («هندوانه‌ای»): عددهای عملیاتی تصویر کامل را نشان نمی‌دهند.</Note> : null}
      {flags.no_experience_target ? <Note>این توافق مشتری هدف تجربه یا رضایت ندارد؛ برای دیدن «توافق سبز، تجربهٔ قرمز» یک هدف تجربه بیفزایید.</Note> : null}
      <div className="slm-kpis">
        <Card title="انطباق دورهٔ جاری" meta={d.period.label}>
          <div className="flex items-center gap-4">
            <Progress type="dashboard" size={96} percent={Math.round(barPct(d.overall.value))} format={() => <span className="ds-num">{d.overall.value === null ? "—" : `${toFa(Math.round(d.overall.value * 10) / 10)}٪`}</span>} status={d.overall.status === "missed" ? "exception" : "normal"} />
            <div className="flex flex-col gap-1">
              <Chip tone={STATUS_TONE[d.overall.status]}>{STATUS_LABEL[d.overall.status]}</Chip>
              <span className="text-[12px] text-ink-3">هدف <span className="ds-num">{toFa(Number(a.compliance_target ?? 95))}٪</span>، هشدار زیر <span className="ds-num">{toFa(Number(a.at_risk_target ?? 97))}٪</span></span>
            </div>
          </div>
        </Card>
        <Card title="تجربهٔ کاربران" meta={d.experience ? `${toFa(d.experience.responses)} پاسخ` : undefined}>
          {!d.experience || (!d.experience.available && d.experience.responses === 0) ? (
            <p className="text-ink-3 text-[13px]">پاسخ نظرسنجی برای این خدمت نیست.</p>
          ) : d.experience.suppressed ? (
            <p className="text-ink-3 text-[13px]">پاسخ‌ها برای گزارش کافی نیست ({toFa(d.experience.responses)} پاسخ).</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <span>رضایت</span><span className="ds-num">{d.experience.csat === null ? "—" : `${toFa(d.experience.csat)}٪`}</span>
              <span>شادی</span><span className="ds-num">{d.experience.happiness === null ? "—" : toFa(d.experience.happiness)}</span>
              <span>توصیه (NPS)</span><span className="ds-num">{d.experience.nps === null ? "—" : toFa(d.experience.nps)}</span>
              <span>زمان ازدست‌رفته</span><span className="ds-num">{d.experience.lost_minutes === null ? "—" : `${toFa(d.experience.lost_minutes)} دقیقه`}</span>
            </div>
          )}
        </Card>
        <Card title="چرخهٔ عمر" meta={`نسخهٔ ${toFa(Number(a.agreement_version ?? 1))}`}>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <span>اعتبار</span><span><JDate v={a.valid_from} /> تا <JDate v={a.valid_to} /></span>
            <span>بازبینی بعدی</span><span><JDate v={a.next_review_at} /></span>
            <span>پذیرش مشتری</span><span>{a.accepted_at ? <JDate v={a.accepted_at} /> : "—"}</span>
          </div>
        </Card>
      </div>
      {d.targets === null ? (
        <Card title="اهداف"><p className="text-ink-3">اهداف این توافق را در «سند توافق» ببینید.</p></Card>
      ) : !d.targets.length ? (
        <EmptyState icon={Gauge} title="این توافق هنوز هدفی ندارد" description="هدف‌های پاسخ و حل، دسترس‌پذیری یا تجربه را در رکورد توافق بیفزایید." />
      ) : (
        <Card title="اهداف و انطباق" meta={`دوره: ${d.period.label}`}>
          <div role="table" aria-label="اهداف توافق" className="slm-targets">
            {d.targets.map((t) => <TargetRow key={t.id} t={t} />)}
          </div>
        </Card>
      )}
      <div className="slm-cols">
        <Card title="نقض‌های دورهٔ جاری">
          {!d.breaches.length ? <p className="text-ink-3 text-[13px]">نقضی ثبت نشده است.</p> : (
            <div className="flex flex-col gap-3">
              {(["definition", "group", "priority"] as const).map((by) => {
                const xs = d.breaches.filter((b) => b.by === by).slice(0, 5);
                if (!xs.length) return null;
                const max = Math.max(...xs.map((x) => x.count));
                return (
                  <div key={by}>
                    <div className="text-[12px] text-ink-3 mb-1">{by === "definition" ? "بر پایهٔ زمان‌سنج" : by === "group" ? "بر پایهٔ گروه" : "بر پایهٔ اولویت"}</div>
                    {xs.map((x) => (
                      <div key={x.label} className="slm-mini">
                        <span className="truncate">{x.label}</span>
                        <span className="slm-mini-bar"><i style={{ inlineSize: `${(x.count / max) * 100}%` }} /></span>
                        <span className="ds-num">{toFa(x.count)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="بازبینی‌ها و بهبود" meta={d.improvements.open ? `${toFa(d.improvements.open)} اقدام باز` : undefined}>
          {d.improvements.overdue ? <Chip tone="warning">{toFa(d.improvements.overdue)} اقدام عقب‌افتاده</Chip> : null}
          {!d.reviews.length ? <p className="text-ink-3 text-[13px]">بازبینی‌ای ثبت نشده است.</p> : (
            <ul className="flex flex-col gap-1 mt-2">
              {d.reviews.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link className="ds-link truncate" to={`/${orgId}/slm/reviews/${r.id}/pack`}>{r.title}</Link>
                  <span className="text-[12px] text-ink-3"><JDate v={r.scheduled_at} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="ساختار و جریمه‌ها">
          {d.children.length ? (
            <ul className="flex flex-col gap-1">
              {d.children.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link className="ds-link truncate" to={`/${orgId}/slm/agreements/${c.id}/360`}>{c.name}</Link>
                  {c.compliance_status ? <Chip tone={STATUS_TONE[c.compliance_status] ?? "neutral"}>{STATUS_LABEL[c.compliance_status] ?? ""}</Chip> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-ink-3 text-[13px]">توافق زیرمجموعه‌ای ندارد.</p>}
          {d.credits.length ? (
            <div className="mt-3">
              <div className="text-[12px] text-ink-3 mb-1"><TriangleAlert size={12} className="inline" /> جریمه‌ها</div>
              {d.credits.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[13px]">
                  <Link className="ds-link" to={`/${orgId}/${recordPath("slm_credit", c.id)}`}>{c.period_label}</Link>
                  <Tooltip title={c.amount ? `مبلغ ${toFa(c.amount)}` : undefined}><span className="ds-num">{c.credit_pct ? `${toFa(c.credit_pct)}٪` : "—"}</span></Tooltip>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
      <DocumentDrawer id={id} open={doc} onClose={() => setDoc(false)} canAccept={d.can.accept} onAccepted={() => qc.invalidateQueries({ queryKey: SLM_KEYS.a360(orgId, id) })} />
    </div>
  );
}
