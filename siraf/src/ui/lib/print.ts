// Printing helpers shared by every module (components.md §12).
//
//  usePrinting() — true while the page is being printed. antd's sticky header is a table of its own whose
//    columns no longer line up with the body on paper (each table sizes its columns alone), so sticky tables
//    switch it off for the print and print as one table. beforeprint fires synchronously on every Chromium print
//    path (window.print, Ctrl+P, Electron's print and printToPDF) and the page is laid out for print right after
//    the handler returns, so the switch is rendered with flushSync. Call window.print() from an event handler or
//    a timer, never from inside a render or an effect (flushSync cannot render there).
//
//  printWithPage(size, margin) — print with a page of its own (an A5 sheet, an 80 mm roll, labels): an @page
//    rule for this print only, and on the Windows app the same paper and orientation passed to Electron.
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

let printing = false;
const listeners = new Set<() => void>();

function setPrinting(next: boolean) {
  if (next === printing) return;
  printing = next;
  flushSync(() => {
    for (const l of listeners) l();
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", () => setPrinting(true));
  window.addEventListener("afterprint", () => setPrinting(false));
  window.matchMedia?.("print").addEventListener?.("change", (e) => setPrinting(e.matches));
}

/** True while the page is printed (for layouts that must differ on paper, e.g. antd's sticky header). */
export function usePrinting(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => printing,
    () => false,
  );
}

type ElectronPage = { pageSize: string | { width: number; height: number }; landscape: boolean };

/** The paper of an @page size («A5 portrait», «A4 landscape», «80mm 120mm») for Electron's print(). */
export function electronPage(size: string): ElectronPage {
  const parts = size.trim().split(/\s+/);
  const mm = parts.map((p) => (/^[\d.]+mm$/i.test(p) ? parseFloat(p) : NaN));
  if (!Number.isNaN(mm[0])) {
    const w = mm[0];
    const h = Number.isNaN(mm[1] ?? NaN) ? w : mm[1];
    // Electron takes a custom paper in microns
    return { pageSize: { width: Math.round(w * 1000), height: Math.round(h * 1000) }, landscape: false };
  }
  const name = parts.find((p) => /^(a[3-6]|letter|legal|tabloid)$/i.test(p));
  return { pageSize: name ? name.toUpperCase().replace(/^LETTER$/, "Letter").replace(/^LEGAL$/, "Legal").replace(/^TABLOID$/, "Tabloid") : "A4", landscape: parts.some((p) => p.toLowerCase() === "landscape") };
}

/**
 * Print a sheet with a given page size: adds an @page rule for the print, then removes it.
 * The sheet itself is any element with `hidden print:block` inside the page. While it prints, <html> carries
 * `sf-own-page`, so the wide-report rule (kit.css) does not move this print to its landscape page.
 */
export function printWithPage(size: string, margin = "6mm") {
  const style = document.createElement("style");
  style.setAttribute("data-sf-print", "1");
  // the page size of this print, without the app frame's padding around the sheet
  // (the frame's full-height layout would otherwise add blank pages — wasted labels on a roll)
  style.textContent = `@page { size: ${size}; margin: ${margin}; }
@media print {
  html, body, #root { height: auto !important; min-height: 0 !important; }
  .min-h-screen, .ant-layout { min-height: 0 !important; height: auto !important; background: #fff !important; }
  .ant-layout-content { padding: 0 !important; }
}`;
  document.head.appendChild(style);
  document.documentElement.classList.add("sf-own-page");
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    style.remove();
    document.documentElement.classList.remove("sf-own-page");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  setTimeout(() => {
    const bridge = (window as unknown as { taraz?: { print?: (o?: Record<string, unknown>) => Promise<unknown> } }).taraz;
    if (bridge?.print) {
      // the Windows app prints asynchronously through Electron, on the paper of this page
      Promise.resolve(bridge.print({ ...electronPage(size) })).catch(() => window.print()).finally(done);
    } else {
      window.print();
      setTimeout(done, 1500);
    }
  }, 60);
}
