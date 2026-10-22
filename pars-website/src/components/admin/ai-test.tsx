"use client";

import type { AiTest } from "@/app/actions/admin";
import { AI_ERROR_HINT } from "@/lib/ai-errors";

const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

/** The connection test's outcome: the answer (or the error) and what each model in the chain did. */
export function AiTestReport({ test }: { test: AiTest }) {
  return (
    <div className={`space-y-3 rounded-2xl border p-4 text-sm leading-7 ${test.success ? "border-success/30 bg-success/[0.06]" : "border-danger/30 bg-danger/[0.06]"}`}>
      {test.success ? (
        <>
          <div className="text-xs text-success">
            ✓ اتصال برقرار است · <span className="ltr">{test.model}</span> · {fa(test.ms)} میلی‌ثانیه
          </div>
          <p>{test.answer}</p>
        </>
      ) : (
        <p className="text-danger">✕ {test.error}</p>
      )}
      {test.attempts.length > 0 && (
        <ol className="space-y-1.5 border-t border-line pt-3 text-xs">
          {test.attempts.map((a, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <span className={a.ok ? "text-success" : a.kind === "skipped" ? "text-faint" : "text-danger"}>{a.ok ? "✓" : a.kind === "skipped" ? "–" : "✕"}</span>
              <span className="ltr font-mono text-fg/90">{a.model}</span>
              {a.ms > 0 && <span className="text-faint">{fa(a.ms)} میلی‌ثانیه</span>}
              {!a.ok && <span className="text-muted">{AI_ERROR_HINT[a.kind ?? "other"] ?? AI_ERROR_HINT.other}</span>}
              {!a.ok && a.message && (
                <span className="ltr block w-full break-words text-faint" dir="ltr">
                  {a.status ? `${a.status} · ` : ""}
                  {a.message}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
