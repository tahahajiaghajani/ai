/**
 * One page scroll lock shared by every overlay (chat, demo sheet, mobile menu). It is counted, so
 * an overlay that closes in the same commit another one opens (the chat's «demos» action, the
 * menu's demos button) never unlocks the page under the one that is still open. Take it while
 * open and call the returned release in the effect cleanup; releasing twice is a no-op.
 */
let held = 0;

export function lockScroll(): () => void {
  if (held++ === 0) document.documentElement.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--held === 0) document.documentElement.style.overflow = "";
  };
}
