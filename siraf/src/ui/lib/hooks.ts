import { useEffect, useState } from "react";
import { App } from "antd";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { errorText } from "./api";

export function useNotify() {
  const { message, notification, modal } = App.useApp();
  return {
    ok: (text: string) => message.success(text),
    info: (text: string) => message.info(text),
    error: (e: unknown) => message.error(errorText(e)),
    warn: (text: string) => message.warning(text),
    notify: notification,
    confirm: (title: string, content?: string, danger = false) =>
      new Promise<boolean>((resolve) =>
        modal.confirm({
          title,
          content,
          okText: "بله",
          cancelText: "انصراف",
          okButtonProps: { danger },
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      ),
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
