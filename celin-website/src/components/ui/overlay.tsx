"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { overlayChanged } from "@/components/fx/motion";

type LeaveOptions = {
  /** a full page load (another root layout: the other language, the admin panel) instead of a client navigation */
  document?: boolean;
};

/** How a link inside an overlay leaves it (see <Overlay>). */
export interface OverlayNav {
  /** onClick of a link inside the overlay: closes it and follows the link (modified clicks keep their new tab) */
  click: (e: MouseEvent<HTMLAnchorElement>, opts?: LeaveOptions) => void;
  /** closes the overlay and goes to a same-site path */
  go: (to: string, opts?: LeaveOptions) => void;
  /** closes it without stepping back: an overlay opened right after takes over its history entry */
  handOff: () => void;
}

const NavContext = createContext<OverlayNav | null>(null);

/** The current session-history entry's key (Navigation API; it survives the router's own replaceState). */
const entryKey = (): string | null => (window as { navigation?: { currentEntry?: { key?: string } | null } }).navigation?.currentEntry?.key ?? null;

/** The way out of the overlay this component sits in (null outside an overlay). */
export function useOverlayNav(): OverlayNav | null {
  return useContext(NavContext);
}

/**
 * A Next <Link> that may sit inside an overlay: there it closes the overlay and navigates in place of the
 * overlay's own history entry, so Back returns to the page under it. Outside an overlay it is a plain <Link>.
 */
export function OverlayLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const nav = useContext(NavContext);
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        nav?.click(e);
      }}
    />
  );
}

/**
 * Site overlays on the native <dialog> (focus trap, Esc, ::backdrop): a centred modal that becomes a
 * bottom sheet on phones, side panels from the inline start/end, and a top panel (search). The browser
 * Back button closes an open overlay (a history entry is pushed on open; closing steps back over it).
 *
 * Links inside must leave through `OverlayLink` / `useOverlayNav()`: stepping back after a link was followed
 * would undo the navigation, so a link replaces the overlay's entry with its target instead.
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
  const router = useRouter();
  const night = tone === "night";
  const pushed = useRef(false);
  const pushedKey = useRef<string | null>(null);
  const pushedHref = useRef("");
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.style.overflow = "hidden";
      overlayChanged(true);
      // keep the router's own state in the entry, so Back/Forward stay ordinary same-page navigations; an entry
      // left by an overlay that handed over to this one (or by a reload while open) is used again
      if (!history.state?.celinOverlay) history.pushState({ ...(history.state ?? {}), celinOverlay: true }, "");
      pushed.current = true;
      pushedKey.current = entryKey();
      pushedHref.current = location.href;
    }
    if (!open && d.open) {
      d.close();
    }
    if (!open) {
      document.documentElement.style.overflow = "";
      overlayChanged(false);
      if (pushed.current) {
        const own = ownEntry();
        pushed.current = false;
        if (own) history.back();
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // the current entry is still the one this overlay pushed: a router refresh may have replaced its state
  // meanwhile (same key, same URL); a page that took the entry over (the filter sheet: a new URL and
  // celinOverlay: false) or a navigation (another key) makes it not ours any more
  function ownEntry(): boolean {
    if (!pushed.current) return false;
    if (history.state?.celinOverlay === false || location.href !== pushedHref.current) return false;
    const key = entryKey();
    return pushedKey.current && key ? key === pushedKey.current : history.state?.celinOverlay === true;
  }

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

  const nav = useMemo<OverlayNav>(() => {
    const go = (to: string, opts?: LeaveOptions) => {
      const url = new URL(to, location.href);
      // the overlay's own entry is the current one: the target takes its place (history stays [page, target])
      const own = ownEntry();
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && !url.hash) {
        closeRef.current(); // this very page: an ordinary close steps back over the entry
        return;
      }
      pushed.current = false;
      closeRef.current();
      if (opts?.document || url.origin !== location.origin) {
        if (own) location.replace(url.href);
        else location.assign(url.href);
        return;
      }
      const path = url.pathname + url.search + url.hash;
      if (own) router.replace(path);
      else router.push(path);
    };
    return {
      go,
      click: (e, opts) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.currentTarget;
        if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
        if (new URL(a.href, location.href).origin !== location.origin) return;
        e.preventDefault();
        go(a.href, opts);
      },
      handOff: () => {
        pushed.current = false;
        closeRef.current();
      },
    };
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <NavContext.Provider value={nav}>
          <div className="flex h-full max-h-[inherit] flex-col">
            <div className={`flex items-center justify-between gap-4 border-b px-5 py-3.5 sm:px-6 ${night ? "border-night-line" : "border-line"}`}>
              <span className={`text-sm ${night ? "text-on-night-muted" : "text-ink-2"}`}>{label}</span>
              <button type="button" onClick={onClose} className={`-me-2 grid size-11 place-items-center ${night ? "text-on-night-muted hover:text-on-night" : "text-ink-2 hover:text-ink"}`} aria-label={closeLabel}>
                <Icon name="close" className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </div>
        </NavContext.Provider>
      )}
    </dialog>
  );
}
