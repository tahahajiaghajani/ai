// Parts of the release screens shared by the readiness board and the release's page:
//   ChecksList        the readiness checks with their verdicts, waivers and evidence (REL-013)
//   DecisionModal     the go / go with conditions / no-go decision with conditions and rationale (REL-014)
//   ReleaseActions    header actions of a release: run the checks, record the decision, draft notes, the briefing
//   ReadinessPanel    side panel: lifecycle, readiness bar, blockers, risk with its factors
//   ScopeTab          tab «دامنه و ردیابی»: changes, problems, work items, the traceability matrix, deployments
//   DeploymentRisk    side panel of a deployment: the risk narrative (AI when available) and its environment
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Form, Input, Modal, Progress, Radio, Select, Space, Steps } from "antd";
import { Check, CircleDashed, Gavel, GitPullRequestArrow, ListChecks, NotebookPen, RefreshCw, Sparkles, X } from "lucide-react";
import { lifecycleSteps } from "@shared/release/logic";
import { deploymentOutcome } from "@shared/devops/logic";
import { NOTE_AUDIENCES } from "@shared/tables/release";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, Loader } from "../../components/display";
import { ICON, ICON14 } from "../../components/blocks";
import { Link, useNavigate } from "react-router";
import { RecordMarkdown, recordPath, type RecordContext } from "../../records";
import { RELEASE_KEYS, releaseApi, type Readiness } from "./api";
import { checkActions, checkLabel, checkTone, decisionLabel, decisionTone, readinessTone, riskLabel, riskTone, type Row } from "./model";

/** A link to a record with a label the caller already has (the overview's numbers and titles). */
export function ItemLink({ table, id, label }: { table: string; id: string; label: string }) {
  const { orgId } = useOrg();
  return (
    <Link className="ds-link" to={`/${orgId}/${recordPath(table, id)}`}>
      {label || "—"}
    </Link>
  );
}

/** The roll-up bar of a release's readiness. */
export function ReadinessBar({ r }: { r: Pick<Readiness, "pct" | "ready" | "total"> }) {
  const tone = readinessTone(r.pct, r.ready);
  const color = tone === "in" ? "var(--ds-in)" : tone === "warning" ? "var(--ds-warning)" : "var(--ds-danger)";
  return (
    <div className="flex items-center gap-2" aria-label={`آمادگی ${r.pct.toLocaleString("fa-IR")} درصد`}>
      <Progress percent={r.pct} showInfo={false} strokeColor={color} size="small" className="m-0 flex-1" />
      <span className="ds-num text-[12px] text-ink-2">{r.total ? `${r.pct.toLocaleString("fa-IR")}٪` : "—"}</span>
    </div>
  );
}

export function ChecksList({ releaseId, checks, manages, canWork, onChanged }: { releaseId: string; checks: Row[]; manages: boolean; canWork: boolean; onChanged: () => void }) {
  const { api } = useOrg();
  const [waiving, setWaiving] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const verdict = useAction((v: { id: string; status: string }) => releaseApi.verdict(api, releaseId, v.id, v.status), { success: "نتیجهٔ بررسی ثبت شد", onSuccess: onChanged });
  const waive = useAction((v: { id: string; reason: string }) => releaseApi.waive(api, releaseId, v.id, v.reason), { success: "از بررسی چشم‌پوشی شد", onSuccess: () => { setWaiving(null); setReason(""); onChanged(); } });
  if (!checks.length) return <p className="text-[13px] text-ink-3">هنوز بررسی آمادگی‌ای برای این انتشار ساخته نشده است.</p>;
  return (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {checks.map((c) => {
          const a = checkActions(c, manages);
          return (
            <li key={c.id} className="flex flex-col gap-1 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={checkTone(c.status)}>{checkLabel(c.status)}</Chip>
                <span className="text-[13px] text-ink">{c.name}</span>
                {c.blocking === false ? <span className="text-[12px] text-ink-3">(غیربازدارنده)</span> : null}
                <span className="ms-auto flex gap-1">
                  {a.verdict && canWork ? (
                    <>
                      <Button size="small" icon={<Check {...ICON14} />} onClick={() => verdict.mutate({ id: c.id, status: "pass" })} loading={verdict.isPending} aria-label={`قبول «${c.name}»`}>قبول</Button>
                      <Button size="small" icon={<X {...ICON14} />} onClick={() => verdict.mutate({ id: c.id, status: "fail" })} loading={verdict.isPending} aria-label={`رد «${c.name}»`}>رد</Button>
                    </>
                  ) : null}
                  {a.waive ? <Button size="small" onClick={() => setWaiving(c)}>چشم‌پوشی</Button> : null}
                </span>
              </div>
              {c.message ? <p className="text-[12px] text-ink-2">{c.message}</p> : null}
              {c.status === "waived" && c.waiver_reason ? <p className="text-[12px] text-ink-3">دلیل چشم‌پوشی: {c.waiver_reason}</p> : null}
            </li>
          );
        })}
      </ul>
      <Modal
        open={!!waiving}
        title={`چشم‌پوشی از «${waiving?.name ?? ""}»`}
        okText="ثبت چشم‌پوشی"
        cancelText="انصراف"
        okButtonProps={{ disabled: reason.trim().length < 3, loading: waive.isPending }}
        onOk={() => waiving && waive.mutate({ id: waiving.id, reason })}
        onCancel={() => setWaiving(null)}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="دلیل و ریسک پذیرفته‌شده" required>
            <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function DecisionModal({ release, open, onClose, onDone }: { release: Row; open: boolean; onClose: () => void; onDone: () => void }) {
  const { api } = useOrg();
  const [decision, setDecision] = useState<"go" | "go_with_conditions" | "no_go">("go");
  const [conditions, setConditions] = useState("");
  const [rationale, setRationale] = useState("");
  const [returnTo, setReturnTo] = useState<"test" | "build">("test");
  const decide = useAction(() => releaseApi.decide(api, release.id, { decision, rationale, conditions: decision === "go_with_conditions" ? conditions : null, ...(decision === "no_go" ? { return_to: returnTo } : {}) }), {
    success: (d) => `تصمیم «${decisionLabel(d.decision.decision)}» ثبت شد`,
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const valid = rationale.trim().length >= 3 && (decision !== "go_with_conditions" || conditions.trim().length > 0);
  return (
    <Modal open={open} title={`تصمیم اجرای ${release.number ?? ""}`} okText="ثبت تصمیم" cancelText="انصراف" onOk={() => decide.mutate(undefined)} onCancel={onClose} okButtonProps={{ disabled: !valid, loading: decide.isPending, danger: decision === "no_go" }} destroyOnHidden>
      <Form layout="vertical">
        <Form.Item label="تصمیم">
          <Radio.Group value={decision} onChange={(e) => setDecision(e.target.value)} optionType="button" buttonStyle="solid">
            <Radio.Button value="go">اجرا (Go)</Radio.Button>
            <Radio.Button value="go_with_conditions">اجرا با شرط</Radio.Button>
            <Radio.Button value="no_go">توقف (No-Go)</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {decision === "go_with_conditions" ? (
          <Form.Item label="شرط‌ها" required>
            <Input.TextArea rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} maxLength={4000} />
          </Form.Item>
        ) : null}
        {decision === "no_go" ? (
          <Form.Item label="بازگشت به">
            <Select value={returnTo} onChange={setReturnTo} options={[{ value: "test", label: "آزمون" }, { value: "build", label: "ساخت" }]} />
          </Form.Item>
        ) : null}
        <Form.Item label="دلیل" required>
          <Input.TextArea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={4000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** A Markdown answer of an AI-or-rules button with its label. */
function AnswerModal({ title, text, ai, open, onClose, footer }: { title: string; text: string; ai: boolean; open: boolean; onClose: () => void; footer?: ReactNode }) {
  return (
    <Modal open={open} title={title} onCancel={onClose} footer={footer ?? null} width={720} destroyOnHidden>
      <p className="mb-2 text-[12px] text-ink-3">{ai ? "ساخته‌شده با هوش مصنوعی — پیش از استفاده بازبینی کنید" : "بدون مدل هوش مصنوعی و با قاعده ساخته شد"}</p>
      <RecordMarkdown text={text} />
    </Modal>
  );
}

export function ReleaseActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const r = ctx.row as Row;
  const meta = (ctx.meta.release ?? {}) as { can_work?: boolean; manages?: boolean };
  const [deciding, setDeciding] = useState(false);
  const [answer, setAnswer] = useState<{ title: string; text: string; ai: boolean; audience?: string } | null>(null);
  const refresh = () => {
    ctx.refresh();
    qc.invalidateQueries({ queryKey: RELEASE_KEYS.record(orgId, r.id, "overview") });
  };
  const run = useAction(() => releaseApi.runChecks(api, r.id), { success: (d) => `بررسی‌ها اجرا شد؛ آمادگی ${d.readiness.pct.toLocaleString("fa-IR")}٪`, onSuccess: refresh });
  const brief = useAction(() => releaseApi.briefing(api, r.id), { onSuccess: (d) => setAnswer({ title: "گزارش آمادگی و مانع‌ها", text: d.text, ai: d.ai }) });
  const notes = useAction((audience: string) => releaseApi.draftNotes(api, r.id, audience), { onSuccess: (d, audience) => setAnswer({ title: d.title, text: d.body, ai: d.ai, audience }) });
  const save = useAction((audience: string) => releaseApi.draftNotes(api, r.id, audience, true), { success: "پیش‌نویس یادداشت انتشار ذخیره شد", onSuccess: () => { setAnswer(null); refresh(); } });
  const change = useAction(() => releaseApi.changeFor(api, r.id), { success: (c) => `تغییر ${c.number ?? ""} ساخته و به انتشار پیوند خورد`, onSuccess: (c) => nav(`/${orgId}/${recordPath("change_request", String(c.id))}`) });
  const open = !["closed", "canceled"].includes(String(r.state));
  return (
    <Space wrap>
      {open && meta.can_work ? (
        <Button icon={<ListChecks {...ICON} />} onClick={() => run.mutate(undefined)} loading={run.isPending}>
          اجرای بررسی‌ها
        </Button>
      ) : null}
      {r.state === "readiness" && meta.manages ? (
        <Button type="primary" icon={<Gavel {...ICON} />} onClick={() => setDeciding(true)}>
          تصمیم اجرا
        </Button>
      ) : null}
      {open && meta.can_work && ["draft", "planning", "build", "test"].includes(String(r.state)) ? (
        <Button icon={<GitPullRequestArrow {...ICON} />} onClick={() => change.mutate(undefined)} loading={change.isPending}>
          ثبت تغییر انتشار
        </Button>
      ) : null}
      <Button icon={<Sparkles {...ICON} />} onClick={() => brief.mutate(undefined)} loading={brief.isPending}>
        گزارش آمادگی
      </Button>
      <Dropdown menu={{ items: NOTE_AUDIENCES.map((a) => ({ key: a.value, label: `یادداشت برای ${a.label}` })), onClick: ({ key }) => notes.mutate(key) }}>
        <Button icon={<NotebookPen {...ICON} />} loading={notes.isPending}>
          یادداشت انتشار
        </Button>
      </Dropdown>
      <DecisionModal release={r} open={deciding} onClose={() => setDeciding(false)} onDone={refresh} />
      <AnswerModal
        open={!!answer}
        title={answer?.title ?? ""}
        text={answer?.text ?? ""}
        ai={!!answer?.ai}
        onClose={() => setAnswer(null)}
        footer={answer?.audience && meta.can_work ? <Button type="primary" loading={save.isPending} onClick={() => save.mutate(answer.audience!)}>ذخیره به‌عنوان یادداشت انتشار</Button> : null}
      />
    </Space>
  );
}

export function ReadinessPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const r = ctx.row as Row;
  const meta = (ctx.meta.release ?? {}) as { can_work?: boolean; manages?: boolean };
  const overview = useQuery({ queryKey: RELEASE_KEYS.record(orgId, r.id, "overview", r.version), queryFn: () => releaseApi.overview(api, r.id) });
  const steps = lifecycleSteps(String(r.state), r.state_before_hold as string | null);
  const current = steps.findIndex((s) => s.status === "current");
  const factors = Array.isArray(r.risk_factors) ? (r.risk_factors as Row[]) : [];
  return (
    <div className="flex flex-col gap-3">
      <Steps size="small" direction="vertical" current={current < 0 ? 0 : current} items={steps.map((s) => ({ title: s.label, status: s.status === "done" ? "finish" : s.status === "current" ? "process" : "wait" }))} />
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={decisionTone(r.go_no_go)}>{decisionLabel(r.go_no_go)}</Chip>
        {r.risk_band ? <Chip tone={riskTone(r.risk_band)}>ریسک {riskLabel(r.risk_band)}</Chip> : null}
      </div>
      {overview.isLoading ? (
        <Loader />
      ) : overview.data ? (
        <>
          <ReadinessBar r={overview.data.readiness as Readiness} />
          {(overview.data.readiness as Readiness).blockers.length ? (
            <ul className="flex flex-col gap-1 text-[12px] text-ink-2">
              {(overview.data.readiness as Readiness).blockers.slice(0, 6).map((b) => (
                <li key={b} className="flex items-start gap-1.5"><CircleDashed {...ICON14} className="mt-0.5 text-warning" aria-hidden />{b}</li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary className="cursor-pointer text-[13px] text-ink-2">بررسی‌های آمادگی</summary>
            <ChecksList releaseId={r.id} checks={(overview.data.checks as Row[]) ?? []} manages={!!meta.manages} canWork={!!meta.can_work} onChanged={() => { ctx.refresh(); overview.refetch(); }} />
          </details>
        </>
      ) : null}
      {factors.length ? (
        <ul className="flex flex-col gap-1 text-[12px] text-ink-2" aria-label="عامل‌های ریسک">
          {factors.map((f) => (
            <li key={String(f.key)}>
              <b className="text-ink">{String(f.label)}</b> (+{Number(f.points).toLocaleString("fa-IR")}): {String(f.detail ?? "")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const SCOPE_TITLES: Record<string, string> = { changes: "تغییرها", problems: "مشکل‌های رفع‌شده", known_errors: "خطاهای شناخته‌شده", incidents: "رخدادها", work_items: "کارهای پروژه", pull_requests: "درخواست‌های ادغام", other: "دیگر" };

export function ScopeTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const r = ctx.row as Row;
  const q = useQuery({ queryKey: RELEASE_KEYS.record(orgId, r.id, "overview", r.version), queryFn: () => releaseApi.overview(api, r.id) });
  if (q.isLoading) return <Loader />;
  if (!q.data) return null;
  const scope = q.data.scope as Record<string, Row[]>;
  const deployments = (q.data.deployments as Row[]) ?? [];
  const display = (q.data.display ?? {}) as Record<string, string>;
  const trace = (q.data.trace as Row[]) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-ink-3">دامنه با پیوندهای «شامل» و «رفع می‌کند» ساخته می‌شود (بخش پیوندهای همین صفحه).</p>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(SCOPE_TITLES).filter(([k]) => (scope[k] ?? []).length).map(([k, title]) => (
          <section key={k} aria-label={title}>
            <h3 className="mb-1 text-[13px] text-ink-2">{title} ({(scope[k] ?? []).length.toLocaleString("fa-IR")})</h3>
            <ul className="flex flex-col gap-1 text-[13px]">
              {(scope[k] ?? []).map((x) => (
                <li key={`${x.table}:${x.id}`}>
                  <ItemLink table={String(x.table)} id={String(x.id)} label={`${x.number ?? ""} ${x.display ?? ""}`.trim()} />
                  {x.state ? <span className="ms-1 text-[12px] text-ink-3">({String(x.state)})</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {trace.length ? (
        <section aria-label="ماتریس ردیابی">
          <h3 className="mb-1 text-[13px] text-ink-2">ماتریس ردیابی: تغییر ← استقرار</h3>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-ink-3"><th className="py-1 text-start font-normal">تغییر</th><th className="py-1 text-start font-normal">استقرارها</th></tr>
            </thead>
            <tbody>
              {trace.map((t) => (
                <tr key={String((t.change as Row).id)} className="border-t border-line">
                  <td className="py-1.5"><ItemLink table="change_request" id={String((t.change as Row).id)} label={String((t.change as Row).number ?? "")} /></td>
                  <td className="py-1.5">{(t.deployments as Row[]).length ? (t.deployments as Row[]).map((d) => <span key={String(d.id)} className="me-2"><ItemLink table="deployment" id={String(d.id)} label={`${d.number} · ${display[String(d.environment_id)] ?? ""}`} /></span>) : <span className="text-ink-3">هنوز مستقر نشده</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section aria-label="استقرارها">
        <h3 className="mb-1 text-[13px] text-ink-2">استقرارها در محیط‌ها</h3>
        {deployments.length ? (
          <ul className="flex flex-col gap-1 text-[13px]">
            {deployments.map((d) => (
              <li key={String(d.id)} className="flex flex-wrap items-center gap-2">
                <ItemLink table="deployment" id={String(d.id)} label={String(d.number)} />
                <span>{display[String(d.environment_id)] ?? ""}</span>
                <span className="ltr text-ink-3">{d.artifact_version ?? ""}</span>
                <Chip tone={deploymentOutcome(d) === "ok" ? "in" : deploymentOutcome(d) === "failed" ? "danger" : "neutral"}>{String(d.state)}</Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">هنوز استقراری برای این انتشار ثبت نشده است.</p>
        )}
      </section>
    </div>
  );
}

export function DeploymentRisk({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const r = ctx.row as Row;
  const [answer, setAnswer] = useState<{ text: string; ai: boolean; band: string } | null>(null);
  const run = useAction(() => releaseApi.deploymentNarrative(api, r.id), { onSuccess: (d) => setAnswer(d) });
  return (
    <div className="flex flex-col gap-2">
      {r.policy_note ? <p className="text-[12px] text-warning">{String(r.policy_note)}</p> : null}
      {r.change_failure ? <Chip tone="danger">شکست تغییر (DORA)</Chip> : null}
      <Button size="small" icon={<RefreshCw {...ICON14} />} onClick={() => run.mutate(undefined)} loading={run.isPending}>
        روایت ریسک استقرار
      </Button>
      {answer ? (
        <div className="flex flex-col gap-1">
          <Chip tone={riskTone(answer.band)}>ریسک {riskLabel(answer.band)}</Chip>
          <p className="text-[12px] text-ink-3">{answer.ai ? "ساخته‌شده با هوش مصنوعی — پیش از استفاده بازبینی کنید" : "بدون مدل هوش مصنوعی و با قاعده ساخته شد"}</p>
          <RecordMarkdown text={answer.text} />
        </div>
      ) : null}
    </div>
  );
}
