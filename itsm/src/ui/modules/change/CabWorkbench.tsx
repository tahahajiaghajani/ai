// «میز کار CAB» (CHG-036–039): the meeting in progress (else the next, else the latest), its agenda of changes waiting
// for authorization (highest risk first) with what the board needs to decide — risk, schedule, conflicts, blackout
// and late flags, the votes so far — and one-click decisions: «موافقم» / «مخالفم» are the member's own approval in the
// approvals service (separation of duties and delegation apply), the chair records «به جلسهٔ بعد» / «اطلاعات بیشتر»
// / «مرور شد». The pack of the meeting, attendance, and minutes drafted from the decisions (sent to the people of the
// meeting when it ends). Members may also vote outside meetings in «تأییدهای من» (asynchronous CAB, CHG-038).
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Select, Space, Tooltip } from "antd";
import { Check, X, Clock, HelpCircle, Eye, RefreshCw, FileText, ScrollText, CalendarPlus } from "lucide-react";
import { AGENDA_DECISIONS, AGENDA_KINDS } from "@shared/tables/change";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { RecordMarkdown, UserChip, recordPath, recordsApi } from "../../records";
import { CHANGE_KEYS, changeApi, useChangeRefresh } from "./api";
import { changeTone, decisionsFor, flags, riskChip, riskLabel, voteText, type Row, type Votes } from "./model";
import { FormRecords } from "./parts";
import "./change.css";

const decisionLabel = (v: unknown) => AGENDA_DECISIONS.find((o) => o.value === v)?.label ?? String(v ?? "");
const decisionTone = (v: unknown): "danger" | "warning" | "neutral" | "in" => (v === "approved" || v === "reviewed" ? "in" : v === "rejected" ? "danger" : v === "pending" ? "neutral" : "warning");

export default function CabWorkbench() {
  const { api, orgId, timezone } = useOrg();
  const refresh = useChangeRefresh();
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ item: Row; decision: string } | null>(null);
  const [text, setText] = useState<{ kind: "pack" | "minutes"; body: string; ai: boolean } | null>(null);
  const [nextCab, setNextCab] = useState<string | null>(null);
  const q = useQuery({ queryKey: CHANGE_KEYS.workbench(orgId, meetingId), queryFn: () => changeApi.workbench(api, meetingId) });
  const cabs = useQuery({ queryKey: ["change", orgId, "cabs"], queryFn: () => recordsApi.list(api, "cab", { filter: { f: "active", op: "eq", v: true }, size: 50, fields: ["name", "kind", "meeting_time"], total: false }) });
  const m = q.data?.meeting as Row | null | undefined;
  useEffect(() => {
    if (!meetingId && m?.id) setMeetingId(String(m.id));
  }, [m?.id, meetingId]);
  const after = () => {
    setAsk(null);
    refresh();
    void q.refetch();
  };
  const decide = useAction((v: { item: Row; decision: string; comment?: string }) => changeApi.decide(api, String(m!.id), String(v.item.id), v.decision, v.comment || null), {
    success: (d) => `تصمیم «${decisionLabel(d.item.decision)}» ثبت شد.`,
    onSuccess: after,
  });
  const refreshAgenda = useAction(() => changeApi.refreshAgenda(api, String(m!.id)), { success: (d) => (d.added ? `${d.added} تغییر به دستور جلسه افزوده شد.` : "دستور جلسه به‌روز است."), onSuccess: after });
  const pack = useAction(() => changeApi.pack(api, String(m!.id)), { onSuccess: (d) => setText({ kind: "pack", body: d.markdown, ai: d.ai }) });
  const minutes = useAction(() => changeApi.minutes(api, String(m!.id)), { onSuccess: (d) => setText({ kind: "minutes", body: String(m?.minutes || d.text), ai: d.ai }) });
  const complete = useAction((body: string) => changeApi.complete(api, String(m!.id), body, Number(m!.version)), { success: "جلسه پایان یافت و صورت‌جلسه فرستاده شد.", onSuccess: () => { setText(null); after(); } });
  const saveMinutes = useAction((body: string) => recordsApi.update(api, "cab_meeting", String(m!.id), { minutes: body }, Number(m!.version)), { success: "صورت‌جلسه ذخیره شد.", onSuccess: () => { setText(null); after(); } });
  const start = useAction(() => recordsApi.transition(api, "cab_meeting", String(m!.id), "in_progress", {}, Number(m!.version)), { success: "جلسه آغاز شد.", onSuccess: after });
  const present = useAction((ids: string[]) => recordsApi.update(api, "cab_meeting", String(m!.id), { present: ids }, Number(m!.version)), { onSuccess: after });
  const next = useAction((cab: string) => changeApi.nextMeeting(api, cab), {
    success: "جلسهٔ بعد ساخته شد.",
    onSuccess: (d) => {
      setNextCab(null);
      setMeetingId(String(d.meeting.id));
      refresh();
    },
  });

  if (q.isLoading) return <Loader />;
  const data = q.data;
  const meetings = (data?.meetings ?? []) as Row[];
  const byChange = new Map(((data?.changes ?? []) as Row[]).map((c) => [String(c.id), c]));
  const items = (data?.items ?? []) as Row[];
  const live = m && (m.state === "planned" || m.state === "in_progress");

  const header = (
    <PageHeader
      title="میز کار CAB"
      subtitle={m ? <span className="ds-num">{formatJalaliDateTime(String(m.starts_at), timezone)}</span> : undefined}
      actions={
        <Space wrap>
          {meetings.length ? (
            <Select
              value={meetingId ?? undefined}
              onChange={(v) => setMeetingId(v)}
              style={{ minWidth: 240 }}
              aria-label="جلسه"
              options={meetings.map((x) => ({ value: String(x.id), label: `${x.title}` }))}
            />
          ) : null}
          <Button icon={<CalendarPlus {...ICON14} />} onClick={() => setNextCab((cabs.data?.rows[0]?.id as string | undefined) ?? "")}>
            جلسهٔ بعد
          </Button>
        </Space>
      }
    />
  );

  if (!m)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState title="جلسه‌ای برای CAB ثبت نشده است" description="برای هیئتی که روز و ساعت جلسه دارد «جلسهٔ بعد» را بسازید؛ تغییرهای در انتظار CAB خودکار به دستور جلسه می‌آیند." />
        <NextMeetingModal open={nextCab !== null} cabs={(cabs.data?.rows ?? []) as Row[]} value={nextCab} onChange={setNextCab} loading={next.isPending} onOk={(id) => next.mutate(id)} onCancel={() => setNextCab(null)} />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={m.state === "in_progress" ? "accent" : "neutral"}>{m.state === "planned" ? "برنامه‌ریزی‌شده" : m.state === "in_progress" ? "در حال برگزاری" : m.state === "completed" ? "برگزار شد" : "لغوشده"}</Chip>
        {m.chair_id ? (
          <span className="text-[13px] text-ink-2">
            رئیس جلسه: <UserChip id={String(m.chair_id)} display={data?.display} compact />
          </span>
        ) : null}
        {m.conference_url ? (
          <a className="ds-link text-[13px]" href={String(m.conference_url)} target="_blank" rel="noreferrer">
            پیوند جلسهٔ برخط
          </a>
        ) : null}
        <Link className="ds-link text-[13px]" to={`/${orgId}/${recordPath("cab_meeting", String(m.id))}`}>
          پروندهٔ جلسه
        </Link>
        <span className="flex-1" />
        {data?.can_manage && m.state === "planned" ? (
          <Button size="small" onClick={() => start.mutate(undefined)} loading={start.isPending}>
            شروع جلسه
          </Button>
        ) : null}
        {data?.can_manage && live ? (
          <Button size="small" icon={<RefreshCw {...ICON14} />} loading={refreshAgenda.isPending} onClick={() => refreshAgenda.mutate(undefined)}>
            به‌روزرسانی دستور جلسه
          </Button>
        ) : null}
        <Button size="small" icon={<FileText {...ICON14} />} loading={pack.isPending} onClick={() => pack.mutate(undefined)}>
          بستهٔ جلسه
        </Button>
        <Button size="small" icon={<ScrollText {...ICON14} />} loading={minutes.isPending} onClick={() => minutes.mutate(undefined)}>
          صورت‌جلسه
        </Button>
      </div>
      {data?.can_manage && live ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-2">حاضران:</span>
          <div style={{ minWidth: 320 }}>
            <FormRecords table="user" multiple value={(m.present as string[]) ?? []} onChange={(v) => present.mutate((v as string[]) ?? [])} placeholder="حاضران جلسه" />
          </div>
        </div>
      ) : null}

      {!items.length ? (
        <EmptyState title="دستور جلسه خالی است" description="تغییرهایی که بررسی CAB لازم دارند با ورود به «در انتظار تأیید» به دستور جلسهٔ بعد افزوده می‌شوند." />
      ) : (
        <div className="chg-agenda" aria-label="دستور جلسه">
          {items.map((it, i) => {
            const c = byChange.get(String(it.change_id));
            const v = (data?.votes ?? {})[String(it.change_id)] as Votes | undefined;
            const can = decisionsFor(it, c, v, !!data?.can_manage);
            return (
              <article key={String(it.id)} className="chg-item" data-tone={c ? (changeTone(c) ?? undefined) : undefined} aria-label={`مورد ${i + 1}`}>
                <div className="chg-item-h">
                  <span className="ds-num text-ink-3">{i + 1}.</span>
                  {c ? (
                    <Link className="ds-link font-medium" to={`/${orgId}/${recordPath("change_request", String(c.id))}`}>
                      <span className="ds-ltr">{String(c.number)}</span> {String(c.short_description)}
                    </Link>
                  ) : (
                    <span className="text-ink-3">تغییری که دسترسی دیدنش را ندارید</span>
                  )}
                  <Chip tone={decisionTone(it.decision)}>{decisionLabel(it.decision)}</Chip>
                  <span className="text-[12px] text-ink-3">{AGENDA_KINDS.find((o) => o.value === it.kind)?.label}</span>
                </div>
                {c ? (
                  <div className="chg-facts">
                    <span>
                      ریسک <Chip tone={riskChip(c.risk)}>{riskLabel(c.risk)}</Chip> <span className="ds-num">({String(c.risk_score ?? "—")})</span>
                    </span>
                    <span className="ds-num">
                      {formatJalaliDateTime(c.planned_start, timezone)} تا {formatJalaliDateTime(c.planned_end, timezone)}
                    </span>
                    {flags(c).map((f) => (
                      <span key={f} className="text-warning">
                        {f}
                      </span>
                    ))}
                    {c.outage_expected ? <span>قطعی پیش‌بینی می‌شود</span> : null}
                    <span>{c.backout_tested ? "بازگشت آزموده‌شده" : "بازگشت آزموده نشده"}</span>
                    <span>رأی‌ها: {voteText(v)}</span>
                  </div>
                ) : null}
                {it.decision_notes ? <p className="text-[13px] text-ink-2">{String(it.decision_notes)}</p> : null}
                {can.vote || can.chair.length ? (
                  <Space wrap size={6}>
                    {can.vote ? (
                      <>
                        <Button size="small" type="primary" icon={<Check {...ICON14} />} loading={decide.isPending} onClick={() => decide.mutate({ item: it, decision: "approved" })}>
                          موافقم
                        </Button>
                        <Button size="small" danger icon={<X {...ICON14} />} onClick={() => setAsk({ item: it, decision: "rejected" })}>
                          مخالفم
                        </Button>
                      </>
                    ) : null}
                    {can.chair.includes("deferred") ? (
                      <Tooltip title="تصمیم در جلسهٔ بعد">
                        <Button size="small" icon={<Clock {...ICON14} />} onClick={() => decide.mutate({ item: it, decision: "deferred" })}>
                          به جلسهٔ بعد
                        </Button>
                      </Tooltip>
                    ) : null}
                    {can.chair.includes("info_requested") ? (
                      <Button size="small" icon={<HelpCircle {...ICON14} />} onClick={() => setAsk({ item: it, decision: "info_requested" })}>
                        اطلاعات بیشتر
                      </Button>
                    ) : null}
                    {can.chair.includes("reviewed") ? (
                      <Button size="small" icon={<Eye {...ICON14} />} onClick={() => decide.mutate({ item: it, decision: "reviewed" })}>
                        مرور شد
                      </Button>
                    ) : null}
                  </Space>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <Modal open={!!ask} title={ask?.decision === "rejected" ? "مخالفت با تغییر" : "درخواست اطلاعات بیشتر"} okText="ثبت" cancelText="انصراف" destroyOnHidden onCancel={() => setAsk(null)} okButtonProps={{ form: "cab-ask", htmlType: "submit", loading: decide.isPending, danger: ask?.decision === "rejected" }}>
        <Form id="cab-ask" layout="vertical" onFinish={(v) => ask && decide.mutate({ item: ask.item, decision: ask.decision, comment: v.comment })}>
          <Form.Item name="comment" label={ask?.decision === "rejected" ? "دلیل مخالفت" : "چه اطلاعاتی لازم است؟"} rules={[{ required: true, message: "این مورد را بنویسید" }]}>
            <Input.TextArea rows={4} maxLength={4000} autoFocus />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!text}
        title={text?.kind === "pack" ? "بستهٔ جلسه" : "صورت‌جلسه"}
        width={760}
        destroyOnHidden
        onCancel={() => setText(null)}
        footer={
          text?.kind === "minutes" && data?.can_manage ? (
            <Space>
              <Button onClick={() => text && saveMinutes.mutate(text.body)} loading={saveMinutes.isPending}>
                ذخیره
              </Button>
              {live ? (
                <Button type="primary" onClick={() => text && complete.mutate(text.body)} loading={complete.isPending}>
                  پایان جلسه و ارسال صورت‌جلسه
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        {text?.ai ? <p className="mb-2 text-[12px] text-ink-3">پیش‌نویس هوش مصنوعی؛ پیش از ارسال بازبینی کنید.</p> : null}
        {text?.kind === "minutes" && data?.can_manage ? (
          <Input.TextArea value={text.body} onChange={(e) => setText({ ...text, body: e.target.value })} autoSize={{ minRows: 12, maxRows: 24 }} aria-label="متن صورت‌جلسه" />
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <RecordMarkdown text={text?.body ?? ""} />
          </div>
        )}
      </Modal>
      <NextMeetingModal open={nextCab !== null} cabs={(cabs.data?.rows ?? []) as Row[]} value={nextCab} onChange={setNextCab} loading={next.isPending} onOk={(id) => next.mutate(id)} onCancel={() => setNextCab(null)} />
    </div>
  );
}

function NextMeetingModal(p: { open: boolean; cabs: Row[]; value: string | null; onChange: (v: string) => void; loading: boolean; onOk: (id: string) => void; onCancel: () => void }) {
  return (
    <Modal open={p.open} title="ساخت جلسهٔ بعد" okText="ساخت" cancelText="انصراف" destroyOnHidden onCancel={p.onCancel} onOk={() => p.value && p.onOk(p.value)} okButtonProps={{ disabled: !p.value, loading: p.loading }}>
      <Select
        value={p.value || undefined}
        onChange={p.onChange}
        className="w-full"
        placeholder="هیئت"
        aria-label="هیئت"
        options={p.cabs.map((c) => ({ value: String(c.id), label: String(c.name), disabled: !c.meeting_time }))}
      />
      <p className="mt-2 text-[12px] text-ink-3">جلسه در نخستین روز و ساعت جلسهٔ هیئت ساخته می‌شود و تغییرهای در انتظار آن به دستور جلسه می‌آیند.</p>
    </Modal>
  );
}
