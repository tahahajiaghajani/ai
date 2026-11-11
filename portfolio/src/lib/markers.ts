/**
 * Action markers the assistant appends ([[action:ticket]], [[work:slug]], [[product:slug]], [[post:slug]] …) —
 * shared by server and client.
 */
export type PageKind = "work" | "product" | "post";
export type ChatAction = { kind: "ticket" } | { kind: "contact" } | { kind: PageKind; slug: string };

const MARKER = /\[\[\s*(action:(ticket|contact)|(work|product|post):([a-z0-9-]+)|unknown)\s*\]\]/g;

export function parseMarkers(text: string): { text: string; actions: ChatAction[]; unknown: boolean } {
  const actions: ChatAction[] = [];
  const seen = new Set<string>();
  let unknown = false;
  let clean = text.replace(MARKER, (_m, _all, action: string | undefined, page: PageKind | undefined, slug: string | undefined) => {
    const key = action ?? (page && slug ? `${page}:${slug}` : "unknown");
    if (key === "unknown") unknown = true;
    else if (!seen.has(key)) {
      seen.add(key);
      actions.push(page && slug ? { kind: page, slug } : { kind: action as "ticket" | "contact" });
    }
    return "";
  });
  // hide a marker that is still streaming in ("[[act…")
  clean = clean.replace(/\[\[[^\]]*$/, "").replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
  return { text: clean, actions, unknown };
}
