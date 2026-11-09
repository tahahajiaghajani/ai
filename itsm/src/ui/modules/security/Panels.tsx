// Side panels of the security module's record pages: a security incident's times, indicators and regulatory clocks; a
// vulnerable item's risk factors; a regulatory clock's stages with «ثبت ارسال»; evidence's chain of custody with
// «تحویل»; a control's crosswalk to frameworks; a campaign's acknowledgement status; a risk's place in the matrix; and
// personal data found in a record's text fields with «حذف».
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Input, Space } from "antd";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, JDateTime, Loader } from "../../components/display";
import { recordPath, UserSelect, type RecordContext } from "../../records";
import { SEC_KEYS, durationFa, securityApi } from "./api";
import { MATRIX_5X5 } from "@shared/security/frameworks";

const VERDICT: Record<string, [string, "danger" | "warning" | "neutral" | "in"]> = { malicious: ["مخرب", "danger"], suspicious: ["مشکوک", "warning"], benign: ["بی‌خطر", "in"], unknown: ["نامعلوم", "neutral"] };
const fa = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("fa-IR"));

export function SirPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: [...SEC_KEYS.facts(orgId, ctx.row.id), ctx.row.version], queryFn: () => securityApi.facts(api, ctx.row.id), staleTime: 30_000 });
  if (q.isLoading) return <Loader />;
  const f = q.data;
  if (!f) return null;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt className="text-ink-2">زمان تا کشف</dt>
        <dd className="ds-num">{durationFa(f.times.detect)}</dd>
        <dt className="text-ink-2">زمان تا مهار</dt>
        <dd className="ds-num">{durationFa(f.times.contain)}</dd>
        <dt className="text-ink-2">زمان تا بازیابی</dt>
        <dd className="ds-num">{durationFa(f.times.recover)}</dd>
        <dt className="text-ink-2">کارهای باز</dt>
        <dd className="ds-num">{fa(f.open_tasks)}</dd>
      </dl>
      <div>
        <div className="mb-1 text-ink-2">نشانگرها</div>
        {f.observables.length ? (
          <ul className="flex flex-col gap-1">
            {f.observables.slice(0, 12).map((o) => (
              <li key={o.id} className="flex min-w-0 items-center gap-2">
                <Link to={`/${orgId}/${recordPath("sec_observable", o.id)}`} className="ds-link min-w-0 truncate" dir="ltr">
                  {o.value}
                </Link>
                <span className="ms-auto shrink-0">
                  <Chip tone={VERDICT[o.verdict]?.[1] ?? "neutral"}>{o.is_ioc ? "IOC · " : ""}{VERDICT[o.verdict]?.[0] ?? o.verdict}</Chip>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-3">نشانگری ثبت نشده است.</p>
        )}
      </div>
      <div>
        <div className="mb-1 text-ink-2">اطلاع‌رسانی الزامی</div>
        {f.clocks.length ? (
          <ul className="flex flex-col gap-1">
            {f.clocks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Link to={`/${orgId}/${recordPath("sec_reg_clock", c.id)}`} className="ds-link">
                  <bdi className="ds-num">{c.number}</bdi>
                </Link>
                <span className="text-ink-2">{c.next_stage ?? "همهٔ مرحله‌ها فرستاده شد"}</span>
                {c.next_due_at ? <JDateTime v={c.next_due_at} /> : null}
                {c.overdue ? <Chip tone="danger">دیرکرد</Chip> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-3">ساعتی شروع نشده است.</p>
        )}
      </div>
    </div>
  );
}

export function RiskFactorsPanel({ ctx }: { ctx: RecordContext }) {
  const factors = (Array.isArray(ctx.row.risk_factors) ? ctx.row.risk_factors : []) as { key: string; label: string; value: string; weight: number }[];
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="ds-num text-[20px] text-ink">{fa(ctx.row.risk_score as number)}</span>
        <span className="text-ink-2">از ۱۰۰</span>
        {ctx.row.overdue ? <Chip tone="danger">گذشته از موعد</Chip> : null}
      </div>
      <ul className="flex flex-col gap-1">
        {factors.map((f) => (
          <li key={f.key} className="grid grid-cols-[1fr_auto] gap-2">
            <span className="text-ink-2">{f.label}</span>
            <bdi className="ds-num">{f.value}</bdi>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-ink-3">امتیاز = CVSS × احتمال بهره‌برداری × KEV × اهمیت دارایی × در معرض بودن × (۱ − کنترل جبرانی)</p>
    </div>
  );
}

export function ClockPanel({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const [ref, setRef] = useState("");
  const submit = useAction((stage: string) => securityApi.submitStage(api, ctx.row.id, stage, ref || null), {
    success: "ارسال ثبت شد.",
    onSuccess: () => {
      setRef("");
      ctx.refresh();
    },
  });
  const deadlines = (Array.isArray(ctx.row.deadlines) ? ctx.row.deadlines : []) as { stage: string; label: string; due_at: string; submitted_at: string | null }[];
  const can = ctx.meta.canWrite && ctx.row.state === "running";
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <ul className="flex flex-col gap-2">
        {deadlines.map((d) => {
          const late = !d.submitted_at && Date.parse(d.due_at) < Date.now();
          return (
            <li key={d.stage} className="flex flex-col gap-1 rounded-md bg-sunken px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="text-ink">{d.label}</span>
                <span className="ms-auto">{d.submitted_at ? <Chip tone="in">فرستاده شد</Chip> : late ? <Chip tone="danger">دیرکرد</Chip> : <Chip tone="warning">در انتظار</Chip>}</span>
              </div>
              <div className="text-ink-2">
                موعد: <JDateTime v={d.due_at} />
                {d.submitted_at ? (
                  <>
                    {" "}· ارسال: <JDateTime v={d.submitted_at} />
                  </>
                ) : null}
              </div>
              {can && !d.submitted_at ? (
                <Button size="small" onClick={() => submit.mutate(d.stage)} loading={submit.isPending && submit.variables === d.stage}>
                  ثبت ارسال
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {can ? <Input size="small" dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="شمارهٔ پیگیری نزد نهاد (اختیاری)" aria-label="شمارهٔ پیگیری" /> : null}
    </div>
  );
}

const CUSTODY: Record<string, string> = { collected: "گردآوری", transfer: "تحویل", hold: "توقیف قانونی", hold_lifted: "رفع توقیف", moved: "جابه‌جایی", hash_changed: "تغییر هش", file_attached: "پیوست پرونده", in_analysis: "شروع تحلیل", stored: "بایگانی امن", released: "آزادسازی", destroyed: "امحا" };

export function CustodyPanel({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const transfer = useAction(() => securityApi.transfer(api, ctx.row.id, to!, null, note || null), {
    success: "شاهد تحویل شد و در دفتر حضانت ثبت شد.",
    onSuccess: () => {
      setTo(null);
      setNote("");
      ctx.refresh();
    },
  });
  const log = (Array.isArray(ctx.row.custody_log) ? ctx.row.custody_log : []) as { at: string; action: string; to?: string | null; location?: string | null }[];
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <ol className="flex flex-col gap-1">
        {[...log].reverse().slice(0, 20).map((e, i) => (
          <li key={`${e.at}-${i}`} className="grid grid-cols-[auto_1fr] gap-2">
            <span className="text-ink-3">
              <JDateTime v={e.at} />
            </span>
            <span>
              {CUSTODY[e.action] ?? e.action}
              {e.to && ctx.display[e.to] ? ` ← ${ctx.display[e.to]}` : ""}
              {e.location ? ` · ${e.location}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {ctx.meta.canWrite && !ctx.meta.locked ? (
        <Space direction="vertical" className="w-full">
          <UserSelect value={to} onChange={(v) => setTo(typeof v === "string" ? v : null)} placeholder="نگه‌دارندهٔ تازه" />
          <Input size="small" value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت تحویل" aria-label="یادداشت تحویل" />
          <Button size="small" block disabled={!to} onClick={() => transfer.mutate(undefined)} loading={transfer.isPending}>
            تحویل شاهد
          </Button>
        </Space>
      ) : null}
    </div>
  );
}

const COMPLIANCE_TONE: Record<string, "in" | "warning" | "danger" | "neutral"> = { compliant: "in", partial: "warning", non_compliant: "danger" };

export function CrosswalkPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: [...SEC_KEYS.crosswalk(orgId, ctx.row.id), ctx.row.version], queryFn: () => securityApi.crosswalk(api, ctx.row.id), staleTime: 60_000 });
  if (q.isLoading) return <Loader />;
  const fws = q.data?.frameworks ?? [];
  if (!fws.length) return <p className="text-[13px] text-ink-3">به الزامی نگاشته نشده است.</p>;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {fws.map((f) => (
        <div key={f.framework_id}>
          <div className="mb-1 text-ink-2">{f.framework}</div>
          <div className="flex flex-wrap gap-1">
            {f.requirements.map((r) => (
              <Link key={r.id} to={`/${orgId}/${recordPath("grc_requirement", r.id)}`} title={r.title}>
                <Chip tone={COMPLIANCE_TONE[r.compliance] ?? "neutral"}>
                  <bdi dir="ltr">{r.code}</bdi>
                </Chip>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CampaignPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const participant = (ctx.meta as { reach?: string }).reach === "participant";
  const q = useQuery({ queryKey: [...SEC_KEYS.campaign(orgId, ctx.row.id), ctx.row.version], queryFn: () => securityApi.campaignStatus(api, ctx.row.id), enabled: !participant, staleTime: 30_000 });
  if (participant) return <Link className="ds-link text-[13px]" to={`/${orgId}/security/my-policies`}>خواندن و پذیرش در «خط‌مشی‌های من»</Link>;
  if (q.isLoading) return <Loader />;
  const s = q.data;
  if (!s) return null;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-baseline gap-2">
        <span className="ds-num text-[20px] text-ink">{s.rate === null ? "—" : `${fa(s.rate)}٪`}</span>
        <span className="text-ink-2">
          {fa(s.acknowledged)} از {fa(s.audience)} نفر
        </span>
      </div>
      {s.pending.length ? (
        <div>
          <div className="mb-1 text-ink-2">هنوز نپذیرفته‌اند</div>
          <div className="flex flex-wrap gap-1">
            {s.pending.slice(0, 30).map((u) => (
              <Chip key={u} tone="neutral">
                {s.display[u] ?? "—"}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const RATING_VAR: Record<string, string> = { low: "var(--ds-in-tint)", medium: "var(--ds-warning-tint)", high: "var(--ds-danger-tint)", critical: "var(--ds-danger-border)" };

/** The risk's inherent (ذ), residual (ب) and target (ه) cells on the 5 × 5 matrix. */
export function RiskMatrixPanel({ ctx }: { ctx: RecordContext }) {
  const mark = (l: unknown, i: unknown) => [Number(l), Number(i)] as const;
  const marks = [
    { k: "ذ", t: "ذاتی", at: mark(ctx.row.inherent_likelihood, ctx.row.inherent_impact) },
    { k: "ب", t: "باقی‌مانده", at: mark(ctx.row.residual_likelihood, ctx.row.residual_impact) },
    { k: "ه", t: "هدف", at: mark(ctx.row.target_likelihood, ctx.row.target_impact) },
  ];
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <div className="grid grid-cols-[auto_repeat(5,1fr)] gap-0.5" role="grid" aria-label="ماتریس احتمال و اثر">
        {[5, 4, 3, 2, 1].map((l) => (
          <div key={l} className="contents" role="row">
            <span className="ds-num pe-1 text-ink-3">{fa(l)}</span>
            {[1, 2, 3, 4, 5].map((i) => {
              const here = marks.filter((m) => m.at[0] === l && m.at[1] === i);
              return (
                <span key={i} role="gridcell" className="flex h-7 items-center justify-center rounded-xs text-ink" style={{ background: RATING_VAR[MATRIX_5X5[l - 1][i - 1]] }} title={here.map((m) => m.t).join("، ")}>
                  {here.map((m) => m.k).join(" ")}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="text-ink-3">ذ: ذاتی · ب: باقی‌مانده · ه: هدف — محور عمودی احتمال، افقی اثر</div>
      {ctx.row.above_appetite ? <Chip tone="danger">بالاتر از اشتهای ریسک ({fa(ctx.row.appetite_score as number)})</Chip> : null}
    </div>
  );
}

export function PiiPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const [run, setRun] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const q = useQuery({ queryKey: [...SEC_KEYS.pii(orgId, ctx.table, ctx.row.id), ctx.row.version], queryFn: () => securityApi.pii(api, ctx.table, ctx.row.id), enabled: run });
  const redact = useAction(() => securityApi.redact(api, ctx.table, ctx.row.id, pick), {
    success: (d) => `${d.redacted.toLocaleString("fa-IR")} مورد حذف شد.`,
    onSuccess: () => {
      setPick([]);
      ctx.refresh();
      void q.refetch();
    },
  });
  if (!run)
    return (
      <Button size="small" onClick={() => setRun(true)}>
        جست‌وجوی دادهٔ شخصی
      </Button>
    );
  if (q.isLoading) return <Loader />;
  const fields = q.data?.fields ?? [];
  if (!fields.length) return <p className="text-[13px] text-ink-3">دادهٔ شخصی‌ای در متن‌ها پیدا نشد.</p>;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {fields.map((f) => (
        <div key={f.field} className="flex flex-col gap-1">
          <Checkbox checked={pick.includes(f.field)} onChange={(e) => setPick(e.target.checked ? [...pick, f.field] : pick.filter((x) => x !== f.field))} disabled={!ctx.meta.canWrite}>
            {f.label}
          </Checkbox>
          <div className="flex flex-wrap gap-1 ps-6">
            {f.findings.map((x, i) => (
              <Chip key={i} tone="warning">
                {x.label} <bdi dir="ltr">{x.masked}</bdi>
              </Chip>
            ))}
          </div>
        </div>
      ))}
      {ctx.meta.canWrite ? (
        <Button size="small" danger disabled={!pick.length} onClick={() => redact.mutate(undefined)} loading={redact.isPending}>
          حذف از فیلدهای انتخاب‌شده
        </Button>
      ) : null}
    </div>
  );
}
