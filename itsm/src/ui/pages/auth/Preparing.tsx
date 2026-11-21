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

/** What the page shows of the server's answer. */
export interface PreparingState {
  code: string;
  message: string;
  schema: Schema | null;
}

/** The parts of /api/health's answer the page reads. */
interface HealthAnswer {
  ok?: boolean;
  schema?: Schema | null;
  error?: { code: string; message: string; details?: unknown };
}

/**
 * Asks /api/health every few seconds while the page is up (each ask lets the server continue its steps). A healthy answer
 * makes the session ask again (`invalidate`), and the asks go on: the page goes away only when the session's own answers
 * come — a database still too busy for /auth/me keeps it up, and the next ask tries again. Returns the stop.
 */
export function pollHealth(o: {
  ask: () => Promise<{ ok: boolean; data: HealthAnswer | null }>;
  invalidate: () => Promise<unknown>;
  onState: (s: PreparingState) => void;
}): () => void {
  let stop = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const { ok, data } = await o.ask();
      if (stop) return;
      if (ok && data?.ok) await o.invalidate();
      else if (data?.error) o.onState({ code: data.error.code, message: data.error.message, schema: data.schema ?? (data.error.details as Schema | null | undefined) ?? null });
    } catch {
      /* the next ask tries again */
    }
    if (!stop) timer = setTimeout(poll, 3000);
  };
  timer = setTimeout(poll, 1500);
  return () => {
    stop = true;
    clearTimeout(timer);
  };
}

/**
 * «آماده‌سازی پایگاه داده»: shown instead of the app while the web version prepares its database (src/server/cloud.ts
 * answers 503 `migrating` until every step is done), or cannot reach it. It asks /api/health every few seconds — each
 * ask lets the server continue — and opens the app once the session answers again.
 */
export function Preparing({ error }: { error: ApiError }) {
  const qc = useQueryClient();
  const [state, setState] = useState<PreparingState>({
    code: error.code,
    message: error.message,
    schema: (error.details as Schema | null) ?? null,
  });
  // the session's latest answer (another «not ready» after a new ask) is what the page says
  useEffect(() => setState({ code: error.code, message: error.message, schema: (error.details as Schema | null) ?? null }), [error]);
  useEffect(
    () =>
      pollHealth({
        ask: async () => {
          const res = await fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
          return { ok: res.ok, data: (await res.json().catch(() => null)) as HealthAnswer | null };
        },
        invalidate: () => qc.invalidateQueries(),
        onState: setState,
      }),
    [qc],
  );

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
