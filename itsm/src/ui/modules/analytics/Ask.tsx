// «پرسش از داده‌ها» (catalogue ANA-023): a Persian question («رخدادهای بحرانی سه ماه اول ۱۴۰۵ به تفکیک گروه») becomes
// a report definition — by the AI layer when it is set up, else by the rule-based parser — shown as chips the person
// can check, run with their own access and drawn like any report; «باز کردن در طراح» continues it as a report.
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Input } from "antd";
import { MessageSquareText, PencilRuler, Sparkles } from "lucide-react";
import type { AskResult } from "@shared/analytics/api";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { Card, ICON14, Note } from "../../components/blocks";
import { analyticsApi } from "./api";
import { ResultCard } from "./parts";
import "./analytics.css";

const EXAMPLES = [
  "تعداد رخدادهای باز به تفکیک اولویت",
  "میانگین زمان حل رخدادها ماهانه در ۶ ماه گذشته",
  "رخدادهای ثبت‌شده در روزهای هفته و ساعت‌های روز",
  "۱۰ دستهٔ پرتکرار رخدادها در ۹۰ روز گذشته",
  "تغییرهای اضطراری امسال به تفکیک ماه",
];

export default function Ask() {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const ask = async (text = question) => {
    if (text.trim().length < 2) return;
    setQuestion(text);
    setBusy(true);
    try {
      setAnswer(await analyticsApi.ask(api, text.trim()));
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="پرسش از داده‌ها" />
      <div className="an-ask">
        <Input.Search
          size="large"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onSearch={(v) => ask(v)}
          placeholder="بپرسید؛ مثلاً «میانگین زمان حل رخدادهای بحرانی ماه گذشته»"
          enterButton={<span className="inline-flex items-center gap-1"><MessageSquareText {...ICON14} />بپرس</span>}
          loading={busy}
          maxLength={500}
          aria-label="پرسش"
        />
        <div className="an-examples" aria-label="نمونه‌ها">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" className="an-example" onClick={() => ask(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      {busy ? <Loader /> : null}
      {answer && !busy ? (
        <Card
          title="پاسخ"
          meta={<span className="an-muted inline-flex items-center gap-1">{answer.ai ? <><Sparkles {...ICON14} aria-hidden />تفسیر با هوش مصنوعی</> : "تفسیر با قاعده"}</span>}
          tools={
            answer.spec ? (
              <Button size="small" icon={<PencilRuler {...ICON14} />} onClick={() => navigate(`/${orgId}/analytics/reports/new?spec=${encodeURIComponent(JSON.stringify(answer.spec))}&name=${encodeURIComponent(question)}`)}>
                باز کردن در طراح
              </Button>
            ) : null
          }
        >
          {answer.chips.length ? (
            <div className="an-chips" aria-label="برداشت از پرسش">
              {answer.chips.map((c, i) => (
                <span key={i} className={`an-chip is-${c.kind}`}>{c.label}</span>
              ))}
            </div>
          ) : null}
          {answer.problem ? <Note tone="warning">{answer.problem}</Note> : null}
          {answer.spec && answer.result ? <ResultCard spec={answer.spec} result={answer.result} height={340} title={question} /> : !answer.problem ? <EmptyState compact title="پاسخی ساخته نشد" /> : null}
          <p className="an-muted">عددها با دسترسی خود شما حساب شده‌اند؛ هر کس همین پرسش را بپرسد فقط رکوردهای مجاز خودش را می‌بیند.</p>
        </Card>
      ) : null}
    </div>
  );
}
