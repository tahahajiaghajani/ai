// The small kit for values filled by AI (from an image or a proposal): a confidence ring with the reason on hover
// (<AiMark>), the marks' state (useAiMarks: set from a result, cleared as the person edits each value), the review bar
// above the form («بازبینی …») and the confidence chip. Colours follow BC's review bar: a quiet dashed ring when the
// model is sure, warning when it is not, danger when it barely read the value.
import "./ai.css";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { ChevronDown } from "lucide-react";
import { AiIcon } from "../../components/shell/icons";
import { pct } from "../../lib/fa";
import { CONFIDENCE_LABEL, confidenceLevel } from "./model";

export interface AiMarkValue {
  /** 0…1 */
  confidence: number;
  /** why the model is (not) sure, in Persian */
  note?: string | null;
  /** what filled it: an image or the assistant */
  source?: "capture" | "assistant";
}

const SOURCE_LABEL = { capture: "خوانده‌شده از تصویر", assistant: "پیشنهاد دستیار" } as const;

export function ConfidenceChip({ value }: { value: number }) {
  const level = confidenceLevel(value);
  return (
    <span className="ai-conf" data-level={level} title={CONFIDENCE_LABEL[level]}>
      <i aria-hidden />
      {pct(Math.max(0, Math.min(1, value)), 0)}
    </span>
  );
}

function MarkTip({ mark }: { mark: AiMarkValue }) {
  const level = confidenceLevel(mark.confidence);
  return (
    <span className="ai-tip">
      <b>
        {SOURCE_LABEL[mark.source ?? "capture"]}، {CONFIDENCE_LABEL[level]} ({pct(Math.max(0, Math.min(1, mark.confidence)), 0)})
      </b>
      {mark.note ? <span>{mark.note}</span> : null}
      <span>با ویرایش این مقدار، نشان برداشته می‌شود.</span>
    </span>
  );
}

/** Wraps a control that AI filled. Without a mark it renders the control as it is. */
export function AiMark({ mark, children, className }: { mark?: AiMarkValue | null; children: ReactNode; className?: string }) {
  if (!mark) return className ? <div className={className}>{children}</div> : <>{children}</>;
  const level = confidenceLevel(mark.confidence);
  return (
    <div className={`ai-mark ${className ?? ""}`} data-level={level}>
      {children}
      <Tooltip title={<MarkTip mark={mark} />}>
        <span className="ai-mark-b" role="img" aria-label={`${SOURCE_LABEL[mark.source ?? "capture"]}، ${CONFIDENCE_LABEL[level]}`} tabIndex={0}>
          <AiIcon size={11} strokeWidth={1.6} absoluteStrokeWidth aria-hidden />
        </span>
      </Tooltip>
    </div>
  );
}

export interface ReviewEntry {
  key: string;
  label: string;
  value: ReactNode;
  mark: AiMarkValue;
}

/** State of the marks of one form: set them from a result, clear one as it is edited, or all once reviewed. */
export function useAiMarks<K extends string = string>() {
  const [marks, setMarks] = useState<Partial<Record<K, AiMarkValue>>>({});
  const set = useCallback((next: Partial<Record<K, AiMarkValue>>) => setMarks(next), []);
  const clear = useCallback(
    (key: K) =>
      setMarks((m) => {
        if (!(key in m)) return m;
        const next = { ...m };
        delete next[key];
        return next;
      }),
    [],
  );
  const clearAll = useCallback(() => setMarks({}), []);
  const get = useCallback((key: K) => marks[key] ?? null, [marks]);
  const count = Object.keys(marks).length;
  return useMemo(() => ({ marks, set, clear, clearAll, get, count }), [marks, set, clear, clearAll, get, count]);
}

/**
 * «بازبینی پیشنهادهای هوش مصنوعی (N)»: what was filled, how sure the model is, and the checks that failed. «بازبینی شد»
 * clears the marks (the values stay). Renders nothing once there is nothing left to review.
 */
export function AiReviewBar({
  entries,
  warnings,
  source = "capture",
  onDone,
  extra,
}: {
  entries: ReviewEntry[];
  warnings?: string[];
  source?: "capture" | "assistant";
  onDone: () => void;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const warn = (warnings ?? []).filter(Boolean);
  if (!entries.length && !warn.length) return null;
  const unsure = entries.filter((e) => confidenceLevel(e.mark.confidence) !== "high").length;
  return (
    <section className="ai-review no-print" aria-label="بازبینی مقدارهای پرشده با هوش مصنوعی">
      <div className="ai-review-h">
        <AiIcon size={16} strokeWidth={1.4} absoluteStrokeWidth className="ai-spark" aria-hidden />
        <b>{source === "capture" ? "خوانده‌شده از تصویر" : "پیشنهاد دستیار"}</b>
        <span>
          {entries.length ? `${new Intl.NumberFormat("fa-IR").format(entries.length)} مقدار پر شد` : "مقداری پر نشد"}
          {unsure ? `، ${new Intl.NumberFormat("fa-IR").format(unsure)} مورد نیاز به بررسی دارد` : ""}. پیش از ثبت، با اصل سند مقایسه کنید.
        </span>
        <span className="ai-review-x">
          {entries.length ? (
            <Button size="small" type="text" onClick={() => setOpen((o) => !o)} aria-expanded={open} icon={<ChevronDown size={14} strokeWidth={1.4} absoluteStrokeWidth style={{ transform: open ? "rotate(180deg)" : undefined }} aria-hidden />}>
              {open ? "بستن" : "جزئیات"}
            </Button>
          ) : null}
          {extra}
          <Button size="small" onClick={onDone}>
            بازبینی شد
          </Button>
        </span>
      </div>
      {warn.length ? (
        <ul className="ai-review-w">
          {warn.map((w) => (
            <li key={w}>
              <i className="sf-nuqta" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open && entries.length ? (
        <ul className="ai-review-l">
          {entries.map((e) => (
            <li key={e.key}>
              <span className="k">{e.label}</span>
              <span className="v">{e.value}</span>
              <ConfidenceChip value={e.mark.confidence} />
              {e.mark.note ? <span className="n">{e.mark.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
