// «تحلیل با هوش مصنوعی» on a report — CONTRACT (stream E2): report pages (and the integrator, on gold pages) add
//   <AiExplainButton report="trial_balance" params={{ from, to }} title="تراز آزمایشی" />
// to the PageHeader actions. The button shows for members with ai:view while the business's «تحلیل گزارش‌ها» switch is
// on; it opens a side sheet with the narrative (computed by the server from the report itself, numbers checked against
// it; a template when no model is available), the key points, and follow-up questions that continue in the assistant.
// A page opened with «?ai=explain» shows the analysis right away.
import type { AiExplainRequest, AiExplanation } from "@shared/ai/api";
import "../kit/ai.css";
import "./explain.css";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Drawer, Tooltip } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpLeft, CircleAlert, MessageCircleQuestion, RotateCcw, Sparkles } from "lucide-react";
import type { AiPageContext } from "@shared/ai/types";
import { aiErrorText } from "@shared/ai/errors";
import { useOrg } from "../../lib/org";
import { openAssistant } from "../assistant/bus";
import { Narrative } from "../kit/Narrative";
import { errorKindOf, explainOf, failText } from "../kit/model";
import { useAiKey, useAiStatus } from "../kit/hooks";

/** Report keys understood by POST /ai/explain (the server maps each to its report service and permission). */
export type ExplainReport = AiExplainRequest["report"];

export interface AiExplainButtonProps {
  /** report key understood by POST /ai/explain (AI_REPORT_KEYS or an alias in @shared/ai/api) */
  report: ExplainReport;
  /** the report's current parameters (period, level, filters) exactly as the page sends them to its own endpoint */
  params?: Record<string, unknown>;
  /** the report's Persian title, shown in the sheet's header and given to the assistant as page context */
  title: string;
  /** hide the words under 640 px and keep the icon (crowded headers) */
  compact?: boolean;
  disabled?: boolean;
}

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** Drop empty parameters so the cache key and the request carry only what the report uses. */
function cleanParams(p: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

export function AiExplainButton({ report, params, title, compact, disabled }: AiExplainButtonProps) {
  const { can } = useOrg();
  const allowed = can("ai", "view");
  const status = useAiStatus(allowed);
  // «?ai=explain» opens the analysis on arrival (links from the assistant and the palette)
  const [sp] = useSearchParams();
  const [open, setOpen] = useState(() => sp.get("ai") === "explain");
  const s = status.data;
  if (!allowed || (s && (!s.enabled || s.features?.explain === false))) return null;
  const label = "تحلیل با هوش مصنوعی";
  return (
    <>
      <Tooltip title={compact ? label : undefined}>
        <Button icon={<Sparkles {...ICON} />} onClick={() => setOpen(true)} disabled={disabled} aria-label={label} className={compact ? "ai-xb is-compact" : "ai-xb"} aria-haspopup="dialog">
          <span className="ai-xb-t">{label}</span>
        </Button>
      </Tooltip>
      {open ? <ExplainDrawer report={report} params={cleanParams(params)} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ExplainDrawer({ report, params, title, onClose }: { report: string; params: Record<string, unknown>; title: string; onClose: () => void }) {
  const { api, can } = useOrg();
  const key = useAiKey();
  const [fresh, setFresh] = useState(0);
  const q = useQuery({
    queryKey: key("explain", report, params, fresh),
    queryFn: () => api.post<{ explanation: AiExplanation }>("/ai/explain", { report, params, fresh: fresh > 0 } satisfies AiExplainRequest).then(explainOf),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const ctx: AiPageContext = { title, report: { key: report, params } };
  const ask = (prompt: string, send = true) => {
    openAssistant({ prompt, send, context: ctx });
    onClose();
  };
  const e = q.error;
  const kind = errorKindOf(e);
  const err = kind ? aiErrorText(kind, { canManage: can("ai", "full") }) : null;
  const x = q.data;

  return (
    <Drawer
      open
      onClose={onClose}
      placement="left"
      size={520}
      closable={{ placement: "end" }}
      title={
        <span className="ai-xd-h">
          <Sparkles {...ICON} className="ai-spark" aria-hidden />
          <span>تحلیل «{title}»</span>
        </span>
      }
      footer={
        <div className="ai-sheet-foot">
          <Button icon={<RotateCcw {...ICON} />} onClick={() => setFresh((f) => f + 1)} disabled={q.isFetching}>
            تحلیل دوباره
          </Button>
          <span className="sf-end">
            <Button icon={<MessageCircleQuestion {...ICON} />} onClick={() => ask(`دربارهٔ گزارش «${title}» بپرس: `, false)}>
              پرسش از دستیار
            </Button>
          </span>
        </div>
      }
    >
      {q.isFetching && !x ? (
        <div className="ai-xd" aria-busy="true" aria-live="polite">
          <div className="ai-xd-wait">
            <span className="sf-nuqta sf-pulse" aria-hidden />
            در حال خواندن گزارش و نوشتن تحلیل…
          </div>
          <div className="grid gap-2.5">
            {[100, 94, 98, 72, 0, 88, 96, 60].map((w, i) => (w ? <i key={i} className="ai-sk" style={{ inlineSize: `${w}%` }} /> : <span key={i} className="block h-2" />))}
          </div>
        </div>
      ) : e ? (
        <div className="ai-err" role="alert">
          <CircleAlert {...ICON} aria-hidden />
          <div>
            <b>{err?.title ?? "تحلیل آماده نشد"}</b>
            <span>{err ? err.remedy : failText(e)}</span>
            <div className="mt-2">
              <Button size="small" onClick={() => q.refetch()}>
                تلاش دوباره
              </Button>
            </div>
          </div>
        </div>
      ) : x ? (
        <div className={`ai-xd ${q.isFetching ? "is-stale" : ""}`}>
          {x.points.length ? (
            <section aria-label="نکته‌های اصلی" className="ai-well">
              <h3 className="ai-xd-t">نکته‌های اصلی</h3>
              <ul className="ai-xd-pts">
                {x.points.map((p) => (
                  <li key={p}>
                    <i className="sf-nuqta" aria-hidden />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {x.narrative ? <Narrative text={x.narrative} /> : null}
          {x.warnings.length ? (
            <ul className="ai-review-w">
              {x.warnings.map((w) => (
                <li key={w}>
                  <i className="sf-nuqta" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {x.questions.length ? (
            <section aria-label="پرسش‌های بعدی">
              <h3 className="ai-xd-t">بپرسید</h3>
              <div className="ai-xd-qs">
                {x.questions.slice(0, 5).map((qq) => (
                  <button key={qq} type="button" className="ai-xd-q sf-press" onClick={() => ask(qq)}>
                    <span>{qq}</span>
                    <ArrowUpLeft size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <p className="ai-xd-f">
            {x.source === "ai" ? (
              <>
                نوشتهٔ هوش مصنوعی از روی همین گزارش{x.model ? <> با <span className="ai-model">{x.model}</span></> : null}؛ عددها با گزارش سنجیده شده‌اند. پیش از تصمیم، خود گزارش را ببینید.
              </>
            ) : (
              // why the model's text was not used (not set up, numbers did not match the report …), from the server
              `خلاصهٔ خودکار از عددهای همین گزارش${x.note ? `؛ ${x.note.replace(/[.؛]+$/, "")}` : ""}.`
            )}
          </p>
        </div>
      ) : null}
    </Drawer>
  );
}
