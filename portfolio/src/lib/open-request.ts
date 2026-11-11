import type Lenis from "lenis";
import type { Lang } from "@/lib/i18n";
import { href } from "@/lib/i18n";
import type { RequestKind } from "@/lib/request-meta";

/**
 * Opens the request form (the home page's #contact) with a starting description and request type: the assistant's
 * last question, or an edition a visitor asked for. The form takes both from sessionStorage when it mounts or when
 * the `request:seed` event fires; what the visitor typed is never overwritten (a new seed is added below it).
 */
export function openRequest(lang: Lang, { seed, kind }: { seed?: string; kind?: RequestKind }, lenis?: Lenis | null) {
  try {
    if (seed) sessionStorage.setItem("request:seed", seed.slice(0, 1500));
    if (kind) sessionStorage.setItem("request:kind", kind);
  } catch {}
  const home = href(lang, "/");
  if (location.pathname !== home) {
    location.href = `${home}#contact`;
    return;
  }
  window.dispatchEvent(new Event("request:seed"));
  const form = document.getElementById("contact");
  if (!form) return;
  if (lenis) {
    lenis.start(); // an open overlay may have stopped it, and a stopped Lenis ignores scrollTo
    lenis.scrollTo(form, { offset: -80, duration: 1.6 });
  } else form.scrollIntoView({ behavior: "smooth" });
  // a scripted scroll leaves focus behind: move it to the form itself (not the textarea, which would open a phone's
  // keyboard mid-glide), so the next Tab lands on its first field
  document.getElementById("request-form")?.focus({ preventScroll: true });
}
