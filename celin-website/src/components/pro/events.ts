"use client";

/** Opens the Pro sheet (code entry / membership request) from anywhere on the page. */
export function openProSheet(tab: "code" | "request" = "code") {
  window.dispatchEvent(new CustomEvent("celin:pro-sheet", { detail: { tab } }));
}

/** Opens the search overlay. */
export function openSearch() {
  window.dispatchEvent(new Event("celin:search"));
}
