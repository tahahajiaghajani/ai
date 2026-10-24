/**
 * A piece's name without its collection where the collection is printed right above it: under the label «یاس»,
 * «یاس · چوکر تنیسی» shows «چوکر تنیسی» (the full name stays in alt text, titles and structured data). Only a name
 * that starts with the collection's name followed by a separator is shortened.
 */
export function pieceName(name: string, collection?: string | null): string {
  if (!collection) return name;
  const m = /^(.+?)\s*[·•|،:–—-]\s*(.+)$/.exec(name);
  return m && m[1].trim() === collection.trim() && m[2].trim() ? m[2].trim() : name;
}
