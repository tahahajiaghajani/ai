// «بینش‌ها» on the dashboard: what needs attention now, from the deterministic rule engine (it works with AI switched
// off) — severity, a one-line finding, its facts, the action, «چرا این را می‌بینم؟» with the evidence and links, and per
// person: snooze, done or dismiss (each with an undo).
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Dropdown } from "antd";
import { BellOff, CalendarClock, ChevronDown, CircleCheck, Ellipsis, FileText, Lightbulb, Package, Sparkles, Users, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { AiInsight, AiRef } from "@shared/ai/types";
import { addDays, todayISO } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { ChequeIcon, Ic } from "../../components/shell/icons";
import { openAssistant } from "../assistant/bus";
import { Card, Empty, HeadLink, SkRows } from "../../modules/dashboard/kit";
import { SEVERITY_LABEL, feedOf } from "../kit/model";
import { useAiInsights, useAiKey } from "../kit/hooks";

const SHOW = 5;
const ICON14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

const REF_ICON: Record<string, typeof FileText> = { party: Users, item: Package, cheque: ChequeIcon };

export function RefChip({ r }: { r: AiRef }) {
  const { orgId } = useOrg();
  const I = REF_ICON[r.type] ?? FileText;
  const body = (
    <>
      <I {...ICON14} aria-hidden />
      <span>{r.label}</span>
    </>
  );
  return r.path ? (
    <Link className="ai-ref" to={`/${orgId}/${r.path.replace(/^\/+/, "")}`}>
      {body}
    </Link>
  ) : (
    <span className="ai-ref">{body}</span>
  );
}

function Sev({ s }: { s: AiInsight["severity"] }) {
  return (
    <span className="ai-sev" data-sev={s}>
      <i className="sf-nuqta" aria-hidden />
      {SEVERITY_LABEL[s]}
    </span>
  );
}

function InsightRow({ ins, onStatus }: { ins: AiInsight; onStatus: (status: AiInsight["status"], until?: string) => void }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  const [why, setWhy] = useState(false);
  const act = ins.action;
  const runAction = () => {
    if (!act) return;
    if (ins.status === "new") onStatus("seen");
    if (act.path) nav(`/${orgId}/${act.path.replace(/^\/+/, "")}`);
    else if (act.prompt) openAssistant({ prompt: act.prompt, send: true, context: { path: "", title: "پیشخوان" } });
  };
  return (
    <div className="ai-ins-r" role="listitem">
      <div className="ai-ins-h">
        <Sev s={ins.severity} />
        <span className="ai-ins-t">{ins.title_fa}</span>
      </div>
      <Dropdown
        trigger={["click"]}
        rootClassName="sf-glass"
        placement="bottomLeft"
        menu={{
          items: [
            { key: "tomorrow", icon: <Ic icon={CalendarClock} />, label: "یادآوری فردا", onClick: () => onStatus("snoozed", addDays(todayISO(), 1)) },
            { key: "week", icon: <Ic icon={CalendarClock} />, label: "یادآوری هفتهٔ بعد", onClick: () => onStatus("snoozed", addDays(todayISO(), 7)) },
            { key: "done", icon: <Ic icon={CircleCheck} />, label: "انجام شد", onClick: () => onStatus("done") },
            { type: "divider" },
            { key: "dismiss", icon: <Ic icon={BellOff} />, label: "نادیده گرفتن", onClick: () => onStatus("dismissed") },
          ],
        }}
      >
        <Button type="text" size="small" icon={<Ic icon={Ellipsis} />} aria-label={`گزینه‌های «${ins.title_fa}»`} />
      </Dropdown>
      {ins.body_fa ? <p className="ai-ins-b">{ins.body_fa}</p> : null}
      {ins.facts.length ? (
        <div className="ai-ins-f">
          {ins.facts.slice(0, 3).map((f) => (
            <span key={f.label}>
              {f.label} <b>{f.value}</b>
            </span>
          ))}
        </div>
      ) : null}
      <div className="ai-ins-a">
        {act ? (
          act.path ? (
            <button type="button" className="sf-link border-0 bg-transparent p-0 text-[13px]" onClick={runAction}>
              {act.label}
            </button>
          ) : (
            <button type="button" className="sf-link inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[13px]" onClick={runAction}>
              <Sparkles {...ICON14} aria-hidden />
              {act.label}
            </button>
          )
        ) : null}
        <button
          type="button"
          className="ai-why-b"
          aria-expanded={why}
          onClick={() => {
            setWhy((w) => !w);
            if (ins.status === "new") onStatus("seen");
          }}
        >
          چرا این را می‌بینم؟
          <ChevronDown {...ICON14} aria-hidden />
        </button>
      </div>
      {why ? (
        <div className="ai-why">
          <span>{ins.why_fa}</span>
          {ins.facts.length > 3 ? (
            <dl>
              {ins.facts.map((f) => (
                <div key={f.label} style={{ display: "contents" }}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {ins.refs.length ? (
            <div className="ai-refs">
              {ins.refs.slice(0, 8).map((r) => (
                <RefChip key={`${r.type}-${r.id}`} r={r} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const STATUS_NOTE: Partial<Record<AiInsight["status"], string>> = {
  snoozed: "تا زمان یادآوری پنهان شد.",
  done: "انجام‌شده علامت خورد.",
  dismissed: "این مورد دیگر نشان داده نمی‌شود.",
};

export function InsightsCard() {
  const { api } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const key = useAiKey();
  const q = useAiInsights();
  const [all, setAll] = useState(false);
  const feed = feedOf(q.data ?? []);
  const shown = all ? feed : feed.slice(0, SHOW);

  const setStatus = async (ins: AiInsight, status: AiInsight["status"], until?: string) => {
    const prev = qc.getQueryData<AiInsight[]>(key("insights"));
    qc.setQueryData<AiInsight[]>(key("insights"), (l) => (l ?? []).map((x) => (x.id === ins.id ? { ...x, status } : x)));
    try {
      await api.post(`/ai/insights/${encodeURIComponent(ins.id)}/status`, { status, snooze_until: until ?? null });
      const note = STATUS_NOTE[status];
      if (note)
        n.info(note, {
          action: {
            label: "بازگردانی",
            onClick: async () => {
              qc.setQueryData<AiInsight[]>(key("insights"), (l) => (l ?? []).map((x) => (x.id === ins.id ? { ...x, status: "seen" } : x)));
              await api.post(`/ai/insights/${encodeURIComponent(ins.id)}/status`, { status: "seen", snooze_until: null }).catch((e) => n.error(e));
            },
          },
        });
    } catch (e) {
      if (prev) qc.setQueryData(key("insights"), prev);
      if (status !== "seen") n.error(e);
    }
  };

  const counts = feed.reduce((m, i) => ({ ...m, [i.severity]: (m[i.severity] ?? 0) + 1 }), {} as Record<string, number>);
  const caption = !q.data
    ? undefined
    : feed.length
      ? [counts.critical ? `${fa(counts.critical)} فوری` : "", counts.warning ? `${fa(counts.warning)} مهم` : "", `${fa(feed.length)} مورد`].filter(Boolean).join("، ")
      : undefined;

  return (
    <Card
      title="بینش‌ها"
      caption={caption}
      label="بینش‌ها: آنچه امروز توجه می‌خواهد"
      end={
        feed.length ? (
          <HeadLink icon={Sparkles} squeeze onClick={() => openAssistant({ prompt: "بینش‌های امروز را خلاصه کن و بگو از کدام شروع کنم.", send: true, context: { path: "", title: "پیشخوان" } })}>
            بپرس از دستیار
          </HeadLink>
        ) : null
      }
    >
      {q.isLoading ? (
        <SkRows rows={4} cols={[0.3, 0.7, 0.2]} />
      ) : q.error ? (
        <Empty compact icon={X} title="بینش‌ها بارگذاری نشد." action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
      ) : !feed.length ? (
        <div className="ai-clear">
          <Lightbulb size={16} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
          موردی برای توجه نیست؛ با هر سند تازه، دوباره بررسی می‌شود.
        </div>
      ) : (
        <>
          <div className="ai-ins" role="list">
            {shown.map((ins) => (
              <InsightRow key={ins.id} ins={ins} onStatus={(s, until) => setStatus(ins, s, until)} />
            ))}
          </div>
          {feed.length > SHOW ? (
            <div className="ai-ins-more">
              <Button size="small" type="text" onClick={() => setAll((a) => !a)}>
                {all ? "نمایش کمتر" : `نمایش همه (${fa(feed.length)})`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
