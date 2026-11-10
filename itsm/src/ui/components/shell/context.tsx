// Shared state between the shell's parts and the pages: the page title (for the breadcrumb and the
// palette's recent pages) and the command palette opener.
import { createContext, useContext, useEffect } from "react";
import type { AssistantRequest } from "../../ai/assistant/bus";

export interface ShellApi {
  /** The current page's title as plain text (set by PageHeader). */
  setTitle: (title: string | null) => void;
  openPalette: () => void;
  /** opens the assistant «دستیار» (see src/ui/ai/assistant/bus.ts) */
  openAssistant: (req?: AssistantRequest) => void;
  /**
   * A full-screen surface of its own covers the shell (the requester's portal): while covered, the shell's command
   * palette (Ctrl K) and the assistant are neither shown nor opened above it.
   */
  cover: (on: boolean) => void;
}

export const ShellCtx = createContext<ShellApi | null>(null);

/**
 * Does this key press toggle the command palette? Ctrl K (or ⌘K) on any keyboard layout — the K key types «ن» on the
 * Persian one — and never while a surface of its own covers the shell (the portal).
 */
export function togglesPalette(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; code: string; key: string }, covered: boolean): boolean {
  if (covered) return false;
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyK" || ["k", "K", "ن", "ك"].includes(e.key));
}

export function useShell(): ShellApi | null {
  return useContext(ShellCtx);
}

/** Publishes a page title to the shell while the component is mounted. */
export function usePageTitle(title: string | null) {
  const s = useContext(ShellCtx);
  useEffect(() => {
    if (!s) return;
    s.setTitle(title);
    return () => s.setTitle(null);
  }, [s, title]);
}
