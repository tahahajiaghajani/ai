// The signed-in app (shell, modules, table definitions) is its own chunk (src/ui/OrgArea.tsx). Loading it starts as
// early as it is known to be needed: once a session exists, or while the sign-in form is being filled in.
export const loadOrgArea = () => import("../OrgArea");

let started = false;
/** Fetch the signed-in app's chunk in the background (once). */
export function preloadApp(): void {
  if (started) return;
  started = true;
  void loadOrgArea().catch(() => {
    started = false;
  });
}
