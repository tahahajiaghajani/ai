// «خلاصهٔ امروز» on the dashboard: the day's facts (cash, cheques due, sales, what needs attention) and a short narrative —
// written by the business's model when AI is available, otherwise a plain template the server builds from the same facts.
// Each fact opens its page; «ادامه در دستیار» carries the day into a conversation.
import { useNavigate } from "react-router";
import { Button } from "antd";
import { Newspaper, Sparkles } from "lucide-react";
import { useOrg } from "../../lib/org";
import { jLong, jTime } from "../../lib/fa";
import { faDigits } from "@shared/format";
import { openAssistant } from "../assistant/bus";
import { Narrative } from "../kit/Narrative";
import { Card, Empty, HeadLink, Sk, SkRows } from "../../modules/dashboard/kit";
import { useAiBrief } from "../kit/hooks";
import type { AiBriefView } from "../kit/types";

const ASK = "خلاصهٔ امروز را با جزئیات بیشتر بگو: کدام کارها فوری است و از کجا شروع کنم؟";

function Facts({ facts }: { facts: AiBriefView["facts"] }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  if (!facts.length) return null;
  return (
    <div className="ai-brief-facts">
      {facts.slice(0, 6).map((f) => {
        const body = (
          <>
            <small title={f.label}>{f.label}</small>
            <b>{f.value}</b>
            {f.hint ? <span title={f.hint}>{faDigits(f.hint)}</span> : null}
          </>
        );
        return f.path ? (
          <button key={f.key} type="button" className="ai-fact sf-press" data-tone={f.tone ?? undefined} onClick={() => nav(`/${orgId}/${f.path!.replace(/^\/+/, "")}`)}>
            {body}
          </button>
        ) : (
          <div key={f.key} className="ai-fact" data-tone={f.tone ?? undefined}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function BriefCard() {
  const q = useAiBrief();
  const b = q.data;
  const at = b?.generated_at ? Date.parse(b.generated_at) : NaN;
  return (
    <Card
      title="خلاصهٔ امروز"
      caption={jLong(new Date())}
      label="خلاصهٔ امروز"
      end={
        b ? (
          <HeadLink icon={Sparkles} squeeze onClick={() => openAssistant({ prompt: ASK, send: true, context: { path: "", title: "پیشخوان" } })}>
            ادامه در دستیار
          </HeadLink>
        ) : null
      }
    >
      {q.isLoading ? (
        <div className="ai-brief" aria-busy="true">
          <div className="grid gap-2">
            <Sk h={12} />
            <Sk h={12} w="92%" />
            <Sk h={12} w="64%" />
          </div>
          <SkRows rows={2} cols={[0.4, 0.6, 0.4]} />
        </div>
      ) : q.error || !b ? (
        <Empty compact icon={Newspaper} title="خلاصهٔ امروز آماده نشد." action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
      ) : (
        <div className="ai-brief">
          {b.markdown ? <Narrative text={b.markdown} /> : null}
          <Facts facts={b.facts} />
          <div className="ai-brief-f">
            <span className="inline-flex items-center gap-1.5">
              {b.source === "ai" ? <Sparkles size={13} strokeWidth={1.4} absoluteStrokeWidth aria-hidden /> : null}
              {b.source === "ai" ? "نوشتهٔ هوش مصنوعی از روی داده‌های سیراف" : "خلاصهٔ خودکار از داده‌های سیراف"}
            </span>
            {Number.isFinite(at) ? <span className="sf-end">ساعت {jTime(at)}</span> : null}
          </div>
        </div>
      )}
    </Card>
  );
}
