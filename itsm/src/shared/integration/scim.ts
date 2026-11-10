// SCIM 2.0 (RFC 7643/7644) as Microsoft Entra ID and other identity providers speak it (catalogue INT-013, ACC-077):
// the resources, the filters they send (`userName eq "…"`, `externalId eq "…"`, `displayName eq "…"`) and their PATCH
// operations — pure, so the server's endpoints stay small and the rules are tested on their own.
// Imported by the UI: keep it free of server imports.

export const SCIM_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

export interface ScimFilter {
  attr: string;
  value: string;
}

/** `attr eq "value"` (the only filter Entra ID sends), or null. */
export function parseScimFilter(raw: string | null | undefined): ScimFilter | null {
  if (!raw) return null;
  const m = /^\s*([A-Za-z][A-Za-z0-9.:]*)\s+eq\s+"((?:\\"|[^"])*)"\s*$/i.exec(raw);
  return m ? { attr: m[1].toLowerCase(), value: m[2].replace(/\\"/g, '"') } : null;
}

/** What the server keeps of a SCIM user. */
export interface ScimUserInput {
  userName: string | null;
  externalId: string | null;
  email: string | null;
  name: string | null;
  title: string | null;
  phone: string | null;
  department: string | null;
  active: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The person a SCIM User resource describes. */
export function userFromScim(body: Record<string, any>): ScimUserInput {
  const emails = Array.isArray(body.emails) ? body.emails : [];
  const primary = emails.find((e: any) => e?.primary) ?? emails.find((e: any) => e?.type === "work") ?? emails[0];
  const phones = Array.isArray(body.phoneNumbers) ? body.phoneNumbers : [];
  const name = body.name && typeof body.name === "object" ? body.name : {};
  const formatted = str(name.formatted) ?? ([str(name.givenName), str(name.familyName)].filter(Boolean).join(" ") || null);
  const userName = str(body.userName);
  const email = str(primary?.value) ?? (userName && userName.includes("@") ? userName : null);
  const ent = body[SCIM_ENTERPRISE] && typeof body[SCIM_ENTERPRISE] === "object" ? body[SCIM_ENTERPRISE] : {};
  return {
    userName,
    externalId: str(body.externalId),
    email: email ? email.toLowerCase() : null,
    name: str(body.displayName) ?? formatted,
    title: str(body.title),
    phone: str(phones[0]?.value),
    department: str(ent.department),
    active: body.active === undefined ? true : body.active === true || body.active === "true" || body.active === "True",
  };
}

export interface PatchOp {
  op: string;
  path?: string;
  value?: unknown;
}

/** Applies a User PatchOp to the kept fields (Entra sends `replace` of `active`, `displayName`, `name.*`, `emails[…]`, `title`, or a value object without a path). */
export function patchUser(cur: ScimUserInput, ops: PatchOp[]): ScimUserInput {
  const next = { ...cur };
  const set = (path: string, value: unknown) => {
    const p = path.toLowerCase();
    if (p === "active") next.active = value === true || value === "true" || value === "True";
    else if (p === "displayname") next.name = str(value) ?? next.name;
    else if (p === "name.formatted") next.name = str(value) ?? next.name;
    else if (p === "username") next.userName = str(value) ?? next.userName;
    else if (p === "externalid") next.externalId = str(value);
    else if (p === "title") next.title = str(value);
    else if (p.startsWith("emails")) {
      const v = Array.isArray(value) ? (value[0] as any)?.value : value;
      const e = str(v);
      if (e) next.email = e.toLowerCase();
    } else if (p.startsWith("phonenumbers")) {
      const v = Array.isArray(value) ? (value[0] as any)?.value : value;
      next.phone = str(v);
    } else if (p.endsWith(":department") || p === "department") next.department = str(value);
  };
  for (const op of ops) {
    const kind = String(op.op ?? "").toLowerCase();
    if (kind !== "replace" && kind !== "add" && kind !== "remove") continue;
    if (kind === "remove") {
      if (op.path) set(op.path, null);
      continue;
    }
    if (op.path) set(op.path, op.value);
    else if (op.value && typeof op.value === "object") for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) set(k, v);
  }
  return next;
}

/** Group PatchOp → members added and removed (ids of SCIM users) and a new display name. */
export function patchGroup(ops: PatchOp[]): { add: string[]; remove: string[]; displayName: string | null } {
  const add: string[] = [];
  const remove: string[] = [];
  let displayName: string | null = null;
  const ids = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x: any) => str(x?.value ?? x)).filter((x): x is string => !!x);
  for (const op of ops) {
    const kind = String(op.op ?? "").toLowerCase();
    const path = String(op.path ?? "");
    if (path.toLowerCase() === "members" || (!path && op.value && typeof op.value === "object" && "members" in (op.value as object))) {
      const v = path ? op.value : (op.value as any).members;
      if (kind === "add" || kind === "replace") add.push(...ids(v));
      if (kind === "remove") remove.push(...ids(v));
      continue;
    }
    // remove with a filter path: members[value eq "id"]
    const m = /^members\[value eq "([^"]+)"\]$/i.exec(path);
    if (m && kind === "remove") {
      remove.push(m[1]);
      continue;
    }
    if (path.toLowerCase() === "displayname" && (kind === "replace" || kind === "add")) displayName = str(op.value);
    if (!path && op.value && typeof op.value === "object" && "displayName" in (op.value as object)) displayName = str((op.value as any).displayName);
  }
  return { add, remove, displayName };
}

export function scimError(status: number, detail: string, scimType?: string) {
  return { schemas: [SCIM_ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) };
}

export function scimList<T>(resources: T[], startIndex = 1, total = resources.length) {
  return { schemas: [SCIM_LIST], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources };
}
