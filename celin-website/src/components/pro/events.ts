"use client";

/** Opens the Pro sheet (code entry / membership request) from anywhere on the page. */
export function openProSheet(tab: "code" | "request" = "code") {
  window.dispatchEvent(new CustomEvent("celin:pro-sheet", { detail: { tab } }));
}

/** A Pro code was just accepted (the sheet, mounted once per page, shows the unlock moment if it is closed). */
export function proUnlocked() {
  window.dispatchEvent(new Event("celin:pro-unlocked"));
}

/** Opens the search overlay. */
export function openSearch() {
  window.dispatchEvent(new Event("celin:search"));
}
