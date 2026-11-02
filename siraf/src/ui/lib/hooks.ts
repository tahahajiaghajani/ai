import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { App } from "antd";
import { CircleCheck, CircleAlert } from "lucide-react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { errorText } from "./api";

// Toasts (components.md §9): antd `notification` at the bottom-left (theme.tsx), floating glass, at most 3.
// A full sentence, a 16 px status icon at the start (circle-check in `in`, circle-alert in `danger`; info has none),
// 4 s — 6 s with an action — and errors stay until closed. Hover pauses the timer. `message` is kept for transient
// notes («رونوشت شد.») only.
const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const icon = (tone: "in" | "danger" | "warning") =>
  createElement(
    "span",
    { className: "sf-toast-ic", "data-tone": tone, "aria-hidden": true },
    tone === "in" ? createElement(CircleCheck, ICON) : tone === "danger" ? createElement(CircleAlert, ICON) : createElement("i", { className: "sf-nuqta" }),
  );

/** A sentence ends with a full stop (the copy rules in components.md §9); questions and quotes are left alone. */
const sentence = (s: string) => (/[.!؟?…»)]$/.test(s.trim()) || !s.trim() ? s : `${s.trim()}.`);

/** The verb that confirms a destructive question («حذف سند ۱۲۴؟» → «حذف»). */
function confirmVerb(title: string, danger: boolean): string {
  const m = title.match(/^(حذف|ابطال|بستن|بازگردانی|قطع اتصال|باطل کردن|برگشت)/);
  if (m) return m[1];
  if (/باطل شود/.test(title)) return "ابطال";
  if (/حذف/.test(title) && danger) return "حذف";
  return "تأیید";
}

export interface ToastOptions {
  /** one line under the title, 13 px text-2 */
  description?: ReactNode;
  /** a link-like action at the end of the title row («مشاهده»، «بازگردانی») — the toast then stays 6 s */
  action?: { label: string; onClick: () => void };
  /** seconds; 0 keeps it until closed */
  duration?: number;
  key?: string;
}

export function useNotify() {
  const { message, notification, modal } = App.useApp();
  const toast = (tone: "in" | "danger" | "warning" | "info", title: ReactNode, o: ToastOptions = {}) => {
    const key = o.key ?? (typeof title === "string" ? `${tone}:${title}` : undefined);
    notification.open({
      key,
      title: typeof title === "string" ? sentence(title) : title,
      description: o.description,
      icon: tone === "info" ? undefined : icon(tone),
      duration: o.duration ?? (tone === "danger" ? 0 : o.action ? 6 : 4),
      pauseOnHover: true,
      role: tone === "danger" ? "alert" : "status",
      actions: o.action
        ? createElement(
            "button",
            {
              type: "button",
              className: "sf-link",
              style: { background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 13 },
              onClick: () => {
                o.action!.onClick();
                if (key) notification.destroy(key);
              },
            },
            o.action.label,
          )
        : undefined,
    });
  };
  return {
    ok: (text: string, o?: ToastOptions) => toast("in", text, o),
    info: (text: string, o?: ToastOptions) => toast("info", text, o),
    error: (e: unknown, o?: ToastOptions) => toast("danger", errorText(e), o),
    warn: (text: string, o?: ToastOptions) => toast("warning", text, o),
    /** a transient note near the top bar («رونوشت شد.»): never for confirmations */
    note: (text: string) => message.info({ content: text, icon: null }),
    notify: notification,
    /**
     * Confirmation dialog (components.md §1.6): the title is a question about the object («حذف سند ۱۲۴؟»), the body
     * one sentence of consequence; cancel, then the confirming action at the end edge — solid danger when destructive.
     */
    confirm: (title: string, content?: string, danger = false, okText?: string) =>
      new Promise<boolean>((resolve) => {
        let done = false;
        const settle = (v: boolean) => {
          if (!done) {
            done = true;
            resolve(v);
          }
        };
        modal.confirm({
          title,
          content: content ? sentence(content) : undefined,
          icon: null,
          width: 440,
          className: "sf-confirm",
          okText: okText ?? confirmVerb(title, danger),
          cancelText: "انصراف",
          okButtonProps: danger ? { danger: true, variant: "solid", color: "danger" } : undefined,
          autoFocusButton: "ok",
          maskClosable: true,
          onOk: () => settle(true),
          onCancel: () => settle(false),
          afterClose: () => settle(false),
        });
      }),
    modal,
  };
}

/** Mutation with a success toast, Persian error toast and query invalidation. */
export function useAction<TVars, TData = unknown>(
  fn: (v: TVars) => Promise<TData>,
  opts: { success?: string | ((d: TData) => string); invalidate?: QueryKey[]; onSuccess?: (d: TData, v: TVars) => void } = {},
) {
  const qc = useQueryClient();
  const n = useNotify();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d, v) => {
      if (opts.success) n.ok(typeof opts.success === "function" ? opts.success(d) : opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(d, v);
    },
    onError: (e) => n.error(e),
  });
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/**
 * Skeleton timing (components.md §8): true only once `on` has lasted `delay` ms, and then for at least `min` ms, so
 * fast loads never flash a skeleton and slow ones never flicker.
 */
export function useDelayedFlag(on: boolean, delay = 200, min = 400) {
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (on) {
      const t = setTimeout(() => {
        since.current = Date.now();
        setShown(true);
      }, delay);
      return () => clearTimeout(t);
    }
    if (!shown) return;
    const left = min - (Date.now() - since.current);
    if (left <= 0) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(false), left);
    return () => clearTimeout(t);
  }, [on, delay, min, shown]);
  return shown;
}

/** Keyboard shortcut while a page is open (e.g. F2 to save). */
export function useHotkey(key: string, fn: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = [e.ctrlKey ? "ctrl" : "", e.altKey ? "alt" : "", e.shiftKey ? "shift" : "", e.key.toLowerCase()].filter(Boolean).join("+");
      if (k === key.toLowerCase()) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {
        /* ignore */
      }
    },
  ];
}
