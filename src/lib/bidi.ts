/**
 * Text direction for mixed Persian/English content. The browser's dir="auto" looks only at the
 * first letter, so a Persian sentence that starts with an English word (a file name, "PWA", …)
 * flips to left-to-right and its words appear in the wrong order. Here Persian wins as soon as it
 * is a meaningful part of the text; only (almost) purely Latin text is laid out left-to-right.
 */
export function textDir(text: string): "rtl" | "ltr" {
  const fa = (text.match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (!fa && !latin) return "rtl";
  return fa * 4 >= latin ? "rtl" : "ltr";
}
