"use client";

import { useEffect, useState, useTransition } from "react";
import type { Result } from "@/lib/action";

type Toast = { id: number; ok: boolean; text: string };

export function toast(ok: boolean, text: string) {
  window.dispatchEvent(new CustomEvent("celin:toast", { detail: { ok, text } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { ok, text } = (e as CustomEvent<{ ok: boolean; text: string }>).detail;
      const id = ++n;
      setItems((x) => [...x, { id, ok, text }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), ok ? 3200 : 7000);
    };
    window.addEventListener("celin:toast", on);
    return () => window.removeEventListener("celin:toast", on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex max-w-lg animate-fade-in items-start gap-2.5 border bg-white px-5 py-3 text-sm shadow-[0_10px_40px_rgb(20_17_15/0.14)] ${t.ok ? "border-line" : "border-danger/40"}`}>
          <span className={`mt-1 size-1.5 shrink-0 rounded-full ${t.ok ? "bg-success" : "bg-danger"}`} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Runs a Server Action with pending state and a toast. */
export function useAction() {
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<Result<T>>, opts: { silent?: boolean; onOk?: (r: Result<T> & { ok: true }) => void; onError?: (error: string) => void } = {}) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          if (!opts.silent) toast(true, r.message ?? "انجام شد.");
          opts.onOk?.(r);
        } else {
          toast(false, r.error);
          opts.onError?.(r.error);
        }
      } catch (e) {
        const msg = e instanceof Error && e.message ? "ارتباط با سرور برقرار نشد؛ دوباره امتحان کنید." : "خطا";
        toast(false, msg);
        opts.onError?.(msg);
      }
    });
  return { pending, run };
}
