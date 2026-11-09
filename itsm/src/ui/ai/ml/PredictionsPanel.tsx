// «پیش‌بینی هوشمند» on a record page (docs/spec/AI.md §13.6): the suggestions of the organisation's classical models for
// the fields the viewer sees, the probabilities of risk models (SLA breach, change failure) with their drivers, and a
// likely duplicate the viewer can read — each with its confidence in words and «چرا؟». Applying writes the field with
// the viewer's own access. Nothing here calls a language model.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Popover, Tag } from "antd";
import { Check, CircleHelp, Copy, Gauge, Sparkles, X } from "lucide-react";
import type { MlPrediction } from "@shared/ai/ml";
import { PREDICTION_STATUS_LABELS } from "@shared/ai/ml";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { Skeleton } from "../../components/display";
import { recordPath, type RecordContext } from "../../records";
import { ML_KEYS, mlApi } from "./api";
import { pctFa, reasonsOf, scoreWords, visiblePredictions } from "./model";
import "./ml.css";

export function ScoreBar({ score, tone }: { score: number; tone: "high" | "medium" | "low" }) {
  return (
    <span className={`ml-bar is-${tone}`} role="img" aria-label={pctFa(score)}>
      <span style={{ inlineSize: `${Math.max(2, Math.min(100, score * 100))}%` }} />
    </span>
  );
}

export function WhyPopover({ p }: { p: MlPrediction }) {
  const reasons = reasonsOf(p);
  const q = p.quality;
  const content = (
    <div className="ml-why">
      {reasons.length ? (
        <ul>
          {reasons.map((r, i) => (
            <li key={i}>
              <span className={r.weight > 0 ? "ml-plus" : "ml-minus"} aria-hidden>
                {r.weight > 0 ? "+" : "−"}
              </span>
              <span>{r.label}</span>
              <span className="ml-muted">{r.direction}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ml-muted">نشانهٔ برجسته‌ای در متن نبود.</p>
      )}
      <p className="ml-muted">
        مدل آماری این سازمان، نسخهٔ {faDigits(p.model_version)}
        {p.trained_at ? `، آموزش ${formatJalali(p.trained_at.slice(0, 10))}` : ""}
        {q?.accuracy !== undefined && q?.accuracy !== null ? `؛ دقت روی نمونهٔ آزمون ${pctFa(q.accuracy)}` : ""}
        {q?.auc !== undefined && q?.auc !== null ? `؛ AUC ${faDigits(q.auc)}` : ""}
      </p>
    </div>
  );
  return (
    <Popover content={content} title="چرا؟" trigger="click" placement="bottomLeft">
      <Button size="small" type="text" icon={<CircleHelp {...ICON14} />} aria-label="چرا این پیش‌بینی؟">
        چرا؟
      </Button>
    </Popover>
  );
}

function Suggestion({ p, ctx, onDone }: { p: MlPrediction; ctx: RecordContext; onDone: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const words = scoreWords(p);
  const apply = async (value: string) => {
    setBusy(value);
    try {
      if (p.id) await mlApi.apply(api, p.id, value, typeof ctx.row.version === "number" ? ctx.row.version : undefined);
      else if (!(await ctx.save({ [p.field!]: value }))) return;
      n.ok(`«${p.field_label}» ثبت شد`);
      ctx.refresh();
      onDone();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const dismiss = async () => {
    if (!p.id) return;
    try {
      await mlApi.dismiss(api, p.id);
      onDone();
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <div className="ml-item">
      <div className="ml-head">
        <span className="ml-field">{p.field_label}</span>
        <WhyPopover p={p} />
      </div>
      <div className="ml-value">
        <span>{p.value_label}</span>
        <ScoreBar score={p.score} tone={words.key} />
        <span className="ml-score ds-num">{pctFa(p.score)}</span>
        <span className="ml-muted">{words.label}</span>
      </div>
      {p.current_label ? <div className="ml-muted">اکنون: {p.current_label}</div> : null}
      {p.alternatives.length > 1 ? (
        <div className="ml-alts" aria-label="گزینه‌های دیگر">
          {p.alternatives.slice(1).map((a) => (
            <button key={a.value} type="button" className="ml-alt" disabled={!p.can_apply || !!busy} onClick={() => void apply(a.value)}>
              {a.label} <span className="ds-num">{pctFa(a.score)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {p.status !== "open" ? <Tag>{PREDICTION_STATUS_LABELS[p.status]}</Tag> : null}
      {p.can_apply ? (
        <div className="ml-actions">
          <Button size="small" type="primary" icon={<Check {...ICON14} />} loading={busy === p.value} onClick={() => void apply(p.value!)}>
            اعمال
          </Button>
          {p.id ? (
            <Button size="small" icon={<X {...ICON14} />} onClick={() => void dismiss()}>
              نه
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Risk({ p }: { p: MlPrediction }) {
  const words = scoreWords(p);
  return (
    <div className="ml-item">
      <div className="ml-head">
        <span className="ml-field inline-flex items-center gap-1">
          <Gauge {...ICON14} aria-hidden />
          {p.field_label ?? p.name}
        </span>
        <WhyPopover p={p} />
      </div>
      <div className="ml-value">
        <ScoreBar score={p.score} tone={words.key} />
        <span className="ml-score ds-num">{pctFa(p.score)}</span>
        <span className={words.key === "high" ? "ml-risk-high" : "ml-muted"}>{words.label}</span>
      </div>
      {p.alternatives.length > 1 ? (
        <ul className="ml-parts">
          {p.alternatives.map((a) => (
            <li key={a.value}>
              {a.label || "توافق"} <span className="ds-num">{pctFa(a.score)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Duplicate({ p, table }: { p: MlPrediction; table: string }) {
  const { orgId } = useOrg();
  return (
    <div className="ml-item">
      <div className="ml-head">
        <span className="ml-field inline-flex items-center gap-1">
          <Copy {...ICON14} aria-hidden />
          شاید تکراری باشد
        </span>
      </div>
      {[{ value: p.value!, label: p.value_label!, score: p.score }, ...p.alternatives.filter((a) => a.value !== p.value)].slice(0, 3).map((a) => (
        <div key={a.value} className="ml-value">
          <Link className="ds-link" to={`/${orgId}/${recordPath(table, a.value)}`}>
            {a.label}
          </Link>
          <span className="ml-muted ds-num">{pctFa(a.score)} شباهت</span>
        </div>
      ))}
    </div>
  );
}

/** The side panel (registered for every task table; shown when the record meta says `ai_predictions`). */
export default function PredictionsPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: ML_KEYS.record(orgId, ctx.table, id), queryFn: () => mlApi.record(api, ctx.table, id), staleTime: 30_000 });
  if (q.isLoading) return <Skeleton rows={2} />;
  if (q.error || !q.data) return null;
  const shown = visiblePredictions(q.data.predictions, all);
  const more = visiblePredictions(q.data.predictions, true).length - shown.length;
  const refresh = () => void qc.invalidateQueries({ queryKey: ML_KEYS.record(orgId, ctx.table, id) });
  return (
    <div className="ml-panel">
      {shown.length ? (
        shown.map((p) =>
          p.kind === "classifier" ? <Suggestion key={p.model} p={p} ctx={ctx} onDone={refresh} /> : p.kind === "risk" ? <Risk key={p.model} p={p} /> : <Duplicate key={p.model} p={p} table={ctx.table} />,
        )
      ) : (
        <p className="ml-muted">{q.data.note ?? "پیشنهادی برای این رکورد نیست."}</p>
      )}
      {more > 0 ? (
        <Button size="small" type="link" onClick={() => setAll(true)}>
          {faDigits(more)} پیشنهاد با اطمینان کم
        </Button>
      ) : null}
      <p className="ml-label">
        <Sparkles {...ICON14} aria-hidden /> مدل‌های آماری همین سازمان؛ پیش از اعمال بازبینی کنید.
      </p>
    </div>
  );
}
