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
}

export const ShellCtx = createContext<ShellApi | null>(null);

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
