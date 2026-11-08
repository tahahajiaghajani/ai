// The risk of a change — side panel «ریسک» (CHG-027: level, score, what weighed most, the questionnaire's progress,
// the team's success score and the notice) and the tab «ارزیابی ریسک» (CHG-019: the questionnaire itself, the factors,
// the explanation; AI narrative and suggested answers when the AI layer registered them).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Progress, Radio, Space, Tooltip } from "antd";
import { Sparkles, Save, ShieldAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, Loader } from "../../components/display";
import { NumberInput } from "../../components/inputs";
import { ICON14 } from "../../components/blocks";
import { RecordMarkdown, type RecordContext } from "../../records";
import { CHANGE_KEYS, changeApi, useChangeRefresh } from "./api";
import { cleanAnswers, progress, riskChip, riskLabel, topFactors } from "./model";

function useRisk(id: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: CHANGE_KEYS.record(orgId, id, "risk"), queryFn: () => changeApi.risk(api, id), staleTime: 15_000 });
}

export function RiskPanel({ ctx }: { ctx: RecordContext }) {
  const q = useRisk(ctx.row.id);
  // the record changes (a save, a transition): the risk follows
  const { refetch } = q;
  useEffect(() => {
    void refetch();
  }, [ctx.row.version, refetch]);
  if (q.isLoading) return <Loader />;
  if (!q.data) return <p className="text-[13px] text-ink-3">ریسک این تغییر در دسترس نیست.</p>;
  const v = q.data;
  const p = progress(v.questions, v.answers);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Chip tone={riskChip(v.risk)}>{riskLabel(v.risk)}</Chip>
        <span className="ds-num text-[13px] text-ink-2">امتیاز {v.result.score} از ۱۰۰</span>
        {v.risk_source === "manual" ? (
          <Tooltip title={v.risk_override_reason ?? ""}>
            <span className="text-[12px] text-warning">دستی (محاسبه‌شده: {riskLabel(v.result.level)})</span>
          </Tooltip>
        ) : v.risk_source === "template" ? (
          <span className="text-[12px] text-ink-3">از الگوی استاندارد</span>
        ) : null}
      </div>
      <Progress percent={v.result.score} showInfo={false} size="small" status={v.result.score >= v.bands.high ? "exception" : "normal"} aria-label="امتیاز ریسک" />
      <ul className="flex flex-col gap-1.5">
        {topFactors(v.result.factors).map((f) => (
          <li key={f.key} className="flex flex-col">
            <span className="text-[13px] text-ink">{f.label}</span>
            <span className="text-[12px] text-ink-3">{f.detail}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <span className="ds-num">پرسش‌نامه: {p.answered} از {p.total}</span>
        {p.missing ? <span className="text-warning">{p.missing} پرسش لازم بی‌پاسخ</span> : null}
        <span className="ds-num">سابقهٔ تیم: {v.team_score === null ? "—" : v.team_score}</span>
        {v.lead.days !== null ? <span className={v.lead.late ? "text-warning" : undefined}>مهلت اعلام: {v.lead.days} از {v.lead.required} روز کاری</span> : null}
      </div>
    </div>
  );
}

export function RiskTab({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const q = useRisk(ctx.row.id);
  const refresh = useChangeRefresh();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [narrative, setNarrative] = useState<{ text: string; ai: boolean } | null>(null);
  useEffect(() => {
    if (q.data) setAnswers(q.data.answers ?? {});
  }, [q.data]);
  const dirty = useMemo(() => JSON.stringify(cleanAnswers(answers)) !== JSON.stringify(cleanAnswers(q.data?.answers ?? {})), [answers, q.data]);
  const save = useAction(() => changeApi.saveRisk(api, ctx.row.id, cleanAnswers(answers), Number(ctx.row.version)), {
    success: (d) => `ریسک «${riskLabel(d.risk)}» (امتیاز ${d.result.score}) ثبت شد.`,
    onSuccess: () => {
      refresh();
      ctx.refresh();
    },
  });
  const explain = useAction(() => changeApi.explainRisk(api, ctx.row.id), { onSuccess: (d) => setNarrative(d) });
  if (q.isLoading) return <Loader />;
  if (!q.data) return <p className="text-ink-3">ریسک این تغییر در دسترس نیست.</p>;
  const v = q.data;
  const editable = !!ctx.meta.canWrite && !v.locked;
  const p = progress(v.questions, answers);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      {v.questions.length ? (
        <section className="flex flex-col gap-4" aria-label="پرسش‌نامهٔ ارزیابی ریسک">
          {v.questions.map((qn, i) => (
            <fieldset key={qn.id} className="flex flex-col gap-1.5 border-b border-line pb-3">
              <legend className="ds-t-label text-ink">
                <span className="ds-num">{i + 1}.</span> {qn.question}
                {qn.mandatory ? <span className="text-danger"> *</span> : null}
              </legend>
              {qn.help ? <span className="text-[12px] text-ink-3">{qn.help}</span> : null}
              {qn.kind === "number" ? (
                <NumberInput
                  value={answers[qn.id] === undefined || answers[qn.id] === "" ? null : Number(answers[qn.id])}
                  onChange={(n) => setAnswers((a) => ({ ...a, [qn.id]: n === null || n === undefined ? "" : n }))}
                  disabled={!editable}
                  style={{ maxWidth: 180 }}
                  aria-label={qn.question}
                />
              ) : (
                <Radio.Group
                  value={answers[qn.id] ?? null}
                  onChange={(e) => setAnswers((a) => ({ ...a, [qn.id]: e.target.value }))}
                  disabled={!editable}
                  options={qn.options.map((o) => ({ value: o.value, label: o.label }))}
                />
              )}
            </fieldset>
          ))}
          <Space>
            {editable ? (
              <Button type="primary" icon={<Save {...ICON14} />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                ثبت پاسخ‌ها
              </Button>
            ) : null}
            <span className="ds-num text-[13px] text-ink-2">
              {p.answered} از {p.total} پاسخ{p.missing ? `؛ ${p.missing} پرسش لازم مانده` : ""}
            </span>
          </Space>
        </section>
      ) : (
        <p className="text-ink-3">برای این تغییر پرسشی تعریف نشده است؛ ریسک از عامل‌های خودکار حساب می‌شود.</p>
      )}

      <section className="flex flex-col gap-2" aria-label="عامل‌های ریسک">
        <h3 className="ds-t-section flex items-center gap-2">
          <ShieldAlert {...ICON14} /> عامل‌ها
        </h3>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-ink-3">
              <th className="py-1 text-start font-normal">عامل</th>
              <th className="py-1 text-start font-normal">شرح</th>
              <th className="py-1 text-end font-normal">امتیاز</th>
              <th className="py-1 text-end font-normal">وزن</th>
            </tr>
          </thead>
          <tbody>
            {v.result.factors.map((f) => (
              <tr key={f.key} className="border-t border-line">
                <td className="py-1.5">{f.label}</td>
                <td className="py-1.5 text-ink-2">{f.detail}</td>
                <td className="ds-num py-1.5 text-end">{f.score}</td>
                <td className="ds-num py-1.5 text-end">{f.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <span className="ds-num text-[12px] text-ink-3">
          سهم پرسش‌نامه {v.bands.questionnaire_weight}٪ · مرز ریسک متوسط {v.bands.moderate}، زیاد {v.bands.high}، بسیار زیاد {v.bands.very_high}
        </span>
      </section>

      <section className="flex flex-col gap-2" aria-label="توضیح ریسک">
        <div className="flex items-center gap-2">
          <h3 className="ds-t-section">توضیح</h3>
          <Button size="small" icon={<Sparkles {...ICON14} />} loading={explain.isPending} onClick={() => explain.mutate(undefined)}>
            {v.ai.includes("change.riskNarrative") ? "روایت هوشمند" : "توضیح دوباره"}
          </Button>
        </div>
        <RecordMarkdown text={narrative?.text ?? v.explanation} />
      </section>
    </div>
  );
}

export default RiskTab;
