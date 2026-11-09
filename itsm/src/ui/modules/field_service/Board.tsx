// «تابلوی توزیع» (FSM-004/005/006, signature screen): a day's timeline by technician — their shift shaded, visits as
// bars in the organisation's zone, clashes outlined — beside the queue of visits waiting for a technician. A visit is
// dragged from the queue (or from another lane) and dropped on a technician at a time: the server checks skills,
// territory, shift, load and clashes and answers with the warnings, which a dispatcher may override. Every move has a
// keyboard way: «واگذاری…» on a queued visit opens the ranked technicians (AssignDialog); a bar opens its visit.
import { useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Modal, Tooltip } from "antd";
import { ChevronLeft, ChevronRight, RefreshCw, TriangleAlert, UserPlus } from "lucide-react";
import { addDays, formatJalali, todayISO, toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, cx } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { RecordSelect, recordPath } from "../../records";
import { FIELD_KEYS, fieldApi, type Lane } from "./api";
import { AssignDialog, type AssignTarget } from "./AssignDialog";
import { boardWindow, clock, fractionAt, hourTicks, placeBar, taskState, timeAt, type Row } from "./model";
import "./field.css";

const DRAG = "application/x-wo-task";

export default function DispatchBoard() {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const [day, setDay] = useState<string>(todayISO(timezone));
  const [territory, setTerritory] = useState<string | null>(null);
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ task: Row; technician: string; start: string; warnings: string[] } | null>(null);
  const q = useQuery({ queryKey: FIELD_KEYS.board(orgId, day, territory), queryFn: () => fieldApi.board(api, day, territory), refetchInterval: 60_000 });
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["field_service", orgId, "board"] });
  const tasksById = useMemo(() => {
    const m = new Map<string, Row>();
    for (const t of d?.queue ?? []) m.set(String(t.id), t);
    for (const l of d?.lanes ?? []) for (const t of l.tasks) m.set(String(t.id), t);
    return m;
  }, [d]);
  const win = useMemo(() => {
    if (!d) return null;
    const spans = d.lanes.flatMap((l) => [...l.shift, ...l.tasks.map((t) => ({ start: t.scheduled_start, end: t.scheduled_end }))]);
    return boardWindow(Date.parse(d.from), Date.parse(d.to), spans);
  }, [d]);
  const drop = useAction((v: { task: Row; technician: string; start: string; force?: boolean }) => fieldApi.assign(api, String(v.task.id), { technician_id: v.technician, start: v.start, force: v.force }), {
    onSuccess: (r, v) => {
      if (r.assigned) {
        n.ok(r.warnings.length ? "با وجود هشدارها واگذار شد" : `${v.task.number ?? "وظیفه"} واگذار شد`);
        setPending(null);
        refresh();
      } else setPending({ task: v.task, technician: v.technician, start: v.start, warnings: r.warnings });
    },
  });

  const onDrop = (e: DragEvent<HTMLDivElement>, lane: Lane) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG);
    const task = tasksById.get(id);
    if (!task || !win) return;
    const box = e.currentTarget.getBoundingClientRect();
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const start = new Date(timeAt(fractionAt(e.clientX, { left: box.left, width: box.width }, rtl), win)).toISOString();
    drop.mutate({ task, technician: lane.user_id, start });
  };
  const dragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData(DRAG, id);
    e.dataTransfer.effectAllowed = "move";
  };

  const ticks = win ? hourTicks(win, timezone) : [];
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="تابلوی توزیع"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button aria-label="روز پیش" icon={<ChevronRight {...ICON} />} onClick={() => setDay(addDays(day, -1))} />
            <DateInput value={day} onChange={(v: string | null) => v && setDay(v)} aria-label="روز تابلو" />
            <Button aria-label="روز بعد" icon={<ChevronLeft {...ICON} />} onClick={() => setDay(addDays(day, 1))} />
            <RecordSelect table="territory" value={territory} onChange={(v) => setTerritory((v as string | null) ?? null)} placeholder="همهٔ قلمروها" allowClear className="min-w-[12rem]" aria-label="قلمرو" />
            <Button icon={<RefreshCw {...ICON} />} onClick={refresh} loading={q.isFetching}>تازه‌سازی</Button>
          </div>
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !d || !win ? (
        <EmptyState title="تابلوی توزیع در دسترس نیست" />
      ) : (
        <div className="fs-board">
          <section className="fs-queue" aria-label="منتظر توزیع">
            <h2 className="text-[13px] text-ink-2">منتظر توزیع <span className="ds-num">{toFa(d.queue.length)}</span></h2>
            {d.queue.length ? (
              d.queue.map((t) => (
                <div key={t.id} className="fs-card" draggable={d.dispatcher} onDragStart={(e) => dragStart(e, String(t.id))}>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" className="ds-link text-[12px]" onClick={() => nav(`/${orgId}/${recordPath("wo_task", t.id)}`)}>{t.number}</button>
                    <Chip tone={Number(t.priority) <= 2 ? "danger" : "neutral"}>اولویت {toFa(t.priority ?? "۳")}</Chip>
                  </div>
                  <div className="text-[13px]">{t.short_description}</div>
                  <div className="flex flex-wrap gap-1 text-[12px] text-ink-3">
                    {(t.required_skills as string[] | null)?.map((s) => <span key={s} className="fs-skill">{s}</span>)}
                    {t.window_start ? <span>بازهٔ مشتری: {clock(t.window_start, timezone)}–{clock(t.window_end, timezone)}</span> : null}
                    {t.sla_due ? <span>موعد رسیدن: {formatJalali(t.sla_due)} {clock(t.sla_due, timezone)}</span> : null}
                  </div>
                  {d.dispatcher ? (
                    <Button size="small" icon={<UserPlus {...ICON} />} onClick={() => setTarget({ task: t, day })}>واگذاری…</Button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-[12px] text-ink-3">وظیفه‌ای منتظر توزیع نیست.</p>
            )}
          </section>
          <section className="fs-timeline" aria-label={`برنامهٔ ${formatJalali(day, { style: "long" })}`}>
            <div className="fs-row fs-head">
              <div className="fs-name text-ink-3">تکنسین</div>
              <div className="fs-scale" aria-hidden>
                {ticks.map((t) => <span key={t.at} style={{ insetInlineStart: `${t.pct}%` }}>{t.label}</span>)}
              </div>
            </div>
            {d.lanes.length ? (
              d.lanes.map((l) => {
                const clash = new Set(l.clashes.flat());
                const load = l.tasks.filter((t) => !["cancelled", "closed"].includes(String(t.state))).length;
                return (
                  <div key={l.user_id} className={cx("fs-row", !l.available && "is-off")}>
                    <div className="fs-name">
                      <span className="truncate font-medium">{l.name}</span>
                      <span className="text-[11px] text-ink-3">
                        <span className={cx("ds-num", load > l.max && "text-danger")}>{toFa(load)}/{toFa(l.max)}</span>
                        {l.contractor ? " · پیمانکار" : ""}
                        {!l.available ? " · در دسترس نیست" : ""}
                      </span>
                    </div>
                    <div
                      className={cx("fs-track", over === l.user_id && "is-over")}
                      onDragOver={(e) => {
                        if (!d.dispatcher) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (over !== l.user_id) setOver(l.user_id);
                      }}
                      onDragLeave={() => setOver((o) => (o === l.user_id ? null : o))}
                      onDrop={(e) => onDrop(e, l)}
                      aria-label={`برنامهٔ ${l.name}`}
                    >
                      {ticks.map((t) => <i key={t.at} className="fs-tick" style={{ insetInlineStart: `${t.pct}%` }} aria-hidden />)}
                      {l.shift.map((s, i) => {
                        const p = placeBar(s.start, s.end, win);
                        return p ? <i key={i} className="fs-shift" style={{ insetInlineStart: `${p.start}%`, inlineSize: `${p.size}%` }} aria-hidden /> : null;
                      })}
                      {l.tasks.map((t) => {
                        const p = placeBar(t.scheduled_start, t.scheduled_end, win);
                        if (!p) return null;
                        const st = taskState(t.state);
                        return (
                          <Tooltip key={t.id} title={`${t.number} — ${t.short_description} (${st?.label ?? t.state}) ${clock(t.scheduled_start, timezone)}–${clock(t.scheduled_end, timezone)}`}>
                            <button
                              type="button"
                              className={cx("fs-bar", clash.has(String(t.id)) && "is-clash")}
                              data-c={st?.color ?? "gray"}
                              style={{ insetInlineStart: `${p.start}%`, inlineSize: `${p.size}%` }}
                              draggable={d.dispatcher && ["assigned", "pending_dispatch"].includes(String(t.state))}
                              onDragStart={(e) => dragStart(e, String(t.id))}
                              onClick={() => nav(`/${orgId}/${recordPath("wo_task", t.id)}`)}
                            >
                              {clash.has(String(t.id)) ? <TriangleAlert size={12} aria-label="هم‌پوشانی" /> : null}
                              <span>{t.number}</span>
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState compact title="تکنسینی در این قلمرو نیست" />
            )}
          </section>
        </div>
      )}
      <AssignDialog target={target} dispatcher={!!d?.dispatcher} onClose={() => setTarget(null)} onDone={() => { setTarget(null); refresh(); }} />
      <Modal
        open={!!pending}
        title="این واگذاری هشدار دارد"
        onCancel={() => setPending(null)}
        okText="با این حال واگذار شود"
        cancelText="انصراف"
        onOk={() => pending && drop.mutate({ task: pending.task, technician: pending.technician, start: pending.start, force: true })}
        okButtonProps={{ loading: drop.isPending, disabled: !d?.dispatcher }}
        destroyOnHidden
      >
        <ul className="list-disc ps-4 text-[13px] text-ink-2">{pending?.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      </Modal>
    </div>
  );
}
