// Opening the assistant from anywhere (palette, buttons, «بپرس» links) — CONTRACT owned by stream E1.
// A page calls openAssistant(); the AssistantHost mounted once in AppShell listens and opens its panel.
// The host publishes whether the panel is open (the Topbar button shows it pressed).
import { useSyncExternalStore } from "react";
import type { AiPageContext } from "@shared/ai/types";

export interface AssistantRequest {
  /** a question to send right away (or to prefill when `send` is false) */
  prompt?: string;
  send?: boolean;
  context?: AiPageContext;
  /** open a stored conversation */
  threadId?: string;
  /** start a new conversation first */
  fresh?: boolean;
  /** "toggle" closes an open panel; "close" only closes (default "open") */
  mode?: "open" | "toggle" | "close";
}

const EVENT = "siraf:assistant";

export function openAssistant(req: AssistantRequest = {}): void {
  window.dispatchEvent(new CustomEvent<AssistantRequest>(EVENT, { detail: req }));
}

export const toggleAssistant = () => openAssistant({ mode: "toggle" });
export const closeAssistant = () => openAssistant({ mode: "close" });

export function onAssistantRequest(fn: (req: AssistantRequest) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<AssistantRequest>).detail ?? {});
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// ---------------------------------------------------------------- open state (set by the host)

let isOpen = false;
const listeners = new Set<() => void>();

export function setAssistantOpen(open: boolean): void {
  if (isOpen === open) return;
  isOpen = open;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while the assistant panel is open. */
export function useAssistantOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isOpen,
    () => false,
  );
}
