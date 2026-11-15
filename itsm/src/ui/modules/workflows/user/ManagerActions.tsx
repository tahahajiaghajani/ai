// What may be done to a whole case (design F §5, §3.6.6; package F7), each a dialog of the case page:
//   · «ارجاع مرحله» (managers): an open step's task moves to other people, or a step that found nobody gets people; the
//     step's exclusions hold (the server names them);
//   · «توقف موقت» / «ادامهٔ پرونده» (managers), with an optional note;
//   · «ادامه از مرحلهٔ …» (managers, a case in «نیاز به بررسی»): a step outside parallel blocks;
//   · «لغو پرونده»: a manager's, or the requester's before any step after the start (that one is a submission: on a
//     linked Windows app it waits to be sent, and when the case ended first it comes back «late» and says so).
import { useEffect, useMemo, useState } from "react";
import { Input, Modal, Radio, Select } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../../lib/org";
import { useNotify } from "../../../lib/hooks";
import { Note } from "../../../components/blocks";
import { UserSelect } from "../../../records/fields/RecordSelect";
import { USER_KEYS, userApi, type CaseDetail } from "./api";
import { cancelMessage, nameOf, openSteps } from "./model";

export type ManagerAction = "reassign" | "pause" | "resume" | "cancel" | "resume_from";

const TITLES: Record<ManagerAction, string> = {
  reassign: "ارجاع مرحله",
  pause: "توقف موقت پرونده",
  resume: "ادامهٔ پرونده",
  cancel: "لغو پرونده",
  resume_from: "ادامه از مرحلهٔ …",
};

export function ManagerDialogs({ action, detail, onClose, me }: { action: ManagerAction | null; detail: CaseDetail; onClose: () => void; me: string | null }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const steps = useMemo(() => openSteps(detail), [detail]);
  const [comment, setComment] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [node, setNode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!action) return;
    setComment("");
    setStep(steps[0]?.key ?? null);
    setTask(null);
    setTo([]);
    setNode(detail.restart_targets[0]?.key ?? null);
  }, [action, steps, detail.restart_targets]);
  if (!action) return null;
  const c = detail.case;
  const id = c.id;
  const names = detail.display;
  const holders = detail.history.tasks.filter((t) => t.status === "open" && t.step_key === step);
  const requesterCancel = action === "cancel" && !detail.can.manage;
  const ready = action === "reassign" ? !!step && to.length > 0 : action === "resume_from" ? !!node : true;

  const run = async () => {
    setBusy(true);
    try {
      let msg: ReturnType<typeof cancelMessage>;
      if (action === "reassign") {
        await userApi.reassign(api, id, { step: step!, task, to, comment: comment.trim() || null });
        msg = { tone: "ok", text: `«${steps.find((s) => s.key === step)?.label ?? ""}» سپرده شد.` };
      } else if (action === "pause") {
        await userApi.pause(api, id, comment);
        msg = { tone: "ok", text: "پرونده موقتاً متوقف شد." };
      } else if (action === "resume") {
        await userApi.resume(api, id, comment);
        msg = { tone: "ok", text: "پرونده ادامه یافت." };
      } else if (action === "resume_from") {
        await userApi.resumeFrom(api, id, node!, comment);
        msg = { tone: "ok", text: `پرونده از «${detail.restart_targets.find((t) => t.key === node)?.label ?? ""}» ادامه یافت.` };
      } else {
        // a requester's cancel is a submission: «late» when the case ended first (nothing was cancelled)
        msg = cancelMessage(await userApi.cancel(api, id, comment));
      }
      await qc.invalidateQueries({ queryKey: USER_KEYS.all(orgId) });
      if (msg.tone === "ok") n.ok(msg.text);
      else if (msg.tone === "info") n.info(msg.text);
      else n.warn(msg.text);
      onClose();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={TITLES[action]}
      okText={action === "cancel" ? "لغو پرونده" : TITLES[action].replace(" …", "")}
      cancelText="انصراف"
      okButtonProps={{ danger: action === "cancel", loading: busy, disabled: !ready }}
      onCancel={onClose}
      onOk={run}
      destroyOnHidden
    >
      <div className="wfu-ask">
        {action === "reassign" ? (
          <>
            <label className="wfu-comment">
              <span>مرحله</span>
              <Select value={step ?? undefined} onChange={(v) => { setStep(v); setTask(null); }} options={steps.map((s) => ({ value: s.key, label: s.label }))} aria-label="مرحله" />
            </label>
            {holders.length ? (
              <fieldset className="wfu-ask-targets">
                <legend>کار چه کسی سپرده شود؟</legend>
                <Radio.Group value={task} onChange={(e) => setTask(e.target.value as string | null)}>
                  <Radio value={null}>افزودن کسی به این مرحله</Radio>
                  {holders.map((t) => (
                    <Radio key={t.id} value={t.id}>
                      {nameOf(names, t.assigned_to)}
                    </Radio>
                  ))}
                </Radio.Group>
              </fieldset>
            ) : (
              <Note>این مرحله کسی را ندارد؛ کسانی را که برمی‌گزینید به آن افزوده می‌شوند.</Note>
            )}
            <label className="wfu-comment">
              <span>به چه کسی</span>
              <UserSelect value={to} onChange={(v) => setTo(Array.isArray(v) ? v : v ? [v] : [])} multiple placeholder="عضوی را برگزینید" />
            </label>
          </>
        ) : null}
        {action === "resume_from" ? (
          <fieldset className="wfu-ask-targets">
            <legend>از کدام مرحله ادامه یابد؟</legend>
            <Radio.Group value={node} onChange={(e) => setNode(e.target.value as string)}>
              {detail.restart_targets.map((t) => (
                <Radio key={t.key} value={t.key}>
                  {t.label}
                </Radio>
              ))}
            </Radio.Group>
          </fieldset>
        ) : null}
        {action === "cancel" ? (
          <Note tone="warning">{requesterCancel ? "پرونده‌ای که خودتان آغاز کرده‌اید لغو می‌شود؛ این کار برگشت ندارد." : `پروندهٔ ${c.number ?? ""} لغو می‌شود و مرحله‌های باز آن بسته می‌شوند.`}</Note>
        ) : null}
        {action === "pause" ? <Note>تا ادامهٔ پرونده کسی مرحله‌ای را انجام نمی‌دهد و مهلت‌ها نمی‌گذرند.</Note> : null}
        <label className="wfu-comment">
          <span>توضیح</span>
          <Input.TextArea value={comment} onChange={(e) => setComment(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={1000} />
        </label>
        {me && action === "reassign" && to.includes(me) ? <p className="rk-hint">خودتان را هم برگزیده‌اید.</p> : null}
      </div>
    </Modal>
  );
}
