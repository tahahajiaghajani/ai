// A survey as the respondent answers it (PTL-038, PTL-039) — in the portal and on the sign-in-free page of a signed
// link: the introduction, one block per question (a scale of buttons with its two ends, faces, yes/no, a choice, several
// choices, minutes, free text), checked here as the server checks it (`checkSurveyAnswers`), then the thanks. A survey
// already answered, expired or withdrawn says so instead.
import { useState, type ReactNode } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Radio } from "antd";
import { Angry, Frown, Laugh, Meh, Smile, CheckCircle2, Send } from "lucide-react";
import { checkSurveyAnswers, type SurveyQuestion } from "@shared/portal/logic";
import { ApiError, errorText } from "../../lib/api";
import type { SurveyView } from "./api";
import { scaleEnds, scaleOf } from "./model";
import { I16 } from "./parts";

const FACES = [Angry, Frown, Meh, Smile, Laugh];

function Question({ q, value, onChange, error }: { q: SurveyQuestion; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const id = `pt-q-${q.id}`;
  const scale = scaleOf(q.kind);
  const ends = scaleEnds(q.kind);
  let control;
  if (q.kind === "faces")
    control = (
      <div className="pt-scale" role="radiogroup" aria-labelledby={id}>
        {scale.map((s, i) => {
          const Icon = FACES[i] ?? Meh;
          return (
            <button key={s.value} type="button" role="radio" aria-checked={value === s.value} aria-pressed={value === s.value} aria-label={s.label} title={s.label} onClick={() => onChange(s.value)} className="flex flex-col items-center gap-1 py-2">
              <Icon size={24} strokeWidth={1.5} absoluteStrokeWidth aria-hidden />
              <span className="text-[11.5px]">{s.label}</span>
            </button>
          );
        })}
      </div>
    );
  else if (scale.length)
    control = (
      <div className="flex flex-col gap-1">
        <div className="pt-scale" role="radiogroup" aria-labelledby={id}>
          {scale.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={value === s.value} aria-pressed={value === s.value} onClick={() => onChange(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        {ends ? (
          <div className="pt-scale-ends" aria-hidden>
            <span>{ends[0]}</span>
            <span>{ends[1]}</span>
          </div>
        ) : null}
      </div>
    );
  else if (q.kind === "yes_no")
    control = (
      <div className="pt-scale" role="radiogroup" aria-labelledby={id}>
        {[
          [true, "بله"],
          [false, "خیر"],
        ].map(([v, label]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(v)}>
            {label as string}
          </button>
        ))}
      </div>
    );
  else if (q.kind === "choice")
    control = (
      <Radio.Group value={value ?? null} onChange={(e) => onChange(e.target.value)} aria-labelledby={id} className="flex flex-col gap-2">
        {q.options.map((o) => (
          <Radio key={o} value={o}>
            {o}
          </Radio>
        ))}
      </Radio.Group>
    );
  else if (q.kind === "multi")
    control = <Checkbox.Group value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => onChange(v)} options={q.options.map((o) => ({ value: o, label: o }))} className="flex flex-col gap-2" aria-labelledby={id} />;
  else if (q.kind === "minutes")
    control = <InputNumber min={0} max={100_000} value={typeof value === "number" ? value : null} onChange={(v) => onChange(v ?? null)} suffix="دقیقه" aria-labelledby={id} style={{ inlineSize: 180 }} />;
  else control = <Input.TextArea value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} maxLength={4000} aria-labelledby={id} />;
  return (
    <div className="pt-q">
      <span className="pt-q-t" id={id}>
        {q.label}
        {q.required ? <span className="text-danger" aria-hidden> *</span> : null}
      </span>
      {q.help ? <span className="text-[12.5px] text-ink-3">{q.help}</span> : null}
      {control}
      {error ? (
        <span className="text-[12.5px] text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function SurveyForm({ view, onSubmit, record }: { view: SurveyView; onSubmit: (answers: Record<string, unknown>) => Promise<{ thanks: string }>; record?: ReactNode }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);
  const status = view.invitation.status;

  if (thanks || status === "answered")
    return (
      <div className="pt-card pt-thanks" role="status">
        <CheckCircle2 size={36} strokeWidth={1.5} absoluteStrokeWidth className="text-in" aria-hidden />
        <h2 className="mb-1 mt-3 text-[18px] font-medium">{thanks ?? "پاسخ شما پیش‌تر ثبت شده است"}</h2>
        <p className="m-0 text-ink-3">{thanks ? "پاسخ شما ثبت شد." : "سپاس از وقتی که گذاشتید."}</p>
      </div>
    );
  if (status === "expired" || status === "canceled")
    return <Alert type="info" showIcon title={status === "expired" ? "مهلت این نظرسنجی تمام شده است" : "این نظرسنجی دیگر پاسخ نمی‌گیرد"} />;

  const submit = async () => {
    const r = checkSurveyAnswers(view.questions, answers);
    setErrors(r.problems);
    if (Object.keys(r.problems).length) {
      setProblem("به پرسش‌های نشان‌دار پاسخ دهید");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await onSubmit(r.clean);
      setThanks(res.thanks || view.survey.thanks || "سپاس از پاسخ شما");
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "fields" in (e.details as object)) setErrors((e.details as { fields: Record<string, string> }).fields);
      if (e instanceof ApiError && e.status === 409) setThanks("پاسخ شما پیش‌تر ثبت شده است");
      else setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-card flex flex-col">
      {view.survey.intro ? <p className="mt-0 text-ink-2">{view.survey.intro}</p> : null}
      {record}
      {view.survey.anonymous ? <Alert className="my-2" type="info" title="پاسخ‌های این نظرسنجی بی‌نام نگه داشته می‌شود." /> : null}
      {view.questions.map((q) => (
        <Question key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
      ))}
      {problem ? <Alert className="mb-3" type="error" title={problem} /> : null}
      <div>
        <Button type="primary" size="large" icon={<Send {...I16} />} loading={busy} onClick={submit}>
          ثبت پاسخ
        </Button>
      </div>
    </div>
  );
}
