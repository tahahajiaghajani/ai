// What may be done to a whole case (design F §5, §3.6.6; package F7), each a dialog of the case page:
//   · «دوباره پیدا کردن انجام‌دهنده» (managers, 1.1.5): a step that found nobody (or more people than it takes) runs its
//     rules again with today's holders — this version's rules, or the ones the process's current version has for the
//     same step —; the dialog then says what came of it (the people found, or why nobody);
//   · «ارجاع مرحله» (managers): an open step's task moves to other people, or a step that found nobody gets people; the
//     step's exclusions hold (the server names them). A step that found more people than it takes offers them to choose
//     from (the server's candidates); the demo pack's people are not offered on the organisation's own cases (FINAL-1)
//     and are marked «نمایشی» on the pack's;
//   · «توقف موقت» / «ادامهٔ پرونده» (managers), with an optional note;
//   · «ادامه از مرحلهٔ …» (managers, a case in «نیاز به بررسی»): a step outside parallel blocks;
//   · «لغو پرونده»: a manager's, or the requester's before any step after the start (that one is a submission: on a
//     linked Windows app it waits to be sent, and when the case ended first it comes back «late» and says so).
// A dialog starts afresh when it opens; the case refreshing live while it is open keeps what the manager entered, but
// a step, task or resume point the case no longer has gives way to its first open one (the lists show only those).
import { useMemo, useState } from "react";
import { Button, Input, Modal, Radio, Select } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import type { ReresolveResult } from "@shared/process/waiting";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../lib/org";
import { useNotify } from "../../../lib/hooks";
import { Note } from "../../../components/blocks";
import { DemoTag, MemberSelect } from "../kit";
import { USER_KEYS, userApi, type CaseDetail } from "./api";
import {
  candidatesOf, cancelMessage, demoPick, managerForm, nameOf, openSteps, reresolveForm, reresolveMessage, stalledSteps, waitingLine, type ManagerForm, type ReresolveForm,
} from "./model";

export type ManagerAction = "reassign" | "pause" | "resume" | "cancel" | "resume_from" | "reresolve";

const TITLES: Record<ManagerAction, string> = {
  reassign: "ارجاع مرحله",
  pause: "توقف موقت پرونده",
  resume: "ادامهٔ پرونده",
  cancel: "لغو پرونده",
  resume_from: "ادامه از مرحلهٔ …",
  reresolve: "دوباره پیدا کردن انجام‌دهنده",
};

/** «دوباره پیدا کردن انجام‌دهنده»: which waiting step, whose rules; then what came of it. */
function ReresolveDialog({ detail, onClose }: { detail: CaseDetail; onClose: () => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [kept, setForm] = useState<ReresolveForm>(() => reresolveForm(null, detail));
  const form = reresolveForm(kept, detail);
  if (form !== kept) setForm(form);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ r: ReresolveResult; label: string } | null>(null);
  const steps = stalledSteps(detail);
  const waiting = form.step ? waitingLine(detail.waiting?.[form.step], true) : null;
  const run = async () => {
    if (!form.step) return;
    setBusy(true);
    try {
      const label = steps.find((s) => s.key === form.step)?.label ?? "";
      const r = await userApi.reresolve(api, detail.case.id, { step: form.step, rules: form.rules });
      setDone({ r, label });
      await qc.invalidateQueries({ queryKey: USER_KEYS.all(orgId) });
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const said = done ? reresolveMessage(done.r, done.label) : null;
  return (
    <Modal
      open
      title={TITLES.reresolve}
      okText={done ? "بستن" : "پیدا کردن"}
      cancelText="انصراف"
      cancelButtonProps={done ? { style: { display: "none" } } : undefined}
      okButtonProps={{ loading: busy, disabled: !done && !form.step }}
      onCancel={onClose}
      onOk={done ? onClose : run}
      destroyOnHidden
    >
      {done && said ? (
        <div className="wfu-result" aria-live="polite">
          <Note tone={said.tone === "ok" ? "neutral" : "warning"}>{said.text}</Note>
          {done.r.status === "ok" && done.r.people.length ? (
            <ul aria-label="کسانی که پیدا شدند">
              {done.r.people.map((p) => (
                <li key={p.id}>
                  {p.name}
                  {p.demo ? <DemoTag /> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {done.r.status !== "ok" && done.r.notes.length ? (
            <ul aria-label="چرا">
              {done.r.notes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="wfu-ask">
          {steps.length > 1 ? (
            <label className="wfu-comment">
              <span>مرحله</span>
              <Select value={form.step ?? undefined} onChange={(v) => setForm({ ...form, step: v })} options={steps.map((s) => ({ value: s.key, label: s.label }))} aria-label="مرحله" />
            </label>
          ) : null}
          {waiting ? (
            <Note>
              {waiting.text}
              {waiting.notes.length ? (
                <ul className="wfu-why">
                  {waiting.notes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : null}
            </Note>
          ) : null}
          <fieldset className="wfu-ask-targets">
            <legend>با کدام قاعده</legend>
            <Radio.Group value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value as ReresolveForm["rules"] })}>
              <Radio value="case">{detail.case.version_no ? `قاعدهٔ همین پرونده (نسخهٔ ${faDigits(detail.case.version_no)})` : "قاعدهٔ همین پرونده"}</Radio>
              <Radio value="current">قاعدهٔ نسخهٔ جاری گردش‌کار</Radio>
            </Radio.Group>
          </fieldset>
        </div>
      )}
    </Modal>
  );
}

export function ManagerDialogs({ action, detail, onClose, me }: { action: ManagerAction | null; detail: CaseDetail; onClose: () => void; me: string | null }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const steps = useMemo(() => openSteps(detail), [detail]);
  // opening a dialog starts it afresh; the case read again while it is open (the live refresh) keeps the input that
  // still holds, and a pick the case no longer has moves to the first valid one (set once: the next render keeps it)
  const [kept, setForm] = useState<ManagerForm>(() => managerForm(null, action, detail));
  const form = managerForm(kept, action, detail);
  if (form !== kept) setForm(form);
  const set = (patch: Partial<ManagerForm>) => setForm((f) => ({ ...f, ...patch }));
  const { comment, step, task, to, node } = form;
  const [busy, setBusy] = useState(false);
  // «ارجاع مرحله» of a step with too many people: their list first, every member on request (afresh per dialog)
  const [fromAll, setFromAll] = useState(false);
  const [seen, setSeen] = useState(action);
  if (seen !== action) {
    setSeen(action);
    setFromAll(false);
  }
  if (!action) return null;
  if (action === "reresolve") return <ReresolveDialog detail={detail} onClose={onClose} />;
  const c = detail.case;
  const id = c.id;
  const names = detail.display;
  const holders = detail.history.tasks.filter((t) => t.status === "open" && t.step_key === step);
  const candidates = candidatesOf(detail, step);
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
              <Select value={step ?? undefined} onChange={(v) => set({ step: v, task: null })} options={steps.map((s) => ({ value: s.key, label: s.label }))} aria-label="مرحله" />
            </label>
            {holders.length ? (
              <fieldset className="wfu-ask-targets">
                <legend>کار چه کسی سپرده شود؟</legend>
                <Radio.Group value={task} onChange={(e) => set({ task: e.target.value as string | null })}>
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
            {candidates.length && !fromAll ? (
              <>
                <label className="wfu-comment">
                  <span>{`از میان ${faDigits(candidates.length)} نفری که پیدا شدند`}</span>
                  <Select
                    mode="multiple"
                    value={to}
                    onChange={(v: string[]) => set({ to: v })}
                    showSearch={{ optionFilterProp: "label" }}
                    placeholder="کسانی را برگزینید"
                    aria-label="از میان پیداشده‌ها"
                    options={candidates.map((c) => ({ value: c.id.toLowerCase(), label: c.name, demo: c.demo }))}
                    optionRender={(o) => (
                      <span>
                        {o.label}
                        {(o.data as { demo?: boolean }).demo ? <DemoTag /> : null}
                      </span>
                    )}
                  />
                </label>
                <Button type="link" size="small" className="self-start" onClick={() => setFromAll(true)}>
                  از همهٔ اعضا
                </Button>
              </>
            ) : (
              <label className="wfu-comment">
                <span>به چه کسی</span>
                <MemberSelect value={to} onChange={(v) => set({ to: Array.isArray(v) ? v : v ? [v] : [] })} multiple placeholder="عضوی را برگزینید" demo={demoPick(detail)} display={names} aria-label="به چه کسی" />
              </label>
            )}
          </>
        ) : null}
        {action === "resume_from" ? (
          <fieldset className="wfu-ask-targets">
            <legend>از کدام مرحله ادامه یابد؟</legend>
            <Radio.Group value={node} onChange={(e) => set({ node: e.target.value as string })}>
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
          <Input.TextArea value={comment} onChange={(e) => set({ comment: e.target.value })} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={1000} />
        </label>
        {me && action === "reassign" && to.includes(me) ? <p className="rk-hint">خودتان را هم برگزیده‌اید.</p> : null}
      </div>
    </Modal>
  );
}
