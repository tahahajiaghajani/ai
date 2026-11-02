// «آزمایش اتصال»: one row per model of the chain — passed or not, how long it took, the model's short Persian reply or
// the reason in Persian, and the provider's own message (LTR) so a support person can read it as is.
import { CircleCheck, CircleX } from "lucide-react";
import type { AiTestReport } from "@shared/ai/types";
import { fa } from "../../lib/fa";
import { ERROR_HELP, duration } from "../kit/model";

export function TestReport({ report }: { report: AiTestReport }) {
  const ok = report.models.filter((m) => m.ok).length;
  return (
    <div className="ai-test" role="status">
      <div className="ai-test-h">
        {report.ok ? (
          <b className="is-ok">
            <CircleCheck size={16} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
            اتصال برقرار است
          </b>
        ) : (
          <b className="is-bad">
            <CircleX size={16} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
            اتصال برقرار نشد
          </b>
        )}
        <span>
          {report.models.length ? `${fa(ok)} از ${fa(report.models.length)} مدل پاسخ داد` : "مدلی برای آزمایش انتخاب نشده"}
          {report.ms ? `، ${duration(report.ms)}` : ""}
          {report.route === "via_cloud" ? "، از راه نسخهٔ وب" : ""}
        </span>
        {report.available_models?.length ? <span className="ai-src">{fa(report.available_models.length)} مدل در فهرست سرویس</span> : null}
      </div>
      {report.models.length ? (
        <table className="ai-test-t">
          <thead>
            <tr>
              <th className="c-ok">
                <span className="sf-sr">نتیجه</span>
              </th>
              <th className="c-m">مدل</th>
              <th className="c-ms">زمان</th>
              <th className="c-r">پاسخ یا دلیل</th>
            </tr>
          </thead>
          <tbody>
            {report.models.map((m, i) => (
              <tr key={`${m.model}-${i}`}>
                <td className="c-ok">
                  {m.ok ? (
                    <CircleCheck size={16} strokeWidth={1.4} absoluteStrokeWidth className="is-ok" aria-label="پاسخ داد" />
                  ) : (
                    <CircleX size={16} strokeWidth={1.4} absoluteStrokeWidth className="is-bad" aria-label="پاسخ نداد" />
                  )}
                </td>
                <td className="c-m">
                  <span className="ai-mid">{m.model}</span>
                </td>
                <td className="c-ms">{m.ms ? duration(m.ms) : <span className="sf-zero">—</span>}</td>
                <td className="c-r">
                  {m.ok ? (
                    <span>{m.reply?.trim() ? `«${m.reply.trim()}»` : "پاسخ داد"}</span>
                  ) : (
                    <>
                      <b>{m.kind ? ERROR_HELP[m.kind].title : "پاسخ نداد"}</b>
                      <div>{m.message_fa || (m.kind ? ERROR_HELP[m.kind].remedy : "")}</div>
                      {m.provider_message ? <span className="ai-raw">{m.provider_message}</span> : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
