// One insight card (catalogue AI-113): its title and severity in words, the numbers computed by code, what moved most,
// and the narrative — rule-based, or a model's (labelled) written from these numbers only. «شرح با هوش مصنوعی» asks a
// model for the narrative on request.
import { useState } from "react";
import { Button, Tag } from "antd";
import { Sparkles, TriangleAlert } from "lucide-react";
import { SEVERITY_LABELS, type InsightView } from "@shared/ai/insights";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { insightsApi } from "../ml/api";
import { NUMBER_LABELS, numberText } from "./model";
import "./insights.css";

const TONE: Record<InsightView["severity"], string> = { info: "default", notice: "processing", warning: "warning", critical: "error" };

export function InsightCard({ v, compact }: { v: InsightView; compact?: boolean }) {
  const { api } = useOrg();
  const n = useNotify();
  const [text, setText] = useState(v.narrative);
  const [ai, setAi] = useState(v.narrative_ai);
  const [busy, setBusy] = useState(false);
  const narrate = async () => {
    setBusy(true);
    try {
      const r = await insightsApi.narrate(api, v.id);
      setText(r.text || text);
      setAi(r.ai);
      if (!r.ai) n.ok("مدل هوش مصنوعی در دسترس نبود؛ شرح با قاعده ماند");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const numbers = Object.entries(v.numbers).filter(([k, x]) => x !== null && NUMBER_LABELS[k]);
  return (
    <article className={`in-card is-${v.severity}${compact ? " is-compact" : ""}`} aria-label={v.title}>
      <header className="in-head">
        <span className="in-kind">
          {v.table_label} · {v.kind_label}
        </span>
        <span className="in-tags">
          {v.anomaly ? (
            <Tag color="error" icon={<TriangleAlert {...ICON14} />}>
              ناهنجاری
            </Tag>
          ) : null}
          {v.severity !== "info" ? <Tag color={TONE[v.severity]}>{SEVERITY_LABELS[v.severity]}</Tag> : null}
        </span>
      </header>
      <h3 className="in-title">{v.title}</h3>
      {!compact && numbers.length ? (
        <dl className="in-numbers">
          {numbers.map(([k, x]) => (
            <div key={k}>
              <dt>{NUMBER_LABELS[k]}</dt>
              <dd className="ds-num">{numberText(k, x)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!compact && v.drivers.length ? (
        <ul className="in-drivers" aria-label="بیشترین تغییر">
          {v.drivers.map((d) => (
            <li key={d.key}>
              <span>{d.label}</span>
              <span className="ds-num">{faDigits(d.current)}</span>
              {d.delta !== null ? <span className={`ds-num ds-ltr ${d.delta > 0 ? "in-up" : "in-down"}`}>{d.delta > 0 ? `+${faDigits(d.delta)}` : `−${faDigits(Math.abs(d.delta))}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {text ? (
        <p className="in-text">
          {ai ? <Sparkles {...ICON14} aria-label="نوشتهٔ هوش مصنوعی" /> : null} {text}
        </p>
      ) : null}
      {ai ? <p className="in-label">شرح با هوش مصنوعی از همین عددها؛ عددها را کد حساب کرده است.</p> : null}
      {!compact && !ai ? (
        <Button size="small" type="text" icon={<Sparkles {...ICON14} />} loading={busy} onClick={() => void narrate()}>
          شرح با هوش مصنوعی
        </Button>
      ) : null}
      <footer className="in-period">{v.period_label}</footer>
    </article>
  );
}
