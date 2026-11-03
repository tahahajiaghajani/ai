// «دستیار سیراف» — mounted once in AppShell. Light on purpose: it listens for openAssistant() (Topbar button, Ctrl K
// palette, «بپرس» links) and Ctrl+J (any keyboard layout: the physical J key), keeps the open state, and loads the
// panel itself (Markdown, charts) only when it is first needed — or quietly once the app is idle.
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useOrg } from "../../lib/org";
import { onAssistantRequest, setAssistantOpen, type AssistantRequest } from "./bus";
import { switchedOff, useAiStatus, useCanAsk } from "./useAi";
import "./entry.css";

const load = () => import("./Panel");
const Panel = lazy(load);

const OPEN_KEY = "siraf.ai.open";

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    if (open) sessionStorage.setItem(OPEN_KEY, "1");
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    /* blocked storage: the panel simply starts closed after a reload */
  }
}

export interface PendingRequest {
  seq: number;
  req: AssistantRequest;
}

export function AssistantHost() {
  const { orgId } = useOrg();
  const canAsk = useCanAsk();
  const status = useAiStatus();
  const allowed = canAsk && !switchedOff(status.data);
  const [open, setOpen] = useState(readOpen);
  const [mounted, setMounted] = useState(open);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const seq = useRef(0);
  // where the focus was before the panel opened: it goes back there on close
  const back = useRef<HTMLElement | null>(null);

  const show = useCallback((next: boolean) => {
    if (next && document.activeElement instanceof HTMLElement && !document.activeElement.closest(".sa-panel")) back.current = document.activeElement;
    setOpen(next);
    if (next) setMounted(true);
    writeOpen(next);
  }, []);

  const close = useCallback(() => {
    show(false);
    const el = back.current;
    back.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, [show]);

  // openAssistant() from anywhere
  useEffect(() => {
    if (!allowed) return;
    return onAssistantRequest((req) => {
      const mode = req.mode ?? "open";
      if (mode === "close" || (mode === "toggle" && open)) return close();
      show(true);
      if (req.prompt || req.threadId || req.fresh) setPending({ seq: ++seq.current, req });
    });
  }, [allowed, open, show, close]);

  // Ctrl+J / ⌘J toggles the panel (e.code: the J key types «ت» on the Persian layout)
  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyJ") {
        e.preventDefault();
        if (open) close();
        else show(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowed, open, show, close]);

  // load the panel's code once the app is idle, so the first open is instant
  useEffect(() => {
    if (!allowed || mounted) return;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => void load().catch(() => {});
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 8000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(run, 4000);
    return () => window.clearTimeout(t);
  }, [allowed, mounted]);

  useEffect(() => setAssistantOpen(allowed && open), [allowed, open]);
  useEffect(() => () => setAssistantOpen(false), []);

  if (!allowed || !mounted) return null;
  return (
    <Suspense fallback={null}>
      <Panel key={orgId} open={open} onClose={close} pending={pending} />
    </Suspense>
  );
}
