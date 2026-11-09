// Suggestions while a record is being created (catalogue AI-041; docs/spec/AI.md §13.6): as the person types the title
// and description, the organisation's classifiers suggest the category, group, priority or service with their
// confidence and «چرا؟»; «اعمال» fills the field in the form (nothing is saved until the person saves).
import { useEffect, useMemo, useState } from "react";
import { Button } from "antd";
import { Check, Sparkles } from "lucide-react";
import type { MlPrediction } from "@shared/ai/ml";
import { useOrg } from "../../lib/org";
import { ICON14 } from "../../components/blocks";
import type { DraftContext } from "../../records";
import { mlApi } from "./api";
import { pctFa, scoreWords } from "./model";
import { ScoreBar, WhyPopover } from "./PredictionsPanel";
import "./ml.css";

/** The text of a draft that the models read (its string fields), to decide when to ask again. */
function draftText(values: Record<string, unknown>): string {
  return Object.values(values)
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .trim();
}

export default function DraftAssist({ c }: { c: DraftContext }) {
  const { api } = useOrg();
  const [preds, setPreds] = useState<MlPrediction[]>([]);
  const text = useMemo(() => draftText(c.values), [c.values]);
  const inputs = JSON.stringify(c.values);
  useEffect(() => {
    if (text.length < 12) {
      setPreds([]);
      return;
    }
    const ctl = { live: true };
    const t = setTimeout(() => {
      mlApi
        .draft(api, c.table, JSON.parse(inputs) as Record<string, unknown>)
        .then((r) => ctl.live && setPreds(r.predictions.filter((p) => p.confident && p.field && c.editable(p.field) && p.value !== p.current)))
        .catch(() => ctl.live && setPreds([]));
    }, 700);
    return () => {
      ctl.live = false;
      clearTimeout(t);
    };
    // the draft's text and inputs decide (the context object itself changes on every render)
  }, [api, c.table, inputs, text.length]);
  if (!preds.length) return null;
  return (
    <section className="ml-draft" aria-label="پیشنهاد هوشمند">
      <h3 className="ml-draft-title">
        <Sparkles {...ICON14} aria-hidden /> پیشنهاد از روی متن
      </h3>
      {preds.map((p) => {
        const words = scoreWords(p);
        return (
          <div key={p.model} className="ml-draft-row">
            <span className="ml-field">{p.field_label}</span>
            <span>{p.value_label}</span>
            <ScoreBar score={p.score} tone={words.key} />
            <span className="ds-num ml-score">{pctFa(p.score)}</span>
            <WhyPopover p={p} />
            <Button size="small" icon={<Check {...ICON14} />} onClick={() => c.setValue(p.field!, p.value)}>
              اعمال
            </Button>
          </div>
        );
      })}
    </section>
  );
}
