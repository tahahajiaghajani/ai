// «کارهای امروز من» (FSM-008/017/018/019/021/023, signature screen for the technician's phone): today's visits in
// route order with the leg from the previous stop, the way to the site (the organisation's map service), what to
// bring, and one big button for the next step — accept, depart (the customer hears «در راه است», without a name), arrive
// (the position goes to dispatch only), the checklist and the resolution, then the customer's signature and the
// service report. Positions are sent only when the person allows the browser to share them.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Input, Modal, Select } from "antd";
import { Map as MapIcon, Navigation, PauseCircle, PackageSearch, PlayCircle, FileText } from "lucide-react";
import { formatJalali, todayISO, toFa } from "@shared/jalali";
import { parseChecklist, checklistMissing } from "@shared/field_service/logic";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { ICON, cx } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { ChoiceTag, RecordMarkdown, recordPath, recordsApi, uploadAttachment } from "../../records";
import { FIELD_KEYS, fieldApi, type Step, type Visit } from "./api";
import { SignaturePad } from "./Signature";
import { clock, cleanAnswers, minutesText, stepsFor, taskState, type Row } from "./model";
import "./field.css";

/** The device's position, when the person allows it (never blocks a step). */
function position(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    ),
  );
}

export default function MyDay() {
  const { api, orgId, timezone } = useOrg();
  const [day, setDay] = useState<string>(todayISO(timezone));
  const q = useQuery({ queryKey: FIELD_KEYS.myDay(orgId, day), queryFn: () => fieldApi.myDay(api, day), refetchInterval: 120_000 });
  const d = q.data;
  const current = d?.visits.find((v) => ["en_route", "on_site"].includes(String(v.task.state)))?.task.id ?? d?.visits.find((v) => ["assigned", "accepted"].includes(String(v.task.state)))?.task.id;
  return (
    <div className="fs-day">
      <PageHeader title="کارهای امروز من" actions={<DateInput value={day} onChange={(v: string | null) => v && setDay(v)} aria-label="روز" />} />
      {q.isLoading ? (
        <Loader />
      ) : !d || !d.visits.length ? (
        <EmptyState title={day === todayISO(timezone) ? "امروز بازدیدی به شما سپرده نشده است" : "در این روز بازدیدی ندارید"} />
      ) : (
        <>
          <p className="text-[12px] text-ink-3">
            {toFa(d.visits.length)} بازدید به ترتیب مسیر؛ حدود {toFa(Math.round(d.total_km))} کیلومتر و {minutesText(d.total_minutes)} در راه.
          </p>
          {d.visits.map((v, i) => <VisitCard key={v.task.id} v={v} index={i} now={v.task.id === current} display={d.display} />)}
        </>
      )}
    </div>
  );
}

function VisitCard({ v, index, now, display }: { v: Visit; index: number; now: boolean; display: Record<string, string> }) {
  const { api, orgId, timezone } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const t = v.task;
  const st = taskState(t.state);
  const items = parseChecklist(t.checklist);
  const [answers, setAnswers] = useState<Record<string, unknown>>((t.checklist_answers as Record<string, unknown>) ?? {});
  const [resolution, setResolution] = useState<string>(String(t.resolution ?? ""));
  const [asking, setAsking] = useState<{ kind: "reject" | "on_hold"; text: string } | null>(null);
  const [signer, setSigner] = useState("");
  const [signature, setSignature] = useState<File | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["field_service", orgId, "my-day"] });
  const step = useAction(
    async (s: { step: Step; reason?: string }) => {
      const pos = ["depart", "arrive", "leave"].includes(s.step) ? await position() : null;
      return fieldApi.step(api, t.id, s.step, { lat: pos?.lat ?? null, lng: pos?.lng ?? null, reason: s.reason ?? null, resolution: s.step === "complete" ? resolution : null, checklist_answers: s.step === "complete" ? cleanAnswers(items, answers) : null });
    },
    { onSuccess: (_d, s) => { n.ok(DONE[s.step]); setAsking(null); refresh(); } },
  );
  const move = useAction((s: { to: string; data?: Row }) => recordsApi.transition(api, "wo_task", t.id, s.to, s.data ?? {}, Number(t.version)), { success: "وضعیت بازدید به‌روز شد", onSuccess: () => { setAsking(null); refresh(); } });
  const sign = useAction(
    async () => {
      const att = signature ? await uploadAttachment(orgId, "wo_task", t.id, signature) : null;
      return fieldApi.signoff(api, t.id, { signer_name: signer.trim(), attachment_id: att?.id ?? null });
    },
    { success: "امضای مشتری ثبت و گزارش خدمت ساخته شد", onSuccess: refresh },
  );
  const missing = checklistMissing(items, answers);
  const wo = v.work_order;
  return (
    <article className={cx("fs-visit", now && "is-now")} aria-label={`بازدید ${t.number}`}>
      {v.leg && index > 0 && v.leg.km !== null ? <div className="fs-leg"><Navigation size={12} aria-hidden /> {toFa(v.leg.km)} کیلومتر، {minutesText(v.leg.minutes)} از بازدید پیشین</div> : null}
      <header className="flex flex-wrap items-center gap-2">
        <span className="ds-num text-[12px] text-ink-3">{toFa(index + 1)}.</span>
        <Link className="ds-link font-medium" to={`/${orgId}/${recordPath("wo_task", t.id)}`}>{t.number}</Link>
        <ChoiceTag option={st ? { value: st.value, label: st.label, color: st.color } : undefined} value={String(t.state)} />
        {t.scheduled_start ? <span className="text-[12px] text-ink-3">{clock(t.scheduled_start, timezone)}–{clock(t.scheduled_end, timezone)}</span> : null}
      </header>
      <div className="text-[14px]">{t.short_description}</div>
      {wo ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {wo.site_address ? <><dt className="text-ink-3">نشانی</dt><dd>{wo.site_address}</dd></> : null}
          {wo.access_notes ? <><dt className="text-ink-3">راه دسترسی</dt><dd>{wo.access_notes}</dd></> : null}
          {wo.symptoms ? <><dt className="text-ink-3">مشکل</dt><dd className="whitespace-pre-line">{String(wo.symptoms).slice(0, 400)}</dd></> : null}
          {t.window_start ? <><dt className="text-ink-3">بازهٔ مشتری</dt><dd>{formatJalali(t.window_start)} {clock(t.window_start, timezone)}–{clock(t.window_end, timezone)}</dd></> : null}
        </dl>
      ) : null}
      {v.parts.length ? (
        <div className="text-[13px]">
          <span className="text-ink-3">قطعه‌ها: </span>
          {v.parts.map((p) => `${p.part_name} × ${toFa(p.quantity ?? 1)}`).join("، ")}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {v.nav ? <Button href={v.nav} target="_blank" rel="noreferrer" icon={<MapIcon {...ICON} />}>مسیریابی</Button> : null}
        {stepsFor(t.state).filter((b) => b.step !== "complete").map((b) => (
          <Button key={b.step} type={b.primary ? "primary" : "default"} loading={step.isPending && step.variables?.step === b.step} onClick={() => (b.reason ? setAsking({ kind: "reject", text: "" }) : step.mutate({ step: b.step }))}>
            {b.label}
          </Button>
        ))}
        {["on_hold", "pending_parts"].includes(String(t.state)) ? <Button type="primary" icon={<PlayCircle {...ICON} />} onClick={() => move.mutate({ to: "on_site" })} loading={move.isPending}>ادامهٔ کار</Button> : null}
      </div>
      {t.state === "on_site" ? (
        <section className="fs-check" aria-label="پایان کار">
          {items.length ? <h3 className="text-[13px] text-ink-2">چک‌لیست</h3> : null}
          {items.map((it) => (
            <label key={it.key} className="flex flex-col gap-1 text-[13px]">
              {it.type === "bool" ? (
                <Checkbox checked={answers[it.key] === true} onChange={(e) => setAnswers({ ...answers, [it.key]: e.target.checked })}>
                  {it.label}{it.required ? " *" : ""}
                </Checkbox>
              ) : (
                <>
                  <span>{it.label}{it.required ? " *" : ""}</span>
                  {it.type === "choice" ? (
                    <Select value={(answers[it.key] as string) ?? undefined} onChange={(x) => setAnswers({ ...answers, [it.key]: x })} options={(it.options ?? []).map((o) => ({ value: o, label: o }))} aria-label={it.label} />
                  ) : it.type === "number" ? (
                    <Input inputMode="decimal" className="ltr" value={String(answers[it.key] ?? "")} onChange={(e) => setAnswers({ ...answers, [it.key]: e.target.value })} aria-label={it.label} />
                  ) : (
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} value={String(answers[it.key] ?? "")} onChange={(e) => setAnswers({ ...answers, [it.key]: e.target.value })} aria-label={it.label} />
                  )}
                </>
              )}
            </label>
          ))}
          <label className="flex flex-col gap-1 text-[13px]">
            <span>شرح کار انجام‌شده *</span>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={20_000} />
          </label>
          {missing.length ? <p className="text-[12px] text-warning">مانده از چک‌لیست: {missing.map((m) => m.label).join("، ")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="primary" onClick={() => step.mutate({ step: "complete" })} loading={step.isPending && step.variables?.step === "complete"} disabled={!!missing.length || !resolution.trim()}>کار انجام شد</Button>
            <Button icon={<PackageSearch {...ICON} />} onClick={() => move.mutate({ to: "pending_parts" })} loading={move.isPending}>منتظر قطعه</Button>
            <Button icon={<PauseCircle {...ICON} />} onClick={() => setAsking({ kind: "on_hold", text: "" })}>توقف کار</Button>
          </div>
        </section>
      ) : null}
      {t.state === "work_complete" && !t.signed_at ? (
        <section className="fs-check" aria-label="امضای مشتری">
          <h3 className="text-[13px] text-ink-2">تأیید و امضای مشتری</h3>
          <Input placeholder="نام و نام خانوادگی امضاکننده" value={signer} onChange={(e) => setSigner(e.target.value)} maxLength={120} aria-label="نام امضاکننده" />
          <SignaturePad onChange={setSignature} />
          <Button type="primary" onClick={() => sign.mutate(undefined)} loading={sign.isPending} disabled={signer.trim().length < 3}>ثبت امضا و گزارش خدمت</Button>
        </section>
      ) : null}
      {t.service_report ? (
        <details className="text-[13px]">
          <summary className="flex cursor-pointer items-center gap-1 text-ink-2"><FileText {...ICON} /> گزارش خدمت{t.signer_name ? ` — امضای ${t.signer_name}` : ""}</summary>
          <RecordMarkdown text={String(t.service_report)} display={display} />
        </details>
      ) : null}
      <Modal
        open={!!asking}
        title={asking?.kind === "reject" ? "چرا نمی‌توانید بروید؟" : "چرا کار متوقف می‌شود؟"}
        okText="ثبت"
        cancelText="انصراف"
        onCancel={() => setAsking(null)}
        onOk={() => {
          if (!asking) return;
          if (asking.kind === "reject") step.mutate({ step: "reject", reason: asking.text.trim() });
          else move.mutate({ to: "on_hold", data: { hold_reason: asking.text.trim() } });
        }}
        okButtonProps={{ disabled: (asking?.text.trim().length ?? 0) < 3, loading: step.isPending || move.isPending }}
        destroyOnHidden
      >
        <Input.TextArea autoFocus autoSize={{ minRows: 2, maxRows: 5 }} value={asking?.text ?? ""} onChange={(e) => asking && setAsking({ ...asking, text: e.target.value })} maxLength={2000} aria-label="دلیل" />
      </Modal>
    </article>
  );
}

const DONE: Record<Step, string> = {
  accept: "بازدید را پذیرفتید",
  reject: "بازدید به صف توزیع برگشت",
  depart: "حرکت ثبت شد؛ مشتری باخبر شد",
  arrive: "رسیدن به محل ثبت شد",
  complete: "پایان کار ثبت شد",
  leave: "ترک محل ثبت شد",
};
