"use client";

import { useEffect, useState, useTransition } from "react";
import type { AdminResult } from "@/app/actions/admin";

type Toast = { id: number; ok: boolean; text: string };

export function toast(ok: boolean, text: string) {
  window.dispatchEvent(new CustomEvent("pars:toast", { detail: { ok, text } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { ok, text } = (e as CustomEvent<{ ok: boolean; text: string }>).detail;
      const id = ++n;
      setItems((x) => [...x, { id, ok, text }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), ok ? 3200 : 6500);
    };
    window.addEventListener("pars:toast", on);
    return () => window.removeEventListener("pars:toast", on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div key={t.id} className={`pointer-events-auto max-w-lg animate-[fade-in_.3s_both] rounded-2xl border px-5 py-3 text-sm shadow-2xl backdrop-blur-xl ${t.ok ? "border-success/30 bg-ink-3/90" : "border-danger/40 bg-ink-3/95"}`}>
          <span className={t.ok ? "text-success" : "text-danger"}>{t.ok ? "✓ " : "⚠ "}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Runs an admin Server Action with pending state and a toast. */
export function useAction() {
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<AdminResult<T>>, opts: { silent?: boolean; onOk?: (r: AdminResult<T> & { ok: true }) => void } = {}) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          if (!opts.silent) toast(true, r.message ?? "انجام شد.");
          opts.onOk?.(r);
        } else toast(false, r.error);
      } catch (e) {
        toast(false, e instanceof Error ? e.message : "خطا");
      }
    });
  return { pending, run };
}
