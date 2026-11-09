// «خانهٔ کارشناس» (WFM-027/012/035, SLM-025/050): everything a person works on, read with their own access — the next
// best action (rules today, the AI's place later), their open work across every task table, the SLA timers at risk
// with the probability of a breach, their teams' unassigned queue, what they touched recently; presence (with the
// automatic away after idling while this page is open), today's shift, points, level, badges, kudos, time off ahead
// and certificates about to expire.
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Progress, Select, Space } from "antd";
import { ArrowLeft, Award, CalendarClock, Clock3, Compass, HeartHandshake, History, Inbox, ListTodo, Plane } from "lucide-react";
import { formatJalali, toFa } from "@shared/jalali";
import { PRESENCE_STATES } from "@shared/tables/workforce";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDate, Loader } from "../../components/display";
import { Card, ICON } from "../../components/blocks";
import { recordPath } from "../../records";
import { AtRiskTable } from "../slm/Overview";
import { WFM_KEYS, wfmApi, type HomeItem } from "./api";
import { minutesText, PRESENCE_TONE, presenceLabel, shiftText } from "./model";
import "./workforce.css";

const HEARTBEAT_MS = 2 * 60_000;

/** Activity of this tab: the time since the last key, pointer or focus event. */
function useIdle(): () => number {
  const last = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
    };
    const events = ["keydown", "pointerdown", "pointermove", "focus", "wheel"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, []);
  return () => Date.now() - last.current;
}

function WorkList({ items, empty }: { items: HomeItem[]; empty: string }) {
  const { orgId } = useOrg();
  if (!items.length) return <EmptyState compact title={empty} />;
  return (
    <ul className="wfm-list">
      {items.map((i) => (
        <li key={`${i.table}:${i.id}`}>
          <Link className="ds-link wfm-list-title" to={`/${orgId}/${recordPath(i.table, i.id)}`}>
            <span className="ds-latin text-ink-3">{i.number}</span> {i.title}
          </Link>
          <span className="wfm-list-meta">
            {i.priority ? <Chip tone={Number(i.priority) <= 2 ? "danger" : "neutral"} dot={false}>اولویت {toFa(i.priority)}</Chip> : null}
            {i.state_label ? <span>{i.state_label}</span> : null}
            {i.sla_due ? <span>موعد <JDate v={i.sla_due} /></span> : null}
            {(i.stale_days ?? 0) >= 3 ? <span className="text-warning">{toFa(i.stale_days!)} روز بی‌تغییر</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function AgentHome() {
  const { api, orgId, timezone } = useOrg();
  const qc = useQueryClient();
  const idle = useIdle();
  const q = useQuery({ queryKey: WFM_KEYS.home(orgId), queryFn: () => wfmApi.home(api), refetchInterval: 120_000 });
  const presence = useAction((state: string) => wfmApi.presence(api, state), { onSuccess: () => qc.invalidateQueries({ queryKey: WFM_KEYS.home(orgId) }) });
  useEffect(() => {
    const beat = () => {
      wfmApi.heartbeat(api, idle()).then((r) => {
        if (r.presence !== q.data?.presence.state) qc.invalidateQueries({ queryKey: WFM_KEYS.home(orgId) });
      }).catch(() => undefined);
    };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, orgId]);
  if (q.isLoading) return <Loader />;
  const h = q.data;
  if (!h) return <EmptyState title="خانهٔ کارشناس در دسترس نیست" />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="خانهٔ کارشناس"
        subtitle={h.shift.on === true ? <span>در شیفت «{h.shift.pattern}» — {minutesText(h.shift.left_minutes)} مانده</span> : h.shift.on === false ? <span>بیرون از شیفت{h.shift.pattern ? ` («${h.shift.pattern}»)` : ""}</span> : undefined}
        actions={
          <Space>
            <Chip tone={PRESENCE_TONE[h.presence.state] ?? "neutral"}>{presenceLabel(h.presence.state)}</Chip>
            <Select
              aria-label="وضعیت حضور"
              size="middle"
              value={h.presence.state}
              style={{ minInlineSize: 150 }}
              onChange={(v) => presence.mutate(v)}
              options={PRESENCE_STATES.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Space>
        }
      />
      <Card className="wfm-next" title={<span className="flex items-center gap-2"><Compass {...ICON} /> کار بعدی پیشنهادی</span>} meta={h.next.source === "ai" ? "پیشنهاد هوش مصنوعی" : "پیشنهاد قاعده‌محور"}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium">{h.next.title}</div>
            <div className="text-[13px] text-ink-2">{h.next.reason}</div>
          </div>
          {h.next.table && h.next.id ? <Link className="ds-link flex items-center gap-1" to={`/${orgId}/${recordPath(h.next.table, h.next.id)}`}>باز کردن <ArrowLeft size={14} /></Link> : null}
        </div>
      </Card>
      <div className="wfm-home">
        <div className="flex flex-col gap-4 min-w-0">
          <Card title={<span className="flex items-center gap-2"><ListTodo {...ICON} /> کارهای من</span>} meta={h.work.total ? `${toFa(h.work.total)} کار باز` : undefined} tools={h.work.by_table.length > 1 ? <span className="text-[12px] text-ink-3">{h.work.by_table.map((t) => `${t.label}: ${toFa(t.count)}`).join(" · ")}</span> : undefined}>
            <WorkList items={h.work.items} empty="کار بازی به شما سپرده نشده است" />
          </Card>
          <Card title={<span className="flex items-center gap-2"><Clock3 {...ICON} /> زمان‌سنج‌های در خطر</span>}>
            {h.at_risk.length ? <AtRiskTable scope="mine" /> : <EmptyState compact title="زمان‌سنجی در خطر نیست" />}
          </Card>
          <Card title={<span className="flex items-center gap-2"><Inbox {...ICON} /> صف تیم‌های من</span>} meta={h.queue.length ? `${toFa(h.queue.length)} کار بی‌کارشناس` : undefined}>
            <WorkList items={h.queue} empty="کاری در صف تیم‌ها منتظر نیست" />
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={<span className="flex items-center gap-2"><CalendarClock {...ICON} /> شیفت امروز</span>}>
            {h.shift.today.length ? h.shift.today.map((s) => <div key={s.start} className="ds-num">{shiftText(s.start, s.end, timezone)}</div>) : <p className="text-[13px] text-ink-3">{h.shift.on === null ? "برنامهٔ شیفتی برای شما ثبت نشده است." : "امروز شیفت ندارید."}</p>}
          </Card>
          <Card title={<span className="flex items-center gap-2"><Award {...ICON} /> امتیاز و سطح</span>} meta={`${toFa(h.points.month)} امتیاز این ماه`}>
            <div className="flex items-center justify-between"><span className="font-medium">{h.points.level.label}</span><span className="ds-num text-ink-3">{toFa(h.points.total)} امتیاز</span></div>
            {h.points.level.next !== null ? <Progress percent={h.points.level.progress} size="small" showInfo={false} aria-label="پیشرفت تا سطح بعد" /> : null}
            <div className="flex flex-wrap gap-1 mt-2">{h.points.badges.map((b) => <Chip key={b.key} tone="accent" dot={false}>{b.label}</Chip>)}</div>
          </Card>
          {h.kudos.length ? (
            <Card title={<span className="flex items-center gap-2"><HeartHandshake {...ICON} /> قدردانی‌ها</span>}>
              {h.kudos.map((k, i) => <p key={i} className="text-[13px]"><span className="text-ink-3">{k.from ?? "همکار"}:</span> {k.message}</p>)}
            </Card>
          ) : null}
          {h.absences.length || h.certifications.length ? (
            <Card title={<span className="flex items-center gap-2"><Plane {...ICON} /> پیش رو</span>}>
              {h.absences.map((a) => <p key={a.id} className="text-[13px]">{a.label} <Chip tone={a.state === "approved" ? "in" : "warning"} dot={false}>{a.state === "approved" ? "تأییدشده" : "در انتظار تأیید"}</Chip></p>)}
              {h.certifications.map((c) => <p key={c.id} className="text-[13px]">گواهی «{c.name}» {c.days !== null && c.days < 0 ? "منقضی شده است" : `تا ${toFa(c.days ?? 0)} روز دیگر منقضی می‌شود`}</p>)}
            </Card>
          ) : null}
          <Card title={<span className="flex items-center gap-2"><History {...ICON} /> اخیراً</span>}>
            {!h.recent.length ? <p className="text-[13px] text-ink-3">در هفتهٔ گذشته رکوردی را تغییر نداده‌اید.</p> : (
              <ul className="flex flex-col gap-1">
                {h.recent.map((r) => (
                  <li key={`${r.table}:${r.id}`} className="text-[13px] flex justify-between gap-2">
                    <Link className="ds-link truncate" to={`/${orgId}/${recordPath(r.table, r.id)}`}><span className="ds-latin text-ink-3">{r.number}</span> {r.title}</Link>
                    <span className="text-ink-3 shrink-0">{formatJalali(r.at.slice(0, 10), { style: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
