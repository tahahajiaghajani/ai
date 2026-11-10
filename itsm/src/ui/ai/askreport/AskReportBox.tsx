// «پرسش تحلیلی» (catalogue AI-111/112, ANA-023): a question → a checked report definition → the numbers computed by the
// report engine with the asker's own access. The answer card shows how the question was read (chips), the chart and
// table, a narrative of the computed numbers, and «باز کردن به‌صورت گزارش» (saved as the asker's report) or the
// designer; a refusal says why in Persian; without a model a guided start and example questions.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Input } from "antd";
import { FileBarChart, MessageSquareText, PencilRuler, Sparkles } from "lucide-react";
import type { AskReportResult } from "@shared/ai/ml";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { Card, ICON14, Note } from "../../components/blocks";
import { Loader } from "../../components/display";
import { ResultCard } from "../../modules/analytics/parts";
import { mlApi } from "../ml/api";
import "../ml/ml.css";

const MODE_LABEL: Record<AskReportResult["mode"], string> = { ai: "خوانش با هوش مصنوعی", rules: "خوانش با قاعده (بی‌مدل)", guided: "راهنمای ساخت گزارش" };

export function AskAnswer({ a }: { a: AskReportResult }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const nav = useNavigate();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!a.spec) return;
    setSaving(true);
    try {
      const r = await mlApi.saveAsk(api, a.spec, a.title, a.question);
      nav(`/${orgId}/${r.path}`);
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card
      title={a.spec ? a.title : "پاسخ"}
      meta={
        <span className="ml-muted inline-flex items-center gap-1">
          {a.mode === "ai" ? <Sparkles {...ICON14} aria-hidden /> : null}
          {MODE_LABEL[a.mode]}
        </span>
      }
      tools={
        <div className="flex flex-wrap gap-1">
          {a.spec && a.can_save ? (
            <Button size="small" type="primary" icon={<FileBarChart {...ICON14} />} loading={saving} onClick={() => void save()}>
              باز کردن به‌صورت گزارش
            </Button>
          ) : null}
          {a.designer_path ? (
            <Button size="small" icon={<PencilRuler {...ICON14} />} onClick={() => nav(`/${orgId}/${a.designer_path}`)}>
              {a.spec ? "باز کردن در طراح" : "ساختن در طراح گزارش"}
            </Button>
          ) : null}
        </div>
      }
    >
      {a.chips.length ? (
        <div className="ml-chips" aria-label="برداشت از پرسش">
          {a.chips.map((c, i) => (
            <span key={i} className={`ml-chip is-${c.kind}`}>
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
      {a.refusal ? <Note tone="warning">{a.refusal}</Note> : null}
      {a.spec && a.result ? <ResultCard spec={a.spec} result={a.result} height={300} title={a.title} /> : null}
      {a.narrative ? (
        <p className="ml-narrative">
          {a.narrative.ai ? <Sparkles {...ICON14} aria-label="نوشتهٔ هوش مصنوعی" /> : null} {a.narrative.text}
        </p>
      ) : null}
      {a.suggestions.length ? (
        <div className="ml-suggest" aria-label="نمونه‌ها">
          {a.suggestions.map((s) => (
            <span key={s} className="ml-chip">
              {s}
            </span>
          ))}
        </div>
      ) : null}
      <p className="ml-label">عددها را موتور گزارش با دسترسی خود شما حساب کرده است، نه مدل.</p>
    </Card>
  );
}

/** The box: a question field and its answer (dashboards, the page, the palette's link). */
export default function AskReportBox({ initial, compact }: { initial?: string; compact?: boolean }) {
  const { api } = useOrg();
  const n = useNotify();
  const [question, setQuestion] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AskReportResult | null>(null);
  const ask = async (text: string) => {
    const t = text.trim();
    if (t.length < 2) return;
    setQuestion(t);
    setBusy(true);
    try {
      setAnswer(await mlApi.ask(api, t));
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // the question of a link (?q=) is asked once, when the page opens with it
    if (initial && initial.trim().length >= 2) void ask(initial);
  }, [initial]);
  return (
    <div className={compact ? "ml-ask is-compact" : "ml-ask"}>
      <Input.Search
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onSearch={(v) => void ask(v)}
        placeholder="پرسش تحلیلی؛ مثلاً «رخدادهای بحرانی این ماه به تفکیک گروه»"
        enterButton={
          <span className="inline-flex items-center gap-1">
            <MessageSquareText {...ICON14} />
            بپرس
          </span>
        }
        loading={busy}
        maxLength={500}
        aria-label="پرسش تحلیلی"
        size={compact ? "middle" : "large"}
      />
      {busy ? <Loader /> : null}
      {answer && !busy ? <AskAnswer a={answer} /> : null}
    </div>
  );
}
