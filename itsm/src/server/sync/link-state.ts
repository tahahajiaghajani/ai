// Which organisation a Windows app is linked to now (docs/DESKTOP_FA.md «همگام‌سازی»). The app's local server registers a
// reader of its configuration (src/desktop/server.ts): the link is read in memory on every call — never cached — so
// right after linking or unlinking, starts, submissions, schedules, reactions (`actsHere`) and the AI relay follow the
// new state at once. Keyed by the database object (`cfg.db`): one local server per database.

/** The link as the Windows app's configuration holds it (`config.cloud`). */
export type LinkGetter = () => { url: string | null; token: string | null; org_id: string | null } | null;

const links = new WeakMap<object, LinkGetter>();

/** Called by the Windows app's server with a reader of its cloud link (src/desktop/server.ts). */
export function registerCloudLink(db: object, get: LinkGetter): void {
  links.set(db, get);
}

/** The reader registered for this database, if its server registered one. */
export function linkReader(db: object): LinkGetter | undefined {
  return links.get(db);
}

/**
 * The organisation this runtime's database is linked to now: its id, null when the app is not linked, undefined when
 * no reader was registered (not a Windows app's local server: the web version, the server edition, a test's server).
 */
export function linkedOrgOf(db: object): string | null | undefined {
  const get = links.get(db);
  if (!get) return undefined;
  const l = get();
  return l?.url && l.token && l.org_id ? l.org_id : null;
}
