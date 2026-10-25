/** Action markers the assistant appends ([[action:ticket]], [[work:slug]] …) — shared by server and client. */
export type ChatAction = { kind: "ticket" } | { kind: "contact" } | { kind: "work"; slug: string };

const MARKER = /\[\[\s*(action:(ticket|contact)|work:([a-z0-9-]+)|unknown)\s*\]\]/g;

export function parseMarkers(text: string): { text: string; actions: ChatAction[]; unknown: boolean } {
  const actions: ChatAction[] = [];
  const seen = new Set<string>();
  let unknown = false;
  let clean = text.replace(MARKER, (_m, _all, action: string | undefined, slug: string | undefined) => {
    const key = action ?? (slug ? `work:${slug}` : "unknown");
    if (key === "unknown") unknown = true;
    else if (!seen.has(key)) {
      seen.add(key);
      actions.push(slug ? { kind: "work", slug } : { kind: action as "ticket" | "contact" });
    }
    return "";
  });
  // hide a marker that is still streaming in ("[[act…")
  clean = clean.replace(/\[\[[^\]]*$/, "").replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
  return { text: clean, actions, unknown };
}
