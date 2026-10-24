"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { overlayChanged } from "@/components/fx/motion";

/**
 * Site overlays on the native <dialog> (focus trap, Esc, ::backdrop): a centred modal that becomes a
 * bottom sheet on phones, side panels from the inline start/end, and a top panel (search). The browser
 * Back button closes an open overlay (a history entry is pushed on open).
 */
export function Overlay({
  open,
  onClose,
  label,
  children,
  variant = "sheet",
  tone = "light",
  closeLabel = "بستن",
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  variant?: "sheet" | "start" | "end" | "top";
  /** night = an espresso panel with champagne lines (the Pro sheet) */
  tone?: "light" | "night";
  closeLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const night = tone === "night";
  const pushed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.style.overflow = "hidden";
      overlayChanged(true);
      // keep the router's own state in the entry, so Back/Forward stay ordinary same-page navigations
      history.pushState({ ...(history.state ?? {}), celinOverlay: true }, "");
      pushed.current = true;
    }
    if (!open && d.open) {
      d.close();
    }
    if (!open) {
      document.documentElement.style.overflow = "";
      overlayChanged(false);
      if (pushed.current) {
        pushed.current = false;
        if (history.state?.celinOverlay) history.back();
      }
    }
  }, [open]);

  useEffect(() => {
    const onPop = () => {
      if (pushed.current) {
        pushed.current = false;
        closeRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const pos = {
    sheet: "mt-auto mb-0 w-full max-w-none sm:my-auto sm:w-[min(520px,calc(100%-2rem))] sm:mx-auto max-h-[88dvh] sm:max-h-[86dvh] celin-sheet",
    start: "ms-0 me-auto my-0 h-[100dvh] max-h-none w-[min(420px,92vw)] celin-side-start",
    end: "ms-auto me-0 my-0 h-[100dvh] max-h-none w-[min(480px,100vw)] celin-side-end",
    top: "mt-0 mb-auto w-full max-w-none max-h-[90dvh] celin-top",
  }[variant];

  return (
    <dialog
      ref={ref}
      aria-label={label}
      data-lenis-prevent
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      data-tone={night ? "light" : undefined}
      className={`overflow-hidden p-0 ${night ? "bg-night-2 text-on-night backdrop:bg-night/60 backdrop:backdrop-blur-[3px]" : "bg-ground text-ink backdrop:bg-ink/35"} ${pos} ${className}`}
    >
      {open && (
        <div className="flex h-full max-h-[inherit] flex-col">
          <div className={`flex items-center justify-between gap-4 border-b px-5 py-3.5 sm:px-6 ${night ? "border-night-line" : "border-line"}`}>
            <span className={`text-sm ${night ? "text-on-night-muted" : "text-ink-2"}`}>{label}</span>
            <button type="button" onClick={onClose} className={`-me-2 grid size-11 place-items-center ${night ? "text-on-night-muted hover:text-on-night" : "text-ink-2 hover:text-ink"}`} aria-label={closeLabel}>
              <Icon name="close" className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      )}
    </dialog>
  );
}
