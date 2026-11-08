// Who may see and order what (REQ-013, REQ-014): a catalogue, a category and an item each name audiences it is
// «در دسترس برای» and «در دسترس نیست برای». An audience matches a person by their own id, their groups, their unit
// (or a unit above it), their location (or one above it), their roles and persona, VIP status or a condition on their
// profile — any of the filled criteria, or all of them. Denial wins; an empty «در دسترس برای» means everyone. An item
// is orderable when its catalogue, every category on the way down and the item itself allow the person. Pure.

export interface AudienceDef {
  id: string;
  match: "any" | "all";
  active: boolean;
  users: string[];
  groups: string[];
  units: string[];
  include_subunits: boolean;
  locations: string[];
  include_sublocations: boolean;
  roles: string[];
  personas: string[];
  vip_only: boolean;
  /** evaluated by the caller (server: on the person's profile) — a criterion like the others */
  condition?: unknown;
}

/** What audiences are matched against: one member of the organisation. */
export interface MemberFacts {
  userId: string;
  groups: string[];
  /** the member's unit first, then the units above it */
  unitPath: string[];
  /** the member's location first, then the locations above it */
  locationPath: string[];
  roles: string[];
  persona: string | null;
  vip: boolean;
}

export interface Bindings {
  available_for?: string[] | null;
  not_available_for?: string[] | null;
}

const ids = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : []);

/** Does the audience match the member? `condition` answers the profile condition when the audience has one. */
export function audienceMatches(a: AudienceDef, m: MemberFacts, condition?: (a: AudienceDef) => boolean): boolean {
  if (!a.active) return false;
  const tests: boolean[] = [];
  if (a.users.length) tests.push(a.users.includes(m.userId));
  if (a.groups.length) tests.push(a.groups.some((g) => m.groups.includes(g)));
  if (a.units.length) tests.push(a.include_subunits ? a.units.some((u) => m.unitPath.includes(u)) : !!m.unitPath[0] && a.units.includes(m.unitPath[0]));
  if (a.locations.length) tests.push(a.include_sublocations ? a.locations.some((l) => m.locationPath.includes(l)) : !!m.locationPath[0] && a.locations.includes(m.locationPath[0]));
  if (a.roles.length) tests.push(a.roles.some((r) => m.roles.includes(r)));
  if (a.personas.length) tests.push(!!m.persona && a.personas.includes(m.persona));
  if (a.vip_only) tests.push(m.vip);
  const cond = a.condition && typeof a.condition === "object" && Object.keys(a.condition as object).length ? a.condition : null;
  if (cond) tests.push(condition ? condition(a) : false);
  // an audience without criteria matches nobody (a mistake should not open an item to everyone)
  if (!tests.length) return false;
  return a.match === "all" ? tests.every(Boolean) : tests.some(Boolean);
}

/** One level (catalogue, category or item): denial wins, an empty allow list means everyone. */
export function allows(b: Bindings, audiences: ReadonlyMap<string, AudienceDef>, m: MemberFacts, condition?: (a: AudienceDef) => boolean): boolean {
  const deny = ids(b.not_available_for);
  const allow = ids(b.available_for);
  const hit = (id: string) => {
    const a = audiences.get(id);
    return !!a && audienceMatches(a, m, condition);
  };
  if (deny.some(hit)) return false;
  if (!allow.length) return true;
  return allow.some(hit);
}

/** Every level on the way to an item (catalogue → categories from the top → the item) must allow the member. */
export function entitled(levels: readonly Bindings[], audiences: ReadonlyMap<string, AudienceDef>, m: MemberFacts, condition?: (a: AudienceDef) => boolean): boolean {
  return levels.every((b) => allows(b, audiences, m, condition));
}

/** A row of `catalog_audience` as an AudienceDef. */
export function audienceOf(row: Record<string, unknown>): AudienceDef {
  return {
    id: String(row.id),
    match: row.match === "all" ? "all" : "any",
    active: row.active !== false,
    users: ids(row.users),
    groups: ids(row.groups),
    units: ids(row.units),
    include_subunits: row.include_subunits !== false,
    locations: ids(row.locations),
    include_sublocations: row.include_sublocations !== false,
    roles: ids(row.roles),
    personas: ids(row.personas),
    vip_only: row.vip_only === true,
    condition: row.condition ?? null,
  };
}

/** The ids of a materialised path (`/<root>/…/<own>/`) from the node itself up to the root. */
export function pathUp(path: unknown, own: string | null): string[] {
  const parts = typeof path === "string" ? path.split("/").filter(Boolean) : [];
  const up = parts.reverse();
  if (own && !up.includes(own)) up.unshift(own);
  return up;
}
