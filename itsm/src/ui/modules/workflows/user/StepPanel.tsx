// The step form (design F §5 «The step form», §8.6; package F7) at `workflows/c/:id/s/:task`: in the inspector beside
// the case's diagram on a wide screen, a full page on a phone. Top to bottom: the step's name, «به جانشینی از …» (for the
// person who delegated it «سپرده به …»), the due pill; a folded «آنچه پیش‌تر ثبت شده»; the form with my rights (my
// refused values, else my draft, over the case's values; the case's files by name, each opening its file); a comment
// box; a sticky action bar with the step's decisions —
//   fill «ارسال برای "…"» and «ذخیرهٔ پیش‌نویس»; review «ادامهٔ گردش‌کار» and «بازگشت برای اصلاح»; approve «تأیید»، «رد» and
//   «بازگشت برای اصلاح».
// «رد» and «بازگشت» ask for a reason, «بازگشت» picks its target (the default chosen) and the confirmation names the
// consequence («پرونده برای "ثبت درخواست" به سمیرا رضایی بازمی‌گردد»). On a pool step, online, «برداشتن کار» comes first
// and the others see «در دست …». On a linked Windows app «ارسال» records the submission and the step shows «در صف ارسال»
// until it is applied; a late or refused result shows its message and keeps the values.
import { useEffect, useMemo, useState } from "react";
import { Button, Collapse, Input, Modal, Radio } from "antd";
import { Hand, Save, Undo2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formStepOf, quorumOf } from "@shared/process";
import { cleanFormLayout, type Right } from "@shared/forms/layout";
import { faDigits } from "@shared/format";
import { ApiError } from "../../../lib/api";
import { useOrg } from "../../../lib/org";
import { useNotify } from "../../../lib/hooks";
import { cx, Note } from "../../../components/blocks";
import { Chip } from "../../../components/display";
import { useMe, useSchema } from "../../../records/data/hooks";
import { useLeaveGuard } from "../admin/forms/parts";
import { USER_KEYS, userApi, type CaseDetail, type CaseFile, type MyStep } from "./api";
import {
  actionLabel, consequence, defaultReturn, delegationNote, draftValues, fieldProblems, initialValues, missingRequired, nameOf, packShown, resultMessage, stepActions, takesValues,
  type StepActionDef,
} from "./model";
import { CaseValues, DuePill, ProcessForm, useLocalFiles, useMoneyUnit } from "./parts";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
/** Steps that wait for several decisions are not taken by one person (F4c). */
const MANY = new Set(["all", "count", "percent"]);

export interface StepPanelProps {
  detail: CaseDetail;
  step: MyStep;
  /** the case's files I may open (a «پیوست» value names them by id) */
  files?: readonly CaseFile[];
  /** the case's files are still loading */
  filesLoading?: boolean;
  /** this runtime advances cases (claim is online only; a linked Windows app queues the submission) */
  authority: boolean;
  /** the step was sent or closed: back to the case */
  onDone: () => void;
  className?: string;
}

export function StepPanel({ detail, step, files, filesLoading, authority, onDone, className }: StepPanelProps) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const { schema } = useSchema();
  const { userId, tz } = useMe();
  const unit = useMoneyUnit();
  const local = useLocalFiles();
  const display = detail.display;
  const form = step.form && detail.forms ? detail.forms.forms[step.form] : null;
  const fields = useMemo(() => detail.forms?.fields ?? {}, [detail.forms]);
  const layout = useMemo(() => cleanFormLayout(form?.layout ?? { tabs: [] }), [form]);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(step, detail.data));
  const [comment, setComment] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<StepActionDef | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(defaultReturn(step));
  const [late, setLate] = useState<string | null>(null);
  useEffect(() => {
    setValues(initialValues(step, detail.data));
    setProblems({});
    setLate(null);
    // a new step (or its refusal) starts the form afresh; the case's other changes keep what is typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, step.refused?.id]);
  useLeaveGuard(dirty && !late && busy !== "send");

  const node = detail.graph.nodes.find((x) => x.id === step.step_key);
  const quorum = node ? quorumOf(formStepOf(node.config)) : "any";
  const pool = detail.history.tasks.filter((t) => t.step_key === step.step_key && t.round === step.round && t.status === "open").length > 1 && !(step.action === "approve" && MANY.has(quorum));
  const takenByOther = !!step.claimed_by && step.claimed_by !== userId;
  const paused = !!detail.case.paused_at;
  const blocked = step.queued || paused || !!late || (takenByOther && authority);
  const actions = stepActions(step);
  const editable = Object.values(step.rights).some((r: Right) => r === "edit" || r === "required");
  const before = (key: string) => !(key in step.rights) || step.rights[key] === "hidden";

  const change = (name: string, value: unknown) => {
    setValues((x) => ({ ...x, [name]: value }));
    setDirty(true);
    if (problems[name]) setProblems(({ [name]: _gone, ...rest }) => rest);
  };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: USER_KEYS.all(orgId) })]);

  const claim = async (release: boolean) => {
    setBusy("claim");
    try {
      if (release) await userApi.release(api, step.id);
      else await userApi.claim(api, step.id);
      await refresh();
      n.ok(release ? "کار را برگرداندید؛ دیگران هم می‌توانند آن را بردارند." : "کار را برداشتید؛ دیگران این مرحله را در دست شما می‌بینند.");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    setBusy("draft");
    try {
      await userApi.saveDraft(api, { task_id: step.id }, draftValues(values, step.rights, fields));
      setDirty(false);
      n.ok(local.files.size ? "پیش‌نویس ذخیره شد؛ پیوست‌ها را هنگام ارسال دوباره بیفزایید." : "پیش‌نویس ذخیره شد.");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };

  const send = async (a: StepActionDef, note: string, target: string | null) => {
    if (takesValues(a.outcome)) {
      const missing = missingRequired(layout, step.rights, values, fields);
      if (Object.keys(missing).length) {
        setProblems(missing);
        n.warn("چند فیلد الزامی پر نشده است.");
        return;
      }
    }
    setBusy("send");
    try {
      const packed = takesValues(a.outcome) ? packShown(layout, step.rights, values, fields, local.files) : { values: {}, files: [] };
      const r = await userApi.submit(api, orgId, step.id, { outcome: a.outcome, comment: note.trim() || null, values: packed.values, return_to: a.outcome === "returned" ? target : null }, packed.files);
      const msg = resultMessage(r, a.outcome, step, target, display);
      setAsking(null);
      if (r.result === "late") {
        // nothing changed in the case: the values stay on the screen with the message
        setLate(msg.text);
        n.warn(msg.text);
        return;
      }
      setDirty(false);
      await userApi.dropDraft(api, { task_id: step.id });
      await refresh();
      if (msg.tone === "info") n.info(msg.text);
      else n.ok(msg.text);
      if (r.result === "applied") onDone();
    } catch (e) {
      const fp = e instanceof ApiError && e.status === 400 ? fieldProblems(e.details) : {};
      if (Object.keys(fp).length) {
        setAsking(null);
        setProblems(fp);
        n.warn("چند مقدار پذیرفته نشد؛ پیام هر فیلد را ببینید.");
      } else n.error(e);
    } finally {
      setBusy(null);
    }
  };

  const decide = (a: StepActionDef) => {
    if (a.needsComment) {
      setReturnTo(defaultReturn(step));
      setAsking(a);
      return;
    }
    void send(a, comment, null);
  };

  const earlier = Object.keys(detail.data).some(before);
  const delegation = delegationNote(step, detail.history.tasks, userId, display);
  return (
    <section className={cx("wfu-stepform", className)} aria-label={`مرحلهٔ «${step.label}»`}>
      <header className="wfu-stepform-h">
        <h2 className="wfu-h2">{step.label}</h2>
        <div className="wfu-panel-m">
          <Chip tone="accent" dot={false}>
            {actionLabel(step.action)}
          </Chip>
          {step.round > 1 ? <Chip tone="neutral">{`دور ${faDigits(step.round)}`}</Chip> : null}
          {delegation ? <span>{delegation}</span> : null}
          <DuePill due={step.due_at} prefix="مهلت" />
        </div>
      </header>
      {late ? <Note tone="warning">{late}</Note> : null}
      {step.queued ? <Note>در صف ارسال؛ با برقراری اتصال فرستاده می‌شود.</Note> : null}
      {step.refused && !step.queued ? (
        <Note tone="danger">{`ثبت پیشین شما پذیرفته نشد${step.refused.note ? `: ${step.refused.note}` : ""}. آنچه نوشته بودید در فرم آمده است.`}</Note>
      ) : null}
      {paused ? <Note tone="warning">پرونده موقتاً متوقف است؛ تا مسئولان آن را ادامه ندهند، مرحله انجام نمی‌شود.</Note> : null}
      {takenByOther ? <Note>{`این مرحله در دست ${nameOf(display, step.claimed_by)} است.${authority ? "" : " بدون اتصال هم می‌توانید آن را بفرستید؛ نخستین ثبت می‌ماند."}`}</Note> : null}
      {earlier && schema ? (
        <Collapse
          className="wfu-earlier"
          size="small"
          items={[{ key: "before", label: "آنچه پیش‌تر ثبت شده", children: <CaseValues forms={detail.forms} data={detail.data} schema={schema} tz={tz} unit={unit} only={before} display={display} files={files} /> }]}
        />
      ) : null}
      {schema ? (
        form ? (
          <ProcessForm
            layout={layout}
            fields={fields}
            rights={step.rights}
            values={values}
            onChange={blocked || !editable ? undefined : change}
            problems={problems}
            schema={schema}
            tz={tz}
            unit={unit}
            local={local}
            known={files}
            knownLoading={filesLoading}
            idPrefix={`wfu-s-${step.id.slice(0, 8)}`}
            label={form.name}
            display={display}
          />
        ) : (
          <p className="rk-hint">این مرحله فرمی ندارد.</p>
        )
      ) : null}
      <label className="wfu-comment">
        <span>توضیح</span>
        <Input.TextArea value={comment} onChange={(e) => setComment(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} disabled={blocked} placeholder="برای «رد» و «بازگشت» دلیل را بنویسید" />
      </label>
      <div className="wfu-actionbar" role="group" aria-label="تصمیم‌های مرحله">
        {pool && authority && !step.queued ? (
          step.claimed_by === userId ? (
            <Button icon={<Undo2 {...I16} />} loading={busy === "claim"} disabled={!!busy} onClick={() => claim(true)}>
              برگرداندن کار
            </Button>
          ) : !takenByOther ? (
            <Button icon={<Hand {...I16} />} loading={busy === "claim"} disabled={!!busy || paused} onClick={() => claim(false)}>
              برداشتن کار
            </Button>
          ) : null
        ) : null}
        {actions.map((a) => (
          <Button key={a.outcome} type={a.primary ? "primary" : "default"} danger={a.danger} loading={busy === "send" && !asking && a.primary} disabled={blocked || !!busy} onClick={() => decide(a)}>
            {a.label}
          </Button>
        ))}
        {step.action === "fill" && editable ? (
          <Button icon={<Save {...I16} />} loading={busy === "draft"} disabled={blocked || !!busy} onClick={saveDraft}>
            ذخیرهٔ پیش‌نویس
          </Button>
        ) : null}
        {late ? <Button onClick={onDone}>بستن</Button> : null}
      </div>
      <Modal
        open={!!asking}
        title={asking ? `${asking.label}: «${step.label}»` : ""}
        okText={asking?.label}
        okButtonProps={{ danger: asking?.danger, loading: busy === "send", disabled: !comment.trim() }}
        cancelText="انصراف"
        onCancel={() => setAsking(null)}
        onOk={() => asking && send(asking, comment, returnTo)}
        destroyOnHidden
      >
        {asking ? (
          <div className="wfu-ask">
            {asking.outcome === "returned" && step.return_targets.length > 1 ? (
              <fieldset className="wfu-ask-targets">
                <legend>بازگشت به کدام مرحله؟</legend>
                <Radio.Group value={returnTo} onChange={(e) => setReturnTo(e.target.value as string)}>
                  {step.return_targets.map((t) => (
                    <Radio key={t.key} value={t.key}>
                      {t.label}
                    </Radio>
                  ))}
                </Radio.Group>
              </fieldset>
            ) : null}
            <Note>{consequence(step, asking.outcome, returnTo, display)}</Note>
            <label className="wfu-comment">
              <span>دلیل (الزامی)</span>
              <Input.TextArea value={comment} onChange={(e) => setComment(e.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} maxLength={2000} autoFocus aria-required />
            </label>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
