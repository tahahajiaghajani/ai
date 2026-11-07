// Which links in an answer may become links. A model can be talked into writing anything (a phishing URL, a
// `javascript:` link, a path to someone else's record), so an answer links only to:
//   • a record the conversation's tools returned (`siraf:<type>/<id>`, or that record's own in-app path), and
//   • a page of the app the person can open (the sidebar's paths, no ids).
// Everything else renders as plain text. Paths are org-relative («sales/invoices/<id>»), never absolute URLs.
import type { AiRef } from "@shared/ai/types";
import { isUuid } from "@shared/id";

/** An org-relative app path with an optional simple query, or null. */
export function safePath(p: string | null | undefined): string | null {
  if (!p) return null;
  const s = p.trim().replace(/^\/+/, "");
  if (!s || s.includes("..") || s.includes("\\") || s.includes("//")) return null;
  if (!/^[a-z][a-z0-9-]*(?:\/[A-Za-z0-9_-]+)*\/?(?:\?[A-Za-z0-9_=&%.,:-]*)?(?:#[a-z0-9-]*)?$/.test(s)) return null;
  return s.replace(/\/(?=\?|#|$)/, "");
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The in-app path a Markdown link may open, or null (render the text only).
 * `refs`: the records this conversation's tools returned; `pages`: the static paths of the app's pages.
 */
export function resolveHref(href: string | null | undefined, refs: readonly AiRef[], pages: ReadonlySet<string>): string | null {
  const h = (href ?? "").trim();
  if (!h) return null;
  // siraf:invoice/<id> (also siraf://invoice/<id>): only a record a tool returned
  const ref = h.match(/^siraf:\/{0,2}([a-z_]+)\/([^/?#\s]+)$/i);
  if (ref) {
    const hit = refs.find((r) => r.type === ref[1] && r.id === ref[2]);
    return hit ? safePath(hit.path) : null;
  }
  if (SCHEME.test(h) || h.startsWith("//")) return null; // http(s), javascript:, data:, mailto: …
  // «/<org id>/sales/…» → «sales/…»
  const trimmed = h.replace(/^\/+/, "");
  const first = trimmed.split(/[/?#]/)[0];
  const path = safePath(isUuid(first) ? trimmed.slice(first.length) : trimmed);
  if (!path) return null;
  const bare = path.split(/[?#]/)[0];
  if (refs.some((r) => safePath(r.path)?.split(/[?#]/)[0] === bare)) return path;
  // a page of the app (no record id in it)
  if (pages.has(bare) && !bare.split("/").some(isUuid)) return path;
  return null;
}

/** A ref's in-app path, if it has a safe one. */
export const refPath = (r: AiRef): string | null => safePath(r.path);
