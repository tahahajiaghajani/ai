// A value out of a JSON answer by a short path — the price sources a business types itself (gold board,
// exchange board):
//   data.gold.g18          keys
//   items[0].price         an array item by position (also items.0.price)
//   items[symbol=USD].sell the first array item whose field equals the text (quotes optional:
//                          [symbol="USD"]); free price APIs often answer with such lists
// A key that is not there gives undefined; nothing throws.

type Step = string | { field: string; equals: string };

function steps(path: string): Step[] {
  const out: Step[] = [];
  const re = /\[\s*([^\]=]+?)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]*?))\s*\]|\[\s*(\d+)\s*\]|([^.[\]]+)/g;
  for (const m of String(path ?? "").matchAll(re)) {
    if (m[1] !== undefined) out.push({ field: m[1], equals: (m[2] ?? m[3] ?? m[4] ?? "").trim() });
    else if (m[5] !== undefined) out.push(m[5]);
    else if (m[6] !== undefined && m[6].trim()) out.push(m[6].trim());
  }
  return out;
}

export function pickPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const s of steps(path)) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof s === "string") {
      if (Array.isArray(cur)) cur = /^\d+$/.test(s) ? cur[Number(s)] : undefined;
      else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[s];
      else return undefined;
      continue;
    }
    const list = Array.isArray(cur) ? cur : typeof cur === "object" ? Object.values(cur as Record<string, unknown>) : null;
    if (!list) return undefined;
    cur = list.find((x) => !!x && typeof x === "object" && String((x as Record<string, unknown>)[s.field] ?? "").trim() === s.equals);
  }
  return cur;
}
