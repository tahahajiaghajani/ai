/** Action markers the assistant appends ([[action:ticket]] …) — shared by server and client. */
export type ChatAction = "demos" | "ticket" | "contact";

const MARKER = /\[\[\s*(action:(demos|ticket|contact)|unknown)\s*\]\]/g;

export function parseMarkers(text: string): { text: string; actions: ChatAction[]; unknown: boolean } {
  const actions = new Set<ChatAction>();
  let unknown = false;
  let clean = text.replace(MARKER, (_m, _all, action: ChatAction | undefined) => {
    if (action) actions.add(action);
    else unknown = true;
    return "";
  });
  // hide a marker that is still streaming in ("[[act…")
  clean = clean.replace(/\[\[[^\]]*$/, "").replace(/\s+$/, "");
  return { text: clean, actions: [...actions], unknown };
}
