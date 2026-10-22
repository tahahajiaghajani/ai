import { useEffect, useEffectEvent, type RefObject } from "react";
import { lockScroll } from "@/lib/scroll-lock";

/** Open overlays, innermost last: only the top one handles Tab and Escape. */
const stack: HTMLElement[] = [];

const TABBABLE = "a[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable]";

/** What Tab can reach inside `root`, in document order (skips disabled and display:none). */
function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
}

/**
 * Where Tab / Shift+Tab (`back`) goes in an open overlay: around at both ends, and back in when
 * focus sits outside it (still on the opener, or on <body>). null = the browser's own move stays inside.
 */
export function tabTarget<T>(items: readonly T[], active: T | null, inside: boolean, back: boolean): T | null {
  const first = items[0] ?? null;
  const last = items[items.length - 1] ?? null;
  if (!inside) return back ? last : first;
  const i = active === null ? -1 : items.indexOf(active);
  if (i === -1) return null;
  if (back && i === 0) return last;
  if (!back && i === items.length - 1) return first;
  return null;
}

/** A text field gets focus back only after a keyboard close: a tap would pop the phone keyboard up again. */
const typing = (el: HTMLElement) => el.matches("input, textarea, select, [contenteditable]");

/**
 * Modal behaviour of a full-screen overlay while `open`: takes the shared page scroll lock, keeps
 * Tab / Shift+Tab inside `ref`, closes on Escape and, once closed, gives focus back to the element
 * that opened it. `focus` gets focus on open, after `delay` ms when the panel animates in.
 */
export function useOverlay(open: boolean, ref: RefObject<HTMLElement | null>, o: { onClose: () => void; focus?: RefObject<HTMLElement | null>; delay?: number }) {
  const close = useEffectEvent(o.onClose);
  const { focus, delay = 0 } = o;
  useEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const was = document.activeElement;
    // not one inside an overlay that just closed in the same commit (it is inert now)
    const opener = was instanceof HTMLElement && was !== document.body && !root.contains(was) && !was.closest("[inert]") ? was : null;
    const unlock = lockScroll();
    stack.push(root);
    let byPointer = false;
    const timer = window.setTimeout(() => focus?.current?.focus({ preventScroll: true }), delay);
    const onPointer = () => (byPointer = true);
    const onKey = (e: KeyboardEvent) => {
      byPointer = false;
      if (stack[stack.length - 1] !== root) return;
      if (e.key === "Escape") return close();
      if (e.key !== "Tab") return;
      const items = tabbables(root);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const to = tabTarget(items, active, !!active && root.contains(active), e.shiftKey);
      if (to || !items.length) e.preventDefault();
      to?.focus();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(root), 1);
      unlock();
      // only when focus is still ours (inside, or dropped to <body> as the overlay turns inert)
      const now = document.activeElement;
      const ours = !now || now === document.body || root.contains(now);
      if (opener?.isConnected && ours && !(byPointer && typing(opener))) opener.focus({ preventScroll: true });
    };
  }, [open, ref, focus, delay]);
}
