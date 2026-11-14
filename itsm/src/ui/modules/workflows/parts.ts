// The «گردش‌کارها» module is assembled from parts (design F D13, §8, §12): each folder a package owns — the kit
// (F5k), admin/{fields,forms,positions} (F5), admin/{hub,process,lifecycle} (F6), user (F7) — exports one
// `WorkflowsPart` from its routes.tsx, and index.tsx lists them. A part names the rows it adds to the two nav groups
// (settings: «فرم‌ها و گردش‌کارها»; home: «گردش‌کارها»), its routes and the spaces of its route segments. A group
// without rows is left out of the menu. Pure: tested in tests/workflows-kit-ui.test.ts.
import type { AppRoute, ModuleUi, NavGroup, NavItem, SpaceKey } from "../registry";

export interface WorkflowsPart {
  /** rows of «فرم‌ها و گردش‌کارها» in the settings space */
  settings?: NavItem[];
  /** rows of «گردش‌کارها» in the home space (the person's own pages) */
  home?: NavItem[];
  routes: AppRoute[];
  /** first path segment → space, for routes that are not menu rows */
  segments?: Record<string, SpaceKey>;
}

export const SETTINGS_GROUP = { key: "workflows-admin", label: "فرم‌ها و گردش‌کارها", space: "settings" } as const;
export const HOME_GROUP = { key: "workflows", label: "گردش‌کارها", space: "home" } as const;

/** The module's part of the shell: the two groups (when they have rows), every route, the segments. */
export function assemble(parts: readonly WorkflowsPart[]): ModuleUi {
  const settings = parts.flatMap((p) => p.settings ?? []);
  const home = parts.flatMap((p) => p.home ?? []);
  const nav: NavGroup[] = [];
  if (settings.length) nav.push({ ...SETTINGS_GROUP, items: settings });
  if (home.length) nav.push({ ...HOME_GROUP, items: home });
  const routes = parts.flatMap((p) => p.routes);
  const seen = new Set<string>();
  for (const r of routes) {
    if (seen.has(r.path)) throw new Error(`workflows: the route «${r.path}» is registered twice`);
    seen.add(r.path);
  }
  return { nav, routes, segments: Object.assign({}, ...parts.map((p) => p.segments ?? {})) };
}
