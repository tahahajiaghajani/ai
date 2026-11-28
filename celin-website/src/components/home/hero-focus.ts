/**
 * The focus rules of the turning home arcade («سرآغاز»), pure (no imports, shared with the tests).
 */

interface Contains<T> {
  contains(other: T | null): boolean;
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
