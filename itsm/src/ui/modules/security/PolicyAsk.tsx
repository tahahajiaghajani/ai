// «پرسش از خط‌مشی‌ها» (SEC-032, SEC-067; readers of the compliance area): a question answered from the published
// policies and standards the person reads (drafts never), with the cited passages linked to their policy. Without a
// model the rule-based answer quotes the matching sentences; every answer is labelled as AI or rule-made.
import { useState } from "react";
import { Link } from "react-router";
import { Button, Input } from "antd";
import { MessageCircleQuestionMark } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { RecordMarkdown, recordPath } from "../../records";
import { securityApi } from "./api";

export default function PolicyAsk() {
  const { api, orgId } = useOrg();
  const [text, setText] = useState("");
  const ask = useAction(() => securityApi.policyAsk(api, text.trim()));
  const a = ask.data;
  return (
    <div>
      <PageHeader title="پرسش از خط‌مشی‌ها" />
      <div className="flex max-w-3xl flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-2">
            <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="مثلاً: آیا استفاده از حافظهٔ USB شخصی مجاز است؟" aria-label="پرسش" onPressEnter={(e) => e.ctrlKey && text.trim() && ask.mutate(undefined)} />
            <Button type="primary" icon={<MessageCircleQuestionMark {...ICON14} />} className="self-start" disabled={!text.trim()} loading={ask.isPending} onClick={() => ask.mutate(undefined)}>
              پرسیدن
            </Button>
          </div>
        </Card>
        {a ? (
          <Card title="پاسخ" meta={a.label ? <span className="text-[12px] text-ink-3">{a.label}</span> : null}>
            <RecordMarkdown text={a.text ?? ""} />
            {a.citations.length ? (
              <ol className="mt-3 flex flex-col gap-1 text-[13px]">
                {a.citations.map((c) => (
                  <li key={`${c.n}-${c.id}`}>
                    [{c.n.toLocaleString("fa-IR")}]{" "}
                    <Link className="ds-link" to={`/${orgId}/${recordPath(c.table, c.id)}`}>
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ol>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
