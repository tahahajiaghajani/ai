// Creating an organisation: the row, its first member (the creator, as owner) and its default settings.
// Modules that need data of their own on day one (categories, queues…) seed it from `seedOrg`.
import type { Db, Tx } from "../../db";
import { insertRow } from "../../db/sql";
import { lockOrg, type OrgSettings } from "../../context";
import { uuidv7 } from "@shared/id";
import { DEFAULT_TIMEZONE, MODULES, isTimeZone, type ModuleKey } from "@shared/constants";

export interface CreateOrgInput {
  name: string;
  legal_name?: string | null;
  /** IANA time zone; default DEFAULT_TIMEZONE */
  timezone?: string | null;
  modules?: ModuleKey[];
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
}

export function defaultSettings(timezone?: string | null): OrgSettings {
  return {
    timezone: timezone && isTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE,
    print: { show_logo: true, footer: "" },
  };
}

/** Only modules the app knows (MODULES), each once. */
export function knownModules(modules: readonly string[] | null | undefined): ModuleKey[] {
  const known = new Set(MODULES.map((m) => m.key));
  return Array.from(new Set(modules ?? [])).filter((m) => known.has(m));
}

export async function createOrg(db: Db, userId: string, input: CreateOrgInput, origin: string): Promise<{ id: string }> {
  const orgId = uuidv7();
  const modules = knownModules(input.modules);
  await db.tx(async (tx) => {
    await lockOrg(tx, orgId);
    await insertRow(tx, "sm_orgs", {
      id: orgId,
      name: input.name.trim(),
      legal_name: input.legal_name?.trim() || null,
      modules,
      phone: input.phone || null,
      email: input.email || null,
      city: input.city || null,
      address: input.address || null,
      settings: defaultSettings(input.timezone),
      created_by: userId,
      origin,
    }, "id");
    await insertRow(tx, "sm_org_members", { id: uuidv7(), org_id: orgId, user_id: userId, role: "owner", origin }, "id");
    await seedOrg(tx, orgId, modules, origin);
  });
  return { id: orgId };
}

/**
 * What a new organisation (or a module switched on later) needs on day one. The platform itself needs
 * nothing beyond the organisation and its owner; modules add their own defaults here.
 */
export async function seedOrg(_tx: Tx, _orgId: string, _modules: ModuleKey[], _origin: string): Promise<void> {
  // no platform defaults yet
}
