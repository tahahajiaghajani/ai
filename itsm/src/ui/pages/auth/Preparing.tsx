import { useEffect, useState } from "react";
import { Button, Progress } from "antd";
import { DatabaseZap, TriangleAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthLayout } from "./AuthLayout";
import { FormAlert, ICON } from "../kit";
import { fa } from "../../lib/fa";
import type { ApiError } from "../../lib/api";

interface Schema {
  done: number;
  total: number;
  percent: number;
  next: string | null;
  auto: boolean;
  error: string | null;
}

/**
 * «آماده‌سازی پایگاه داده»: shown instead of the app while the web version prepares its database (src/server/cloud.ts
 * answers 503 `migrating` until every step is done), or cannot reach it. It asks /api/health every few seconds — each
 * ask lets the server continue — and opens the app once the schema is current.
 */
export function Preparing({ error }: { error: ApiError }) {
  const qc = useQueryClient();
  const [state, setState] = useState<{ code: string; message: string; schema: Schema | null }>({
    code: error.code,
    message: error.message,
    schema: (error.details as Schema | null) ?? null,
  });
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (stop) return;
        if (res.ok && data?.ok) {
          await qc.invalidateQueries();
          return;
        }
        if (data?.error) setState({ code: data.error.code, message: data.error.message, schema: data.schema ?? data.error.details ?? null });
      } catch {
        /* the next ask tries again */
      }
      if (!stop) timer = window.setTimeout(poll, 3000);
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [qc]);

  const s = state.schema;
  const migrating = state.code === "migrating";
  return (
    <AuthLayout title={migrating ? "آماده‌سازی پایگاه داده" : "سرور آماده نیست"} subtitle={migrating ? "نخستین اجرا یا به‌روزرسانی؛ این صفحه خودش ادامه می‌دهد." : undefined}>
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        {migrating && s && s.total > 0 ? (
          <>
            <Progress percent={s.percent} status={s.error ? "exception" : "active"} format={(p) => `${fa(p ?? 0)}٪`} />
            <div className="flex items-center gap-2 text-[var(--ds-text-2)]">
              <DatabaseZap {...ICON} aria-hidden />
              <span>
                {fa(s.done)} از {fa(s.total)} مرحله{s.next ? ` — ${s.next}` : ""}
              </span>
            </div>
          </>
        ) : null}
        {!migrating || s?.error || (s && !s.auto) ? (
          <FormAlert tone={migrating && !s?.error ? "warning" : "danger"}>
            <span className="inline-flex items-start gap-2">
              <TriangleAlert {...ICON} aria-hidden />
              <span>{s?.error ?? state.message}</span>
            </span>
          </FormAlert>
        ) : null}
        <Button onClick={() => void qc.invalidateQueries()}>دوباره بررسی کن</Button>
      </div>
    </AuthLayout>
  );
}
