/**
 * The focus rules of the turning home arcade («سرآغاز»), pure (no imports, shared with the tests).
 */

interface Matches {
  matches(selector: string): boolean;
}
interface Contains<T> {
  contains(other: T | null): boolean;
}

/**
 * Focus rests the arcade only when it is keyboard focus. Most browsers leave a clicked or tapped button focused, and
 * one use of «قبلی/بعدی» must not stop the turning for the rest of the visit; a browser without `:focus-visible`
 * rests on any focus, as before.
 */
export function restsOnFocus(el: Matches | null): boolean {
  if (!el) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * When a keyboard turn ends, the focus goes on to the new centre link only while it is still on the arches (on the
 * old centre link, which is about to stop being a link): never when the visitor has moved it elsewhere meanwhile.
 */
export function handsOnFocus<T>(asked: boolean, stage: Contains<T> | null, active: T | null): boolean {
  return asked && active !== null && Boolean(stage?.contains(active));
}

/**
 * Right after that commit: the old centre may have dropped the focus to the page (Chromium) or still hold it; anywhere
 * else the visitor put it, it stays.
 */
export function focusStillHere<T>(stage: Contains<T> | null, active: T | null, body: T | null): boolean {
  return active === null || active === body || Boolean(stage?.contains(active));
}
